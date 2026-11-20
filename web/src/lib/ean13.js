/** Работа с EAN-13: нормализация, проверка контрольной цифры, дополнение 12 → 13 цифр. */
export function eanDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 14);
}

/** Контрольная цифра для первых 12 цифр EAN-13. */
export function ean13CheckDigit(first12) {
  const digits = eanDigits(first12).slice(0, 12).split('').map(Number);
  if (digits.length !== 12) return null;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * Проверяет EAN-13.
 * Возвращает { valid, digits, length, error, completed } — при 12 цифрах
 * автоматически дописывает контрольную цифру (completed: true).
 */
export function checkEan13(value) {
  const raw = eanDigits(value);
  if (!raw) return { valid: false, digits: '', length: 0, error: '' };
  if (raw.length === 12) {
    const digit = ean13CheckDigit(raw);
    const digits = `${raw}${digit}`;
    return { valid: true, digits, length: 13, error: '', completed: true };
  }
  if (raw.length === 13) {
    const expected = ean13CheckDigit(raw.slice(0, 12));
    if (expected !== Number(raw[12])) {
      return { valid: false, digits: raw, length: 13, error: `Неверная контрольная цифра: должна быть ${expected}` };
    }
    return { valid: true, digits: raw, length: 13, error: '', completed: false };
  }
  if (raw.length < 12) return { valid: false, digits: raw, length: raw.length, error: `Нужно 12–13 цифр, введено ${raw.length}` };
  return { valid: false, digits: raw, length: raw.length, error: 'Слишком много цифр: EAN-13 — ровно 13' };
}

/** Форматирует EAN для подписи: 4-6-1 (как на упаковке) или целиком. */
export function formatEan13(digits) {
  const d = eanDigits(digits);
  if (d.length !== 13) return d;
  return `${d.slice(0, 1)} ${d.slice(1, 7)} ${d.slice(7, 12)} ${d.slice(12)}`;
}
