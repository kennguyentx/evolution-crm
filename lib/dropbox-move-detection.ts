// lib/dropbox-move-detection.ts
// Moved-folder detection for the nightly Dropbox reconciler
// (app/api/dropbox/reconcile). The one-time folder migration re-keyed deal
// folders to deal-ID names, so a deal's folder is findable by its immutable
// UUID name even after a human drags it somewhere new in Dropbox (from
// Deals/ into !!DiPonio, !Passed Deals, or anywhere else). When neither the
// stored path nor the stage-expected path resolves, the reconciler asks
// this module to search by that UUID name and repair the record:
//
//   exactly one folder → repoint deals.dropbox_path at it and leave a
//                        SUCCEEDED audit row (code 'moved_detected');
//   zero folders       → FAILED audit row (code 'not_found');
//   several folders    → FAILED audit row naming the candidates
//                        (code 'conflict'); never guess between them.
//
// Every outcome writes a dropbox_move_jobs row with source = 'reconcile',
// following the table's existing conventions (failed rows surface on the
// deal page; rows are the audit trail and are never deleted). Like the
// reconciler's move retries, there is NO dedupe: an unchanged broken
// situation records a fresh row each night.
//
// Known limitation: this finds folders by their UUID name. If a human
// RENAMES the ID folder itself, the folder is unfindable by ID and the
// deal lands in the not_found bucket — deliberately not fuzzy-matched.

import type { SupabaseClient } from '@supabase/supabase-js'
import { dropboxFindFoldersByName, type DropboxFolderMatch } from './dropbox'

export type MoveDetection =
  | { outcome: 'moved'; foundPath: string }
  | { outcome: 'not_found' }
  | { outcome: 'ambiguous'; candidates: string[] }

/** Pure decision over exact-name folder matches. */
export function classifyMoveDetection(matches: DropboxFolderMatch[]): MoveDetection {
  if (matches.length === 0) return { outcome: 'not_found' }
  if (matches.length === 1) return { outcome: 'moved', foundPath: matches[0].path }
  return { outcome: 'ambiguous', candidates: matches.map(m => m.path) }
}

export interface MoveDetectionDeps {
  supabase: SupabaseClient
  /** Injectable for tests; defaults to the account-wide Dropbox search. */
  findFolders?: (folderName: string) => Promise<DropboxFolderMatch[]>
}

/**
 * Search Dropbox for the deal's ID folder and repair/audit accordingly.
 * `storedPath` is the deal's current (unresolving) dropbox_path;
 * `expectedPath` is its stage-canonical ID path (also unresolving) — the
 * folder's UUID basename comes from it. Search hits AT either known-missing
 * path are dropped before deciding: get_metadata has already proven those
 * paths empty, so a hit there is search-index lag, not a move.
 *
 * Throws whatever the search or the DB writes throw — the reconciler's
 * per-deal error handling records those as ordinary reconcile failures.
 */
export async function detectMovedFolder(
  deps: MoveDetectionDeps,
  deal: { id: string; dropbox_path: string },
  expectedPath: string,
): Promise<MoveDetection> {
  const findFolders = deps.findFolders ?? dropboxFindFoldersByName
  const leaf = expectedPath.substring(expectedPath.lastIndexOf('/') + 1)
  const knownMissing = new Set([deal.dropbox_path.toLowerCase(), expectedPath.toLowerCase()])
  const matches = (await findFolders(leaf)).filter(m => !knownMissing.has(m.path.toLowerCase()))
  const detection = classifyMoveDetection(matches)
  const supabase = deps.supabase

  if (detection.outcome === 'moved') {
    await supabase.from('deals').update({ dropbox_path: detection.foundPath }).eq('id', deal.id)
    await supabase.from('dropbox_move_jobs').insert({
      deal_id: deal.id,
      from_path: deal.dropbox_path,
      to_path: detection.foundPath,
      final_path: detection.foundPath,
      status: 'succeeded',
      source: 'reconcile',
      code: 'moved_detected',
      error: `Folder found at ${detection.foundPath} after move; stored path updated`,
    })
  } else if (detection.outcome === 'ambiguous') {
    await supabase.from('dropbox_move_jobs').insert({
      deal_id: deal.id,
      from_path: deal.dropbox_path,
      to_path: expectedPath,
      status: 'failed',
      source: 'reconcile',
      code: 'conflict',
      error: `Folder not found at stored path; ${detection.candidates.length} folders named ${leaf} exist (${detection.candidates.join(', ')}); stored path left unchanged`,
    })
  } else {
    await supabase.from('dropbox_move_jobs').insert({
      deal_id: deal.id,
      from_path: deal.dropbox_path,
      to_path: expectedPath,
      status: 'failed',
      source: 'reconcile',
      code: 'not_found',
      error: `folder not found at stored path and no folder named ${leaf} exists in Dropbox`,
    })
  }
  return detection
}
