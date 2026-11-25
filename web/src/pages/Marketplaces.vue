<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { api } from '../api.js';
import SideNav from '../components/SideNav.vue';
import PageGuide from '../components/PageGuide.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { downloadBlob, openPrintWindow, openPlaceholderWindow, isIOS } from '../lib/print.js';
import { mobilePdfNotice } from '../lib/mobile-print.js';

const tab = ref('product');
const markets = ref([]);
const profiles = ref([]);
const market = ref('wildberries');
const profileId = ref('');
const shipProfileId = ref('');
const products = ref([]);
const documents = ref([]);
const productQuery = ref('');
const savedId = ref(null);
const preview = ref(null);
const previewScale = ref(1);
const copies = ref(1);
const mode = ref('label');
const busy = ref(false);
const uploading = ref(false);
const error = ref('');
const notice = ref('');
const czCode = ref('');
const czBusy = ref(false);
const czMessage = ref('');
const fileInput = ref(null);

const form = reactive({
  name: '', manufacturer: '', produced_at: '', brand: '', sku: '', gtin: '',
  barcode: '', size: '', color: '', composition: '', batch: '', expires_at: '', code: ''
});

const productProfilesAll = computed(() => profiles.value.filter((p) => p.marketplace === market.value && p.kind === 'product'));
const shippingProfilesAll = computed(() => profiles.value.filter((p) => p.marketplace === market.value && p.kind === 'shipping'));
const currentProfile = computed(() => profiles.value.find((p) => p.id === profileId.value) || null);
const marketDocs = computed(() => documents.value.filter((d) => d.marketplace === market.value));
const marketTitle = computed(() => (markets.value.find((m) => m.id === market.value) || {}).title || '');

function firstProfile(list) {
  const ready = list.find((p) => !p.requiresCheck);
  return ready ? ready.id : '';
}

function selectMarket(id) {
  market.value = id;
  profileId.value = firstProfile(productProfilesAll.value);
  shipProfileId.value = firstProfile(shippingProfilesAll.value);
  preview.value = null;
  error.value = '';
  notice.value = '';
}

async function loadOverview() {
  const data = await api.mpOverview();
  markets.value = data.markets || [];
  profiles.value = data.profiles || [];
  if (!profileId.value) profileId.value = firstProfile(productProfilesAll.value);
  if (!shipProfileId.value) shipProfileId.value = firstProfile(shippingProfilesAll.value);
}

async function loadProducts() {
  const data = await api.mpProducts({ query: productQuery.value });
  products.value = data.products || [];
}

async function loadDocuments() {
  const data = await api.mpDocuments();
  documents.value = data.documents || [];
}

function clearForm() {
  for (const key of Object.keys(form)) form[key] = '';
  savedId.value = null;
}

function fillForm(p) {
  form.name = p.name || '';
  form.manufacturer = p.manufacturer || '';
  form.produced_at = p.producedAt || '';
  form.brand = p.brand || '';
  form.sku = p.sku || '';
  form.gtin = p.gtin || '';
  form.barcode = p.barcode || '';
  form.size = p.size || '';
  form.color = p.color || '';
  form.composition = p.composition || '';
  form.batch = p.batch || '';
  form.expires_at = p.expiresAt || '';
  form.code = p.code || '';
}

function onPickProduct() {
  preview.value = null;
  if (savedId.value == null) { clearForm(); return; }
  const p = products.value.find((x) => x.id === savedId.value);
  if (p) fillForm(p);
}

