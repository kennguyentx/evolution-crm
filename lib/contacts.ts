// ── Shared contact helpers ────────────────────────────────────────────────────
// Used by the email intake route (add-contact path, queue approval) and by the
// note-append command (contact resolution). Kept in lib/ so both server routes
// can share them without importing a route module.

const ROLE_TO_CONTACT_TYPE: Record<string, 'banker' | 'management' | 'advisor' | 'lender' | 'other'> = {
  'source / banker': 'banker',
  'management':      'management',
  'advisor':         'advisor',
  'lender':          'lender',
  'other':           'other',
}

// ── Upsert contacts (optionally link to a deal) ──────────────────────────────
// Returns which contacts were newly created vs. already existed (by display name).
//
// opts.fillBlanks (opt-in, used by the email add-contact path): when a contact
// already exists, fill its EMPTY firm/title/email/phone from the incoming
// values. Non-empty fields are never overwritten. Default behavior (no opts)
// is unchanged — existing contacts are left exactly as they are.
export async function upsertContacts(
  supabase: any,
  contacts: any[],
  dealId?: string | null,
  opts?: { fillBlanks?: boolean },
): Promise<{ created: string[]; existing: string[] }> {
  const created: string[] = []
  const existingNames: string[] = []
  const fillBlanks = !!opts?.fillBlanks
  const matchCols = fillBlanks ? 'id, firm, title, email, phone' : 'id'

  for (const c of contacts) {
    if (!c.name) continue
    const parts = c.name.trim().split(/\s+/)
    const firstName = parts[0]
    const lastName  = parts.slice(1).join(' ') || ''
    const display   = c.name.trim()

    // Priority 1: match by email (most reliable — avoids merging same-name people)
    let existing: any = null
    if (c.email) {
      const { data } = await supabase.from('contacts').select(matchCols).ilike('email', c.email).limit(1).maybeSingle()
      existing = data
    }
    // Priority 2: match by first + last name
    if (!existing) {
      const { data } = await supabase.from('contacts').select(matchCols)
        .ilike('first_name', firstName).ilike('last_name', lastName).limit(1).maybeSingle()
      existing = data
    }

    let contactId = existing?.id

    if (contactId && fillBlanks) {
      // Fill only the blanks — never overwrite what's already on the record.
      const patch: Record<string, any> = {}
      for (const field of ['firm', 'title', 'email', 'phone'] as const) {
        if (!existing[field] && c[field]) patch[field] = c[field]
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from('contacts').update(patch).eq('id', contactId)
      }
    }

    if (!contactId) {
      // Bare creates get a contact_type so the row is complete even when the
      // source gave no role: map the LLM's role label, defaulting to 'other'
      // (same default the notes-page UI uses for manual creates).
      const contactType =
        (c.contact_type as string) ||
        ROLE_TO_CONTACT_TYPE[(c.role as string || '').toLowerCase()] ||
        'other'
      const { data: newContact } = await supabase.from('contacts').insert({
        first_name: firstName,
        last_name:  lastName,
        firm:       c.firm  || null,
        title:      c.title || null,
        email:      c.email || null,
        phone:      c.phone || null,
        contact_type: contactType,
      }).select('id').single()
      contactId = newContact?.id
      if (contactId) created.push(display)
    } else {
      existingNames.push(display)
    }

    if (contactId && dealId) {
      // Link contact to deal if not already linked
      await supabase.from('contact_deal_links').upsert(
        { contact_id: contactId, deal_id: dealId, role: c.role || 'Other' },
        { onConflict: 'contact_id,deal_id', ignoreDuplicates: true }
      )
    }
  }

  return { created, existing: existingNames }
}

export interface ContactCandidate {
  id: string
  first_name: string
  last_name: string
  firm: string | null
  email: string | null
}

// ── Resolve a name to contact candidates (note-append command) ───────────────
// Exact first+last match first; falls back to last-name matches (the forwarder
// may use a nickname or only a last name). Never returns more than `limit`
// rows — the caller queues with the list when there is more than one.
export async function findContactCandidates(
  supabase: any,
  name: string,
  limit = 5,
): Promise<ContactCandidate[]> {
  const parts = name.trim().split(/\s+/)
  if (!parts.length) return []
  const firstName = parts[0]
  const lastName = parts.slice(1).join(' ')

  if (lastName) {
    const { data } = await supabase.from('contacts')
      .select('id, first_name, last_name, firm, email')
      .ilike('first_name', firstName).ilike('last_name', lastName)
      .order('created_at', { ascending: false }).limit(limit)
    if (data?.length) return data as ContactCandidate[]
  }

  const { data } = await supabase.from('contacts')
    .select('id, first_name, last_name, firm, email')
    .ilike('last_name', lastName || firstName)
    .order('created_at', { ascending: false }).limit(limit)
  return (data ?? []) as ContactCandidate[]
}
