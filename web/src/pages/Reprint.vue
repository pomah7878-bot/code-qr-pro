<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { parseKiz } from '../lib/labelData.js';
import SideNav from '../components/SideNav.vue';

const MAX = 100;
const categories = [
  { id: 'lp', title: 'Легпром', defaults: { name: true, article: true, size: true, color: true, date: false, composition: true, ean13: true } },
  { id: 'shoes', title: 'Обувь', defaults: { name: true, article: true, size: true, color: true, date: false, composition: false, ean13: true } },
  { id: 'toys', title: 'Игрушки', defaults: { name: true, article: true, size: false, color: false, date: true, composition: false, ean13: true } },
  { id: 'cosmetic', title: 'Косметика и химия', defaults: { name: true, article: true, size: false, color: false, date: true, composition: true, ean13: true } }
];
const formats = [
  { id: '58x40v', label: '58×40 вертикальный', w: 40, h: 58 },
  { id: '58x40h', label: '58×40 горизонтальный', w: 58, h: 40 },
  { id: '43x25', label: '43×25', w: 43, h: 25 },
  { id: '30x20', label: '30×20', w: 30, h: 20 },
  { id: '20x20', label: '20×20', w: 20, h: 20 }
];
const fieldList = [
  { key: 'name', label: 'Название' },
  { key: 'article', label: 'Артикул' },
  { key: 'size', label: 'Размер' },
  { key: 'color', label: 'Цвет' },
  { key: 'date', label: 'Дата' },
  { key: 'composition', label: 'Состав' },
  { key: 'ean13', label: 'Штрихкод EAN-13' }
];

const category = ref('lp');
const format = ref('58x40v');
const fields = reactive({ ...categories[0].defaults });
const product = reactive({ name: '', article: '', size: '', color: '', date: '', composition: '', barcode: '' });
const codesText = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const result = ref(null);
const shortWarning = ref('');
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
  if (e?.name === 'OverconstrainedError') return 'Выбранная камера недоступна. Выберите другую в настройках ⚙️.';
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
  if (c) Object.assign(fields, c.defaults);
  result.value = null;
});

const currentFormat = computed(() => formats.find((f) => f.id === format.value) || formats[0]);
const premium = computed(() => !!store.plan?.labelEditor);
const codesCount = computed(() => codesText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length);

