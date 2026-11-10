/**
 * Deterministic command parser for the email intake flow.
 *
 * Ken forwards deal emails with a short instruction line, e.g.
 *   "log as teaser as add-on for DiPonio"
 * This parser runs BEFORE the LLM call. Slots it matches win; the LLM
 * only fills whatever is left (stage / deal-type / parent portco /
 * deal name / contact names).
 *
 * Matching is case-insensitive and tolerant of extra whitespace. Commands
 * may appear anywhere in the note; within a kind, the first match wins.
 * Priority across kinds: 'ask' > 'note' > 'log-contact' > 'log-deal' > 'none'.
 *
 * `deal_name` is always null here: the command grammar has no way to name
 * a deal, so the caller / LLM fills it from the email subject or attachment.
 *
 * Contact commands can carry a company per person:
 *   "log new contact Jane Doe at Acme Corp"                  (one person)
 *   "log new contact Jane Doe, John Smith at Acme Corp"      (shared company)
 *   "log new contact Jane Doe at Acme, John Smith at Beta"   (per-person)
 * The company lands in `contacts[].company`; `contactNames` stays the plain
 * name list for existing consumers.
 */

/** One person named by a contact command, with their company if given. */
export interface ParsedContact {
  name: string;
  /** Company from "at <Company>", or null when the command didn't give one. */
  company: string | null;
}

/** Exact stage enum strings used by the CRM. */
export type Stage =
  | 'Teaser'
  | 'Reviewing'
  | 'Pre-LOI'
  | 'LOI Submitted'
  | 'Exclusivity'
  | 'Pass (DOA)'
  | 'Pass (Pre-LOI)'
  | 'Pass (Post-LOI)'
  | 'Hold'
  | 'Closed (Platform)'
  | 'Closed (Add-On)';

export type DealType = 'platform' | 'add-on' | 'recap' | 'growth';

export type CommandKind = 'log-deal' | 'log-contact' | 'note' | 'ask' | 'none';

export interface ParsedEmailCommand {
  kind: CommandKind;
  /** Exact stage enum string, e.g. 'Teaser', 'Pre-LOI', 'Pass (DOA)'. */
  stage: Stage | null;
  deal_type: DealType | null;
  parent_portco: string | null;
  /** Always null from this parser; filled by the caller / LLM. */
  deal_name: string | null;
  /** For kind 'note'. */
  contactName: string | null;
  /** For kind 'log-contact': plain names (kept for existing consumers). */
  contactNames: string[];
  /** For kind 'log-contact': names with per-person company, same order. */
  contacts: ParsedContact[];
  /** The input with the matched command portion removed, trimmed. */
  noteText: string;
}

/**
 * Stage synonyms, keyed by lowercase phrase. Keys are matched longest-first
 * so "pass pre-loi" wins over "pass" and "loi submitted" wins over "loi".
 * 'closed' maps to 'Closed (Platform)' unless the deal type is add-on,
 * in which case the parser returns 'Closed (Add-On)'.
 */
export const STAGE_SYNONYMS: Readonly<Record<string, Stage>> = {
  'pass post-loi': 'Pass (Post-LOI)',
  'pass postloi': 'Pass (Post-LOI)',
  'pass pre-loi': 'Pass (Pre-LOI)',
  'pass preloi': 'Pass (Pre-LOI)',
  'loi submitted': 'LOI Submitted',
  exclusivity: 'Exclusivity',
  reviewing: 'Reviewing',
  'pre-loi': 'Pre-LOI',
  preloi: 'Pre-LOI',
  closed: 'Closed (Platform)',
  teaser: 'Teaser',
  hold: 'Hold',
  park: 'Hold',
  pass: 'Pass (DOA)',
  loi: 'LOI Submitted',
};

/** Deal-type synonyms, keyed by lowercase phrase. */
export const DEAL_TYPE_SYNONYMS: Readonly<Record<string, DealType>> = {
  platform: 'platform',
  'bolt-on': 'add-on',
  'add-on': 'add-on',
  bolton: 'add-on',
  'add on': 'add-on',
  growth: 'growth',
  addon: 'add-on',
  recap: 'recap',
};

