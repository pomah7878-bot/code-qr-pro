<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { parseKiz, readDataFile } from '../lib/labelData.js';
import SideNav from '../components/SideNav.vue';
import ValidHint from '../components/ValidHint.vue';
import PageGuide from '../components/PageGuide.vue';
import PrintHelp from '../components/PrintHelp.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { downloadBlob, downloadPdfTask, openPrintWindow, openPlaceholderWindow, isIOS } from '../lib/print.js';
import { mobilePdfGuard, mobilePrintGuard, mobilePdfNotice } from '../lib/mobile-print.js';

const MAX = 5000;
const categories = [
  { id: 'lp', title: 'Легпром', icon: 'shirt', defaults: { name: true, article: true, size: true, color: true, date: false, composition: true, ean13: true } },
  { id: 'shoes', title: 'Обувь', icon: 'shoe', defaults: { name: true, article: true, size: true, color: true, date: false, composition: false, ean13: true } },
  { id: 'toys', title: 'Игрушки', icon: 'toy', defaults: { name: true, article: true, size: false, color: false, date: true, composition: false, ean13: true } },
  { id: 'cosmetic', title: 'Косметика и химия', icon: 'bottle', defaults: { name: true, article: true, size: false, color: false, date: true, composition: true, ean13: true } },
  { id: 'pharmacy', title: 'Аптека / медикаменты', icon: 'pill', defaults: { name: true, article: false, size: false, color: false, date: false, composition: false, ean13: true, dosage: true, form: true, series: true, expiry: true, manufacturer: true } }
];
const formats = [
  { id: '58x40h', label: '58×40 мм — горизонтальный (5.8×4 см)', w: 58, h: 40 },
  { id: '58x40v', label: '58×40 мм — вертикальный (4×5.8 см)', w: 40, h: 58 },
  { id: '43x25', label: '43×25 мм', w: 43, h: 25 },
  { id: '30x20', label: '30×20 мм', w: 30, h: 20 },
  { id: '20x20', label: '20×20 мм', w: 20, h: 20 }
];
const fieldList = [
  { key: 'name', label: 'Название' },
  { key: 'article', label: 'Артикул' },
  { key: 'dosage', label: 'Дозировка' },
  { key: 'form', label: 'Форма выпуска' },
  { key: 'size', label: 'Размер' },
  { key: 'color', label: 'Цвет' },
  { key: 'series', label: 'Серия' },
  { key: 'expiry', label: 'Срок годности' },
  { key: 'date', label: 'Дата' },
  { key: 'composition', label: 'Состав' },
  { key: 'manufacturer', label: 'Производитель' },
  { key: 'ean13', label: 'Штрихкод' }
];

const category = ref('lp');
const format = ref('58x40h');
const fields = reactive(Object.fromEntries(fieldList.map((f) => [f.key, false])));
Object.assign(fields, categories[0].defaults);
const product = reactive({ name: '', article: '', size: '', color: '', date: '', composition: '', barcode: '', dosage: '', form: '', series: '', expiry: '', manufacturer: '' });
const codesText = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const pdfProgress = ref(null);
const pdfPercent = computed(() => {
  const p = pdfProgress.value;
  if (!p || !p.total) return 0;
  return Math.min(100, Math.round((p.done / p.total) * 100));
});
const result = ref(null);
const pdfUrl = ref('');
const shortWarning = ref('');
const qrOnly = ref(true);
const qrMargin = ref(0.5);
const printCode = ref(true);
const barcodeFormat = ref('ean13');
const barcodeFormats = [
  { id: 'ean13', label: 'EAN-13' },
  { id: 'ean8', label: 'EAN-8' },
  { id: 'upca', label: 'UPC-A' },
  { id: 'code128', label: 'Code128' },
  { id: 'code39', label: 'Code39' },
  { id: 'itf14', label: 'ITF-14' },
  { id: 'gs1_128', label: 'GS1-128' },
  { id: 'pdf417', label: 'PDF417' }
];
const productInfo = ref([]);
const infoMessage = ref('');
const infoLoading = ref(false);
const catalog = ref({});
const catalogStatus = ref('');
try { catalog.value = JSON.parse(localStorage.getItem('cq_product_catalog') || '{}'); } catch { catalog.value = {}; }
const cameraOpen = ref(false);
const cameraLoading = ref(false);
const cameraError = ref('');
const cameraDevices = ref([]);
const cameraId = ref('');
const videoEl = ref(null);
const cameraCount = ref(0);
const cameraVideoW = ref(0);
const cameraVideoH = ref(0);
const contours = ref([]);
const cameraNotice = ref('Наведите камеру на DataMatrix');
let cameraNoticeTimer = 0;
let contourTimer = 0;
const torchAvailable = ref(false);
const torchOn = ref(false);
const soundEnabled = ref(localStorage.getItem('cq_scan_sound') !== 'off');
let audioCtx = null;
let cameraStream = null;
let cameraSession = 0;
let scanTimer = 0;
let decodePending = false;
let decoderWorker = null;
let frameId = 0;
let scanCanvas = null;
let scanCtx = null;
let lastVideoTime = -1;

const settingsOpen = ref(false);
const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;
const serialConnected = ref(false);
const serialError = ref('');
const serialBaud = ref(9600);
let serialPort = null;
let serialReader = null;

function addCode(raw) {
  const code = String(raw || '').trim();
  if (!code) return false;
  const lines = codesText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.includes(code)) return false;
  lines.push(code);
  codesText.value = lines.join('\n');
  result.value = null;
  notice.value = `Добавлен код, всего строк: ${lines.length}`;
  playBeep();
  try { navigator.vibrate?.(40); } catch { /* без вибрации */ }
  return true;
}

function ensureAudio() {
  if (!audioCtx) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) audioCtx = new AudioCtor();
  }
  if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function playBeep() {
  if (!soundEnabled.value) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 1180;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.13);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.14);
}

