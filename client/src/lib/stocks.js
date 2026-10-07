// Shared helpers for the stock pages. The API is served by the same Express server (in
// development, client/package.json's "proxy" forwards /api to it).
export const API = '/api';
export const PAGE_SIZE = 15;

export const cx = (...classes) => classes.filter(Boolean).join(' ');

// Detail page path. With an id it opens that exact row - a symbol can have several (a recycled
// ticker keeps its delisted row).
export function stockHref(symbol, id) {
  return `/${encodeURIComponent(symbol.toLowerCase())}${id ? `?id=${id}` : ''}`;
}

// Why fields are still empty after an add - `report` is the `autofill` object from
// POST /api/stocks, GET /api/stocks/:id or by-symbol (see autoFillNewStock in routes/stocks.js).
export function autoFillProblems(report, t) {
  const lines = [];
  if (!report || report.pending) return lines;
  const { details, cusip } = report;
  if (details.status === 'not_found') lines.push(t('afDetailsLabel') + t('afDetailsNotFound'));
  else if (details.status === 'error') lines.push(t('afDetailsLabel') + t('afError')(details.message));
  if (cusip.status === 'conflict') {
    lines.push(t('afCusipLabel') + t('afCusipConflict')(cusip.cusip, cusip.source, cusip.conflict_symbol));
  } else if (cusip.status === 'error') {
    lines.push(t('afCusipLabel') + t('afError')(cusip.message));
  } else if (cusip.status === 'not_found') {
    const reasons = (cusip.reasons || []).map((r) => {
      const describe = t('afReasons')[r.code];
      return `${r.source}: ${describe ? describe(r.detail) : r.code}`;
    });
    lines.push(t('afCusipLabel') + t('afCusipNoSource') + reasons.join('; '));
  }
  return lines;
}

// When a missing part will be looked up again (or that retries are over).
export function retryNote(report, t, key = 'afRetryAt') {
  if (report.next_retry_at) {
    const time = new Date(report.next_retry_at).toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });
    return t(key)(time);
  }
  return report.retries_exhausted ? t('afRetriesExhausted') : null;
}
