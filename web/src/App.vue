<script setup>
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, toggleTheme } from './store.js';
import { api } from './api.js';
import HelpCenter from './components/HelpCenter.vue';
import BrandIcon from './components/BrandIcon.vue';

const router = useRouter();
const menuOpen = ref(false);
const pwd = reactive({ current: '', next: '', repeat: '', busy: false, error: '' });
const needChange = computed(() => Boolean(store.user?.mustChangePassword));

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
      <div class="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <span>Режим просмотра от имени клиента — только чтение, изменения заблокированы.</span>
        <button class="rounded-lg border border-amber-500/50 px-3 py-1 text-xs font-medium" @click="exitViewMode">Выйти из просмотра</button>
      </div>
    </div>
    <header class="sticky top-0 z-40 glass border-x-0 border-t-0 rounded-none">
      <div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
        <router-link to="/" class="flex items-center gap-2 font-display font-extrabold tracking-wide shrink-0" @click="menuOpen = false">
          <img src="/qr-icon.svg" alt="CODE QR PRO" class="w-8 h-8 shrink-0">
          <span class="text-slate-900 dark:text-white whitespace-nowrap text-sm sm:text-base">CODE QR <span class="text-violet-600 dark:text-violet-400">PRO</span></span>
        </router-link>

        <!-- desktop nav -->
        <nav class="hidden md:flex items-center gap-2">
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
        <div class="max-w-6xl mx-auto px-4 py-2 text-xs text-amber-700 dark:text-amber-300 flex flex-wrap items-center gap-2">
          <span>Для доступа к админке включите двухфакторную аутентификацию.</span>
          <router-link to="/app/security" class="font-semibold underline" @click="menuOpen = false">Настроить 2FA →</router-link>
        </div>
      </div>

      <!-- mobile dropdown menu -->
      <transition name="menu">
        <div v-if="menuOpen" class="md:hidden border-t border-slate-200 dark:border-white/10 px-4 py-3 space-y-1 bg-white/95 dark:bg-ink-950/95 backdrop-blur-xl">
          <template v-if="store.user">
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app')"><BrandIcon name="overview" :size="18" class="inline-block mr-2 -mt-0.5" />Кабинет</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/history')"><BrandIcon name="history" :size="18" class="inline-block mr-2 -mt-0.5" />История</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/generate')"><BrandIcon name="generate" :size="18" class="inline-block mr-2 -mt-0.5" />Генерация</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/labels')"><BrandIcon name="label" :size="18" class="inline-block mr-2 -mt-0.5" />Этикетки</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/sets')"><BrandIcon name="set" :size="18" class="inline-block mr-2 -mt-0.5" />Наборы</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/reprint')"><BrandIcon name="print" :size="18" class="inline-block mr-2 -mt-0.5" />Повторная печать</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/billing')"><BrandIcon name="billing" :size="18" class="inline-block mr-2 -mt-0.5" />Подписка</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/app/security')"><BrandIcon name="lock" :size="18" class="inline-block mr-2 -mt-0.5" />Безопасность</button>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium text-red-500" @click="logout">Выйти</button>
          </template>
          <template v-else>
            <button class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 font-medium" @click="go('/login')">Войти</button>
            <button class="w-full text-left px-4 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-accent-500 text-white font-semibold" @click="go('/register')">Начать бесплатно →</button>
          </template>
        </div>
      </transition>
    </header>
    <main class="flex-1"><router-view /></main>
    <footer class="border-t border-slate-200 dark:border-white/10 py-6 px-4 text-center text-xs sm:text-sm text-slate-500">
      CODE QR PRO · code-qr.stockcity.ru · GS1 DataMatrix и маркировка «Честный ЗНАК»
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
    <HelpCenter />
  </div>
</template>

<style scoped>
.menu-enter-active, .menu-leave-active { transition: opacity .2s ease, transform .2s ease; }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
