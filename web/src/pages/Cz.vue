<script setup>
import { computed, ref } from 'vue';
import { api } from '../api.js';
import SideNav from '../components/SideNav.vue';
import ValidHint from '../components/ValidHint.vue';
import PageGuide from '../components/PageGuide.vue';
import BrandIcon from '../components/BrandIcon.vue';

const CHUNK = 1000;
const MAX = 30000;
const text = ref('');
const result = ref(null);
const error = ref('');
const busy = ref(false);
const progress = ref({ done: 0, total: 0 });
const cards = ref([]);
const cardsMessage = ref('');
const cardsLoading = ref(false);

const stats = computed(() => {
  const list = result.value?.results || [];
  const valid = list.filter((r) => r.ok).length;
  return { total: list.length, valid, invalid: list.length - valid };
});

const cardFor = (row) => {
  const item = cards.value.find((x) => (x.gtin && row.gtin && x.gtin === row.gtin) || (x.code?.input && x.code.input === row.code));
  return item?.card || null;
};
const cryptoClass = (v) => (/^проверено/i.test(String(v || '')) ? 'text-emerald-500' : 'text-amber-500');

async function loadCards() {
  cards.value = [];
  cardsMessage.value = '';
  const valid = (result.value?.results || []).filter((r) => r.ok);
  if (!valid.length) return;
  cardsLoading.value = true;
  try {
    const idemKey = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    const data = await api.productCards(valid.slice(0, 50).map((r) => ({ code: r.code, gtin: r.gtin })), idemKey);
    cards.value = Array.isArray(data.cards) ? data.cards.filter((x) => x.card) : [];
    const errors = cards.value.flatMap((x) => x.card?.errors || []);
    const warnings = cards.value.flatMap((x) => x.card?.warnings || []);
    if (!cards.value.length) cardsMessage.value = errors[0] || warnings[0] || 'Карточки товара не найдены: проверьте полный код и лимит расширенных проверок.';
    else if (errors.length) cardsMessage.value = 'Часть данных не получена: ' + errors[0];
  } catch (e) {
    cardsMessage.value = e.message || 'Не удалось получить карточки товара';
  } finally {
    cardsLoading.value = false;
  }
}

