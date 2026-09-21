// Collapses two differently-formatted company names down to a comparable "fingerprint"
// so cosmetic differences between data sources (e.g. "JP Morgan Chase & Co. Common Stock"
// vs "JPMorgan Chase & Co.") don't get flagged as a real name change.
const NOISE_WORDS = new Set([
  'common', 'stock', 'shares', 'share', 'class', 'ordinary', 'depositary', 'american',
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited',
  'plc', 'llc', 'lp', 'group', 'holdings', 'holding', 'the', 'a', 'b', 'c',
]);

function normalizeCompanyName(name) {
  return String(name || '')
    .toLowerCase()
    .split(' - ')[0] // NASDAQ Trader appends " - Class A Ordinary Shares" etc. after the real name
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !NOISE_WORDS.has(word))
    .join('');
}

function companyNamesMatch(nameA, nameB) {
  return normalizeCompanyName(nameA) === normalizeCompanyName(nameB);
}

module.exports = { normalizeCompanyName, companyNamesMatch };
