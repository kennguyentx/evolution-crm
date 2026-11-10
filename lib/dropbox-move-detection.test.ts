import { describe, expect, it } from 'vitest';
import { extractFolderMatches, type DropboxFolderMatch } from './dropbox';
import { classifyMoveDetection, detectMovedFolder } from './dropbox-move-detection';

// Minimal chainable Supabase stub (same pattern as contacts.test.ts):
// updates and inserts are recorded per table; every chain is awaitable.
function fakeSupabase() {
  const state = {
    updates: [] as { table: string; patch: any }[],
    inserts: [] as { table: string; row: any }[],
  };
  const from = (table: string) => {
    const b: any = {
      update: (patch: any) => {
        state.updates.push({ table, patch });
        return b;
      },
      insert: (row: any) => {
        state.inserts.push({ table, row });
        return b;
      },
      eq: () => b,
      then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
    };
    return b;
  };
  return { supabase: { from } as any, state };
}

const DEAL = { id: 'deal-uuid-123', dropbox_path: '/evolution strategy partners/deals/deal-uuid-123' };
const EXPECTED = '/Evolution Strategy Partners/Deals/!Passed Deals/deal-uuid-123';
const FOUND = '/evolution strategy partners/deals/!!diponio/deal-uuid-123';

describe('classifyMoveDetection', () => {
  it('zero matches → not_found', () => {
    expect(classifyMoveDetection([])).toEqual({ outcome: 'not_found' });
  });

  it('exactly one match → moved, with its path', () => {
    const matches: DropboxFolderMatch[] = [{ name: 'deal-uuid-123', path: FOUND }];
    expect(classifyMoveDetection(matches)).toEqual({ outcome: 'moved', foundPath: FOUND });
  });

  it('multiple matches → ambiguous, naming every candidate', () => {
    const matches: DropboxFolderMatch[] = [
      { name: 'deal-uuid-123', path: FOUND },
      { name: 'deal-uuid-123', path: '/evolution strategy partners/deals/!hold/deal-uuid-123' },
    ];
    expect(classifyMoveDetection(matches)).toEqual({
      outcome: 'ambiguous',
      candidates: [FOUND, '/evolution strategy partners/deals/!hold/deal-uuid-123'],
    });
  });
});

describe('extractFolderMatches', () => {
  const wrap = (entry: any) => ({ metadata: { '.tag': 'metadata', metadata: entry } });

  it('keeps an exact-name folder and prefers path_lower', () => {
    const matches = [
      wrap({
        '.tag': 'folder',
        name: 'deal-uuid-123',
        path_lower: FOUND,
        path_display: '/Evolution Strategy Partners/Deals/!!DiPonio/deal-uuid-123',
      }),
    ];
    expect(extractFolderMatches(matches, 'deal-uuid-123')).toEqual([{ name: 'deal-uuid-123', path: FOUND }]);
  });

  it('matches the name case-insensitively', () => {
    const matches = [wrap({ '.tag': 'folder', name: 'DEAL-UUID-123', path_lower: FOUND })];
    expect(extractFolderMatches(matches, 'deal-uuid-123')).toHaveLength(1);
  });

  it('excludes files with the same name and folders with merely similar names', () => {
    const matches = [
      wrap({ '.tag': 'file', name: 'deal-uuid-123', path_lower: '/some/file/deal-uuid-123' }),
      wrap({ '.tag': 'folder', name: 'deal-uuid-123 (2)', path_lower: '/some/deal-uuid-123 (2)' }),
      wrap({ '.tag': 'folder', name: 'deal-uuid-1234', path_lower: '/some/deal-uuid-1234' }),
    ];
    expect(extractFolderMatches(matches, 'deal-uuid-123')).toEqual([]);
  });

  it('dedupes repeated hits for the same folder', () => {
    const entry = { '.tag': 'folder', name: 'deal-uuid-123', path_lower: FOUND };
    expect(extractFolderMatches([wrap(entry), wrap(entry)], 'deal-uuid-123')).toHaveLength(1);
  });

  it('tolerates an undefined match list', () => {
    expect(extractFolderMatches(undefined, 'deal-uuid-123')).toEqual([]);
  });
});

describe('detectMovedFolder', () => {
  it('one match → repoints the deal and writes a succeeded moved_detected audit row', async () => {
    const { supabase, state } = fakeSupabase();
    let searchedFor = '';
    const findFolders = async (name: string) => {
      searchedFor = name;
      return [{ name: 'deal-uuid-123', path: FOUND }];
    };

    const result = await detectMovedFolder({ supabase, findFolders }, DEAL, EXPECTED);

    expect(result).toEqual({ outcome: 'moved', foundPath: FOUND });
    expect(searchedFor).toBe('deal-uuid-123'); // searched by the UUID basename
    expect(state.updates).toEqual([{ table: 'deals', patch: { dropbox_path: FOUND } }]);
    expect(state.inserts).toEqual([
      {
        table: 'dropbox_move_jobs',
        row: {
          deal_id: DEAL.id,
          from_path: DEAL.dropbox_path,
          to_path: FOUND,
          final_path: FOUND,
          status: 'succeeded',
          source: 'reconcile',
          code: 'moved_detected',
          error: `Folder found at ${FOUND} after move; stored path updated`,
        },
      },
    ]);
  });

  it('zero matches → failed not_found row, record untouched', async () => {
    const { supabase, state } = fakeSupabase();
    const findFolders = async () => [];

    const result = await detectMovedFolder({ supabase, findFolders }, DEAL, EXPECTED);

    expect(result).toEqual({ outcome: 'not_found' });
    expect(state.updates).toEqual([]);
    expect(state.inserts).toEqual([
      {
        table: 'dropbox_move_jobs',
        row: {
          deal_id: DEAL.id,
          from_path: DEAL.dropbox_path,
          to_path: EXPECTED,
          status: 'failed',
          source: 'reconcile',
          code: 'not_found',
          error: 'folder not found at stored path and no folder named deal-uuid-123 exists in Dropbox',
        },
      },
    ]);
  });

  it('multiple matches → failed conflict row naming the candidates, record untouched', async () => {
    const { supabase, state } = fakeSupabase();
    const other = '/evolution strategy partners/deals/!hold/deal-uuid-123';
    const findFolders = async () => [
      { name: 'deal-uuid-123', path: FOUND },
      { name: 'deal-uuid-123', path: other },
    ];

    const result = await detectMovedFolder({ supabase, findFolders }, DEAL, EXPECTED);

    expect(result).toEqual({ outcome: 'ambiguous', candidates: [FOUND, other] });
    expect(state.updates).toEqual([]);
    expect(state.inserts).toHaveLength(1);
    const row = state.inserts[0].row;
    expect(row.status).toBe('failed');
    expect(row.code).toBe('conflict');
    expect(row.error).toContain(FOUND);
    expect(row.error).toContain(other);
    expect(row.error).toContain('stored path left unchanged');
  });

  it('a search hit at the already-known-missing stored path is index lag, not a move', async () => {
    const { supabase, state } = fakeSupabase();
    const findFolders = async () => [{ name: 'deal-uuid-123', path: DEAL.dropbox_path }];

    const result = await detectMovedFolder({ supabase, findFolders }, DEAL, EXPECTED);

    expect(result).toEqual({ outcome: 'not_found' });
    expect(state.updates).toEqual([]);
    expect(state.inserts[0].row.code).toBe('not_found');
  });
});
