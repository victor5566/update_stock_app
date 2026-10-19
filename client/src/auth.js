import { createContext, useContext } from 'react';
import { API } from './lib/stocks';

// The logged-in user ({ id, email }) and logout(), provided by AuthGate.
export const AuthContext = createContext({ user: null, logout: () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

// -> { user } | { error: code } (codes from routes/auth.js: invalid / too_many / missing, or 'network')
export async function login(email, password) {
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { user: body.user } : { error: body.code || 'network' };
  } catch {
    return { error: 'network' };
  }
}

// -> { user (null when not logged in), emailOnly (no password asked - LOGIN_EMAIL_ONLY on the
// server) }. Throws when the server can't be reached.
export async function fetchMe() {
  const res = await fetch(`${API}/auth/me`);
  if (res.status !== 401 && !res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return { user: res.ok ? body.user : null, emailOnly: Boolean(body.emailOnly) };
}

export async function logoutRequest() {
  try {
    await fetch(`${API}/auth/logout`, { method: 'POST' });
  } catch {
    // the cookie is cleared server-side; offline, the page still goes back to the login form
  }
}
