<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { normalizeScanInput } from '../lib/labelData.js';
import SideNav from '../components/SideNav.vue';
import PageGuide from '../components/PageGuide.vue';

const plan = computed(() => store.plan || {});
const premium = computed(() => Boolean(plan.value.labelEditor));
const templates = ref([]);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const pdfUrl = ref('');
const setCodesText = ref('');
const componentTexts = ref([{ codesText: '' }]);

const formats = [
  { id: '58x80', label: '58×80 мм — набор с составом' },
  { id: '58x40', label: '58×40 мм — обычная этикетка' },
  { id: '40x58', label: '40×58 мм — вертикальная' },
  { id: '43x25', label: '43×25 мм — маленькая' }
];

const form = reactive({
  id: null,
  name: 'Набор для волос',
  setGtin: '',
  format: '58x80',
  showComposition: true,
  onlySet: false,
  components: [{ gtin: '', name: '', qty: 1 }]
});

const lines = (text) => String(text || '').split(/\r?\n/).map((s) => normalizeScanInput(s)).filter(Boolean);
const setCount = computed(() => lines(setCodesText.value).length);
const requiredFor = (c) => setCount.value * Math.max(1, Number(c.qty) || 1);
const codeCount = (i) => lines(componentTexts.value[i]?.codesText || '').length;
function gtinOk(v) {
  const s = String(v || '').replace(/\D/g, '');
  if (!/^\d{14}$/.test(s)) return false;
  let sum = 0, weight = 3;
  for (let i = 12; i >= 0; i--) { sum += Number(s[i]) * weight; weight = weight === 3 ? 1 : 3; }
  return String((10 - (sum % 10)) % 10) === s[13];
}
const validComponents = computed(() => form.components.length > 0 && form.components.every((c) => gtinOk(c.gtin) && String(c.name).trim()));
const validationMessage = computed(() => {
  if (!premium.value) return '';
  if (!form.name.trim()) return 'Укажите название набора';
  if (!gtinOk(form.setGtin)) return 'GTIN набора должен быть 14 цифр с правильной контрольной цифрой';
  if (!validComponents.value) return 'У каждого товара должны быть GTIN (14 цифр) и название';
  if (!setCount.value) return 'Вставьте КИН набора — по одному на строку';
  if (!form.onlySet) {
    for (const [i, c] of form.components.entries()) {
      if (codeCount(i) < requiredFor(c)) return `Для «${c.name}» нужно ${requiredFor(c)} кодов, вставлено ${codeCount(i)}`;
    }
  }
  return '';
});
const canPrint = computed(() => premium.value && !validationMessage.value);

function syncCodes(count) {
  while (componentTexts.value.length < count) componentTexts.value.push({ codesText: '' });
  if (componentTexts.value.length > count) componentTexts.value = componentTexts.value.slice(0, count);
}

function applyTemplate(t) {
  form.id = t.id;
  form.name = t.name || '';
  form.setGtin = t.setGtin || '';
  form.format = t.format || '58x80';
  form.showComposition = true;
  form.onlySet = false;
  form.components = (t.components || []).map((c) => ({ gtin: c.gtin || '', name: c.name || '', qty: Number(c.qty) || 1 }));
  if (!form.components.length) form.components = [{ gtin: '', name: '', qty: 1 }];
  componentTexts.value = form.components.map(() => ({ codesText: '' }));
  setCodesText.value = '';
  error.value = '';
  notice.value = '';
  pdfUrl.value = '';
}

function newTemplate() {
  form.id = null;
  form.name = 'Новый набор';
  form.setGtin = '';
  form.format = '58x80';
  form.showComposition = true;
  form.onlySet = false;
  form.components = [{ gtin: '', name: '', qty: 1 }];
  componentTexts.value = [{ codesText: '' }];
  setCodesText.value = '';
  error.value = '';
  notice.value = '';
  pdfUrl.value = '';
}

function selectTemplate(id) {
  if (!id) return newTemplate();
  const t = templates.value.find((x) => String(x.id) === String(id));
  if (t) applyTemplate(t);
}

function addComponent() {
  form.components.push({ gtin: '', name: '', qty: 1 });
  componentTexts.value.push({ codesText: '' });
}

function removeComponent(i) {
  if (form.components.length <= 1) return;
  form.components.splice(i, 1);
  componentTexts.value.splice(i, 1);
}

async function loadTemplates(selectId = null) {
  try {
    templates.value = (await api.setTemplates()).templates || [];
    const chosen = selectId ? templates.value.find((t) => t.id === selectId) : templates.value[0];
    if (chosen) applyTemplate(chosen);
  } catch (e) { error.value = e.message; }
}

function templateBody() {
  return {
    name: form.name.trim(),
    setGtin: String(form.setGtin).replace(/\D/g, ''),
    format: form.format,
    components: form.components.map((c) => ({ gtin: String(c.gtin).replace(/\D/g, ''), name: String(c.name).trim(), qty: Math.max(1, Number(c.qty) || 1) }))
  };
}

