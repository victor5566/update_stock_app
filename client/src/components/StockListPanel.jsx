// Stock list tab: search, market filter, CSV export and server-side paging (the table has
// ~79k rows, so only one page is ever loaded).
import { useT } from '../i18n';
import { API, PAGE_SIZE, cx } from '../lib/stocks';
import { Badge, Button, Card, Input, Pagination, Select, StockLink, Table, TD } from './ui';

export default function StockListPanel({ stockPage, loading, search, marketFilter, markets, onSearch, onMarketFilter, onPage }) {
  const t = useT();
  const { rows, total, page } = stockPage;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Exports exactly what the list shows: same filters (all pages), all columns.
  function exportCsv() {
    const params = new URLSearchParams();
    if (marketFilter) params.set('market', marketFilter);
    if (search.trim()) params.set('q', search.trim());
    window.location.href = `${API}/stocks/export.csv?${params.toString()}`;
  }

  return (
    <Card title={t('tabList')}>
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_14rem_auto]">
        <Input type="search" id="search-input" placeholder={t('searchPlaceholder')} value={search} onChange={(e) => onSearch(e.target.value)} />
        {/* A <select>, not a datalist input: once a datalist input held "OTC" the browser only
            suggested values matching "OTC", with no way back to the other markets. */}
        <Select id="market-filter" value={marketFilter} onChange={(e) => onMarketFilter(e.target.value)}>
          <option value="">{t('allMarkets')}</option>
          {markets.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Button id="export-csv-btn" onClick={exportCsv}>{t('exportCsvBtn')}</Button>
      </div>

      <Table id="stock-table" head={[t('labelSymbol'), t('labelCompany'), t('labelMarket'), t('labelDelisted'), t('labelUpdated')]}>
        {rows.map((stock) => (
          <tr key={stock.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
            <td className={TD}><StockLink symbol={stock.stock_symbol} id={stock.id} /></td>
            <td className={cx(TD, 'text-slate-900 dark:text-slate-100')}>{stock.company_name}</td>
            <td className={TD}>{stock.exchange}</td>
            <td className={TD}>{stock.isdelisted ? <Badge tone="red">{t('delisted')}</Badge> : <Badge tone="green">{t('listed')}</Badge>}</td>
            <td className={cx(TD, 'whitespace-nowrap text-xs')}>{stock.updated_at ? new Date(stock.updated_at).toLocaleString(t('locale')) : ''}</td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 && <p id="empty-state" className="py-8 text-center text-sm text-slate-800">{loading ? t('loading') : t('emptyState')}</p>}
      <Pagination page={page} totalPages={totalPages} total={total} onPage={onPage} />
    </Card>
  );
}
