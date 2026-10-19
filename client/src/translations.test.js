import fs from 'fs';
import path from 'path';
import { TRANSLATIONS } from './translations';

// English only since 2026-10-19 (the user had the Chinese interface removed).
test('only English text is defined', () => {
  expect(Object.keys(TRANSLATIONS)).toEqual(['en']);
});

// No CJK text anywhere in the UI source or the page shell.
test('no Chinese text in the client', () => {
  // CJK punctuation, ideographs and full-width forms; built from code points so this file itself
  // stays free of such characters.
  const range = (a, b) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
  const cjk = new RegExp(`[${range(0x3000, 0x303f)}${range(0x3400, 0x9fff)}${range(0xff00, 0xffef)}]`);
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx|html|css)$/.test(name)) files.push(full);
    }
  };
  walk(path.join(__dirname));
  files.push(path.join(__dirname, '..', 'public', 'index.html'));
  const offenders = files.filter((f) => cjk.test(fs.readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
