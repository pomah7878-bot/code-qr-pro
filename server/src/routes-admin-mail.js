import { db } from './db.js';
import { setSetting, getSetting } from './settings.js';
import { s3Config, s3Configured, testS3 } from './lib/s3.js';
import { requireAdmin, paging } from './lib/admin.js';
import { audit } from './lib/audit.js';
import {
  smtpConfig, smtpConfigured, verifySmtp, sendMail, renderEmail, readUnsubscribeToken, publicUrl
} from './lib/mailer.js';
import { pumpMailQueue } from './lib/mail-queue.js';

const SEGMENTS = {
  all: { label: 'Все активные', where: "u.status='active' AND u.email_opt_out=0" },
  free: { label: 'FREE', where: "u.status='active' AND u.email_opt_out=0 AND u.plan='free'" },
  premium: { label: 'PREMIUM', where: "u.status='active' AND u.email_opt_out=0 AND u.plan='premium'" },
  expired: {
    label: 'Истёкшие',
    where: "u.status='active' AND u.email_opt_out=0 AND u.plan='free' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=u.id AND s.status='expired')"
  },
  new30: { label: 'Новые за 30 дней', where: "u.status='active' AND u.email_opt_out=0 AND date(u.created_at) >= date('now','-29 days')" },
  inactive90: {
    label: 'Спящие 90 дней',
    where: "u.status='active' AND u.email_opt_out=0 AND (u.last_login_at IS NULL OR u.last_login_at < datetime('now','-90 days'))"
  }
};

const MAX_RECIPIENTS = 5000;

function segmentOf(name) {
  return SEGMENTS[String(name || '')] || null;
}

function countRecipients(where) {
  return db.prepare(`SELECT COUNT(*) c FROM users u WHERE ${where}`).get().c;
}

function mapCampaign(c) {
  return {
    id: c.id, segment: c.segment, subject: c.subject, body: c.body, total: c.total,
    sent: c.sent, failed: c.failed, status: c.status, createdAt: c.created_at, finishedAt: c.finished_at
  };
}

