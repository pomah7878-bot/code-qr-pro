<script setup>
import { computed, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { store } from '../../store.js';
import Modal from './Modal.vue';

const enabled = computed(() => Boolean(store.user?.twoFactorEnabled));
const modal = reactive({ open: false, kind: '' });
const setup = reactive({ qr: '', secret: '' });
const code = ref('');
const backupCodes = ref([]);
const disableForm = reactive({ password: '', code: '' });
const error = ref('');
const notice = ref('');
const busy = ref(false);

const close = () => {
  modal.open = false;
  modal.kind = '';
  code.value = '';
  setup.qr = '';
  setup.secret = '';
  error.value = '';
};

async function start() {
  error.value = '';
  notice.value = '';
  busy.value = true;
  try {
    const d = await api.twoFactorSetup();
    setup.qr = d.qr;
    setup.secret = d.secret;
    modal.open = true;
    modal.kind = 'setup';
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function enable() {
  error.value = '';
  busy.value = true;
  try {
    const d = await api.twoFactorEnable(code.value.trim());
    backupCodes.value = d.backupCodes;
    modal.kind = 'backup';
    code.value = '';
    notice.value = 'Двухфакторная аутентификация включена';
    await store.load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function disable() {
  error.value = '';
  notice.value = '';
  busy.value = true;
  try {
    await api.twoFactorDisable({ password: disableForm.password, code: disableForm.code.trim() });
    disableForm.password = '';
    disableForm.code = '';
    notice.value = 'Двухфакторная аутентификация отключена';
    await store.load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function copyBackup() {
  try {
    await navigator.clipboard.writeText(backupCodes.value.join('\n'));
    notice.value = 'Резервные коды скопированы';
  } catch { error.value = 'Не удалось скопировать'; }
}
</script>

<template>
  <div class="glass rounded-2xl p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold">Двухфакторная аутентификация</h2>
        <p class="text-xs text-slate-500 mt-1">Дополнительный код при входе из приложения-аутентификатора. Рекомендуется для администратора.</p>
      </div>
      <span class="chip-soon" :class="enabled ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10' : ''">{{ enabled ? 'включена' : 'выключена' }}</span>
    </div>

    <p v-if="error" class="text-sm text-red-500 mt-3">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500 mt-3">{{ notice }}</p>

    <div v-if="!enabled" class="mt-4">
      <button class="btn-primary !py-2 text-sm" :disabled="busy" @click="start">{{ busy ? 'Готовим…' : 'Включить 2FA' }}</button>
      <p class="text-xs text-slate-500 mt-2">Понадобится Google Authenticator, Aegis, 1Password или аналогичное приложение.</p>
    </div>

    <div v-else class="mt-4 grid md:grid-cols-2 gap-3">
      <div>
        <label class="label !text-xs" for="tfa-password">Пароль</label>
        <input id="tfa-password" v-model="disableForm.password" type="password" class="input !py-2 text-sm" autocomplete="current-password">
      </div>
      <div>
        <label class="label !text-xs" for="tfa-code">Код из приложения или резервный</label>
        <input id="tfa-code" v-model="disableForm.code" class="input !py-2 text-sm" inputmode="numeric" autocomplete="one-time-code">
      </div>
      <div class="md:col-span-2">
        <button class="btn-ghost !py-2 text-sm text-red-500" :disabled="busy" @click="disable">{{ busy ? 'Проверяем…' : 'Отключить 2FA' }}</button>
      </div>
    </div>

    <Modal :open="modal.open" :title="modal.kind === 'backup' ? 'Резервные коды' : 'Настройка 2FA'" @close="close">
      <template v-if="modal.kind === 'setup'">
        <p class="text-sm text-slate-500">Отсканируйте QR-код в приложении и введите шестизначный код.</p>
        <img v-if="setup.qr" :src="setup.qr" alt="QR-код для настройки 2FA" class="w-48 h-48 mx-auto mt-4 rounded-xl bg-white p-2">
        <div class="text-xs text-slate-500 mt-3">Если QR не читается, введите секрет вручную:</div>
        <code class="block mt-1 rounded-xl border border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-ink-900 px-3 py-2 font-mono text-sm break-all">{{ setup.secret }}</code>
        <label class="label mt-4" for="tfa-setup-code">Код из приложения</label>
        <input id="tfa-setup-code" v-model="code" class="input text-sm" inputmode="numeric" autocomplete="one-time-code" placeholder="000000">
        <p v-if="error" class="text-sm text-red-500 mt-2">{{ error }}</p>
        <div class="flex justify-end gap-2 mt-4">
          <button class="btn-ghost !py-2 !px-3 text-sm" @click="close">Отмена</button>
          <button class="btn-primary !py-2 !px-4 text-sm" :disabled="busy || code.length < 6" @click="enable">Включить</button>
        </div>
      </template>

      <template v-else-if="modal.kind === 'backup'">
        <p class="text-sm">Сохраните резервные коды. Каждый работает один раз, если потеряете доступ к приложению.</p>
        <div class="grid grid-cols-2 gap-2 mt-4 font-mono text-sm">
          <code v-for="c in backupCodes" :key="c" class="rounded-lg bg-slate-100 dark:bg-ink-900 px-3 py-2 text-center">{{ c }}</code>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button class="btn-ghost !py-2 !px-3 text-sm" @click="copyBackup">Копировать все</button>
          <button class="btn-primary !py-2 !px-4 text-sm" @click="close">Готово</button>
        </div>
      </template>
    </Modal>
  </div>
</template>
