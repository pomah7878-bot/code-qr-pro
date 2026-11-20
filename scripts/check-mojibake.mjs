#!/usr/bin/env node
/**
 * Проверка на «кракозябры» (UTF-8, прочитанный как Windows-1251).
 * Запуск: node scripts/check-mojibake.mjs
 * Выход 1, если найдены подозрительные строки — удобно для CI/pre-commit.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['web/src', 'server/src', 'deploy', 'scripts'];
const EXTS = new Set(['.js', '.mjs', '.vue', '.yml', '.yaml', '.md', '.sh', '.json', '.css', '.html']);
const MARKER = /(?:вЂ|Р[џѕ°Ѓ‚„…†‡€‰‹‘’“”•–—™љ›њћџ]|С[‚ѓ„…†‡€‰‹‘’“”•–—™љ›њћџ]|Р[РС][а-яА-Я])/;

const rows = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry.name)) walk(p);
      continue;
    }
    if (!EXTS.has(path.extname(entry.name))) continue;
    // сами проверки содержат искомые последовательности в регулярках — их пропускаем
    if (/(check-mojibake|mojibake-ui-check|ai-support-ui|help-page-check)/.test(entry.name)) continue;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (MARKER.test(line)) rows.push({ file: p.replace(/\\/g, '/'), line: i + 1, text: line.trim().slice(0, 100) });
    });
  }
}
for (const root of ROOTS) if (fs.existsSync(root)) walk(root);

if (!rows.length) {
  console.log('mojibake: ok');
  process.exit(0);
}
console.log(`mojibake найдена: ${rows.length} строк(и)`);
for (const r of rows.slice(0, 30)) console.log(`${r.file}:${r.line}  ${r.text}`);
if (rows.length > 30) console.log(`… и ещё ${rows.length - 30}`);
process.exit(1);
