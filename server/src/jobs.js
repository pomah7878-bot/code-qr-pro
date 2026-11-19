import bwipjs from 'bwip-js';
import archiver from 'archiver';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, createWriteStream, createReadStream, existsSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { toRawGs1, gs1BarcodeText } from './gs1.js';
import { planDef } from './plans.js';
import { artifactKey, ensureArtifactDir, removeArtifact } from './lib/artifacts.js';

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
  const raw = toRawGs1(item.raw || item.normalized || '');
  return {
    bcid: 'datamatrix',
    text: mode === 'text' ? String(item.raw || item.normalized || '') : gs1BarcodeText(raw),
    parsefnc: mode !== 'text',
    scale: 6,
    paddingwidth: 12,
    paddingheight: 12,
    includetext: false
  };
}

export async function renderPNG(item, mode) {
  return bwipjs.toBuffer(bwipOpts(item, mode));
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
    const png = await renderPNG(item, job.mode);
    writeFileSync(join(dir, item.row_index + '.png'), png);
    db.prepare("UPDATE job_items SET status='generated' WHERE id=?").run(item.id);
    done++;
    if (done % 10 === 0) {
      db.prepare('UPDATE generation_jobs SET done=? WHERE id=?').run(done, jobId);
      await new Promise(r => setImmediate(r));
    }
  }
  const user = db.prepare('SELECT plan FROM users WHERE id=?').get(job.user_id);
  const days = Math.max(1, Number(planDef(user?.plan).historyDays) || 7);
  db.prepare(
    "UPDATE generation_jobs SET done=?, status='done', finished_at=datetime('now'), expires_at=datetime('now','+' || ? || ' days') WHERE id=?"
  ).run(done, days, jobId);
  try {
    await archiveJob(jobId);
  } catch (e) {
    console.error('job archive failed:', e?.message || e);
  }
}

async function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

// Упаковываем результат один раз в ZIP, после чего построчные PNG можно удалить.
export async function archiveJob(jobId) {
  const job = db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(jobId);
  if (!job || job.status !== 'done') return null;
  const items = db.prepare("SELECT * FROM job_items WHERE job_id=? AND status='generated' ORDER BY row_index").all(job.id);
  if (!items.length) return null;
  const key = artifactKey(job.user_id, job.id);
  const path = ensureArtifactDir(key);
  const tmp = `${path}.tmp-${process.pid}`;
  const output = createWriteStream(tmp);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const finished = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  for (const item of items) {
    const ext = job.format === 'svg' ? 'svg' : 'png';
    const name = `${item.row_index}.${ext}`;
    if (ext === 'svg') archive.append(await renderSVG(item, job.mode), { name });
    else {
      const p = join(JOBS_DIR, String(job.id), item.row_index + '.png');
      if (existsSync(p)) archive.file(p, { name });
      else archive.append(await renderPNG(item, job.mode), { name });
    }
  }
  await archive.finalize();
  await finished;
  const size = statSync(tmp).size;
  const sha = await sha256File(tmp);
  renameSync(tmp, path);
  const user = db.prepare('SELECT plan FROM users WHERE id=?').get(job.user_id);
  const days = Math.max(1, Number(planDef(user?.plan).historyDays) || 7);
  db.prepare(
    `UPDATE generation_jobs
     SET artifact_key=?, artifact_size=?, artifact_sha=?, archived_at=datetime('now'),
         expires_at=COALESCE(expires_at, datetime('now','+' || ? || ' days'))
     WHERE id=?`
  ).run(key, size, sha, days, job.id);
  // построчные файлы больше не нужны: PNG/SVG при необходимости пересоберутся из БД
  try { rmSync(join(JOBS_DIR, String(job.id)), { recursive: true, force: true }); } catch { /* ignore */ }
  return { key, size, sha };
}

export async function renderSVG(item, mode) {
  return bwipjs.toSVG(bwipOpts(item, mode));
}

export function removeJobFiles(jobId) {
  const job = db.prepare('SELECT artifact_key FROM generation_jobs WHERE id=?').get(jobId);
  if (job?.artifact_key) removeArtifact(job.artifact_key);
  rmSync(join(JOBS_DIR, String(jobId)), { recursive: true, force: true });
}

export function cleanupExpiredJobs() {
  try {
    const expired = db.prepare(
      "SELECT id FROM generation_jobs WHERE expires_at IS NOT NULL AND expires_at <= datetime('now') AND status IN ('done','error')"
    ).all();
    for (const job of expired) {
      try { removeJobFiles(job.id); } catch { /* ignore */ }
      db.prepare('DELETE FROM generation_jobs WHERE id=?').run(job.id);
    }
    db.prepare("DELETE FROM activity_log WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')").run();
  } catch (e) {
    console.error('history cleanup failed:', e?.message || e);
  }
}
