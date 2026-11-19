import { requireAuth } from '../routes.js';

// Общие проверки и утилиты админ-раздела.
export const requireAdmin = async (req, reply) => {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Только для администратора' });
  if (!req.user.totp_enabled) {
    return reply.code(403).send({ error: 'Для доступа к админке включите двухфакторную аутентификацию в разделе «Безопасность»', code: '2fa_required' });
  }
};

// support — просмотр клиентов и заданий без денег и настроек
export const requireStaff = async (req, reply) => {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (!['admin', 'support'].includes(req.user?.role)) {
    return reply.code(403).send({ error: 'Раздел доступен администратору и поддержке' });
  }
  if (!req.user.totp_enabled) {
    return reply.code(403).send({ error: 'Для доступа к админке включите двухфакторную аутентификацию в разделе «Безопасность»', code: '2fa_required' });
  }
};

export function paging(query, defaultPer = 25) {
  const rawPage = parseInt(query?.page, 10);
  const rawPer = parseInt(query?.per, 10);
  const page = Math.max(1, Math.min(100000, Number.isFinite(rawPage) ? rawPage : 1));
  const per = Math.min(100, Math.max(5, Number.isFinite(rawPer) ? rawPer : defaultPer));
  return { page, per, offset: (page - 1) * per };
}

export const dateOnly = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

export function like(q) {
  return '%' + String(q).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
}

const csvEscape = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  // защита от формул в Excel/Sheets
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// CSV с BOM и «;» — открывается в Excel и LibreOffice без import-мастера
export function sendCsv(reply, filename, header, rows) {
  const lines = [header.map(csvEscape).join(';')];
  for (const r of rows) lines.push(r.map(csvEscape).join(';'));
  const body = '\ufeff' + lines.join('\r\n') + '\r\n';
  return reply
    .type('text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(body);
}

export const sqlNow = (d = new Date()) => d.toISOString().replace('T', ' ').slice(0, 19);
