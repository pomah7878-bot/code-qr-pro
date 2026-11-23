/**
 * Единые подсказки при наведении и фокусе.
 * Источник текста: data-tooltip (приоритет), aria-label, title.
 * title убираем после первого показа, чтобы не было двойной нативной подсказки.
 */
let tip = null;
let current = null;
let hideTimer = 0;

function ensureTip() {
  if (tip || typeof document === 'undefined') return tip;
  tip = document.createElement('div');
  tip.className = 'cq-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tip);
  return tip;
}

function hide() {
  if (!tip) return;
  tip.classList.remove('show');
  tip.setAttribute('aria-hidden', 'true');
  current = null;
}

function targetOf(node) {
  if (!node || node.nodeType !== 1) return null;
  return node.closest('[data-tooltip], [aria-label], [title]');
}

function textOf(el) {
  return String(el.getAttribute('data-tooltip') || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 400);
}

function show(el, text) {
  if (!text) return;
  const node = ensureTip();
  if (!node) return;
  if (current === el && node.classList.contains('show')) return;
  current = el;
  const rect = el.getBoundingClientRect();
  node.textContent = text;
  node.style.left = '0px';
  node.style.top = '0px';
  node.classList.add('show');
  node.setAttribute('aria-hidden', 'false');
  const box = node.getBoundingClientRect();
  const gap = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitsAbove = rect.top - box.height - gap >= 8;
  const fitsBelow = rect.bottom + gap + box.height <= vh - 8;
  // Сначала пробуем строго над кнопкой. Если места нет — ставим сбоку,
  // а не поверх кнопки: подсказка не должна перекрывать целевой контрол.
  let left = rect.left + rect.width / 2 - box.width / 2;
  let top = rect.top - box.height - gap;
  if (!fitsAbove) {
    const fitsRight = rect.right + gap + box.width <= vw - 8;
    if (fitsRight) {
      left = rect.right + gap;
      top = Math.max(8, Math.min(rect.top + rect.height / 2 - box.height / 2, vh - box.height - 8));
    } else if (fitsBelow) {
      top = rect.bottom + gap;
    } else {
      left = rect.left - box.width - gap;
      top = Math.max(8, Math.min(rect.top + rect.height / 2 - box.height / 2, vh - box.height - 8));
    }
  }
  left = Math.max(8, Math.min(left, vw - box.width - 8));
  if (top + box.height > vh - 8) top = Math.max(8, vh - box.height - 8);
  node.style.left = Math.round(left) + 'px';
  node.style.top = Math.round(top) + 'px';
}

export function installTooltips() {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('mouseover', (e) => {
    const el = targetOf(e.target);
    if (!el || el === tip) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    const text = textOf(el);
    if (!text) return;
    if (el.hasAttribute('title')) {
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);
      el.setAttribute('data-tooltip', text);
      el.removeAttribute('title');
    }
    clearTimeout(hideTimer);
    show(el, text);
  }, true);
  document.addEventListener('mouseout', (e) => {
    const el = targetOf(e.target);
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    hideTimer = window.setTimeout(hide, 80);
  }, true);
  document.addEventListener('focusin', (e) => {
    const el = targetOf(e.target);
    if (!el) return;
    const text = textOf(el);
    if (!text) return;
    if (el.hasAttribute('title')) {
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);
      el.setAttribute('data-tooltip', text);
      el.removeAttribute('title');
    }
    clearTimeout(hideTimer);
    show(el, text);
  }, true);
  document.addEventListener('focusout', hide, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  document.addEventListener('click', hide, true);
  window.addEventListener('blur', hide);
  return hide;
}
