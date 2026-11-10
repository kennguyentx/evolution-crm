// Shared Dropbox utility used by API routes (server-side only)
const DBX_CONTENT = 'https://content.dropboxapi.com/2'
const DBX_API = 'https://api.dropboxapi.com/2'

// ── Structured errors (review items 44/50) ───────────────────────────────────
// Every Dropbox failure is classified into a machine-readable code so callers
// can decide what to do: `rate_limited`/`auth` are transient (retry),
// `not_found`/`conflict` need a human or an explicit fallback.

export type DropboxErrorCode = 'not_found' | 'conflict' | 'rate_limited' | 'auth' | 'unknown'

export class DropboxError extends Error {
  code: DropboxErrorCode
  status?: number
  errorSummary?: string

  constructor(message: string, code: DropboxErrorCode, opts?: { status?: number; errorSummary?: string }) {
    super(message)
    this.name = 'DropboxError'
    this.code = code
    this.status = opts?.status
    this.errorSummary = opts?.errorSummary
  }
}

export function classifyDropboxError(status: number | undefined, errorSummary: string | undefined): DropboxErrorCode {
  const s = (errorSummary ?? '').toLowerCase()
  if (s.includes('not_found')) return 'not_found'
  if (s.includes('conflict')) return 'conflict'
  if (status === 429 || s.includes('rate_limit') || s.includes('too_many_requests')) return 'rate_limited'
  if (status === 401 || status === 403 || s.includes('invalid_access_token') || s.includes('expired_access_token')) return 'auth'
  return 'unknown'
}

async function toDropboxError(res: Response, context: string): Promise<DropboxError> {
  const text = await res.text().catch(() => '')
  let errorSummary: string | undefined
  try { errorSummary = JSON.parse(text)?.error_summary } catch { /* non-JSON body */ }
  const code = classifyDropboxError(res.status, errorSummary)
  return new DropboxError(
    `Dropbox ${context} failed (${code}): ${errorSummary ?? text ?? `HTTP ${res.status}`}`,
    code,
    { status: res.status, errorSummary },
  )
}

// ── Retry helper (review item 50) ────────────────────────────────────────────
// Retries ONLY transient failures — HTTP 429 and 5xx, plus network errors —
// up to 3 attempts with exponential backoff (1s, 2s, 4s) + jitter, honoring
// the Retry-After header when Dropbox sends one. Other 4xx are returned
// immediately for the caller to classify.

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function backoffMs(attempt: number): number {
  return 1000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250)
}

function retryAfterMs(res: Response): number {
  const raw = res.headers.get('retry-after')
  if (!raw) return 0
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000)
  const when = Date.parse(raw)
  if (!Number.isNaN(when)) return Math.min(Math.max(when - Date.now(), 0), 30_000)
  return 0
}

export async function withDropboxRetry(
  doFetch: () => Promise<Response>,
  opts?: { attempts?: number },
): Promise<Response> {
  const maxAttempts = opts?.attempts ?? 3
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response
    try {
      res = await doFetch()
    } catch (err) {
      // Network-level failure — transient, retry with backoff
      lastError = err
      if (attempt < maxAttempts) { await sleep(backoffMs(attempt)); continue }
      throw err
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const wait = Math.max(backoffMs(attempt), retryAfterMs(res))
      await res.text().catch(() => {}) // drain before retrying
      await sleep(wait)
      continue
    }
    return res
  }
  throw lastError ?? new Error('Dropbox request failed')
}

