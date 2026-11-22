import { db, today } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { czStatus } from './cz.js';
import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';
import { invoiceSeller } from './lib/invoice.js';
import { tgConfigured, tgAdminIds, tgSendMessage } from './lib/telegram-api.js';
import { npdSettings, testNpdConnection, issueNpdReceiptForOrder, resendNpdReceipt } from './lib/npd-receipt.js';

export async function registerAdminRoutes(app) {
  app.get('/api/admin/stats', { preHandler: requireAdmin }, async () => ({
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    paid: db.prepare("SELECT COUNT(*) c FROM users WHERE plan IN ('start','pro','business','enterprise')").get().c,
    blocked: db.prepare("SELECT COUNT(*) c FROM users WHERE status='blocked'").get().c,
    jobs: db.prepare('SELECT COUNT(*) c FROM generation_jobs').get().c,
    codesToday: db.prepare('SELECT COALESCE(SUM(codes_generated),0) c FROM usage_daily WHERE day=?').get(today()).c,
    revenue: db.prepare("SELECT COALESCE(SUM(amount),0) c FROM orders WHERE status='paid'").get().c,
    pendingOrders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c,
    cz: czStatus()
  }));

  app.get('/api/admin/settings', { preHandler: requireAdmin }, async () => {
    const seller = invoiceSeller();
    return {
      czEnabled: getSetting('cz_enabled', '0') === '1',
      czApiUrl: getSetting('cz_api_url', 'https://api.mdlp.crpt.ru'),
      czConfigured: Boolean(getSetting('cz_token', '')),
      invoiceSignature: getSetting('invoice_signature_data', ''),
      telegram: { configured: tgConfigured(), admins: tgAdminIds() },
      invoice: {
        name: seller.name,
        status: seller.status,
        inn: seller.inn,
        address: seller.address,
        bank: seller.bank,
        bik: seller.bik,
        account: seller.account,
        corr: seller.corr,
        phone: seller.phone,
        email: seller.email,
        ready: seller.ready,
        missing: seller.missing
      }
    };
  });

  app.post('/api/admin/telegram/test', { preHandler: requireAdmin }, async (req, reply) => {
    if (!tgConfigured()) return reply.code(400).send({ error: 'Telegram-бот не настроен: проверьте TELEGRAM_BOT_TOKEN и TELEGRAM_ADMIN_ID' });
    const sent = [];
    for (const chatId of tgAdminIds()) {
      try { await tgSendMessage(chatId, '✅ <b>Тест админ-бота CODE QR PRO</b>\nБот на связи. Откройте /menu для управления.'); sent.push(chatId); }
      catch (e) { return reply.code(502).send({ error: String(e?.message || e) }); }
    }
    audit(req, 'settings.telegram_test', 'settings', 'telegram', { sent });
    return { ok: true, sent };
  });

  // --- Чеки НПД («Мой налог») ---
  app.get('/api/admin/npd/settings', { preHandler: requireAdmin }, async () => {
    const s = npdSettings();
    return { enabled: s.enabled, auto: s.auto, login: s.login, serviceName: s.serviceName, configured: s.configured };
  });

  app.put('/api/admin/npd/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    if (b.login !== undefined) {
      const login = String(b.login || '').trim();
      if (login && !/^\+?\d{10,12}$/.test(login)) return reply.code(400).send({ error: 'Логин «Мой налог» — ИНН (10–12 цифр) или телефон' });
      setSetting('npd_login', login);
    }
    if (b.password !== undefined && String(b.password || '').trim()) {
      if (String(b.password).length > 200) return reply.code(400).send({ error: 'Слишком длинный пароль' });
      setSetting('npd_password', String(b.password));
    }
    if (b.clearPassword === true) setSetting('npd_password', '');
    if (b.enabled !== undefined) setSetting('npd_enabled', b.enabled ? '1' : '0');
    if (b.auto !== undefined) setSetting('npd_auto', b.auto ? '1' : '0');
    if (b.serviceName !== undefined) setSetting('npd_service_name', String(b.serviceName || '').trim().slice(0, 120));
    audit(req, 'settings.npd', 'settings', 'npd', { enabled: Boolean(b.enabled), auto: b.auto !== false });
    const out = npdSettings();
    return { ok: true, enabled: out.enabled, auto: out.auto, login: out.login, serviceName: out.serviceName, configured: out.configured };
  });

  app.post('/api/admin/npd/test', { preHandler: requireAdmin }, async (req, reply) => {
    try { return { ok: true, ...(await testNpdConnection()) }; }
    catch (e) { return reply.code(502).send({ error: String(e?.message || e).slice(0, 300) }); }
  });

  app.post('/api/admin/npd/orders/:id/receipt', { preHandler: requireAdmin }, async (req, reply) => {
    try { return await issueNpdReceiptForOrder(Number(req.params.id), { force: true }); }
    catch (e) { return reply.code(502).send({ error: String(e?.message || e).slice(0, 300) }); }
  });

  app.post('/api/admin/npd/orders/:id/resend', { preHandler: requireAdmin }, async (req, reply) => {
    try { return await resendNpdReceipt(Number(req.params.id)); }
    catch (e) { return reply.code(502).send({ error: String(e?.message || e).slice(0, 300) }); }
  });

  app.put('/api/admin/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const { czEnabled, czApiUrl, czToken, invoice, invoiceSignature } = req.body || {};
    if (invoiceSignature !== undefined) {
      const raw = String(invoiceSignature || '');
      if (!raw) setSetting('invoice_signature_data', '');
      else {
        const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
        if (!m) return reply.code(400).send({ error: 'Подпись должна быть PNG или JPEG' });
        const bytes = Buffer.from(m[2], 'base64');
        if (!bytes.length || bytes.length > 1.5 * 1024 * 1024) return reply.code(400).send({ error: 'Размер подписи — до 1,5 МБ' });
        setSetting('invoice_signature_data', raw);
      }
      audit(req, 'settings.invoice_signature', 'settings', 'invoice', { set: Boolean(raw) });
    }
    if (invoice && typeof invoice === 'object') {
      const fields = {
        invoice_name: String(invoice.name || '').trim().slice(0, 200),
        invoice_status: String(invoice.status || '').trim().slice(0, 200),
        invoice_inn: String(invoice.inn || '').replace(/\D/g, '').slice(0, 12),
        invoice_address: String(invoice.address || '').trim().slice(0, 400),
        invoice_bank: String(invoice.bank || '').trim().slice(0, 200),
        invoice_bik: String(invoice.bik || '').replace(/\D/g, '').slice(0, 9),
        invoice_account: String(invoice.account || '').replace(/\D/g, '').slice(0, 20),
        invoice_corr: String(invoice.corr || '').replace(/\D/g, '').slice(0, 20),
        invoice_phone: String(invoice.phone || '').trim().slice(0, 60),
        invoice_email: String(invoice.email || '').trim().slice(0, 200)
      };
      if (fields.invoice_inn && !/^\d{10}$|^\d{12}$/.test(fields.invoice_inn)) return reply.code(400).send({ error: 'ИНН продавца — 10 или 12 цифр' });
      if (fields.invoice_bik && !/^\d{9}$/.test(fields.invoice_bik)) return reply.code(400).send({ error: 'БИК — 9 цифр' });
      if (fields.invoice_account && !/^\d{20}$/.test(fields.invoice_account)) return reply.code(400).send({ error: 'Расчётный счёт — 20 цифр' });
      if (fields.invoice_corr && !/^\d{20}$/.test(fields.invoice_corr)) return reply.code(400).send({ error: 'Корр. счёт — 20 цифр' });
      for (const [key, value] of Object.entries(fields)) if (value !== '') setSetting(key, value);
      audit(req, 'settings.invoice', 'settings', 'invoice', { ready: invoiceSeller().ready });
    }
    if (czEnabled !== undefined) setSetting('cz_enabled', czEnabled ? '1' : '0');
    if (czApiUrl !== undefined) {
      if (!/^https:\/\//.test(String(czApiUrl))) return reply.code(400).send({ error: 'URL должен начинаться с https://' });
      setSetting('cz_api_url', String(czApiUrl).slice(0, 200));
    }
    if (czToken) setSetting('cz_token', String(czToken).slice(0, 500));
    audit(req, 'settings.cz', 'settings', 'cz', {
      enabled: czEnabled !== undefined ? Boolean(czEnabled) : undefined,
      apiUrl: czApiUrl, tokenChanged: Boolean(czToken)
    });
    return { ok: true };
  });

}
