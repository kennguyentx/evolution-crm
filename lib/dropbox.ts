// Shared Dropbox utility used by API routes (server-side only)
const DBX_CONTENT = 'https://content.dropboxapi.com/2'
const DBX_API = 'https://api.dropboxapi.com/2'

let cachedToken: string | null = null
let tokenExpiry = 0

export async function getDropboxToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && now < tokenExpiry) return cachedToken

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
  const data = await res.json()
  if (!data.access_token) throw new Error(`Dropbox token refresh failed: ${JSON.stringify(data)}`)
  cachedToken = data.access_token
  tokenExpiry = now + (data.expires_in - 1800) * 1000
  return cachedToken!
}

export async function dropboxUpload(folderPath: string, fileName: string, buffer: Buffer | Uint8Array): Promise<string> {
  const token = await getDropboxToken()
  const fullPath = `${folderPath.replace(/\/$/, '')}/${fileName}`

  const res = await fetch(`${DBX_CONTENT}/files/upload`, {
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
  if (!res.ok) throw new Error(`Dropbox upload failed: ${await res.text()}`)
  const result = await res.json()
  return result.path_lower as string
}

export async function dropboxMove(fromPath: string, toPath: string): Promise<string> {
  const token = await getDropboxToken()
  const res = await fetch(`${DBX_API}/files/move_v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from_path: fromPath, to_path: toPath, autorename: true }),
  })
  if (!res.ok) throw new Error(`Dropbox move failed: ${await res.text()}`)
  const result = await res.json()
  return (result.metadata?.path_lower ?? toPath.toLowerCase()) as string
}

export function dropboxConfigured(): boolean {
  return !!(process.env.DROPBOX_REFRESH_TOKEN && process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET)
}

const PASS_STAGES = ['Pass (DOA)', 'Pass (Pre-LOI)', 'Pass (Post-LOI)']
const ACTIVE_STAGES = ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity']

export function expectedDropboxFolder(companyName: string, stage: string): string {
  const safe = companyName.replace(/[<>:"/\\|?*]/g, '_')
  if (PASS_STAGES.includes(stage)) return `/Evolution Strategy Partners/Deals/!Passed Deals/${safe}`
  return `/Evolution Strategy Partners/Deals/${safe}`
}
