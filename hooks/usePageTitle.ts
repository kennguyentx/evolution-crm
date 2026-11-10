'use client'
import { useEffect } from 'react'

// Set the browser tab title for a page, e.g. usePageTitle('Deals')
// renders "Deals — Nexus". Pass a falsy value to leave the title alone
// (e.g. while a detail record is still loading).
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} — Nexus`
  }, [title])
}
