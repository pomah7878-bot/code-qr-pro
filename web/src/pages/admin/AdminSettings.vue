<script setup>
import BrandIcon from '../../components/BrandIcon.vue';
import { onMounted, ref } from 'vue';
import { api } from '../../api.js';
import TwoFactorCard from '../../components/admin/TwoFactorCard.vue';
import SecurityLimitsCard from '../../components/admin/SecurityLimitsCard.vue';
import AiCard from '../../components/admin/AiCard.vue';
import SmtpCard from '../../components/admin/SmtpCard.vue';
import StorageCard from '../../components/admin/StorageCard.vue';

const cz = ref({ czEnabled: false, czApiUrl: '', czConfigured: false });
const czToken = ref('');
const error = ref('');
const notice = ref('');
const savingCz = ref(false);

async function load() {
  error.value = '';
  try {
    cz.value = await api.adminSettings();
  } catch (e) {
    error.value = e.message;
  }
}

async function saveCz() {
  error.value = '';
  notice.value = '';
  savingCz.value = true;
  try {
    await api.adminSaveSettings({
      czEnabled: cz.value.czEnabled,
      czApiUrl: cz.value.czApiUrl,
      czToken: czToken.value || undefined
    });
    czToken.value = '';
    notice.value = 'Настройки Честного ЗНАКа сохранены';
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    savingCz.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-5">
    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div class="glass rounded-2xl p-6">
      <h2 class="flex items-center gap-2 font-display font-semibold mb-1"><BrandIcon name="billing" :size="19" />Тарифы и подписки</h2>
      <p class="text-xs text-slate-500 mb-4">Цены, лимиты операций и проверок, функции тарифов, назначение подписок и платежи управляются в отдельном разделе.</p>
      <router-link to="/app/admin/billing" class="btn-ghost !py-2 text-sm">Открыть «Тарифы и подписки» →</router-link>
    </div>

    <TwoFactorCard />

    <SecurityLimitsCard />

    <AiCard />

    <SmtpCard />

    <StorageCard />

    <div class="glass rounded-2xl p-6">
      <h2 class="font-display font-semibold mb-1">Честный ЗНАК (ГИС МТ)</h2>
      <p class="text-xs text-slate-500 mb-4">
        Статус: <b :class="cz.czConfigured ? 'text-emerald-500' : 'text-amber-500'">{{ cz.czConfigured ? 'токен сохранён' : 'не подключено' }}</b> ·
        онлайн-проверка требует УКЭП и активируется отдельно. Ключи API:
        <a href="https://xn--80ajghhoc2aj1c8b.xn--p1ai/" target="_blank" rel="noopener" class="text-brand-400">честныйзнак.рф</a>
      </p>
      <div class="grid md:grid-cols-2 gap-4">
        <label class="flex items-center gap-2 text-sm">
          <input v-model="cz.czEnabled" type="checkbox"> Интеграция включена
        </label>
        <div>
          <label class="label !text-xs" for="cz-url">API URL</label>
          <input id="cz-url" v-model="cz.czApiUrl" class="input !py-2 text-sm">
        </div>
        <div class="md:col-span-2">
          <label class="label !text-xs" for="cz-token">Токен / ключ API (не отображается после сохранения)</label>
          <input id="cz-token" v-model="czToken" type="password" class="input !py-2 text-sm" placeholder="оставьте пустым, чтобы не менять" autocomplete="off">
        </div>
      </div>
      <button class="btn-primary !py-2 mt-4" :disabled="savingCz" @click="saveCz">{{ savingCz ? 'Сохраняем…' : 'Сохранить настройки' }}</button>
    </div>
  </div>
</template>
