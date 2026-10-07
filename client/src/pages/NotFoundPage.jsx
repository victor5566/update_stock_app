// Any path the router doesn't know (only / and /<symbol> exist), e.g. /a/b - instead of an
// empty page.
import { Link } from 'react-router-dom';
import { LangContext, useLang } from '../i18n';
import { TRANSLATIONS } from '../translations';
import { Card, PageHeader } from '../components/ui';

export default function NotFoundPage() {
  const [lang, setLang] = useLang('pageNotFound');
  const t = (key) => TRANSLATIONS[lang][key];
  const backLink = <Link to="/" className="text-blue-600 hover:underline dark:text-blue-400">{t('backToList')}</Link>;
  return (
    <LangContext.Provider value={lang}>
      <PageHeader title={t('pageNotFound')} subtitle={backLink} lang={lang} setLang={setLang} />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Card id="page-not-found"><p className="text-sm text-slate-900 dark:text-slate-100">{t('pageNotFoundHelp')}</p></Card>
      </main>
    </LangContext.Provider>
  );
}
