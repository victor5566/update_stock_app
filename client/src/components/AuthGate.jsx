// Shows the login page until there is a session (GET /api/auth/me), then the app. Any /api
// answer of 401 later (the session expired, or the account was disabled) brings the login page
// back - window.fetch is wrapped once for that, so the panels' own fetch calls need no changes.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext, fetchMe, logoutRequest } from '../auth';
import LoginPage from '../pages/LoginPage';

let fetchWrapped = false;
let onUnauthorized = () => {};

function wrapFetch() {
  if (fetchWrapped) return;
  fetchWrapped = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    const url = typeof input === 'string' ? input : input.url;
    if (res.status === 401 && /^\/api\//.test(url) && !/^\/api\/auth\//.test(url)) onUnauthorized();
    return res;
  };
}

export default function AuthGate({ children }) {
  // undefined = still asking the server, null = not logged in
  const [user, setUser] = useState(undefined);
  const [expired, setExpired] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [emailOnly, setEmailOnly] = useState(false);

  useEffect(() => {
    wrapFetch();
    onUnauthorized = () => {
      setUser((u) => {
        if (u) setExpired(true);
        return null;
      });
    };
    fetchMe().then((me) => {
      setEmailOnly(me.emailOnly);
      setUser(me.user);
    }).catch(() => {
      setLoadError(true);
      setUser(null);
    });
    return () => {
      onUnauthorized = () => {};
    };
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setExpired(false);
    setUser(null);
  }, []);
  const onLogin = useCallback((u) => {
    setExpired(false);
    setLoadError(false);
    setUser(u);
  }, []);
  const value = useMemo(() => ({ user, logout }), [user, logout]);

  if (user === undefined) return null;
  if (!user) return <LoginPage onLogin={onLogin} expired={expired} loadError={loadError} emailOnly={emailOnly} />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
