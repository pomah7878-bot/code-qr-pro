<template>
  <div class="max-w-2xl mx-auto px-4 py-24 text-center">
    <div class="text-6xl mb-4">🔎</div>
    <h1 class="font-display font-extrabold text-3xl mb-3">Страница не найдена</h1>
    <p class="text-slate-500 mb-6">Возможно, ссылка устарела или в адресе опечатка.</p>
    <div class="flex flex-wrap justify-center gap-3">
      <router-link to="/" class="btn-primary">На главную</router-link>
      <router-link to="/app" class="btn-ghost">В кабинет</router-link>
    </div>
  </div>
</template>
