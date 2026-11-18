import { db } from '../db.js';

const round2 = (n) => Math.round(n * 100) / 100;

export function normalizePromoCode(raw) {
  const code = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9_-]{3,32}$/.test(code) ? code : null;
}

export const PROMO_KINDS = ['percent', 'fixed', 'days'];

// Проверка кода перед оплатой. Возвращает либо { error }, либо расчёт скидки.
export function validatePromo({ code, userId, amount, days, plan = 'premium' }) {
  const normalized = normalizePromoCode(code);
  if (!normalized) return { error: 'Промокод не распознан' };
  const promo = db.prepare('SELECT * FROM promo_codes WHERE code=?').get(normalized);
  if (!promo || !promo.active) return { error: 'Промокод не найден или выключен' };
  const now = Date.now();
  if (promo.starts_at && new Date(promo.starts_at.replace(' ', 'T') + 'Z').getTime() > now) {
    return { error: 'Промокод ещё не действует' };
  }
  if (promo.expires_at && new Date(promo.expires_at.replace(' ', 'T') + 'Z').getTime() < now) {
    return { error: 'Срок действия промокода истёк' };
  }
  if (promo.max_uses > 0 && promo.used_count >= promo.max_uses) {
    return { error: 'Лимит использований промокода исчерпан' };
  }
  if (userId) {
    const used = db.prepare('SELECT COUNT(*) c FROM promo_redemptions WHERE promo_id=? AND user_id=?')
      .get(promo.id, userId).c;
    if (promo.per_user_limit > 0 && used >= promo.per_user_limit) {
      return { error: 'Вы уже использовали этот промокод' };
    }
  }
  if (plan !== 'premium' && plan !== 'test') return { error: 'Промокод доступен только для PREMIUM' };
  if (!(amount > 0)) return { error: 'Некорректная сумма заказа' };

  let discount = 0;
  let bonusDays = 0;
  if (promo.kind === 'percent') {
    discount = round2((amount * Math.min(90, Math.max(1, promo.value))) / 100);
  } else if (promo.kind === 'fixed') {
    discount = round2(Math.min(Math.max(0, promo.value), Math.max(0, amount - 1)));
  } else if (promo.kind === 'days') {
    bonusDays = Math.max(1, Math.round(promo.value));
  }
  const finalAmount = round2(Math.max(1, amount - discount));
  return {
    promo,
    code: promo.code,
    kind: promo.kind,
    value: promo.value,
    discount,
    bonusDays,
    finalAmount,
    days: days ? days + bonusDays : days
  };
}

// Погашение фиксируем только после успешной оплаты, идемпотентно по заказу.
export function redeemPromo(order) {
  if (!order?.promo_code) return;
  const promo = db.prepare('SELECT * FROM promo_codes WHERE code=?').get(order.promo_code);
  if (!promo) return;
  try {
    db.transaction(() => {
      const r = db.prepare('INSERT OR IGNORE INTO promo_redemptions (promo_id, user_id, order_id) VALUES (?,?,?)')
        .run(promo.id, order.user_id, order.id);
      if (r.changes) {
        db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id=?').run(promo.id);
      }
    })();
  } catch { /* погашение не должно ломать оплату */ }
}