function editProduct(p) {
  fillForm(p);
  savedId.value = p.id;
  if (p.marketplace) selectMarket(p.marketplace);
  tab.value = 'product';
  preview.value = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveProduct() {
  error.value = ''; notice.value = '';
  if (!form.name.trim()) { error.value = 'Укажите наименование изделия'; return; }
  busy.value = true;
  try {
    const body = Object.assign({}, form, { marketplace: market.value });
    if (savedId.value != null) body.id = savedId.value;
    const data = await api.mpSaveProduct(body);
    savedId.value = data.product.id;
    notice.value = 'Товар сохранён';
    await loadProducts();
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}

async function archiveProduct(p) {
  error.value = '';
  try { await api.mpArchiveProduct(p.id); await loadProducts(); if (savedId.value === p.id) clearForm(); }
  catch (e) { error.value = e.message; }
}

async function deleteProduct(p) {
  error.value = '';
  try { await api.mpDeleteProduct(p.id); await loadProducts(); if (savedId.value === p.id) clearForm(); }
  catch (e) { error.value = e.message; }
}

async function fillFromCz() {
  czMessage.value = '';
  const raw = czCode.value.trim();
  if (!raw) { czMessage.value = 'Вставьте код маркировки или GTIN'; return; }
  czBusy.value = true;
  try {
    const gtin = form.gtin || (/^\d{14}$/.test(raw) ? raw : '');
    const res = await fetch('/api/cz/product?code=' + encodeURIComponent(raw) + '&gtin=' + encodeURIComponent(gtin), { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    const p = data.product || {};
    if (p.name && !form.name) form.name = p.name;
    if (p.producer && !form.manufacturer) form.manufacturer = p.producer;
    if (p.brand && !form.brand) form.brand = p.brand;
    if (p.composition && !form.composition) form.composition = p.composition;
    if (!form.gtin && /^\d{14}$/.test(raw)) form.gtin = raw;
    czMessage.value = (p.name || p.brand)
      ? 'Данные заполнены из открытых источников — проверьте перед печатью.'
      : (data.message || 'Карточка не найдена — заполните поля вручную.');
  } catch (e) { czMessage.value = e.message; } finally { czBusy.value = false; }
}

function labelBody(extra) {
  return Object.assign({
    profileId: profileId.value,
    productId: savedId.value != null ? savedId.value : undefined,
    fields: Object.assign({}, form),
    copies: Math.max(1, Math.min(500, Number(copies.value) || 1)),
    mode: mode.value,
    idemKey: 'mp-' + profileId.value + '-' + copies.value + '-' + mode.value + '-' + JSON.stringify(form)
  }, extra || {});
}

async function doPreview() {
  error.value = ''; notice.value = '';
  if (!profileId.value) { error.value = 'Выберите профиль этикетки'; return; }
  busy.value = true;
  try {
    preview.value = await api.mpPreview({
      profileId: profileId.value,
      productId: savedId.value != null ? savedId.value : undefined,
      fields: Object.assign({}, form)
    });
    updateScale();
  } catch (e) { error.value = e.message; preview.value = null; } finally { busy.value = false; }
}

async function downloadPdf() {
  error.value = ''; notice.value = '';
  const win = isIOS() ? openPlaceholderWindow() : null;
  let navigated = false;
  busy.value = true;
  try {
    await downloadBlob('/api/marketplaces/labels/pdf', labelBody(), 'marketplace-' + profileId.value + '.pdf', win);
    navigated = true;
    notice.value = mobilePdfNotice() || 'PDF готов';
  } catch (e) { error.value = e.message; } finally {
    if (!navigated && win && !win.closed) { try { win.close(); } catch { /* ignore */ } }
    busy.value = false;
  }
}

async function printLabel() {
  error.value = ''; notice.value = '';
  if (isIOS()) return downloadPdf();
  const win = openPlaceholderWindow();
  busy.value = true;
  try {
    await openPrintWindow('/api/marketplaces/labels/print', labelBody({ copies: Math.min(200, Number(copies.value) || 1) }), win);
    notice.value = 'Окно печати открыто — масштаб 100%, поля драйвера отключены';
  } catch (e) {
    try { win && win.close(); } catch { /* ignore */ }
    error.value = e.message;
  } finally { busy.value = false; }
}

async function onUploadFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  error.value = ''; notice.value = '';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  if (!isPdf && !isPng) { error.value = 'Поддерживаются оригиналы PDF и PNG'; return; }
  if (file.size > 20 * 1024 * 1024) { error.value = 'Файл больше 20 МБ'; return; }
  uploading.value = true;
  try {
    const mime = isPdf ? 'application/pdf' : 'image/png';
    const url = '/api/marketplaces/documents/upload?marketplace=' + encodeURIComponent(market.value)
      + '&kind=shipping&profileId=' + encodeURIComponent(shipProfileId.value || '')
      + '&filename=' + encodeURIComponent(file.name);
    const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': mime }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Не удалось загрузить файл');
    notice.value = 'Этикетка загружена: ' + (data.filename || file.name);
    await loadDocuments();
  } catch (e) { error.value = e.message; } finally { uploading.value = false; }
}

function printDoc(d) {
  error.value = ''; notice.value = '';
  const win = openPlaceholderWindow();
  if (d.mime === 'application/pdf') {
    const url = '/api/marketplaces/documents/' + d.id;
    if (win && !win.closed) win.location.href = url;
    else window.open(url, '_blank');
    notice.value = 'PDF открыт — печатайте в масштабе 100%, без полей';
    return;
  }
  const pid = d.profileId || shipProfileId.value;
  if (!pid) {
    error.value = 'Для PNG выберите профиль с размером этикетки';
    try { win && win.close(); } catch { /* ignore */ }
    return;
  }
  openPrintWindow('/api/marketplaces/documents/' + d.id + '/print', { profileId: pid, idemKey: 'mpdoc-' + d.id + '-' + pid }, win)
    .then(() => { notice.value = 'Окно печати открыто — масштаб 100%, без полей'; })
    .catch((e) => { error.value = e.message; try { win && win.close(); } catch { /* ignore */ } });
}

function downloadDoc(d) {
  window.open('/api/marketplaces/documents/' + d.id + '?download=1', '_blank');
}

async function deleteDoc(d) {
  error.value = '';
  try { await api.mpDeleteDocument(d.id); await loadDocuments(); }
  catch (e) { error.value = e.message; }
}

const boxes = ref([]);
const activeBox = ref(null);
const boxForm = reactive({ marketplace: 'wildberries', scheme: 'fbs', name: '' });
const itemForm = reactive({ productId: '', name: '', barcode: '', quantity: 1, profileId: '' });
const boxBusy = ref(false);
const boxFileInput = ref(null);

const boxProductProfiles = computed(() => profiles.value.filter((p) => activeBox.value && p.marketplace === activeBox.value.box.marketplace && p.kind === 'product' && !p.requiresCheck));
const boxUnits = computed(() => activeBox.value ? activeBox.value.items.reduce((s, i) => s + i.quantity, 0) : 0);
const boxMarketTitle = computed(() => activeBox.value ? ((markets.value.find((m) => m.id === activeBox.value.box.marketplace) || {}).title || '') : '');
const statusTitle = (s) => ({ packing: 'Собирается', ready: 'Готов к отгрузке', shipped: 'Отгружен' }[s] || s);

async function loadBoxes() {
  const d = await api.mpBoxes();
  boxes.value = d.boxes || [];
}
async function openBox(id) {
  error.value = '';
  try { activeBox.value = await api.mpBox(id); itemForm.profileId = ''; }
  catch (e) { error.value = e.message; }
}
function closeBox() { activeBox.value = null; loadBoxes().catch(() => {}); }
async function createBox() {
  error.value = ''; notice.value = '';
  boxBusy.value = true;
  try {
    await api.mpCreateBox({ marketplace: boxForm.marketplace, scheme: boxForm.scheme, name: boxForm.name });
    boxForm.name = '';
    await loadBoxes();
    notice.value = 'Короб создан — откройте его и добавьте товары';
  } catch (e) { error.value = e.message; } finally { boxBusy.value = false; }
}
async function saveBox() {
  error.value = '';
  const b = activeBox.value.box;
  try {
    const r = await api.mpUpdateBox(b.id, { name: b.name, scheme: b.scheme, status: b.status });
    activeBox.value.box = r.box;
    activeBox.value.guide = await api.mpBox(b.id).then((d) => d.guide).catch(() => activeBox.value.guide);
    notice.value = 'Короб сохранён';
  } catch (e) { error.value = e.message; }
}
async function removeBox(b) {
  error.value = '';
  try { await api.mpDeleteBox(b.id); if (activeBox.value && activeBox.value.box.id === b.id) activeBox.value = null; await loadBoxes(); }
  catch (e) { error.value = e.message; }
}
async function addItem() {
  error.value = '';
  const boxId = activeBox.value.box.id;
  const body = { quantity: Math.max(1, Number(itemForm.quantity) || 1) };
  if (itemForm.profileId) body.profileId = itemForm.profileId;
  if (itemForm.productId) body.productId = itemForm.productId;
  else { body.name = itemForm.name; body.barcode = itemForm.barcode; }
  try {
    await api.mpAddItem(boxId, body);
    itemForm.name = ''; itemForm.barcode = ''; itemForm.quantity = 1;
    await openBox(boxId);
  } catch (e) { error.value = e.message; }
}
async function setItemQty(item, q) {
  const boxId = activeBox.value.box.id;
  try { await api.mpUpdateItem(boxId, item.id, { quantity: Math.max(1, Number(q) || 1) }); await openBox(boxId); }
  catch (e) { error.value = e.message; }
}
async function setItemProfile(item, pid) {
  const boxId = activeBox.value.box.id;
  try { await api.mpUpdateItem(boxId, item.id, { profileId: pid }); await openBox(boxId); }
  catch (e) { error.value = e.message; }
}
async function removeItem(item) {
  const boxId = activeBox.value.box.id;
  try { await api.mpDeleteItem(boxId, item.id); await openBox(boxId); }
  catch (e) { error.value = e.message; }
}
async function boxLabelsPdf() {
  error.value = ''; notice.value = '';
  const id = activeBox.value.box.id;
  const win = isIOS() ? openPlaceholderWindow() : null;
  let navigated = false;
  boxBusy.value = true;
  try {
    await downloadBlob('/api/marketplaces/boxes/' + id + '/labels/pdf', { idemKey: 'mp-box-' + id + '-' + boxUnits.value }, 'box-' + id + '-labels.pdf', win);
    navigated = true;
    notice.value = mobilePdfNotice() || 'PDF этикеток товаров короба готов';
  } catch (e) { error.value = e.message; } finally {
    if (!navigated && win && !win.closed) { try { win.close(); } catch { /* ignore */ } }
    boxBusy.value = false;
  }
}
async function packingList() {
  error.value = ''; notice.value = '';
  const id = activeBox.value.box.id;
  const win = isIOS() ? openPlaceholderWindow() : null;
  let navigated = false;
  boxBusy.value = true;
  try {
    await downloadBlob('/api/marketplaces/boxes/' + id + '/packing-list', { idemKey: 'mp-box-list-' + id + '-' + boxUnits.value }, 'box-' + id + '-packing-list.pdf', win);
    navigated = true;
    notice.value = mobilePdfNotice() || 'Упаковочный лист готов';
  } catch (e) { error.value = e.message; } finally {
    if (!navigated && win && !win.closed) { try { win.close(); } catch { /* ignore */ } }
    boxBusy.value = false;
  }
}
async function onBoxFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file || !activeBox.value) return;
  error.value = ''; notice.value = '';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  if (!isPdf && !isPng) { error.value = 'Поддерживаются оригиналы PDF и PNG'; return; }
  if (file.size > 20 * 1024 * 1024) { error.value = 'Файл больше 20 МБ'; return; }
  boxBusy.value = true;
  const boxId = activeBox.value.box.id;
  try {
    const mime = isPdf ? 'application/pdf' : 'image/png';
    const url = '/api/marketplaces/documents/upload?marketplace=' + encodeURIComponent(activeBox.value.box.marketplace)
      + '&kind=shipping&filename=' + encodeURIComponent(file.name);
    const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': mime }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Не удалось загрузить файл');
    await api.mpLinkDoc(boxId, data.id);
    await openBox(boxId);
    await loadDocuments();
    notice.value = 'Этикетка короба загружена и привязана';
  } catch (e) { error.value = e.message; } finally { boxBusy.value = false; }
}
async function linkDoc(docId) {
  error.value = '';
  try { await api.mpLinkDoc(activeBox.value.box.id, docId); await openBox(activeBox.value.box.id); }
  catch (e) { error.value = e.message; }
}
async function unlinkDoc() {
  error.value = '';
  try { await api.mpLinkDoc(activeBox.value.box.id, null); await openBox(activeBox.value.box.id); }
  catch (e) { error.value = e.message; }
}
function printBoxDoc() {
  const d = activeBox.value && activeBox.value.document;
  if (!d) return;
  const sp = profiles.value.find((p) => p.marketplace === d.marketplace && p.kind === 'shipping' && !p.requiresCheck);
  printDoc(Object.assign({}, d, { profileId: sp ? sp.id : '' }));
}
function downloadBoxDoc() {
  const d = activeBox.value && activeBox.value.document;
  if (d) downloadDoc(d);
}

