// Categories for the stock monitor report, so a long report can be filtered by why a row is
// in it. The notes arrive as English strings from planRow() in lib/stockMonitor.js (server);
// NOTE_PATTERNS matches them to categorize and translate them - keep the two in sync, or a
// changed note falls into "other notes" untranslated.
export const NOTE_PATTERNS = {
  recycled: /^symbol is trading under another company \((.*)\) - left delisted$/,
  duplicate: /^symbol is trading, but another live row already has it$/,
  nameDiffers: /^name differs: (.*)$/,
  // the table's unique (stock_symbol, company_name) index: another row already has symbol + new name
  nameTaken: /^name already used by another row with this symbol \(id (\d+)(, delisted)?\): (.*) - nothing changed$/,
};

export function noteKind(note) {
  for (const [kind, re] of Object.entries(NOTE_PATTERNS)) {
    const m = note.match(re);
    if (m) return { kind, arg: m[1], args: m.slice(1) };
  }
  return { kind: 'otherNote' };
}

export function describeNote(note, t) {
  const { kind, args } = noteKind(note);
  return kind === 'otherNote' ? note : t('monitorNotes')[kind](...args);
}

const hasChange = (field, to) => (item) => item.changes.some((c) => c.field === field && (to === undefined || c.to === to));
const hasNote = (kind) => (item) => item.notes.some((n) => noteKind(n).kind === kind);

// One row can be in several categories. Grouped into what was changed, what needs a person,
// and errors.
export const MONITOR_CATEGORIES = [
  { key: 'delist', group: 'changes', tone: 'red', test: hasChange('isdelisted', true) },
  { key: 'revive', group: 'changes', tone: 'green', test: hasChange('isdelisted', false) },
  { key: 'name', group: 'changes', tone: 'blue', test: hasChange('company_name') },
  { key: 'exchange', group: 'changes', tone: 'blue', test: hasChange('exchange') },
  { key: 'category', group: 'changes', tone: 'blue', test: hasChange('category') },
  { key: 'currency', group: 'changes', tone: 'blue', test: hasChange('currency') },
  { key: 'recycled', group: 'review', tone: 'amber', test: hasNote('recycled') },
  { key: 'duplicate', group: 'review', tone: 'amber', test: hasNote('duplicate') },
  { key: 'nameDiffers', group: 'review', tone: 'amber', test: hasNote('nameDiffers') },
  { key: 'nameTaken', group: 'review', tone: 'amber', test: hasNote('nameTaken') },
  { key: 'otherNote', group: 'review', tone: 'gray', test: hasNote('otherNote') },
  { key: 'error', group: 'errors', tone: 'red', test: (item) => Boolean(item.error) },
];

export const MONITOR_GROUPS = [
  { key: 'changes', labelKey: 'monitorGroupChanges' },
  { key: 'review', labelKey: 'monitorGroupReview' },
  { key: 'errors', labelKey: 'monitorGroupErrors' },
];
