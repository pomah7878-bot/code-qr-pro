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
const inv = ref({ name: '', status: '', inn: '', address: '', bank: '', bik: '', account: '', corr: '', phone: '', email: '', ready: false, missing: [] });
const savingInv = ref(false);
const signature = ref('');
const savingSig = ref(false);

async function load() {
  error.value = '';
  try {
    const data = await api.adminSettings();
    cz.value = data;
    if (data.invoice) inv.value = data.invoice;
    signature.value = data.invoiceSignature || '';
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

function onSignatureFile(event) {
  error.value = ''; notice.value = '';
  const file = event.target.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpeg)$/.test(file.type)) { error.value = 'Подпись должна быть PNG или JPEG'; return; }
  if (file.size > 1.5 * 1024 * 1024) { error.value = 'Размер подписи — до 1,5 МБ'; return; }
  const reader = new FileReader();
  reader.onload = () => { signature.value = String(reader.result || ''); };
  reader.readAsDataURL(file);
  event.target.value = '';
}

async function saveSignature(clear = false) {
  error.value = ''; notice.value = ''; savingSig.value = true;
  try {
    await api.adminSaveSettings({ invoiceSignature: clear ? '' : signature.value });
    if (clear) signature.value = '';
    notice.value = clear ? 'Подпись удалена из счетов' : 'Подпись сохранена — она появится в следующих PDF-счетах';
    await load();
  } catch (e) { error.value = e.message; }
  finally { savingSig.value = false; }
}

async function saveInvoice() {
  error.value = ''; notice.value = ''; savingInv.value = true;
  try {
    await api.adminSaveSettings({ invoice: inv.value });
    notice.value = 'Реквизиты для счетов сохранены';
    await load();
  } catch (e) { error.value = e.message; }
  finally { savingInv.value = false; }
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
      <h2 class="flex items-center gap-2 font-display font-semibold mb-1"><BrandIcon name="orders" :size="19" />Реквизиты для счетов (B2B)</h2>
      <p class="text-xs text-slate-500 mb-4">
        Нужны для автоматического счёта юридическим лицам. Без банковских реквизитов оплата по счёту недоступна.
        Статус: <b :class="inv.ready ? 'text-emerald-500' : 'text-amber-500'">{{ inv.ready ? 'готово' : 'заполните: ' + (inv.missing || []).join(', ') }}</b>
      </p>
      <div class="grid md:grid-cols-2 gap-4">
        <div class="md:col-span-2">
          <label class="label !text-xs" for="inv-name">Наименование продавца (ФИО / ИП / ООО)</label>
          <input id="inv-name" v-model="inv.name" class="input !py-2 text-sm" placeholder="Например: Иванов Иван Иванович">
        </div>
        <div class="md:col-span-2">
          <label class="label !text-xs" for="inv-status">Налоговый статус</label>
          <input id="inv-status" v-model="inv.status" class="input !py-2 text-sm" placeholder="Плательщик налога на профессиональный доход (самозанятый)">
        </div>
        <div>
          <label class="label !text-xs" for="inv-inn">ИНН</label>
          <input id="inv-inn" v-model="inv.inn" class="input !py-2 text-sm" inputmode="numeric" placeholder="12 или 10 цифр">
        </div>
        <div>
          <label class="label !text-xs" for="inv-phone">Телефон для счёта</label>
          <input id="inv-phone" v-model="inv.phone" class="input !py-2 text-sm" placeholder="+7 …">
        </div>
        <div class="md:col-span-2">
          <label class="label !text-xs" for="inv-address">Адрес для счёта</label>
          <input id="inv-address" v-model="inv.address" class="input !py-2 text-sm" placeholder="Город, улица, дом">
        </div>
        <div class="md:col-span-2">
          <label class="label !text-xs" for="inv-bank">Банк</label>
          <input id="inv-bank" v-model="inv.bank" class="input !py-2 text-sm" placeholder="Наименование банка">
        </div>
        <div>
          <label class="label !text-xs" for="inv-bik">БИК</label>
          <input id="inv-bik" v-model="inv.bik" class="input !py-2 text-sm" inputmode="numeric" placeholder="9 цифр">
        </div>
        <div>
          <label class="label !text-xs" for="inv-account">Расчётный счёт</label>
          <input id="inv-account" v-model="inv.account" class="input !py-2 text-sm" inputmode="numeric" placeholder="20 цифр">
        </div>
        <div>
          <label class="label !text-xs" for="inv-corr">Корр. счёт</label>
          <input id="inv-corr" v-model="inv.corr" class="input !py-2 text-sm" inputmode="numeric" placeholder="20 цифр">
        </div>
        <div>
          <label class="label !text-xs" for="inv-email">Email для счёта</label>
          <input id="inv-email" v-model="inv.email" class="input !py-2 text-sm" placeholder="code-qr-pro@mail.ru">
        </div>
      </div>
      <button class="btn-primary !py-2 mt-4" :disabled="savingInv" @click="saveInvoice">{{ savingInv ? 'Сохраняем…' : 'Сохранить реквизиты' }}</button>

      <div class="mt-5 pt-5 border-t border-slate-200/70 dark:border-white/10">
        <div class="font-semibold text-sm mb-1">Подпись для счетов</div>
        <p class="text-xs text-slate-500 mb-3">PNG или JPEG с прозрачным/белым фоном, до 1,5 МБ. Подпись автоматически встаёт в блок «Поставщик» в PDF-счёте. Это визуальное факсимиле, а не квалифицированная ЭЦП.</p>
        <div v-if="signature" class="mb-3 inline-block rounded-xl border border-slate-200 dark:border-white/10 bg-white p-2">
          <img :src="signature" alt="Подпись для счетов" class="max-h-24 max-w-[260px] object-contain">
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="btn-ghost !py-2 !px-3 text-sm cursor-pointer">
            Загрузить подпись
            <input type="file" class="hidden" accept="image/png,image/jpeg" @change="onSignatureFile">
          </label>
          <button class="btn-primary !py-2 !px-3 text-sm" :disabled="savingSig || !signature" @click="saveSignature(false)">{{ savingSig ? 'Сохраняем…' : 'Сохранить подпись' }}</button>
          <button v-if="signature" class="btn-ghost !py-2 !px-3 text-sm text-red-500" :disabled="savingSig" @click="saveSignature(true)">Удалить</button>
        </div>
      </div>
    </div>

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
