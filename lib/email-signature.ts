/**
 * Deterministic email-signature extraction for the intake flow.
 *
 * Ken forwards emails whose ORIGINAL sender's signature block carries the
 * contact details Nexus wants (name, title, company, phone, email). The LLM
 * pass already mines signatures, but a regex extractor is deterministic and
 * free — it runs first and its results only ever FILL BLANKS (command values
 * and values already on a contact always win).
 *
 * Precision over recall throughout: a wrong company is worse than a missing
 * one, so every field is independently validated and anything unconfident
 * comes back null.
 */

export interface EmailSignature {
  name: string | null;
  title: string | null;
  company: string | null;
  /** Primary phone (unlabeled, or labeled Phone/Tel/Office/Direct). */
  phone: string | null;
  /** Separately labeled mobile/cell number, when present. */
  mobile: string | null;
  email: string | null;
  website: string | null;
}

export const EMPTY_SIGNATURE: EmailSignature = {
  name: null,
  title: null,
  company: null,
  phone: null,
  mobile: null,
  email: null,
  website: null,
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// US numbers: require a separator or parens so bare digit runs (years, ZIPs,
// revenue figures) don't match. Optional +1 and extension.
const PHONE_RE =
  /(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]\d{3}[\s.\-]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/i;
const MOBILE_LABEL_RE =
  /\b(?:mobile|cell|cellular)\b\s*[:.\-]?\s*(\+?[\d(][\d\s.\-()]*\d(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?)/i;
const PHONE_LABEL_RE =
  /\b(?:phone|tel|telephone|office|direct|work)\b\s*[:.\-]?\s*(\+?[\d(][\d\s.\-()]*\d(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?)/i;

const SIGNOFF_RE =
  /^(best regards|kind regards|warm regards|regards|thanks(?: you)?|thank you|best|sincerely|cheers|respectfully|gratefully|--+|sent from my \w+.*),?$/i;

const TITLE_WORDS =
  /\b(president|vice|vp|director|manager|partner|principal|founder|ceo|cfo|coo|cio|cto|chief|head|lead|associate|analyst|advisor|adviser|consultant|broker|officer|owner|executive|managing|senior|junior|counsel|attorney|agent|representative|specialist|coordinator|banker|operator)\b/i;

const COMPANY_HINT_RE =
  /\b(inc|llc|llp|lp|corp|corporation|company|group|partners|holdings|capital|ventures|advisors|advisory|consulting|associates|fund|funds|bank|trust|properties|realty|industries|solutions|technologies|systems|services|global|international|management|construction|builders|energy|health|financial)\b\.?/i;

/** Chunks boundaries between messages in a forwarded / quoted thread. */
const FORWARD_HEADER_RE = /^-{2,}\s*(original message|forwarded message)\s*-{2,}\s*$/im;
const REPLY_BOUNDARY_RE = /\nOn .{1,160} wrote:\s*$/m;
const HEADER_LINE_RE = /^(from|sent|to|cc|subject|date|reply-to):\s/i;

/**
 * Isolate the most recent original message from a forwarded body: the text
 * after the forward header block ("-----Original Message-----" + From:/Sent:/
 * To:/Subject: lines), cut at the next quoted message. With no forward
 * markers, the whole body up to the first "On ... wrote:" quote is used.
 */
function primaryMessageText(bodyText: string): string {
  let text = bodyText.replace(/\r\n/g, '\n');
  const fwd = FORWARD_HEADER_RE.exec(text);
  if (fwd) {
    text = text.slice(fwd.index + fwd[0].length);
    // Skip the header block that follows the separator (From:/Sent:/To:/
    // Subject: lines, ended by a blank line).
    const lines = text.split('\n');
    let i = 0;
    while (i < lines.length && HEADER_LINE_RE.test(lines[i])) i++;
    if (i < lines.length && lines[i].trim() === '') i++;
    text = lines.slice(i).join('\n');
  } else {
    // Bare "From:" header block (Outlook-style forward without dashes).
    const lines = text.split('\n');
    const fromIdx = lines.findIndex((l) => /^From:\s/i.test(l));
    if (fromIdx !== -1) {
      let i = fromIdx;
      while (i < lines.length && HEADER_LINE_RE.test(lines[i])) i++;
      if (i < lines.length && lines[i].trim() === '') i++;
      text = lines.slice(i).join('\n');
    }
  }
  const reply = REPLY_BOUNDARY_RE.exec(text);
  if (reply) text = text.slice(0, reply.index);
  const secondSep = FORWARD_HEADER_RE.exec(text);
  if (secondSep) text = text.slice(0, secondSep.index);
  return text;
}

/** Parse the forwarded message's own "From:" header (for sender matching). */
export function parseForwardedFrom(
  bodyText: string,
): { name: string | null; email: string | null } {
  const text = bodyText.replace(/\r\n/g, '\n');
  const m = /^From:\s*(?:"?([^"<\n]+?)"?\s*)?<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?/m.exec(text);
  if (!m) return { name: null, email: null };
  const name = m[1]?.trim();
  return { name: name && !name.includes('@') ? name : null, email: m[2].toLowerCase() };
}

function looksLikePersonName(token: string): boolean {
  const words = token.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (TITLE_WORDS.test(token) || COMPANY_HINT_RE.test(token)) return false;
  return words.every(
    (w) =>
      /^[A-Z][a-z'’.-]*$/.test(w) || // Jane, O'Brien, Smith-Jones
      /^[A-Z]\.$/.test(w) || // initial: J.
      /^[A-Z][A-Z'’.-]+$/.test(w), // ALL-CAPS surname: DOE
  );
}

function looksLikeAddress(line: string): boolean {
  return (
    /^\d+\s+\w/.test(line) || // "1200 Congress Ave"
    /\b(suite|ste|st\.|ave\.?|blvd|road|rd\.|drive|dr\.|floor)\b/i.test(line) ||
    /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(line) // "TX 78701"
  );
}

function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Find the signature zone: the lines after the last sign-off (or "--"
 * separator) near the end of the message. Without a sign-off, fall back to
 * the trailing block of short lines — but only if it contains a phone or
 * email, so ordinary closing paragraphs never qualify.
 */
function signatureZone(text: string): string[] | null {
  const lines = text.split('\n');
  // Locate the last sign-off / separator in the final 30 lines.
  let signoffIdx = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
    if (SIGNOFF_RE.test(lines[i].trim())) {
      signoffIdx = i;
      break;
    }
  }
  if (signoffIdx !== -1) {
    const zone: string[] = [];
    for (let i = signoffIdx + 1; i < lines.length && zone.length < 10; i++) {
      const line = lines[i];
      if (line.startsWith('>')) break;
      if (/confidential|intended solely|privileged/i.test(line)) break;
      zone.push(line);
    }
    return zone;
  }
  // No sign-off: trailing block of consecutive non-empty lines (<= 8).
  const tail: string[] = [];
  for (let i = lines.length - 1; i >= 0 && tail.length < 8; i--) {
    if (lines[i].trim() === '') {
      if (tail.length > 0) break;
      continue;
    }
    tail.unshift(lines[i]);
  }
  if (tail.length === 0) return null;
  const joined = tail.join('\n');
  if (!EMAIL_RE.test(joined) && !PHONE_RE.test(joined)) return null;
  return tail;
}

/** Extract signature fields from a forwarded email's plain-text body. */
export function extractEmailSignature(bodyText: string): EmailSignature {
  const result: EmailSignature = { ...EMPTY_SIGNATURE };
  if (!bodyText?.trim()) return result;

  const primary = primaryMessageText(bodyText);
  const zone = signatureZone(primary);
  if (!zone) return result;
  const zoneText = zone.join('\n');

  // ── Email / phones / website (regex fields) ──────────────────────────────
  const emailMatch = EMAIL_RE.exec(zoneText);
  if (emailMatch) result.email = emailMatch[0].toLowerCase();

  const mobileMatch = MOBILE_LABEL_RE.exec(zoneText);
  if (mobileMatch && PHONE_RE.test(mobileMatch[1])) {
    result.mobile = normalizePhone(mobileMatch[1]);
  }
  const phoneLabelMatch = PHONE_LABEL_RE.exec(zoneText);
  if (phoneLabelMatch && PHONE_RE.test(phoneLabelMatch[1])) {
    result.phone = normalizePhone(phoneLabelMatch[1]);
  }
  if (!result.phone) {
    // First unlabeled number that isn't the mobile we already took.
    const anyPhone = PHONE_RE.exec(zoneText.replace(result.mobile ?? ' ', ' '));
    if (anyPhone) result.phone = normalizePhone(anyPhone[0]);
  }
  if (!result.mobile && result.phone) {
    const second = PHONE_RE.exec(
      zoneText.replace(result.phone, ' ').replace(result.mobile ?? ' ', ' '),
    );
    if (second && /(mobile|cell)/i.test(zoneText)) result.mobile = normalizePhone(second[0]);
  }

  const emailDomain = result.email?.split('@')[1] ?? null;
  const webMatch =
    /(?:https?:\/\/)?(?:www\.)[A-Za-z0-9-]+\.[A-Za-z]{2,}(?:\/[^\s|]*)?/.exec(zoneText) ??
    /\b[A-Za-z0-9-]+\.(?:com|net|org|io|co|capital|fund|vc|biz)\b/.exec(zoneText);
  if (webMatch) {
    const site = webMatch[0].replace(/^https?:\/\//, '');
    if (!emailDomain || !site.toLowerCase().includes(emailDomain)) {
      result.website = site;
    } else if (/^www\./i.test(site) || webMatch[0].startsWith('http')) {
      result.website = site;
    }
  }

  // ── Name / title / company (structural fields) ───────────────────────────
  // Strip the regex fields and split what remains into ordered tokens
  // (lines, then "|" segments, then a "Title, Company" comma split).
  let cleaned = zoneText;
  if (result.email) cleaned = cleaned.split(result.email).join(' ');
  for (const p of [result.phone, result.mobile]) {
    if (p) cleaned = cleaned.split(p).join(' ');
  }
  if (result.website) cleaned = cleaned.split(result.website).join(' ');

  const tokens: string[] = [];
  for (const rawLine of cleaned.split('\n')) {
    const line = rawLine.replace(/^(phone|tel|telephone|office|direct|work|mobile|cell|cellular|e-?mail|web|website)\s*[:.\-]?\s*/i, '').trim();
    if (!line || looksLikeAddress(line)) continue;
    if (/confidential|intended solely|privileged/i.test(line)) continue;
    for (const part of line.split('|')) {
      const token = part.trim().replace(/,+$/, '');
      if (token) tokens.push(token);
    }
  }

  let idx = 0;
  if (tokens.length > 0 && looksLikePersonName(tokens[0])) {
    result.name = tokens[0];
    idx = 1;
  }
  for (; idx < tokens.length; idx++) {
    const token = tokens[idx];
    // "Managing Director, Acme Capital" on one token.
    const commaAt = token.indexOf(', ');
    if (commaAt !== -1 && result.title === null) {
      const left = token.slice(0, commaAt);
      const right = token.slice(commaAt + 2).trim();
      if (TITLE_WORDS.test(left) && right) {
        result.title = left;
        if (result.company === null && !looksLikeAddress(right)) result.company = right;
        continue;
      }
    }
    if (result.title === null && TITLE_WORDS.test(token) && !COMPANY_HINT_RE.test(token)) {
      result.title = token;
      continue;
    }
    if (result.company === null && !looksLikeAddress(token)) {
      // A company token should look like a proper noun phrase, not prose.
      if (/^[A-Z]/.test(token) && token.split(/\s+/).length <= 8) {
        result.company = token;
        continue;
      }
    }
    if (result.title === null && TITLE_WORDS.test(token)) {
      result.title = token;
    }
  }

  return result;
}

function normalizeNameForMatch(name: string): string {
  return name.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Merge signature fields into contact objects (in place), matching by email
 * or exact full name (case-insensitive). Only EMPTY fields on the contact are
 * filled — a value already present (from the command, the LLM, or a manual
 * entry) is never overwritten. The contacts table has a single phone column:
 * the signature's primary phone wins, its mobile fills only when there is no
 * primary number.
 */
export function enrichContactsFromSignature(
  contacts: Record<string, any>[],
  sig: EmailSignature,
): Record<string, any>[] {
  if (!sig.name && !sig.email) return contacts;
  const sigName = sig.name ? normalizeNameForMatch(sig.name) : null;
  const sigPhone = sig.phone ?? sig.mobile;
  for (const c of contacts) {
    const emailMatch =
      sig.email && c.email && String(c.email).toLowerCase() === sig.email;
    const nameMatch =
      sigName && c.name && normalizeNameForMatch(String(c.name)) === sigName;
    if (!emailMatch && !nameMatch) continue;
    if (!c.firm && sig.company) c.firm = sig.company;
    if (!c.title && sig.title) c.title = sig.title;
    if (!c.email && sig.email) c.email = sig.email;
    if (!c.phone && sigPhone) c.phone = sigPhone;
  }
  return contacts;
}
