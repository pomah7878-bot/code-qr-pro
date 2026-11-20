<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api.js';
import { store } from '../../store.js';
import { daysLeft, fmtDate, fmtDateTime, money } from '../../lib/format.js';
import Modal from '../../components/admin/Modal.vue';

const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id);

const data = ref(null);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const tab = ref('orders');
const grantDays = ref(30);
const noteDraft = ref('');
const roleDraft = ref('');
const savingNote = ref(false);
const modal = reactive({ open: false, kind: '', title: '', busy: false, reason: '', email: '', password: '', link: '', linkExpires: '' });
const diag = ref(null);
const diagLoading = ref(false);
const helpBusy = ref('');
const mail = reactive({ open: false, template: 'access_restored', templates: [], subject: '', text: '', busy: false, loading: false, preview: '', previewBusy: false });
const comp = reactive({ open: false, days: 3, reason: '', busy: false });

const LOGIN_REASON = {
  password: 'пароль',
  '2fa': '2FA',
  admin_link: 'ссылка админа',
  bad_password: 'неверный пароль',
  locked: 'вход заблокирован',
  blocked: 'аккаунт заблокирован'
};

const ACTION_LABELS = {
  'user.grant': 'Выдан PREMIUM',
  'user.revoke': 'Снят PREMIUM',
  'user.block': 'Блокировка',
  'user.unblock': 'Разблокировка',
  'user.role': 'Смена роли',
  'user.password_reset': 'Сброс пароля',
  'user.reset_2fa': 'Сброс 2FA',
  'user.unlock_login': 'Разблокировка входа',
  'user.reset_usage': 'Сброс лимита кодов',
  'user.clear_password_flag': 'Снят флаг смены пароля',
  'user.clear_rate_limits': 'Снят лимит запросов',
  'user.login_link': 'Выдана ссылка входа',
  'user.delete': 'Удаление клиента',
  'session.kill': 'Завершена сессия',
  'session.kill_all': 'Завершены все сессии'
};
const actionLabel = (a) => ACTION_LABELS[a] || a;

const user = computed(() => data.value?.user || null);
const premiumUntil = computed(() => data.value?.premiumUntil || null);
const days = computed(() => daysLeft(premiumUntil.value));
const isSelf = computed(() => Boolean(user.value && store.user && user.value.id === store.user.id));
const isAdmin = computed(() => store.user?.role === 'admin');
const initials = computed(() => {
  const src = (user.value?.name || user.value?.email || '?').trim();
  return src.slice(0, 2).toUpperCase();
});
const paidTotal = computed(() => (data.value?.orders || [])
  .filter((o) => o.status === 'paid')
  .reduce((sum, o) => sum + Number(o.amount || 0), 0));

const tabs = computed(() => [
  { id: 'orders', label: 'Платежи', count: data.value?.orders?.length || 0 },
  { id: 'jobs', label: 'Задания', count: data.value?.jobs?.length || 0 },
  { id: 'access', label: 'Доступ', count: (data.value?.sessions?.length || 0) + (data.value?.apiKeys?.length || 0) },
  { id: 'subs', label: 'Подписки', count: data.value?.subscriptions?.length || 0 }
]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.adminUser(id.value);
    noteDraft.value = data.value.user.note || '';
    roleDraft.value = data.value.user.role;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
  if (isAdmin.value) loadDiagnostics();
}

async function loadDiagnostics() {
  if (!isAdmin.value) return;
  diagLoading.value = true;
  try {
    diag.value = await api.adminUserDiagnostics(id.value);
  } catch {
    diag.value = null;
  } finally {
    diagLoading.value = false;
  }
}

async function helpAction(kind, fn, okText) {
  helpBusy.value = kind;
  error.value = '';
  notice.value = '';
  try {
    const result = await fn();
    notice.value = typeof okText === 'function' ? okText(result) : okText;
    await Promise.all([load(), loadDiagnostics()]);
  } catch (e) {
    error.value = e.message;
  } finally {
    helpBusy.value = '';
  }
}

function unlockLogin() {
  helpAction('unlock', () => api.adminUnlockLogin(id.value), (r) => `Вход разблокирован (было неудачных попыток: ${r.clearedFails})`);
}

function reset2fa() {
  if (!window.confirm('Сбросить 2FA? Клиент войдёт по паролю, все его сессии завершатся.')) return;
  helpAction('2fa', () => api.adminReset2fa(id.value), '2FA сброшена, сессии завершены');
}

function resetUsage() {
  helpAction('usage', () => api.adminResetUsage(id.value), (r) => `Дневной лимит кодов обнулён (было ${r.cleared})`);
}

