'use client'
import { useCallback, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

// Read a search param during initial state setup. Pages in this app only
// mount after LayoutClient has resolved the session on the client, so
// window is available by the time these components first render; the
// typeof check keeps the helper safe if that ever changes.
export function initialParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

// Sync a set of params to the URL with router.replace (no history entry,
// no scroll jump). Pass null/'' for a param to remove it. Other params
// already in the URL (e.g. ?open= deep links) are preserved.
export function useSyncUrlParams() {
  const router = useRouter()
  const pathname = usePathname()
  return useCallback((updates: Record<string, string | null | undefined>) => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    const qs = params.toString()
    const current = window.location.search.replace(/^\?/, '')
    if (qs === current) return
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname])
}

// Sync an object of filter values to the URL whenever it changes.
// `serialize` returns only the params that should be present (omit
// defaults by returning null for them). The first render is skipped so
// the sync never clobbers params that initialParam() just read.
export function useUrlFilterSync(values: Record<string, string | null | undefined>) {
  const sync = useSyncUrlParams()
  const first = useRef(true)
  const serialized = JSON.stringify(values)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    sync(JSON.parse(serialized))
  }, [serialized, sync])
}
