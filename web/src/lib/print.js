const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

export { isMobile };

export function downloadBlob(url, body, fileName, single = true) {
  return fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Не удалось сформировать файл');
    }
    const blob = await res.blob();
    const head = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
    if (head !== '%PDF-') throw new Error('Сервер вернул не PDF');
    const blobUrl = URL.createObjectURL(blob);
    // На мобильных (особенно iOS Safari) атрибут download часто игнорируется,
    // поэтому открываем blob через location — браузер предложит сохранить файл.
    if (isMobile()) {
      location.href = blobUrl;
      return blobUrl;
    }
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return blobUrl;
  });
}

export async function openPrintWindow(url, body, existingWindow = null) {
  const win = existingWindow || window.open('', '_blank');
  if (!win) {
    // Поп-ап заблокирован (часто на мобильных): печатаем через скрытый iframe,
    // не уходя со страницы.
    const iframeName = 'cq_print_iframe_' + Date.now();
    const iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    try {
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
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open();
      doc.write(html);
      doc.close();
      await new Promise((resolve) => {
        iframe.onload = () => { try { iframe.contentWindow.print(); } catch {}; resolve(); };
        setTimeout(resolve, 1500);
      });
    } finally {
      document.body.removeChild(iframe);
    }
    return null;
  }
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
