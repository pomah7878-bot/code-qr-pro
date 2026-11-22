<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, toggleTheme } from './store.js';
import { api } from './api.js';
import { openAssistant } from './lib/assistant-ui.js';
import AssistantWidget from './components/AssistantWidget.vue';
import BrandIcon from './components/BrandIcon.vue';
import SiteFooter from './components/SiteFooter.vue';
import { trackPageview } from './lib/analytics.js';

const router = useRouter();
const route = useRoute();
const menuOpen = ref(false);
const year = new Date().getFullYear();
const showAssistant = computed(() => Boolean(store.user) && route.path.startsWith('/app'));
const isPublicPage = computed(() => !route.path.startsWith('/app'));
onMounted(() => trackPageview(route.fullPath));
watch(() => route.fullPath, (to, from) => { if (to !== from) trackPageview(to); });
const pwd = reactive({ current: '', next: '', repeat: '', busy: false, error: '' });
const needChange = computed(() => Boolean(store.user?.mustChangePassword));

// Уведомление админу о новом обращении в поддержку: бейдж + всплывающая карточка
const supportToast = ref(null);
let supportPoll = 0;
let supportToastTimer = 0;
let prevSupportOpen = null;

async function pollSupport() {
  if (store.user?.role !== 'admin') {
    store.supportOpen = 0;
    return;
  }
  try {
    const r = await api.adminTicketsCount();
    const now = Number(r.open) || 0;
    if (prevSupportOpen !== null && now > prevSupportOpen) {
      const latest = r.latest || {};
      supportToast.value = {
        id: latest.id,
        subject: latest.subject || 'Новое обращение',
        email: latest.email || ''
      };
      window.clearTimeout(supportToastTimer);
      supportToastTimer = window.setTimeout(() => { supportToast.value = null; }, 15000);
    }
    prevSupportOpen = now;
    store.supportOpen = now;
  } catch { /* уведомление не критично */ }
}

onMounted(() => {
  pollSupport();
  supportPoll = window.setInterval(pollSupport, 30000);
});
onUnmounted(() => {
  window.clearInterval(supportPoll);
  window.clearTimeout(supportToastTimer);
});
watch(() => store.user?.role, (role) => {
  if (role === 'admin') pollSupport();
  else {
    prevSupportOpen = null;
    store.supportOpen = 0;
    supportToast.value = null;
  }
});

async function logout() { await store.logout(); menuOpen.value = false; router.push('/'); }
async function exitViewMode() {
  try { await api.exitViewMode(); } catch { /* всё равно перезагрузимся */ }
  window.location.href = '/app';
}
function go(path) { menuOpen.value = false; router.push(path); }

