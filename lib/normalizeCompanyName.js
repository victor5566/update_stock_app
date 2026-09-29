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

module.exports = { normalizeCompanyName, companyNamesMatch, issuerKey, isTruncationOf, sameCompany };
