<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { fmtDate, money } from '../../lib/format.js';

const data = ref({ pending: [], unmatched: [], matched: [], counts: { unmatched: 0, matched: 0 } });
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const filename = ref('');
const fileInput = ref(null);
const importResult = ref(null);
const choices = reactive({});

const hasPending = computed(() => (data.value.pending || []).length > 0);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.adminBankOverview();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function onFile(event) {
  const f = event.target.files?.[0];
  filename.value = f ? f.name : '';
  importResult.value = null;
  error.value = '';
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s);
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

async function importFile() {
  const file = fileInput.value?.files?.[0];
  if (!file) { error.value = 'Выберите файл выписки'; return; }
  error.value = ''; notice.value = ''; busy.value = true;
  try {
    const contentBase64 = await readBase64(file);
    const result = await api.adminBankImport({ filename: file.name, contentBase64 });
    importResult.value = result;
    notice.value = `Выписка обработана: найдено ${result.parsed}, загружено ${result.imported}, автоматически сопоставлено ${result.matched}.`;
    if (fileInput.value) fileInput.value.value = '';
    filename.value = '';
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function match(tx) {
  const orderId = Number(choices[tx.id] || 0);
  if (!orderId) { error.value = 'Выберите счёт для сопоставления'; return; }
  error.value = ''; notice.value = '';
  try {
    await api.adminBankMatch(tx.id, orderId);
    notice.value = `Платёж сопоставлен с заказом №${orderId}, доступ активирован.`;
    await load();
  } catch (e) { error.value = e.message; }
}

async function ignore(tx) {
  if (!window.confirm('Игнорировать эту строку выписки? Она останется в истории.')) return;
  error.value = ''; notice.value = '';
  try {
    await api.adminBankIgnore(tx.id);
    notice.value = 'Строка выписки помечена как проигнорированная.';
    await load();
  } catch (e) { error.value = e.message; }
}

onMounted(load);
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-bold text-xl sm:text-2xl">Сверка банковской выписки</h2>
        <p class="text-sm text-slate-500 mt-1">Загрузите выписку — сервер найдёт входящие платежи, сопоставит их с B2B-счетами и активирует доступ. Нужен только банковский перевод.</p>
      </div>
      <button class="btn-ghost !py-2 text-sm" :disabled="loading" @click="load">{{ loading ? 'Обновляем…' : 'Обновить' }}</button>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div class="glass rounded-2xl p-5">
      <div class="flex flex-wrap items-center gap-3">
        <input ref="fileInput" type="file" accept=".csv,.txt,.1c,text/csv,text/plain" class="input !py-2 text-sm max-w-full" @change="onFile">
        <button class="btn-primary" :disabled="busy || !filename" @click="importFile">{{ busy ? 'Обрабатываем…' : 'Загрузить выписку' }}</button>
        <span v-if="filename" class="text-xs text-slate-500">{{ filename }}</span>
      </div>
      <p class="text-[11px] text-slate-500 mt-2">
        Поддерживаются CSV с колонками «Дата», «Сумма», «Плательщик», «ИНН», «Назначение платежа» и файл 1С «1CClientBankExchange». Неоплаченные счета сопоставляются по номеру счёта в назначении, затем по сумме и ИНН плательщика.
      </p>
      <div v-if="importResult" class="mt-3 rounded-xl border border-slate-200 dark:border-white/10 p-3 text-sm">
        <div>Формат: <b>{{ importResult.format === '1c' ? '1С' : 'CSV' }}</b></div>
        <div class="text-slate-500">Строк: {{ importResult.parsed }} · новых: {{ importResult.imported }} · дублей: {{ importResult.duplicates }} · сопоставлено: <b>{{ importResult.matched }}</b></div>
      </div>
    </div>

    <div class="grid sm:grid-cols-2 gap-3">
      <div class="glass rounded-2xl p-4">
        <div class="text-xs text-slate-500">Неоплаченные счета</div>
        <div class="text-2xl font-extrabold mt-1">{{ data.pending?.length || 0 }}</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-xs text-slate-500">Несопоставленные поступления</div>
        <div class="text-2xl font-extrabold mt-1 text-amber-500">{{ data.counts?.unmatched || 0 }}</div>
      </div>
    </div>

    <div class="glass rounded-2xl p-5 overflow-x-auto">
      <div class="font-semibold mb-3">Несопоставленные поступления</div>
      <div v-if="!data.unmatched?.length" class="text-sm text-slate-500 py-4">Нет несопоставленных платежей.</div>
      <table v-else class="w-full text-sm min-w-[860px]">
        <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
          <th class="py-2 pr-3">Дата</th><th class="py-2 pr-3">Сумма</th><th class="py-2 pr-3">Плательщик</th><th class="py-2 pr-3">Назначение</th><th class="py-2">Счёт</th>
        </tr></thead>
        <tbody>
          <tr v-for="t in data.unmatched" :key="t.id" class="border-b border-slate-100 dark:border-white/5 align-top">
            <td class="py-2 pr-3 whitespace-nowrap">{{ fmtDate(t.tx_date) || '—' }}</td>
            <td class="py-2 pr-3 font-semibold whitespace-nowrap">{{ money(t.amount) }}</td>
            <td class="py-2 pr-3"><div>{{ t.payer || '—' }}</div><div class="text-[11px] text-slate-500">ИНН {{ t.payer_inn || '—' }}</div></td>
            <td class="py-2 pr-3 max-w-[320px]"><div class="truncate" :title="t.purpose">{{ t.purpose || '—' }}</div><div v-if="t.error" class="text-[11px] text-red-500">{{ t.error }}</div></td>
            <td class="py-2">
              <div class="flex flex-wrap items-center gap-2">
                <select v-if="hasPending" v-model="choices[t.id]" class="input !py-1.5 !px-2 text-xs max-w-[260px]">
                  <option :value="0">Выберите счёт</option>
                  <option v-for="o in data.pending" :key="o.id" :value="o.id">{{ o.invoice_number }} · {{ o.company_name }} · {{ money(o.amount) }}</option>
                </select>
                <button class="btn-primary !py-1.5 !px-3 text-xs" :disabled="!choices[t.id]" @click="match(t)">Сопоставить</button>
                <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="ignore(t)">Игнорировать</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="glass rounded-2xl p-5 overflow-x-auto">
      <div class="font-semibold mb-3">Последние сопоставления</div>
      <div v-if="!data.matched?.length" class="text-sm text-slate-500 py-4">Пока нет сопоставленных платежей.</div>
      <table v-else class="w-full text-sm min-w-[760px]">
        <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
          <th class="py-2 pr-3">Дата платежа</th><th class="py-2 pr-3">Сумма</th><th class="py-2 pr-3">Плательщик</th><th class="py-2 pr-3">Счёт</th><th class="py-2">Заказ</th>
        </tr></thead>
        <tbody>
          <tr v-for="t in data.matched" :key="t.id" class="border-b border-slate-100 dark:border-white/5">
            <td class="py-2 pr-3 whitespace-nowrap">{{ fmtDate(t.tx_date) || '—' }}</td>
            <td class="py-2 pr-3 font-semibold whitespace-nowrap">{{ money(t.amount) }}</td>
            <td class="py-2 pr-3">{{ t.payer || '—' }}</td>
            <td class="py-2 pr-3 font-mono text-xs">{{ t.invoice_number || '—' }}</td>
            <td class="py-2">№{{ t.order_id }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
