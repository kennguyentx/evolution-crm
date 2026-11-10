import { describe, expect, it } from 'vitest';
import { parseEmailCommand } from './email-commands';

describe('parseEmailCommand — log-deal', () => {
  it('parses the canonical command', () => {
    const r = parseEmailCommand('log as teaser as add-on for DiPonio');
    expect(r.kind).toBe('log-deal');
    expect(r.stage).toBe('Teaser');
    expect(r.deal_type).toBe('add-on');
    expect(r.parent_portco).toBe('DiPonio');
    expect(r.noteText).toBe('');
  });

  it('parses stage + portco with no deal type', () => {
    const r = parseEmailCommand('Log as teaser for Amped');
    expect(r.kind).toBe('log-deal');
    expect(r.stage).toBe('Teaser');
    expect(r.deal_type).toBeNull();
    expect(r.parent_portco).toBe('Amped');
  });

  it('parses pre-loi + platform', () => {
    const r = parseEmailCommand('log as pre-loi as platform');
    expect(r.kind).toBe('log-deal');
    expect(r.stage).toBe('Pre-LOI');
    expect(r.deal_type).toBe('platform');
    expect(r.parent_portco).toBeNull();
  });

  it('parses pass / hold / LOI submitted', () => {
    expect(parseEmailCommand('log as pass').stage).toBe('Pass (DOA)');
    expect(parseEmailCommand('log as hold').stage).toBe('Hold');
    expect(parseEmailCommand('log as LOI submitted').stage).toBe('LOI Submitted');
    expect(parseEmailCommand('log as pass pre-loi').stage).toBe('Pass (Pre-LOI)');
    expect(parseEmailCommand('log as pass post-loi').stage).toBe('Pass (Post-LOI)');
    expect(parseEmailCommand('log as park').stage).toBe('Hold');
    expect(parseEmailCommand('log as reviewing').stage).toBe('Reviewing');
    expect(parseEmailCommand('log as exclusivity').stage).toBe('Exclusivity');
    expect(parseEmailCommand('log as loi').stage).toBe('LOI Submitted');
  });

  it('closed + add-on is Closed (Add-On); closed alone is Closed (Platform)', () => {
    const r = parseEmailCommand('log as closed as add-on for Fain');
    expect(r.kind).toBe('log-deal');
    expect(r.stage).toBe('Closed (Add-On)');
    expect(r.deal_type).toBe('add-on');
    expect(r.parent_portco).toBe('Fain');
    expect(parseEmailCommand('log as closed').stage).toBe('Closed (Platform)');
    expect(parseEmailCommand('log as closed as platform').stage).toBe(
      'Closed (Platform)',
    );
  });

  it('accepts "log <stage>" without the first "as"', () => {
    const r = parseEmailCommand('log teaser as add-on for DiPonio');
    expect(r.kind).toBe('log-deal');
    expect(r.stage).toBe('Teaser');
    expect(r.deal_type).toBe('add-on');
    expect(r.parent_portco).toBe('DiPonio');
  });

  it('accepts deal-type synonyms', () => {
    expect(parseEmailCommand('log as teaser as bolt-on for DiPonio').deal_type).toBe(
      'add-on',
    );
    expect(parseEmailCommand('log as teaser as addon for DiPonio').deal_type).toBe(
      'add-on',
    );
    expect(parseEmailCommand('log as teaser as add on for DiPonio').deal_type).toBe(
      'add-on',
    );
    expect(parseEmailCommand('log as teaser as recap').deal_type).toBe('recap');
    expect(parseEmailCommand('log as teaser as growth').deal_type).toBe('growth');
  });

  it('is case- and whitespace-tolerant', () => {
    const r = parseEmailCommand('  LOG AS TEASER AS ADD-ON FOR DiPonio  ');
    expect(r.kind).toBe('log-deal');
    expect(r.stage).toBe('Teaser');
    expect(r.deal_type).toBe('add-on');
    expect(r.parent_portco).toBe('DiPonio');
    expect(r.noteText).toBe('');
  });

  it('keeps trailing free text in noteText', () => {
    const r = parseEmailCommand(
      'log as teaser as add-on for DiPonio — see attached deck',
    );
    expect(r.kind).toBe('log-deal');
    expect(r.parent_portco).toBe('DiPonio');
    expect(r.noteText).toContain('see attached deck');
  });

  it('does not treat "add-on" as a contact command', () => {
    const r = parseEmailCommand('log as teaser as add-on for DiPonio');
    expect(r.kind).toBe('log-deal');
    expect(r.contactNames).toEqual([]);
  });
});

