const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function elementHtml(el) {
  const style = [
    `left:${Number(el.x) || 0}mm`,
    `top:${Number(el.y) || 0}mm`,
    `width:${Number(el.w) || 0}mm`,
    `height:${Number(el.h) || 0}mm`,
    `text-align:${['left', 'center', 'right'].includes(el.align) ? el.align : 'left'}`,
    `font-size:${Math.max(4, Number(el.fontSize) || 8)}pt`
  ].join(';');
  if (el.pngBase64) {
    return `<div class="el" style="${style}"><img class="bc" alt="" src="data:image/png;base64,${el.pngBase64}"></div>`;
  }
  if (el.text) {
    return `<div class="el txt" style="${style}">${esc(el.text)}</div>`;
  }
  return '';
}

export function labelHtml(elements, widthMm, heightMm) {
  return `<div class="label" style="width:${widthMm}mm;height:${heightMm}mm">${(elements || []).map(elementHtml).join('')}</div>`;
}

export function printDocument({ labels, widthMm, heightMm, title = 'Печать этикеток' }) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .label { position: relative; overflow: hidden; background: #fff; page-break-after: always; break-after: page; }
  .label:last-child { page-break-after: auto; break-after: auto; }
  .el { position: absolute; overflow: hidden; }
  .bc { display: block; width: 100%; height: 100%; object-fit: contain; }
  .txt { white-space: pre-wrap; line-height: 1.15; color: #000; font-family: Arial, Helvetica, sans-serif; }
</style></head>
<body>${labels.join('')}</body></html>`;
}
