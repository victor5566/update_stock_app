// Collapses two differently-formatted company names down to a comparable "fingerprint"
// so cosmetic differences between data sources (e.g. "JP Morgan Chase & Co. Common Stock"
// vs "JPMorgan Chase & Co.") don't get flagged as a real name change.
const NOISE_WORDS = new Set([
  'common', 'stock', 'shares', 'share', 'class', 'ordinary', 'depositary', 'american',
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited',
  'plc', 'llc', 'lp', 'group', 'holdings', 'holding', 'the', 'a', 'b', 'c',
  // security-type tags on warrants, units, rights ("GameStop Corp. WT")
  'wt', 'warrant', 'warrants', 'unit', 'units', 'right', 'rights',
]);

function normalizeCompanyName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // drop accents: "Telefônica" and "Telefonica" are the same name
    .toLowerCase()
    .split(' - ')[0] // NASDAQ Trader appends " - Class A Ordinary Shares" etc. after the real name
    .replace(/\s+new\s*$/, '') // re-listed issuer tag ("Berkshire Hathaway Inc. New") - trailing only, not "New Jersey"
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !NOISE_WORDS.has(word))
    .join('');
}

function companyNamesMatch(nameA, nameB) {
  return normalizeCompanyName(nameA) === normalizeCompanyName(nameB);
}

// Issuer-only fingerprint for comparing names *across sources*: NASDAQ Trader / SEC names
// carry descriptors the others don't ("Class A Ordinary Shares (Ireland)", "(REIT)", "ADS"),
// and note/preferred names add coupon terms ("6.50% Senior Notes Due 2026") that one source
// includes and another doesn't. Compares only the issuer part.
const DESCRIPTOR_WORDS = /\b(ads|adr|american depositary|depository|registry|ordinary|subordinate|voting|non-voting|limited voting|reit|sa|s\.a\.|se|nv|n\.v\.|ag|ltd|corp|inc|co|plc)\b/gi;
function issuerKey(name) {
  const issuer = String(name || '')
    .replace(/\([^)]*\)?/g, ' ') // parentheticals, incl. an unclosed truncated one
    .split(/\s\d+(?:\.\d+)?%|\s-\s/)[0] // cut at a coupon ("5.25% ...") or " - " suffix
    .replace(DESCRIPTOR_WORDS, ' ');
  return normalizeCompanyName(issuer);
}

// Our name cut off mid-word at ~30 chars (Yahoo shortName-style) and `full` starts with it
// literally ("...Group Internat" + "ional").
function isTruncationOf(ours, full) {
  const o = String(ours || '').trim();
  const f = String(full || '').trim();
  return o.length >= 25 && o.length <= 32 && f.length > o.length
    && f.toLowerCase().startsWith(o.toLowerCase())
    && /[A-Za-z0-9]$/.test(o) && /[A-Za-z0-9]/.test(f[o.length]);
}

// Looser than companyNamesMatch, for "do these two sources mean the same issuer?"
function sameCompany(a, b) {
  return companyNamesMatch(a, b) || issuerKey(a) === issuerKey(b) || isTruncationOf(a, b) || isTruncationOf(b, a);
}

// --- Same name, different spelling (stock monitor) ---
// Sources spell one security's name differently: "iPath Series B Carbon ETN" (Yahoo) vs
// "iPath Series B Carbon Exchange-Traded Notes" (NASDAQ Trader), "... Bear 3X Shares" vs
// "... Bear 3X ETF", "U.S." vs "US", "&" vs "and", "-3x" vs "-3", "NYLI" vs "NYLIM".
// Words that only say what kind of security / legal entity it is are dropped; the rest must
// match in order (a token may be a prefix of the other's, e.g. NYLI / NYLIM).
const GENERIC_WORDS = new Set([
  'etf', 'etfs', 'etn', 'etns', 'fund', 'funds', 'shares', 'share', 'notes', 'note', 'trust', 'series', 'ser', 'class', 'index',
  'portfolio', 'reit', 'r', 'etv',
  'the', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'llc', 'lp',
  'sa', 'sab', 'de', 'cv', 'ag', 'nv', 'se', 's', 'a', 'b', 'c', 'n', 'v', 'l', 'p',
]);

function nameTokens(name, { keepGeneric = false } = {}) {
  return String(name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[()]/g, ' ') // keep the words: "(Brasil)" matters; "(R)", "(The)", "(REIT)" are generic
    .replace(/[®™]/g, ' ')
    .replace(/public\s+limited\s+company/g, ' plc ')
    .replace(/exchange[\s-]+traded[\s-]+notes?/g, ' etn ')
    .replace(/exchange[\s-]+traded[\s-]+funds?/g, ' etf ')
    .replace(/\bu\.\s?s\.(?=\s|$)/g, ' us ')
    .replace(/\b([a-z])\.\s?([a-z])\.(?=\s|$)/g, '$1$2') // "J.P. Morgan" -> "jp morgan"
    .replace(/&/g, ' and ')
    .replace(/\b(\d+)x\b/g, '$1') // leverage: "-3x" / "3X"
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && (keepGeneric || !GENERIC_WORDS.has(w)));
}