function toggleSound() {
  soundEnabled.value = !soundEnabled.value;
  localStorage.setItem('cq_scan_sound', soundEnabled.value ? 'on' : 'off');
  if (soundEnabled.value) playBeep();
}

async function loadCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameraDevices.value = devices.filter((d) => d.kind === 'videoinput');
  } catch { /* нет доступа к устройствам */ }
}

function openSettings() {
  settingsOpen.value = true;
  loadCameras();
}

function setCameraNotice(text, resetMs = 1600) {
  cameraNotice.value = text;
  clearTimeout(cameraNoticeTimer);
  if (resetMs > 0) cameraNoticeTimer = setTimeout(() => { cameraNotice.value = 'Наведите камеру на DataMatrix'; }, resetMs);
}

function showContours(results) {
  contours.value = results.map((r) => r.position).filter(Boolean);
  clearTimeout(contourTimer);
  if (contours.value.length) contourTimer = setTimeout(() => { contours.value = []; }, 1400);
}

function polygonPoints(position) {
  if (!position) return '';
  return [position.topLeft, position.topRight, position.bottomRight, position.bottomLeft]
    .filter(Boolean)
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
}

function ensureDecoder() {
  if (decoderWorker) return;
  decoderWorker = new Worker(new URL('../lib/zxing-worker.js', import.meta.url), { type: 'module' });
  decoderWorker.onmessage = ({ data }) => {
    decodePending = false;
    if (data?.error) cameraError.value = `Декодер: ${data.error}`;
    const results = data?.results || [];
    if (results.length) {
      showContours(results);
      setCameraNotice(results.length > 1 ? `Считано кодов: ${results.length}` : 'Код считан');
    }
    for (const result of results) {
      if (addCode(result.text)) cameraCount.value += 1;
    }
  };
  decoderWorker.onerror = (e) => {
    decodePending = false;
    cameraError.value = e.message || 'Ошибка декодера';
  };
}

function cameraErrorMessage(e) {
  if (!window.isSecureContext) return 'Камера работает только по HTTPS. Откройте сайт через https:// и повторите.';
  if (!navigator.mediaDevices?.getUserMedia) return 'Браузер не поддерживает доступ к камере.';
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return 'Доступ к камере запрещён. Нажмите на замочек в адресной строке → «Камера» → «Разрешить» и повторите.';
  if (e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError') return 'Камера не найдена. Проверьте, что она подключена и не отключена в системе.';
  if (e?.name === 'NotReadableError') return 'Камера занята другим приложением. Закройте Zoom/Teams/камеру и повторите.';
  if (e?.name === 'OverconstrainedError') return 'Выбранная камера недоступна. Выберите другую в настройках сканера.';
  return e?.message || 'Не удалось открыть камеру';
}

async function openCamera() {
  if (cameraStream) closeCamera();
  cameraError.value = '';
  cameraCount.value = 0;
  cameraVideoW.value = 0;
  cameraVideoH.value = 0;
  contours.value = [];
  setCameraNotice('Наведите камеру на DataMatrix', 0);
  torchOn.value = false;
  torchAvailable.value = false;
  cameraOpen.value = true;
  cameraLoading.value = true;
  ensureAudio();
  const session = ++cameraSession;
  const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
  const attempts = cameraId.value
    ? [{ deviceId: { exact: cameraId.value }, ...base }, { facingMode: { ideal: 'environment' }, ...base }, base]
    : [{ facingMode: { ideal: 'environment' }, ...base }, base];
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Браузер не поддерживает доступ к камере');
    let lastError = null;
    for (const video of attempts) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
        if (cameraStream) break;
      } catch (e) {
        lastError = e;
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') break;
      }
    }
    if (!cameraStream) throw lastError || new Error('Камера не найдена');
    if (session !== cameraSession) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
      return;
    }
    await nextTick();
    videoEl.value.srcObject = cameraStream;
    await videoEl.value.play().catch(() => {});
    cameraVideoW.value = videoEl.value.videoWidth;
    cameraVideoH.value = videoEl.value.videoHeight;
    const track = cameraStream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() || {};
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
    torchAvailable.value = !!caps.torch;
    cameraLoading.value = false;
    ensureDecoder();
    scanLoop(session);
  } catch (e) {
    cameraLoading.value = false;
    cameraError.value = cameraErrorMessage(e);
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
  }
}

async function scanLoop(session) {
  if (!cameraOpen.value || session !== cameraSession) return;
  const video = videoEl.value;
  if (video && !decodePending && video.readyState >= 2 && video.videoWidth && video.videoHeight && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!scanCanvas) {
      scanCanvas = document.createElement('canvas');
      scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (scanCanvas.width !== width || scanCanvas.height !== height) {
      scanCanvas.width = width;
      scanCanvas.height = height;
    }
    scanCtx.drawImage(video, 0, 0, width, height);
    const image = scanCtx.getImageData(0, 0, width, height);
    ensureDecoder();
    decodePending = true;
    try {
      decoderWorker.postMessage(
        { type: 'decode', id: ++frameId, width, height, buffer: image.data.buffer },
        [image.data.buffer]
      );
    } catch {
      decodePending = false;
    }
  }
  scanTimer = setTimeout(() => scanLoop(session), 60);
}

function closeCamera() {
  cameraSession += 1;
  clearTimeout(scanTimer);
  if (decoderWorker) { decoderWorker.terminate(); decoderWorker = null; }
  decodePending = false;
  if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  cameraOpen.value = false;
  cameraLoading.value = false;
  cameraError.value = '';
  contours.value = [];
  clearTimeout(contourTimer);
  clearTimeout(cameraNoticeTimer);
  torchOn.value = false;
  if (videoEl.value) videoEl.value.srcObject = null;
}

async function toggleTorch() {
  if (!torchAvailable.value || !cameraStream) return;
  const track = cameraStream.getVideoTracks()[0];
  try {
    await track.applyConstraints({ advanced: [{ torch: !torchOn.value }] });
    torchOn.value = !torchOn.value;
  } catch {
    cameraError.value = 'Фонарик недоступен на этой камере';
  }
}

