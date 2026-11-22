import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

// Запуск: node src/cluster.js
// WEB_CONCURRENCY=3 — 3 HTTP-воркера + primary; один воркер дополнительно
// выполняет фоновые задачи и Telegram-бот. WEB_CONCURRENCY=1 — обычный режим.
const requested = Number(process.env.WEB_CONCURRENCY || 3);
const count = Math.max(1, Math.min(4, Number.isFinite(requested) ? Math.floor(requested) : 3, availableParallelism?.() || 4));

if (count <= 1) {
  await import('./index.js');
} else if (cluster.isPrimary) {
  // Миграции выполняем один раз до старта воркеров, чтобы они не гонялись
  // за один и тот же user_version в SQLite.
  const { db } = await import('./db.js');
  db.close();

  let shuttingDown = false;

  function spawnWorker(services) {
    const worker = cluster.fork({
      ...process.env,
      CLUSTER_WORKER: '1',
      CLUSTER_SERVICES: services ? '1' : '0'
    });
    worker.__cqServices = services;
    return worker;
  }

  for (let i = 0; i < count; i += 1) spawnWorker(i === 0);
  console.log(`code-qr cluster: ${count} workers (services on worker 0)`);

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return;
    console.error(`code-qr worker ${worker.process.pid} exited (${code ?? signal}), respawning`);
    spawnWorker(Boolean(worker.__cqServices));
  });

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`code-qr cluster: ${signal}, stopping workers`);
    for (const worker of Object.values(cluster.workers || {})) {
      try { worker.kill('SIGTERM'); } catch { /* ignore */ }
    }
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} else {
  await import('./index.js');
}
