export async function openPrintWindow(url, body, existingWindow = null) {
  const win = existingWindow || window.open('', '_blank');
  if (!win) throw new Error('Браузер заблокировал окно печати. Разрешите всплывающие окна для сайта.');
  try {
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Подготовка печати…</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#334155">Готовим этикетки к печати…</body></html>');
    win.document.close();
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Не удалось подготовить печать');
    }
    const html = await res.text();
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; setTimeout(resolve, 250); };
      win.addEventListener('load', finish, { once: true });
      setTimeout(finish, 1500);
    });
    try { win.print(); } catch { /* пользователь нажмёт Ctrl+P */ }
    return win;
  } catch (e) {
    try { win.close(); } catch { /* ignore */ }
    throw e;
  }
}
