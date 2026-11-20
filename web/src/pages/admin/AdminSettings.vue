<script setup>
import BrandIcon from '../../components/BrandIcon.vue';
import { onMounted, ref } from 'vue';
import { api } from '../../api.js';
import TwoFactorCard from '../../components/admin/TwoFactorCard.vue';
import SecurityLimitsCard from '../../components/admin/SecurityLimitsCard.vue';
import AiCard from '../../components/admin/AiCard.vue';
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
      error.value = 'РЎСЂРѕРє РєР°Р¶РґРѕРіРѕ РїРµСЂРёРѕРґР°: РѕС‚ 1 РґРѕ 3650 РґРЅРµР№';
      return;
    }
  }
  savingPrice.value = true;
  try {
    const d = await api.adminSavePricing({ offers: offers.value, testPrice: testPrice.value });
    offers.value = d.offers.map((o) => ({ days: o.days, price: o.price, discount: o.discount }));
    testPrice.value = d.testPrice;
    notice.value = 'РўР°СЂРёС„С‹ СЃРѕС…СЂР°РЅРµРЅС‹';
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
    notice.value = 'РќР°СЃС‚СЂРѕР№РєРё Р§РµСЃС‚РЅРѕРіРѕ Р—РќРђРљР° СЃРѕС…СЂР°РЅРµРЅС‹';
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
      <h2 class="flex items-center gap-2 font-display font-semibold mb-1"><BrandIcon name="billing" :size="19" />РўР°СЂРёС„С‹ PREMIUM</h2>
      <p class="text-xs text-slate-500 mb-4">РџРµСЂРёРѕРґС‹, Р±Р°Р·РѕРІР°СЏ С†РµРЅР° Рё СЃРєРёРґРєР° %. РС‚РѕРіРѕРІР°СЏ С†РµРЅР° РїРµСЂРµСЃС‡РёС‚С‹РІР°РµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё Рё РІРёРґРЅР° РєР»РёРµРЅС‚Р°Рј. РЎРєРёРґРєР° 0вЂ“90%.</p>
      <div class="hidden md:grid grid-cols-[90px_1fr_90px_1fr_40px] gap-3 text-xs text-slate-500 mb-2 px-1">
        <span>РЎСЂРѕРє, РґРЅ.</span><span>Р‘Р°Р·РѕРІР°СЏ С†РµРЅР°, в‚Ѕ</span><span>РЎРєРёРґРєР°, %</span><span>РС‚РѕРіРѕ РєР»РёРµРЅС‚Сѓ</span><span></span>
      </div>
      <div class="space-y-2">
        <div v-for="(o, i) in offers" :key="i" class="grid grid-cols-2 md:grid-cols-[90px_1fr_90px_1fr_40px] gap-3 items-center">
          <input v-model.number="o.days" type="number" min="1" max="3650" class="input !py-2 text-sm" placeholder="РґРЅ." aria-label="РЎСЂРѕРє РІ РґРЅСЏС…">
          <input v-model.number="o.price" type="number" min="1" class="input !py-2 text-sm" placeholder="в‚Ѕ" aria-label="Р‘Р°Р·РѕРІР°СЏ С†РµРЅР°">
          <input v-model.number="o.discount" type="number" min="0" max="90" class="input !py-2 text-sm" placeholder="%" aria-label="РЎРєРёРґРєР° РІ РїСЂРѕС†РµРЅС‚Р°С…">
          <div class="text-sm">
            <b class="text-emerald-600 dark:text-emerald-400">{{ finalPrice(o).toLocaleString('ru') }} в‚Ѕ</b>
            <span v-if="o.discount > 0" class="text-xs text-slate-400 line-through ml-2">{{ Number(o.price).toLocaleString('ru') }}</span>
            <div class="text-xs text-slate-500">{{ Math.round(finalPrice(o) / o.days * 30).toLocaleString('ru') }} в‚Ѕ/РјРµСЃ</div>
          </div>
          <button class="text-slate-400 hover:text-red-500 justify-self-end" title="РЈРґР°Р»РёС‚СЊ РїРµСЂРёРѕРґ" aria-label="РЈРґР°Р»РёС‚СЊ РїРµСЂРёРѕРґ" @click="removeOffer(i)"><BrandIcon name="close" :size="17" /></button>
        </div>
      </div>
      <div class="flex flex-wrap gap-3 mt-4 items-center">
        <button class="btn-ghost !py-2 text-sm" @click="addOffer">+ Р”РѕР±Р°РІРёС‚СЊ РїРµСЂРёРѕРґ</button>
        <label class="flex items-center gap-2 text-sm ml-auto">
          <span class="text-slate-500">РўРµСЃС‚РѕРІС‹Р№ С‚Р°СЂРёС„, в‚Ѕ</span>
          <input v-model.number="testPrice" type="number" min="1" max="1000000" class="input !py-2 !w-28 text-sm" aria-label="Р¦РµРЅР° С‚РµСЃС‚РѕРІРѕРіРѕ С‚Р°СЂРёС„Р°">
        </label>
        <button class="btn-primary !py-2 text-sm" :disabled="savingPrice" @click="savePricing">{{ savingPrice ? 'РЎРѕС…СЂР°РЅСЏРµРјвЂ¦' : 'РЎРѕС…СЂР°РЅРёС‚СЊ С‚Р°СЂРёС„С‹' }}</button>
      </div>
    </div>

    <PlanLimitsCard />

    <TwoFactorCard />

    <SecurityLimitsCard />

    <AiCard />

    <SmtpCard />

    <StorageCard />

    <div class="glass rounded-2xl p-6">
      <h2 class="font-display font-semibold mb-1">Р§РµСЃС‚РЅС‹Р№ Р—РќРђРљ (Р“РРЎ РњРў)</h2>
      <p class="text-xs text-slate-500 mb-4">
        РЎС‚Р°С‚СѓСЃ: <b :class="cz.czConfigured ? 'text-emerald-500' : 'text-amber-500'">{{ cz.czConfigured ? 'С‚РѕРєРµРЅ СЃРѕС…СЂР°РЅС‘РЅ' : 'РЅРµ РїРѕРґРєР»СЋС‡РµРЅРѕ' }}</b> В·
        РѕРЅР»Р°Р№РЅ-РїСЂРѕРІРµСЂРєР° С‚СЂРµР±СѓРµС‚ РЈРљР­Рџ Рё Р°РєС‚РёРІРёСЂСѓРµС‚СЃСЏ РѕС‚РґРµР»СЊРЅРѕ. РљР»СЋС‡Рё API:
        <a href="https://xn--80ajghhoc2aj1c8b.xn--p1ai/" target="_blank" rel="noopener" class="text-brand-400">С‡РµСЃС‚РЅС‹Р№Р·РЅР°Рє.СЂС„</a>
      </p>
      <div class="grid md:grid-cols-2 gap-4">
        <label class="flex items-center gap-2 text-sm">
          <input v-model="cz.czEnabled" type="checkbox"> РРЅС‚РµРіСЂР°С†РёСЏ РІРєР»СЋС‡РµРЅР°
        </label>
        <div>
          <label class="label !text-xs" for="cz-url">API URL</label>
          <input id="cz-url" v-model="cz.czApiUrl" class="input !py-2 text-sm">
        </div>
        <div class="md:col-span-2">
          <label class="label !text-xs" for="cz-token">РўРѕРєРµРЅ / РєР»СЋС‡ API (РЅРµ РѕС‚РѕР±СЂР°Р¶Р°РµС‚СЃСЏ РїРѕСЃР»Рµ СЃРѕС…СЂР°РЅРµРЅРёСЏ)</label>
          <input id="cz-token" v-model="czToken" type="password" class="input !py-2 text-sm" placeholder="РѕСЃС‚Р°РІСЊС‚Рµ РїСѓСЃС‚С‹Рј, С‡С‚РѕР±С‹ РЅРµ РјРµРЅСЏС‚СЊ" autocomplete="off">
        </div>
      </div>
      <button class="btn-primary !py-2 mt-4" :disabled="savingCz" @click="saveCz">{{ savingCz ? 'РЎРѕС…СЂР°РЅСЏРµРјвЂ¦' : 'РЎРѕС…СЂР°РЅРёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё' }}</button>
    </div>
  </div>
</template>
