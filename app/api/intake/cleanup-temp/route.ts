// app/api/intake/cleanup-temp/route.ts
// Weekly cleanup of the Supabase Storage `intake-temp` bucket (review item 52).
//
// Temp uploads are deleted after successful processing, but a file whose
// processing fails — or that a user uploads and never submits — would
// otherwise linger forever. This cron route deletes bucket objects older
// than 7 days. Nothing younger is touched, so in-flight intake is safe.
//
// Auth: same cron pattern as the other scheduled routes (x-cron-secret).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { createLogger } from '@/lib/log'

const log = createLogger('intake/cleanup-temp')

const BUCKET = 'intake-temp'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const LIST_PAGE = 100

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const cutoff = Date.now() - MAX_AGE_MS

  let checked = 0
  const stale: string[] = []

  // Upload paths in this bucket are flat (`<timestamp>-<fileName>`), so a
  // root listing covers everything; page through it completely.
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list('', { limit: LIST_PAGE, offset, sortBy: { column: 'created_at', order: 'asc' } })
    if (error) {
      return NextResponse.json({ error: `Failed to list ${BUCKET}: ${error.message}` }, { status: 500 })
    }
    if (!data?.length) break
    for (const obj of data) {
      if (!obj.id || !obj.created_at) continue // folder entries have no id
      checked++
      if (new Date(obj.created_at).getTime() < cutoff) stale.push(obj.name)
    }
    if (data.length < LIST_PAGE) break
  }

  let deleted = 0
  if (stale.length) {
    const { error } = await supabase.storage.from(BUCKET).remove(stale)
    if (error) {
      return NextResponse.json(
        { error: `Cleanup failed: ${error.message}`, checked, stale: stale.length },
        { status: 500 },
      )
    }
    deleted = stale.length
  }

  const summary = { bucket: BUCKET, checked, deleted, cutoff: new Date(cutoff).toISOString() }
  log.info('temp cleanup complete', summary)
  return NextResponse.json(summary)
}
