// app/api/dropbox/migrate-folders/route.ts
// ONE-TIME migration for review item 45 (spec docs/dropbox-folder-moves.md §4a):
// re-keys every deal's Dropbox folder from its company-name path to its
// deal-ID path (e.g. /Deals/DiPonio Holdings → /Deals/<deal-uuid>), so future
// company renames can no longer orphan folders.
//
// Run ONCE, manually, after the dropbox_move_jobs migration SQL has been
// applied, and BEFORE relying on the nightly reconciler:
//
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
//     https://nexus.evolutionstrategy.com/api/dropbox/migrate-folders
//
// Protected with the cron-secret header so it can't be triggered casually.
// Safe to re-run: deals already on their ID path are counted
// `already_correct` and skipped; a target ID path that already exists is
// handled by dropboxMove's explicit conflict rule (free " (2)" path, actual
// final path recorded). Every move writes a dropbox_move_jobs row with
// source = 'migration' — those rows are the migration record. Verify the
// returned counts before deleting anything by hand in Dropbox.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { dropboxConfigured, dropboxMove, expectedDropboxFolder, DropboxError } from '@/lib/dropbox'
import { createLogger } from '@/lib/log'

const log = createLogger('dropbox/migrate-folders')

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function audit(action: string, extra?: Record<string, unknown>) {
  log.info('audit', { action, ...extra })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!dropboxConfigured()) {
    return NextResponse.json({ error: 'Dropbox is not configured' }, { status: 500 })
  }

  const supabase = serviceClient()

  const deals: { id: string; stage: string; dropbox_path: string }[] = []
  const PAGE = 500
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('deals')
      .select('id, stage, dropbox_path')
      .not('dropbox_path', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: `Failed to load deals: ${error.message}` }, { status: 500 })
    deals.push(...((data ?? []) as typeof deals))
    if (!data || data.length < PAGE) break
  }

  let checked = 0, moved = 0, alreadyCorrect = 0, failed = 0
  const failures: { deal_id: string; error: string }[] = []

  for (const deal of deals) {
    checked++
    const stored = deal.dropbox_path
    const target = expectedDropboxFolder(deal.id, deal.stage)

    if (stored.toLowerCase() === target.toLowerCase()) {
      alreadyCorrect++
      continue
    }

    const { data: job } = await supabase
      .from('dropbox_move_jobs')
      .insert({ deal_id: deal.id, from_path: stored, to_path: target, status: 'pending', source: 'migration' })
      .select('id')
      .single()

    try {
      const finalPath = await dropboxMove(stored, target)
      if (job?.id) {
        await supabase
          .from('dropbox_move_jobs')
          .update({ status: 'succeeded', final_path: finalPath, updated_at: new Date().toISOString() })
          .eq('id', job.id)
      }
      await supabase.from('deals').update({ dropbox_path: finalPath }).eq('id', deal.id)
      moved++
    } catch (err: any) {
      failed++
      failures.push({ deal_id: deal.id, error: err?.message ?? 'Unknown error' })
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
    }
  }

  const summary = { checked, moved, already_correct: alreadyCorrect, failed, failures }
  audit('migration', { ...summary })
  return NextResponse.json(summary)
}
