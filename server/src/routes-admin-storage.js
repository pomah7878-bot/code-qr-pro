import { existsSync } from 'node:fs';
import { readdir, stat, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { db } from './db.js';
import { planOf } from './plans.js';
import { requireAdmin } from './lib/admin.js';
import { ARTIFACTS_DIR } from './lib/artifacts.js';

const MB = 1024 * 1024;
let cache = null;

async function scanDisk() {
  const users = new Map();
  let files = 0, bytes = 0;
  if (!existsSync(ARTIFACTS_DIR)) return { users, files, bytes, keys: new Set() };
  const dirs = await readdir(ARTIFACTS_DIR, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory() || !/^\d+$/.test(dir.name)) continue;
    const uid = Number(dir.name);
    let u = users.get(uid);
    if (!u) { u = { files: 0, bytes: 0 }; users.set(uid, u); }
    const names = await readdir(join(ARTIFACTS_DIR, dir.name), { withFileTypes: true });
    for (const f of names) {
      if (!f.isFile() || !f.name.endsWith('.zip')) continue;
      try {
        const st = await stat(join(ARTIFACTS_DIR, dir.name, f.name));
        u.files++; u.bytes += st.size; files++; bytes += st.size;
      } catch { /* файл исчез во время сканирования */ }
    }
  }
  return { users, files, bytes };
}

async function diskInfo() {
  try {
    const s = await statfs(existsSync(ARTIFACTS_DIR) ? ARTIFACTS_DIR : dirname(ARTIFACTS_DIR));
    return { total: Number(s.blocks) * Number(s.bsize), free: Number(s.bavail) * Number(s.bsize) };
  } catch { return { total: 0, free: 0 }; }
}

async function buildStorage() {
  const disk = await scanDisk();
  const diskInfoValue = await diskInfo();
  const users = db.prepare(
    `SELECT u.id, u.email, u.name, u.plan, u.status,
            COUNT(j.id) AS jobs,
            SUM(CASE WHEN j.artifact_key IS NOT NULL THEN 1 ELSE 0 END) AS archives,
            COALESCE(SUM(j.artifact_size),0) AS db_bytes,
            COALESCE(SUM(CASE WHEN j.artifact_backend='s3' THEN j.artifact_size ELSE 0 END),0) AS s3_bytes,
            COALESCE(SUM(CASE WHEN j.artifact_backend='local' THEN j.artifact_size ELSE 0 END),0) AS local_db_bytes,
            MAX(j.archived_at) AS last_archived
     FROM users u LEFT JOIN generation_jobs j ON j.user_id=u.id
     GROUP BY u.id HAVING jobs > 0 OR db_bytes > 0
     ORDER BY db_bytes DESC`
  ).all();
  const dbKeys = new Set(db.prepare('SELECT artifact_key FROM generation_jobs WHERE artifact_key IS NOT NULL').all().map((r) => r.artifact_key));
  const diskKeys = new Set();
  if (existsSync(ARTIFACTS_DIR)) {
    try {
      for (const d of await readdir(ARTIFACTS_DIR, { withFileTypes: true })) {
        if (!d.isDirectory() || !/^\d+$/.test(d.name)) continue;
        for (const f of await readdir(join(ARTIFACTS_DIR, d.name), { withFileTypes: true })) {
          if (f.isFile() && f.name.endsWith('.zip')) diskKeys.add(`${d.name}/${f.name}`);
        }
      }
    } catch { /* ignore */ }
  }
  let orphanBytes = 0;
  // точный размер сиротских файлов
  try {
    for (const key of diskKeys) {
      if (dbKeys.has(key)) continue;
      const p = join(ARTIFACTS_DIR, key);
      const st = await stat(p);
      orphanBytes += st.size;
    }
  } catch { /* ignore */ }

  const rows = users.map((u) => {
    const plan = planOf({ id: u.id, plan: u.plan });
    const diskUser = disk.users.get(u.id) || { files: 0, bytes: 0 };
    const quota = Math.max(1, Number(plan.archiveMb) || 1) * MB;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      plan: u.plan,
      status: u.status,
      jobs: u.jobs,
      archives: u.archives,
      dbBytes: u.db_bytes,
      localDbBytes: u.local_db_bytes,
      s3Bytes: u.s3_bytes,
      diskBytes: diskUser.bytes,
      diskFiles: diskUser.files,
      quotaMb: plan.archiveMb,
      quotaPct: Math.min(100, Math.round((u.db_bytes / quota) * 100)),
      lastArchived: u.last_archived
    };
  });

  const totals = {
    clients: rows.length,
    jobs: rows.reduce((s, r) => s + r.jobs, 0),
    archives: rows.reduce((s, r) => s + r.archives, 0),
    dbBytes: rows.reduce((s, r) => s + r.dbBytes, 0),
    localDbBytes: rows.reduce((s, r) => s + r.localDbBytes, 0),
    s3Bytes: rows.reduce((s, r) => s + r.s3Bytes, 0),
    diskBytes: disk.bytes,
    diskFiles: disk.files,
    orphanBytes,
    diskTotal: diskInfoValue.total,
    diskFree: diskInfoValue.free
  };
  return { totals, users: rows };
}

export async function registerAdminStorageRoutes(app) {
  app.get('/api/admin/storage', { preHandler: requireAdmin }, async () => {
    if (cache && Date.now() - cache.at < 10_000) return cache.data;
    const data = await buildStorage();
    cache = { at: Date.now(), data };
    return data;
  });
}
