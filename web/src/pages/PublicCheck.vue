<script setup>
import { onMounted, ref } from 'vue';
import PublicShell from '../components/PublicShell.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { api } from '../api.js';
import { applySeo } from '../lib/seo.js';

const codesText = ref('');
const busy = ref(false);
const error = ref('');
const result = ref(null);
const mode = ref('code');
const gtin = ref('');
const gtinBusy = ref(false);
const gtinError = ref('');
const gtinResult = ref(null);
const gtinList = ref('');
const gtinListBusy = ref(false);
const gtinListError = ref('');
const gtinListResult = ref(null);

const statusClass = (status) => /В обороте/i.test(status) ? 'text-emerald-500' : /Не найден|Выбыл|Списан/i.test(status) ? 'text-red-500' : 'text-amber-500';
const cryptoClass = (crypto) => /^Проверено/i.test(crypto || '') ? 'text-emerald-500' : 'text-amber-500';

async function checkGtin() {
  gtinError.value = ''; gtinResult.value = null;
  const value = gtin.value.replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(value)) { gtinError.value = 'GTIN должен содержать 8–14 цифр'; return; }
  gtinBusy.value = true;
  try { gtinResult.value = await api.publicGtin(value); }
  catch (e) { gtinError.value = e.message; }
  finally { gtinBusy.value = false; }
}

async function checkGtinList() {
  gtinListError.value = ''; gtinListResult.value = null;
  const list = [...new Set(gtinList.value.split(/[\s,;]+/).map((v) => v.replace(/\D/g, '')).filter(Boolean))];
  if (!list.length) { gtinListError.value = 'Вставьте хотя бы один GTIN'; return; }
  if (list.length > 50) { gtinListError.value = 'За один раз можно проверить до 50 GTIN'; return; }
  gtinListBusy.value = true;
  try { gtinListResult.value = await api.publicGtinBatch(list); }
  catch (e) { gtinListError.value = e.message; }
  finally { gtinListBusy.value = false; }
}

