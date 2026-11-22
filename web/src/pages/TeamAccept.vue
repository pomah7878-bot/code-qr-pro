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
const token = String(new URLSearchParams(window.location.search).get('token') || '');

async function load() {
  if (!token) { error.value = 'В ссылке нет токена приглашения'; return; }
  try { info.value = await api.teamInviteInfo(token); }
  catch (e) { error.value = e.message; }
}

async function accept() {
  busy.value = true; error.value = '';
  try {
    const r = await api.teamAccept(token);
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
        <button class="btn-primary w-full mt-5" :disabled="busy" @click="accept">{{ busy ? 'Входим…' : 'Принять приглашение и войти' }}</button>
        <p class="text-[11px] text-slate-500 mt-3">Вы получите доступ к данным и инструментам аккаунта владельца. Владелец может отозвать доступ в разделе «Команда».</p>
      </template>
    </div>
  </div>
</template>
