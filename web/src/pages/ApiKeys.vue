<script setup>
import BrandIcon from '../components/BrandIcon.vue';
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import SideNav from '../components/SideNav.vue';
import PageGuide from '../components/PageGuide.vue';

const keys = ref([]);
const name = ref('');
const newKey = ref('');
const error = ref('');
const premium = store.plan?.apiAccess;

async function load() { try { keys.value = (await api.keys()).keys; } catch (e) { error.value = e.message; } }
async function create() {
  error.value = '';
  try { const d = await api.createKey({ name: name.value || 'Ключ' }); newKey.value = d.key; name.value = ''; load(); }
  catch (e) { error.value = e.message; }
}
async function revoke(id) { try { await api.deleteKey(id); load(); } catch (e) { error.value = e.message; } }
function copy() { navigator.clipboard?.writeText(newKey.value); }
onMounted(load);
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/apikeys" />
    <section class="space-y-6 min-w-0">
      <h1 class="font-display font-bold text-3xl">API для 1С и складов</h1>

      <PageGuide
        id="api"
        title="Как подключить API"
        :steps="[
          'Создайте ключ ниже. Он показывается один раз — сразу скопируйте и сохраните его.',
          'В каждом запросе передавайте ключ в заголовке X-API-Key.',
          'Генерация: POST /api/v1/generate с массивом rows. Проверка статуса: GET /api/v1/jobs/{id}.'
        ]"
        note="API работает на PREMIUM. Ключ даёт доступ к вашему аккаунту — не публикуйте его."
      />
      <div v-if="!premium" class="glass rounded-2xl p-6 text-sm">API доступен на тарифе <b class="grad-text">PREMIUM</b>. <router-link to="/app/billing" class="text-brand-400 font-medium">Оформить →</router-link></div>
      <template v-else>
        <div class="glass rounded-2xl p-6">
          <h2 class="font-display font-semibold mb-3">Новый ключ</h2>
          <div class="flex gap-3">
            <input v-model="name" class="input flex-1" placeholder="Название (например: 1С склад)">
            <button class="btn-primary" @click="create">Создать</button>
          </div>
          <div v-if="newKey" class="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/40 p-4">
            <div class="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-2"><BrandIcon name="warning" :size="15" />Ключ показывается один раз — сохраните его:</div>
            <div class="flex gap-2 items-center">
              <code class="text-xs font-mono break-all flex-1">{{ newKey }}</code>
              <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="copy">Копировать</button>
            </div>
          </div>
        </div>
        <div v-if="keys.length" class="glass rounded-2xl p-6">
          <h2 class="font-display font-semibold mb-3">Ваши ключи</h2>
          <div v-for="k in keys" :key="k.id" class="flex items-center gap-3 text-sm py-2 border-b border-slate-100 dark:border-white/5">
            <code class="font-mono text-xs">{{ k.prefix }}…</code>
            <span class="font-medium">{{ k.name }}</span>
            <span class="text-xs text-slate-500 ml-auto">{{ k.last_used_at ? 'использован ' + k.last_used_at.slice(0, 10) : 'не использован' }}</span>
            <button class="text-slate-400 hover:text-red-500" @click="revoke(k.id)"><BrandIcon name="close" :size="16" /></button>
          </div>
        </div>
        <div class="glass rounded-2xl p-6">
          <h2 class="font-display font-semibold mb-3">Документация</h2>
          <pre class="text-xs font-mono bg-slate-100 dark:bg-ink-900 rounded-xl p-4 overflow-x-auto">POST https://code-qr.stockcity.ru/api/v1/generate
X-API-Key: cq_ваш_ключ
Content-Type: application/json

{ "name": "Партия 1", "mode": "cz", "format": "png",
  "rows": ["(01)04600000000015(21)5PojkV(91)EE10(92)dGVzdA=="] }

GET /api/v1/jobs/{id}   — статус и коды задания
GET /api/v1/me          — тариф и лимиты</pre>
        </div>
      </template>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    </section>
  </div>
</template>
