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

const statusClass = (status) => /В обороте/i.test(status) ? 'text-emerald-500' : /Не найден|Выбыл|Списан/i.test(status) ? 'text-red-500' : 'text-amber-500';
const cryptoClass = (crypto) => /^Проверено/i.test(crypto || '') ? 'text-emerald-500' : 'text-amber-500';

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
      <h1 class="font-display font-extrabold text-3xl sm:text-5xl leading-tight">Проверить код «Честного ЗНАКа»</h1>
      <p class="text-slate-500 mt-3 text-sm sm:text-base">Вставьте код маркировки из DataMatrix — покажем структуру GS1, статус кода и криптоподпись. Без регистрации, до 3 кодов за раз.</p>
    </div>

    <div class="glass rounded-3xl p-5 sm:p-7 max-w-3xl mx-auto">
      <label for="public-check-codes" class="label !text-xs">Коды маркировки — по одному на строку</label>
      <textarea id="public-check-codes" v-model="codesText" rows="6" class="input font-mono text-sm mt-1" placeholder="0104638230913287215ZsWrd..."></textarea>
      <div class="flex flex-wrap items-center gap-3 mt-3">
        <button class="btn-primary" :disabled="busy" @click="check">{{ busy ? 'Проверяем…' : 'Проверить' }}</button>
        <router-link to="/register" class="btn-ghost">Зарегистрироваться бесплатно →</router-link>
      </div>
      <p v-if="error" class="text-sm text-red-500 mt-3">{{ error }}</p>
      <p class="text-[11px] text-slate-500 mt-3">Сервис не является официальным сервисом «Честного ЗНАКа» и не заменяет проверку в ГИС МТ. Статус и карточка запрашиваются у открытых источников.</p>
    </div>

    <div v-if="result" class="max-w-3xl mx-auto mt-6 space-y-3" aria-live="polite">
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
