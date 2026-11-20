<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { store } from '../../store.js';

const form = reactive({
  host: '', port: 465, secure: true, user: '', pass: '',
  fromName: 'CODE QR PRO', fromEmail: '', logoMode: 'image', logoUrl: ''
});
const state = reactive({ configured: false, hasPassword: false });
const testTo = ref(store.user?.email || '');
const provider = ref('');
const providers = [
  { id: 'yandex', label: 'Яндекс 360', host: 'smtp.yandex.ru', port: 465, secure: true },
  { id: 'mailru', label: 'Mail.ru', host: 'smtp.mail.ru', port: 465, secure: true },
  { id: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true },
  { id: 'vk', label: 'VK WorkMail', host: 'smtp.vk.com', port: 465, secure: true },
  { id: 'custom', label: 'Другой / свой сервер', host: '', port: 465, secure: true }
];
const error = ref('');
const notice = ref('');
const busy = ref(false);
const testing = ref(false);

function applyProvider() {
  const p = providers.find((x) => x.id === provider.value);
  if (!p || p.id === 'custom') return;
  form.host = p.host;
  form.port = p.port;
  form.secure = p.secure;
}

function guessProvider() {
  const domain = String(form.fromEmail || '').split('@')[1]?.toLowerCase() || '';
  if (/(^|\.)yandex\./.test(domain)) provider.value = 'yandex';
  else if (/(^|\.)(mail\.ru|bk\.ru|inbox\.ru|list\.ru)$/.test(domain)) provider.value = 'mailru';
  else if (domain === 'gmail.com' || domain === 'googlemail.com') provider.value = 'gmail';
  else if (/(^|\.)vk\.com$/.test(domain)) provider.value = 'vk';
  else provider.value = 'custom';
  applyProvider();
}

function friendlyError(e) {
  const message = String(e?.message || e || '');
  if (/EAUTH|Invalid login|authentication|535|Логин или пароль/i.test(message)) {
    return 'Неверный логин или пароль. Для Яндекс/Mail.ru/Gmail нужен пароль приложения, а не обычный пароль от почты.';
  }
  if (/ETIMEDOUT|ECONNECTION|ESOCKET|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    return 'Нет соединения с SMTP. Проверьте хост, порт и SSL (465 — SSL, 587 — STARTTLS).';
  }
  if (/EENVELOPE|from|sender/i.test(message)) {
    return 'Проверьте email отправителя: он должен совпадать с ящиком, от имени которого отправляете.';
  }
  return message;
}

async function load() {
  try {
    const d = await api.adminSmtp();
    Object.assign(form, {
      host: d.host || '', port: d.port || 465, secure: Boolean(d.secure),
      user: d.user || '', pass: '', fromName: d.fromName || 'CODE QR PRO', fromEmail: d.fromEmail || '',
      logoMode: d.logoMode || 'image', logoUrl: d.logoUrl || ''
    });
    state.configured = d.configured;
    state.hasPassword = d.hasPassword;
  } catch (e) { error.value = e.message; }
}

async function save() {
  error.value = '';
  notice.value = '';
  busy.value = true;
  try {
    const d = await api.adminSaveSmtp({ ...form, pass: form.pass || undefined });
    form.pass = '';
    state.configured = d.configured;
    notice.value = 'SMTP-настройки сохранены';
    await load();
  } catch (e) { error.value = friendlyError(e); }
  finally { busy.value = false; }
}

