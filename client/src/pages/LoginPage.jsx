// The login form (accounts: test.users, role LABEL, active - see lib/auth.js on the server).
// Shown by AuthGate for every path until there is a session. Details follow LevelFields' own login
// page (the user, 2026-10-19): the email is lowercased as it is typed, the password can be shown,
// "Please fill all values", Sign In / Signing in.... The form is centered on the page.
import { useState } from 'react';
import { LangContext, useLang } from '../i18n';
import { TRANSLATIONS } from '../translations';
import { login } from '../auth';
import { Alert, Button, Field, Input, PageHeader } from '../components/ui';

const ERROR_KEYS = { invalid: 'loginInvalid', too_many: 'loginTooMany', missing: 'loginMissing' };

function EyeIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  );
}

// emailOnly: the server logs in by email alone (LOGIN_EMAIL_ONLY) - no password field then.
export default function LoginPage({ onLogin, expired, loadError, emailOnly }) {
  const [lang, setLang] = useLang('loginTitle');
  const t = (key) => TRANSLATIONS[lang][key];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || (!emailOnly && !password)) {
      setError('missing');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await login(email.trim(), emailOnly ? '' : password);
    setBusy(false);
    if (result.user) {
      setPassword('');
      onLogin(result.user);
    } else {
      setError(result.error);
    }
  }

  const errorKey = emailOnly && ERROR_KEYS[error] ? `${ERROR_KEYS[error]}EmailOnly` : ERROR_KEYS[error];
  let notice = null;
  if (error) notice = <Alert tone="error" id="login-error" live>{t(errorKey || 'loginNetworkError')}</Alert>;
  else if (expired) notice = <Alert tone="warn" id="login-expired" live>{t('loginExpired')}</Alert>;
  else if (loadError) notice = <Alert tone="error" id="login-load-error" live>{t('loginNetworkError')}</Alert>;

  return (
    <LangContext.Provider value={lang}>
      <PageHeader title={t('pageTitle')} subtitle={t('subtitle')} lang={lang} setLang={setLang} />
      <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center px-4 py-10 sm:px-6">
        <section id="login-card" className="w-full rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="p-6 sm:p-10">
            <h2 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{t('loginTitle')}</h2>
            <p className="mt-2 text-sm text-slate-800 dark:text-slate-100">{t(emailOnly ? 'loginHelpEmailOnly' : 'loginHelp')}</p>
            <form id="login-form" onSubmit={submit} className="mt-6 space-y-4" noValidate>
              {notice}
              <Field label={t('labelEmail')} htmlFor="login-email">
                {/* Lowercased as typed, like LevelFields' login (the server compares case-insensitively anyway). */}
                <Input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} autoFocus />
              </Field>
              {!emailOnly && (
                <Field label={t('labelPassword')} htmlFor="login-password">
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-11"
                    />
                    <button
                      id="login-password-toggle"
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={t(showPassword ? 'hidePassword' : 'showPassword')}
                      title={t(showPassword ? 'hidePassword' : 'showPassword')}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-800 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:text-slate-100 dark:hover:text-white"
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                </Field>
              )}
              <Button id="login-submit" type="submit" variant="primary" disabled={busy} className="w-full">
                {busy ? t('loggingIn') : t('loginBtn')}
              </Button>
            </form>
          </div>
        </section>
      </main>
    </LangContext.Provider>
  );
}
