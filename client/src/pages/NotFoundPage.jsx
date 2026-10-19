// Any path the router doesn't know (only / and /<symbol> exist), e.g. /a/b - instead of an
// empty page.
import { Link } from 'react-router-dom';
import { useT, useTitle } from '../i18n';
import { Card, PageHeader } from '../components/ui';

export default function NotFoundPage() {
  useTitle('pageNotFound');
  const t = useT();
  const backLink = <Link to="/" className="text-blue-600 hover:underline dark:text-blue-400">{t('backToList')}</Link>;
  return (
    <>
      <PageHeader title={t('pageNotFound')} subtitle={backLink} />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Card id="page-not-found"><p className="text-sm text-slate-900 dark:text-slate-100">{t('pageNotFoundHelp')}</p></Card>
      </main>
    </>
  );
}
