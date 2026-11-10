// lib/dropbox.test.ts
// Stage → Dropbox folder mapping (expectedDropboxFolder / …ByName).
// The folder PARENT encodes the stage bucket: Pass stages — and the Dead
// stage, which files with them — under Deals/!Passed Deals; Closed stages
// under Portfolio Co's; Hold under Deals/!Hold; live stages directly under
// Deals. The leaf is the deal ID (name-based only in the legacy helper).

import { describe, expect, it } from 'vitest'
import { expectedDropboxFolder, expectedDropboxFolderByName } from './dropbox'

const ID = '3fd4f4e0-1f0d-44cc-839b-187e5f1e8b5c'

describe('expectedDropboxFolder — stage buckets', () => {
  it('files the Dead stage under !Passed Deals, like the Pass stages', () => {
    expect(expectedDropboxFolder(ID, 'Dead')).toBe(
      `/Evolution Strategy Partners/Deals/!Passed Deals/${ID}`,
    )
    for (const s of ['Pass (DOA)', 'Pass (Pre-LOI)', 'Pass (Post-LOI)']) {
      expect(expectedDropboxFolder(ID, s)).toBe(
        `/Evolution Strategy Partners/Deals/!Passed Deals/${ID}`,
      )
    }
  })

  it('files Closed stages under Portfolio Co\'s', () => {
    for (const s of ['Closed (Platform)', 'Closed (Add-On)']) {
      expect(expectedDropboxFolder(ID, s)).toBe(
        `/Evolution Strategy Partners/Portfolio Co's/${ID}`,
      )
    }
  })

  it('files Hold under !Hold and live stages under Deals', () => {
    expect(expectedDropboxFolder(ID, 'Hold')).toBe(
      `/Evolution Strategy Partners/Deals/!Hold/${ID}`,
    )
    for (const s of ['Teaser', 'Reviewing', 'Pre-LOI', 'LOI Submitted', 'Exclusivity']) {
      expect(expectedDropboxFolder(ID, s)).toBe(
        `/Evolution Strategy Partners/Deals/${ID}`,
      )
    }
  })

  it('applies the same bucket to the legacy name-based path', () => {
    expect(expectedDropboxFolderByName('Acme Corp', 'Dead')).toBe(
      '/Evolution Strategy Partners/Deals/!Passed Deals/Acme Corp',
    )
    expect(expectedDropboxFolderByName('Acme Corp', 'Teaser')).toBe(
      '/Evolution Strategy Partners/Deals/Acme Corp',
    )
  })
})
