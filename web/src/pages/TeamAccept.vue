<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { store } from '../store.js';

const router = useRouter();
const error = ref('');
const notice = ref('');
const busy = ref(false);
const info = ref(null);
const password = ref('');
const password2 = ref('');
const acceptTerms = ref(false);
const formError = ref('');
const token = String(new URLSearchParams(window.location.search).get('token') || '');

async function load() {
  if (!token) { error.value = 'В ссылке нет токена приглашения'; return; }
  try { info.value = await api.teamInviteInfo(token); }
  catch (e) { error.value = e.message; }
}

async function accept() {
  error.value = ''; formError.value = '';
  if (password.value.length < 8) { formError.value = 'Пароль минимум 8 символов'; return; }
  if (password.value !== password2.value) { formError.value = 'Пароли не совпадают'; return; }
  if (!acceptTerms.value) { formError.value = 'Подтвердите принятие условий'; return; }
  busy.value = true;
  try {
    const r = await api.teamAccept({ token, password: password.value, name: info.value?.name || '', acceptTerms: true });
    store.setSession(r);
    router.push('/app');
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 py-12">
    <div class="glass rounded-3xl p-6 sm:p-8 max-w-lg w-full">
      <div class="text-xs font-bold uppercase tracking-widest text-brand-400 mb-3">Командный доступ</div>
      <h1 class="font-display font-bold text-2xl">Приглашение в CODE QR PRO</h1>
      <div v-if="error" class="text-sm text-red-500 mt-4">{{ error }}</div>
      <div v-else-if="!info" class="text-sm text-slate-500 mt-4">Проверяем приглашение…</div>
      <template v-else>
        <p class="text-sm text-slate-500 mt-3">
          <b>{{ info.ownerName || info.ownerEmail }}</b> приглашает вас в рабочее пространство CODE QR PRO.
        </p>
        <div class="mt-4 text-sm space-y-1">
          <div>Email: <b>{{ info.email }}</b></div>
          <div>Роль: <b>{{ info.roleLabel }}</b></div>
          <div class="text-xs text-slate-500">Ссылка действует до {{ info.expiresAt }}.</div>
        </div>
        <div class="mt-4 space-y-3">
          <div>
            <label class="label !text-xs" for="team-password">Пароль для личного входа</label>
            <input id="team-password" v-model="password" type="password" class="input !py-2 text-sm" autocomplete="new-password" placeholder="Минимум 8 символов">
          </div>
          <div>
            <label class="label !text-xs" for="team-password2">Повторите пароль</label>
            <input id="team-password2" v-model="password2" type="password" class="input !py-2 text-sm" autocomplete="new-password">
          </div>
          <label class="flex items-start gap-2 text-xs"><input v-model="acceptTerms" type="checkbox" class="mt-0.5">Принимаю условия обслуживания и обработку персональных данных</label>
          <p v-if="formError" class="text-sm text-red-500">{{ formError }}</p>
        </div>
        <button class="btn-primary w-full mt-4" :disabled="busy" @click="accept">{{ busy ? 'Создаём доступ…' : 'Создать личный вход и войти' }}</button>
        <p class="text-[11px] text-slate-500 mt-3">После активации вы сможете входить на /login по email и паролю. Вы получите доступ к данным аккаунта владельца; он может отозвать доступ в разделе «Команда».</p>
      </template>
    </div>
  </div>
</template>
