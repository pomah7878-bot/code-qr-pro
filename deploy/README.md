# CODE QR PRO — production deployment

Everything needed to rebuild the service is in this repository except runtime secrets, the SQLite database, generated artifacts and `web/dist`.

## Layout

```
server/                 Fastify API, SQLite migrations, jobs, labels, ads
server/src/             application source
server/scripts/         encrypted backup + restore verification
web/                    Vue/Vite frontend (build output is web/dist, not committed)
print-bridge/           Windows Print Bridge
deploy/                 systemd, nginx, backup and deploy helpers
scripts/                manual test scripts
.env.example            required production environment keys
```

## Prerequisites

- Ubuntu/Debian, Node.js 20+
- nginx 1.24+
- certbot (Let's Encrypt)
- `sqlite3`
- system user `codeqr`
- directories `/opt/code-qr`, `/opt/backups/code-qr`

## First install

```bash
sudo useradd --system --home /opt/code-qr --shell /usr/sbin/nologin codeqr
sudo mkdir -p /opt/code-qr /opt/backups/code-qr
sudo chown -R codeqr:codeqr /opt/code-qr /opt/backups/code-qr
sudo chmod 700 /opt/code-qr/server/data /opt/backups/code-qr
```

Copy the repository to `/opt/code-qr`, then:

```bash
cd /opt/code-qr/server
sudo -u codeqr npm ci --omit=dev
cp /opt/code-qr/.env.example /opt/code-qr/server/.env
# fill real values; chmod 600
sudo chmod 600 /opt/code-qr/server/.env
cd /opt/code-qr/web
sudo -u codeqr npm ci
sudo -u codeqr npm run build
```

Install the service:

```bash
sudo install -m 644 /opt/code-qr/deploy/code-qr.service /etc/systemd/system/code-qr.service
sudo systemctl daemon-reload
sudo systemctl enable --now code-qr
curl -s http://127.0.0.1:3100/api/health
```

The unit already contains `User=codeqr`, `NoNewPrivileges`, `ProtectSystem=strict`,
`ProtectHome`, `PrivateTmp` and `ReadWritePaths=/opt/code-qr/server/data`.

## nginx + TLS

The repository config is an HTTP-first template. On a new host:

```bash
sudo install -m 644 /opt/code-qr/deploy/nginx-code-qr.conf /etc/nginx/sites-available/code-qr.stockcity.ru.conf
sudo ln -s /etc/nginx/sites-available/code-qr.stockcity.ru.conf /etc/nginx/sites-enabled/code-qr.stockcity.ru.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d code-qr.stockcity.ru
```

Certbot manages the HTTPS server block. Keep `X-Forwarded-For $remote_addr` in the
proxy block: the app trusts only loopback and uses the real client address for rate limits.

## Environment

See `.env.example`. Important rules:

- `server/.env` is **not** in git and must be `600`.
- `APP_ENCRYPTION_KEY` / `.app-key` encrypts SMTP, S3, CZ tokens and TOTP secrets.
- Keep `.app-key` (or `APP_ENCRYPTION_KEY`) **outside** the backup directory.
- Without that key, encrypted backups and TOTP secrets cannot be recovered.
- `PUBLIC_URL` must be the public HTTPS origin.

## Backups

Daily encrypted backup (AES-256-GCM, `CQRE1` format):

```bash
sudo /opt/code-qr/deploy/backup.sh
```

Or install the supplied cron file:

```bash
sudo install -m 644 /opt/code-qr/deploy/code-qr-backup.cron /etc/cron.d/code-qr-backup
```

The script:

1. creates `app-YYYYMMDD-HHMMSS.db.enc` in `/opt/backups/code-qr`;
2. decrypts it again and runs `PRAGMA integrity_check`;
3. removes stale unencrypted `.gz` files;
4. keeps the latest 14 encrypted backups.

Manual verification (run as root; encrypted backups are `root:root 600`):

```bash
cd /opt/code-qr/server
sudo /usr/bin/node scripts/verify-backup.mjs
```

Restore procedure:

1. stop the service;
2. keep the current DB as `app.db.before-restore`;
3. decrypt the chosen `.enc` with `scripts/restore-backup.mjs` (it verifies `PRAGMA integrity_check` before replacing the target);
4. move it into `server/data/app.db` with owner `codeqr:codeqr`, mode `600`;
5. start the service and check `/api/health` (`db: ok`);
6. keep the old DB until the restored instance is verified.

```bash
cd /opt/code-qr/server
sudo /usr/bin/node scripts/restore-backup.mjs \
  /opt/backups/code-qr/app-YYYYMMDD-HHMMSS.db.enc \
  /opt/code-qr/server/data/app.db.restored
sudo chown codeqr:codeqr /opt/code-qr/server/data/app.db.restored
sudo chmod 600 /opt/code-qr/server/data/app.db.restored
```

Store an encrypted copy off-site (another host or S3) and keep the encryption key in a
separate secret manager/offline escrow. Local backups alone do not survive disk loss.

## Update

```bash
cd /opt/code-qr
sudo -u codeqr git pull --ff-only
cd server && sudo -u codeqr npm ci --omit=dev
cd ../web && sudo -u codeqr npm ci && sudo -u codeqr npm run build
sudo systemctl restart code-qr
curl -s http://127.0.0.1:3100/api/health
```

The database migrations run automatically on startup and are wrapped in transactions.

## Never commit

- `server/.env`
- `server/data/` (DB, WAL, jobs, artifacts, ads, `.app-key`)
- `web/dist/`
- `node_modules/`
- `bridge-token.txt`
- any backup archive or customer export
