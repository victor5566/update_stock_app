// Round-trips text through a Buffer so any invalid/unpaired UTF-16 content (occasionally
// seen in text sourced from external APIs) becomes valid UTF-8 before hitting Postgres,
// which otherwise rejects the whole INSERT/UPDATE with "invalid byte sequence for encoding".
// Passes null/undefined through unchanged, since callers use this on optional fields too.
function sanitizeText(str) {
  return str == null ? str : Buffer.from(String(str), 'utf8').toString('utf8');
}

module.exports = { sanitizeText };
