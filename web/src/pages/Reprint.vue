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
const cameraOpen = ref(false);
const cameraError = ref('');
const cameraSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
const videoEl = ref(null);
let cameraStream = null;
let cameraTimer = null;
let detector = null;

function addCode(raw) {
  const code = String(raw || '').trim();
  if (!code) return;
  const lines = codesText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.includes(code)) lines.push(code);
  codesText.value = lines.join('\n');
  result.value = null;
  notice.value = `Добавлен код, всего строк: ${lines.length}`;
}

async function openCamera() {
  cameraError.value = '';
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    cameraOpen.value = true;
    await nextTick();
    videoEl.value.srcObject = cameraStream;
    await videoEl.value.play();
    let supported = [];
    try { supported = await window.BarcodeDetector.getSupportedFormats?.() || []; } catch { supported = []; }
    const formats = ['data_matrix', 'qr_code', 'ean_13', 'code_128'].filter((f) => supported.includes(f));
    detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);
    scanFrame();
  } catch (e) {
    cameraError.value = e.message;
    cameraOpen.value = false;
    if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
}

async function scanFrame() {
  if (!cameraOpen.value || !detector) return;
  try {
    const found = await detector.detect(videoEl.value);
    if (found.length) {
      addCode(found[0].rawValue);
      closeCamera();
      return;
    }
  } catch { /* кадр не распознан */ }
  cameraTimer = setTimeout(scanFrame, 350);
}

function closeCamera() {
  cameraOpen.value = false;
  clearTimeout(cameraTimer);
  if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  detector = null;
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
  result.value = null;
  const lines = codesText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) { error.value = 'Вставьте коды — по одному на строку'; return; }
  if (lines.length > MAX) { error.value = `За раз можно до ${MAX} кодов, сейчас ${lines.length}`; return; }
  const parsed = lines.map(parseKiz).filter(Boolean);
  if (!parsed.length) { error.value = 'Коды не распознаны. Нужны полные коды с криптохвостом'; return; }
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  for (const p of parsed) {
    if (seen.has(p.code)) { duplicates += 1; continue; }
    seen.add(p.code);
    unique.push(p);
  }
  busy.value = true;
  try {
    const res = await api.czVerify({ codes: unique.map((p) => p.code) });
    const valid = unique.filter((_, i) => res.results?.[i]?.ok);
    result.value = { valid, total: unique.length };
    notice.value = `Проверено ${unique.length}: ${valid.length} валидных, ${unique.length - valid.length} с ошибками${duplicates ? `, убрано дублей: ${duplicates}` : ''}`;
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

function buildTemplate() {
  const f = currentFormat.value;
  const W = f.w, H = f.h;
  const m = Math.max(1, Math.min(2.5, Math.min(W, H) * 0.05));
  const elements = [];
  const dm = Math.min(W * 0.45, H * 0.5, 35);
  elements.push({ id: 'dm', type: 'datamatrix', x: m, y: m, w: dm, h: dm, fontSize: 8, align: 'left' });
  let topH = dm;
  if (fields.ean13 && String(product.barcode).trim()) {
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
            <button v-if="cameraSupported" class="btn-ghost !py-2 !px-3 text-sm" @click="openCamera">📷 Камера</button>
            <span class="text-xs text-slate-500">USB-сканер печатает прямо в поле кодов</span>
          </div>
          <p v-if="cameraError" class="text-xs text-red-500">{{ cameraError }}</p>
          <button class="btn-primary !py-2 text-sm" :disabled="busy" @click="checkCodes">{{ busy ? 'Проверяем…' : 'Проверить коды' }}</button>
          <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

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

    <div v-if="cameraOpen" class="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
      <div class="relative rounded-2xl overflow-hidden w-full max-w-lg bg-black">
        <video ref="videoEl" class="w-full" playsinline muted></video>
        <button class="absolute top-2 right-2 rounded-full bg-black/60 text-white w-9 h-9" aria-label="Закрыть камеру" @click="closeCamera">✕</button>
        <p class="text-center text-xs text-white/70 py-2">Наведите камеру на DataMatrix</p>
      </div>
    </div>
  </div>
</template>
