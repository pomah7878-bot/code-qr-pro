const UA = () => (typeof navigator !== 'undefined' ? navigator.userAgent : '');

/** iOS / iPadOS (современный iPad представляется как Macintosh). */
export function isIOS() {
  const ua = UA();
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document;
}

export function isMobile() {
  return isIOS() || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(UA());
}

const PLACEHOLDER = '<!doctype html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>Подготовка…</title></head>'
  + '<body style="margin:0;font-family:-apple-system,Arial,sans-serif;padding:24px;color:#334155">Готовим файл…</body></html>';

/**
 * Синхронно открывает пустое окно. Вызывать ПРЯМО в обработчике клика,
 * до любых await — так браузер не считает окно всплывающим.
 */
export function openPlaceholderWindow() {
  try {
    const win = window.open('', '_blank');
    if (win && win.document) {
      win.document.write(PLACEHOLDER);
      win.document.close();
    }
    return win || null;
  } catch {
    return null;
  }
}

/**
 * Забирает PDF с сервера и отдаёт пользователю.
 *
 * iOS Safari не открывает PDF из blob: (пустой экран) и не сохраняет blob
 * через атрибут download. Поэтому на iOS запрашивается короткоживущая ссылка
 * (`<url>/ticket`) и документ открывается по обычному URL — Safari показывает
 * свой просмотрщик с «Поделиться» → «Сохранить в Файлы» / «Печать».
 *
 * На остальных платформах — обычное скачивание через blob + download.
 */
export async function downloadBlob(url, body, fileName) {
  if (isIOS() && /\/pdf$/.test(url)) {
    const res = await fetch(`${url}/ticket`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Не удалось сформировать файл');
    }
    const data = await res.json().catch(() => ({}));
    if (!data?.url) throw new Error('Сервер не выдал ссылку на PDF');
    location.href = data.url;
    return data.url;
  }

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Не удалось сформировать файл');
  }
  const blob = await res.blob();
  const head = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
  if (head !== '%PDF-') throw new Error('Сервер вернул не PDF');
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return blobUrl;
}

async function loadInto(win, html, waitMs) {
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; setTimeout(resolve, 250); };
    try { win.addEventListener('load', finish, { once: true }); } catch { /* ignore */ }
    setTimeout(finish, waitMs);
  });
}

async function renderIntoIframe(html) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; setTimeout(resolve, 400); };
      iframe.onload = finish;
      setTimeout(finish, 1500);
    });
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch { /* ignore */ }
  } finally {
    setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* уже удалён */ } }, 60000);
  }
}

/**
 * Открывает готовый макет и вызывает системный диалог печати.
 *
 * preWindow — окно, открытое синхронно в обработчике клика.
 * Если окно не открылось, печать идёт через скрытый iframe.
 */
export async function openPrintWindow(url, body, preWindow = null) {
  const win = preWindow || openPlaceholderWindow();

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (win && !win.closed) { try { win.close(); } catch { /* ignore */ } }
    throw new Error(data.error || 'Не удалось подготовить печать');
  }
  const html = await res.text();

  if (win && !win.closed) {
    await loadInto(win, html, 1500);
    try { win.print(); } catch { /* пользователь нажмёт Ctrl+P */ }
    return win;
  }

  await renderIntoIframe(html);
  return null;
}