function downloadGtinCsv() {
  const rows = gtinListResult.value?.results || [];
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = '\uFEFF' + ['GTIN;Статус;Название;Категория;Производитель;Ссылка', ...rows.map((r) => [r.gtin, r.found ? 'найдена' : 'не найдена', r.name || r.error || '', r.category || '', r.producer || '', r.goodUrl || ''].map(esc).join(';'))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gtin-check.csv'; a.click(); URL.revokeObjectURL(a.href);
}

async function check() {
  error.value = '';
  result.value = null;
  const codes = codesText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!codes.length) { error.value = 'Вставьте хотя бы один код'; return; }
  if (codes.length > 3) { error.value = 'Для бесплатной проверки — до 3 кодов за раз'; return; }
  busy.value = true;
  try { result.value = await api.publicCheck(codes); }
  catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

onMounted(() => applySeo('/check'));
</script>

<template>
  <PublicShell>
    <div class="max-w-3xl mx-auto text-center mb-8">
      <div class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand-400 border border-brand-500/30 bg-brand-500/10 rounded-full px-4 py-1.5 mb-5">
        <BrandIcon name="cz" :size="15" /> Онлайн-проверка ЧЗ
      </div>
      <h1 class="font-display font-extrabold text-3xl sm:text-5xl leading-tight">Проверить код или карточку товара</h1>
      <p class="text-slate-500 mt-3 text-sm sm:text-base">Проверьте код маркировки или GTIN в Национальном каталоге. Без регистрации.</p>
    </div>

    <div class="max-w-3xl mx-auto mb-4 grid grid-cols-2 gap-2 p-1 rounded-xl border border-slate-200 dark:border-white/10">
      <button class="py-2 rounded-lg text-sm font-semibold transition" :class="mode === 'code' ? 'bg-brand-500/15 text-brand-400' : 'text-slate-500'" @click="mode = 'code'">Код маркировки</button>
      <button class="py-2 rounded-lg text-sm font-semibold transition" :class="mode === 'gtin' ? 'bg-brand-500/15 text-brand-400' : 'text-slate-500'" @click="mode = 'gtin'">Карточка по GTIN</button>
    </div>

    <div v-if="mode === 'code'" class="glass rounded-3xl p-5 sm:p-7 max-w-3xl mx-auto">
      <label for="public-check-codes" class="label !text-xs">Коды маркировки — по одному на строку</label>
      <textarea id="public-check-codes" v-model="codesText" rows="6" class="input font-mono text-sm mt-1" placeholder="0104638230913287215ZsWrd..."></textarea>
      <div class="flex flex-wrap items-center gap-3 mt-3">
        <button class="btn-primary" :disabled="busy" @click="check">{{ busy ? 'Проверяем…' : 'Проверить' }}</button>
        <router-link to="/register" class="btn-ghost">Зарегистрироваться бесплатно →</router-link>
      </div>
      <p v-if="error" class="text-sm text-red-500 mt-3">{{ error }}</p>
      <p class="text-[11px] text-slate-500 mt-3">Сервис не является официальным сервисом «Честного ЗНАКа» и не заменяет проверку в ГИС МТ. Статус и карточка запрашиваются у открытых источников.</p>
    </div>

    <div v-else class="glass rounded-3xl p-5 sm:p-7 max-w-3xl mx-auto">
      <label for="public-check-gtin" class="label !text-xs">GTIN товара — 8–14 цифр</label>
      <input id="public-check-gtin" v-model="gtin" class="input font-mono text-sm mt-1" placeholder="04638230913287" inputmode="numeric" @keyup.enter="checkGtin">
      <div class="flex flex-wrap items-center gap-3 mt-3">
        <button class="btn-primary" :disabled="gtinBusy" @click="checkGtin">{{ gtinBusy ? 'Проверяем…' : 'Проверить карточку' }}</button>
        <router-link to="/register" class="btn-ghost">Зарегистрироваться бесплатно →</router-link>
      </div>
      <p v-if="gtinError" class="text-sm text-red-500 mt-3">{{ gtinError }}</p>
      <p class="text-[11px] text-slate-500 mt-3">Проверяется наличие карточки в Национальном каталоге маркированных товаров. Если карточка уже есть — новую создавать не нужно; если нет — оформляйте по официальной процедуре.</p>
      <div class="mt-5 pt-5 border-t border-slate-200 dark:border-white/10">
        <label for="public-check-gtin-list" class="label !text-xs">Список GTIN — по одному на строку, до 50</label>
        <textarea id="public-check-gtin-list" v-model="gtinList" rows="4" class="input font-mono text-sm mt-1" placeholder="04638230913287&#10;04638230913294"></textarea>
        <div class="flex flex-wrap items-center gap-3 mt-3">
          <button class="btn-primary" :disabled="gtinListBusy" @click="checkGtinList">{{ gtinListBusy ? 'Проверяем список…' : 'Проверить список' }}</button>
          <span class="text-[11px] text-slate-500">Для 700 моделей — партиями по 50, результат выгружается в CSV.</span>
        </div>
        <p v-if="gtinListError" class="text-sm text-red-500 mt-3">{{ gtinListError }}</p>
      </div>
    </div>

    <div v-if="mode === 'gtin' && gtinListResult" class="max-w-3xl mx-auto mt-6 space-y-3" aria-live="polite">
      <div class="glass rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div class="text-sm">Проверено: <b>{{ gtinListResult.total }}</b> · найдено: <b class="text-emerald-500">{{ gtinListResult.found }}</b> · не найдено: <b class="text-amber-500">{{ gtinListResult.notFound }}</b></div>
        <button class="btn-ghost !py-2 !px-3 text-sm" @click="downloadGtinCsv">Скачать CSV</button>
      </div>
      <div class="glass rounded-2xl overflow-hidden">
        <div class="overflow-x-auto max-h-[480px]">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-white/90 dark:bg-ink-900/90 backdrop-blur">
              <tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
                <th class="py-2 px-3 font-medium">GTIN</th><th class="py-2 px-3 font-medium">Карточка</th><th class="py-2 px-3 font-medium">Название</th><th class="py-2 px-3 font-medium hidden md:table-cell">Категория</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in gtinListResult.results" :key="r.gtin" class="border-b border-slate-100 dark:border-white/5 last:border-0">
                <td class="py-2 px-3 font-mono text-xs">{{ r.gtin }}</td>
                <td class="py-2 px-3"><span :class="r.found ? 'text-emerald-500' : 'text-amber-500'">{{ r.found ? 'найдена' : 'не найдена' }}</span></td>
                <td class="py-2 px-3 text-xs">{{ r.name || r.error || '—' }}</td>
                <td class="py-2 px-3 text-xs hidden md:table-cell">{{ r.category || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="mode === 'code' && result" class="max-w-3xl mx-auto mt-6 space-y-3" aria-live="polite">
      <div class="text-xs text-slate-500">Проверено кодов: {{ result.results.length }} · онлайн-статус получен: {{ result.onlineChecked }}</div>
      <div v-for="(r, i) in result.results" :key="i" class="glass rounded-2xl p-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-xs break-all">{{ r.code }}</span>
          <span class="rounded-full px-2 py-0.5 text-[11px] border border-slate-200 dark:border-white/10" :class="statusClass(r.status)">{{ r.status || 'Нет статуса' }}</span>
          <span class="rounded-full px-2 py-0.5 text-[11px] border border-slate-200 dark:border-white/10" :class="cryptoClass(r.crypto)">{{ r.crypto || 'Не проверено' }}</span>
        </div>
        <div class="text-xs text-slate-500 mt-2">
          <span v-if="r.gtin">GTIN <span class="font-mono">{{ r.gtin }}</span></span>
          <span v-if="r.serial"> · серийник <span class="font-mono">{{ r.serial }}</span></span>
          <span v-if="r.name"> · {{ r.name }}</span>
          <span v-if="r.producer"> · {{ r.producer }}</span>
        </div>
        <p v-if="r.error" class="text-xs text-red-500 mt-1">{{ r.error }}</p>
        <p v-if="r.warnings?.length" class="text-xs text-amber-500 mt-1">{{ r.warnings[0] }}</p>
      </div>
      <div class="glass rounded-2xl p-4 text-sm text-slate-500">
        Нужна печать этикеток, повторная печать партии или проверка до 5000 кодов? <router-link to="/pricing" class="text-brand-400 hover:underline">Посмотрите тарифы</router-link>.
      </div>
    </div>

    <div v-if="mode === 'gtin' && gtinResult" class="max-w-3xl mx-auto mt-6 space-y-3" aria-live="polite">
      <div class="glass rounded-2xl p-5" :class="gtinResult.found ? 'border-emerald-500/30' : 'border-amber-500/30'">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-display font-semibold text-lg">{{ gtinResult.found ? 'Карточка найдена' : 'Карточка не найдена' }}</span>
          <span class="font-mono text-xs text-slate-500">GTIN {{ gtinResult.gtin }}</span>
        </div>
        <p v-if="gtinResult.found" class="text-sm mt-2">{{ gtinResult.name || 'Название не указано' }}</p>
        <p v-if="gtinResult.found && gtinResult.producer" class="text-xs text-slate-500 mt-1">Производитель: {{ gtinResult.producer }}</p>
        <p v-if="gtinResult.found" class="text-xs text-slate-500 mt-1">Категория: {{ gtinResult.category || '—' }}<span v-if="gtinResult.productKind"> · {{ gtinResult.productKind }}</span><span v-if="gtinResult.volume"> · {{ gtinResult.volume }}</span><span v-if="gtinResult.country"> · {{ gtinResult.country }}</span></p>
        <p class="text-xs mt-3" :class="gtinResult.found ? 'text-slate-500' : 'text-amber-500'">{{ gtinResult.found ? 'Перед заказом кодов маркировки проверьте, что это нужная карточка и GTIN совпадает с упаковкой.' : 'В открытом каталоге карточка не найдена. Проверьте GTIN или создайте карточку по официальной процедуре в Национальном каталоге.' }}</p>
        <a v-if="gtinResult.goodUrl" :href="gtinResult.goodUrl" target="_blank" rel="noopener" class="inline-block text-xs text-brand-400 hover:underline mt-2">Открыть карточку в Национальном каталоге →</a>
      </div>
    </div>

    <div class="max-w-3xl mx-auto mt-10 grid sm:grid-cols-3 gap-3 text-sm">
      <div class="glass rounded-2xl p-4"><div class="font-semibold mb-1">Что проверяется</div><p class="text-xs text-slate-500">GS1-структура, GTIN и серийник, статус кода и криптоподпись по открытым источникам.</p></div>
      <div class="glass rounded-2xl p-4"><div class="font-semibold mb-1">Что дальше</div><p class="text-xs text-slate-500">В кабинете можно печатать DataMatrix, собирать наборы, повторно печатать КИЗ и работать через API.</p></div>
      <div class="glass rounded-2xl p-4"><div class="font-semibold mb-1">Ограничения</div><p class="text-xs text-slate-500">Это не официальная проверка ГИС МТ. Для юридически значимой проверки нужен доступ участника оборота.</p></div>
    </div>

    <p class="max-w-3xl mx-auto text-xs text-slate-500 mt-8 text-center">
      Подробнее — в статье <router-link to="/articles/chestny-znak-check" class="text-brand-400 hover:underline">как проверить код «Честного ЗНАКа»</router-link>.
    </p>
  </PublicShell>
</template>
