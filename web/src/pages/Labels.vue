<script setup>
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { importPdf } from '../lib/pdfImport.js';
import { codeLinesFromText, kizRows, readDataFile, readSpreadsheet } from '../lib/labelData.js';
import SideNav from '../components/SideNav.vue';

const S = 4; // px на мм для предпросмотра
const canvas = ref(null);
const tpl = reactive({ name: 'Новая этикетка', widthMm: 58, heightMm: 40, dpi: 203, elements: [] });
const presets = [[58, 40], [58, 60], [43, 25], [30, 20], [20, 20], [20, 30], [20, 40], [75, 50], [100, 50], [100, 150], [120, 75]];
const selectedId = ref(null);
const selected = computed(() => tpl.elements.find(e => e.id === selectedId.value) || null);
const templates = ref([]);
const currentTemplateId = ref(null);
const jobs = ref([]);
const jobId = ref(null);
const dataRows = ref([]);
const dataSource = ref('');
const dataLabel = ref('');
const kizData = ref([]);
const productData = ref([]);
const kizLabel = ref('');
const btLabel = ref('');
const duplicateCount = ref(0);
const autoLayout = ref(true);
const autoSignature = ref('');
const row = ref(0);
const kizBusy = ref(false);
const kizStatus = ref('');
const btBusy = ref(false);
const btStatus = ref('');
const btWarning = ref('');
const error = ref('');
const notice = ref('');
const premium = computed(() => !!store.plan?.labelEditor);
let itemImg = null;
let uid = 1;

const bridge = reactive({
  url: 'http://127.0.0.1:9101',
  token: localStorage.getItem('cq_bridge_token') || '',
  status: 'unknown', printers: [], printer: '', copies: 1, busy: false
});
const previewPng = ref('');

const currentItem = computed(() => dataRows.value[Number(row.value)] || null);
const rowNumber = computed({
  get: () => Number(row.value) + 1,
  set: (v) => {
    const n = Number(v);
    row.value = Math.max(0, Math.min(dataRows.value.length - 1, (Number.isFinite(n) ? Math.round(n) : 1) - 1));
  }
});
const fieldOptions = computed(() => {
  const base = ['code', 'gtin', 'serial', 'barcode', 'name', 'sku', 'row'];
  const custom = [];
  for (const r of dataRows.value.slice(0, 30)) {
    for (const k of Object.keys(r)) if (!base.includes(k) && !custom.includes(k)) custom.push(k);
  }
  return [...base, ...custom].slice(0, 30);
});
const mergeNote = computed(() => {
  if (!kizData.value.length || !productData.value.length) return '';
  if (kizData.value.length === productData.value.length) return '';
  return `КИЗ: ${kizData.value.length}, товары: ${productData.value.length} — строки без пары останутся без штрихкода/названия.`;
});
function fieldSample(f) {
  if (currentItem.value) return f === 'row' ? String(Number(row.value) + 1) : (currentItem.value[f] ?? '');
  return { gtin: '04600000000015', serial: '5PojkV', row: '1', code: '(01)…(21)…', barcode: '4600000000000', name: 'Товар', sku: 'SKU-1' }[f] || '';
}

function rebuildData() {
  const kiz = kizData.value;
  const prod = productData.value;
  const gtinKey = (v) => {
    const s = String(v || '').trim();
    return /^\d{1,14}$/.test(s) ? s.padStart(14, '0') : s;
  };
  let rows = [];
  if (kiz.length && prod.length) {
    const byGtin = new Map();
    for (const p of prod) {
      const g = gtinKey(p.gtin || p['ГТИН']);
      if (!g) continue;
      if (!byGtin.has(g)) byGtin.set(g, []);
      byGtin.get(g).push(p);
    }
    rows = kiz.map((k, i) => {
      let pair = null;
      const g = gtinKey(k.gtin);
      if (g && byGtin.get(g)?.length) pair = byGtin.get(g).shift();
      if (!pair) pair = prod[i] || {};
      return { ...pair, ...k };
    });
  } else {
    rows = kiz.length ? kiz : prod;
  }
  dataRows.value = rows;
  dataSource.value = kiz.length && prod.length ? 'kiz+bartender' : kiz.length ? 'kiz' : prod.length ? 'bartender' : '';
  dataLabel.value = [kizLabel.value, btLabel.value].filter(Boolean).join(' + ').slice(0, 160);
  const seen = new Set();
  const dup = new Set();
  for (const r of rows) {
    const c = String(r.code || '').trim();
    if (!c) continue;
    if (seen.has(c)) dup.add(c); else seen.add(c);
  }
  duplicateCount.value = dup.size;
  jobId.value = null;
  row.value = 0;
  itemImg = null;
  selectedId.value = null;
  maybeAutoTemplate();
  draw();
}

