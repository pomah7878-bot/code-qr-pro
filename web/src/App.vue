<script setup>
import { useRouter } from 'vue-router';
import { store, toggleTheme } from './store.js';
const router = useRouter();
async function logout() { await store.logout(); router.push('/'); }
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="sticky top-0 z-40 glass border-x-0 border-t-0 rounded-none">
      <div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <router-link to="/" class="flex items-center gap-2.5 font-display font-extrabold tracking-wide">
          <svg width="26" height="26" viewBox="0 0 22 22" class="shrink-0">
            <rect width="22" height="22" rx="3" fill="currentColor" opacity=".08"/>
            <g fill="currentColor">
              <rect x="3" y="3" width="2" height="16"/><rect x="3" y="17" width="16" height="2"/>
              <rect x="7" y="3" width="2" height="2"/><rect x="11" y="3" width="2" height="2"/><rect x="15" y="3" width="2" height="2"/>
              <rect x="17" y="7" width="2" height="2"/><rect x="17" y="11" width="2" height="2"/><rect x="17" y="15" width="2" height="2"/>
              <rect x="7" y="7" width="2" height="2"/><rect x="11" y="9" width="2" height="2"/><rect x="9" y="13" width="2" height="2"/><rect x="13" y="13" width="2" height="2"/>
            </g>
          </svg>
          <span>CODE QR <span class="grad-text">PRO</span></span>
        </router-link>
        <nav class="flex items-center gap-2">
          <button class="btn-ghost !px-3" @click="toggleTheme" title="Сменить тему">
            <span class="dark:hidden">🌙</span><span class="hidden dark:inline">☀️</span>
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
      </div>
    </header>
    <main class="flex-1"><router-view /></main>
    <footer class="border-t border-slate-200 dark:border-white/10 py-6 text-center text-sm text-slate-500">
      CODE QR PRO · code-qr.stockcity.ru · GS1 DataMatrix и маркировка «Честный ЗНАК»
    </footer>
  </div>
</template>
