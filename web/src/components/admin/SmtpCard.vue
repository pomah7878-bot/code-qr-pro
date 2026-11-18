<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { store } from '../../store.js';

const form = reactive({
  host: '', port: 465, secure: true, user: '', pass: '',
  fromName: 'CODE QR PRO', fromEmail: ''
});
const state = reactive({ configured: false, hasPassword: false });
const testTo = ref(store.user?.email || '');
const error = ref('');
const notice = ref('');
const busy = ref(false);
const testing = ref(false);

async function load() {
  try {
    const d = await api.adminSmtp();
    Object.assign(form, {
      host: d.host || '', port: d.port || 465, secure: Boolean(d.secure),
      user: d.user || '', pass: '', fromName: d.fromName || 'CODE QR PRO', fromEmail: d.fromEmail || ''
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
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function test() {
  error.value = '';
  notice.value = '';
  testing.value = true;
  try {
    await api.adminTestSmtp(testTo.value.trim());
    notice.value = 'Тестовое письмо отправлено на ' + testTo.value;
  } catch (e) { error.value = e.message; }
  finally { testing.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="glass rounded-2xl p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold">Почта (SMTP)</h2>
        <p class="text-xs text-slate-500 mt-1">Через этот сервер уходят рассылки и тестовые письма.</p>
      </div>
      <span class="chip-soon" :class="state.configured ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10' : ''">{{ state.configured ? 'настроен' : 'не настроен' }}</span>
    </div>

    <p v-if="error" class="text-sm text-red-500 mt-3">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500 mt-3">{{ notice }}</p>

    <div class="grid md:grid-cols-2 gap-3 mt-4">
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
        <input id="smtp-from-email" v-model="form.fromEmail" type="email" class="input !py-2 text-sm" placeholder="noreply@code-qr.stockcity.ru">
      </div>
    </div>

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