export async function registerAdminMailRoutes(app) {
  app.get('/api/admin/settings/smtp', { preHandler: requireAdmin }, async () => {
    const c = smtpConfig();
    return {
      host: c.host, port: c.port, secure: c.secure, user: c.user,
      fromName: c.fromName, fromEmail: c.fromEmail,
      configured: smtpConfigured(), hasPassword: Boolean(c.pass)
    };
  });

  app.put('/api/admin/settings/smtp', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    if (b.host !== undefined) {
      const host = String(b.host).trim();
      if (!/^[a-z0-9.-]{3,120}$/i.test(host)) return reply.code(400).send({ error: 'Некорректный SMTP-хост' });
    }
    if (b.port !== undefined) {
      const port = Math.round(Number(b.port));
      if (!Number.isFinite(port) || port < 1 || port > 65535) return reply.code(400).send({ error: 'Порт: 1–65535' });
    }
    if (b.fromEmail !== undefined && String(b.fromEmail) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.fromEmail))) {
      return reply.code(400).send({ error: 'Некорректный email отправителя' });
    }
    const pairs = [
      ['smtp_host', b.host], ['smtp_port', b.port],
      ['smtp_secure', b.secure !== undefined ? (b.secure ? '1' : '0') : undefined],
      ['smtp_user', b.user], ['smtp_pass', b.pass],
      ['smtp_from_name', b.fromName], ['smtp_from_email', b.fromEmail]
    ];
    for (const [key, value] of pairs) {
      if (value === undefined || (key === 'smtp_pass' && value === '')) continue;
      setSetting(key, String(value).slice(0, 200));
    }
    audit(req, 'settings.smtp', 'settings', 'smtp', {
      host: b.host, port: b.port, fromEmail: b.fromEmail, passwordChanged: Boolean(b.pass)
    });
    return { ok: true, configured: smtpConfigured() };
  });

  app.post('/api/admin/settings/smtp/test', { preHandler: requireAdmin }, async (req, reply) => {
    if (!smtpConfigured()) return reply.code(400).send({ error: 'Сначала заполните SMTP-настройки' });
    const to = String(req.body?.to || req.user.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return reply.code(400).send({ error: 'Некорректный адрес получателя' });
    try {
      await verifySmtp();
      const { html, text } = renderEmail('Это тестовое письмо из админки CODE QR PRO. SMTP настроен правильно.', null);
      await sendMail({ to, subject: 'CODE QR PRO — проверка SMTP', text, html });
      audit(req, 'mail.test', 'settings', 'smtp', { to });
      return { ok: true };
    } catch (e) {
      return reply.code(502).send({ error: 'SMTP не принял письмо: ' + String(e?.message || e) });
    }
  });

  // Предпросмотр кампании: сколько получателей и как выглядит письмо
  app.post('/api/admin/email/preview', { preHandler: requireAdmin }, async (req, reply) => {
    const segment = segmentOf(req.body?.segment);
    if (!segment) return reply.code(400).send({ error: 'Неизвестный сегмент' });
    const body = String(req.body?.body || '').trim();
    if (!body) return reply.code(400).send({ error: 'Введите текст письма' });
    const total = countRecipients(segment.where);
    const sample = db.prepare(`SELECT id FROM users u WHERE ${segment.where} LIMIT 1`).get();
    return {
      total,
      segmentLabel: segment.label,
      html: renderEmail(body, sample?.id || null).html,
      unsubscribeUrl: sample?.id ? `${publicUrl()}/api/email/unsubscribe?t=...` : ''
    };
  });

  app.get('/api/admin/email/campaigns', { preHandler: requireAdmin }, async (req) => {
    const { page, per, offset } = paging(req.query, 25);
    const campaigns = db.prepare('SELECT * FROM email_campaigns ORDER BY id DESC LIMIT ? OFFSET ?').all(per, offset);
    const total = db.prepare('SELECT COUNT(*) c FROM email_campaigns').get().c;
    return {
      campaigns: campaigns.map(mapCampaign),
      segments: Object.entries(SEGMENTS).map(([id, s]) => ({ id, label: s.label, count: countRecipients(s.where) })),
      total, page, per
    };
  });

  app.get('/api/admin/email/campaigns/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const c = db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(req.params.id);
    if (!c) return reply.code(404).send({ error: 'Кампания не найдена' });
    const outbox = db.prepare('SELECT id, to_email, status, error, sent_at FROM email_outbox WHERE campaign_id=? ORDER BY id DESC LIMIT 50').all(c.id);
    return { campaign: mapCampaign(c), outbox };
  });

  app.post('/api/admin/email/send', { preHandler: requireAdmin }, async (req, reply) => {
    if (!smtpConfigured()) return reply.code(400).send({ error: 'SMTP не настроен — письма не уйдут' });
    const segment = segmentOf(req.body?.segment);
    if (!segment) return reply.code(400).send({ error: 'Неизвестный сегмент' });
    const subject = String(req.body?.subject || '').trim().slice(0, 200);
    const body = String(req.body?.body || '').trim().slice(0, 20000);
    if (!subject) return reply.code(400).send({ error: 'Введите тему письма' });
    if (!body) return reply.code(400).send({ error: 'Введите текст письма' });
    const recipients = db.prepare(`SELECT id, email FROM users u WHERE ${segment.where} LIMIT ${MAX_RECIPIENTS}`).all();
    if (!recipients.length) return reply.code(400).send({ error: 'В сегменте нет получателей' });

    const campaignId = db.transaction(() => {
      const info = db.prepare(`INSERT INTO email_campaigns (segment, subject, body, total, status, created_by)
        VALUES (?,?,?,?, 'queued', ?)`)
        .run(req.body.segment, subject, body, recipients.length, req.user.id);
      const ins = db.prepare('INSERT INTO email_outbox (campaign_id, user_id, to_email, subject, body) VALUES (?,?,?,?,?)');
      for (const r of recipients) ins.run(info.lastInsertRowid, r.id, r.email, subject, body);
      return info.lastInsertRowid;
    })();

    audit(req, 'mail.send', 'campaign', campaignId, { segment: req.body.segment, total: recipients.length });
    pumpMailQueue().catch(() => {});
    return { campaign: mapCampaign(db.prepare('SELECT * FROM email_campaigns WHERE id=?').get(campaignId)) };
  });

  // Публичная отписка по ссылке из письма
  app.get('/api/admin/settings/storage', { preHandler: requireAdmin }, async () => {
    const c = s3Config();
    return {
      configured: s3Configured(),
      endpoint: c.endpoint,
      region: c.region,
      bucket: c.bucket,
      prefix: c.prefix,
      forcePathStyle: c.forcePathStyle,
      accessKeySet: Boolean(getSetting('s3_access_key', '')),
      secretKeySet: Boolean(getSetting('s3_secret_key', ''))
    };
  });

  app.put('/api/admin/settings/storage', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    if (b.endpoint !== undefined && String(b.endpoint) && !/^https?:\/\//i.test(String(b.endpoint))) {
      return reply.code(400).send({ error: 'Endpoint должен начинаться с http:// или https://' });
    }
    if (b.bucket !== undefined && String(b.bucket) && !/^[A-Za-z0-9._-]{2,100}$/.test(String(b.bucket))) {
      return reply.code(400).send({ error: 'Некорректное имя bucket' });
    }
    const pairs = [
      ['s3_endpoint', b.endpoint], ['s3_region', b.region], ['s3_bucket', b.bucket],
      ['s3_prefix', b.prefix], ['s3_access_key', b.accessKey], ['s3_secret_key', b.secretKey],
      ['s3_force_path', b.forcePathStyle !== undefined ? (b.forcePathStyle ? '1' : '0') : undefined]
    ];
    for (const [key, value] of pairs) {
      if (value === undefined) continue;
      if ((key === 's3_access_key' || key === 's3_secret_key') && value === '') continue;
      setSetting(key, String(value).slice(0, 500));
    }
    audit(req, 'settings.storage', 'settings', 's3', { bucket: b.bucket, endpoint: b.endpoint });
    return { ok: true, configured: s3Configured() };
  });

  app.post('/api/admin/settings/storage/test', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return await testS3();
    } catch (e) {
      return reply.code(502).send({ error: String(e?.message || e) });
    }
  });

  app.get('/api/email/unsubscribe', async (req, reply) => {
    const userId = readUnsubscribeToken(req.query?.t);
    const page = (title, text) => `<!doctype html><html lang="ru"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
      <body style="font-family:Inter,Arial,sans-serif;background:#f6f7fb;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
      <div style="max-width:420px;background:#fff;border-radius:16px;padding:32px;text-align:center">
      <div style="font-weight:800;color:#4f46e5;margin-bottom:16px">CODE QR PRO</div>
      <p style="font-size:15px;line-height:1.6">${text}</p></div></body></html>`;
    if (!userId) {
      return reply.code(400).type('text/html; charset=utf-8').send(page('Ссылка недействительна', 'Ссылка для отписки недействительна или устарела.'));
    }
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(userId);
    if (user) db.prepare('UPDATE users SET email_opt_out=1 WHERE id=?').run(userId);
    return reply.type('text/html; charset=utf-8').send(page('Вы отписаны', 'Готово: вы больше не будете получать рассылки CODE QR PRO.'));
  });
}
