<script setup>
import BrandIcon from '../../components/BrandIcon.vue';
import { onMounted, ref } from 'vue';
import { api } from '../../api.js';
import TwoFactorCard from '../../components/admin/TwoFactorCard.vue';
import SecurityLimitsCard from '../../components/admin/SecurityLimitsCard.vue';
import PlanLimitsCard from '../../components/admin/PlanLimitsCard.vue';
import SmtpCard from '../../components/admin/SmtpCard.vue';
import StorageCard from '../../components/admin/StorageCard.vue';

const cz = ref({ czEnabled: false, czApiUrl: '', czConfigured: false });
const czToken = ref('');
const offers = ref([]);
const testPrice = ref(1);
const error = ref('');
const notice = ref('');
const savingPrice = ref(false);
const savingCz = ref(false);

async function load() {
  error.value = '';
  try {
    const [settings, pricing] = await Promise.all([api.adminSettings(), api.adminPricing()]);
    cz.value = settings;
    offers.value = pricing.offers.map((o) => ({ days: o.days, price: o.price, discount: o.discount }));
    testPrice.value = pricing.testPrice;
  } catch (e) {
    error.value = e.message;
  }
}

function finalPrice(o) {
  const d = Math.min(90, Math.max(0, Number(o.discount) || 0));
  return Math.round(Number(o.price) * (1 - d / 100) * 100) / 100;
}

function addOffer() {
  offers.value.push({ days: 30, price: 1990, discount: 0 });
}

function removeOffer(i) {
  offers.value.splice(i, 1);
}

async function savePricing() {
  error.value = '';
  notice.value = '';
  for (const o of offers.value) {
    if (!Number.isFinite(Number(o.days)) || Number(o.days) < 1 || Number(o.days) > 3650) {
      error.value = 'Срок каждого периода: от 1 до 3650 дней';
      return;
    }
  }
  savingPrice.value = true;
  try {
    const d = await api.adminSavePricing({ offers: offers.value, testPrice: testPrice.value });
    offers.value = d.offers.map((o) => ({ days: o.days, price: o.price, discount: o.discount }));
    testPrice.value = d.testPrice;
    notice.value = 'Тарифы сохранены';
  } catch (e) {
    error.value = e.message;
  } finally {
    savingPrice.value = false;
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
      <h2 class="flex items-center gap-2 font-display font-semibold mb-1"><BrandIcon name="billing" :size="19" />Тарифы PREMIUM</h2>
      <p class="text-xs text-slate-500 mb-4">Периоды, базовая цена и скидка %. Итоговая цена пересчитывается автоматически и видна клиентам. Скидка 0–90%.</p>
      <div class="hidden md:grid grid-cols-[90px_1fr_90px_1fr_40px] gap-3 text-xs text-slate-500 mb-2 px-1">
        <span>Срок, дн.</span><span>Базовая цена, ₽</span><span>Скидка, %</span><span>Итого клиенту</span><span></span>
      </div>
      <div class="space-y-2">
        <div v-for="(o, i) in offers" :key="i" class="grid grid-cols-2 md:grid-cols-[90px_1fr_90px_1fr_40px] gap-3 items-center">
          <input v-model.number="o.days" type="number" min="1" max="3650" class="input !py-2 text-sm" placeholder="дн." aria-label="Срок в днях">
          <input v-model.number="o.price" type="number" min="1" class="input !py-2 text-sm" placeholder="₽" aria-label="Базовая цена">
          <input v-model.number="o.discount" type="number" min="0" max="90" class="input !py-2 text-sm" placeholder="%" aria-label="Скидка в процентах">
          <div class="text-sm">
            <b class="text-emerald-600 dark:text-emerald-400">{{ finalPrice(o).toLocaleString('ru') }} ₽</b>
            <span v-if="o.discount > 0" class="text-xs text-slate-400 line-through ml-2">{{ Number(o.price).toLocaleString('ru') }}</span>
            <div class="text-xs text-slate-500">{{ Math.round(finalPrice(o) / o.days * 30).toLocaleString('ru') }} ₽/мес</div>
          </div>
          <button class="text-slate-400 hover:text-red-500 justify-self-end" title="Удалить период" aria-label="Удалить период" @click="removeOffer(i)"><BrandIcon name="close" :size="17" /></button>
        </div>
      </div>
      <div class="flex flex-wrap gap-3 mt-4 items-center">
        <button class="btn-ghost !py-2 text-sm" @click="addOffer">+ Добавить период</button>
        <label class="flex items-center gap-2 text-sm ml-auto">
          <span class="text-slate-500">Тестовый тариф, ₽</span>
          <input v-model.number="testPrice" type="number" min="1" max="1000000" class="input !py-2 !w-28 text-sm" aria-label="Цена тестового тарифа">
        </label>
        <button class="btn-primary !py-2 text-sm" :disabled="savingPrice" @click="savePricing">{{ savingPrice ? 'Сохраняем…' : 'Сохранить тарифы' }}</button>
      </div>
    </div>

    <PlanLimitsCard />

    <TwoFactorCard />

    <SecurityLimitsCard />

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
