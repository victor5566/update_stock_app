// The login form (accounts: test.users, role LABEL, active - see lib/auth.js on the server).
// Shown by AuthGate for every path until there is a session.
import { useState } from 'react';
import { LangContext, useLang } from '../i18n';
import { TRANSLATIONS } from '../translations';
import { login } from '../auth';
import { Alert, Button, Card, Field, Input, PageHeader } from '../components/ui';

const ERROR_KEYS = { invalid: 'loginInvalid', too_many: 'loginTooMany', missing: 'loginMissing' };

// emailOnly: the server logs in by email alone (LOGIN_EMAIL_ONLY) - no password field then.
export default function LoginPage({ onLogin, expired, loadError, emailOnly }) {
  const [lang, setLang] = useLang('loginTitle');
  const t = (key) => TRANSLATIONS[lang][key];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  let notice = null;
  const errorKey = emailOnly && ERROR_KEYS[error] ? `${ERROR_KEYS[error]}EmailOnly` : ERROR_KEYS[error];
  if (error) notice = <Alert tone="error" id="login-error" live>{t(errorKey || 'loginNetworkError')}</Alert>;
  else if (expired) notice = <Alert tone="warn" id="login-expired" live>{t('loginExpired')}</Alert>;
  else if (loadError) notice = <Alert tone="error" id="login-load-error" live>{t('loginNetworkError')}</Alert>;

  return (
    <LangContext.Provider value={lang}>
      <PageHeader title={t('pageTitle')} subtitle={t('subtitle')} lang={lang} setLang={setLang} />
      <main className="mx-auto max-w-md px-4 py-10 sm:px-6">
        <Card id="login-card" title={t('loginTitle')}>
          <form id="login-form" onSubmit={submit} className="space-y-4" noValidate>
            <p className="text-sm text-slate-800 dark:text-slate-100">{t(emailOnly ? 'loginHelpEmailOnly' : 'loginHelp')}</p>
            {notice}
            <Field label={t('labelEmail')} htmlFor="login-email">
              <Input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            {!emailOnly && (
              <Field label={t('labelPassword')} htmlFor="login-password">
                <Input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}
            <Button id="login-submit" type="submit" variant="primary" disabled={busy} className="w-full">
              {busy ? t('loggingIn') : t('loginBtn')}
            </Button>
          </form>
        </Card>
      </main>
    </LangContext.Provider>
  );
}
