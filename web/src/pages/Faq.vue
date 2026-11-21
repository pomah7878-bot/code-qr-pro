<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import PublicShell from '../components/PublicShell.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { FAQ_CATEGORIES, FAQ_ITEMS } from '../content/faq.js';
import { applySeo } from '../lib/seo.js';

const activeCat = ref('');
const query = ref('');
const open = ref('');

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return FAQ_ITEMS.filter((f) => {
    if (activeCat.value && f.cat !== activeCat.value) return false;
    if (!q) return true;
    return `${f.q} ${f.a}`.toLowerCase().includes(q);
  });
});

const catTitle = (id) => FAQ_CATEGORIES.find((c) => c.id === id)?.title || '';
const catCount = (id) => FAQ_ITEMS.filter((f) => f.cat === id).length;

let script = null;
onMounted(() => {
  applySeo('/faq');
  script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = 'faq-jsonld';
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  });
  document.head.appendChild(script);
});
onBeforeUnmount(() => {
  if (script && script.parentNode) script.parentNode.removeChild(script);
});
</script>

<template>
  <PublicShell>
    <div class="max-w-[1000px]">
      <div class="text-xs font-semibold uppercase tracking-wider text-brand-400">Ответы на вопросы</div>
      <h1 class="font-display font-extrabold text-3xl sm:text-4xl mt-2">Частые вопросы</h1>
      <p class="text-slate-500 mt-3 max-w-[760px]">
        Короткие ответы о маркировке, генерации, печати, тарифах, аккаунте и API.
        Подробные инструкции — в <router-link to="/articles" class="text-brand-400 font-medium">статьях</router-link>,
        а если ответа нет — спросите AI-помощника.
      </p>

      <div class="relative mt-6">
        <BrandIcon name="search" :size="17" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input v-model="query" class="input !pl-10 !py-2.5" type="search" placeholder="Поиск по вопросам: тариф, лимит, 2FA, DataMatrix…" />
      </div>

      <div class="mt-4 flex flex-wrap gap-1.5">
        <button
          class="px-3 py-1.5 rounded-full text-xs border transition"
          :class="!activeCat ? 'bg-brand-500/15 border-brand-500/40 text-brand-400 font-semibold' : 'border-slate-200 dark:border-white/10 text-slate-500'"
          @click="activeCat = ''"
        >Все ({{ FAQ_ITEMS.length }})</button>
        <button
          v-for="c in FAQ_CATEGORIES" :key="c.id"
          class="px-3 py-1.5 rounded-full text-xs border transition"
          :class="activeCat === c.id ? 'bg-brand-500/15 border-brand-500/40 text-brand-400 font-semibold' : 'border-slate-200 dark:border-white/10 text-slate-500'"
          @click="activeCat = activeCat === c.id ? '' : c.id"
        >{{ c.title }} ({{ catCount(c.id) }})</button>
      </div>

      <div v-if="!filtered.length" class="mt-8 glass rounded-2xl p-8 text-center">
        <div class="font-semibold">Ничего не нашлось</div>
        <p class="text-sm text-slate-500 mt-1">Попробуйте другой запрос или задайте вопрос AI-помощнику.</p>
        <router-link to="/app/assistant" class="btn-primary !py-2 !px-4 text-sm mt-4 inline-flex">Спросить AI</router-link>
      </div>

      <div v-else class="mt-6 space-y-2">
        <div
          v-for="(f, i) in filtered" :key="f.q + i"
          class="glass rounded-2xl overflow-hidden"
        >
          <button class="w-full flex items-start justify-between gap-4 p-4 sm:p-5 text-left" @click="open = open === f.q + i ? '' : f.q + i">
            <span>
              <span class="block font-semibold text-[15px] leading-snug">{{ f.q }}</span>
              <span class="block text-[11px] text-slate-500 mt-1">{{ catTitle(f.cat) }}</span>
            </span>
            <span class="text-brand-400 text-xl leading-none mt-0.5 shrink-0 transition-transform" :class="open === f.q + i ? 'rotate-45' : ''">+</span>
          </button>
          <div v-show="open === f.q + i" class="px-4 sm:px-5 pb-5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {{ f.a }}
            <div v-if="f.to || f.article" class="mt-3">
              <router-link
                :to="f.to || ('/articles/' + f.article)"
                class="text-brand-400 font-medium text-sm"
              >{{ f.to ? 'Подробнее →' : 'Подробная статья →' }}</router-link>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-10 glass rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div class="font-display font-semibold">Остались вопросы?</div>
          <p class="text-sm text-slate-500 mt-1">AI-помощник ответит мгновенно, а сложное обращение передаст администратору.</p>
        </div>
        <div class="flex gap-2 shrink-0">
          <router-link to="/articles" class="btn-ghost !py-2 !px-4 text-sm">Статьи</router-link>
          <router-link to="/app/assistant" class="btn-primary !py-2 !px-4 text-sm">Спросить AI</router-link>
        </div>
      </div>
    </div>
  </PublicShell>
</template>