function buildAutoTemplate() {
  const W = Number(tpl.widthMm) || 58;
  const H = Number(tpl.heightMm) || 40;
  const m = Math.max(0.8, Math.min(3, Math.min(W, H) * 0.05));
  const cols = new Set();
  for (const r of dataRows.value.slice(0, 30)) for (const k of Object.keys(r)) cols.add(k);
  const first = dataRows.value[0] || {};
  const has = (k) => cols.has(k) && String(first[k] ?? '').trim() !== '';
  const code = has('code');
  const barcode = has('barcode');
  const name = has('name');
  const fields = ['gtin', 'serial', 'sku', 'price', 'batch'].filter(has);
  const small = W < 30 || H < 26;
  const sampleBarcode = String(first.barcode || '').replace(/\s+/g, '');
  const bcType = /^\d{12,13}$/.test(sampleBarcode) ? 'ean13' : 'code128';
  const e = [];
  let n = 0;
  const id = () => `auto${n++}_${Date.now()}`;
  let dmW = 0;
  let topH = 0;
  if (code) {
    const size = Math.min(W * (small ? 0.62 : 0.38), H * (small ? 0.62 : 0.55), 45);
    e.push({ id: id(), type: 'datamatrix', x: m, y: m, w: size, h: size, fontSize: 8, align: 'left' });
    dmW = size;
    topH = Math.max(topH, size);
  }
  const used = new Set();
  if (barcode && !small) {
    const bx = code ? m + dmW + m : m;
    const bw = W - bx - m;
    if (bw >= 18) {
      const bh = Math.min(14, Math.max(7, H * 0.24));
      e.push({ id: id(), type: bcType, field: 'barcode', x: bx, y: m, w: bw, h: bh, fontSize: 8, align: 'left' });
      topH = Math.max(topH, bh);
      let y = m + bh + 0.7;
      for (const f of fields) {
        if (y + 3.4 > m + topH) break;
        e.push({ id: id(), type: 'field', field: f, x: bx, y, w: bw, h: 3.2, fontSize: 6.5, align: 'left' });
        used.add(f);
        y += 3.7;
      }
      if (name && y + 3.4 <= m + topH) {
        e.push({ id: id(), type: 'field', field: 'name', x: bx, y, w: bw, h: 3.2, fontSize: 6.5, align: 'left' });
        used.add('name');
      }
    }
  }
  let y = topH ? m + topH + 1 : m;
  const lineH = Math.max(2.6, Math.min(4.2, H * 0.08));
  for (const f of fields) {
    if (used.has(f)) continue;
    if (y + lineH > H - m - (!used.has('name') && name ? 4.4 : 0)) break;
    e.push({ id: id(), type: 'field', field: f, x: m, y, w: W - 2 * m, h: lineH, fontSize: 7, align: 'left' });
    used.add(f);
    y += lineH + 0.5;
  }
  if (name && !used.has('name') && y + 4 <= H - m) {
    e.push({ id: id(), type: 'field', field: 'name', x: m, y, w: W - 2 * m, h: Math.min(4.4, H - m - y), fontSize: 7.5, align: 'left' });
    used.add('name');
    y += 4.4;
  }
  if (!used.has('row') && y + 3 <= H - m) {
    e.push({ id: id(), type: 'field', field: 'row', x: m, y, w: Math.min(25, W - 2 * m), h: 3, fontSize: 6.5, align: 'left' });
  }
  if (!e.length) e.push({ id: id(), type: 'text', x: m, y: m, w: W - 2 * m, h: 5, fontSize: 8, align: 'left', text: 'Текст' });
  tpl.elements = e;
  autoSignature.value = JSON.stringify({ w: W, h: H, e });
  notice.value = `Шаблон собран автоматически: ${e.length} элементов. Двигайте мышью и правьте справа.`;
}

function maybeAutoTemplate() {
  if (!autoLayout.value || !dataRows.value.length) return;
  const sig = JSON.stringify({ w: Number(tpl.widthMm), h: Number(tpl.heightMm), e: tpl.elements });
  if (tpl.elements.length && sig !== autoSignature.value) return;
  buildAutoTemplate();
}