function clearPasswordFlag() {
  helpAction('pwdflag', () => api.adminClearPasswordFlag(id.value), 'Требование сменить пароль при входе снято');
}

function clearRateLimits() {
  helpAction('ratelimit', () => api.adminClearRateLimits(id.value), (r) => `Снято лимитов запросов: ${r.removed}`);
}

async function makeLoginLink() {
  helpBusy.value = 'link';
  error.value = '';
  notice.value = '';
  try {
    const r = await api.adminLoginLink(id.value);
    Object.assign(modal, { open: true, kind: 'link', title: 'Ссылка для входа', busy: false, link: r.url, linkExpires: r.expiresAt });
    await loadDiagnostics();
  } catch (e) {
    error.value = e.message;
  } finally {
    helpBusy.value = '';
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(modal.link);
    notice.value = 'Ссылка скопирована';
  } catch {
    error.value = 'Не удалось скопировать — выделите ссылку вручную';
  }
}

async function openMail() {
  Object.assign(mail, { open: true, loading: true, busy: false, subject: '', text: '', preview: '' });
  try {
    if (!mail.templates.length) mail.templates = (await api.adminMailTemplates()).templates;
  } catch (e) {
    error.value = e.message;
  } finally {
    mail.loading = false;
  }
}

async function previewMail() {
  mail.previewBusy = true;
  error.value = '';
  try {
    const r = await api.adminMailPreview(id.value, { template: mail.template, subject: mail.subject, text: mail.text });
    mail.preview = r.html;
  } catch (e) {
    error.value = e.message;
  } finally {
    mail.previewBusy = false;
  }
}

async function sendMailToClient() {
  mail.busy = true;
  error.value = '';
  notice.value = '';
  try {
    const r = await api.adminSendMessage(id.value, { template: mail.template, subject: mail.subject, text: mail.text });
    mail.open = false;
    notice.value = `Письмо отправлено: «${r.subject}»`;
  } catch (e) {
    error.value = e.message;
  } finally {
    mail.busy = false;
  }
}

function openCompensate() {
  Object.assign(comp, { open: true, days: 3, reason: '', busy: false });
}

async function doCompensate() {
  comp.busy = true;
  error.value = '';
  notice.value = '';
  try {
    const r = await api.adminCompensate(id.value, comp.days, comp.reason);
    comp.open = false;
    notice.value = `Компенсация: +${r.days} дн. до ${fmtDate(r.premiumUntil)}${r.notified ? ' · клиенту отправлено письмо' : ''}`;
    await Promise.all([load(), loadDiagnostics()]);
  } catch (e) {
    error.value = e.message;
  } finally {
    comp.busy = false;
  }
}

async function revokeApiKeys() {
  if (!window.confirm('Отозвать все API-ключи клиента? Интеграции (1С, склад) перестанут работать до создания новых ключей.')) return;
  helpBusy.value = 'keys';
  error.value = '';
  notice.value = '';
  try {
    const r = await api.adminRevokeApiKeys(id.value);
    notice.value = `Отозвано ключей: ${r.removed}`;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    helpBusy.value = '';
  }
}

async function viewAsClient() {
  helpBusy.value = 'view';
  error.value = '';
  notice.value = '';
  try {
    const r = await api.adminImpersonate(id.value);
    window.open(r.url, '_blank', 'noopener');
    notice.value = 'Просмотр открыт в новой вкладке: только чтение, 30 минут';
  } catch (e) {
    error.value = e.message;
  } finally {
    helpBusy.value = '';
  }
}

const loginReason = (r) => LOGIN_REASON[r] || r || '—';

async function grant() {
  error.value = '';
  notice.value = '';
  const n = Math.round(Number(grantDays.value));
  if (!Number.isFinite(n) || n < 1 || n > 3650) {
    error.value = 'Срок: от 1 до 3650 дней';
    return;
  }
  try {
    const r = await api.adminGrant(id.value, n);
    notice.value = 'PREMIUM выдан до ' + fmtDate(r.premiumUntil);
    await load();
  } catch (e) { error.value = e.message; }
}

async function revoke() {
  if (!window.confirm('Снять PREMIUM и перевести клиента на FREE? Действие сразу ограничит доступ.')) return;
  error.value = '';
  try {
    await api.adminRevoke(id.value);
    notice.value = 'PREMIUM снят';
    await load();
  } catch (e) { error.value = e.message; }
}

async function toggleBlock() {
  if (user.value.status === 'blocked') {
    error.value = '';
    try {
      await api.adminUnblock(id.value);
      notice.value = 'Клиент разблокирован';
      await load();
    } catch (e) { error.value = e.message; }
    return;
  }
  Object.assign(modal, { open: true, kind: 'block', title: 'Заблокировать клиента', busy: false, reason: '' });
}