/** Lowercase words that end a captured name (portco / contact). */
const NAME_STOP_WORDS = new Set([
  'and', 'or', 'for', 'from', 'at', 'with', 'in', 'on', 'to', 'of', 'the',
  'a', 'an', 'is', 'was', 'were', 'has', 'had', 'works', 'work', 'met',
  'please', 'see', 'attached', 'note', 'email', 'called', 'call', 'per',
  'via', 'as', 'by', 'this', 'that', 'he', 'she', 'they', 'we', 'you', 'me',
  'him', 'her', 'us', 'them', 'his', 'our', 'your', 'their', 'also', 'just',
  'not', 'if', 'but', 'so', 'then', 'than', 'when', 'where', 'about',
  'after', 'before', 'thanks', 'hi', 'hello',
]);

/** Words that may never start a bare "add <Name>" contact command. */
const BARE_ADD_GUARD_WORDS = new Set([
  'on', 'as', 'to', 'new', 'a', 'an', 'the', 'for', 'and', 'or', 'contacts',
  'contact',
]);

const MAX_NAME_WORDS = 4;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a longest-first alternation from synonym-table keys. */
function alternation(keys: readonly string[]): string {
  return [...keys]
    .sort((a, b) => b.length - a.length)
    .map((k) => escapeRegExp(k).replace(/ /g, '\\s+'))
    .join('|');
}

const STAGE_PATTERN = alternation(Object.keys(STAGE_SYNONYMS));
const DEAL_TYPE_PATTERN = alternation(Object.keys(DEAL_TYPE_SYNONYMS));

const LOG_DEAL_RE = new RegExp(`\\blog\\s+(?:as\\s+)?(${STAGE_PATTERN})\\b`, 'i');
const DEAL_TYPE_RE = new RegExp(`^\\s*,?\\s*(?:as\\s+)?(${DEAL_TYPE_PATTERN})\\b`, 'i');
const FOR_PORTCO_RE = /^\s*,?\s*for\s+/i;
const ASK_RE = /^\s*(?:ask|q)\s*:/im;
const NOTE_FOR_RE = /\bnote\s+for\s+/i;
const LOG_NEW_CONTACT_RE = /\blog\s+new\s+contacts?\b/i;
const ADD_TO_CONTACTS_RE = /\badd\s+(.+?)\s+(?:to|as)\s+contacts\b/i;
const LOG_AS_CONTACTS_RE = /\blog\s+(.+?)\s+as\s+contacts\b/i;
const BARE_ADD_RE = /\badd\s+/i;
const NAME_SPLIT_RE = /\s*,\s*|\s+and\s+|\s*&\s*/gi;
const WORD_RE = new RegExp("[A-Za-z][A-Za-z.'&-]*", 'g');
// Words kept with a trailing period (e.g. "Acme Inc."), everything else
// loses a sentence-ending period ("for DiPonio." -> "DiPonio").
const KEEP_PERIOD_WORDS = new Set(['inc.', 'ltd.', 'co.', 'corp.', 'bros.']);

function stripTrailingPeriod(word: string): string {
  if (word.endsWith('.') && !KEEP_PERIOD_WORDS.has(word.toLowerCase())) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Capture up to `maxWords` name words from the start of `text`.
 * Stops at a lowercase stop word, at a `,`/`:`/`;` separator between words,
 * or at end of input. Returns the joined name and the index just past the
 * last captured word (so the caller can slice the matched span exactly).
 */
function captureNameWords(
  text: string,
  maxWords: number = MAX_NAME_WORDS,
): { name: string | null; end: number } {
  const words: string[] = [];
  let end = 0;
  let prevWordEnd = -1;
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) !== null) {
    if (words.length >= maxWords) break;
    // A comma / colon / semicolon between words ends the name
    // ("John Smith, CEO of Amped" -> "John Smith").
    if (prevWordEnd >= 0 && /[,;:]/.test(text.slice(prevWordEnd, m.index))) break;
    const word = m[0];
    if (word === word.toLowerCase() && NAME_STOP_WORDS.has(word)) break;
    words.push(stripTrailingPeriod(word));
    end = m.index + word.length;
    prevWordEnd = end;
  }
  return { name: words.length > 0 ? words.join(' ') : null, end };
}