function onAutoToggle() {
  if (autoLayout.value) { maybeAutoTemplate(); draw(); }
}

async function onKizFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  error.value = ''; notice.value = ''; kizStatus.value = '';
  kizBusy.value = true;
  try {
    let codes = [];
    const isPdf = /\.pdf$/i.test(file.name) || (await file.slice(0, 1024).text()).includes('%PDF-');
    if (isPdf) {
      const result = await importPdf(file);
      codes = result.codes;
    } else if (/\.(xlsx|xls)$/i.test(file.name)) {
      const table = await readSpreadsheet(file);
      codes = table.flat().map((c) => String(c ?? '').trim()).filter(Boolean);
    } else {
      codes = codeLinesFromText(await file.text());
    }
    const rows = kizRows(codes);
    if (!rows.length) throw new Error('В файле не найдены коды маркировки');
    kizData.value = rows;
    kizLabel.value = file.name;
    kizStatus.value = `Загружено ${rows.length} кодов из ${file.name}`;
    notice.value = 'Коды КИЗ загружены — проверьте предпросмотр';
    rebuildData();
  } catch (e) {
    error.value = 'КИЗ: ' + e.message;
  } finally {
    kizBusy.value = false;
    ev.target.value = '';
  }
}

async function onBtFiles(ev) {
  const files = Array.from(ev.target.files || []);
  if (!files.length) return;
  error.value = ''; notice.value = ''; btStatus.value = ''; btWarning.value = '';
  btBusy.value = true;
  try {
    const all = [];
    const warnings = [];
    for (const file of files) {
      try {
        const part = await readDataFile(file);
        if (part.warning) warnings.push(part.warning);
        all.push(...part.rows);
      } catch (e) {
        warnings.push(`${file.name}: ${e.message}`);
      }
    }
    if (!all.length) throw new Error('Не удалось извлечь строки. Загрузите CSV/XLSX/BTXML с данными.');
    productData.value = all;
    btLabel.value = files.map((f) => f.name).join(', ').slice(0, 120);
    btStatus.value = `Файлов: ${files.length} · строк: ${all.length}`;
    btWarning.value = warnings.join(' ');
    notice.value = 'Данные из BarTender загружены';
    rebuildData();
  } catch (e) {
    error.value = 'BarTender: ' + e.message;
  } finally {
    btBusy.value = false;
    ev.target.value = '';
  }
}

function draw() {
  const c = canvas.value;
  if (!c) return;
  c.width = tpl.widthMm * S + 2;
  c.height = tpl.heightMm * S + 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#94a3b8';
  ctx.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
  for (const el of tpl.elements) {
    const x = el.x * S + 1, y = el.y * S + 1, w = el.w * S, h = el.h * S;
    if (['datamatrix', 'code128', 'ean13', 'qrcode'].includes(el.type)) {
      if (el.type === 'datamatrix' && itemImg) {
        ctx.drawImage(itemImg, x, y, w, h);
      } else {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#475569';
        ctx.font = '10px Inter, sans-serif';
        ctx.fillText({ datamatrix: '▦ DataMatrix', code128: '||| Code128', ean13: '||| EAN-13', qrcode: 'QR' }[el.type], x + 3, y + 12);
      }
    } else {
      const text = el.type === 'field' ? fieldSample(el.field) : (el.text || '');
      const px = el.fontSize * (25.4 / 72) * S;
      ctx.fillStyle = '#000000';
      ctx.font = px + 'px Arial, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = el.align === 'center' ? 'center' : el.align === 'right' ? 'right' : 'left';
      const tx = el.align === 'center' ? x + w / 2 : el.align === 'right' ? x + w : x;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.fillText(text, tx, y);
      ctx.restore();
      ctx.textAlign = 'left';
    }
    if (el.id === selectedId.value) {
      ctx.strokeStyle = '#6366f1';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
      ctx.setLineDash([]);
    }
  }
}

watch(() => [tpl.widthMm, tpl.heightMm, tpl.elements, selectedId.value, currentItem.value], () => nextTick(draw), { deep: true });

