// CUSIP: 9-character alphanumeric security identifier (see
// https://www.investor.gov/introduction-investing/investing-basics/glossary/cusip-number).
// The 9th character is a check digit derived from the first 8 via a fixed algorithm, so a
// mistyped CUSIP is almost always catchable without needing to look anything up externally.

function charValue(c) {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55; // A=10, ..., Z=35
  if (c === '*') return 36;
  if (c === '@') return 37;
  if (c === '#') return 38;
  return null;
}

function computeCheckDigit(first8) {
  let total = 0;
  for (let i = 0; i < 8; i++) {
    let v = charValue(first8[i]);
    if (v === null) return null;
    if ((i + 1) % 2 === 0) v *= 2; // double every 2nd character (1-indexed position)
    total += Math.floor(v / 10) + (v % 10);
  }
  return (10 - (total % 10)) % 10;
}

// Returns true only for a well-formed 9-character CUSIP whose check digit matches.
// "000000000" passes the check digit (it's 0), but filers use it as a placeholder (HQI's and
// SLRC's 13Gs printed it) - issuer number 000000 is never assigned, so reject it.
function isValidCusip(value) {
  if (typeof value !== 'string') return false;
  const cusip = value.trim().toUpperCase();
  if (!/^[0-9A-Z*@#]{9}$/.test(cusip)) return false;
  if (cusip.startsWith('000000')) return false;
  const expected = computeCheckDigit(cusip.slice(0, 8));
  return expected !== null && expected === Number(cusip[8]);
}

// "00" + a valid SEDOL: what some 13F filers (and so quantumonline-style pages) print for a
// foreign ordinary share that has no CUSIP - BKHPF 006075808 (SEDOL 6075808), NTOIF 00B06YV46,
// ATLFF 00BLDBN41. It also passes the CUSIP check digit, but it isn't a CUSIP. A real CUSIP of
// issuer 00xxxx matches by chance about 1 in 10 (00751Y106 Advance Auto Parts, 00790R104), so
// this only says "uncertain": the lookup skips such a value (the user, 2026-10-15) unless it
// comes from a 13G about the company itself.
const SEDOL_WEIGHTS = [1, 3, 1, 7, 3, 9];
function looksLikePaddedSedol(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim().toUpperCase();
  if (!/^00[0-9BCDFGHJKLMNPQRSTVWXYZ]{6}[0-9]$/.test(v)) return false;
  const sedol = v.slice(2);
  const sum = SEDOL_WEIGHTS.reduce((t, w, i) => t + w * (sedol[i] <= '9' ? sedol.charCodeAt(i) - 48 : sedol.charCodeAt(i) - 55), 0);
  return (10 - (sum % 10)) % 10 === Number(sedol[6]);
}

module.exports = { isValidCusip, looksLikePaddedSedol };