const EMPTY: Omit<ParsedEmailCommand, 'kind' | 'noteText'> = {
  stage: null,
  deal_type: null,
  parent_portco: null,
  deal_name: null,
  contactName: null,
  contactNames: [],
  contacts: [],
};

function noneResult(note: string): ParsedEmailCommand {
  return { kind: 'none', ...EMPTY, contactNames: [], noteText: note.trim() };
}

function removeSpan(note: string, start: number, end: number): string {
  // Also drop a separator left behind when the command ended mid-sentence
  // ("log new contact Jane Doe, she works at Amped" -> "she works at Amped").
  return (note.slice(0, start) + note.slice(end)).trim().replace(/^[,;]\s*/, '');
}

/** Corporate words that may appear lowercase inside a company name. */
const COMPANY_SUFFIX_WORDS = new Set([
  'inc', 'inc.', 'llc', 'ltd', 'ltd.', 'co', 'co.', 'corp', 'corp.', 'llp',
  'lp', 'company', 'group', 'partners', 'holdings', 'capital', 'ventures',
  'associates', 'advisors', 'consulting',
]);

const MAX_COMPANY_WORDS = 5;

/**
 * Capture a company name from the start of `text` (the part after " at ").
 * Capitalized words and known corporate suffixes are kept; the capture stops
 * at a lowercase non-suffix word or a ,/;/: separator — that's where trailing
 * sentence text begins ("at Amped, she runs sourcing" -> "Amped").
 */
function captureCompanyWords(text: string): { company: string | null; end: number } {
  const words: string[] = [];
  let end = 0;
  let prevWordEnd = -1;
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) !== null) {
    if (words.length >= MAX_COMPANY_WORDS) break;
    if (prevWordEnd >= 0 && /[,;:]/.test(text.slice(prevWordEnd, m.index))) break;
    const raw = m[0];
    const lower = raw.toLowerCase();
    const isCapitalized = raw[0] === raw[0].toUpperCase();
    if (!isCapitalized && !COMPANY_SUFFIX_WORDS.has(lower)) break;
    words.push(stripTrailingPeriod(raw));
    end = m.index + raw.length;
    prevWordEnd = end;
  }
  return { company: words.length > 0 ? words.join(' ') : null, end };
}

/**
 * Split a names fragment ("Jane Doe and John Smith, Nick Dreps") into
 * contacts, picking up an optional "at <Company>" per person.
 *
 * Company attachment rules:
 * - "Jane Doe at Acme, John Smith at Beta" — each person keeps their own.
 * - "Jane Doe, John Smith at Acme" — a company on the LAST person, when it's
 *   the only one given, is shared by everyone ("... , both at Acme" and a
 *   trailing "at Acme" clause behave the same way).
 * - "Jane Doe at Acme, John Smith" — no sharing: Acme stays Jane's.
 */