function addElement(type, field) {
  const id = 'el' + (uid++) + '_' + Date.now();
  const base = { id, type, x: 2, y: 2, w: 20, h: 20, fontSize: 8, align: 'left' };
  if (type === 'text') Object.assign(base, { text: 'Текст', w: 30, h: 6, x: 24 });
  if (type === 'field') Object.assign(base, { field: field || 'gtin', w: 32, h: 6, x: 24, y: field === 'serial' ? 10 : 2 });
  if (type === 'code128') Object.assign(base, { w: 40, h: 10, y: 26 });
  if (type === 'ean13') Object.assign(base, { field: field || 'barcode', w: 40, h: 14, x: 26, y: 24 });
  if (type === 'qrcode') Object.assign(base, { field: field || 'code', w: 20, h: 20, x: 34, y: 2 });
  tpl.elements.push(base);
  selectedId.value = id;
}
function removeSelected() {
  tpl.elements = tpl.elements.filter(e => e.id !== selectedId.value);
  selectedId.value = null;
}

function layout2in1() {
  tpl.widthMm = 58; tpl.heightMm = 40; tpl.dpi = 203;
  const t = Date.now();
  tpl.elements = [
    { id: 'dm' + t, type: 'datamatrix', x: 2, y: 2, w: 22, h: 22, fontSize: 8, align: 'left' },
    { id: 'ean' + t, type: 'ean13', field: 'barcode', x: 26, y: 2, w: 30, h: 14, fontSize: 8, align: 'left' },
    { id: 'gt' + t, type: 'field', field: 'gtin', x: 26, y: 16, w: 30, h: 4, fontSize: 7, align: 'left' },
    { id: 'sn' + t, type: 'field', field: 'serial', x: 26, y: 21, w: 30, h: 4, fontSize: 7, align: 'left' },
    { id: 'nm' + t, type: 'field', field: 'name', x: 2, y: 26, w: 54, h: 5, fontSize: 8, align: 'left' },
    { id: 'rw' + t, type: 'field', field: 'row', x: 2, y: 33, w: 20, h: 4, fontSize: 7, align: 'left' }
  ];
  selectedId.value = null;
  autoSignature.value = '';
  notice.value = 'Собран макет 2 в 1: DataMatrix + EAN-13. Проверьте, что в данных есть колонка barcode.';
  draw();
}

let drag = null;
function hit(ev) {
  const r = canvas.value.getBoundingClientRect();
  const mx = (ev.clientX - r.left - 1) / S, my = (ev.clientY - r.top - 1) / S;
  for (let i = tpl.elements.length - 1; i >= 0; i--) {
    const e = tpl.elements[i];
    if (mx >= e.x && mx <= e.x + e.w && my >= e.y && my <= e.y + e.h) return { e, dx: mx - e.x, dy: my - e.y };
  }
  return null;
}
function onDown(ev) {
  const h = hit(ev);
  selectedId.value = h ? h.e.id : null;
  if (h) { drag = h; canvas.value.setPointerCapture(ev.pointerId); }
}
function onMove(ev) {
  if (!drag) return;
  const r = canvas.value.getBoundingClientRect();
  const mx = (ev.clientX - r.left - 1) / S, my = (ev.clientY - r.top - 1) / S;
  drag.e.x = Math.max(0, Math.min(tpl.widthMm - drag.e.w, Math.round((mx - drag.dx) * 2) / 2));
  drag.e.y = Math.max(0, Math.min(tpl.heightMm - drag.e.h, Math.round((my - drag.dy) * 2) / 2));
}
function onUp() { drag = null; }

async function loadTemplates() { try { templates.value = (await api.templates()).templates; } catch {} }
async function loadJobs() { try { jobs.value = (await api.jobs()).jobs.filter(j => j.status === 'done'); } catch {} }
async function onJobChange() {
  itemImg = null; row.value = 0;
  kizData.value = []; productData.value = []; kizLabel.value = ''; btLabel.value = ''; duplicateCount.value = 0;
  if (jobId.value == null) { dataRows.value = []; dataSource.value = ''; dataLabel.value = ''; draw(); return; }
  try {
    const d = await api.job(jobId.value);
    const items = d.items.filter(i => i.status === 'generated');
    dataRows.value = items.map(i => ({
      code: i.normalized || i.raw,
      gtin: i.gtin,
      serial: i.serial,
      row: String(i.row_index + 1),
      row_index: i.row_index
    }));
    dataSource.value = 'job';
    dataLabel.value = d.job.name || '';
    maybeAutoTemplate();
    loadImage();
  } catch (e) { error.value = e.message; }
}
function loadImage() {
  itemImg = null;
  const it = currentItem.value;
  if (jobId.value == null || !it || it.row_index == null) { draw(); return; }
  const img = new Image();
  img.onload = () => { itemImg = img; draw(); };
  img.src = `/api/jobs/${jobId.value}/item/${it.row_index}.png`;
}
watch(row, loadImage);