async function connectSerial() {
  serialError.value = '';
  ensureAudio();
  if (!serialSupported) { serialError.value = 'Web Serial не поддерживается этим браузером'; return; }
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: Number(serialBaud.value) || 9600 });
    serialConnected.value = true;
    readSerial();
  } catch (e) {
    serialPort = null;
    serialError.value = e.name === 'NotFoundError' || /No port selected|cancel/i.test(e.message || '') ? 'Выбор порта отменён' : (e.message || 'Не удалось открыть порт');
  }
}

async function readSerial() {
  try {
    const decoder = new TextDecoderStream();
    serialPort.readable.pipeTo(decoder.writable).catch(() => {});
    const reader = decoder.readable.getReader();
    serialReader = reader;
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx;
      while ((idx = buffer.search(/[\r\n]/)) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) addCode(line);
      }
    }
  } catch (e) {
    if (serialConnected.value) serialError.value = e.message || 'Ошибка чтения COM-порта';
  } finally {
    serialConnected.value = false;
  }
}

async function disconnectSerial() {
  try { await serialReader?.cancel(); } catch { /* уже закрыт */ }
  try { await serialPort?.close(); } catch { /* уже закрыт */ }
  serialReader = null;
  serialPort = null;
  serialConnected.value = false;
}

watch(category, (id) => {
  const c = categories.find((x) => x.id === id);
  for (const f of fieldList) fields[f.key] = false;
  if (c) Object.assign(fields, c.defaults);
  result.value = null;
});

const currentFormat = computed(() => formats.find((f) => f.id === format.value) || formats[0]);
const premium = computed(() => !!store.plan?.labelEditor);
onUnmounted(() => { if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value); });

// Черновик: на iOS PDF открывается в той же вкладке, и без этого после
// возврата «Назад» введённые коды и данные товара пропали бы.
const DRAFT_KEY = 'cq_reprint_draft';
function saveDraft() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      at: Date.now(),
      codesText: codesText.value,
      product: { ...product },
      format: format.value,
      qrOnly: qrOnly.value,
      qrMargin: qrMargin.value,
      barcodeFormat: barcodeFormat.value,
      fields: { ...fields }
    }));
  } catch { /* приватный режим — не сохраняем */ }
}
function restoreDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || Date.now() - Number(d.at || 0) > 30 * 60 * 1000) return;
    if (typeof d.codesText === 'string') codesText.value = d.codesText;
    if (d.product && typeof d.product === 'object') Object.assign(product, d.product);
    if (d.format) format.value = d.format;
    if (typeof d.qrOnly === 'boolean') qrOnly.value = d.qrOnly;
    if (d.qrMargin != null) qrMargin.value = d.qrMargin;
    if (d.barcodeFormat) barcodeFormat.value = d.barcodeFormat;
    if (d.fields && typeof d.fields === 'object') Object.assign(fields, d.fields);
  } catch { /* битый черновик — игнорируем */ }
}
onMounted(restoreDraft);

const codesCount = computed(() => codesText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length);
// Что можно прочитать прямо из кода (без обращения к ЧЗ)
const firstCode = computed(() => {
  const v = result.value?.valid?.[0];
  if (!v) return null;
  const s = String(v.code || '');
  const expiry = (s.match(/(?:^|\u001d)17(\d{6})/) || [])[1] || '';
  const batch = (s.match(/(?:^|\u001d)10([^\u001d]{1,20})/) || [])[1] || '';
  return {
    gtin: v.gtin || '',
    serial: v.serial || '',
    kind: v.short ? 'GS1 (код 93)' : 'КИЗ (код 91/92)',
    expiry: expiry ? `${expiry.slice(4, 6)}.${expiry.slice(2, 4)}.20${expiry.slice(0, 2)}` : '',
    batch
  };
});
const infoRows = computed(() => productInfo.value.map((p) => ({
  ...p,
  name: p.name || product.name,
  producer: p.producer || product.manufacturer,
  dosage: product.dosage,
  form: product.form
})));

