const STORAGE_KEY = 'cq_plans_changed_v1';
const CUSTOM_EVENT = 'cq:plans-changed';

/** Сообщить всем вкладкам/страницам, что тарифы изменились. */
export function notifyPlansChanged() {
  const ts = String(Date.now());
  try { localStorage.setItem(STORAGE_KEY, ts); } catch { /* storage может быть недоступен */ }
  try { window.dispatchEvent(new CustomEvent(CUSTOM_EVENT, { detail: { ts } })); } catch { /* ignore */ }
}

/**
 * Подписка на обновления тарифов: событие из админки, storage-событие в других
 * вкладках и возврат на вкладку. Возвращает функцию отписки.
 */
export function onPlansChanged(handler) {
  const safe = () => { try { handler(); } catch { /* ignore */ } };
  const onStorage = (e) => { if (e.key === STORAGE_KEY) safe(); };
  const onVisible = () => { if (document.visibilityState === 'visible') safe(); };
  window.addEventListener(CUSTOM_EVENT, safe);
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', safe);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener(CUSTOM_EVENT, safe);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', safe);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