async function saveTemplate() {
  error.value = ''; notice.value = '';
  try {
    const body = { name: tpl.name, widthMm: tpl.widthMm, heightMm: tpl.heightMm, dpi: tpl.dpi, elements: tpl.elements };
    const d = currentTemplateId.value
      ? await api.updateTemplate(currentTemplateId.value, body)
      : await api.createTemplate(body);
    currentTemplateId.value = d.template.id;
    notice.value = 'Шаблон сохранён';
    loadTemplates();
  } catch (e) { error.value = e.message; }
}
function openTemplate(t) {
  currentTemplateId.value = t.id;
  tpl.name = t.name; tpl.widthMm = t.widthMm; tpl.heightMm = t.heightMm; tpl.dpi = t.dpi;
  tpl.elements = JSON.parse(JSON.stringify(t.elements));
  selectedId.value = null;
}
async function removeTemplate(id) {
  try { await api.deleteTemplate(id); if (currentTemplateId.value === id) currentTemplateId.value = null; loadTemplates(); } catch (e) { error.value = e.message; }
}
function newTemplate() {
  currentTemplateId.value = null;
  tpl.name = 'Новая этикетка'; tpl.widthMm = 58; tpl.heightMm = 40; tpl.dpi = 203; tpl.elements = [];
  selectedId.value = null;
}

async function downloadBlob(url, body, filename) {
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Ошибка экспорта'); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function exportPdf() {
  error.value = '';
  if (!dataRows.value.length) { error.value = 'Загрузите коды КИЗ или данные BarTender'; return; }
  if (jobId.value == null && dataRows.value.length > 10000) {
    error.value = `Для PDF за один раз можно до 10 000 строк, сейчас ${dataRows.value.length}.`;
    return;
  }
  try {
    const body = jobId.value != null
      ? { template: tpl, jobId: jobId.value }
      : { template: tpl, rows: dataRows.value.map(({ row_index, ...r }) => r) };
    await downloadBlob('/api/labels/pdf', body, `labels-${dataRows.value.length}.pdf`);
  } catch (e) { error.value = e.message; }
}

async function exportPdfSingle() {
  error.value = '';
  if (!dataRows.value.length) { error.value = 'Загрузите коды КИЗ или данные BarTender'; return; }
  if (jobId.value == null && dataRows.value.length > 10000) {
    error.value = `Для PDF за один раз можно до 10 000 строк, сейчас ${dataRows.value.length}.`;
    return;
  }
  try {
    const body = jobId.value != null
      ? { template: tpl, jobId: jobId.value, single: true }
      : { template: tpl, rows: dataRows.value.map(({ row_index, ...r }) => r), single: true };
    await downloadBlob('/api/labels/pdf', body, `label-${tpl.widthMm}x${tpl.heightMm}-${dataRows.value.length}.pdf`);
  } catch (e) { error.value = e.message; }
}

function saveToken() { localStorage.setItem('cq_bridge_token', bridge.token); }
async function bridgePing() {
  bridge.status = 'checking';
  try {
    const r = await fetch(bridge.url + '/ping');
    const d = await r.json();
    bridge.status = d.ok ? 'ok' : 'fail';
    if (d.ok && bridge.token) {
      const pr = await fetch(bridge.url + '/printers', { headers: { 'X-Bridge-Token': bridge.token } });
      const pd = await pr.json();
      if (pr.ok) { bridge.printers = pd.printers; if (!bridge.printer) bridge.printer = pd.printers[0] || ''; }
      else bridge.status = 'token';
    }
  } catch { bridge.status = 'fail'; }
}
async function bridgePrint(savePng) {
  error.value = ''; notice.value = ''; bridge.busy = true; previewPng.value = '';
  try {
    if (!premium.value) throw new Error('Печать этикеток доступна на тарифе PREMIUM');
    if (!currentItem.value) throw new Error('Нет строки данных для печати');
    const prepared = await api.prepareLabel({ template: tpl, data: currentItem.value, row: Number(row.value) });
    const res = await fetch(bridge.url + '/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': bridge.token },
      body: JSON.stringify({ ...prepared, printer: bridge.printer, copies: Number(bridge.copies) || 1, savePng: !!savePng })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error + (d.detail ? ': ' + d.detail : ''));
    if (savePng && d.pngBase64) { previewPng.value = 'data:image/png;base64,' + d.pngBase64; notice.value = 'Рендер этикетки готов (так она будет напечатана)'; }
    else notice.value = 'Отправлено на принтер: ' + bridge.printer;
  } catch (e) { error.value = e.message; }
  bridge.busy = false;
}

