// Client-side helper: moves a deal's Dropbox folder when stage changes
// Calls /api/dropbox PATCH and updates deals.dropbox_path in Supabase

import type { SupabaseClient } from '@supabase/supabase-js'

const PASS_STAGES = ['Pass (DOA)', 'Pass (Pre-LOI)', 'Pass (Post-LOI)']

function expectedFolder(companyName: string, stage: string): string {
  const safe = companyName.replace(/[<>:"/\\|?*]/g, '_')
  return PASS_STAGES.includes(stage) ? `/Deals/Passed/${safe}` : `/Deals/${safe}`
}

export async function moveDropboxOnStageChange(
  supabase: SupabaseClient,
  dealId: string,
  companyName: string,
  currentDropboxPath: string | null | undefined,
  newStage: string,
): Promise<string | null> {
  if (!currentDropboxPath) return null

  const toPath = expectedFolder(companyName, newStage)
  if (currentDropboxPath.toLowerCase() === toPath.toLowerCase()) return currentDropboxPath

  try {
    const res = await fetch('/api/dropbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_path: currentDropboxPath, to_path: toPath }),
    })
    if (!res.ok) return currentDropboxPath
    const { path } = await res.json()
    await supabase.from('deals').update({ dropbox_path: path }).eq('id', dealId)
    return path
  } catch {
    return currentDropboxPath
  }
}
