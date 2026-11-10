import { describe, expect, it } from 'vitest';
import { upsertContacts } from './contacts';

// Minimal chainable Supabase stub: select-match queries resolve `matchRow`,
// inserts are recorded, updates are recorded (the update chain is awaited).
function fakeSupabase(matchRow: any) {
  const state = { updates: [] as any[], inserts: [] as any[] };
  const from = () => {
    const b: any = {
      select: () => b,
      ilike: () => b,
      limit: () => b,
      eq: () => b,
      insert: (row: any) => {
        state.inserts.push(row);
        return b;
      },
      update: (patch: any) => {
        state.updates.push(patch);
        return b;
      },
      maybeSingle: async () => ({ data: matchRow }),
      single: async () => ({ data: { id: 'created-id' } }),
      then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
    };
    return b;
  };
  return { supabase: { from }, state };
}

const EXISTING = {
  id: 'c1',
  firm: null,
  title: 'Managing Director',
  email: 'jane@acme.com',
  phone: null,
};

const INCOMING = {
  name: 'Jane Doe',
  email: 'jane@acme.com',
  firm: 'Acme Capital',
  title: 'Partner',
  phone: '(512) 555-0100',
};

describe('upsertContacts — fillBlanks', () => {
  it('fills only the blank fields of an existing contact', async () => {
    const { supabase, state } = fakeSupabase(EXISTING);
    const res = await upsertContacts(supabase, [INCOMING], null, { fillBlanks: true });
    expect(res.created).toEqual([]);
    expect(res.existing).toEqual(['Jane Doe']);
    // firm + phone were blank and get filled; title was already set and the
    // incoming email matched the record, so neither is patched.
    expect(state.updates).toEqual([{ firm: 'Acme Capital', phone: '(512) 555-0100' }]);
    expect(state.inserts).toEqual([]);
  });

  it('does nothing to existing contacts without the opt-in', async () => {
    const { supabase, state } = fakeSupabase(EXISTING);
    const res = await upsertContacts(supabase, [INCOMING], null);
    expect(res.existing).toEqual(['Jane Doe']);
    expect(state.updates).toEqual([]);
  });

  it('still creates new contacts with all fields when there is no match', async () => {
    const { supabase, state } = fakeSupabase(null);
    const res = await upsertContacts(supabase, [INCOMING], null, { fillBlanks: true });
    expect(res.created).toEqual(['Jane Doe']);
    expect(state.inserts).toEqual([
      {
        first_name: 'Jane',
        last_name: 'Doe',
        firm: 'Acme Capital',
        title: 'Partner',
        email: 'jane@acme.com',
        phone: '(512) 555-0100',
        contact_type: 'other',
      },
    ]);
    expect(state.updates).toEqual([]);
  });
});
