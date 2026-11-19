<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { store } from '../store.js';
import SideNav from '../components/SideNav.vue';
import TwoFactorCard from '../components/admin/TwoFactorCard.vue';

const router = useRouter();
const sessions = ref([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);

const fmt = (v) => {
  if (!v) return '—';
  const d = new Date(String(v).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('ru-RU');
};

async function loadSessions() {
  try { sessions.value = (await api.sessions()).sessions || []; }
  catch (e) { error.value = e.message; }
}

async function logoutAll() {
  if (!confirm('Выйти на всех устройствах? Текущий вход тоже завершится.')) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    await api.logoutAll();
    store.user = null; store.plan = null; store.usage = null;
    router.push('/login');
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

onMounted(loadSessions);
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/security" />
    <section class="space-y-6 min-w-0">
      <div>
        <h1 class="font-display font-bold text-3xl">Безопасность</h1>
        <p class="text-sm text-slate-500 mt-1">Двухфакторная аутентификация и активные сессии.</p>
      </div>

      <div v-if="error" class="text-sm text-red-500">{{ error }}</div>
      <div v-if="notice" class="text-sm text-emerald-500">{{ notice }}</div>

      <TwoFactorCard />

      <div class="glass rounded-2xl p-6">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 class="font-display font-semibold">Активные сессии</h2>
            <p class="text-xs text-slate-500 mt-1">Где выполнен вход в аккаунт.</p>
          </div>
          <button class="btn-ghost !py-2 !px-3 text-sm text-red-500" :disabled="busy" @click="logoutAll">Выйти на всех устройствах</button>
        </div>
        <div class="space-y-2">
          <div v-for="(s, i) in sessions" :key="i" class="rounded-xl border border-slate-200 dark:border-white/10 p-3 text-xs">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono">{{ s.ip || 'IP не определён' }}</span>
              <span v-if="s.current" class="rounded-full bg-emerald-500/10 text-emerald-500 px-2 py-0.5">текущая</span>
              <span class="text-slate-500 ml-auto">вход: {{ fmt(s.created_at) }}</span>
            </div>
            <div class="text-slate-500 mt-1 truncate" :title="s.user_agent">{{ s.user_agent || 'Неизвестное устройство' }}</div>
            <div class="text-slate-500">активность: {{ fmt(s.last_used_at) }} · истекает: {{ fmt(s.expires_at) }}</div>
          </div>
          <p v-if="!sessions.length" class="text-sm text-slate-500">Других сессий нет.</p>
        </div>
      </div>

      <div class="glass rounded-2xl p-5 text-sm text-slate-500">
        Администратору и поддержке вход в админку доступен только после включения 2FA. Сессия администратора живёт 7 дней и завершается после 2 часов бездействия.
      </div>
    </section>
  </div>
</template>