/** POST a JSON body to the Dropbox API with retry + classified errors. */
export async function dropboxApiPost(endpoint: string, body: unknown): Promise<any> {
  const token = await getDropboxToken()
  const res = await withDropboxRetry(() => fetch(`${DBX_API}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  if (!res.ok) throw await toDropboxError(res, endpoint)
  return res.json()
}

// ── Token management ─────────────────────────────────────────────────────────
// Concurrent refreshes are coalesced behind a single in-flight promise
// (review item 50): after expiry, N simultaneous requests trigger ONE
// refresh, not N.

let cachedToken: string | null = null
let tokenExpiry = 0
let refreshPromise: Promise<string> | null = null

export async function getDropboxToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && now < tokenExpiry) return cachedToken

  if (!refreshPromise) {
    refreshPromise = refreshDropboxToken().finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

async function refreshDropboxToken(): Promise<string> {
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN!,
      client_id: process.env.DROPBOX_APP_KEY!,
      client_secret: process.env.DROPBOX_APP_SECRET!,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    // Auth failures fail fast with code `auth` — never loop on a bad refresh token.
    const code: DropboxErrorCode =
      res.status === 400 || res.status === 401 || res.status === 403 ? 'auth' : 'unknown'
    throw new DropboxError(`Dropbox token refresh failed: ${JSON.stringify(data)}`, code, { status: res.status })
  }
  cachedToken = data.access_token
  tokenExpiry = Date.now() + (data.expires_in - 1800) * 1000
  return cachedToken!
}

// ── Metadata / existence (review item 49) ────────────────────────────────────

/**
 * Returns the Dropbox metadata for a path, or null ONLY when Dropbox says
 * the path does not exist (path/not_found). Any other failure — bad token,
 * rate limit, 5xx, network — throws a classified DropboxError so callers
 * cannot misread a transient failure as "doesn't exist".
 */
export async function dropboxGetMetadata(path: string): Promise<any | null> {
  try {
    return await dropboxApiPost('/files/get_metadata', { path })
  } catch (err) {
    if (err instanceof DropboxError && err.code === 'not_found') return null
    throw err
  }
}

export async function dropboxFolderExists(folderPath: string): Promise<boolean> {
  return (await dropboxGetMetadata(folderPath)) !== null
}

/** Like dropboxFolderExists, but appends " (2)", " (3)", … until the path is free. */
export async function uniqueDropboxPath(path: string): Promise<string> {
  if (!(await dropboxFolderExists(path))) return path
  for (let n = 2; n <= 50; n++) {
    const candidate = `${path} (${n})`
    if (!(await dropboxFolderExists(candidate))) return candidate
  }
  // Extreme fallback — effectively never hit
  return `${path} (${Date.now()})`
}

// ── Search by name ───────────────────────────────────────────────────────────
// Used by the nightly reconciler to find a deal's ID folder after a human
// dragged it somewhere unexpected in Dropbox (see lib/dropbox-move-detection).

export interface DropboxFolderMatch {
  /** Folder name exactly as Dropbox reports it. */
  name: string
  /** Canonical (lowercase) full path of the folder. */
  path: string
}

/**
 * Pure extractor for /files/search_v2 match lists: keeps only FOLDERS whose
 * name equals `folderName` (case-insensitive), deduped by path. Files that
 * happen to carry the name, and folders with merely similar names (e.g. a
 * "<name> (2)" conflict copy), are excluded — callers decide what the exact
 * matches mean. Extracted so it is unit-testable without the API.
 */
export function extractFolderMatches(matches: any[] | undefined, folderName: string): DropboxFolderMatch[] {
  const wanted = folderName.toLowerCase()
  const byPath = new Map<string, DropboxFolderMatch>()
  for (const match of matches ?? []) {
    // search_v2 wraps the entry: match.metadata is a Metadata wrapper whose
    // own `metadata` field is the file/folder entry.
    const entry = match?.metadata?.metadata ?? match?.metadata
    if (!entry || entry['.tag'] !== 'folder') continue
    const name = entry.name as string | undefined
    if (!name || name.toLowerCase() !== wanted) continue
    const path = (entry.path_lower ?? entry.path_display) as string | undefined
    if (!path) continue
    byPath.set(path.toLowerCase(), { name, path })
  }
  return [...byPath.values()]
}

/**
 * Account-wide search for folders named exactly `folderName`. Follows
 * search_v2 pagination (bounded, so a pathological index can't loop the
 * nightly job forever). Throws a classified DropboxError on API failure —
 * callers must not read a failed search as "no such folder".
 */
export async function dropboxFindFoldersByName(folderName: string): Promise<DropboxFolderMatch[]> {
  const found = new Map<string, DropboxFolderMatch>()
  const collect = (matches: any[] | undefined) => {
    for (const m of extractFolderMatches(matches, folderName)) found.set(m.path.toLowerCase(), m)
  }

  let page = await dropboxApiPost('/files/search_v2', {
    query: folderName,
    options: { filename_only: true, file_status: 'active', max_results: 100 },
  })
  collect(page?.matches)
  for (let i = 0; page?.has_more && page?.cursor && i < 20; i++) {
    page = await dropboxApiPost('/files/search/continue_v2', { cursor: page.cursor })
    collect(page?.matches)
  }
  return [...found.values()]
}

// ── Upload ───────────────────────────────────────────────────────────────────

export async function dropboxUpload(folderPath: string, fileName: string, buffer: Buffer | Uint8Array): Promise<string> {
  const fullPath = `${folderPath.replace(/\/$/, '')}/${fileName}`

  const res = await withDropboxRetry(async () => {
    const token = await getDropboxToken()
    return fetch(`${DBX_CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: fullPath,
          mode: 'add',
          autorename: true,
          mute: false,
        }),
      },
      body: new Uint8Array(buffer),
    })
  })
  if (!res.ok) throw await toDropboxError(res, 'upload')
  const result = await res.json()
  return result.path_lower as string
}

// ── Move (review items 44/45/50) ─────────────────────────────────────────────
// Idempotent, with explicit conflict handling:
//  • Folder already at the destination (a previous move succeeded but its
//    response was lost) → succeed without moving again.
//  • Source AND destination missing → fail `not_found`; never paper over it
//    by creating an empty folder.
//  • Destination occupied → move to a free " (2)"-suffixed path instead of
//    letting Dropbox silently autorename, and return the ACTUAL final path.

