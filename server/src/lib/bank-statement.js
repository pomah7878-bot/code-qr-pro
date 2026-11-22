import { createHash } from 'node:crypto';
import { db } from '../db.js';
import { confirmOrderManually } from './order-actions.js';

/**
 * Сверка входящих платежей по банковской выписке.
 * Поддерживаются CSV (разделитель ; , или табуляция) и файл 1С «1CClientBankExchange».
 * Сопоставление консервативное: номер счёта в назначении платежа, затем сумма + ИНН
 * плательщика, и только если подходящий заказ ровно один.
 */

const MAX_TX = 500;
const norm = (v) => String(v == null ? '' : v).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const key = (v) => norm(v).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, '');

function amountOf(v) {
  const s = norm(v).replace(/[^\d,.\-]/g, '').replace(/\s/g, '');
  if (!s) return 0;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function dateOf(v) {
  const s = norm(v);
  let m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.slice(0, 10);
}

function parseCsvLines(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(field); field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((x) => norm(x))) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((x) => norm(x))) rows.push(row);
  return rows;
}

function guessDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 8).join('\n');
  const counts = [
    [';', (sample.match(/;/g) || []).length],
    ['\t', (sample.match(/\t/g) || []).length],
    [',', (sample.match(/,/g) || []).length]
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

function headerIndex(headers, names) {
  const hs = headers.map(key);
  for (const name of names) {
    const n = key(name);
    const i = hs.findIndex((h) => h === n);
    if (i >= 0) return i;
  }
  for (const name of names) {
    const n = key(name);
    const i = hs.findIndex((h) => h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

const DATE_NAMES = ['Дата операции', 'Дата проводки', 'Дата платежа', 'Дата', 'date'];
const CREDIT_NAMES = ['Сумма поступления', 'Сумма в валюте счета', 'Поступление', 'Приход', 'Сумма', 'Кредит', 'Credit'];
const DEBIT_NAMES = ['Сумма списания', 'Списание', 'Расход', 'Дебет', 'Debit'];
const PURPOSE_NAMES = ['Назначение платежа', 'Назначение', 'Описание операции', 'Описание', 'Details'];
const PAYER_NAMES = ['Наименование плательщика', 'Плательщик', 'Контрагент', 'Плательщик (наименование)'];
const INN_NAMES = ['ИНН плательщика', 'ИНН контрагента', 'ИНН', 'Payer INN', 'INN'];

function parseCsv(text) {
  const delimiter = guessDelimiter(text);
  const rows = parseCsvLines(text, delimiter);
  let headerRow = -1;
  let cols = null;
  for (let r = 0; r < Math.min(rows.length, 12); r += 1) {
    const headers = rows[r];
    const candidate = {
      date: headerIndex(headers, DATE_NAMES),
      credit: headerIndex(headers, CREDIT_NAMES),
      debit: headerIndex(headers, DEBIT_NAMES),
      purpose: headerIndex(headers, PURPOSE_NAMES),
      payer: headerIndex(headers, PAYER_NAMES),
      inn: headerIndex(headers, INN_NAMES)
    };
    if (candidate.credit >= 0 && candidate.date >= 0) { headerRow = r; cols = candidate; break; }
  }
  if (headerRow < 0) throw new Error('Не найдены колонки даты и суммы. Экспортируйте CSV с заголовками «Дата» и «Сумма».');
  const out = [];
  for (let r = headerRow + 1; r < rows.length && out.length < MAX_TX; r += 1) {
    const row = rows[r];
    const credit = cols.credit >= 0 ? amountOf(row[cols.credit]) : 0;
    const debit = cols.debit >= 0 ? amountOf(row[cols.debit]) : 0;
    const amount = credit || (debit < 0 ? Math.abs(debit) : 0);
    if (!(amount > 0)) continue;
    out.push({
      date: cols.date >= 0 ? dateOf(row[cols.date]) : '',
      amount,
      payer: cols.payer >= 0 ? norm(row[cols.payer]) : '',
      payer_inn: cols.inn >= 0 ? digits(row[cols.inn]) : '',
      purpose: cols.purpose >= 0 ? norm(row[cols.purpose]) : ''
    });
  }
  return { format: 'csv', transactions: out };
}

function parse1c(text) {
  const lines = String(text).split(/\r?\n/);
  const docs = [];
  let cur = {};
  const flush = () => {
    if (Object.keys(cur).length) docs.push(cur);
    cur = {};
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^СекцияДокумент=/i.test(t)) { flush(); continue; }
    if (/^КонецДокумента/i.test(t)) { flush(); continue; }
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = key(t.slice(0, i));
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    cur[k] = v;
  }
  flush();
  const out = [];
  for (const d of docs) {
    const amount = amountOf(d['сумма'] || d['суммадокумента'] || d['суммаплатежа']);
    if (!(amount > 0)) continue;
    const purpose = norm(d['назначениеплатежа'] || d['назначение'] || d['описание']);
    const payer = norm(d['плательщик'] || d['плательщикнаименование'] || d['контрагент']);
    const payerInn = digits(d['плательщикинн'] || d['иннплательщика'] || d['инн']);
    if (!payer && !payerInn && !purpose) continue;
    out.push({
      date: dateOf(d['дата'] || d['датадокумента'] || d['датапроводки']),
      amount,
      payer,
      payer_inn: payerInn,
      purpose
    });
    if (out.length >= MAX_TX) break;
  }
  return { format: '1c', transactions: out };
}

export function parseBankStatement(text) {
  const raw = String(text || '');
  if (!raw.trim()) throw new Error('Файл пустой');
  if (/1CClientBankExchange|СекцияДокумент\s*=/i.test(raw)) return parse1c(raw);
  return parseCsv(raw);
}

function txHash(tx) {
  return createHash('sha256')
    .update([tx.date, tx.amount.toFixed(2), tx.payer_inn, tx.payer, tx.purpose].join('|'))
    .digest('hex').slice(0, 40);
}

function invoiceDigits(order) {
  return digits(order.invoice_number || ('СЧ-' + order.id));
}

function purposeMatchesInvoice(purpose, order) {
  const d = invoiceDigits(order);
  if (d.length < 4) return false;
  const p = digits(purpose);
  return p.includes(d);
}

function pendingInvoices() {
  return db.prepare(`SELECT id,invoice_number,amount,company_name,company_inn,created_at
    FROM orders WHERE status='pending' AND payment_method='bank_transfer'
    ORDER BY id DESC LIMIT 200`).all();
}

function matchOne(tx, pending) {
  const amount = Number(tx.amount || 0);
  const candidates = pending.filter((o) => Math.abs(Number(o.amount || 0) - amount) < 0.01);
  if (!candidates.length) return null;
  const byInvoice = candidates.filter((o) => purposeMatchesInvoice(tx.purpose, o));
  if (byInvoice.length === 1) return { order: byInvoice[0], reason: 'invoice' };
  if (byInvoice.length > 1) return null;
  const inn = digits(tx.payer_inn);
  if (!inn) return null;
  const byInn = candidates.filter((o) => digits(o.company_inn) === inn);
  return byInn.length === 1 ? { order: byInn[0], reason: 'amount_inn' } : null;
}

function markMatched(txId, orderId) {
  db.prepare("UPDATE bank_transactions SET status='matched', order_id=?, matched_at=datetime('now'), error='' WHERE id=?")
    .run(orderId, txId);
}

function markError(txId, message) {
  db.prepare("UPDATE bank_transactions SET status='error', error=? WHERE id=?").run(String(message || '').slice(0, 500), txId);
}

export function matchBankTransactions() {
  const pending = pendingInvoices();
  const txs = db.prepare("SELECT * FROM bank_transactions WHERE status='unmatched' ORDER BY id").all();
  let matched = 0;
  for (const tx of txs) {
    const hit = matchOne(tx, pending);
    if (!hit) continue;
    try {
      confirmOrderManually(hit.order.id, 'bank_statement');
      markMatched(tx.id, hit.order.id);
      const i = pending.findIndex((o) => o.id === hit.order.id);
      if (i >= 0) pending.splice(i, 1);
      matched += 1;
    } catch (e) {
      markError(tx.id, e?.message || e);
    }
  }
  return { matched };
}

export function importBankStatement(text) {
  const parsed = parseBankStatement(text);
  if (!parsed.transactions.length) throw new Error('В выписке не найдены входящие платежи');
  let imported = 0;
  let duplicates = 0;
  const insert = db.prepare(`INSERT OR IGNORE INTO bank_transactions
    (tx_hash,tx_date,amount,payer,payer_inn,purpose,raw_json,status) VALUES (?,?,?,?,?,?,?,'unmatched')`);
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      const raw = JSON.stringify(row);
      const info = insert.run(txHash(row), row.date, row.amount, row.payer, row.payer_inn, row.purpose, raw);
      if (info.changes) imported += 1; else duplicates += 1;
    }
  });
  tx(parsed.transactions);
  const result = matchBankTransactions();
  return {
    format: parsed.format,
    parsed: parsed.transactions.length,
    imported,
    duplicates,
    matched: result.matched
  };
}