const tokenMatch = (x, y) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));

function similarNames(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join('') === tb.join('')) return true; // "ArcelorMittal" / "Arcelor Mittal"
  return ta.length === tb.length && ta.every((t, i) => tokenMatch(t, tb[i]));
}

// Every word of `part` (generic words aside) also appears in `whole`: a less specific form of the
// same name ("Short Term Municipal Bond Active ETF" in "PIMCO Short Term Municipal Bond ...").
function namePartOf(part, whole) {
  const tp = nameTokens(part);
  const tw = nameTokens(whole);
  return tp.length > 0 && tp.every((t) => tw.some((w) => tokenMatch(t, w)));
}

// At most `max` single-character edits apart (case-insensitive): a typo in one source
// ("... Bond ETF" / "... Bond ETFo", "Holdings" / "Holdlings") or "Inc" / "Inc.".
function nearlyEqual(a, b, max = 2) {
  const s = String(a || '').trim().toLowerCase();
  const t = String(b || '').trim().toLowerCase();
  if (Math.abs(s.length - t.length) > max) return false;
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= t.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length] <= max;
}

// `name` with each word spelled as in `reference` when the two only differ in case ("Direxion
// Daily Nvda Bull" -> "Direxion Daily NVDA Bull" when the reference has "NVDA").
function matchCasing(name, reference) {
  const spellings = new Map();
  for (const word of String(reference || '').split(/\s+/)) if (word) spellings.set(word.toLowerCase(), word);
  return String(name || '').split(/(\s+)/).map((word) => spellings.get(word.toLowerCase()) || word).join('');
}

// Yahoo abbreviates fund names to ~30 characters ("Brown Capital Mgmt Small Co Inv" for "Brown
// Capital Management Small Company Fund Investor Shares"): every word of the short name is the
// next word of the long one, a prefix of it, or its letters in order (mgmt / management). A
// trailing share-class letter ("... Style I") may be left over.
// `s` abbreviates the word `l`: equal, a prefix ("ind" / "index"), or clearly shorter with its
// letters in order ("mgmt" / "management", "instl" / "institutional") - not a near-equal
// spelling like "holdings" / "holdlings" (a typo in one source).
function abbreviates(s, l) {
  if (tokenMatch(s, l) || (s.length >= 2 && l.startsWith(s))) return true;
  if (s.length < 3 || s[0] !== l[0] || s.length > l.length * 0.7) return false;
  let i = 0;
  for (const ch of l) if (ch === s[i]) i += 1;
  return i === s.length;
}

// Our stored name is a word-for-word abbreviation of `full` ("Etracs Alerian Mlp Ind Ser B" for
// "ETRACS Alerian MLP Index ETN Series B"): each of our words abbreviates the next word of
// `full`, which may only skip generic words (ETN); at least one word is really abbreviated. A
// longer name with more real words ("... Fund Common Stock, $0.01 par value") isn't one.
function isWordAbbreviationOf(short, full) {
  const ts = nameTokens(short, { keepGeneric: true });
  const tf = nameTokens(full, { keepGeneric: true });
  if (!ts.length) return false;
  let j = 0;
  let abbreviated = false;
  for (const t of ts) {
    while (j < tf.length && !abbreviates(t, tf[j]) && GENERIC_WORDS.has(tf[j])) j += 1;
    if (j === tf.length || !abbreviates(t, tf[j])) return false;
    if (t !== tf[j]) abbreviated = true;
    j += 1;
  }
  return abbreviated && tf.slice(j).every((w) => GENERIC_WORDS.has(w));
}

function isAbbreviationOf(short, long) {
  const ts = nameTokens(short);
  const tl = nameTokens(long);
  if (ts.length < 2 || ts[0] !== tl[0]) return false;
  const abbrev = abbreviates;
  let j = 0;
  for (let i = 0; i < ts.length; i += 1) {
    while (j < tl.length && !abbrev(ts[i], tl[j])) j += 1;
    if (j === tl.length) return i === ts.length - 1 && /^[a-z]$/.test(ts[i]);
    j += 1;
  }
  return true;
}

// Yahoo (and some stored names) prefix fund names with the fund family / trust: "Roundhill ETF
// Trust - Roundhill S&P 500 Target 10 Managed Distribution ETF", "The Charles Schwab Family of
// Funds - Schwab Value Advantage Money Fund", "The RBB Fund, Inc.- US Treasury 5 Year Note ETF".
// The part after the dash is the security's own name.
function stripFundFamily(name) {
  const m = String(name || '').match(/^(.*\b(?:Trust|Funds?|Family of Funds|Series|Portfolios|Inc\.?))\s*-\s+(.+)$/);
  return m ? m[2].trim() : String(name || '').trim();
}

module.exports = {
  normalizeCompanyName, companyNamesMatch, issuerKey, isTruncationOf, sameCompany,
  similarNames, isAbbreviationOf, isWordAbbreviationOf, stripFundFamily, namePartOf, matchCasing, nearlyEqual,
};
