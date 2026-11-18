<script setup>
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import SideNav from '../components/SideNav.vue';

const S = 4; // px на мм для предпросмотра
const canvas = ref(null);
const tpl = reactive({ name: 'Новая этикетка', widthMm: 58, heightMm: 40, dpi: 203, elements: [] });
const presets = [[58, 40], [43, 25], [30, 20], [75, 50], [100, 50]];
const selectedId = ref(null);
const selected = computed(() => tpl.elements.find(e => e.id === selectedId.value) || null);
const templates = ref([]);
const currentTemplateId = ref(null);
const jobs = ref([]);
const jobId = ref(null);
const jobItems = ref([]);
const row = ref(0);
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

const currentItem = computed(() => jobItems.value.find(i => i.row_index === Number(row.value)) || null);
function fieldSample(f) {
  if (currentItem.value) return f === 'row' ? String(currentItem.value.row_index + 1) : (currentItem.value[f] || '');
  return { gtin: '04600000000015', serial: '5PojkV', row: '1', code: '(01)…(21)…' }[f] || '';
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
    if (el.type === 'datamatrix' || el.type === 'code128') {
      if (el.type === 'datamatrix' && itemImg) {
        ctx.drawImage(itemImg, x, y, w, h);
      } else {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#475569';
        ctx.font = '10px Inter, sans-serif';
        ctx.fillText(el.type === 'datamatrix' ? '▦ DataMatrix' : '||| Code128', x + 3, y + 12);
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
  tpl.elements.push(base);
  selectedId.value = id;
}
function removeSelected() {
  tpl.elements = tpl.elements.filter(e => e.id !== selectedId.value);
  selectedId.value = null;
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
  jobItems.value = []; itemImg = null; row.value = 0;
  if (jobId.value == null) return;
  try {
    const d = await api.job(jobId.value);
    jobItems.value = d.items.filter(i => i.status === 'generated');
    loadImage();
  } catch (e) { error.value = e.message; }
}
function loadImage() {
  itemImg = null;
  if (jobId.value == null || !currentItem.value) { draw(); return; }
  const img = new Image();
  img.onload = () => { itemImg = img; draw(); };
  img.src = `/api/jobs/${jobId.value}/item/${currentItem.value.row_index}.png`;
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
  if (jobId.value == null) { error.value = 'Выберите пакет с кодами'; return; }
  try {
    await downloadBlob('/api/labels/pdf', { template: tpl, jobId: jobId.value }, `labels-${jobId.value}.pdf`);
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
    const prepared = await api.prepareLabel({ template: tpl, jobId: jobId.value, row: Number(row.value) });
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

      <div class="grid xl:grid-cols-[1fr_320px] gap-6">
        <!-- холст -->
        <div class="glass rounded-2xl p-6">
          <div class="flex flex-wrap gap-2 mb-4">
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('datamatrix')">▦ DataMatrix</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('code128')">||| Code128</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('text')">Т Текст</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('field', 'gtin')">Поле GTIN</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="addElement('field', 'serial')">Поле Serial</button>
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
              <select v-model="selected.field" class="input !py-2 text-sm"><option value="gtin">GTIN</option><option value="serial">Серийник</option><option value="row">№ строки</option></select>
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
              <option :value="null">Без пакета (пример)</option>
              <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.name }} ({{ j.done }} кодов)</option>
            </select>
            <select v-if="jobItems.length" v-model="row" class="input !py-2 text-sm">
              <option v-for="i in jobItems" :key="i.row_index" :value="i.row_index">Строка {{ i.row_index + 1 }} · {{ i.serial || i.gtin }}</option>
            </select>
            <button class="btn-primary w-full !py-2 text-sm" :disabled="!premium || jobId == null" @click="exportPdf">⬇ PDF-лист А4 (весь пакет)</button>
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
              <button class="btn-primary w-full !py-2 text-sm" :disabled="bridge.busy" @click="bridgePrint(false)">🖨️ Печатать этикетку</button>
              <button class="btn-ghost w-full !py-2 text-sm" :disabled="bridge.busy" @click="bridgePrint(true)">👁 Предпросмотр рендера</button>
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
