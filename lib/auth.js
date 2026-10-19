// Login for the site: accounts are the existing rows of test.users (another system's table -
// only SELECT, never written). Only role = 'LABEL' with status = true may log in; passwords are
// bcrypt hashes ("$2b$" or PHP's "$2y$", the same algorithm).
//
// The session is a signed cookie (no session table - this role can't create tables): the user's
// id, email and expiry, HMAC-signed with SESSION_SECRET. Logging out clears the cookie. Every
// SESSION_RECHECK_MS the account is looked up again, so a disabled account or a changed role
// stops working within that time.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');

const COOKIE = 'sid';
const SESSION_MS = 12 * 60 * 60 * 1000;
const SESSION_RECHECK_MS = 5 * 60 * 1000;

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  // Works, but every restart logs everyone out - set SESSION_SECRET in .env.
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] SESSION_SECRET is not set in .env - using a random one (sessions end on restart)');
}

// Compared against when the email isn't found, so the answer takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const LOGIN_SQL = `SELECT user_id, email, password_hash FROM users
  WHERE lower(email) = lower($1) AND role = 'LABEL' AND status = true
  LIMIT 1`;
const RECHECK_SQL = `SELECT user_id, email FROM users
  WHERE user_id = $1 AND role = 'LABEL' AND status = true`;

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

const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function makeToken(user) {
  const data = Buffer.from(JSON.stringify({ uid: user.id, email: user.email, exp: Date.now() + SESSION_MS })).toString('base64url');
  return `${data}.${sign(data)}`;
}

function readToken(token) {
  const [data, mac] = String(token || '').split('.');
  if (!data || !mac) return null;
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const session = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
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

function setSessionCookie(res, user) {
  res.append('Set-Cookie', `${COOKIE}=${makeToken(user)}; ${cookieFlags(res.req)}; Max-Age=${SESSION_MS / 1000}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; ${cookieFlags(res.req)}; Max-Age=0`);
}

// user id -> time it was last confirmed as LABEL + active
const confirmedAt = new Map();

// The session's user ({ id, email }) or null.
async function sessionUser(req) {
  const session = readToken(cookieOf(req, COOKIE));
  if (!session) return null;
  const last = confirmedAt.get(session.uid) || 0;
  if (Date.now() - last > SESSION_RECHECK_MS) {
    const { rows } = await pool.query(RECHECK_SQL, [session.uid]);
    if (!rows[0]) {
      confirmedAt.delete(session.uid);
      return null;
    }
    confirmedAt.set(session.uid, Date.now());
  }
  return { id: session.uid, email: session.email };
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

module.exports = { EMAIL_ONLY, verifyLogin, sessionUser, requireAuth, setSessionCookie, clearSessionCookie, confirmedAt };
