// Login for the site: accounts are the existing rows of test.users (another system's table -
// only SELECT, never written). Only role = 'LABEL' with status = true may log in; passwords are
// bcrypt hashes ("$2b$" or PHP's "$2y$", the same algorithm).
//
// The session (the user, 2026-10-19) is a cookie "<user_id>.<token>" with
// token = 'md5' || md5(password_hash || email), computed and compared in SQL - no secret and no
// session table, so a server restart or deploy doesn't log anyone out. Every request checks it
// again together with role = 'LABEL' AND status = true (cached SESSION_RECHECK_MS), so a password
// change in the other system, a disabled account or a changed role ends the session. The cookie
// expires after SESSION_MS; the token itself has no expiry and logout only deletes the cookie.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');

const COOKIE = 'sid';
const SESSION_MS = 12 * 60 * 60 * 1000;
const SESSION_RECHECK_MS = 60 * 1000;

// Compared against when the email isn't found, so the answer takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const LOGIN_SQL = `SELECT user_id, email, password_hash FROM users
  WHERE lower(email) = lower($1) AND role = 'LABEL' AND status = true
  LIMIT 1`;
const TOKEN_SQL = `SELECT 'md5' || md5(password_hash || email) AS token FROM users WHERE user_id = $1`;
const SESSION_SQL = `SELECT user_id, email FROM users
  WHERE user_id = $1 AND role = 'LABEL' AND status = true
    AND 'md5' || md5(password_hash || email) = $2`;

// LOGIN_EMAIL_ONLY=true in .env (the user, 2026-10-19, for trying it out): the email alone logs in
// - still only a LABEL + active account - and the password isn't asked for or checked. Anyone who
// knows such an email gets in, so local / trial use only.
const EMAIL_ONLY = process.env.LOGIN_EMAIL_ONLY === 'true';
if (EMAIL_ONLY) console.warn('[auth] LOGIN_EMAIL_ONLY=true - logging in by email alone, passwords are not checked');

// -> { id, email } or null
async function verifyLogin(email, password) {
  const { rows } = await pool.query(LOGIN_SQL, [String(email).trim()]);
  const user = rows[0];
  if (EMAIL_ONLY) return user ? { id: user.user_id, email: user.email } : null;
  // "$2y$" (PHP) is "$2b$" under another prefix; only this in-memory copy is changed.
  const hash = user && user.password_hash ? String(user.password_hash).replace(/^\$2y\$/, '$2b$') : DUMMY_HASH;
  let ok = false;
  try {
    ok = await bcrypt.compare(String(password), hash);
  } catch {
    ok = false; // not a bcrypt hash
  }
  return user && ok ? { id: user.user_id, email: user.email } : null;
}

// "<user_id>.md5<32 hex>" for a logged-in user.
async function makeToken(user) {
  const { rows } = await pool.query(TOKEN_SQL, [user.id]);
  return `${user.id}.${rows[0].token}`;
}

// -> { uid, token } or null when the cookie isn't of that shape.
function readToken(value) {
  const m = String(value || '').match(/^(\d+)\.(md5[0-9a-f]{32})$/);
  return m ? { uid: Number(m[1]), token: m[2] } : null;
}

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

// Secure (https only) when the request came over https - directly or, with 'trust proxy' (server.js),
// as the proxy's X-Forwarded-Proto says - or always with COOKIE_SECURE=true in .env.
const cookieFlags = (req) => {
  const secure = process.env.COOKIE_SECURE === 'true' || Boolean(req && req.secure);
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
};

async function setSessionCookie(res, user) {
  res.append('Set-Cookie', `${COOKIE}=${await makeToken(user)}; ${cookieFlags(res.req)}; Max-Age=${SESSION_MS / 1000}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; ${cookieFlags(res.req)}; Max-Age=0`);
}

// cookie value -> { user, at }: a confirmed session, re-checked after SESSION_RECHECK_MS (a page
// load makes several /api calls; this saves a database round trip for each).
const confirmed = new Map();

// The session's user ({ id, email }) or null.
async function sessionUser(req) {
  const value = cookieOf(req, COOKIE);
  const session = readToken(value);
  if (!session) return null;
  const hit = confirmed.get(value);
  if (hit && Date.now() - hit.at < SESSION_RECHECK_MS) return hit.user;
  const { rows } = await pool.query(SESSION_SQL, [session.uid, session.token]);
  if (!rows[0]) {
    confirmed.delete(value);
    return null;
  }
  const user = { id: rows[0].user_id, email: rows[0].email };
  confirmed.set(value, { user, at: Date.now() });
  return user;
}

// Logging out forgets the cached session (the cookie itself is cleared by the caller).
function forgetSession(req) {
  confirmed.delete(cookieOf(req, COOKIE));
}

// For app.use('/api', requireAuth): 401 without a valid session.
async function requireAuth(req, res, next) {
  try {
    const user = await sessionUser(req);
    if (!user) return res.status(401).json({ errors: ['login required'], code: 'login_required' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { EMAIL_ONLY, verifyLogin, sessionUser, requireAuth, setSessionCookie, clearSessionCookie, forgetSession };
