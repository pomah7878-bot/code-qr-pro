import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const out = [];
const pass = (m) => out.push(['OK', m]);
const warn = (m) => out.push(['WARN', m]);

let files = [];
try { files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean); } catch {}

const patterns = [
  /(^|\/)\.env$/, /(^|\/)\.env\./, /\.app-key$/, /(^|\/)data\/app\.db/,
  /id_rsa/, /\.pem$/, /\.p12$/, /bridge-token\.txt$/
];
const risky = files.filter((f) => f !== '.env.example' && patterns.some((r) => r.test(f)));
if (risky.length) warn('В Git отслеживаются потенциально секретные файлы: ' + risky.join(', '));
else pass('Секретные файлы (.env, БД, ключи) не отслеживаются Git');

const gi = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
for (const p of ['.env', 'server/data/', '*.log', 'bridge-token.txt']) {
  if (gi.includes(p)) pass('.gitignore содержит ' + p);
  else warn('.gitignore не содержит ' + p);
}

for (const f of ['server/.env', 'server/data/app.db']) {
  if (!existsSync(f)) { warn('Нет файла ' + f + ' в текущем checkout — это нормально для удалённой копии'); continue; }
  if (process.platform !== 'win32') {
    const mode = statSync(f).mode & 0o777;
    if ((mode & 0o077) === 0) pass(f + ' доступен только владельцу'); else warn(f + ' слишком открыт: ' + mode.toString(8));
  }
}

const workflow = existsSync('.github/workflows/security.yml');
workflow ? pass('GitHub Actions security workflow добавлен') : warn('Нет security workflow');
existsSync('SECURITY.md') ? pass('SECURITY.md есть') : warn('Нет SECURITY.md');
existsSync('LICENSE') ? pass('LICENSE есть') : warn('Нет LICENSE');
existsSync('CONTRIBUTING.md') ? pass('CONTRIBUTING.md есть') : warn('Нет CONTRIBUTING.md');
existsSync('server/package-lock.json') ? pass('server lockfile есть') : warn('Нет server lockfile');
existsSync('web/package-lock.json') ? pass('web lockfile есть') : warn('Нет web lockfile');

console.log('CODE QR PRO · security audit\n');
for (const [level, msg] of out) console.log((level === 'OK' ? '✓' : '!') + ' [' + level + '] ' + msg);
const warnings = out.filter(([l]) => l === 'WARN').length;
console.log('\nИтог: ' + (out.length - warnings) + ' OK, ' + warnings + ' WARN');
process.exitCode = warnings ? 1 : 0;