function openRuler() {
  const win = openPlaceholderWindow();
  if (!win) return;
  let ticks = '';
  for (let i = 0; i <= 10; i++) ticks += '<div class="tick" style="left:' + (i * 10) + 'mm"></div>';
  win.document.open();
  win.document.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Тестовая линейка 100 мм</title><style>'
    + '@page{size:A4;margin:10mm}body{font:14px Arial;color:#111;margin:0}'
    + '.ruler{width:100mm;height:12mm;border:1px solid #000;position:relative;margin:16mm 0 6mm}'
    + '.tick{position:absolute;top:0;bottom:0;width:1px;background:#000}'
    + '</style></head><body>'
    + '<div>Линейка 100 мм. Распечатайте и измерьте: должно быть ровно 10 см. Если нет — отключите масштабирование («По размеру страницы») и поля в драйвере принтера.</div>'
    + '<div class="ruler">' + ticks + '</div>'
    + '<div>Масштаб 100% · поля драйвера отключены</div>'
    + '</body></html>');
  win.document.close();
}

function elStyle(el) {
  return {
    position: 'absolute', left: el.x + 'mm', top: el.y + 'mm',
    width: el.w + 'mm', height: el.h + 'mm',
    fontSize: (el.fontSize || 8) + 'pt', textAlign: el.align || 'left',
    overflow: 'hidden', color: '#000', lineHeight: 1.15, objectFit: 'contain'
  };
}

