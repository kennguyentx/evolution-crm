// Client-side helper: moves a deal's Dropbox folder when stage changes
// Calls /api/dropbox PATCH and updates deals.dropbox_path in Supabase.
//
// Review items 44/50: every attempt is recorded in `dropbox_move_jobs`
// (inserted as 'pending' BEFORE the move, then marked succeeded/failed with
// the server's machine-readable error code). Failed moves are therefore
// visible on the deal page — with a Retry button — and survive reloads,
// instead of being swallowed by a console.error.

import type { SupabaseClient } from '@supabase/supabase-js'
import { expectedDropboxFolder } from '@/lib/dropbox'
import { createLogger } from '@/lib/log'

const log = createLogger('dropbox-stage-move')

export interface DropboxMoveResult {
  path: string | null
  error: string | null
  code: string | null
}

type MoveSource = 'stage-change' | 'retry' | 'reconcile' | 'migration'

async function patchMove(fromPath: string, toPath: string) {
  const res = await fetch('/api/dropbox', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_path: fromPath, to_path: toPath }),
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

async function attemptMove(
  supabase: SupabaseClient,
  dealId: string,
  fromPath: string,
  toPath: string,
  source: MoveSource,
): Promise<DropboxMoveResult> {
  // 1. Record the attempt before making it. If the table doesn't exist yet
  //    (migration not applied), proceed without tracking rather than
  //    blocking the move itself.
  let jobId: string | null = null
  const { data: job } = await supabase
    .from('dropbox_move_jobs')
    .insert({ deal_id: dealId, from_path: fromPath, to_path: toPath, status: 'pending', source })
    .select('id')
    .single()
  if (job?.id) jobId = job.id

  const finishJob = async (status: 'succeeded' | 'failed', fields: Record<string, unknown>) => {
    if (!jobId) return
    await supabase
      .from('dropbox_move_jobs')
      .update({ status, updated_at: new Date().toISOString(), ...fields })
      .eq('id', jobId)
  }

  try {
    let { res, data } = await patchMove(fromPath, toPath)

    // Transient server-side failures get ONE client-side retry after a
    // short wait (the server already retries 429/5xx internally; this
    // covers a rate-limit window that outlasts it).
    if (!res.ok && (data?.code === 'rate_limited' || data?.code === 'auth')) {
      await new Promise(r => setTimeout(r, 2000))
      ;({ res, data } = await patchMove(fromPath, toPath))
    }

    if (!res.ok) {
      const msg = data?.error ?? `Move failed (${res.status})`
      const code = (data?.code as string) ?? 'unknown'
      log.error('[Dropbox] Move failed:', msg, { from: fromPath, to: toPath, code })
      await finishJob('failed', { error: msg, code })
      return { path: fromPath, error: msg, code }
    }

    await finishJob('succeeded', { final_path: data.path, error: null, code: null })
    await supabase.from('deals').update({ dropbox_path: data.path }).eq('id', dealId)
    return { path: data.path, error: null, code: null }
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown error'
    log.error('[Dropbox] Move exception:', msg)
    await finishJob('failed', { error: msg, code: 'unknown' })
    return { path: fromPath, error: msg, code: 'unknown' }
  }
}

export async function moveDropboxOnStageChange(
  supabase: SupabaseClient,
  dealId: string,
  currentDropboxPath: string | null | undefined,
  newStage: string,
): Promise<DropboxMoveResult> {
  if (!currentDropboxPath) return { path: null, error: null, code: null }

  const toPath = expectedDropboxFolder(dealId, newStage)
  if (currentDropboxPath.toLowerCase() === toPath.toLowerCase()) {
    return { path: currentDropboxPath, error: null, code: null }
  }

  return attemptMove(supabase, dealId, currentDropboxPath, toPath, 'stage-change')
}

/** Re-attempts the latest failed move for a deal (deal-page Retry button). */
export async function retryDropboxMove(
  supabase: SupabaseClient,
  dealId: string,
): Promise<DropboxMoveResult> {
  const { data: job } = await supabase
    .from('dropbox_move_jobs')
    .select('from_path, to_path')
    .eq('deal_id', dealId)
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const { data: deal } = await supabase
    .from('deals')
    .select('dropbox_path')
    .eq('id', dealId)
    .single()

  if (!job) return { path: deal?.dropbox_path ?? null, error: null, code: null }

  // Move from where the folder actually is now (the deal's stored path),
  // not the stale from_path of the original attempt.
  const fromPath = deal?.dropbox_path ?? job.from_path
  if (!fromPath) return { path: null, error: 'No Dropbox folder is linked to this deal', code: 'not_found' }
  if (fromPath.toLowerCase() === job.to_path.toLowerCase()) {
    await supabase.from('deals').update({ dropbox_path: job.to_path }).eq('id', dealId)
    return { path: job.to_path, error: null, code: null }
  }

  return attemptMove(supabase, dealId, fromPath, job.to_path, 'retry')
}

/**
 * The deal page's warning banner is derived from this: the deal's most
 * recent move job, returned only if it failed (a later success clears it).
 */
export async function getLatestFailedMoveJob(
  supabase: SupabaseClient,
  dealId: string,
): Promise<{ id: string; to_path: string; error: string | null; code: string | null } | null> {
  const { data } = await supabase
    .from('dropbox_move_jobs')
    .select('id, to_path, error, code, status')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (!data || data.status !== 'failed') return null
  return { id: data.id, to_path: data.to_path, error: data.error, code: data.code }
}
