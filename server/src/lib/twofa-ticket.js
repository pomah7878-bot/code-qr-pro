import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Короткоживущий тикет между проверкой пароля и вводом кода 2FA.
const KEY = process.env.TFA_TICKET_SECRET || randomBytes(32);
const TTL_MS = 5 * 60 * 1000;
const attempts = new Map();

export function issueTicket(userId) {
  const payload = { uid: userId, exp: Date.now() + TTL_MS, n: randomBytes(12).toString('hex') };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', KEY).update(body).digest('base64url');
  attempts.set(payload.n, { n: 0, exp: payload.exp });
  return body + '.' + sig;
}

export function readTicket(ticket) {
  const [body, sig] = String(ticket || '').split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', KEY).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!payload?.uid || !payload?.exp || payload.exp < Date.now()) return null;
  return payload;
}

export function countAttempt(nonce) {
  const a = attempts.get(nonce);
  if (!a) return 0;
  a.n += 1;
  return a.n;
}

export function clearTicket(nonce) {
  attempts.delete(nonce);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.exp < now) attempts.delete(k);
}, 60000).unref();