function updateScale() {
  const p = preview.value;
  if (!p) return;
  const available = Math.min(620, (typeof window !== 'undefined' ? window.innerWidth : 800) - 72);
  previewScale.value = Math.min(1, available / (p.widthMm * 3.7795));
}

function fmtSize(n) {
  return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ';
}

watch(form, () => { preview.value = null; }, { deep: true });
watch(preview, updateScale);

onMounted(async () => {
  window.addEventListener('resize', updateScale);
  try {
    await loadOverview();
    await Promise.all([loadProducts(), loadDocuments(), loadBoxes()]);
  } catch (e) { error.value = e.message; }
});
onUnmounted(() => window.removeEventListener('resize', updateScale));
</script>

<template>
  <div class="max-w-[1680px] mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/marketplaces" />
    <section class="space-y-6 min-w-0">
      <div>
        <h1 class="font-display font-bold text-3xl">Маркетплейсы</h1>
        <p class="text-slate-500 mt-2">Этикетки под требования площадок: Wildberries, Ozon и Яндекс Маркет. Товарные — генерируйте, транспортные — печатайте из оригинала кабинета без перерисовки.</p>
      </div>

      <PageGuide
        id="marketplaces"
        title="Печать этикеток для маркетплейса за 3 шага"
        :steps="[
          'Выберите площадку и профиль этикетки — размеры и поля взяты из официальных требований площадок.',
          'Заполните данные товара вручную, из сохранённых товаров или кнопкой «Заполнить из ЧЗ», затем нажмите «Предпросмотр».',
          'Скачайте PDF точного размера или лист А4 либо печатайте из браузера. Для транспортных этикеток загрузите оригинал PDF/PNG из кабинета площадки.'
        ]"
        note="Печатайте в масштабе 100% без полей драйвера. Перед партией проверьте размер тестовой линейкой и читаемость кодов сканером."
      />

      <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <button v-for="m in markets" :key="m.id" type="button" @click="selectMarket(m.id)"
          class="min-h-[44px] px-4 py-2.5 rounded-full border text-sm font-medium whitespace-nowrap transition"
          :class="market === m.id ? 'bg-gradient-to-r from-brand-500/20 to-accent-500/10 border-brand-500/40 text-slate-800 dark:text-white' : 'border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'">
          {{ m.title }}
        </button>
      </div>

      <div class="grid grid-cols-2 sm:flex gap-2">
        <button type="button" @click="tab = 'product'" class="min-h-[44px] px-4 py-2.5 rounded-xl border text-sm font-medium transition" :class="tab === 'product' ? 'border-brand-500/40 bg-brand-500/10 text-slate-800 dark:text-white' : 'border-slate-200 dark:border-white/10 text-slate-500'">Товарная этикетка</button>
        <button type="button" @click="tab = 'shipping'" class="min-h-[44px] px-4 py-2.5 rounded-xl border text-sm font-medium transition" :class="tab === 'shipping' ? 'border-brand-500/40 bg-brand-500/10 text-slate-800 dark:text-white' : 'border-slate-200 dark:border-white/10 text-slate-500'">Этикетка отправки</button>
        <button type="button" @click="tab = 'products'" class="min-h-[44px] px-4 py-2.5 rounded-xl border text-sm font-medium transition" :class="tab === 'products' ? 'border-brand-500/40 bg-brand-500/10 text-slate-800 dark:text-white' : 'border-slate-200 dark:border-white/10 text-slate-500'">Мои товары</button>
        <button type="button" @click="tab = 'documents'" class="min-h-[44px] px-4 py-2.5 rounded-xl border text-sm font-medium transition" :class="tab === 'documents' ? 'border-brand-500/40 bg-brand-500/10 text-slate-800 dark:text-white' : 'border-slate-200 dark:border-white/10 text-slate-500'">Документы</button>
        <button type="button" @click="tab = 'boxes'" class="min-h-[44px] px-4 py-2.5 rounded-xl border text-sm font-medium transition" :class="tab === 'boxes' ? 'border-brand-500/40 bg-brand-500/10 text-slate-800 dark:text-white' : 'border-slate-200 dark:border-white/10 text-slate-500'">Коробки</button>
      </div>

      <p v-if="error" class="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      <p v-if="notice" class="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">{{ notice }}</p>

      <!-- Товарная этикетка -->
      <div v-if="tab === 'product'" class="space-y-4">
        <div class="glass rounded-2xl p-5 space-y-4">
          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="label" for="mp-profile">Профиль этикетки · {{ marketTitle }}</label>
              <select id="mp-profile" v-model="profileId" class="input" @change="preview = null">
                <option v-for="p in productProfilesAll" :key="p.id" :value="p.id" :disabled="p.requiresCheck">{{ p.name }}{{ p.requiresCheck ? ' — требует проверки' : '' }}</option>
              </select>
            </div>
            <div>
              <label class="label" for="mp-saved">Сохранённый товар</label>
              <select id="mp-saved" v-model="savedId" class="input" @change="onPickProduct">
                <option :value="null">Новый товар (вручную)</option>
                <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}{{ p.sku ? ' · ' + p.sku : '' }}</option>
              </select>
            </div>
          </div>
          <div v-if="currentProfile" class="text-xs text-slate-500 space-y-1">
            <p v-for="(n, i) in currentProfile.notes" :key="i">• {{ n }}</p>
            <p v-if="currentProfile.sourceUrl">Источник требований: <a :href="currentProfile.sourceUrl" target="_blank" rel="noopener" class="text-brand-400 underline">официальная страница площадки</a> · проверено {{ currentProfile.verifiedAt }}</p>
          </div>
          <div class="flex flex-col sm:flex-row gap-2">
            <input v-model="czCode" class="input flex-1" placeholder="Код маркировки или GTIN — для автозаполнения из ЧЗ" aria-label="Код маркировки или GTIN">
            <button type="button" class="btn-ghost min-h-[44px] !py-2.5" :disabled="czBusy" @click="fillFromCz">{{ czBusy ? 'Загружаем…' : 'Заполнить из ЧЗ' }}</button>
          </div>
          <p v-if="czMessage" class="text-xs text-slate-500">{{ czMessage }}</p>
        </div>

        <div class="glass rounded-2xl p-5">
          <div class="grid sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2">
              <label class="label" for="mp-name">Наименование изделия *</label>
              <input id="mp-name" v-model="form.name" class="input" maxlength="200" placeholder="Как в карточке товара">
            </div>
            <div>
              <label class="label" for="mp-barcode">Штрихкод (EAN-13 / Code-128)</label>
              <input id="mp-barcode" v-model="form.barcode" class="input font-mono" placeholder="12–13 цифр EAN или код Code-128">
            </div>
            <div>
              <label class="label" for="mp-gtin">GTIN</label>
              <input id="mp-gtin" v-model="form.gtin" class="input font-mono" placeholder="14 цифр">
            </div>
            <div>
              <label class="label" for="mp-sku">Артикул продавца</label>
              <input id="mp-sku" v-model="form.sku" class="input">
            </div>
            <div>
              <label class="label" for="mp-brand">Бренд</label>
              <input id="mp-brand" v-model="form.brand" class="input">
            </div>
            <div>
              <label class="label" for="mp-manufacturer">Изготовитель</label>
              <input id="mp-manufacturer" v-model="form.manufacturer" class="input" placeholder="ООО «…» / ИП …">
            </div>
            <div>
              <label class="label" for="mp-produced">Дата изготовления</label>
              <input id="mp-produced" v-model="form.produced_at" class="input" placeholder="ДД.ММ.ГГГГ">
            </div>
            <div>
              <label class="label" for="mp-expires">Годен до</label>
              <input id="mp-expires" v-model="form.expires_at" class="input" placeholder="ДД.ММ.ГГГГ">
            </div>
            <div>
              <label class="label" for="mp-size">Размер</label>
              <input id="mp-size" v-model="form.size" class="input">
            </div>
            <div>
              <label class="label" for="mp-color">Цвет</label>
              <input id="mp-color" v-model="form.color" class="input">
            </div>
            <div>
              <label class="label" for="mp-batch">Партия / серия</label>
              <input id="mp-batch" v-model="form.batch" class="input">
            </div>
            <div class="sm:col-span-2">
              <label class="label" for="mp-composition">Состав / описание (на русском)</label>
              <textarea id="mp-composition" v-model="form.composition" rows="2" class="input"></textarea>
            </div>
          </div>
          <div class="flex flex-col sm:flex-row gap-2 mt-4">
            <button type="button" class="btn-primary min-h-[44px] !py-2.5" :disabled="busy" @click="doPreview">{{ busy ? 'Готовим…' : 'Предпросмотр' }}</button>
            <button type="button" class="btn-ghost min-h-[44px] !py-2.5" :disabled="busy" @click="saveProduct">Сохранить товар</button>
          </div>
        </div>

        <div v-if="preview" class="glass rounded-2xl p-5 space-y-4">
          <div class="flex flex-wrap items-center gap-3">
            <h2 class="font-display font-semibold">Макет · {{ preview.widthMm }}×{{ preview.heightMm }} мм</h2>
            <span class="text-xs text-slate-500">предпросмотр уменьшен для экрана; PDF — точный физический размер</span>
          </div>
          <div class="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 bg-white p-3 w-fit max-w-full">
            <div :style="{ width: (preview.widthMm * 3.7795 * previewScale) + 'px', height: (preview.heightMm * 3.7795 * previewScale) + 'px' }">
              <div :style="{ width: preview.widthMm + 'mm', height: preview.heightMm + 'mm', transform: 'scale(' + previewScale + ')', transformOrigin: 'top left', position: 'relative', background: '#fff' }">
                <template v-for="el in preview.elements" :key="el.id">
                  <img v-if="el.pngBase64" :src="'data:image/png;base64,' + el.pngBase64" alt="" :style="elStyle(el)">
                  <div v-else-if="el.text" :style="elStyle(el)">{{ el.text }}</div>
                </template>
              </div>
            </div>
          </div>
          <ul v-if="preview.problems.length" class="text-sm text-red-600 dark:text-red-400 space-y-1">
            <li v-for="(p, i) in preview.problems" :key="'p' + i">✕ {{ p }}</li>
          </ul>
          <ul v-if="preview.warnings.length" class="text-sm text-amber-600 dark:text-amber-400 space-y-1">
            <li v-for="(w, i) in preview.warnings" :key="'w' + i">⚠ {{ w }}</li>
          </ul>
          <div class="flex flex-wrap items-end gap-4">
            <div>
              <label class="label" for="mp-copies">Количество</label>
              <input id="mp-copies" v-model.number="copies" type="number" min="1" max="500" class="input w-28">
            </div>
            <div class="flex gap-2">
              <button type="button" @click="mode = 'label'" class="min-h-[44px] px-4 py-2.5 rounded-xl border text-sm" :class="mode === 'label' ? 'border-brand-500/40 bg-brand-500/10' : 'border-slate-200 dark:border-white/10 text-slate-500'">Этикетка</button>
              <button type="button" @click="mode = 'a4'" class="min-h-[44px] px-4 py-2.5 rounded-xl border text-sm" :class="mode === 'a4' ? 'border-brand-500/40 bg-brand-500/10' : 'border-slate-200 dark:border-white/10 text-slate-500'">Лист А4</button>
            </div>
          </div>
          <div class="flex flex-col sm:flex-row gap-2">
            <button type="button" class="btn-primary min-h-[44px] !py-2.5" :disabled="busy || !preview.canPrint" @click="downloadPdf">Скачать PDF</button>
            <button type="button" class="btn-ghost min-h-[44px] !py-2.5" :disabled="busy || !preview.canPrint" @click="printLabel">Печать</button>
            <button type="button" class="btn-ghost min-h-[44px] !py-2.5" @click="openRuler">Тестовая линейка 100 мм</button>
          </div>
        </div>
      </div>

      <!-- Этикетка отправки -->
      <div v-if="tab === 'shipping'" class="space-y-4">
        <div class="glass rounded-2xl p-5 space-y-3">
          <h2 class="font-display font-semibold">Оригинал из кабинета · {{ marketTitle }}</h2>
          <p class="text-sm text-slate-500">Стикер заказа WB, этикетка отправления Ozon и ярлык Яндекс Маркета формируются в кабинете площадки. Скачайте готовый PDF и загрузите сюда — сервис напечатает его без перерисовки, в фактическом размере.</p>
          <div>
            <label class="label" for="mp-ship-profile">Профиль (размер для PNG и справки)</label>
            <select id="mp-ship-profile" v-model="shipProfileId" class="input">
              <option v-for="p in shippingProfilesAll" :key="p.id" :value="p.id" :disabled="p.requiresCheck">{{ p.name }}{{ p.requiresCheck ? ' — требует проверки' : '' }}</option>
            </select>
          </div>
          <div v-if="shippingProfilesAll.find((p) => p.id === shipProfileId)" class="text-xs text-slate-500 space-y-1">
            <p v-for="(n, i) in shippingProfilesAll.find((p) => p.id === shipProfileId).notes" :key="i">• {{ n }}</p>
          </div>
          <input ref="fileInput" type="file" accept=".pdf,.png,application/pdf,image/png" class="hidden" @change="onUploadFile">
          <button type="button" class="btn-primary min-h-[44px] !py-2.5 w-full sm:w-auto" :disabled="uploading" @click="fileInput && fileInput.click()">
            <BrandIcon name="upload" :size="16" class="inline-block mr-1.5 -mt-0.5" />{{ uploading ? 'Загружаем…' : 'Загрузить PDF / PNG' }}
          </button>
          <p class="text-xs text-slate-500">До 20 МБ. Проверяются сигнатура PDF/PNG и размер; содержимое не изменяется.</p>
        </div>

        <div class="glass rounded-2xl p-5 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-display font-semibold">Загруженные этикетки · {{ marketTitle }}</h2>
            <button type="button" class="btn-ghost !py-2 text-xs min-h-[44px]" @click="openRuler">Тестовая линейка 100 мм</button>
          </div>
          <p v-if="!marketDocs.length" class="text-sm text-slate-500">Пока пусто. Загрузите оригинал этикетки из кабинета площадки.</p>
          <div v-for="d in marketDocs" :key="d.id" class="rounded-xl border border-slate-200 dark:border-white/10 p-3 flex flex-wrap items-center gap-2">
            <div class="flex-1 min-w-[180px]">
              <div class="text-sm font-medium truncate">{{ d.filename }}</div>
              <div class="text-xs text-slate-500">{{ d.mime === 'application/pdf' ? 'PDF' : 'PNG' }} · {{ fmtSize(d.size) }} · {{ String(d.createdAt || '').slice(0, 16).replace('T', ' ') }}</div>
            </div>
            <button type="button" class="btn-primary !py-2 !px-3 text-xs min-h-[44px]" @click="printDoc(d)">Печать</button>
            <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px]" @click="downloadDoc(d)">Скачать</button>
            <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px] text-red-500" @click="deleteDoc(d)" aria-label="Удалить документ"><BrandIcon name="trash" :size="14" /></button>
          </div>
          <p class="text-xs text-slate-500">Печать: масштаб 100%, поля драйвера отключены. PDF открывается в просмотрщике браузера — печатайте оттуда в фактическом размере.</p>
        </div>
      </div>

      <!-- Коробки (грузоместа) -->
      <div v-if="tab === 'boxes'" class="space-y-4">
        <div v-if="!activeBox" class="glass rounded-2xl p-5 space-y-4">
          <div>
            <h2 class="font-display font-semibold">Короба (грузоместа)</h2>
            <p class="text-sm text-slate-500 mt-1">Разносортная отгрузка: соберите состав короба, распечатайте этикетки всех товаров одним PDF, упаковочный лист для сверки и этикетку короба из кабинета площадки.</p>
          </div>
          <div class="grid sm:grid-cols-2 lg:grid-cols-[1fr_150px_1fr_auto] gap-2 items-end">
            <div>
              <label class="label" for="box-market">Площадка</label>
              <select id="box-market" v-model="boxForm.marketplace" class="input">
                <option v-for="m in markets" :key="m.id" :value="m.id">{{ m.title }}</option>
              </select>
            </div>
            <div>
              <label class="label" for="box-scheme">Схема</label>
              <select id="box-scheme" v-model="boxForm.scheme" class="input">
                <option value="fbs">FBS (с моего склада)</option>
                <option value="fbo">FBO (на склад площадки)</option>
              </select>
            </div>
            <div>
              <label class="label" for="box-name">Название (необязательно)</label>
              <input id="box-name" v-model="boxForm.name" class="input" placeholder="Короб 1 · поставка 25.11">
            </div>
            <button type="button" class="btn-primary min-h-[44px] !py-2.5" :disabled="boxBusy" @click="createBox">Создать короб</button>
          </div>
          <p v-if="!boxes.length" class="text-sm text-slate-500">Коробов пока нет. Создайте первый — подскажем шаги для вашей площадки.</p>
          <div v-for="b in boxes" :key="b.id" class="rounded-xl border border-slate-200 dark:border-white/10 p-3 flex flex-wrap items-center gap-2">
            <div class="flex-1 min-w-[180px]">
              <div class="text-sm font-medium truncate">{{ b.name }}</div>
              <div class="text-xs text-slate-500">{{ (markets.find((m) => m.id === b.marketplace) || {}).title }} · {{ b.scheme.toUpperCase() }} · {{ statusTitle(b.status) }} · {{ b.itemsCount }} поз. / {{ b.units }} ед.</div>
            </div>
            <button type="button" class="btn-primary !py-2 !px-3 text-xs min-h-[44px]" @click="openBox(b.id)">Открыть</button>
            <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px] text-red-500" @click="removeBox(b)" aria-label="Удалить короб"><BrandIcon name="trash" :size="14" /></button>
          </div>
        </div>

        <div v-else class="space-y-4">
          <button type="button" class="btn-ghost !py-2 text-sm min-h-[44px]" @click="closeBox">← К списку коробов</button>

          <div class="glass rounded-2xl p-5 space-y-3">
            <div class="grid sm:grid-cols-[1fr_170px_190px_auto] gap-2 items-end">
              <div>
                <label class="label" for="box-edit-name">Короб · {{ boxMarketTitle }}</label>
                <input id="box-edit-name" v-model="activeBox.box.name" class="input" maxlength="100">
              </div>
              <div>
                <label class="label" for="box-edit-scheme">Схема</label>
                <select id="box-edit-scheme" v-model="activeBox.box.scheme" class="input">
                  <option value="fbs">FBS</option>
                  <option value="fbo">FBO</option>
                </select>
              </div>
              <div>
                <label class="label" for="box-edit-status">Статус</label>
                <select id="box-edit-status" v-model="activeBox.box.status" class="input">
                  <option value="packing">Собирается</option>
                  <option value="ready">Готов к отгрузке</option>
                  <option value="shipped">Отгружен</option>
                </select>
              </div>
              <button type="button" class="btn-ghost min-h-[44px] !py-2.5" @click="saveBox">Сохранить</button>
            </div>
          </div>

          <div v-if="activeBox.guide" class="glass rounded-2xl p-5 border-l-4 border-brand-500 space-y-3">
            <h2 class="font-display font-semibold text-sm">{{ activeBox.guide.title }}</h2>
            <ol class="list-decimal list-inside space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
              <li v-for="(s, i) in activeBox.guide.steps" :key="i">{{ s }}</li>
            </ol>
            <ul class="space-y-1 text-sm text-amber-600 dark:text-amber-400">
              <li v-for="(w, i) in activeBox.guide.warnings" :key="'w' + i">⚠ {{ w }}</li>
            </ul>
            <p class="text-xs text-slate-500">Источник: <a :href="activeBox.guide.sourceUrl" target="_blank" rel="noopener" class="text-brand-400 underline">официальная страница площадки</a></p>
          </div>

          <div class="glass rounded-2xl p-5 space-y-3">
            <h2 class="font-display font-semibold">Состав короба · {{ boxUnits }} ед.</h2>
            <div class="grid sm:grid-cols-[1fr_110px_auto] gap-2 items-end">
              <div>
                <label class="label" for="box-item-product">Товар из сохранённых</label>
                <select id="box-item-product" v-model="itemForm.productId" class="input">
                  <option value="">Вручную (название + штрихкод)</option>
                  <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}{{ p.sku ? ' · ' + p.sku : '' }}</option>
                </select>
              </div>
              <div>
                <label class="label" for="box-item-qty">Кол-во</label>
                <input id="box-item-qty" v-model.number="itemForm.quantity" type="number" min="1" max="1000" class="input">
              </div>
              <button type="button" class="btn-primary min-h-[44px] !py-2.5" @click="addItem">Добавить</button>
            </div>
            <div v-if="!itemForm.productId" class="grid sm:grid-cols-2 gap-2">
              <input v-model="itemForm.name" class="input" placeholder="Наименование товара" aria-label="Наименование товара">
              <input v-model="itemForm.barcode" class="input font-mono" placeholder="Штрихкод (EAN-13 / Code-128)" aria-label="Штрихкод товара">
            </div>
            <p v-if="!activeBox.items.length" class="text-sm text-slate-500">Добавьте товары, которые лежат в этом коробе.</p>
            <div v-for="it in activeBox.items" :key="it.id" class="rounded-xl border border-slate-200 dark:border-white/10 p-3 space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <div class="flex-1 min-w-[160px]">
                  <div class="text-sm font-medium truncate">{{ it.name }}</div>
                  <div class="text-xs text-slate-500 font-mono truncate">{{ it.barcode || 'без штрихкода' }}{{ it.sku ? ' · ' + it.sku : '' }}</div>
                </div>
                <input type="number" min="1" max="1000" :value="it.quantity" class="input w-24" aria-label="Количество" @change="setItemQty(it, $event.target.value)">
                <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px] text-red-500" @click="removeItem(it)" aria-label="Убрать позицию"><BrandIcon name="trash" :size="14" /></button>
              </div>
              <select class="input text-xs" :value="it.profileId" aria-label="Профиль этикетки" @change="setItemProfile(it, $event.target.value)">
                <option v-for="p in boxProductProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>
          </div>

          <div class="glass rounded-2xl p-5 space-y-3">
            <h2 class="font-display font-semibold">Печать вложений</h2>
            <div class="flex flex-col sm:flex-row gap-2">
              <button type="button" class="btn-primary min-h-[44px] !py-2.5" :disabled="boxBusy || !boxUnits" @click="boxLabelsPdf">PDF этикеток товаров · {{ boxUnits }} шт</button>
              <button type="button" class="btn-ghost min-h-[44px] !py-2.5" :disabled="boxBusy || !boxUnits" @click="packingList">Упаковочный лист А4</button>
            </div>
            <p class="text-xs text-slate-500">Каждая этикетка — страница точного размера своего профиля. Упаковочный лист — внутренний документ для сверки, не этикетка площадки.</p>
          </div>

          <div class="glass rounded-2xl p-5 space-y-3">
            <h2 class="font-display font-semibold">Этикетка короба (грузоместа)</h2>
            <p v-if="activeBox.guide" class="text-sm text-slate-500">{{ activeBox.guide.boxLabel }}</p>
            <div v-if="activeBox.document" class="rounded-xl border border-slate-200 dark:border-white/10 p-3 flex flex-wrap items-center gap-2">
              <div class="flex-1 min-w-[160px]">
                <div class="text-sm font-medium truncate">{{ activeBox.document.filename }}</div>
                <div class="text-xs text-slate-500">{{ activeBox.document.mime === 'application/pdf' ? 'PDF' : 'PNG' }} · привязан к коробу</div>
              </div>
              <button type="button" class="btn-primary !py-2 !px-3 text-xs min-h-[44px]" @click="printBoxDoc">Печать</button>
              <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px]" @click="downloadBoxDoc">Скачать</button>
              <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px]" @click="unlinkDoc">Отвязать</button>
            </div>
            <div v-else class="space-y-2">
              <input ref="boxFileInput" type="file" accept=".pdf,.png,application/pdf,image/png" class="hidden" @change="onBoxFile">
              <button type="button" class="btn-primary min-h-[44px] !py-2.5" :disabled="boxBusy" @click="boxFileInput && boxFileInput.click()">
                <BrandIcon name="upload" :size="16" class="inline-block mr-1.5 -mt-0.5" />{{ boxBusy ? 'Загружаем…' : 'Загрузить оригинал PDF / PNG' }}
              </button>
              <div v-if="documents.filter((d) => d.marketplace === activeBox.box.marketplace).length" class="flex flex-col sm:flex-row gap-2 items-end">
                <div class="flex-1">
                  <label class="label" for="box-link-doc">Или привяжите уже загруженный документ</label>
                  <select id="box-link-doc" class="input" @change="linkDoc(Number($event.target.value))">
                    <option value="">Выберите документ…</option>
                    <option v-for="d in documents.filter((x) => x.marketplace === activeBox.box.marketplace)" :key="d.id" :value="d.id">{{ d.filename }}</option>
                  </select>
                </div>
              </div>
            </div>
            <p class="text-xs text-slate-500">Печать оригинала — масштаб 100%, без полей. Содержимое не перерисовывается.</p>
          </div>
        </div>
      </div>

      <!-- Мои товары -->
      <div v-if="tab === 'products'" class="glass rounded-2xl p-5 space-y-3">
        <div class="flex flex-col sm:flex-row gap-2">
          <input v-model="productQuery" class="input flex-1" placeholder="Поиск по названию, артикулу, GTIN, штрихкоду" @keyup.enter="loadProducts">
          <button type="button" class="btn-ghost min-h-[44px] !py-2.5" @click="loadProducts">Найти</button>
        </div>
        <p v-if="!products.length" class="text-sm text-slate-500">Товаров пока нет. Создайте товар на вкладке «Товарная этикетка».</p>
        <div v-for="p in products" :key="p.id" class="rounded-xl border border-slate-200 dark:border-white/10 p-3 flex flex-wrap items-center gap-2">
          <div class="flex-1 min-w-[180px]">
            <div class="text-sm font-medium truncate">{{ p.name }}</div>
            <div class="text-xs text-slate-500 truncate">{{ [p.sku, p.barcode, p.gtin, p.marketplace].filter(Boolean).join(' · ') }}</div>
          </div>
          <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px]" @click="editProduct(p)">Изменить</button>
          <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px]" @click="archiveProduct(p)">В архив</button>
          <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px] text-red-500" @click="deleteProduct(p)" aria-label="Удалить товар"><BrandIcon name="trash" :size="14" /></button>
        </div>
      </div>

      <!-- Документы -->
      <div v-if="tab === 'documents'" class="glass rounded-2xl p-5 space-y-3">
        <h2 class="font-display font-semibold">Все загруженные документы</h2>
        <p v-if="!documents.length" class="text-sm text-slate-500">Пока пусто. Загрузите оригиналы на вкладке «Этикетка отправки».</p>
        <div v-for="d in documents" :key="d.id" class="rounded-xl border border-slate-200 dark:border-white/10 p-3 flex flex-wrap items-center gap-2">
          <div class="flex-1 min-w-[180px]">
            <div class="text-sm font-medium truncate">{{ d.filename }}</div>
            <div class="text-xs text-slate-500">{{ d.marketplace }} · {{ d.mime === 'application/pdf' ? 'PDF' : 'PNG' }} · {{ fmtSize(d.size) }} · {{ String(d.createdAt || '').slice(0, 16).replace('T', ' ') }}</div>
          </div>
          <button type="button" class="btn-primary !py-2 !px-3 text-xs min-h-[44px]" @click="printDoc(d)">Печать</button>
          <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px]" @click="downloadDoc(d)">Скачать</button>
          <button type="button" class="btn-ghost !py-2 !px-3 text-xs min-h-[44px] text-red-500" @click="deleteDoc(d)" aria-label="Удалить документ"><BrandIcon name="trash" :size="14" /></button>
        </div>
      </div>
    </section>
  </div>
</template>