function splitNamesWithCompanies(
  fragment: string,
): { contacts: ParsedContact[]; end: number } {
  const contacts: ParsedContact[] = [];
  let end = 0;
  let sharedCompany: string | null = null;
  // Walk the fragment keeping each segment's offset so `end` lands exactly
  // after the last consumed token (trailing sentence text stays in noteText).
  const segments: { text: string; start: number }[] = [];
  let last = 0;
  NAME_SPLIT_RE.lastIndex = 0;
  let sep: RegExpExecArray | null;
  while ((sep = NAME_SPLIT_RE.exec(fragment)) !== null) {
    segments.push({ text: fragment.slice(last, sep.index), start: last });
    last = sep.index + sep[0].length;
  }
  segments.push({ text: fragment.slice(last), start: last });

  segments.forEach((seg, i) => {
    const text = seg.text.trim();
    if (!text) return;
    const leadOffset = seg.start + (seg.text.length - seg.text.trimStart().length);

    // A segment that is ONLY a company clause ("both at Amped", "at Amped")
    // sets the shared company and names nobody new.
    const clause = /^(?:both\s+|all\s+)?at\s+/i.exec(text);
    if (clause && contacts.length > 0) {
      const { company, end: cEnd } = captureCompanyWords(text.slice(clause[0].length));
      if (company) {
        sharedCompany = company;
        end = Math.max(end, leadOffset + clause[0].length + cEnd);
      }
      return;
    }

    const isFirst = i === 0;
    // Later segments must look like a person name (capitalized first word);
    // otherwise they are trailing sentence text.
    if (!isFirst && !/^[A-Z]/.test(text)) return;

    // Optional " at <Company>" inside this segment.
    const atMatch = /\s+at\s+/i.exec(text);
    const namePart = atMatch ? text.slice(0, atMatch.index) : text;
    const { name, end: nameEnd } = captureNameWords(namePart);
    if (!name) return;
    let company: string | null = null;
    let consumed = nameEnd;
    if (atMatch) {
      const compText = text.slice(atMatch.index + atMatch[0].length);
      const cc = captureCompanyWords(compText);
      if (cc.company) {
        company = cc.company;
        consumed = atMatch.index + atMatch[0].length + cc.end;
      }
    }
    contacts.push({ name, company });
    end = leadOffset + consumed;
  });

  // Trailing-company sharing: "Jane Doe, John Smith at Acme" — the last
  // person's company is the only one given, so it covers the whole list.
  if (!sharedCompany && contacts.length > 1) {
    const withCompany = contacts.filter((c) => c.company);
    const lastContact = contacts[contacts.length - 1];
    if (withCompany.length === 1 && lastContact.company) {
      sharedCompany = lastContact.company;
    }
  }
  if (sharedCompany) {
    for (const c of contacts) if (!c.company) c.company = sharedCompany;
  }
  return { contacts, end };
}

interface Match {
  start: number;
  end: number;
  build: () => Omit<ParsedEmailCommand, 'noteText'>;
}

function tryAsk(note: string): Match | null {
  const m = ASK_RE.exec(note);
  if (!m) return null;
  const end = m.index + m[0].length;
  return {
    start: m.index,
    end,
    build: () => ({ kind: 'ask', ...EMPTY, contactNames: [] }),
  };
}

function tryNote(note: string): Match | null {
  const m = NOTE_FOR_RE.exec(note);
  if (!m) return null;
  const afterFor = m.index + m[0].length;
  const lineEnd = note.indexOf('\n', afterFor);
  const restOfLine = note.slice(afterFor, lineEnd === -1 ? undefined : lineEnd);
  const colonIdx = restOfLine.indexOf(':');
  let name: string | null;
  let end: number;
  if (colonIdx !== -1) {
    // Name is everything up to the colon ("note for john smith: ..." works
    // even for lowercase names).
    const res = captureNameWords(restOfLine.slice(0, colonIdx));
    name = res.name;
    end = afterFor + colonIdx + 1; // consume the colon too
  } else {
    const res = captureNameWords(restOfLine);
    name = res.name;
    end = afterFor + res.end;
  }
  if (!name) return null;
  return {
    start: m.index,
    end,
    build: () => ({ kind: 'note', ...EMPTY, contactName: name, contactNames: [] }),
  };
}