async function saveTemplate() {
  error.value = ''; notice.value = '';
  if (!form.name.trim()) { error.value = 'Укажите название набора'; return; }
  if (!gtinOk(form.setGtin)) { error.value = 'GTIN набора должен содержать 14 цифр'; return; }
  if (!validComponents.value) { error.value = 'У каждого товара должны быть GTIN (14 цифр) и название'; return; }
  busy.value = true;
  try {
    const body = templateBody();
    const d = form.id
      ? await api.updateSetTemplate(form.id, body)
      : await api.createSetTemplate(body);
    templates.value = (await api.setTemplates()).templates || [];
    form.id = d.template.id;
    notice.value = 'Шаблон набора сохранён';
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function downloadPdf() {
  error.value = ''; notice.value = '';
  if (!premium.value) { error.value = 'Печать наборов доступна на тарифе PREMIUM'; return; }
  if (!canPrint.value) { error.value = 'Заполните карточку набора и вставьте нужное количество кодов'; return; }
  busy.value = true;
  let timer = null;
  try {
    const payload = {
      template: { ...templateBody(), showComposition: form.showComposition, onlySet: form.onlySet },
      setCodes: lines(setCodesText.value),
      componentCodes: form.onlySet ? [] : form.components.map((c, i) => ({
        gtin: c.gtin, name: c.name, qty: c.qty, codes: lines(componentTexts.value[i]?.codesText || '')
      }))
    };
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 120000);
    const res = await fetch('/api/sets/pdf', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Не удалось сформировать PDF');
    }
    const blob = await res.blob();
    const head = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
    if (head !== '%PDF-') throw new Error('Сервер вернул не PDF');
    if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value);
    pdfUrl.value = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = pdfUrl.value;
    a.download = `nabor-${setCount.value}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    notice.value = 'PDF готов. Если файл не скачался — открой его по ссылке ниже.';
  } catch (e) {
    error.value = e.name === 'AbortError' ? 'PDF формируется слишком долго — уменьшите количество наборов' : e.message;
  } finally {
    if (timer) clearTimeout(timer);
    busy.value = false;
  }
}

onMounted(() => loadTemplates());
onUnmounted(() => { if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value); });
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/sets" />
    <section class="space-y-6 min-w-0">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="font-display font-bold text-3xl">Наборы</h1>
          <p class="text-sm text-slate-500 mt-1">КИН набора и этикетки для всего состава.</p>
        </div>
        <button class="btn-ghost !py-2 !px-3 text-sm" @click="newTemplate">+ Новый набор</button>
      </div>

      <PageGuide
        id="sets"
        title="Наборы за 3 шага"
        :steps="[
          'Заполните карточку набора: название, GTIN набора из Национального каталога и состав — GTIN и количество каждого товара.',
          'Получите в СУЗ коды: один КИН набора и отдельные КИЗ на каждое вложение (если упаковка разборная).',
          'Вставьте КИН набора и КИЗ вложений, затем скачайте PDF: этикетка набора + этикетки всех вложений.'
        ]"
        note="Сервис печатает этикетки, но не заказывает коды в Честном ЗНАКе. Заказ КМ и формирование упаковки — в СУЗ или 1С."
      />

      <div v-if="!premium" class="glass rounded-2xl p-4 text-sm border-brand-500/40">
        Печать наборов доступна на тарифе <b class="grad-text">PREMIUM</b>.
        <router-link to="/app/billing" class="text-brand-400 font-medium">Оформить →</router-link>
      </div>

      <details class="glass rounded-2xl p-4 text-sm">
        <summary class="cursor-pointer font-semibold">Правила «Честного ЗНАКа» для наборов</summary>
        <ul class="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc list-inside">
          <li>В Национальном каталоге создаётся карточка типа <b>«Набор»</b>: GTIN набора, GTIN вложений и количество. Состав в ЧЗ должен совпадать с составом в этом шаблоне.</li>
          <li>В СУЗ заказываются коды: на набор — с типом <b>«Набор»</b> (КИН), на каждое вложение — обычные КИЗ.</li>
          <li>Если вложения в статусе <b>«Нанесён»</b>, у всех должен быть одинаковый тип эмиссии, а у набора — статус «Нанесён» и тот же тип эмиссии.</li>
          <li>Если вложения в статусе <b>«В обороте»</b>, набор должен быть «Нанесён» с типом эмиссии <b>«Произведён в РФ»</b>. После формирования он автоматически станет «В обороте».</li>
          <li>Коды наносятся на набор и на вложения. Исключение — упаковка набора не вскрывается без повреждения: тогда допускается только код набора (режим «Только код набора»).</li>
          <li>После нанесения подаётся отчёт, затем в ЧЗ создаётся документ <b>«Формирование упаковки» → «Набор»</b>.</li>
        </ul>
        <p class="text-xs text-amber-500 mt-3">Сервис не заказывает коды в СУЗ и не подаёт документы в ГИС МТ — только готовит этикетки. Заказ и отчёты делаются в СУЗ/1С или личном кабинете ЧЗ.</p>
      </details>

      <div class="grid md:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-5 space-y-3">
          <h2 class="font-display font-semibold">Карточка набора</h2>
          <div>
            <label class="label !text-xs" for="set-template">Сохранённый шаблон</label>
            <select id="set-template" class="input !py-2 text-sm" :value="form.id || ''" @change="selectTemplate($event.target.value)">
              <option value="">Новый набор</option>
              <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </div>
          <div><label class="label !text-xs" for="set-name">Название набора</label><input id="set-name" v-model="form.name" class="input !py-2 text-sm" placeholder="Набор для волос"></div>
          <div><label class="label !text-xs" for="set-gtin">GTIN набора (14 цифр)</label><input id="set-gtin" v-model="form.setGtin" class="input !py-2 text-sm font-mono" inputmode="numeric" maxlength="14" placeholder="046..."></div>
          <div>
            <label class="label !text-xs" for="set-format">Размер этикетки</label>
            <select id="set-format" v-model="form.format" class="input !py-2 text-sm">
              <option v-for="f in formats" :key="f.id" :value="f.id">{{ f.label }}</option>
            </select>
          </div>
          <label class="flex items-center gap-2 text-sm"><input v-model="form.showComposition" type="checkbox"> Печатать состав на этикетке набора</label>
          <label class="flex items-start gap-2 text-sm">
            <input v-model="form.onlySet" type="checkbox" class="mt-0.5">
            <span>Только код набора<br><span class="text-xs text-slate-500">Только если упаковка набора не вскрывается без повреждения — тогда коды вложений не печатаются.</span></span>
          </label>

          <div class="pt-3 border-t border-slate-200 dark:border-white/10">
            <div class="flex items-center justify-between gap-2 mb-2">
              <h3 class="font-semibold text-sm">Состав набора</h3>
              <button class="btn-ghost !py-1.5 !px-2.5 text-xs" @click="addComponent">+ товар</button>
            </div>
            <div class="space-y-2">
              <div v-for="(c, i) in form.components" :key="i" class="rounded-xl border border-slate-200 dark:border-white/10 p-2.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-semibold text-slate-500">Товар {{ i + 1 }}</span>
                  <button class="text-xs text-slate-400 hover:text-red-500" :disabled="form.components.length <= 1" @click="removeComponent(i)">удалить</button>
                </div>
                <div class="grid grid-cols-[1fr_64px] gap-2 mt-1">
                  <input v-model="c.gtin" class="input !py-1.5 text-xs font-mono" inputmode="numeric" maxlength="14" placeholder="GTIN 14 цифр">
                  <input v-model.number="c.qty" type="number" min="1" max="50" class="input !py-1.5 text-xs text-center" title="Количество в наборе">
                </div>
                <input v-model="c.name" class="input !py-1.5 text-xs mt-2" placeholder="Название товара">
              </div>
            </div>
          </div>

          <button class="btn-ghost w-full !py-2 text-sm" :disabled="busy" @click="saveTemplate">{{ busy ? 'Сохраняем…' : 'Сохранить шаблон' }}</button>
        </div>

        <div class="glass rounded-2xl p-5 space-y-3">
          <h2 class="font-display font-semibold">Коды набора</h2>
          <p class="text-xs text-slate-500">Вставьте КИН набора — один на строку. Если наборов несколько, коды вложений распределятся по порядку.</p>
          <textarea v-model="setCodesText" rows="4" class="input font-mono text-xs" placeholder="КИН набора, по одному на строку"></textarea>
          <p class="text-xs text-slate-500">Наборов: <b>{{ setCount }}</b></p>

          <template v-if="!form.onlySet">
            <div v-for="(c, i) in form.components" :key="'codes-' + i" class="rounded-xl border border-slate-200 dark:border-white/10 p-3">
              <div class="flex flex-wrap items-center justify-between gap-1">
                <div class="text-xs font-semibold">{{ c.name || 'Товар ' + (i + 1) }}</div>
                <div class="text-[11px]" :class="codeCount(i) >= requiredFor(c) ? 'text-emerald-500' : 'text-amber-500'">
                  {{ codeCount(i) }} / {{ requiredFor(c) }} кодов
                </div>
              </div>
              <p class="text-[11px] text-slate-500">GTIN {{ c.gtin || '—' }} · в наборе {{ c.qty }} шт.</p>
              <textarea v-model="componentTexts[i].codesText" rows="3" class="input font-mono text-xs mt-2" :placeholder="`КИЗ вложений: ${c.name || 'товар'}, по одному на строку`"></textarea>
            </div>
          </template>
          <p v-else class="text-xs text-amber-500">Включён режим «Только набор» — коды вложений не нужны.</p>

          <button class="btn-primary w-full !py-2.5 text-sm" :disabled="busy || !canPrint" @click="downloadPdf">{{ busy ? 'Готовим PDF…' : `⬇ Скачать PDF (${setCount || 0} наборов)` }}</button>
          <p v-if="validationMessage" class="text-xs text-amber-500">{{ validationMessage }}</p>
          <p class="text-xs text-slate-500">Набор + все вложения. Проверка заполнения выполняется до печати.</p>
          <a v-if="pdfUrl" :href="pdfUrl" target="_blank" rel="noopener" class="block text-center text-xs text-brand-400 font-medium">Если файл не скачался — открыть PDF в новой вкладке</a>
          <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
          <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