onMounted(() => { loadTemplates(); loadJobs(); nextTick(draw); });
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/labels" />
    <section class="space-y-6 min-w-0">
      <h1 class="font-display font-bold text-3xl">Редактор этикеток</h1>
      <div v-if="!premium" class="glass rounded-2xl p-4 text-sm border-brand-500/40">
        ✏️ Проектируйте шаблоны бесплатно. Рендер, PDF-листы и печать через Bridge — на тарифе <b class="grad-text">PREMIUM</b> (подключение на этапе 4).
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-5">
          <h2 class="font-display font-semibold mb-1">1. КИЗ «Честного знака»</h2>
          <p class="text-xs text-slate-500 mb-3">PDF или CSV/TXT с кодами маркировки. Коды нужны для DataMatrix и полей этикетки.</p>
          <label class="btn-primary !py-2 !px-4 text-sm cursor-pointer">
            {{ kizBusy ? 'Читаем…' : 'Выбрать файл' }}
            <input type="file" class="hidden" accept=".pdf,.csv,.txt,.xlsx,.xls" :disabled="kizBusy" @change="onKizFile">
          </label>
          <p v-if="kizStatus" class="text-xs text-emerald-500 mt-2">{{ kizStatus }}</p>
        </div>

        <div class="glass rounded-2xl p-5">
          <h2 class="font-display font-semibold mb-1">2. Данные из BarTender</h2>
          <p class="text-xs text-slate-500 mb-3">CSV, TXT, XLSX, XLS, XML/BTXML, JSON, DAT — таблицы и данные полей. <b>.btw</b> — бинарный шаблон, из него переносятся только данные через CSV/BTXML.</p>
          <div class="flex flex-wrap gap-2">
            <label class="btn-ghost !py-2 !px-3 text-sm cursor-pointer">
              Выбрать файлы
              <input type="file" class="hidden" multiple accept=".btw,.btxml,.csv,.txt,.tsv,.xlsx,.xls,.xml,.json,.dat" :disabled="btBusy" @change="onBtFiles">
            </label>
            <label class="btn-ghost !py-2 !px-3 text-sm cursor-pointer">
              Выбрать папку
              <input type="file" class="hidden" multiple webkitdirectory directory accept=".btw,.btxml,.csv,.txt,.tsv,.xlsx,.xls,.xml,.json,.dat" :disabled="btBusy" @change="onBtFiles">
            </label>
          </div>
          <p v-if="btBusy" class="text-xs text-slate-500 mt-2">Читаем файлы…</p>
          <p v-if="btStatus" class="text-xs text-emerald-500 mt-2">{{ btStatus }}</p>
          <p v-if="btWarning" class="text-xs text-amber-500 mt-2">{{ btWarning }}</p>
        </div>
      </div>

      <div class="grid xl:grid-cols-[1fr_320px] gap-6">
        <!-- холст -->
        <div class="glass rounded-2xl p-6">
          <div class="flex flex-wrap gap-2 mb-4">
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('datamatrix')">▦ DataMatrix</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('code128')">||| Code128</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('ean13')">||| EAN-13</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('qrcode')">▣ QR</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('text')">Т Текст</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('field', 'gtin')">Поле GTIN</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('field', 'serial')">Поле Serial</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('field', 'code')">Поле КИЗ</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('field', 'row')">Поле №</button>
            <button v-if="selected" class="btn-ghost !py-1.5 !px-3 text-xs text-red-500 ml-auto" @click="removeSelected">✕ Удалить</button>
          </div>
          <div class="overflow-auto rounded-xl bg-slate-100 dark:bg-ink-900 p-6 flex justify-center">
            <canvas ref="canvas" class="shadow-xl cursor-move touch-none" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp"></canvas>
          </div>
          <p class="text-xs text-slate-500 mt-3">Перетаскивайте элементы мышью · размер {{ tpl.widthMm }}×{{ tpl.heightMm }} мм · {{ tpl.dpi }} DPI</p>
        </div>

        <!-- правая колонка -->
        <div class="space-y-6">
          <div class="glass rounded-2xl p-5 space-y-3">
            <h2 class="font-display font-semibold text-sm">Шаблон</h2>
            <input v-model="tpl.name" class="input !py-2 text-sm" placeholder="Название">
            <div class="flex flex-wrap gap-1.5">
              <button v-for="p in presets" :key="p.join()" class="btn-ghost !py-1 !px-2.5 text-xs" @click="tpl.widthMm = p[0]; tpl.heightMm = p[1]">{{ p[0] }}×{{ p[1] }}</button>
            </div>
            <button class="btn-ghost w-full !py-2 text-sm" @click="layout2in1">Собрать «2 в 1»: DataMatrix + EAN-13</button>
            <label class="flex items-center gap-2 text-xs text-slate-500">
              <input v-model="autoLayout" type="checkbox" @change="onAutoToggle"> Автосборка шаблона при загрузке
            </label>
            <div class="grid grid-cols-3 gap-2">
              <div><label class="label !text-xs">Ш, мм</label><input v-model.number="tpl.widthMm" type="number" min="10" max="210" class="input !py-1.5 text-sm"></div>
              <div><label class="label !text-xs">В, мм</label><input v-model.number="tpl.heightMm" type="number" min="10" max="297" class="input !py-1.5 text-sm"></div>
              <div><label class="label !text-xs">DPI</label><select v-model.number="tpl.dpi" class="input !py-1.5 text-sm"><option :value="203">203</option><option :value="300">300</option></select></div>
            </div>
            <div class="flex gap-2">
              <button class="btn-primary !py-2 !px-4 text-sm flex-1" @click="saveTemplate">💾 Сохранить</button>
              <button class="btn-ghost !py-2 !px-3 text-sm" @click="newTemplate">Новый</button>
            </div>
            <div v-if="templates.length" class="space-y-1 max-h-32 overflow-auto">
              <div v-for="t in templates" :key="t.id" class="flex items-center gap-2 text-xs">
                <button class="truncate hover:text-brand-400" :class="currentTemplateId === t.id ? 'font-bold text-brand-400' : ''" @click="openTemplate(t)">{{ t.name }} ({{ t.widthMm }}×{{ t.heightMm }})</button>
                <button class="ml-auto text-slate-400 hover:text-red-500" @click="removeTemplate(t.id)">✕</button>
              </div>
            </div>
          </div>

          <div v-if="selected" class="glass rounded-2xl p-5 space-y-3">
            <h2 class="font-display font-semibold text-sm">Элемент: {{ selected.type }}</h2>
            <div class="grid grid-cols-4 gap-2">
              <div v-for="k in ['x', 'y', 'w', 'h']" :key="k"><label class="label !text-xs">{{ k.toUpperCase() }}</label><input v-model.number="selected[k]" type="number" step="0.5" min="0" class="input !py-1.5 text-sm"></div>
            </div>
            <template v-if="selected.type === 'text'">
              <label class="label !text-xs">Текст</label><input v-model="selected.text" class="input !py-2 text-sm">
            </template>
            <template v-if="selected.type === 'field'">
              <label class="label !text-xs">Поле данных</label>
              <select v-model="selected.field" class="input !py-2 text-sm">
                <option v-for="f in fieldOptions" :key="f" :value="f">{{ f }}</option>
              </select>
            </template>
            <template v-if="['code128', 'ean13', 'qrcode'].includes(selected.type)">
              <label class="label !text-xs">Данные для штрихкода</label>
              <select v-model="selected.field" class="input !py-2 text-sm">
                <option value="">— фиксированный текст —</option>
                <option v-for="f in fieldOptions" :key="f" :value="f">{{ f }}</option>
              </select>
              <input v-if="!selected.field" v-model="selected.text" class="input !py-2 text-sm" placeholder="Текст или число">
            </template>
            <template v-if="selected.type === 'text' || selected.type === 'field'">
              <div class="grid grid-cols-2 gap-2">
                <div><label class="label !text-xs">Кегль, pt</label><input v-model.number="selected.fontSize" type="number" min="4" max="72" class="input !py-1.5 text-sm"></div>
                <div><label class="label !text-xs">Выравнивание</label><select v-model="selected.align" class="input !py-1.5 text-sm"><option value="left">Лево</option><option value="center">Центр</option><option value="right">Право</option></select></div>
              </div>
            </template>
          </div>

          <div class="glass rounded-2xl p-5 space-y-3">
            <h2 class="font-display font-semibold text-sm">Данные для предпросмотра</h2>
            <select v-model="jobId" class="input !py-2 text-sm" @change="onJobChange">
              <option :value="null">Пакет не выбран</option>
              <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.name }} ({{ j.done }} кодов)</option>
            </select>
            <div v-if="dataRows.length" class="text-xs text-slate-500">
              Источник: <b class="text-slate-700 dark:text-slate-200">{{ dataSource === 'kiz+bartender' ? 'КИЗ + BarTender' : dataSource === 'kiz' ? 'КИЗ' : dataSource === 'bartender' ? 'BarTender' : 'пакет' }}</b>
              · {{ dataRows.length }} строк
              <span v-if="dataLabel"> · {{ dataLabel }}</span>
            </div>
            <p v-if="mergeNote" class="text-xs text-amber-500">{{ mergeNote }}</p>
            <p v-if="duplicateCount" class="text-xs text-amber-500">Повторных КИЗ: {{ duplicateCount }} — проверьте перед печатью.</p>
            <div v-if="dataRows.length" class="flex items-center gap-2">
              <label class="label !text-xs !mb-0">Строка</label>
              <input v-model.number="rowNumber" type="number" min="1" :max="dataRows.length" class="input !py-1.5 text-sm w-24">
              <span class="text-xs text-slate-500">из {{ dataRows.length }}</span>
            </div>
            <div v-if="currentItem" class="text-xs text-slate-500 space-y-0.5">
              <div>GTIN: <span class="font-mono">{{ currentItem.gtin || '—' }}</span></div>
              <div>Серийник: <span class="font-mono">{{ currentItem.serial || '—' }}</span></div>
            </div>
            <button class="btn-primary w-full !py-2 text-sm" :disabled="!premium || !dataRows.length" @click="exportPdf">⬇ PDF-лист А4 ({{ dataRows.length || 0 }})</button>
            <button class="btn-ghost w-full !py-2 text-sm" :disabled="!premium || !dataRows.length" @click="exportPdfSingle">⬇ PDF по размеру этикетки {{ tpl.widthMm }}×{{ tpl.heightMm }} мм ({{ dataRows.length || 0 }})</button>
            <p class="text-xs text-slate-500">Для термопринтера выбирай PDF по размеру этикетки — без листа A4.</p>
          </div>

          <div class="glass rounded-2xl p-5 space-y-3">
            <h2 class="font-display font-semibold text-sm">🖨️ Print Bridge</h2>
            <div class="text-xs" :class="bridge.status === 'ok' ? 'text-emerald-500' : bridge.status === 'fail' ? 'text-red-500' : 'text-slate-500'">
              {{ { unknown: 'Не подключён', checking: 'Проверяем…', ok: '✓ Bridge на связи', fail: '✗ Bridge недоступен — запустите start.bat', token: '✗ Неверный токен' }[bridge.status] }}
            </div>
            <input v-model="bridge.token" class="input !py-2 text-sm font-mono" placeholder="Токен из консоли Bridge" @change="saveToken">
            <button class="btn-ghost w-full !py-2 text-sm" @click="bridgePing">Подключиться</button>
            <template v-if="bridge.status === 'ok'">
              <select v-model="bridge.printer" class="input !py-2 text-sm">
                <option v-for="p in bridge.printers" :key="p" :value="p">{{ p }}</option>
              </select>
              <div class="flex gap-2 items-center">
                <label class="label !text-xs !mb-0">Копий</label>
                <input v-model.number="bridge.copies" type="number" min="1" max="999" class="input !py-1.5 text-sm w-20">
              </div>
              <button class="btn-primary w-full !py-2 text-sm" :disabled="bridge.busy || !dataRows.length" @click="bridgePrint(false)">🖨️ Печатать этикетку</button>
              <button class="btn-ghost w-full !py-2 text-sm" :disabled="bridge.busy || !dataRows.length" @click="bridgePrint(true)">👁 Предпросмотр рендера</button>
            </template>
            <img v-if="previewPng" :src="previewPng" class="w-full rounded-lg border border-slate-200 dark:border-white/10" alt="Рендер этикетки">
          </div>
        </div>
      </div>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
      <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
    </section>
  </div>
</template>