describe('parseEmailCommand — log-contact', () => {
  it('parses "log new contact <name>"', () => {
    const r = parseEmailCommand('log new contact Jane Doe');
    expect(r.kind).toBe('log-contact');
    expect(r.contactNames).toEqual(['Jane Doe']);
  });

  it('parses "log new contact" with no name (caller falls back to the email)', () => {
    const r = parseEmailCommand('log new contact');
    expect(r.kind).toBe('log-contact');
    expect(r.contactNames).toEqual([]);
  });

  it('parses "add <name> to contacts"', () => {
    const r = parseEmailCommand('add Nick Dreps to contacts');
    expect(r.kind).toBe('log-contact');
    expect(r.contactNames).toEqual(['Nick Dreps']);
  });

  it('splits multiple names on commas / and / &', () => {
    expect(
      parseEmailCommand('log new contact Jane Doe and John Smith').contactNames,
    ).toEqual(['Jane Doe', 'John Smith']);
    expect(
      parseEmailCommand('add Nick Dreps and Jane Doe to contacts').contactNames,
    ).toEqual(['Nick Dreps', 'Jane Doe']);
    expect(
      parseEmailCommand('add Nick Dreps, Jane Doe to contacts').contactNames,
    ).toEqual(['Nick Dreps', 'Jane Doe']);
  });

  it('does not let "log new contact" fall through to log-deal', () => {
    expect(parseEmailCommand('log new contact Jane Doe').kind).toBe('log-contact');
  });
});

describe('parseEmailCommand — note', () => {
  it('parses "note for <contact>: <text>"', () => {
    const r = parseEmailCommand(
      'note for John Smith: had a great call, open to co-invest',
    );
    expect(r.kind).toBe('note');
    expect(r.contactName).toBe('John Smith');
    expect(r.noteText).toContain('had a great call');
    expect(r.noteText).toBe('had a great call, open to co-invest');
  });

  it('parses "note for <contact>" with no body', () => {
    const r = parseEmailCommand('note for John Smith');
    expect(r.kind).toBe('note');
    expect(r.contactName).toBe('John Smith');
    expect(r.noteText).toBe('');
  });
});

describe('parseEmailCommand — ask', () => {
  it('parses "ask: ..." at the start', () => {
    const r = parseEmailCommand('ask: should we pass on this one?');
    expect(r.kind).toBe('ask');
    expect(r.noteText).toBe('should we pass on this one?');
  });

  it('parses "q: ..." at the start', () => {
    const r = parseEmailCommand('q: is this a platform or an add-on?');
    expect(r.kind).toBe('ask');
    expect(r.noteText).toBe('is this a platform or an add-on?');
  });
});

describe('parseEmailCommand — none', () => {
  it('returns none for plain prose', () => {
    const r = parseEmailCommand('please review this teaser');
    expect(r.kind).toBe('none');
    expect(r.noteText).toBe('please review this teaser');
    expect(r.stage).toBeNull();
    expect(r.deal_type).toBeNull();
    expect(r.parent_portco).toBeNull();
  });

  it('returns none for empty input', () => {
    const r = parseEmailCommand('');
    expect(r.kind).toBe('none');
    expect(r.noteText).toBe('');
  });

  it('returns none for "Pass on this one" with no "log"', () => {
    expect(parseEmailCommand('Pass on this one').kind).toBe('none');
  });
});
