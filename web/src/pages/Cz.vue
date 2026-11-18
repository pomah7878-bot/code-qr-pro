<script setup>
import { ref } from 'vue';
import { api } from '../api.js';
import SideNav from '../components/SideNav.vue';

const text = ref('');
const result = ref(null);
const error = ref('');
const busy = ref(false);

async function verify() {
  error.value = ''; busy.value = true; result.value = null;
  try {
    const codes = text.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!codes.length) throw new Error('Вставьте хотя бы один код');
    result.value = await api.czVerify({ codes });
  } catch (e) { error.value = e.message; }
  busy.value = false;
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/cz" />
    <section class="space-y-6 min-w-0">
      <h1 class="font-display font-bold text-3xl">Проверка кодов «Честный ЗНАК»</h1>
      <div class="glass rounded-2xl p-6">
        <label class="label">Коды маркировки (по одному на строку)</label>
        <textarea v-model="text" rows="6" class="input font-mono text-sm" placeholder="(01)04600000000015(21)5PojkV(91)EE10(92)dGVzdA=="></textarea>
        <button class="btn-primary mt-4" :disabled="busy" @click="verify">{{ busy ? 'Проверяем…' : 'Проверить' }}</button>
      </div>
      <div v-if="result" class="space-y-4">
        <div class="glass rounded-2xl p-4 text-sm" :class="result.configured ? 'border-emerald-500/40' : 'border-amber-500/40'">
          {{ result.message }}
        </div>
        <div class="glass rounded-2xl p-6 overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-2 pr-3">Код</th><th class="py-2 pr-3">GTIN</th><th class="py-2 pr-3">Серийник</th><th class="py-2">Результат</th>
            </tr></thead>
            <tbody>
              <tr v-for="(r, i) in result.results" :key="i" class="border-b border-slate-100 dark:border-white/5">
                <td class="py-2 pr-3 font-mono text-xs max-w-[240px] truncate" :title="r.code">{{ r.code }}</td>
                <td class="py-2 pr-3 font-mono text-xs">{{ r.gtin || '—' }}</td>
                <td class="py-2 pr-3 font-mono text-xs">{{ r.serial || '—' }}</td>
                <td class="py-2"><span v-if="r.ok" class="text-emerald-500">✓ GS1 валиден</span><span v-else class="text-red-500">✗ {{ r.error }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    </section>
  </div>
</template>