async function changePassword() {
  pwd.error = '';
  if (pwd.next.length < 8) { pwd.error = 'Новый пароль — минимум 8 символов'; return; }
  if (pwd.next !== pwd.repeat) { pwd.error = 'Пароли не совпадают'; return; }
  pwd.busy = true;
  try {
    await api.changePassword({ currentPassword: pwd.current, newPassword: pwd.next });
    pwd.current = '';
    pwd.next = '';
    pwd.repeat = '';
    await store.load();
  } catch (e) {
    pwd.error = e.message;
  } finally {
    pwd.busy = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <div v-if="store.impersonated" class="sticky top-0 z-50 bg-amber-500/15 border-b border-amber-500/40 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
      <div class="max-w-[1680px] mx-auto flex flex-wrap items-center justify-between gap-2">
        <span>Режим просмотра от имени клиента — только чтение, изменения заблокированы.</span>
        <button class="rounded-lg border border-amber-500/50 px-3 py-1 text-xs font-medium" @click="exitViewMode">Выйти из просмотра</button>
      </div>
    </div>
    <header class="sticky top-0 z-40 glass border-x-0 border-t-0 rounded-none">
      <div class="max-w-[1680px] mx-auto px-4 h-16 flex items-center justify-between gap-3">
        <router-link to="/" class="flex items-center gap-2 font-display font-extrabold tracking-wide shrink-0" @click="menuOpen = false">
          <img src="/qr-icon.svg" alt="CODE QR PRO" class="w-8 h-8 shrink-0">
          <span class="text-slate-900 dark:text-white whitespace-nowrap text-sm sm:text-base">CODE QR <span class="text-violet-600 dark:text-violet-400">PRO</span></span>
        </router-link>

        <!-- desktop nav -->
        <nav class="hidden md:flex items-center gap-2">
          <template v-if="isPublicPage">
            <router-link to="/pricing" class="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5">Тарифы</router-link>
            <router-link to="/articles" class="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5">Статьи</router-link>
            <router-link to="/check" class="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5">Проверить код</router-link>
            <router-link to="/faq" class="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5">Вопросы</router-link>
          </template>
          <button class="btn-ghost !px-3" @click="toggleTheme" title="Сменить тему">
            <BrandIcon name="moon" :size="18" class="dark:hidden" /><BrandIcon name="sun" :size="18" class="hidden dark:inline" />
          </button>
          <template v-if="store.user">
            <router-link to="/app" class="btn-ghost">Кабинет</router-link>
            <button class="btn-ghost" @click="logout">Выйти</button>
          </template>
          <template v-else>
            <router-link to="/login" class="btn-ghost">Войти</router-link>
            <router-link to="/register" class="btn-primary !py-2.5">Начать бесплатно</router-link>
          </template>
        </nav>

        <!-- mobile controls -->
        <div class="flex md:hidden items-center gap-1.5">
          <button class="btn-ghost !px-2.5 !py-2" @click="toggleTheme" title="Сменить тему">
            <BrandIcon name="moon" :size="18" class="dark:hidden" /><BrandIcon name="sun" :size="18" class="hidden dark:inline" />
          </button>
          <router-link v-if="!store.user" to="/register" class="btn-primary !py-2 !px-3 text-sm whitespace-nowrap">Начать</router-link>
          <button class="btn-ghost !px-2.5 !py-2" @click="menuOpen = !menuOpen" :aria-label="menuOpen ? 'Закрыть меню' : 'Открыть меню'">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path v-if="!menuOpen" d="M4 7h16M4 12h16M4 17h16"/>
              <path v-else d="M6 6l12 12M18 6L6 18"/>
            </svg>
          </button>
        </div>
      </div>

      <div v-if="store.user && ['admin', 'support'].includes(store.user.role) && !store.user.twoFactorEnabled" class="border-t border-amber-500/30 bg-amber-500/10">
        <div class="max-w-[1680px] mx-auto px-4 py-2 text-xs text-amber-700 dark:text-amber-300 flex flex-wrap items-center gap-2">
          <span>Для доступа к админке включите двухфакторную аутентификацию.</span>
          <router-link to="/app/security" class="font-semibold underline" @click="menuOpen = false">Настроить 2FA →</router-link>
        </div>
      </div>

      <!-- mobile dropdown menu -->
      <transition name="menu">
        <div v-if="menuOpen" class="md:hidden border-t border-slate-200 dark:border-white/10 px-4 py-3 space-y-1 bg-white/95 dark:bg-ink-950/95 backdrop-blur-xl">
          <template v-if="isPublicPage">
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/pricing')">Тарифы</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/articles')">Статьи</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/check')">Проверить код ЧЗ</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/faq')">Частые вопросы</button>
            <div class="h-px bg-slate-200 dark:bg-white/10 my-1"></div>
          </template>
          <template v-if="store.user">
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app')"><BrandIcon name="overview" :size="18" class="inline-block mr-2 -mt-0.5" />Кабинет</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/history')"><BrandIcon name="history" :size="18" class="inline-block mr-2 -mt-0.5" />История</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/generate')"><BrandIcon name="generate" :size="18" class="inline-block mr-2 -mt-0.5" />Генерация</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/labels')"><BrandIcon name="label" :size="18" class="inline-block mr-2 -mt-0.5" />Этикетки</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/sets')"><BrandIcon name="set" :size="18" class="inline-block mr-2 -mt-0.5" />Наборы</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/reprint')"><BrandIcon name="print" :size="18" class="inline-block mr-2 -mt-0.5" />Повторная печать</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/billing')"><BrandIcon name="billing" :size="18" class="inline-block mr-2 -mt-0.5" />Подписка</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/security')"><BrandIcon name="lock" :size="18" class="inline-block mr-2 -mt-0.5" />Безопасность</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/help')"><BrandIcon name="help" :size="18" class="inline-block mr-2 -mt-0.5" />Помощь</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium text-brand-400" @click="menuOpen = false; openAssistant()"><BrandIcon name="ai" :size="18" class="inline-block mr-2 -mt-0.5" />AI-помощник</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium text-red-500" @click="logout">Выйти</button>
          </template>
          <template v-else>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/login')">Войти</button>
            <button class="w-full text-left px-4 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-accent-500 text-white font-semibold" @click="go('/register')">Начать бесплатно →</button>
          </template>
        </div>
      </transition>
    </header>
    <main class="flex-1" :class="showAssistant ? 'pb-24 lg:pb-0' : ''"><router-view /></main>
    <SiteFooter v-if="isPublicPage" />
    <footer v-else data-nosnippet class="border-t border-slate-200 dark:border-white/10 py-6 px-4 text-xs sm:text-sm text-slate-500">
      <div class="max-w-[1200px] mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>© {{ year }} CODE QR PRO. Сервис не является официальным сервисом «Честного ЗНАКа».</div>
        <router-link to="/offer" rel="nofollow" class="hover:text-brand-400 whitespace-nowrap">Реквизиты и документы →</router-link>
      </div>
    </footer>

    <!-- Принудительная смена временного пароля -->
    <Teleport to="body">
      <div v-if="needChange" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"></div>
        <div class="relative glass rounded-2xl p-6 w-full max-w-md" role="dialog" aria-modal="true" aria-label="Смена временного пароля">
          <h2 class="font-display font-bold text-xl">Смените временный пароль</h2>
          <p class="text-sm text-slate-500 mt-1">Администратор выдал временный пароль. Придумайте свой — без него кабинет недоступен.</p>
          <div class="space-y-3 mt-4">
            <div>
              <label class="label !text-xs" for="pwd-current">Текущий (временный) пароль</label>
              <input id="pwd-current" v-model="pwd.current" type="password" class="input !py-2 text-sm" autocomplete="current-password">
            </div>
            <div>
              <label class="label !text-xs" for="pwd-next">Новый пароль</label>
              <input id="pwd-next" v-model="pwd.next" type="password" class="input !py-2 text-sm" autocomplete="new-password">
            </div>
            <div>
              <label class="label !text-xs" for="pwd-repeat">Повторите новый пароль</label>
              <input id="pwd-repeat" v-model="pwd.repeat" type="password" class="input !py-2 text-sm" autocomplete="new-password">
            </div>
          </div>
          <p v-if="pwd.error" class="text-sm text-red-500 mt-3">{{ pwd.error }}</p>
          <button class="btn-primary w-full mt-4" :disabled="pwd.busy" @click="changePassword">{{ pwd.busy ? 'Сохраняем…' : 'Сменить пароль' }}</button>
        </div>
      </div>
    </Teleport>
    <AssistantWidget v-if="showAssistant" />

    <!-- Уведомление админу о новом обращении в поддержку -->
    <Teleport to="body">
      <transition name="sup-toast">
        <div v-if="supportToast" class="fixed top-20 right-4 z-[90] w-[min(340px,calc(100vw-2rem))]">
          <div class="glass rounded-2xl p-4 border border-red-500/40 shadow-2xl">
            <div class="flex items-start gap-3">
              <span class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/15 text-red-400 flex-none">
                <BrandIcon name="help" :size="20" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold">Новое обращение в поддержку</div>
                <div class="text-xs text-slate-500 mt-0.5 truncate">
                  <span v-if="supportToast.email">{{ supportToast.email }}: </span>{{ supportToast.subject }}
                </div>
                <router-link to="/app/admin/support" class="inline-block mt-2 text-xs text-brand-400 underline" @click="supportToast = null">
                  Открыть обращение →
                </router-link>
              </div>
              <button class="text-slate-400 hover:text-slate-700 dark:hover:text-white flex-none" aria-label="Закрыть" @click="supportToast = null">
                <BrandIcon name="close" :size="16" />
              </button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.menu-enter-active, .menu-leave-active { transition: opacity .2s ease, transform .2s ease; }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-8px); }
.sup-toast-enter-active,
.sup-toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.sup-toast-enter-from,
.sup-toast-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