export function bankOverview() {
  return {
    pending: pendingInvoices(),
    unmatched: db.prepare("SELECT id,tx_date,amount,payer,payer_inn,purpose,status,error,created_at FROM bank_transactions WHERE status IN ('unmatched','error') ORDER BY tx_date DESC, id DESC LIMIT 100").all(),
    matched: db.prepare("SELECT b.id,b.tx_date,b.amount,b.payer,b.payer_inn,b.purpose,b.order_id,b.matched_at,o.invoice_number FROM bank_transactions b LEFT JOIN orders o ON o.id=b.order_id WHERE b.status='matched' ORDER BY b.matched_at DESC, b.id DESC LIMIT 30").all(),
    counts: {
      unmatched: db.prepare("SELECT COUNT(*) c FROM bank_transactions WHERE status IN ('unmatched','error')").get().c,
      matched: db.prepare("SELECT COUNT(*) c FROM bank_transactions WHERE status='matched'").get().c
    }
  };
}

export function manualMatchBankTransaction(txId, orderId) {
  const tx = db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(Number(txId));
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(orderId));
  if (!tx) throw new Error('Строка выписки не найдена');
  if (!order) throw new Error('Заказ не найден');
  if (order.status !== 'pending') throw new Error('Заказ уже не ожидает оплаты');
  if (Math.abs(Number(tx.amount) - Number(order.amount)) >= 0.01) throw new Error('Сумма выписки не совпадает с суммой счёта');
  if (tx.status === 'matched') throw new Error('Эта строка уже сопоставлена');
  confirmOrderManually(order.id, 'bank_statement');
  markMatched(tx.id, order.id);
  return { ok: true, orderId: order.id };
}

export function ignoreBankTransaction(txId) {
  db.prepare("UPDATE bank_transactions SET status='ignored', error='' WHERE id=?").run(Number(txId));
  return { ok: true };
}