async function verify() {
  error.value = '';
  result.value = null;
  cards.value = [];
  cardsMessage.value = '';
  progress.value = { done: 0, total: 0 };
  const codes = text.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!codes.length) { error.value = 'Вставьте хотя бы один код'; return; }
  if (codes.length > MAX) { error.value = `За один раз можно проверить до ${MAX} кодов, у вас ${codes.length}.`; return; }

  busy.value = true;
  progress.value = { done: 0, total: codes.length };
  try {
    const results = [];
    let message = '';
    let configured = false;
    for (let i = 0; i < codes.length; i += CHUNK) {
      const part = await api.czVerify({ codes: codes.slice(i, i + CHUNK) });
      if (!results.length) {
        message = part.message || '';
        configured = Boolean(part.configured);
      }
      results.push(...(part.results || []));
      progress.value = { done: Math.min(i + CHUNK, codes.length), total: codes.length };
    }
    const valid = results.filter((r) => r.ok).length;
    result.value = {
      configured,
      online: false,
      message: `Проверено ${results.length} кодов: ${valid} валидных, ${results.length - valid} с ошибками. Структура GS1 проверена локально; статус и карточка товара ниже — из «Честного ЗНАКа» и открытых источников.`,
      results
    };
    loadCards();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="max-w-[1680px] mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/cz" />
    <section class="space-y-6 min-w-0">
      <h1 class="font-display font-bold text-3xl">Проверка кодов «Честный ЗНАК»</h1>

      <PageGuide
        id="cz"
        title="Проверка кодов за 2 шага"
        :steps="[
          'Вставьте коды в поле ниже — по одному на строку. Можно вставить весь список из отчёта.',
          'Нажмите «Проверить». Сервис покажет структуру GS1, статус кода, криптоподпись и карточку товара из «Честного ЗНАКа» и открытых источников.'
        ]"
        note="«Валидный» означает правильный формат, но не подтверждает подлинность кода в ГИС МТ. Статус и карточка запрашиваются отдельно у внешних источников."
      />
      <div class="glass rounded-2xl p-6">
        <label class="label" for="cz-codes">Коды маркировки (по одному на строку, до 30 000 — как в отчёте о нанесении)</label>
        <textarea id="cz-codes" v-model="text" rows="8" class="input font-mono text-sm" placeholder="(01)04600000000015(21)5PojkV(91)EE10(92)dGVzdA=="></textarea>
        <button class="btn-primary mt-4" :disabled="busy" @click="verify">{{ busy ? 'Проверяем…' : 'Проверить' }}</button>
        <p v-if="busy && progress.total" class="text-sm text-slate-500 mt-3">Проверено {{ progress.done }} из {{ progress.total }}…</p>
      </div>

      <div v-if="result" class="space-y-4">
        <div class="grid grid-cols-3 gap-3">
          <div class="glass rounded-2xl p-4">
            <div class="text-2xl font-extrabold">{{ stats.total }}</div>
            <div class="text-xs text-slate-500">всего кодов</div>
          </div>
          <div class="glass rounded-2xl p-4">
            <div class="text-2xl font-extrabold text-emerald-500">{{ stats.valid }}</div>
            <div class="text-xs text-slate-500">валидных</div>
          </div>
          <div class="glass rounded-2xl p-4">
            <div class="text-2xl font-extrabold" :class="stats.invalid ? 'text-red-500' : 'text-slate-400'">{{ stats.invalid }}</div>
            <div class="text-xs text-slate-500">с ошибками</div>
          </div>
        </div>

        <div class="glass rounded-2xl p-4 text-sm" :class="result.configured ? 'border-emerald-500/40' : 'border-amber-500/40'">
          {{ result.message }}
          <ValidHint class="mt-2" />
        </div>

        <!-- Карточки товара: те же данные, что в «Повторной печати» -->
        <div v-if="cardsLoading" class="glass rounded-2xl p-4 text-sm text-slate-500">Запрашиваем карточки товара из «Честного ЗНАКа» и открытых источников…</div>
        <div v-else-if="cards.length" class="glass rounded-2xl p-4 sm:p-5">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 class="font-display font-semibold">Карточка товара по коду</h2>
            <span class="text-xs text-slate-500">Показаны первые {{ cards.length }} карточек</span>
          </div>
          <div class="space-y-4">
            <div v-for="(item, i) in cards" :key="i" class="rounded-xl border border-slate-200/80 dark:border-white/10 p-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div class="font-semibold">{{ item.card?.name || 'Товар' }}<span v-if="item.card?.brand" class="text-slate-500"> · {{ item.card.brand }}</span></div>
                  <div class="text-xs text-slate-500 mt-0.5">GTIN {{ item.card?.gtin || item.gtin || '—' }}<span v-if="item.card?.producer"> · {{ item.card.producer }}</span></div>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <span v-if="item.card?.status" class="chip-soon !text-[10px]">{{ item.card.status }}</span>
                  <span v-if="item.card?.crypto" class="chip-soon !text-[10px]" :class="cryptoClass(item.card.crypto)">криптоподпись: {{ String(item.card.crypto).toLowerCase() }}</span>
                  <span v-if="item.card?.sourceLabel" class="chip-soon !text-[10px]">{{ item.card.sourceLabel }}</span>
                </div>
              </div>
              <div class="grid sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs mt-3">
                <div v-if="item.card?.category"><span class="text-slate-500">Категория:</span> {{ item.card.category }}</div>
                <div v-if="item.card?.productKind"><span class="text-slate-500">Вид:</span> {{ item.card.productKind }}</div>
                <div v-if="item.card?.volume"><span class="text-slate-500">Объём:</span> {{ item.card.volume }}</div>
                <div v-if="item.card?.productionDate"><span class="text-slate-500">Изготовлен:</span> {{ item.card.productionDate }}</div>
                <div v-if="item.card?.expirationDate"><span class="text-slate-500">Годен до:</span> {{ item.card.expirationDate }}</div>
                <div v-if="item.card?.serviceLife"><span class="text-slate-500">Срок службы:</span> {{ item.card.serviceLife }}</div>
                <div v-if="item.card?.country"><span class="text-slate-500">Страна:</span> {{ item.card.country }}</div>
              </div>
              <p v-if="item.card?.composition" class="text-xs text-slate-500 mt-2 line-clamp-3" :title="item.card.composition"><b>Состав:</b> {{ item.card.composition }}</p>
              <div v-if="item.card?.warnings?.length" class="mt-2 space-y-1">
                <p v-for="(w, wi) in item.card.warnings" :key="wi" class="text-[11px] text-amber-500">{{ w }}</p>
              </div>
            </div>
          </div>
          <p v-if="result.results.filter((r) => r.ok).length > 50" class="text-xs text-slate-500 mt-3">Карточки запрошены для первых 50 валидных кодов.</p>
          <p v-if="cardsMessage" class="text-xs text-slate-500 mt-2">{{ cardsMessage }}</p>
        </div>
        <div v-else-if="cardsMessage" class="glass rounded-2xl p-4 text-sm text-slate-500">{{ cardsMessage }}</div>

        <div class="glass rounded-2xl p-6 overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-2 pr-3">Код</th><th class="py-2 pr-3">GTIN</th><th class="py-2 pr-3">Серийник</th><th class="py-2 pr-3">Статус</th><th class="py-2 pr-3">Криптозащита</th><th class="py-2">Структура GS1</th>
            </tr></thead>
            <tbody>
              <tr v-for="(r, i) in result.results.slice(0, 200)" :key="i" class="border-b border-slate-100 dark:border-white/5">
                <td class="py-2 pr-3 font-mono text-xs max-w-[240px] truncate" :title="r.code">{{ r.code }}</td>
                <td class="py-2 pr-3 font-mono text-xs">{{ r.gtin || '—' }}</td>
                <td class="py-2 pr-3 font-mono text-xs">{{ r.serial || '—' }}</td>
                <td class="py-2 pr-3 text-xs">{{ cardFor(r)?.status || '—' }}</td>
                <td class="py-2 pr-3 text-xs" :class="cryptoClass(cardFor(r)?.crypto)">{{ cardFor(r)?.crypto || '—' }}</td>
                <td class="py-2"><span v-if="r.ok" class="inline-flex items-center gap-1 text-emerald-500"><BrandIcon name="check" :size="14" />GS1 валиден</span><span v-else class="inline-flex items-center gap-1 text-red-500"><BrandIcon name="close" :size="14" />{{ r.error }}</span></td>
              </tr>
            </tbody>
          </table>
          <p v-if="result.results.length > 200" class="text-xs text-slate-500 mt-2">Показаны первые 200 из {{ result.results.length }}. Итог по всем — в сводке выше.</p>
        </div>
      </div>

      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    </section>
  </div>
</template>
