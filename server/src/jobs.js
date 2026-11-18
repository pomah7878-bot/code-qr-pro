import bwipjs from 'bwip-js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const JOBS_DIR = process.env.JOBS_DIR || join(__dirname, '..', 'data', 'jobs');

// задания, прерванные перезапуском сервера, помечаем ошибкой
db.prepare("UPDATE generation_jobs SET status='error', error='Прервано перезапуском сервера', finished_at=datetime('now') WHERE status IN ('queued','running')").run();

const queue = [];
let running = false;

export function enqueue(jobId) {
  queue.push(jobId);
  if (!running) run();
}

async function run() {
  running = true;
  while (queue.length) {
    const id = queue.shift();
    try { await processJob(id); }
    catch (e) {
      db.prepare("UPDATE generation_jobs SET status='error', error=?, finished_at=datetime('now') WHERE id=?")
        .run(String(e?.message || e), id);
    }
  }
  running = false;
}

function bwipOpts(item, mode) {
  return {
    bcid: mode === 'text' ? 'datamatrix' : 'gs1datamatrix',
    text: item.normalized,
    scale: 6,
    paddingwidth: 12,
    paddingheight: 12,
    includetext: false
  };
}

async function processJob(jobId) {
  const job = db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(jobId);
  if (!job) return;
  db.prepare("UPDATE generation_jobs SET status='running' WHERE id=?").run(jobId);
  const items = db.prepare("SELECT * FROM job_items WHERE job_id=? AND status='ok' ORDER BY row_index").all(jobId);
  const dir = join(JOBS_DIR, String(jobId));
  mkdirSync(dir, { recursive: true });
  let done = 0;
  for (const item of items) {
    const png = await bwipjs.toBuffer(bwipOpts(item, job.mode));
    writeFileSync(join(dir, item.row_index + '.png'), png);
    db.prepare("UPDATE job_items SET status='generated' WHERE id=?").run(item.id);
    done++;
    if (done % 10 === 0) {
      db.prepare('UPDATE generation_jobs SET done=? WHERE id=?').run(done, jobId);
      await new Promise(r => setImmediate(r));
    }
  }
  db.prepare("UPDATE generation_jobs SET done=?, status='done', finished_at=datetime('now') WHERE id=?").run(done, jobId);
}

export async function renderSVG(item, mode) {
  return bwipjs.toSVG(bwipOpts(item, mode));
}

export function removeJobFiles(jobId) {
  rmSync(join(JOBS_DIR, String(jobId)), { recursive: true, force: true });
}
