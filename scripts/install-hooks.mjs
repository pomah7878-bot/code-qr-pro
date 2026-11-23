import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
try { execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' }); console.log('hooks installed'); } catch (e) { console.error(e.message); process.exit(1); }
if (process.platform !== 'win32') { try { chmodSync('.githooks/pre-commit', 0o755); } catch {} }
