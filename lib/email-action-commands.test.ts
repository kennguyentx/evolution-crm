import { describe, it, expect } from 'vitest'
import { parseActionCommands, describeActionCommand } from './email-action-commands'

describe('change/move <Deal> to <stage>', () => {
  it('parses change with a stage synonym', () => {
    const { commands, invalid } = parseActionCommands('change Project Anchor to pre-loi')
    expect(invalid).toHaveLength(0)
    expect(commands).toEqual([
      { type: 'change-stage', dealName: 'Project Anchor', stage: 'Pre-LOI', dealType: null, raw: 'change Project Anchor to pre-loi' },
    ])
  })

  it('parses move with a multi-word pass stage', () => {
    const { commands } = parseActionCommands('move Project Anchor to pass post-loi')
    expect(commands[0]).toMatchObject({ type: 'change-stage', stage: 'Pass (Post-LOI)' })
  })

  it('applies the closed + add-on rule and captures the type', () => {
    const { commands } = parseActionCommands('change Acme Services to closed as add-on')
    expect(commands[0]).toMatchObject({ type: 'change-stage', stage: 'Closed (Add-On)', dealType: 'add-on' })
  })

  it('tolerates a polite prefix and a trailing thanks', () => {
    const { commands } = parseActionCommands('please change Project Anchor to hold, thanks')
    expect(commands[0]).toMatchObject({ type: 'change-stage', stage: 'Hold', dealName: 'Project Anchor' })
  })

  it('keeps a deal name that itself contains " to "', () => {
    const { commands } = parseActionCommands('change Door to Door Services to teaser')
    expect(commands[0]).toMatchObject({ dealName: 'Door to Door Services', stage: 'Teaser' })
  })

  it('parses the dead synonym', () => {
    const { commands } = parseActionCommands('move Project Anchor to dead')
    expect(commands[0]).toMatchObject({ stage: 'Dead' })
  })

  it('a truncated change is a near-miss, not prose', () => {
    const { commands, invalid } = parseActionCommands('change Project Anchor')
    expect(commands).toHaveLength(0)
    expect(invalid).toHaveLength(1)
  })

  it('prose starting with "change" is ignored entirely', () => {
    const { commands, invalid } = parseActionCommands('change of plans, see the attached deck when you can')
    expect(commands).toHaveLength(0)
    expect(invalid).toHaveLength(0)
  })
})

describe('update <Deal>: fields', () => {
  it('parses type, portco, sector and geography pairs', () => {
    const { commands } = parseActionCommands('update Project Anchor: type add-on, portco DiPonio, sector Landscaping, geography Texas')
    expect(commands[0]).toMatchObject({
      type: 'update-deal',
      dealName: 'Project Anchor',
      fields: { deal_type: 'add-on', parent_portco: 'DiPonio', sector: 'Landscaping', geography: 'Texas' },
    })
  })

  it('rejects an unknown deal type as a near-miss', () => {
    const { commands, invalid } = parseActionCommands('update Project Anchor: type bogus')
    expect(commands).toHaveLength(0)
    expect(invalid[0].reason).toMatch(/unknown deal type/)
  })

  it('rejects an unknown field as a near-miss', () => {
    const { commands, invalid } = parseActionCommands('update Project Anchor: mood happy')
    expect(commands).toHaveLength(0)
    expect(invalid[0].reason).toMatch(/unknown field/)
  })
})

describe('update contact <Name>: fields', () => {
  it('parses phone/title/company/email, company mapping to firm', () => {
    const { commands } = parseActionCommands('update contact Jane Doe: phone 214-555-0100, title Partner, company Acme Corp, email jane@acme.com')
    expect(commands[0]).toMatchObject({
      type: 'update-contact',
      contactName: 'Jane Doe',
      fields: { phone: '214-555-0100', title: 'Partner', firm: 'Acme Corp', email: 'jane@acme.com' },
    })
  })

  it('supports a single field', () => {
    const { commands } = parseActionCommands('update contact Jane Doe: phone 214-555-0100')
    expect(commands[0]).toMatchObject({ fields: { phone: '214-555-0100' } })
  })

  it('an "update" line that is a deal update is not read as a contact update', () => {
    const { commands } = parseActionCommands('update Project Anchor: type platform')
    expect(commands[0]).toMatchObject({ type: 'update-deal' })
  })
})

describe('file under / move file', () => {
  it('parses file under', () => {
    const { commands } = parseActionCommands('file under Project Anchor')
    expect(commands[0]).toMatchObject({ type: 'file-under', dealName: 'Project Anchor' })
  })

  it('parses move file with a spaced filename', () => {
    const { commands } = parseActionCommands('move file Project Anchor CIM.pdf to Project Anchor')
    expect(commands[0]).toMatchObject({ type: 'move-file', fileName: 'Project Anchor CIM.pdf', dealName: 'Project Anchor' })
  })

  it('a filename containing " to " splits at the last " to "', () => {
    const { commands } = parseActionCommands('move file Report to Board.pdf to Project Anchor')
    expect(commands[0]).toMatchObject({ fileName: 'Report to Board.pdf', dealName: 'Project Anchor' })
  })

  it('"move file" is never read as a stage change', () => {
    const { commands } = parseActionCommands('move file teaser.pdf to Project Anchor')
    expect(commands).toHaveLength(1)
    expect(commands[0].type).toBe('move-file')
  })
})

describe('multi-command text', () => {
  it('parses one command per line and ignores prose lines', () => {
    const text = ['Hi team,', 'change Project Anchor to reviewing', 'update contact Jane Doe: phone 214-555-0100', 'Thanks!'].join('\n')
    const { commands, invalid } = parseActionCommands(text)
    expect(commands).toHaveLength(2)
    expect(invalid).toHaveLength(0)
  })

  it('describeActionCommand renders each command for the digest', () => {
    const { commands } = parseActionCommands('change Project Anchor to pre-loi')
    expect(describeActionCommand(commands[0])).toBe('change "Project Anchor" to Pre-LOI')
  })
})
