// /api/auth - login / logout / who am I. Open without a session (server.js mounts it before
// requireAuth); see lib/auth.js.
const express = require('express');
const { EMAIL_ONLY, verifyLogin, sessionUser, setSessionCookie, clearSessionCookie, forgetSession } = require('../lib/auth');

const router = express.Router();

// Failed logins per IP: at most LOGIN_MAX_FAILS within LOGIN_WINDOW_MS, then 429 until the
// window passes. In-process, like the sessions' recheck cache.
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // ip -> { count, since }

function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (f && Date.now() - f.since > LOGIN_WINDOW_MS) failures.delete(ip);
  return (failures.get(ip) || { count: 0 }).count >= LOGIN_MAX_FAILS;
}

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const passwordGiven = typeof password === 'string' && password;
    if (typeof email !== 'string' || !email.trim() || (!EMAIL_ONLY && !passwordGiven)) {
      return res.status(400).json({ errors: ['email and password are required'], code: 'missing' });
    }
    if (tooManyFailures(req.ip)) {
      return res.status(429).json({ errors: ['too many failed logins - try again later'], code: 'too_many' });
    }
    const user = await verifyLogin(email, passwordGiven ? password : '');
    if (!user) {
      const f = failures.get(req.ip) || { count: 0, since: Date.now() };
      failures.set(req.ip, { ...f, count: f.count + 1 });
      // The same answer whether the account doesn't exist, isn't allowed or the password is wrong.
      return res.status(401).json({ errors: ['wrong email or password'], code: 'invalid', emailOnly: EMAIL_ONLY });
    }
    failures.delete(req.ip);
    await setSessionCookie(res, user);
    res.json({ user, emailOnly: EMAIL_ONLY });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  forgetSession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res, next) => {
  try {
    const user = await sessionUser(req);
    // emailOnly tells the login page whether to ask for a password (LOGIN_EMAIL_ONLY).
    if (!user) return res.status(401).json({ errors: ['login required'], code: 'login_required', emailOnly: EMAIL_ONLY });
    res.json({ user, emailOnly: EMAIL_ONLY });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