async function doBlock() {
  modal.busy = true;
  error.value = '';
  try {
    await api.adminBlock(id.value, modal.reason);
    modal.open = false;
    notice.value = 'Клиент заблокирован, все сессии завершены';
    await load();
  } catch (e) { error.value = e.message; }
  finally { modal.busy = false; }
}

async function resetPassword() {
  if (!window.confirm('Сбросить пароль? Все сессии клиента завершатся, при входе потребуется новый пароль.')) return;
  error.value = '';
  try {
    const r = await api.adminResetPassword(id.value);
    Object.assign(modal, { open: true, kind: 'password', title: 'Временный пароль', password: r.password });
    await load();
  } catch (e) { error.value = e.message; }
}

async function changeRole() {
  error.value = '';
  try {
    await api.adminRole(id.value, roleDraft.value);
    notice.value = 'Роль изменена: ' + roleDraft.value;
    await load();
  } catch (e) {
    error.value = e.message;
    roleDraft.value = user.value.role;
  }
}

async function saveNote() {
  savingNote.value = true;
  error.value = '';
  try {
    await api.adminNote(id.value, noteDraft.value);
    notice.value = 'Заметка сохранена';
    data.value.user.note = noteDraft.value;
  } catch (e) { error.value = e.message; }
  finally { savingNote.value = false; }
}

function openDelete() {
  Object.assign(modal, { open: true, kind: 'delete', title: 'Удалить клиента', busy: false, email: '' });
}

async function doDelete() {
  modal.busy = true;
  error.value = '';
  try {
    await api.adminDeleteUser(id.value, modal.email);
    modal.open = false;
    router.push('/app/admin/users');
  } catch (e) { error.value = e.message; }
  finally { modal.busy = false; }
}

async function killSession(publicId) {
  if (!window.confirm('Завершить эту сессию? Клиенту придётся войти заново.')) return;
  error.value = '';
  try {
    await api.adminKillSession(publicId);
    await load();
  } catch (e) { error.value = e.message; }
}

async function killAllSessions() {
  if (!window.confirm('Завершить все сессии клиента?')) return;
  error.value = '';
  try {
    const r = await api.adminKillSessions(id.value);
    notice.value = 'Завершено сессий: ' + r.removed;
    await load();
  } catch (e) { error.value = e.message; }
}

async function copyPassword() {
  try {
    await navigator.clipboard.writeText(modal.password);
    notice.value = 'Пароль скопирован';
  } catch {
    error.value = 'Не удалось скопировать — выделите пароль вручную';
  }
}

const orderStatusClass = (s) => (s === 'paid' ? 'text-emerald-500'
  : s === 'pending' ? 'text-amber-500'
    : s === 'refunded' ? 'text-red-500' : 'text-slate-400');
const jobStatusClass = (s) => (s === 'done' ? 'text-emerald-500'
  : s === 'error' ? 'text-red-500'
    : s === 'running' ? 'text-brand-400' : 'text-slate-400');

watch(() => route.params.id, (next, prev) => {
  if (next && next !== prev) load();
});

onMounted(load);
</script>