async function checkCodes() {
  error.value = '';
  notice.value = '';
  shortWarning.value = '';
  productInfo.value = [];
  infoMessage.value = '';
  result.value = null;
  const lines = codesText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) { error.value = 'Вставьте коды — по одному на строку'; return; }
  if (lines.length > MAX) { error.value = `За раз можно до ${MAX} кодов, сейчас ${lines.length}`; return; }
  const parsed = lines.map(parseKiz).filter(Boolean);
  if (!parsed.length) { error.value = 'Коды не распознаны. Проверьте, что скопирован весь DataMatrix.'; return; }
  const full = parsed.filter((p) => !p.short);
  const short = parsed.filter((p) => p.short);
  const seenFull = new Set();
  const seenShort = new Set();
  const uniqueFull = [];
  const uniqueShort = [];
  let duplicates = 0;
  for (const p of full) {
    if (seenFull.has(p.code)) { duplicates += 1; continue; }
    seenFull.add(p.code);
    uniqueFull.push(p);
  }
  for (const p of short) {
    if (seenShort.has(p.code)) { duplicates += 1; continue; }
    seenShort.add(p.code);
    uniqueShort.push(p);
  }
  busy.value = true;
  try {
    const fullRes = uniqueFull.length ? await api.czVerify({ codes: uniqueFull.map((p) => p.code) }) : { results: [] };
    const shortRes = uniqueShort.length ? await api.czVerify({ codes: uniqueShort.map((p) => p.code), mode: 'gs1' }) : { results: [] };
    const validFull = uniqueFull.filter((_, i) => fullRes.results?.[i]?.ok);
    const validShort = uniqueShort.filter((_, i) => shortRes.results?.[i]?.ok);
    result.value = { valid: [...validFull, ...validShort], total: uniqueFull.length + uniqueShort.length };
    const parts = [];
    if (uniqueFull.length) parts.push(`полных ${validFull.length}/${uniqueFull.length}`);
    if (uniqueShort.length) parts.push(`без 91/92 ${validShort.length}/${uniqueShort.length}`);
    notice.value = `Проверено ${result.value.total}: ${result.value.valid.length} валидных${parts.length ? ` (${parts.join(', ')})` : ''}${duplicates ? `, убрано дублей: ${duplicates}` : ''}`;
    shortWarning.value = uniqueShort.length
      ? 'Коды без криптохвоста (91/92) будут напечатаны как есть — для «Честного ЗНАКа» это неполный код.'
      : '';
    productInfo.value = result.value.valid.map((c) => ({ code: c.code, gtin: c.gtin, serial: c.serial, short: c.short, name: '', producer: '', brand: '', group: '', status: '', owner: '' }));
    applyCatalog();
    loadProductInfo();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

function applyCatalog() {
  for (const p of productInfo.value) {
    const key = String(p.gtin || '').replace(/^0+/, '');
    const c = catalog.value[p.gtin] || catalog.value[key];
    if (!c) continue;
    p.name = p.name || c.name || c.product_name || '';
    p.producer = p.producer || c.manufacturer || c.producer || '';
    if (!product.name && (c.name || c.product_name)) product.name = c.name || c.product_name;
    if (!product.article && c.article) product.article = c.article;
    if (!product.dosage && c.dosage) product.dosage = c.dosage;
    if (!product.form && c.form) product.form = c.form;
    if (!product.series && c.series) product.series = c.series;
    if (!product.expiry && c.expiry) product.expiry = c.expiry;
    if (!product.manufacturer && (c.manufacturer || c.producer)) product.manufacturer = c.manufacturer || c.producer;
  }
}

async function loadCatalog(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  catalogStatus.value = '';
  try {
    const part = await readDataFile(file);
    if (!part.rows.length) throw new Error('В файле не найдены строки с GTIN');
    const map = {};
    for (const row of part.rows) {
      const gtin = String(row.gtin || '').trim();
      if (gtin) map[gtin] = row;
    }
    if (!Object.keys(map).length) throw new Error('Нужна колонка GTIN');
    catalog.value = map;
    localStorage.setItem('cq_product_catalog', JSON.stringify(map));
    catalogStatus.value = `Справочник: ${Object.keys(map).length} GTIN`;
    applyCatalog();
  } catch (e) {
    catalogStatus.value = e.message;
  } finally {
    ev.target.value = '';
  }
}

async function loadProductInfo() {
  const valid = productInfo.value.length ? productInfo.value : (result.value?.valid || []);
  if (!valid.length) return;
  infoLoading.value = true;
  try {
    const res = await fetch(`/api/cz/product?code=${encodeURIComponent(valid[0].code)}&gtin=${encodeURIComponent(valid[0].gtin || '')}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    const name = data.product?.name || '';
    const producer = data.product?.producer || '';
    const brand = data.product?.brand || '';
    const group = data.product?.group || '';
    const status = data.product?.status || '';
    const owner = data.product?.owner || '';
    if (name || brand || group || status || owner) {
      const sameGtin = new Set(valid.map((c) => c.gtin)).size === 1;
      for (const p of productInfo.value) {
        if (sameGtin || p.gtin === valid[0].gtin) {
          p.name = p.name || name;
          p.producer = p.producer || producer;
          p.brand = p.brand || brand;
          p.group = p.group || group;
          p.status = p.status || status;
          p.owner = p.owner || owner;
        }
      }
      if (!product.name && name) product.name = name;
      if (!product.manufacturer && producer) product.manufacturer = producer;
    }
    infoMessage.value = data.configured
      ? (name || brand ? '' : (data.message || 'Информация о товаре не найдена в ЧЗ'))
      : (data.message || 'Информация о товаре из ЧЗ не подключена — показываю GTIN и серийник из кода.');
  } catch (e) {
    infoMessage.value = `Не удалось получить информацию о товаре: ${e.message}`;
  } finally {
    infoLoading.value = false;
  }
}

function buildTemplate() {
  const f = currentFormat.value;
  const W = f.w, H = f.h;
  // Читаемые значения под DataMatrix: GTIN и серийник — те же данные, что зашиты в коде.
  const caption = (elements, x, y, width, fontSize = 6.5) => {
    const lineH = 2.9;
    elements.push({ id: 'capGtin', type: 'field', field: 'gtin', x, y, w: width, h: lineH, fontSize, align: 'left' });
    elements.push({ id: 'capSerial', type: 'field', field: 'serial', x, y: y + lineH + 0.3, w: width, h: lineH, fontSize, align: 'left' });
    return y + lineH * 2 + 0.9;
  };
  if (qrOnly.value) {
    const margin = Math.max(0.5, Math.min(3, Number(qrMargin.value) || 1));
    const textH = printCode.value ? 6.2 : 0;
    const size = Math.max(10, Math.min(W - 2 * margin, H - 2 * margin - textH - 1.6));
    const elements = [];
    const y = Math.max(margin, (H - textH - size) / 2);
    elements.push({ id: 'dm', type: 'datamatrix', x: (W - size) / 2, y, w: size, h: size, fontSize: 8, align: 'left' });
    if (printCode.value) {
      const capY = y + size + 1;
      if (capY + 6 <= H - 0.3) caption(elements, margin, capY, W - 2 * margin, 6.5);
    }
    return {
      name: `QR · ${f.label}`,
      widthMm: W,
      heightMm: H,
      dpi: 203,
      elements
    };
  }
  const tiny = W <= 22 && H <= 22;
  const m = tiny ? Math.min(W, H) * 0.1 : Math.max(1, Math.min(2.5, Math.min(W, H) * 0.05));
  const elements = [];
  const dm = tiny ? Math.min(W - 2 * m, H - 2 * m, 32)
    : printCode.value
      ? Math.min(W * 0.45, H * 0.36, 32)
      : Math.min(W * 0.45, H * 0.5, 35);
  elements.push({ id: 'dm', type: 'datamatrix', x: m, y: m, w: dm, h: dm, fontSize: 8, align: 'left' });
  let topH = dm;
  if (!tiny && fields.ean13 && String(product.barcode).trim()) {
    if (W >= 50) {
      const bx = m + dm + m;
      const bw = W - bx - m;
      const bh = Math.min(12, Math.max(6, H * 0.22));
      elements.push({ id: 'ean', type: barcodeFormat.value, field: 'barcode', x: bx, y: m, w: bw, h: bh, fontSize: 8, align: 'left' });
      topH = Math.max(topH, bh);
    } else if (m + dm + 1 + 9 <= H - m) {
      elements.push({ id: 'ean', type: barcodeFormat.value, field: 'barcode', x: m, y: m + dm + 1, w: W - 2 * m, h: 9, fontSize: 8, align: 'left' });
      topH = dm + 1 + 9;
    }
  }
  let y = m + topH + 1;
  if (printCode.value) y = Math.max(y, m + dm + 0.9);
  if (printCode.value && y + 6 <= H - m) {
    y = caption(elements, m, y, W - 2 * m, 6.5);
  }
  const lineH = Math.max(2.6, Math.min(4, H * 0.09));
  for (const { key } of fieldList) {
    if (key === 'ean13' || !fields[key]) continue;
    const value = String(product[key] || '').trim();
    if (!value) continue;
    if (y + lineH > H - m) break;
    elements.push({ id: key, type: 'field', field: key, x: m, y, w: W - 2 * m, h: lineH, fontSize: 7, align: 'left' });
    y += lineH + 0.5;
  }
  return { name: `Повторная печать · ${f.label}`, widthMm: W, heightMm: H, dpi: 203, elements };
}

async function downloadPdf() {
  error.value = '';
  notice.value = '';
  if (!premium.value) { error.value = 'PDF-печать доступна на тарифе PREMIUM'; return; }
  if (!codesCount.value) { error.value = 'Вставьте коды — по одному на строку'; return; }
  const pdfGuard = mobilePdfGuard(codesCount.value);
  if (pdfGuard) { error.value = pdfGuard; return; }
  // iOS: окно открываем синхронно в жесте, иначе Safari его заблокирует.
  const iosWin = isIOS() ? openPlaceholderWindow() : null;
  let navigated = false;
  busy.value = true;
  let timer = null;
  try {
    // Один клик: если коды ещё не проверялись — проверяем автоматически.
    if (!result.value?.valid.length) {
      await checkCodes();
      busy.value = true;
      if (!result.value?.valid.length) return;
    }
    const barcode = String(product.barcode || '').trim();
    const numericFormats = ['ean13', 'ean8', 'upca', 'itf14'];
    if (!qrOnly.value && fields.ean13 && barcode && numericFormats.includes(barcodeFormat.value) && !/^\d+$/.test(barcode.replace(/\s+/g, ''))) {
      error.value = 'Для выбранного формата штрихкод должен содержать цифры';
      return;
    }
    const template = buildTemplate();
    if (!template.elements.length) { error.value = 'Нечего печатать'; return; }
    const rows = result.value.valid.map((c) => ({
      code: c.code,
      gtin: c.gtin,
      serial: c.serial,
      barcode: String(product.barcode || '').trim(),
      name: String(product.name || '').trim(),
      article: String(product.article || '').trim(),
      dosage: String(product.dosage || '').trim(),
      form: String(product.form || '').trim(),
      size: String(product.size || '').trim(),
      color: String(product.color || '').trim(),
      series: String(product.series || '').trim(),
      expiry: String(product.expiry || '').trim(),
      date: String(product.date || '').trim(),
      composition: String(product.composition || '').trim(),
      manufacturer: String(product.manufacturer || '').trim()
    }));
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 120000);
    if (isIOS()) saveDraft();
    // Большие пакеты готовим в фоне: виден прогресс, и запрос не рвётся
    // мобильным таймаутом на десятках секунд генерации.
    const body = { template, rows, single: true, source: 'reprint' };
    let blobUrl;
    if (rows.length > 200) {
      pdfProgress.value = { done: 0, total: rows.length };
      blobUrl = await downloadPdfTask(
        '/api/labels/pdf',
        body,
        `reprint-${rows.length}.pdf`,
        (p) => { pdfProgress.value = { done: Number(p.done) || 0, total: Number(p.total) || rows.length }; },
        iosWin
      );
    } else {
      blobUrl = await downloadBlob('/api/labels/pdf', body, `reprint-${rows.length}.pdf`, iosWin);
    }
    navigated = true;
    const pdfNotice = mobilePdfNotice();
    notice.value = pdfNotice || 'PDF готов. Если файл не скачался — открой его по ссылке ниже.';
    if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value);
    pdfUrl.value = blobUrl;
  } catch (e) {
    error.value = e.name === 'AbortError' ? 'PDF формируется слишком долго. Уменьшите число кодов и попробуйте снова.' : e.message;
  } finally {
    if (!navigated && iosWin && !iosWin.closed) { try { iosWin.close(); } catch { /* ignore */ } }
    if (timer) clearTimeout(timer);
    pdfProgress.value = null;
    busy.value = false;
  }
}

async function printLabels() {
  error.value = ''; notice.value = '';
  if (!premium.value) { error.value = 'Печать доступна на тарифе PREMIUM'; return; }
  if (!codesCount.value) { error.value = 'Вставьте коды — по одному на строку'; return; }
  // На iPhone/iPad window.print() для отдельного окна не работает:
  // открываем PDF в просмотрщике Safari, откуда идёт печать.
  if (isIOS()) return downloadPdf();
  const printGuard = mobilePrintGuard(codesCount.value);
  if (printGuard) { error.value = printGuard; return; }
  const win = openPlaceholderWindow();
  busy.value = true;
  try {
    if (!result.value?.valid.length) {
      await checkCodes();
      busy.value = true;
      if (!result.value?.valid.length) return;
    }
    const barcode = String(product.barcode || '').trim();
    const numericFormats = ['ean13', 'ean8', 'upca', 'itf14'];
    if (!qrOnly.value && fields.ean13 && barcode && numericFormats.includes(barcodeFormat.value) && !/^\d+$/.test(barcode.replace(/\s+/g, ''))) {
      throw new Error('Для выбранного формата штрихкод должен содержать цифры');
    }
    const template = buildTemplate();
    if (!template.elements.length) throw new Error('Нечего печатать');
    const rows = result.value.valid.map((c) => ({
      code: c.code, gtin: c.gtin, serial: c.serial,
      barcode: String(product.barcode || '').trim(), name: String(product.name || '').trim(),
      article: String(product.article || '').trim(), dosage: String(product.dosage || '').trim(),
      form: String(product.form || '').trim(), size: String(product.size || '').trim(),
      color: String(product.color || '').trim(), series: String(product.series || '').trim(),
      expiry: String(product.expiry || '').trim(), date: String(product.date || '').trim(),
      composition: String(product.composition || '').trim(), manufacturer: String(product.manufacturer || '').trim()
    }));
    await openPrintWindow('/api/labels/print', { template, rows, source: 'reprint' }, win);
    notice.value = 'Окно печати открыто. Выберите принтер и нажмите «Печать».';
  } catch (e) {
    try { win?.close?.(); } catch { /* ignore */ }
    error.value = e.message;
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/reprint" />
    <section class="space-y-5 min-w-0">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="font-display font-bold text-3xl">Повторная печать этикеток</h1>
          <p class="text-sm text-slate-500 mt-1">Быстрый макет для повторной печати КИЗ: DataMatrix, EAN-13 и данные товара.</p>
        </div>
        <span class="text-xs text-slate-500">Встроенная повторная печать, без внешних сервисов</span>
      </div>

      <PageGuide
        id="reprint"
        title="Повторная печать за 3 шага"
        :steps="[
          'Вставьте коды в поле «Коды маркировки» — по одному на строку. Можно отсканировать камерой или COM-сканером.',
          'Выберите формат этикетки. Галочка «Только DataMatrix» подходит для большинства случаев; данные товара заполнять необязательно.',
          'Нажмите «Скачать PDF». Проверка кодов запустится автоматически — отдельно нажимать «Проверить» не нужно.'
        ]"
        note="До 5000 кодов за раз. Долгий пакет собирается с индикатором прогресса; если PDF не скачался, под кнопкой появится ссылка «Открыть PDF в новой вкладке»."
      />

      <div class="grid md:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-5 space-y-3">
          <h2 class="font-display font-semibold">Категория и шаблон</h2>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="c in categories" :key="c.id" class="rounded-xl border px-3 py-2 text-sm transition flex items-center gap-2 text-left"
              :class="category === c.id ? 'border-brand-500 bg-brand-500/10 font-semibold' : 'border-slate-200 dark:border-white/10 text-slate-500'"
              @click="category = c.id">
              <BrandIcon :name="c.icon" :size="20" />
              <span class="leading-tight">{{ c.title }}</span>
            </button>
          </div>
          <div>
            <label class="label !text-xs" for="reprint-format">Формат этикетки</label>
            <select id="reprint-format" v-model="format" class="input !py-2 text-sm">
              <option v-for="f in formats" :key="f.id" :value="f.id">{{ f.label }}</option>
            </select>
            <p class="text-xs text-slate-500 mt-1">PDF-страница: {{ currentFormat.w }}×{{ currentFormat.h }} мм ({{ (currentFormat.w / 10).toFixed(1) }}×{{ (currentFormat.h / 10).toFixed(1) }} см)</p>
          </div>
          <label class="flex items-start gap-2 text-sm mt-1">
            <input v-model="qrOnly" type="checkbox" class="mt-0.5">
            <span><b>Только DataMatrix — QR на всю этикетку</b><br><span class="text-xs text-slate-500">Квадратный код вписывается по меньшей стороне, по краям остаётся небольшой отступ для печати.</span></span>
          </label>
          <label class="flex items-start gap-2 text-sm mt-1">
            <input v-model="printCode" type="checkbox" class="mt-0.5">
            <span><b>Подписывать код: GTIN + серийник</b><br><span class="text-xs text-slate-500">Печатает под DataMatrix читаемые значения — те же данные, что зашиты в коде (как на этикетке «Честного ЗНАКа»).</span></span>
          </label>
          <div v-if="qrOnly" class="flex items-center gap-2 text-xs text-slate-500">
            <label for="qr-margin">Отступ, мм</label>
            <input id="qr-margin" v-model.number="qrMargin" type="number" min="0.5" max="3" step="0.5" class="input !py-1 !px-2 text-xs w-20">
            <span>0.5–1 мм — код крупнее, но следи за считываемостью.</span>
          </div>
          <div v-if="!qrOnly">
            <div class="text-xs text-slate-500 mb-2">Выводить на этикетке</div>
            <label class="flex items-center gap-2 text-sm mb-1.5"><input type="checkbox" checked disabled> GS1 DataMatrix (всегда)</label>
            <label v-for="f in fieldList" :key="f.key" class="flex items-center gap-2 text-sm mb-1.5">
              <input v-model="fields[f.key]" type="checkbox"> {{ f.label }}
            </label>
          </div>
        </div>

        <div class="glass rounded-2xl p-5 space-y-3">
          <h2 class="font-display font-semibold">Коды маркировки</h2>
          <textarea v-model="codesText" rows="6" class="input font-mono text-xs" placeholder="Вставьте полные коды — по одному на строку"></textarea>
          <p class="text-xs text-slate-500">До {{ MAX }} кодов. Нужен полный код с криптохвостом.</p>
          <div class="flex flex-wrap items-center gap-2">
            <button class="btn-ghost !py-2 !px-3 text-sm" @click="openCamera"><BrandIcon name="camera" :size="16" class="inline-block mr-1 -mt-0.5" />Камера</button>
            <button class="btn-ghost !py-2 !px-3 text-sm" @click="connectSerial">{{ serialConnected ? 'COM подключён' : 'COM-сканер' }}</button>
            <button class="btn-ghost !py-2 !px-2.5 text-sm" title="Настройки сканера" aria-label="Настройки сканера" @click="openSettings"><BrandIcon name="settings" :size="16" /></button>
          </div>
          <p v-if="cameraError" class="text-xs text-red-500">{{ cameraError }}</p>
          <p v-if="serialError" class="text-xs text-amber-500">{{ serialError }}</p>
          <button class="btn-ghost !py-2 text-sm" :disabled="busy" @click="checkCodes">{{ busy ? 'Проверяем…' : 'Проверить коды' }}</button>
          <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
          <p v-if="shortWarning" class="text-xs text-amber-500">{{ shortWarning }}</p>

          <div class="grid grid-cols-2 gap-2">
            <button class="btn-primary !py-2.5 text-sm" :disabled="busy || !premium || !codesCount" @click="downloadPdf">
              <BrandIcon v-if="!busy" name="download" :size="16" class="inline-block mr-1 -mt-0.5" />{{ busy ? (pdfProgress ? `Готовим… ${pdfPercent}%` : 'Готовим…') : `PDF (${result?.valid?.length || codesCount})` }}
            </button>
            <button class="btn-ghost !py-2.5 text-sm" :disabled="busy || !premium || !codesCount" @click="printLabels"><BrandIcon name="print" :size="16" class="inline-block mr-1 -mt-0.5" />Печать</button>
          </div>
          <div v-if="pdfProgress" class="space-y-1">
            <div class="h-2 w-full rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
              <div class="h-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all duration-300" :style="{ width: pdfPercent + '%' }"></div>
            </div>
            <p class="text-xs text-slate-500">Готовим PDF: {{ pdfProgress.done }} / {{ pdfProgress.total }} этикеток · {{ pdfPercent }}%</p>
          </div>
          <p class="text-xs text-slate-500">Один клик: проверим коды и подготовим PDF.</p>
          <p class="text-xs text-slate-500">При печати выберите принтер этикеток и бумагу {{ currentFormat.w }}×{{ currentFormat.h }} мм. Adobe PDF/A4 добавит белые поля.</p>
          <PrintHelp class="mt-2" />
          <a v-if="pdfUrl" :href="pdfUrl" download="reprint.pdf" target="_blank" rel="noopener" class="block text-center text-sm py-2 px-3 rounded-xl border border-brand-500/40 text-brand-400 font-medium">Открыть PDF ещё раз</a>
          <p v-if="result" class="text-xs text-slate-500">В PDF попадут только валидные коды.</p>
          <ValidHint v-if="result" class="mt-1" />
          <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
          <p v-if="!premium" class="text-xs text-amber-500">PDF-печать доступна на тарифе PREMIUM. <router-link to="/app/billing" class="underline font-medium">Оформить →</router-link></p>

          <div class="pt-3 border-t border-slate-200 dark:border-white/10">
            <h3 class="font-semibold text-sm mb-2">Данные товара</h3>
            <p class="text-xs text-slate-500 mb-2">Необязательно. Применяются ко всем кодам в этой печати.</p>
            <div class="grid grid-cols-2 gap-2">
              <input v-for="f in fieldList.filter((x) => x.key !== 'ean13')" :key="f.key" v-model="product[f.key]" class="input !py-1.5 text-sm" :placeholder="f.label">
              <input v-model="product.barcode" class="input !py-1.5 text-sm col-span-2" placeholder="Штрихкод (цифры или текст)">
              <select v-model="barcodeFormat" class="input !py-1.5 text-sm col-span-2">
                <option v-for="f in barcodeFormats" :key="f.id" :value="f.id">Формат: {{ f.label }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div v-if="result && productInfo.length" class="glass rounded-2xl p-5 mt-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 class="font-display font-semibold">Информация о кодах</h2>
          <div class="flex items-center gap-2">
            <span v-if="infoLoading" class="text-xs text-slate-500">Запрашиваем ЧЗ…</span>
            <label class="btn-ghost !py-1 !px-2 text-xs cursor-pointer">
              Справочник товаров
              <input type="file" class="hidden" accept=".csv,.xlsx,.xls" @change="loadCatalog">
            </label>
          </div>
        </div>
        <p v-if="catalogStatus" class="text-xs text-emerald-500 mb-1">{{ catalogStatus }}</p>
        <div v-if="firstCode" class="text-xs text-slate-500 mb-2 space-y-0.5">
          <div>
            <b>В коде:</b> GTIN <span class="font-mono">{{ firstCode.gtin }}</span>
            · серийник <span class="font-mono">{{ firstCode.serial }}</span>
            · {{ firstCode.kind }}
            <span v-if="firstCode.expiry"> · срок годности {{ firstCode.expiry }}</span>
            <span v-if="firstCode.batch"> · партия <span class="font-mono">{{ firstCode.batch }}</span></span>
          </div>
          <div>Наименование и производитель подтягиваются из «Честного ЗНАКа», если в настройках подключён токен ЧЗ; иначе видны GTIN и серийник из кода.</div>
        </div>
        <div class="overflow-auto max-h-64">
          <table class="w-full text-xs min-w-[680px]">
            <thead>
              <tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
                <th class="py-1.5 pr-3">GTIN</th>
                <th class="py-1.5 pr-3">Серийник</th>
                <th class="py-1.5 pr-3">Тип</th>
                <th class="py-1.5 pr-3">Товар</th>
                <th class="py-1.5 pr-3">Дозировка / форма</th>
                <th class="py-1.5 pr-3">Производитель</th>
                <th class="py-1.5">Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in infoRows.slice(0, 300)" :key="i" class="border-b border-slate-100 dark:border-white/5">
                <td class="py-1.5 pr-3 font-mono">{{ p.gtin }}</td>
                <td class="py-1.5 pr-3 font-mono">{{ p.serial }}</td>
                <td class="py-1.5 pr-3">{{ p.short ? 'GS1 (93)' : 'КИЗ (91/92)' }}</td>
                <td class="py-1.5 pr-3">{{ p.name || '—' }}<span v-if="p.brand || p.group" class="text-slate-500"> · {{ [p.brand, p.group].filter(Boolean).join(' / ') }}</span></td>
                <td class="py-1.5 pr-3">{{ [p.dosage, p.form].filter(Boolean).join(' · ') || '—' }}</td>
                <td class="py-1.5 pr-3">{{ p.producer || '—' }}</td>
                <td class="py-1.5">{{ p.status || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="infoRows.length > 300" class="text-xs text-slate-500 mt-2">Показаны первые 300 из {{ infoRows.length }} кодов — в PDF попадут все.</p>
        </div>
        <p v-if="infoMessage" class="text-xs text-slate-500 mt-2">{{ infoMessage }}</p>
        <p class="text-xs text-slate-500 mt-2">Для маркировки печатается GS1 DataMatrix с полным кодом; QR не заменяет DataMatrix и в 20×20 не помещается.</p>
      </div>
    </section>

    <div v-if="cameraOpen" class="fixed inset-0 z-50 bg-black">
      <video ref="videoEl" class="absolute inset-0 w-full h-full object-cover" autoplay playsinline muted></video>
      <svg v-if="cameraVideoW && cameraVideoH" class="absolute inset-0 w-full h-full pointer-events-none" :viewBox="`0 0 ${cameraVideoW} ${cameraVideoH}`" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <polygon v-for="(p, i) in contours" :key="i" :points="polygonPoints(p)" fill="none" stroke="#22d3ee" stroke-width="4" />
      </svg>

      <div class="absolute inset-x-0 top-0 p-3 flex items-center gap-2 bg-gradient-to-b from-black/75 to-transparent">
        <button class="rounded-full bg-black/50 text-white w-10 h-10" aria-label="Закрыть камеру" @click="closeCamera"><BrandIcon name="close" :size="18" /></button>
        <h2 class="text-white font-semibold">Сканирование</h2>
        <div class="ml-auto flex gap-2">
          <button class="rounded-full bg-black/50 text-white w-10 h-10" :aria-label="soundEnabled ? 'Выключить звук' : 'Включить звук'" @click="toggleSound"><BrandIcon :name="soundEnabled ? 'sound' : 'mute'" :size="18" /></button>
          <button v-if="torchAvailable" class="rounded-full bg-black/50 text-white px-3 h-10 text-sm" @click="toggleTorch">{{ torchOn ? 'Фонарик вкл' : 'Фонарик' }}</button>
        </div>
      </div>

      <div class="absolute inset-x-0 bottom-0 p-4 space-y-1.5 bg-gradient-to-t from-black/85 to-transparent">
        <p class="text-white text-sm">Собрано: <b>{{ cameraCount }}</b></p>
        <p class="text-white/50 text-xs">В основном поле: {{ codesCount }}. Лимит — {{ MAX }} кодов.</p>
        <p class="text-cyan-300 text-sm">{{ cameraNotice }}</p>
        <button class="w-full rounded-full bg-white text-slate-900 py-2.5 text-sm font-semibold" @click="closeCamera">Готово ({{ cameraCount }})</button>
      </div>

      <div v-if="cameraLoading" class="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-sm">Запрос доступа к камере…</div>
      <div v-else-if="cameraError" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 text-white text-center p-6">
        <p class="text-sm leading-relaxed max-w-sm">{{ cameraError }}</p>
        <div class="flex gap-2">
          <button class="rounded-full bg-white text-slate-900 px-4 py-2 text-sm font-semibold" @click="openCamera">Повторить</button>
          <button class="rounded-full border border-white/40 px-4 py-2 text-sm" @click="closeCamera">Закрыть</button>
        </div>
      </div>
    </div>

    <div v-if="settingsOpen" class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div class="glass rounded-2xl p-5 w-full max-w-md space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-display font-semibold">Настройки сканера</h3>
          <button class="text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Закрыть настройки" @click="settingsOpen = false"><BrandIcon name="close" :size="18" /></button>
        </div>

        <div>
          <label class="label !text-xs" for="scanner-camera">Камера</label>
          <select id="scanner-camera" v-model="cameraId" class="input !py-2 text-sm">
            <option value="">Камера по умолчанию</option>
            <option v-for="d in cameraDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || 'Камера' }}</option>
          </select>
          <button class="btn-ghost w-full !py-2 text-sm mt-2" @click="settingsOpen = false; openCamera()">Проверить камеру</button>
          <p v-if="cameraError" class="text-xs text-red-500 mt-1">{{ cameraError }}</p>
        </div>

        <div class="pt-3 border-t border-slate-200 dark:border-white/10">
          <label class="label !text-xs" for="scanner-baud">COM-порт</label>
          <select id="scanner-baud" v-model.number="serialBaud" class="input !py-2 text-sm">
            <option :value="9600">9600 бод</option>
            <option :value="19200">19200 бод</option>
            <option :value="115200">115200 бод</option>
          </select>
          <div class="mt-2">
            <button v-if="!serialConnected" class="btn-ghost w-full !py-2 text-sm" @click="connectSerial">Выбрать порт</button>
            <button v-else class="btn-ghost w-full !py-2 text-sm" @click="disconnectSerial">Отключить порт</button>
          </div>
          <p v-if="serialConnected" class="text-xs text-emerald-500 mt-1">COM-сканер подключён</p>
          <p v-if="serialError" class="text-xs text-amber-500 mt-1">{{ serialError }}</p>
          <p v-if="!serialSupported" class="text-xs text-slate-500 mt-1">Web Serial не поддерживается — используйте USB-сканер или камеру.</p>
        </div>

        <p class="text-xs text-slate-500">USB-сканер работает как клавиатура: просто сканируйте в поле кодов.</p>
      </div>
    </div>
  </div>
</template>
