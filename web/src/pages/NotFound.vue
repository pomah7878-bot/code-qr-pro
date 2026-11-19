<script setup>
import BrandIcon from '../components/BrandIcon.vue';
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-24 text-center">
    <div class="mb-5 flex justify-center"><span class="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20"><BrandIcon name="search" :size="34" /></span></div>
    <h1 class="font-display font-extrabold text-3xl mb-3">Страница не найдена</h1>
    <p class="text-slate-500 mb-6">Возможно, ссылка устарела или в адресе опечатка.</p>
    <div class="flex flex-wrap justify-center gap-3">
      <router-link to="/" class="btn-primary">На главную</router-link>
      <router-link to="/app" class="btn-ghost">В кабинет</router-link>
    </div>
  </div>
</template>
