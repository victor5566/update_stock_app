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
function isValidCusip(value) {
  if (typeof value !== 'string') return false;
  const cusip = value.trim().toUpperCase();
  if (!/^[0-9A-Z*@#]{9}$/.test(cusip)) return false;
  const expected = computeCheckDigit(cusip.slice(0, 8));
  return expected !== null && expected === Number(cusip[8]);
}

module.exports = { isValidCusip };
