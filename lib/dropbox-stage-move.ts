// Client-side helper: moves a deal's Dropbox folder when stage changes
// Calls /api/dropbox PATCH and updates deals.dropbox_path in Supabase

import type { SupabaseClient } from '@supabase/supabase-js'
import { expectedDropboxFolder } from '@/lib/dropbox'

export async function moveDropboxOnStageChange(
  supabase: SupabaseClient,
  dealId: string,
  companyName: string,
  currentDropboxPath: string | null | undefined,
  newStage: string,
): Promise<{ path: string | null; error: string | null }> {
  if (!currentDropboxPath) return { path: null, error: null }

  const toPath = expectedDropboxFolder(companyName, newStage)
  if (currentDropboxPath.toLowerCase() === toPath.toLowerCase()) {
    return { path: currentDropboxPath, error: null }
  }

  try {
    const res = await fetch('/api/dropbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_path: currentDropboxPath, to_path: toPath }),
    })

    const data = await res.json()

    if (!res.ok) {
      const msg = data?.error ?? `Move failed (${res.status})`
      console.error('[Dropbox] Move failed:', msg, { from: currentDropboxPath, to: toPath })
      return { path: currentDropboxPath, error: msg }
    }

    await supabase.from('deals').update({ dropbox_path: data.path }).eq('id', dealId)
    return { path: data.path, error: null }
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown error'
    console.error('[Dropbox] Move exception:', msg)
    return { path: currentDropboxPath, error: msg }
  }
}