async function checkCodes() {
  error.value = '';
  notice.value = '';
  shortWarning.value = '';
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
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

function buildTemplate() {
  const f = currentFormat.value;
  const W = f.w, H = f.h;
  const tiny = W <= 22 && H <= 22;
  const m = tiny ? Math.min(W, H) * 0.1 : Math.max(1, Math.min(2.5, Math.min(W, H) * 0.05));
  const elements = [];
  const dm = tiny ? Math.min(W - 2 * m, H - 2 * m, 32) : Math.min(W * 0.45, H * 0.5, 35);
  elements.push({ id: 'dm', type: 'datamatrix', x: m, y: m, w: dm, h: dm, fontSize: 8, align: 'left' });
  let topH = dm;
  if (!tiny && fields.ean13 && String(product.barcode).trim()) {
    if (W >= 50) {
      const bx = m + dm + m;
      const bw = W - bx - m;
      const bh = Math.min(12, Math.max(6, H * 0.22));
      elements.push({ id: 'ean', type: 'ean13', field: 'barcode', x: bx, y: m, w: bw, h: bh, fontSize: 8, align: 'left' });
      topH = Math.max(topH, bh);
    } else if (m + dm + 1 + 9 <= H - m) {
      elements.push({ id: 'ean', type: 'ean13', field: 'barcode', x: m, y: m + dm + 1, w: W - 2 * m, h: 9, fontSize: 8, align: 'left' });
      topH = dm + 1 + 9;
    }
  }
  let y = m + topH + 1;
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
  if (!premium.value) { error.value = 'Печать этикеток доступна на тарифе PREMIUM'; return; }
  if (!result.value?.valid.length) { error.value = 'Сначала проверьте коды'; return; }
  const barcode = String(product.barcode || '').trim();
  if (fields.ean13 && barcode && !/^\d{12,13}$/.test(barcode)) {
    error.value = 'EAN-13 должен содержать 12 или 13 цифр';
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
    size: String(product.size || '').trim(),
    color: String(product.color || '').trim(),
    date: String(product.date || '').trim(),
    composition: String(product.composition || '').trim()
  }));
  busy.value = true;
  try {
    const res = await fetch('/api/labels/pdf', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, rows })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Не удалось сформировать PDF');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reprint-${rows.length}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
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

      <div class="grid md:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-5 space-y-3">
          <h2 class="font-display font-semibold">Категория и шаблон</h2>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="c in categories" :key="c.id" class="rounded-xl border px-3 py-2 text-sm transition"
              :class="category === c.id ? 'border-brand-500 bg-brand-500/10 font-semibold' : 'border-slate-200 dark:border-white/10 text-slate-500'"
              @click="category = c.id">{{ c.title }}</button>
          </div>
          <div>
            <label class="label !text-xs" for="reprint-format">Формат этикетки</label>
            <select id="reprint-format" v-model="format" class="input !py-2 text-sm">
              <option v-for="f in formats" :key="f.id" :value="f.id">{{ f.label }}</option>
            </select>
          </div>
          <div>
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
            <button class="btn-ghost !py-2 !px-3 text-sm" @click="openCamera">📷 Камера</button>
            <button class="btn-ghost !py-2 !px-3 text-sm" @click="connectSerial">{{ serialConnected ? 'COM подключён' : 'COM-сканер' }}</button>
            <button class="btn-ghost !py-2 !px-2.5 text-sm" title="Настройки сканера" aria-label="Настройки сканера" @click="openSettings">⚙️</button>
          </div>
          <p v-if="cameraError" class="text-xs text-red-500">{{ cameraError }}</p>
          <p v-if="serialError" class="text-xs text-amber-500">{{ serialError }}</p>
          <button class="btn-primary !py-2 text-sm" :disabled="busy" @click="checkCodes">{{ busy ? 'Проверяем…' : 'Проверить коды' }}</button>
          <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
          <p v-if="shortWarning" class="text-xs text-amber-500">{{ shortWarning }}</p>

          <div class="pt-3 border-t border-slate-200 dark:border-white/10">
            <h3 class="font-semibold text-sm mb-2">Данные товара</h3>
            <p class="text-xs text-slate-500 mb-2">Применяются ко всем кодам в этой печати.</p>
            <div class="grid grid-cols-2 gap-2">
              <input v-model="product.name" class="input !py-1.5 text-sm" placeholder="Название">
              <input v-model="product.article" class="input !py-1.5 text-sm" placeholder="Артикул">
              <input v-model="product.size" class="input !py-1.5 text-sm" placeholder="Размер">
              <input v-model="product.color" class="input !py-1.5 text-sm" placeholder="Цвет">
              <input v-model="product.date" class="input !py-1.5 text-sm" placeholder="Дата">
              <input v-model="product.composition" class="input !py-1.5 text-sm" placeholder="Состав">
              <input v-model="product.barcode" class="input !py-1.5 text-sm col-span-2" placeholder="Штрихкод EAN-13">
            </div>
          </div>

          <button class="btn-primary w-full !py-2.5 text-sm" :disabled="busy || !result || !result.valid.length" @click="downloadPdf">⬇ Скачать PDF ({{ result ? result.valid.length : 0 }})</button>
          <p v-if="result" class="text-xs text-slate-500">В PDF попадут только валидные коды.</p>
          <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
          <p v-if="!premium" class="text-xs text-amber-500">PDF-печать доступна на тарифе PREMIUM.</p>
        </div>
      </div>
    </section>

    <div v-if="cameraOpen" class="fixed inset-0 z-50 bg-black">
      <video ref="videoEl" class="absolute inset-0 w-full h-full object-cover" autoplay playsinline muted></video>
      <svg v-if="cameraVideoW && cameraVideoH" class="absolute inset-0 w-full h-full pointer-events-none" :viewBox="`0 0 ${cameraVideoW} ${cameraVideoH}`" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <polygon v-for="(p, i) in contours" :key="i" :points="polygonPoints(p)" fill="none" stroke="#22d3ee" stroke-width="4" />
      </svg>

      <div class="absolute inset-x-0 top-0 p-3 flex items-center gap-2 bg-gradient-to-b from-black/75 to-transparent">
        <button class="rounded-full bg-black/50 text-white w-10 h-10" aria-label="Закрыть камеру" @click="closeCamera">✕</button>
        <h2 class="text-white font-semibold">Сканирование</h2>
        <div class="ml-auto flex gap-2">
          <button class="rounded-full bg-black/50 text-white w-10 h-10" :aria-label="soundEnabled ? 'Выключить звук' : 'Включить звук'" @click="toggleSound">{{ soundEnabled ? '🔊' : '🔇' }}</button>
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
          <button class="text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Закрыть настройки" @click="settingsOpen = false">✕</button>
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