async function test() {
  error.value = '';
  notice.value = '';
  testing.value = true;
  try {
    await api.adminTestSmtp(testTo.value.trim());
    notice.value = 'Тестовое письмо отправлено на ' + testTo.value;
  } catch (e) { error.value = friendlyError(e); }
  finally { testing.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="glass rounded-2xl p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold">Почта (SMTP)</h2>
        <p class="text-xs text-slate-500 mt-1">Через этот сервер уходят рассылки и тестовые письма. Для @mail.ru SPF/DKIM уже настроены; для своего домена добавьте SPF, DKIM и DMARC в DNS.</p>
      </div>
      <span class="chip-soon" :class="state.configured ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10' : ''">{{ state.configured ? 'настроен' : 'не настроен' }}</span>
    </div>

    <p v-if="error" class="text-sm text-red-500 mt-3">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500 mt-3">{{ notice }}</p>

    <div class="flex flex-wrap items-end gap-2 mt-4">
      <div class="flex-1 min-w-[220px]">
        <label class="label !text-xs" for="smtp-provider">Провайдер</label>
        <select id="smtp-provider" v-model="provider" class="input !py-2 text-sm" @change="applyProvider">
          <option value="">Выберите или заполните вручную</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" @click="guessProvider">Подставить по email</button>
    </div>

    <p class="text-xs text-slate-500 mt-2">Для Яндекс/Mail.ru/Gmail нужен <b>пароль приложения</b>, а не обычный пароль от почты.</p>

    <div class="grid md:grid-cols-2 gap-3 mt-3">
      <div>
        <label class="label !text-xs" for="smtp-host">Хост</label>
        <input id="smtp-host" v-model="form.host" class="input !py-2 text-sm" placeholder="smtp.yandex.ru">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label !text-xs" for="smtp-port">Порт</label>
          <input id="smtp-port" v-model.number="form.port" type="number" min="1" max="65535" class="input !py-2 text-sm">
        </div>
        <label class="flex items-end gap-2 text-sm pb-2.5">
          <input v-model="form.secure" type="checkbox"> SSL/TLS
        </label>
      </div>
      <div>
        <label class="label !text-xs" for="smtp-user">Логин</label>
        <input id="smtp-user" v-model="form.user" class="input !py-2 text-sm" autocomplete="off">
      </div>
      <div>
        <label class="label !text-xs" for="smtp-pass">Пароль {{ state.hasPassword ? '(сохранён, оставьте пустым)' : '' }}</label>
        <input id="smtp-pass" v-model="form.pass" type="password" class="input !py-2 text-sm" autocomplete="new-password" placeholder="не менять">
      </div>
      <div>
        <label class="label !text-xs" for="smtp-from-name">Имя отправителя</label>
        <input id="smtp-from-name" v-model="form.fromName" class="input !py-2 text-sm">
      </div>
      <div>
        <label class="label !text-xs" for="smtp-from-email">Email отправителя</label>
        <input id="smtp-from-email" v-model="form.fromEmail" type="email" class="input !py-2 text-sm" placeholder="noreply@code-qr.stockcity.ru" @change="guessProvider">
      </div>
      <div>
        <label class="label !text-xs" for="smtp-logo-mode">Логотип в письмах</label>
        <select id="smtp-logo-mode" v-model="form.logoMode" class="input !py-2 text-sm">
          <option value="image">Логотип (картинка с сайта)</option>
          <option value="mark">QR-марка (без картинки)</option>
        </select>
      </div>
      <div>
        <label class="label !text-xs" for="smtp-logo-url">Свой логотип (URL, необязательно)</label>
        <input id="smtp-logo-url" v-model="form.logoUrl" class="input !py-2 text-sm" placeholder="https://code-qr.stockcity.ru/icon-192.png">
      </div>
    </div>
    <p class="text-xs text-slate-500 mt-2">
      Письма уходят в фирменном шаблоне: шапка с логотипом, кнопка действия, подвал с сайтом и поддержкой.
      «QR-марка» — запасной вариант для клиентов, которые блокируют картинки.
    </p>

    <div class="flex flex-wrap items-end gap-2 mt-4">
      <button class="btn-primary !py-2 !px-4 text-sm" :disabled="busy" @click="save">{{ busy ? 'Сохраняем…' : 'Сохранить' }}</button>
      <div class="flex items-end gap-2 ml-auto">
        <div>
          <label class="label !text-xs" for="smtp-test">Проверка на адрес</label>
          <input id="smtp-test" v-model="testTo" type="email" class="input !py-2 !w-56 text-sm">
        </div>
        <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="testing || !state.configured" @click="test">{{ testing ? 'Отправляем…' : 'Тест' }}</button>
      </div>
    </div>
  </div>
</template>
