import { requireAdmin } from './lib/admin.js';
import { audit } from './lib/audit.js';
import { importBankStatement, bankOverview, manualMatchBankTransaction, ignoreBankTransaction } from './lib/bank-statement.js';

function decodeFile(body) {
  const name = String(body?.filename || '').slice(0, 200);
  if (body?.contentBase64) {
    const buf = Buffer.from(String(body.contentBase64), 'base64');
    if (buf.length > 5 * 1024 * 1024) throw new Error('Файл больше 5 МБ');
    try { return { name, text: new TextDecoder('utf-8', { fatal: true }).decode(buf) }; }
    catch {
      try { return { name, text: new TextDecoder('windows-1251').decode(buf) }; }
      catch { return { name, text: buf.toString('latin1') }; }
    }
  }
  const text = String(body?.content || '');
  if (text.length > 5 * 1024 * 1024) throw new Error('Файл больше 5 МБ');
  return { name, text };
}

export async function registerAdminBankRoutes(app) {
  app.get('/api/admin/bank/overview', { preHandler: requireAdmin }, async () => bankOverview());

  app.post('/api/admin/bank/import', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const { name, text } = decodeFile(req.body || {});
      const result = importBankStatement(text);
      audit(req, 'bank.import', 'bank', 'statement', { filename: name, ...result });
      return { ok: true, filename: name, ...result };
    } catch (e) {
      return reply.code(400).send({ error: String(e?.message || e).slice(0, 300) });
    }
  });

  app.post('/api/admin/bank/transactions/:id/match', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const result = manualMatchBankTransaction(req.params.id, req.body?.orderId);
      audit(req, 'bank.match', 'bank_transaction', Number(req.params.id), { orderId: result.orderId });
      return result;
    } catch (e) {
      return reply.code(400).send({ error: String(e?.message || e).slice(0, 300) });
    }
  });

  app.post('/api/admin/bank/transactions/:id/ignore', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      ignoreBankTransaction(req.params.id);
      audit(req, 'bank.ignore', 'bank_transaction', Number(req.params.id), {});
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: String(e?.message || e).slice(0, 300) });
    }
  });
}
