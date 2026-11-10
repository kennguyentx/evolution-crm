import { describe, expect, it } from 'vitest';
import {
  EMPTY_SIGNATURE,
  enrichContactsFromSignature,
  extractEmailSignature,
  parseForwardedFrom,
  type EmailSignature,
} from './email-signature';

describe('extractEmailSignature — classic corporate signature', () => {
  const body = [
    'Hi team,',
    '',
    'Sharing the updated model for the project. Let me know if you have questions.',
    '',
    'Best regards,',
    'Jane Doe',
    'Managing Director | Acme Capital Partners',
    'jane.doe@acmecapital.com | (512) 555-0100',
    'www.acmecapital.com',
  ].join('\n');

  it('extracts every field', () => {
    const sig = extractEmailSignature(body);
    expect(sig.name).toBe('Jane Doe');
    expect(sig.title).toBe('Managing Director');
    expect(sig.company).toBe('Acme Capital Partners');
    expect(sig.email).toBe('jane.doe@acmecapital.com');
    expect(sig.phone).toBe('(512) 555-0100');
    expect(sig.mobile).toBeNull();
    expect(sig.website).toBe('www.acmecapital.com');
  });
});

describe('extractEmailSignature — signature inside a forwarded chain', () => {
  const body = [
    'log new contact',
    '',
    '---------- Forwarded message ---------',
    'From: Marcus Webb <marcus.webb@summitadvisors.com>',
    'Date: Mon, Nov 3, 2026 at 9:14 AM',
    'Subject: Project Falcon teaser',
    'To: Ken Nguyen <ken@evolutionstrategy.com>',
    '',
    'Ken —',
    '',
    'Passing along the Falcon teaser we discussed. Happy to walk you through it.',
    '',
    'Thanks,',
    'Marcus Webb',
    'Vice President | Summit Advisors LLC',
    'Direct: (214) 555-0187 | Mobile: (214) 555-0199',
    'marcus.webb@summitadvisors.com',
    '',
    'On Fri, Oct 31, 2025 at 3:02 PM Dana Lee <dana@oldfirm.com> wrote:',
    '> Earlier thread below.',
    '> Dana Lee',
    '> Analyst | Old Firm',
    '> dana@oldfirm.com',
  ].join('\n');

  it("extracts the original sender's signature, not the quoted one", () => {
    const sig = extractEmailSignature(body);
    expect(sig.name).toBe('Marcus Webb');
    expect(sig.title).toBe('Vice President');
    expect(sig.company).toBe('Summit Advisors LLC');
    expect(sig.email).toBe('marcus.webb@summitadvisors.com');
    expect(sig.phone).toBe('(214) 555-0187');
    expect(sig.mobile).toBe('(214) 555-0199');
  });

  it('parses the forwarded From header for sender matching', () => {
    expect(parseForwardedFrom(body)).toEqual({
      name: 'Marcus Webb',
      email: 'marcus.webb@summitadvisors.com',
    });
  });
});

describe('extractEmailSignature — minimal signature', () => {
  it('extracts name + phone with everything else null', () => {
    const body = ['Sounds good — sending the deck shortly.', '', 'John Park', '(713) 555-0143'].join('\n');
    const sig = extractEmailSignature(body);
    expect(sig.name).toBe('John Park');
    expect(sig.phone).toBe('(713) 555-0143');
    expect(sig.title).toBeNull();
    expect(sig.company).toBeNull();
    expect(sig.email).toBeNull();
    expect(sig.mobile).toBeNull();
    expect(sig.website).toBeNull();
  });
});

describe('extractEmailSignature — no signature', () => {
  it('returns all nulls for an ordinary email', () => {
    const body = [
      'Hi Ken,',
      '',
      'Can you send me the latest pipeline summary when you get a chance? Also flagging that the lender call moved to Thursday afternoon.',
      '',
      'Thanks so much,',
      'Alex',
    ].join('\n');
    expect(extractEmailSignature(body)).toEqual(EMPTY_SIGNATURE);
  });

  it('returns all nulls for empty input', () => {
    expect(extractEmailSignature('')).toEqual(EMPTY_SIGNATURE);
  });
});

describe('enrichContactsFromSignature', () => {
  const sig: EmailSignature = {
    name: 'Jane Doe',
    title: 'Managing Director',
    company: 'Acme Capital Partners',
    phone: '(512) 555-0100',
    mobile: '(512) 555-0111',
    email: 'jane.doe@acmecapital.com',
    website: 'www.acmecapital.com',
  };

  it('fills blanks on a name-matched contact', () => {
    const contacts = [{ name: 'Jane Doe', email: null, firm: null, title: null, phone: null }];
    enrichContactsFromSignature(contacts, sig);
    expect(contacts[0]).toEqual({
      name: 'Jane Doe',
      email: 'jane.doe@acmecapital.com',
      firm: 'Acme Capital Partners',
      title: 'Managing Director',
      phone: '(512) 555-0100',
    });
  });

  it('matches by email even when the name differs', () => {
    const contacts = [{ name: 'J. Doe', email: 'jane.doe@acmecapital.com', firm: null, title: null, phone: null }];
    enrichContactsFromSignature(contacts, sig);
    expect(contacts[0].firm).toBe('Acme Capital Partners');
    expect(contacts[0].title).toBe('Managing Director');
  });

  it('never overwrites non-empty fields', () => {
    const contacts = [{
      name: 'Jane Doe',
      email: 'jane@other.com',
      firm: 'Existing Co',
      title: 'Partner',
      phone: '111-222-3333',
    }];
    enrichContactsFromSignature(contacts, sig);
    expect(contacts[0]).toEqual({
      name: 'Jane Doe',
      email: 'jane@other.com',
      firm: 'Existing Co',
      title: 'Partner',
      phone: '111-222-3333',
    });
  });

  it('leaves unmatched contacts untouched', () => {
    const contacts = [{ name: 'Someone Else', email: null, firm: null, title: null, phone: null }];
    enrichContactsFromSignature(contacts, sig);
    expect(contacts[0].firm).toBeNull();
    expect(contacts[0].phone).toBeNull();
  });

  it('uses the mobile when the signature has no primary phone', () => {
    const contacts = [{ name: 'Jane Doe', email: null, firm: null, title: null, phone: null }];
    enrichContactsFromSignature(contacts, { ...sig, phone: null });
    expect(contacts[0].phone).toBe('(512) 555-0111');
  });
});
