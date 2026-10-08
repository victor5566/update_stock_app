import { MONITOR_CATEGORIES, describeNote, isApplyResult, noteKind } from './monitorCategories';
import { TRANSLATIONS } from '../translations';

const t = (key) => TRANSLATIONS.zh[key];

// The strings planRow() in lib/stockMonitor.js produces - if one changes there, change it here
// and in NOTE_PATTERNS.
test('server note strings are categorized and translated', () => {
  expect(noteKind('symbol is trading under another company (Tradr 2X Long FLY Daily ETF) - left delisted'))
    .toMatchObject({ kind: 'recycled', arg: 'Tradr 2X Long FLY Daily ETF' });
  expect(noteKind('symbol is trading, but another live row already has it').kind).toBe('duplicate');
  expect(noteKind('name differs: Logan Capital Large Cap Growth ETF')).toMatchObject({ kind: 'nameDiffers', arg: 'Logan Capital Large Cap Growth ETF' });
  expect(noteKind('something new').kind).toBe('otherNote');
  expect(describeNote('name differs: X Corp', t)).toContain('X Corp');
  expect(describeNote('something new', t)).toBe('something new');
});

test('a row can be in several categories', () => {
  const item = {
    changes: [{ field: 'company_name', from: 'A', to: 'B' }, { field: 'category', from: null, to: 'OTC Markets OTCPK - PNK' }],
    notes: [],
  };
  const keys = MONITOR_CATEGORIES.filter((c) => c.test(item)).map((c) => c.key);
  expect(keys).toEqual(['name', 'category']);
});

test('every category has a label in both languages', () => {
  for (const lang of ['zh', 'en']) {
    for (const c of MONITOR_CATEGORIES) expect(TRANSLATIONS[lang].monitorCats[c.key]).toBeTruthy();
  }
});

test('a rename blocked by the (symbol, name) index is its own category', () => {
  const note = 'name already used by another row with this symbol (id 8837, delisted): ADC Therapeutics SA - nothing changed';
  expect(noteKind(note)).toMatchObject({ kind: 'nameTaken', args: ['8837', ', delisted', 'ADC Therapeutics SA'] });
  const text = describeNote(note, t);
  expect(text).toContain('ADC Therapeutics SA');
  expect(text).toContain('8837');
  expect(text).toContain('已下市');
  expect(describeNote('name already used by another row with this symbol (id 5): X Corp - nothing changed', t)).not.toContain('已下市');
});

test('an applying run lists changed and filled rows, not note-only rows', () => {
  const base = { changes: [], notes: [] };
  const filled = { ...base, filled: { details: ['sector'], cusip: '037833100' } };
  expect(MONITOR_CATEGORIES.filter((c) => c.test(filled)).map((c) => c.key)).toEqual(['detailsFilled', 'cusipFilled']);
  const conflict = { ...base, cusipConflict: { cusip: '037833100', id: 1, stock_symbol: 'AAPL' } };
  expect(MONITOR_CATEGORIES.filter((c) => c.test(conflict)).map((c) => c.key)).toEqual(['cusipConflict']);
  expect(MONITOR_CATEGORIES.find((c) => c.key === 'error').test({ ...base, fillError: { part: 'cusip', message: 'timeout' } })).toBe(true);
  expect(isApplyResult(filled)).toBe(true);
  expect(isApplyResult(conflict)).toBe(true);
  expect(isApplyResult({ ...base, changes: [{ field: 'exchange', from: 'PNK', to: 'OTC' }] })).toBe(true);
  expect(isApplyResult({ ...base, notes: ['name differs: X Corp'] })).toBe(false);
  expect(t('monitorCusipConflict')(conflict.cusipConflict)).toContain('AAPL');
});