export async function dropboxMove(fromPath: string, toPath: string): Promise<string> {
  if (fromPath.toLowerCase() === toPath.toLowerCase()) return fromPath

  const fromMeta = await dropboxGetMetadata(fromPath)
  const toMeta = await dropboxGetMetadata(toPath)

  if (!fromMeta && toMeta) {
    // Already moved — treat as success and report the real location.
    return (toMeta.path_lower ?? toPath.toLowerCase()) as string
  }
  if (!fromMeta && !toMeta) {
    throw new DropboxError(
      `Dropbox move failed: source folder not found: ${fromPath}`,
      'not_found',
      { errorSummary: 'path/not_found/...' },
    )
  }

  // Both exist → explicit conflict: pick a free destination up front.
  let target = toPath
  if (fromMeta && toMeta) {
    target = await uniqueDropboxPath(toPath)
  }

  // Ensure the destination parent folder exists before moving.
  // Dropbox move_v2 errors if the parent doesn't exist.
  // create_folder_v2 returns a conflict error if it already exists — ignore it;
  // a genuine failure (auth, rate limit) will surface on the move call itself.
  const parentFolder = target.substring(0, target.lastIndexOf('/'))
  if (parentFolder) {
    await dropboxApiPost('/files/create_folder_v2', { path: parentFolder, autorename: false }).catch(() => {})
  }

  try {
    const result = await dropboxApiPost('/files/move_v2', {
      from_path: fromPath, to_path: target, autorename: false,
    })
    return (result.metadata?.path_lower ?? target.toLowerCase()) as string
  } catch (err) {
    if (err instanceof DropboxError && err.code === 'conflict') {
      // Lost a race for the destination between the pre-check and the move.
      // Retry once against a computed free name — never autorename silently.
      const freePath = await uniqueDropboxPath(toPath)
      const result = await dropboxApiPost('/files/move_v2', {
        from_path: fromPath, to_path: freePath, autorename: false,
      })
      return (result.metadata?.path_lower ?? freePath.toLowerCase()) as string
    }
    throw err
  }
}

// ── Delete (review item 51) ──────────────────────────────────────────────────

export async function dropboxDelete(path: string): Promise<string> {
  const result = await dropboxApiPost('/files/delete_v2', { path })
  return (result.metadata?.path_lower ?? path.toLowerCase()) as string
}

export function dropboxConfigured(): boolean {
  return !!(process.env.DROPBOX_REFRESH_TOKEN && process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET)
}

// ── Folder layout ────────────────────────────────────────────────────────────

// 'Dead' (the killed-deal stage) files alongside the Pass stages under
// !Passed Deals — same terminal, not-a-portfolio-company outcome.
const PASS_STAGES   = ['Pass (DOA)', 'Pass (Pre-LOI)', 'Pass (Post-LOI)', 'Dead']
const CLOSED_STAGES = ['Closed (Platform)', 'Closed (Add-On)']

function folderForStage(leaf: string, stage: string): string {
  if (PASS_STAGES.includes(stage))   return `/Evolution Strategy Partners/Deals/!Passed Deals/${leaf}`
  if (CLOSED_STAGES.includes(stage)) return `/Evolution Strategy Partners/Portfolio Co's/${leaf}`
  if (stage === 'Hold')              return `/Evolution Strategy Partners/Deals/!Hold/${leaf}`
  return `/Evolution Strategy Partners/Deals/${leaf}`
}

/**
 * Canonical Dropbox folder for a deal, keyed by DEAL ID (review item 45).
 * The company name must NOT appear in the path: renaming a company used to
 * orphan its folder because the folder name was derived from mutable data.
 * The UI keeps showing the company name from the deal record; only the
 * on-disk name is the (immutable, unique) deal ID.
 */
export function expectedDropboxFolder(dealId: string, stage: string): string {
  return folderForStage(dealId, stage)
}

/**
 * Legacy name-based folder, used ONLY by flows where the deal does not exist
 * yet (intake parse / email intake create the folder before the deal row, so
 * there is no deal ID to key on). Once the deal exists, the nightly
 * reconciler re-keys its folder to the deal-ID path.
 */
export function expectedDropboxFolderByName(companyName: string, stage: string): string {
  const safe = companyName.replace(/[<>:"/\\|?*]/g, '_')
  return folderForStage(safe, stage)
}

/**
 * Like expectedDropboxFolderByName, but guarantees a folder that does NOT
 * already exist — appends " (2)", " (3)", … when a same-named folder is
 * present. Use ONLY when creating a NEW deal (before it has an ID) so two
 * separate same-named deals get distinct document folders. Throws on
 * Dropbox API failures (see dropboxFolderExists) rather than guessing.
 */
export async function uniqueDropboxFolder(companyName: string, stage: string): Promise<string> {
  return uniqueDropboxPath(expectedDropboxFolderByName(companyName, stage))
}

/** Canonical Dropbox folder for a portfolio company (no deal stage needed). */
export function portfolioDropboxFolder(companyName: string): string {
  const safe = companyName.replace(/[<>:"/\\|?*]/g, '_')
  return `/Evolution Strategy Partners/Portfolio Co's/${safe}`
}