<template>
  <div class="space-y-5">
    <router-link to="/app/admin/users" class="inline-block text-sm text-slate-500 hover:text-brand-400">← К списку клиентов</router-link>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
    <p v-if="loading && !user" class="text-sm text-slate-500">Загрузка…</p>

    <template v-if="user">
      <!-- Шапка клиента -->
      <div class="glass rounded-2xl p-5 flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-start gap-4 min-w-0">
          <div class="w-14 h-14 shrink-0 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center font-display font-bold text-lg">
            {{ initials }}
          </div>
          <div class="min-w-0">
            <h2 class="font-display font-bold text-xl truncate">{{ user.name || user.email }}</h2>
            <p class="text-sm text-slate-500 truncate">{{ user.email }} · ID {{ user.id }}</p>
            <div class="flex flex-wrap items-center gap-2 mt-2 text-xs">
              <span class="chip-soon" :class="user.status === 'blocked' ? '!text-red-500 !border-red-500/30 !bg-red-500/10' : '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10'">
                {{ user.status === 'blocked' ? 'Заблокирован' : 'Активен' }}
              </span>
              <span class="chip-soon" :class="user.plan === 'premium' ? '!text-brand-400' : ''">{{ user.plan.toUpperCase() }}</span>
              <span v-if="user.role !== 'user'" class="chip-soon">{{ user.role }}</span>
              <span v-if="premiumUntil" class="text-slate-500">PREMIUM до {{ fmtDate(premiumUntil) }} · {{ days }} дн.</span>
            </div>
            <p v-if="user.blockedReason" class="text-xs text-red-500 mt-1">Причина блокировки: {{ user.blockedReason }}</p>
          </div>
        </div>
        <div class="text-xs text-slate-500 sm:text-right space-y-0.5">
          <div>Регистрация: {{ fmtDate(user.createdAt) }}</div>
          <div>Последний вход: {{ user.lastLoginAt ? fmtDateTime(user.lastLoginAt) : '—' }}</div>
          <div>Оплачено всего: <b class="text-slate-700 dark:text-slate-200">{{ money(paidTotal) }}</b></div>
        </div>
      </div>

      <div v-if="isAdmin" class="grid md:grid-cols-2 gap-5">
        <!-- PREMIUM -->
        <div class="glass rounded-2xl p-5">
          <div class="flex items-center justify-between gap-2">
            <h3 class="font-display font-semibold">PREMIUM</h3>
            <span class="text-xs" :class="premiumUntil ? 'text-emerald-500' : 'text-slate-400'">{{ premiumUntil ? 'активен' : 'не активен' }}</span>
          </div>
          <div v-if="premiumUntil" class="mt-3">
            <div class="text-2xl font-extrabold">{{ fmtDate(premiumUntil) }}</div>
            <div class="text-xs text-slate-500">осталось {{ days }} дн.</div>
          </div>
          <p v-else class="text-sm text-slate-500 mt-3">Подписка не активна.</p>

          <div class="flex flex-wrap gap-2 mt-4">
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="grantDays = 30; grant()">+30 дней</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="grantDays = 90; grant()">+90 дней</button>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="grantDays = 365; grant()">+365 дней</button>
          </div>
          <div class="flex flex-wrap gap-2 mt-3">
            <input v-model.number="grantDays" type="number" min="1" max="3650" class="input !py-2 !w-24 text-sm" aria-label="Срок в днях">
            <button class="btn-primary !py-2 !px-4 text-sm" @click="grant">Выдать</button>
            <button v-if="premiumUntil" class="btn-ghost !py-2 !px-3 text-sm text-red-500" @click="revoke">Снять</button>
          </div>
        </div>

        <!-- Действия -->
        <div class="glass rounded-2xl p-5">
          <h3 class="font-display font-semibold mb-3">Действия</h3>
          <div class="flex flex-wrap gap-2">
            <button class="btn-ghost !py-2 !px-3 text-sm" :class="user.status === 'blocked' ? 'text-emerald-500' : 'text-red-500'" @click="toggleBlock">
              {{ user.status === 'blocked' ? 'Разблокировать' : 'Заблокировать' }}
            </button>
            <button class="btn-ghost !py-2 !px-3 text-sm" @click="resetPassword">Сбросить пароль</button>
            <button class="btn-ghost !py-2 !px-3 text-sm" @click="killAllSessions">Выйти со всех устройств</button>
          </div>

          <div class="mt-4">
            <label class="label !text-xs" for="admin-user-role-select">Роль</label>
            <select id="admin-user-role-select" v-model="roleDraft" class="input !py-2 text-sm" :disabled="isSelf" @change="changeRole">
              <option value="user">Клиент</option>
              <option value="support">Поддержка</option>
              <option value="admin">Администратор</option>
            </select>
            <p class="text-[11px] text-slate-500 mt-1">Поддержка видит клиентов и задания, но не платежи и настройки.</p>
          </div>

          <div v-if="!isSelf" class="mt-4 pt-3 border-t border-slate-200 dark:border-white/10">
            <button class="text-xs text-red-500 hover:underline" @click="openDelete">Удалить клиента и все данные</button>
          </div>
        </div>
      </div>

      <!-- Быстрая помощь -->
      <div v-if="isAdmin" class="glass rounded-2xl p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-display font-semibold">Быстрая помощь</h3>
          <span class="text-xs text-slate-500">{{ diagLoading ? 'Собираем диагностику…' : 'снять защитные ограничения' }}</span>
        </div>
        <p class="text-xs text-slate-500 mt-1">
          Возвращает клиента в работу без ожидания: разблокировка входа, сброс 2FA, лимиты кодов и запросов.
          Все действия попадают в журнал аудита.
        </p>

        <div v-if="diag" class="grid sm:grid-cols-3 gap-2 mt-3 text-xs">
          <div class="rounded-xl border border-slate-200 dark:border-white/10 p-3">
            <div class="text-slate-500">Вход</div>
            <div class="font-semibold" :class="diag.locked ? 'text-red-500' : 'text-emerald-500'">{{ diag.locked ? 'заблокирован' : 'открыт' }}</div>
            <div class="text-slate-500 mt-1">неудачных попыток: {{ diag.fails }}</div>
            <div v-if="diag.lockedUntil" class="text-slate-500">до {{ fmtDateTime(diag.lockedUntil) }}</div>
          </div>
          <div class="rounded-xl border border-slate-200 dark:border-white/10 p-3">
            <div class="text-slate-500">2FA</div>
            <div class="font-semibold" :class="diag.twoFactorEnabled ? 'text-emerald-500' : 'text-slate-400'">{{ diag.twoFactorEnabled ? 'включена' : 'выключена' }}</div>
            <div v-if="diag.mustChangePassword" class="text-amber-500 mt-1">просит сменить пароль</div>
          </div>
          <div class="rounded-xl border border-slate-200 dark:border-white/10 p-3">
            <div class="text-slate-500">Коды сегодня</div>
            <div class="font-semibold">{{ diag.usageToday }}</div>
            <div class="text-slate-500 mt-1">тариф {{ String(diag.plan || '').toUpperCase() }}</div>
          </div>
        </div>

        <div class="flex flex-wrap gap-2 mt-3">
          <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="helpBusy === 'unlock' || !diag || (!diag.locked && !diag.fails)" @click="unlockLogin">
            {{ helpBusy === 'unlock' ? 'Снимаем…' : 'Разблокировать вход' }}
          </button>
          <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="helpBusy === '2fa' || !diag?.twoFactorEnabled" @click="reset2fa">
            {{ helpBusy === '2fa' ? 'Сбрасываем…' : 'Сбросить 2FA' }}
          </button>
          <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="helpBusy === 'usage' || !diag" @click="resetUsage">
            {{ helpBusy === 'usage' ? 'Обнуляем…' : 'Обнулить лимит кодов' }}
          </button>
          <button v-if="diag?.mustChangePassword" class="btn-ghost !py-2 !px-3 text-sm" :disabled="helpBusy === 'pwdflag'" @click="clearPasswordFlag">
            Снять «сменить пароль»
          </button>
          <button class="btn-primary !py-2 !px-3 text-sm" :disabled="helpBusy === 'link' || user.status === 'blocked'" @click="makeLoginLink">
            {{ helpBusy === 'link' ? 'Готовим…' : 'Ссылка для входа' }}
          </button>
          <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="mail.busy" @click="openMail">Написать клиенту</button>
          <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="helpBusy === 'view' || user.status === 'blocked'" @click="viewAsClient">
            {{ helpBusy === 'view' ? 'Открываем…' : 'Смотреть как клиент' }}
          </button>
          <button class="btn-ghost !py-2 !px-3 text-sm" @click="openCompensate">Компенсация</button>
          <button class="btn-ghost !py-2 !px-3 text-sm text-red-500" :disabled="helpBusy === 'keys'" @click="revokeApiKeys">Отозвать API-ключи</button>
          <button v-if="diag?.rateLimits?.length" class="btn-ghost !py-2 !px-3 text-sm text-amber-500" :disabled="helpBusy === 'ratelimit'" @click="clearRateLimits">
            Снять лимит запросов ({{ diag.rateLimits.length }})
          </button>
        </div>

        <div v-if="diag?.logins?.length" class="mt-3 pt-3 border-t border-slate-200 dark:border-white/10">
          <div class="text-xs text-slate-500 mb-1">Последние входы</div>
          <ul class="text-xs space-y-0.5 max-h-40 overflow-y-auto">
            <li v-for="(l, i) in diag.logins.slice(0, 10)" :key="i" class="flex flex-wrap items-center gap-2">
              <span :class="l.ok ? 'text-emerald-500' : 'text-red-500'">{{ l.ok ? 'успешно' : 'отказ' }}</span>
              <span class="text-slate-500">{{ fmtDateTime(l.created_at) }}</span>
              <span class="text-slate-500">{{ loginReason(l.reason) }}</span>
              <span v-if="l.ip" class="text-slate-400 font-mono">{{ l.ip }}</span>
            </li>
          </ul>
        </div>

        <div v-if="diag?.lastActions?.length" class="mt-3 pt-3 border-t border-slate-200 dark:border-white/10">
          <div class="text-xs text-slate-500 mb-1">Последние действия по клиенту</div>
          <ul class="text-xs text-slate-500 space-y-0.5 max-h-40 overflow-y-auto">
            <li v-for="a in diag.lastActions" :key="a.created_at + a.action">
              {{ fmtDateTime(a.created_at) }} · {{ actionLabel(a.action) }}<span v-if="a.ip"> · {{ a.ip }}</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- Заметка -->
      <div v-if="isAdmin" class="glass rounded-2xl p-5">
        <label class="label" for="admin-user-note">Заметка администратора</label>
        <textarea id="admin-user-note" v-model="noteDraft" rows="3" maxlength="1000" class="input text-sm" placeholder="Например: договорились о продлении, проблема с оплатой…"></textarea>
        <div class="flex justify-end mt-2">
          <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="savingNote" @click="saveNote">{{ savingNote ? 'Сохраняем…' : 'Сохранить заметку' }}</button>
        </div>
      </div>

      <!-- Вкладки -->
      <div class="flex gap-2 overflow-x-auto pb-1">
        <button
          v-for="t in tabs" :key="t.id"
          class="px-4 py-2 rounded-xl text-sm border whitespace-nowrap transition"
          :class="tab === t.id
            ? 'bg-gradient-to-r from-brand-500/20 to-accent-500/10 border-brand-500/40 font-semibold'
            : 'border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'"
          @click="tab = t.id">
          {{ t.label }} <span class="text-xs opacity-60">{{ t.count }}</span>
        </button>
      </div>

      <div class="glass rounded-2xl overflow-hidden">
        <!-- Платежи -->
        <div v-if="tab === 'orders'" class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-3 px-4 font-medium">№</th><th class="py-3 px-4 font-medium">Дата</th>
              <th class="py-3 px-4 font-medium">Тариф</th><th class="py-3 px-4 font-medium">Сумма</th>
              <th class="py-3 px-4 font-medium">Статус</th><th class="py-3 px-4 font-medium hidden sm:table-cell">Оплачен</th>
            </tr></thead>
            <tbody>
              <tr v-if="!data.orders.length"><td colspan="6" class="py-6 px-4 text-center text-slate-500">Платежей нет.</td></tr>
              <tr v-for="o in data.orders" :key="o.id" class="border-b border-slate-100 dark:border-white/5 last:border-0">
                <td class="py-2.5 px-4 text-slate-500">{{ o.id }}</td>
                <td class="py-2.5 px-4">{{ fmtDate(o.created_at) }}</td>
                <td class="py-2.5 px-4">{{ o.plan.toUpperCase() }} · {{ o.days }} дн.</td>
                <td class="py-2.5 px-4">{{ money(o.amount) }}</td>
                <td class="py-2.5 px-4 text-xs font-semibold" :class="orderStatusClass(o.status)">{{ o.status }}</td>
                <td class="py-2.5 px-4 hidden sm:table-cell text-slate-500">{{ o.paid_at ? fmtDate(o.paid_at) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Задания -->
        <div v-else-if="tab === 'jobs'" class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-3 px-4 font-medium">№</th><th class="py-3 px-4 font-medium">Название</th>
              <th class="py-3 px-4 font-medium hidden sm:table-cell">Формат</th><th class="py-3 px-4 font-medium">Готово</th>
              <th class="py-3 px-4 font-medium">Статус</th><th class="py-3 px-4 font-medium hidden sm:table-cell">Создано</th>
            </tr></thead>
            <tbody>
              <tr v-if="!data.jobs.length"><td colspan="6" class="py-6 px-4 text-center text-slate-500">Заданий нет.</td></tr>
              <tr v-for="j in data.jobs" :key="j.id" class="border-b border-slate-100 dark:border-white/5 last:border-0">
                <td class="py-2.5 px-4 text-slate-500">{{ j.id }}</td>
                <td class="py-2.5 px-4 max-w-[220px] truncate">{{ j.name || 'Без названия' }}</td>
                <td class="py-2.5 px-4 hidden sm:table-cell uppercase text-xs">{{ j.format }} · {{ j.mode }}</td>
                <td class="py-2.5 px-4">{{ j.done }} / {{ j.valid }}</td>
                <td class="py-2.5 px-4 text-xs font-semibold" :class="jobStatusClass(j.status)">{{ j.status }}</td>
                <td class="py-2.5 px-4 hidden sm:table-cell text-slate-500">{{ fmtDateTime(j.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Доступ -->
        <div v-else-if="tab === 'access'" class="p-5 space-y-6">
          <div>
            <h4 class="font-semibold text-sm mb-2">Сессии <span class="text-slate-500 font-normal">({{ data.sessions.length }})</span></h4>
            <p v-if="!data.sessions.length" class="text-sm text-slate-500">Активных сессий нет.</p>
            <div v-for="s in data.sessions" :key="s.public_id" class="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-slate-100 dark:border-white/5 last:border-0 text-sm">
              <div>
                <div class="font-mono text-xs">{{ s.public_id.slice(0, 10) }}…</div>
                <div class="text-xs text-slate-500">создана {{ fmtDateTime(s.created_at) }} · до {{ fmtDateTime(s.expires_at) }}</div>
                <div v-if="s.ip || s.user_agent" class="text-[11px] text-slate-500 truncate max-w-[360px]">{{ s.ip || '—' }} · {{ s.user_agent || '' }}</div>
              </div>
              <button v-if="isAdmin" class="btn-ghost !py-1 !px-2.5 text-xs text-red-500" @click="killSession(s.public_id)">Завершить</button>
            </div>
          </div>
          <div>
            <h4 class="font-semibold text-sm mb-2">API-ключи <span class="text-slate-500 font-normal">({{ data.apiKeys.length }})</span></h4>
            <p v-if="!data.apiKeys.length" class="text-sm text-slate-500">Ключей нет.</p>
            <div v-for="k in data.apiKeys" :key="k.id" class="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-slate-100 dark:border-white/5 last:border-0 text-sm">
              <div>
                <div>{{ k.name }}</div>
                <div class="text-xs text-slate-500 font-mono">{{ k.prefix }}… · создан {{ fmtDate(k.created_at) }}</div>
              </div>
              <div class="text-xs text-slate-500">{{ k.last_used_at ? 'использован ' + fmtDateTime(k.last_used_at) : 'не использовался' }}</div>
            </div>
          </div>
        </div>

        <!-- Подписки -->
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-3 px-4 font-medium">№</th><th class="py-3 px-4 font-medium">План</th>
              <th class="py-3 px-4 font-medium">Статус</th><th class="py-3 px-4 font-medium">Провайдер</th>
              <th class="py-3 px-4 font-medium hidden sm:table-cell">Начало</th><th class="py-3 px-4 font-medium">Окончание</th>
            </tr></thead>
            <tbody>
              <tr v-if="!data.subscriptions.length"><td colspan="6" class="py-6 px-4 text-center text-slate-500">Подписок нет.</td></tr>
              <tr v-for="s in data.subscriptions" :key="s.id" class="border-b border-slate-100 dark:border-white/5 last:border-0">
                <td class="py-2.5 px-4 text-slate-500">{{ s.id }}</td>
                <td class="py-2.5 px-4">{{ s.plan.toUpperCase() }}</td>
                <td class="py-2.5 px-4">{{ s.status }}</td>
                <td class="py-2.5 px-4">{{ s.provider || '—' }}</td>
                <td class="py-2.5 px-4 hidden sm:table-cell text-slate-500">{{ s.started_at ? fmtDate(s.started_at) : '—' }}</td>
                <td class="py-2.5 px-4">{{ s.expires_at ? fmtDate(s.expires_at) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- Модалки -->
    <Modal :open="modal.open" :title="modal.title" @close="modal.open = false">
      <template v-if="modal.kind === 'block'">
        <label class="label" for="block-reason">Причина (по желанию)</label>
        <textarea id="block-reason" v-model="modal.reason" rows="3" maxlength="200" class="input text-sm" placeholder="Например: мошенничество, нарушение правил"></textarea>
        <p class="text-xs text-slate-500 mt-2">Клиент сразу потеряет доступ, все его сессии завершатся. API-ключи перестанут работать.</p>
        <div class="flex justify-end gap-2 mt-4">
          <button class="btn-ghost !py-2 !px-3 text-sm" @click="modal.open = false">Отмена</button>
          <button class="btn-primary !py-2 !px-4 text-sm" :disabled="modal.busy" @click="doBlock">{{ modal.busy ? 'Блокируем…' : 'Заблокировать' }}</button>
        </div>
      </template>

      <template v-else-if="modal.kind === 'delete'">
        <p class="text-sm">Удаление необратимо: исчезнут подписки, платежи, задания и файлы, API-ключи, сессии и отзыв.</p>
        <label class="label mt-4" for="delete-email">Введите email клиента для подтверждения</label>
        <input id="delete-email" v-model="modal.email" class="input text-sm" :placeholder="user ? user.email : 'email'" autocomplete="off">
        <div class="flex justify-end gap-2 mt-4">
          <button class="btn-ghost !py-2 !px-3 text-sm" @click="modal.open = false">Отмена</button>
          <button class="btn-primary !py-2 !px-4 text-sm !from-red-600 !to-red-500" :disabled="modal.busy" @click="doDelete">{{ modal.busy ? 'Удаляем…' : 'Удалить навсегда' }}</button>
        </div>
      </template>

      <template v-else-if="modal.kind === 'link'">
        <p class="text-sm">Отправьте ссылку клиенту. Она войдёт в аккаунт без пароля и 2FA и действует 15 минут.</p>
        <div class="mt-3 flex items-center gap-2">
          <code class="flex-1 rounded-xl border border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-ink-900 px-3 py-2 font-mono text-xs break-all">{{ modal.link }}</code>
          <button class="btn-ghost !py-2 !px-3 text-sm shrink-0" @click="copyLink">Копировать</button>
        </div>
        <p class="text-xs mt-2 text-amber-500">Не публикуйте ссылку: любой, кто её откроет, получит доступ к аккаунту клиента.</p>
        <div class="flex justify-end mt-4">
          <button class="btn-primary !py-2 !px-4 text-sm" @click="modal.open = false">Готово</button>
        </div>
      </template>

      <template v-else-if="modal.kind === 'password'">
        <p class="text-sm">Передайте клиенту временный пароль. Он показывается один раз, после входа клиент обязан его сменить.</p>
        <div class="mt-4 flex items-center gap-2">
          <code class="flex-1 rounded-xl border border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-ink-900 px-4 py-3 font-mono text-sm break-all">{{ modal.password }}</code>
          <button class="btn-ghost !py-2 !px-3 text-sm" @click="copyPassword">Копировать</button>
        </div>
        <div class="flex justify-end mt-4">
          <button class="btn-primary !py-2 !px-4 text-sm" @click="modal.open = false">Готово</button>
        </div>
      </template>
    </Modal>

    <Modal :open="mail.open" title="Письмо клиенту" @close="mail.open = false">
      <p class="text-sm text-slate-500">Письмо уходит на {{ user?.email }}. Если SMTP не настроен — будет ошибка.</p>
      <label class="label mt-3" for="mail-template">Шаблон</label>
      <select id="mail-template" v-model="mail.template" class="input text-sm">
        <option v-for="t in mail.templates" :key="t.id" :value="t.id">{{ t.title }}</option>
      </select>
      <template v-if="mail.template === 'custom'">
        <label class="label mt-3" for="mail-subject">Тема</label>
        <input id="mail-subject" v-model="mail.subject" class="input text-sm" maxlength="200" placeholder="Например: помогли с доступом">
        <label class="label mt-3" for="mail-text">Текст</label>
        <textarea id="mail-text" v-model="mail.text" rows="6" maxlength="5000" class="input text-sm" placeholder="Здравствуйте! …"></textarea>
      </template>
      <p v-else class="text-xs text-slate-500 mt-2">Текст шаблона подставится автоматически (имя клиента, срок PREMIUM). Фирменное оформление — фирменный шаблон CODE QR PRO.</p>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button class="btn-ghost !py-1.5 !px-3 text-xs" :disabled="mail.previewBusy" @click="previewMail">
          {{ mail.previewBusy ? 'Собираем…' : 'Предпросмотр письма' }}
        </button>
        <button v-if="mail.preview" class="text-xs text-slate-500 hover:underline" @click="mail.preview = ''">Скрыть предпросмотр</button>
      </div>
      <iframe v-if="mail.preview" :srcdoc="mail.preview" sandbox="" title="Предпросмотр письма" class="w-full h-[420px] mt-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white"></iframe>

      <div class="flex justify-end gap-2 mt-4">
        <button class="btn-ghost !py-2 !px-3 text-sm" @click="mail.open = false">Отмена</button>
        <button class="btn-primary !py-2 !px-4 text-sm" :disabled="mail.busy || mail.loading" @click="sendMailToClient">
          {{ mail.busy ? 'Отправляем…' : 'Отправить' }}
        </button>
      </div>
    </Modal>

    <Modal :open="comp.open" title="Компенсация за инцидент" @close="comp.open = false">
      <p class="text-sm text-slate-500">Продлевает PREMIUM и отправляет клиенту письмо с извинением. В журнал попадёт причина.</p>
      <label class="label mt-3" for="comp-days">На сколько дней</label>
      <input id="comp-days" v-model.number="comp.days" type="number" min="1" max="90" class="input text-sm">
      <label class="label mt-3" for="comp-reason">Причина</label>
      <input id="comp-reason" v-model="comp.reason" class="input text-sm" maxlength="200" placeholder="Например: сбой печати 20 ноября">
      <div class="flex justify-end gap-2 mt-4">
        <button class="btn-ghost !py-2 !px-3 text-sm" @click="comp.open = false">Отмена</button>
        <button class="btn-primary !py-2 !px-4 text-sm" :disabled="comp.busy" @click="doCompensate">{{ comp.busy ? 'Продлеваем…' : 'Продлить и уведомить' }}</button>
      </div>
    </Modal>
  </div>
</template>