function tryLogContact(note: string): Match | null {
  const candidates: Match[] = [];

  // "log new contact [names]" — names optional; no name means the caller
  // falls back to extracting names from the email itself.
  const lc = LOG_NEW_CONTACT_RE.exec(note);
  if (lc) {
    const after = lc.index + lc[0].length;
    const lineEnd = note.indexOf('\n', after);
    const restOfLine = note.slice(after, lineEnd === -1 ? undefined : lineEnd);
    const { contacts, end: namesEnd } = splitNamesWithCompanies(restOfLine);
    candidates.push({
      start: lc.index,
      end: contacts.length > 0 ? after + namesEnd : after,
      build: () => ({
        kind: 'log-contact',
        ...EMPTY,
        contactNames: contacts.map((c) => c.name),
        contacts,
      }),
    });
  }

  // "add <names> to contacts" / "add <names> as contacts" /
  // "log <names> as contacts".
  for (const re of [ADD_TO_CONTACTS_RE, LOG_AS_CONTACTS_RE]) {
    const m = re.exec(note);
    if (!m) continue;
    const { contacts } = splitNamesWithCompanies(m[1]);
    if (contacts.length === 0) continue;
    const end = m.index + m[0].length;
    candidates.push({
      start: m.index,
      end,
      build: () => ({
        kind: 'log-contact',
        ...EMPTY,
        contactNames: contacts.map((c) => c.name),
        contacts,
      }),
    });
  }

  // Bare "add <Name>" — only with a person-like (capitalized) name, and
  // never for deal phrasing: "add-on" has no space after "add", and
  // "add on for DiPonio" fails the capitalized-name check.
  const bare = BARE_ADD_RE.exec(note);
  if (bare) {
    const after = bare.index + bare[0].length;
    const lineEnd = note.indexOf('\n', after);
    const restOfLine = note.slice(after, lineEnd === -1 ? undefined : lineEnd);
    const firstWord = restOfLine.trim().split(/\s+/)[0] ?? '';
    const firstLower = firstWord.toLowerCase();
    const isDealOrStageWord =
      firstLower in DEAL_TYPE_SYNONYMS || firstLower in STAGE_SYNONYMS;
    if (
      /^[A-Z]/.test(firstWord) &&
      !BARE_ADD_GUARD_WORDS.has(firstLower) &&
      !isDealOrStageWord
    ) {
      const { contacts, end: namesEnd } = splitNamesWithCompanies(restOfLine);
      if (contacts.length > 0) {
        candidates.push({
          start: bare.index,
          end: after + namesEnd,
          build: () => ({
            kind: 'log-contact',
            ...EMPTY,
            contactNames: contacts.map((c) => c.name),
            contacts,
          }),
        });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.start - b.start);
  return candidates[0];
}

function tryLogDeal(note: string): Match | null {
  const m = LOG_DEAL_RE.exec(note);
  if (!m) return null;
  const stageKey = m[1].toLowerCase().replace(/\s+/g, ' ');
  let stage: Stage = STAGE_SYNONYMS[stageKey];
  const stageEnd = m.index + m[0].length;
  const lineEnd = note.indexOf('\n', stageEnd);
  let rest = note.slice(stageEnd, lineEnd === -1 ? undefined : lineEnd);
  let consumed = 0;
  let dealType: DealType | null = null;
  let parentPortco: string | null = null;

  // Optional deal type, right after the stage ("as add-on" or bare "add-on").
  const dt = DEAL_TYPE_RE.exec(rest);
  if (dt) {
    dealType = DEAL_TYPE_SYNONYMS[dt[1].toLowerCase().replace(/\s+/g, ' ')];
    consumed += dt[0].length;
    rest = rest.slice(dt[0].length);
  }

  // Optional "for <portco>" (up to 4 words).
  const forM = FOR_PORTCO_RE.exec(rest);
  if (forM) {
    const afterFor = forM[0].length;
    const { name, end: nameEnd } = captureNameWords(rest.slice(afterFor));
    if (name) {
      parentPortco = name;
      consumed += afterFor + nameEnd;
      rest = rest.slice(afterFor + nameEnd);
    }
  }

  // Tolerate deal type after the portco ("... for DiPonio as add-on").
  if (!dealType) {
    const dt2 = DEAL_TYPE_RE.exec(rest);
    if (dt2) {
      dealType = DEAL_TYPE_SYNONYMS[dt2[1].toLowerCase().replace(/\s+/g, ' ')];
      consumed += dt2[0].length;
    }
  }

  // 'closed' + add-on is the add-on close; every other close is platform.
  if (stage === 'Closed (Platform)' && dealType === 'add-on') {
    stage = 'Closed (Add-On)';
  }

  const end = stageEnd + consumed;
  return {
    start: m.index,
    end,
    build: () => ({
      kind: 'log-deal',
      ...EMPTY,
      stage,
      deal_type: dealType,
      parent_portco: parentPortco,
      contactNames: [],
    }),
  };
}

/**
 * Parse a forwarded-email instruction into a deterministic command.
 * Runs before the LLM call; matched slots win and the LLM fills the rest.
 */
export function parseEmailCommand(note: string): ParsedEmailCommand {
  const input = note ?? '';
  const match =
    tryAsk(input) ?? tryNote(input) ?? tryLogContact(input) ?? tryLogDeal(input);
  if (!match) return noneResult(input);
  const parsed = match.build();
  return { ...parsed, noteText: removeSpan(input, match.start, match.end) };
}
