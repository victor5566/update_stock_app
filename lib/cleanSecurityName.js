// NASDAQ Trader's "Security Name" field bundles the security-type descriptor onto the
// company name (e.g. "Agilent Technologies, Inc. Common Stock", "Ares Acquisition
// Corporation III - Class A Ordinary Shares"). This strips that descriptor so
// company_name holds just the company name.
// The \b before the group matters: without it "Curtiss-Wright Corporation Common Stock"
// matched "Rights?\b.*" from inside "Wright" and came out as "Curtiss-W".
const SUFFIX_PATTERN = new RegExp(
  '\\s*[-,]?\\s*\\b(' +
    [
      'Class\\s+[A-Z]\\d?\\s+(?:Common Stock|Ordinary Shares?)',
      // "Common Stock", "Common Stock, $0.01 par value, per share"
      'Common Stock\\b.*',
      // "Cheniere Energy Partners, LP Common Units Representing Limited Partner Interests"
      'Common Units?\\b.*',
      // "Ordinary Shares, no par value", "Subordinate Voting Shares", "Common Shares"
      'Ordinary Shares?\\b.*',
      'Subordinated?\\s+Voting\\s+Shares?\\b.*',
      'Common Shares\\b(?!\\s+of\\s+Beneficial).*',
      // "... LP Beneficial Unit Certificates representing assignments of ..."
      'Beneficial Unit Certificates\\b.*',
      // "Arcelor Mittal NY Registry Shares NEW"
      'N\\.?Y\\.?\\s+Registry\\s+Shares?\\b.*',
      // "Gildan Activewear, Inc. Class A Sub. Vot.", "... Inc Unsponsored", "... Sponosred ADR
      // (Japan)" (sic), "... Limited ADS", "... S.A. Global" (depositary descriptors)
      'Class\\s+[A-Z]\\s+Sub\\.?\\s+Vot\\b.*',
      '(?:Un)?spons?o?s?o?red\\b.*',
      'ADS\\b.*',
      'ADR\\b.*',
      'Global\\s+Depositary\\b.*',
      // "... ETNs due January 8, 2038", "... Notes due 2061": the maturity isn't part of the name
      'due\\s+(?:[A-Z][a-z]+\\s+\\d{1,2},?\\s+)?\\d{4}\\b.*',
      'American Depositary (?:Shares|Receipts)\\b.*',
      'Depositary (?:Shares|Receipts)\\b.*',
      'Redeemable [Ww]arrants?\\b.*',
      '[Ww]arrants?\\b.*',
      'Units?\\b.*',
      'Rights?\\b.*',
      'Preferred (?:Stock|Shares)\\b.*',
      'Common Shares? of Beneficial Interests?\\b.*',
      'Shares? of Beneficial Interests?\\b.*',
      '[\\d.]+%.*Notes?\\s+due\\s+\\d{4}.*',
      'Notes?\\s+due\\s+\\d{4}.*',
    ].join('|') +
    ')\\s*$',
  'i'
);

function cleanSecurityName(name) {
  // "Franklin Templeton Digital Holdings Trust Shares of Franklin Bitcoin ETF": the trust's
  // shares of the security named after "of".
  const sharesOf = String(name || '').match(/^.+\bTrust\s+Shares\s+of\s+(.+)$/i);
  // "D/B/A Sibanye-Stillwater Limited ADS": the name the company does business as.
  const raw = (sharesOf ? sharesOf[1] : String(name || '')).replace(/^D\/B\/A\s+/i, '');
  const beforeDash = raw.split(' - ')[0].replace(/\s*\(New\)\s*$/i, ''); // "(New)" re-listing tag
  const stripped = beforeDash.replace(SUFFIX_PATTERN, '').trim();
  const cleaned = stripped || raw.trim();
  // The listing sometimes repeats the name: "Brookfield Infrastructure Corporation Brookfield
  // Infrastructure Corporation".
  const half = cleaned.match(/^(.{4,}?)\s+\1$/);
  return half ? half[1] : cleaned;
}

module.exports = { cleanSecurityName };
