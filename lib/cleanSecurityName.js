// NASDAQ Trader's "Security Name" field bundles the security-type descriptor onto the
// company name (e.g. "Agilent Technologies, Inc. Common Stock", "Ares Acquisition
// Corporation III - Class A Ordinary Shares"). This strips that descriptor so
// company_name holds just the company name.
const SUFFIX_PATTERN = new RegExp(
  '\\s*[-,]?\\s*(' +
    [
      'Class\\s+[A-Z]\\d?\\s+(?:Common Stock|Ordinary Shares?)',
      'Common Stock',
      'Ordinary Shares?',
      'American Depositary (?:Shares|Receipts)\\b.*',
      'Depositary (?:Shares|Receipts)\\b.*',
      'Redeemable [Ww]arrants?\\b.*',
      '[Ww]arrants?\\b.*',
      'Units?\\b.*',
      'Rights?\\b.*',
      'Preferred (?:Stock|Shares)\\b.*',
      'Common Shares? of Beneficial Interest\\b.*',
      'Shares? of Beneficial Interest\\b.*',
      '[\\d.]+%.*Notes?\\s+due\\s+\\d{4}.*',
      'Notes?\\s+due\\s+\\d{4}.*',
    ].join('|') +
    ')\\s*$',
  'i'
);

function cleanSecurityName(name) {
  const raw = String(name || '');
  const beforeDash = raw.split(' - ')[0];
  const stripped = beforeDash.replace(SUFFIX_PATTERN, '').trim();
  return stripped || raw.trim();
}

module.exports = { cleanSecurityName };
