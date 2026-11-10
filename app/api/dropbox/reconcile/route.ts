// app/api/dropbox/reconcile/route.ts
// Nightly reconciler (review items 44/45, spec docs/dropbox-folder-moves.md §3d).
//
// The backstop for stage-change folder moves: for every deal with a linked
// Dropbox folder, compare the stored path against the folder its stage says
// it should have (deal-ID based) and against reality in Dropbox, then fix
// any drift. Idempotent — a second run right after a clean run is a no-op.
// One bad deal never aborts the run; failures are recorded as failed
// dropbox_move_jobs rows (source = 'reconcile') so they show on the deal page.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isAuthorizedCron } from '@/lib/cron-auth'
import {
  dropboxConfigured, dropboxGetMetadata, dropboxMove, expectedDropboxFolder, DropboxError,
} from '@/lib/dropbox'

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function audit(action: string, extra?: Record<string, unknown>) {
  console.log('[dropbox-audit]', JSON.stringify({ ts: new Date().toISOString(), action, ...extra }))
}

/** Move a folder via the job-row machinery; throws (after recording) on failure. */
async function moveWithJob(
  supabase: SupabaseClient,
  dealId: string,
  fromPath: string,
  toPath: string,
  source: 'reconcile' | 'migration',
): Promise<string> {
  const { data: job } = await supabase
    .from('dropbox_move_jobs')
    .insert({ deal_id: dealId, from_path: fromPath, to_path: toPath, status: 'pending', source })
    .select('id')
    .single()

  try {
    const finalPath = await dropboxMove(fromPath, toPath)
    if (job?.id) {
      await supabase
        .from('dropbox_move_jobs')
        .update({ status: 'succeeded', final_path: finalPath, updated_at: new Date().toISOString() })
        .eq('id', job.id)
    }
    await supabase.from('deals').update({ dropbox_path: finalPath }).eq('id', dealId)
    return finalPath
  } catch (err: any) {
    if (job?.id) {
      await supabase
        .from('dropbox_move_jobs')
        .update({
          status: 'failed',
          error: err?.message ?? 'Unknown error',
          code: err instanceof DropboxError ? err.code : 'unknown',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
    }
    throw err
  }
}

interface DealRow { id: string; stage: string; company_name: string; dropbox_path: string }

async function loadDeals(supabase: SupabaseClient): Promise<DealRow[]> {
  const deals: DealRow[] = []
  const PAGE = 500
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('deals')
      .select('id, stage, company_name, dropbox_path')
      .not('dropbox_path', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Failed to load deals: ${error.message}`)
    deals.push(...((data ?? []) as DealRow[]))
    if (!data || data.length < PAGE) break
  }
  return deals
}

export async function GET(req: NextRequest) {
  // Cron-only, exactly like the other scheduled routes (x-cron-secret header).
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!dropboxConfigured()) {
    return NextResponse.json({ error: 'Dropbox is not configured' }, { status: 500 })
  }

  const supabase = serviceClient()

  let deals: DealRow[]
  try {
    deals = await loadDeals(supabase)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  let checked = 0, moved = 0, fixedPath = 0, missing = 0, failed = 0
  const failures: { deal_id: string; error: string }[] = []

  // Sequential on purpose: bounded load on the Dropbox API; the retry
  // helper in lib/dropbox handles 429/5xx backoff per call.
  for (const deal of deals) {
    checked++
    const stored = deal.dropbox_path
    const expected = expectedDropboxFolder(deal.id, deal.stage)
    try {
      const storedMeta = await dropboxGetMetadata(stored)
      const expectedMeta = stored.toLowerCase() === expected.toLowerCase()
        ? storedMeta
        : await dropboxGetMetadata(expected)

      if (storedMeta && expectedMeta && stored.toLowerCase() === expected.toLowerCase()) {
        // Stored path exists and is the expected path — nothing to do.
        continue
      }
      if (storedMeta && !expectedMeta) {
        // Folder is at the old/wrong place — move it to the expected path.
        // moveWithJob records the failed job row itself when the move fails.
        try {
          await moveWithJob(supabase, deal.id, stored, expected, 'reconcile')
          moved++
        } catch (err: any) {
          failed++
          failures.push({ deal_id: deal.id, error: err?.message ?? 'Unknown error' })
        }
      } else if (!storedMeta && expectedMeta) {
        // Folder is already where it should be; only the DB path is stale.
        const actual = (expectedMeta.path_lower ?? expected) as string
        await supabase.from('deals').update({ dropbox_path: actual }).eq('id', deal.id)
        fixedPath++
      } else if (storedMeta && expectedMeta) {
        // Both exist (e.g. a legacy name folder and an ID folder). Move the
        // stored folder; dropboxMove's conflict handling lands it at a free
        // " (2)" path and returns the actual final path.
        try {
          await moveWithJob(supabase, deal.id, stored, expected, 'reconcile')
          moved++
        } catch (err: any) {
          failed++
          failures.push({ deal_id: deal.id, error: err?.message ?? 'Unknown error' })
        }
      } else {
        // Neither exists — do NOT create an empty folder or touch the row.
        missing++
        console.warn(`[dropbox-reconcile] Deal ${deal.id} (${deal.company_name}): folder missing at "${stored}" and expected "${expected}"`)
      }
    } catch (err: any) {
      // Reached only for failures OUTSIDE a move attempt (metadata checks,
      // DB updates) — move failures are counted in their own try/catch and
      // already have a job row from moveWithJob.
      failed++
      failures.push({ deal_id: deal.id, error: err?.message ?? 'Unknown error' })
      await supabase.from('dropbox_move_jobs').insert({
        deal_id: deal.id,
        from_path: stored,
        to_path: expected,
        status: 'failed',
        source: 'reconcile',
        error: err?.message ?? 'Unknown error',
        code: err instanceof DropboxError ? err.code : 'unknown',
      })
    }
  }

  const summary = { checked, moved, fixed_path: fixedPath, missing, failed, failures }
  audit('reconcile', { ...summary })
  return NextResponse.json(summary)
}
