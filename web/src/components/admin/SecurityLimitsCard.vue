<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime } from '../../lib/format.js';

const limits = ref([]);
const locks = ref([]);
const allow = ref([]);
const newIp = ref('');
const newNote = ref('');
const loading = ref(false);
const busy = ref('');
const error = ref('');
const notice = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [r, l, a] = await Promise.all([api.adminRateLimits(), api.adminLoginLocks(), api.adminAllowlist()]);
    limits.value = r.limits || [];
    locks.value = l.locks || [];
    allow.value = a.ips || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function addAllow() {
  const ip = String(newIp.value || '').trim();
  if (!ip) return;
  busy.value = 'add-allow';
  error.value = '';
  notice.value = '';
  try {
    await api.adminAddAllowlist(ip, newNote.value);
    notice.value = `IP ${ip} добавлен в белый список`;
    newIp.value = '';
    newNote.value = '';
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = '';
  }
}

async function removeAllow(ip) {
  busy.value = 'del-allow:' + ip;
  error.value = '';
  notice.value = '';
  try {
    await api.adminRemoveAllowlist(ip);
    notice.value = `IP ${ip} убран из белого списка`;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = '';
  }
}

async function clearIp(ip) {
  busy.value = 'ip:' + ip;
  error.value = '';
  notice.value = '';
  try {
    await api.adminClearRateLimit(ip);
    notice.value = `Лимит для ${ip} снят`;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = '';
  }
}

async function clearAllIps() {
  if (!window.confirm('Снять лимиты запросов для всех IP? Защита продолжит действовать, счётчики начнутся заново.')) return;
  busy.value = 'all-ip';
  error.value = '';
  try {
    const r = await api.adminClearAllRateLimits();
    notice.value = `Снято лимитов: ${r.removed}`;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = '';
  }
}

async function clearLock(email) {
  busy.value = 'email:' + email;
  error.value = '';
  notice.value = '';
  try {
    await api.adminClearLoginLock(email);
    notice.value = `Вход для ${email} разблокирован`;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = '';
  }
}

async function clearAllLocks() {
  if (!window.confirm('Разблокировать вход всем, кто сейчас заблокирован?')) return;
  busy.value = 'all-email';
  error.value = '';
  try {
    const r = await api.adminClearAllLoginLocks();
    notice.value = `Разблокировано: ${r.removed}`;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = '';
  }
}

onMounted(load);
</script>

<template>
  <div class="glass rounded-2xl p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold">Защитные лимиты</h2>
        <p class="text-xs text-slate-500 mt-1">
          Антиспам по IP и блокировка входа после 5 неудачных попыток. Снятие помогает конкретному клиенту сразу —
          защита для остальных продолжает работать.
        </p>
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="loading" @click="load">{{ loading ? 'Обновляем…' : 'Обновить' }}</button>
    </div>

    <p v-if="error" class="text-sm text-red-500 mt-3">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500 mt-3">{{ notice }}</p>

    <div class="grid md:grid-cols-2 gap-5 mt-4">
      <div>
        <div class="flex items-center justify-between gap-2 mb-2">
          <h3 class="font-semibold text-sm">Лимит запросов (429) · {{ limits.length }}</h3>
          <button v-if="limits.length" class="text-xs text-red-500 hover:underline" :disabled="busy === 'all-ip'" @click="clearAllIps">Снять все</button>
        </div>
        <p v-if="!limits.length" class="text-xs text-slate-500">Сейчас никто не упирается в лимит.</p>
        <div v-else class="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          <div v-for="l in limits" :key="l.ip" class="flex items-center justify-between gap-2 text-xs rounded-lg border border-slate-200 dark:border-white/10 px-2.5 py-1.5">
            <div class="min-w-0">
              <div class="font-mono truncate">{{ l.ip }}</div>
              <div class="text-slate-500">{{ l.count }} запросов · окно {{ l.ageSec }} с назад</div>
            </div>
            <button class="btn-ghost !py-1 !px-2 text-xs shrink-0" :disabled="busy === 'ip:' + l.ip" @click="clearIp(l.ip)">Снять</button>
          </div>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between gap-2 mb-2">
          <h3 class="font-semibold text-sm">Блокировки входа · {{ locks.length }}</h3>
          <button v-if="locks.length" class="text-xs text-red-500 hover:underline" :disabled="busy === 'all-email'" @click="clearAllLocks">Снять все</button>
        </div>
        <p v-if="!locks.length" class="text-xs text-slate-500">Заблокированных входов нет.</p>
        <div v-else class="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          <div v-for="l in locks" :key="l.email" class="flex items-center justify-between gap-2 text-xs rounded-lg border border-slate-200 dark:border-white/10 px-2.5 py-1.5">
            <div class="min-w-0">
              <div class="truncate">{{ l.email }}</div>
              <div class="text-slate-500">{{ l.fails }} попыток · до {{ fmtDateTime(l.locked_until) }}</div>
            </div>
            <button class="btn-ghost !py-1 !px-2 text-xs shrink-0" :disabled="busy === 'email:' + l.email" @click="clearLock(l.email)">Снять</button>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-5 pt-4 border-t border-slate-200 dark:border-white/10">
      <div class="flex items-center justify-between gap-2 mb-2">
        <h3 class="font-semibold text-sm">Белый список IP · {{ allow.length }}</h3>
        <span class="text-[11px] text-slate-500">такие адреса не упираются в антиспам</span>
      </div>
      <div class="flex flex-wrap items-end gap-2">
        <div class="flex-1 min-w-[160px]">
          <label class="label !text-xs" for="allow-ip">IP-адрес</label>
          <input id="allow-ip" v-model="newIp" class="input !py-2 text-sm font-mono" placeholder="203.0.113.10" @keyup.enter="addAllow">
        </div>
        <div class="flex-1 min-w-[160px]">
          <label class="label !text-xs" for="allow-note">Комментарий</label>
          <input id="allow-note" v-model="newNote" class="input !py-2 text-sm" maxlength="200" placeholder="Офис клиента / склад">
        </div>
        <button class="btn-primary !py-2 !px-4 text-sm" :disabled="busy === 'add-allow' || !newIp.trim()" @click="addAllow">Добавить</button>
      </div>
      <p v-if="!allow.length" class="text-xs text-slate-500 mt-2">Список пуст — антиспам действует для всех.</p>
      <div v-else class="mt-2 space-y-1.5 max-h-44 overflow-y-auto pr-1">
        <div v-for="a in allow" :key="a.ip" class="flex items-center justify-between gap-2 text-xs rounded-lg border border-slate-200 dark:border-white/10 px-2.5 py-1.5">
          <div class="min-w-0">
            <div class="font-mono truncate">{{ a.ip }}</div>
            <div class="text-slate-500 truncate">{{ a.note || 'без комментария' }} · добавлен {{ fmtDateTime(a.created_at) }}</div>
          </div>
          <button class="btn-ghost !py-1 !px-2 text-xs shrink-0 text-red-500" :disabled="busy === 'del-allow:' + a.ip" @click="removeAllow(a.ip)">Убрать</button>
        </div>
      </div>
    </div>
  </div>
</template>
