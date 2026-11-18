<script setup>
import { computed, ref } from 'vue';
import { api } from '../api.js';
import SideNav from '../components/SideNav.vue';

const CHUNK = 1000;
const MAX = 30000;
const text = ref('');
const result = ref(null);
const error = ref('');
const busy = ref(false);
const progress = ref({ done: 0, total: 0 });

const stats = computed(() => {
  const list = result.value?.results || [];
  const valid = list.filter((r) => r.ok).length;
  return { total: list.length, valid, invalid: list.length - valid };
});

async function verify() {
  error.value = '';
  result.value = null;
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
      message: `Проверено ${results.length} кодов: ${valid} валидных, ${results.length - valid} с ошибками. ${message}`,
      results
    };
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/cz" />
    <section class="space-y-6 min-w-0">
      <h1 class="font-display font-bold text-3xl">Проверка кодов «Честный ЗНАК»</h1>
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
        </div>

        <div class="glass rounded-2xl p-6 overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-2 pr-3">Код</th><th class="py-2 pr-3">GTIN</th><th class="py-2 pr-3">Серийник</th><th class="py-2">Результат</th>
            </tr></thead>
            <tbody>
              <tr v-for="(r, i) in result.results.slice(0, 200)" :key="i" class="border-b border-slate-100 dark:border-white/5">
                <td class="py-2 pr-3 font-mono text-xs max-w-[240px] truncate" :title="r.code">{{ r.code }}</td>
                <td class="py-2 pr-3 font-mono text-xs">{{ r.gtin || '—' }}</td>
                <td class="py-2 pr-3 font-mono text-xs">{{ r.serial || '—' }}</td>
                <td class="py-2"><span v-if="r.ok" class="text-emerald-500">✓ GS1 валиден</span><span v-else class="text-red-500">✗ {{ r.error }}</span></td>
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
