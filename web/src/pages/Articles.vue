<script setup>
import { ref, computed, onMounted } from 'vue';
import PublicShell from '../components/PublicShell.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { applySeo } from '../lib/seo.js';

const articles = ref([]);
const loading = ref(true);
const error = ref('');
const query = ref('');
const tag = ref('');

const allTags = computed(() => {
  const counts = new Map();
  for (const a of articles.value) {
    for (const t of (a.tags || [])) {
      const tag = String(t).trim();
      if (!/^[а-яa-zё][а-яa-zё \-]{2,}$/i.test(tag)) continue; // без чисел, кодов ошибок и коротких аббревиатур
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .slice(0, 12)
    .map(([tag]) => tag);
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return articles.value.filter((a) => {
    if (tag.value && !(a.tags || []).includes(tag.value)) return false;
    if (!q) return true;
    return `${a.title} ${a.summary} ${(a.tags || []).join(' ')}`.toLowerCase().includes(q);
  });
});

const fmtDate = (v) => {
  const s = String(v || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
};
const firstTag = (a) => (a.tags || [])[0] || '';

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch('/api/public/articles', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Не удалось загрузить статьи');
    const data = await res.json();
    articles.value = Array.isArray(data.articles) ? data.articles : [];
  } catch (e) {
    error.value = e.message || 'Не удалось загрузить статьи';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  applySeo('/articles');
  load();
});
</script>

<template>
  <PublicShell>
    <div class="max-w-[1000px]">
      <div class="text-xs font-semibold uppercase tracking-wider text-brand-400">База знаний</div>
      <h1 class="font-display font-extrabold text-3xl sm:text-4xl mt-2">Статьи о маркировке и печати</h1>
      <p class="text-slate-500 mt-3 max-w-[760px]">
        Инструкции по GS1 DataMatrix, «Честному ЗНАКу», этикеткам, повторной печати, API и тарифам.
        Если ответа нет — спросите AI-помощника или напишите в поддержку.
      </p>

      <div class="mt-6 flex flex-col sm:flex-row gap-2">
        <div class="relative flex-1">
          <BrandIcon name="search" :size="17" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input v-model="query" class="input !pl-10 !py-2.5" type="search" placeholder="Поиск по статьям: DataMatrix, лимиты, PDF…" />
        </div>
        <button v-if="query || tag" class="btn-ghost !py-2.5 text-sm" @click="query = ''; tag = ''">Сбросить</button>
      </div>

      <div v-if="allTags.length" class="mt-3 flex flex-wrap gap-1.5">
        <button
          class="px-3 py-1.5 rounded-full text-xs border transition"
          :class="!tag ? 'bg-brand-500/15 border-brand-500/40 text-brand-400 font-semibold' : 'border-slate-200 dark:border-white/10 text-slate-500 hover:border-slate-300'"
          @click="tag = ''"
        >Все</button>
        <button
          v-for="t in allTags" :key="t"
          class="px-3 py-1.5 rounded-full text-xs border transition"
          :class="tag === t ? 'bg-brand-500/15 border-brand-500/40 text-brand-400 font-semibold' : 'border-slate-200 dark:border-white/10 text-slate-500 hover:border-slate-300'"
          @click="tag = tag === t ? '' : t"
        >{{ t }}</button>
      </div>

      <div v-if="loading" class="mt-8 grid sm:grid-cols-2 gap-3">
        <div v-for="i in 4" :key="i" class="glass rounded-2xl h-36 animate-pulse"></div>
      </div>

      <div v-else-if="error" class="mt-8 glass rounded-2xl p-6 text-sm text-red-500">
        {{ error }}
        <button class="btn-ghost !py-2 text-sm ml-3" @click="load">Повторить</button>
      </div>

      <div v-else-if="!filtered.length" class="mt-8 glass rounded-2xl p-8 text-center">
        <div class="font-semibold">Ничего не нашлось</div>
        <p class="text-sm text-slate-500 mt-1">Попробуйте другой запрос или задайте вопрос AI-помощнику.</p>
        <router-link to="/app/assistant" class="btn-primary !py-2 !px-4 text-sm mt-4 inline-flex">Спросить AI-помощника</router-link>
      </div>

      <div v-else class="mt-8 grid sm:grid-cols-2 gap-3">
        <router-link
          v-for="a in filtered" :key="a.slug"
          :to="'/articles/' + a.slug"
          class="glass rounded-2xl p-5 transition hover:border-brand-500/40 border border-transparent flex flex-col"
        >
          <div class="flex items-center gap-2 text-[11px] text-slate-500">
            <span v-if="firstTag(a)" class="chip-soon !text-[9px]">{{ firstTag(a) }}</span>
            <span v-if="fmtDate(a.updated_at)">обновлено {{ fmtDate(a.updated_at) }}</span>
          </div>
          <div class="font-display font-semibold text-[15px] mt-2 leading-snug">{{ a.title }}</div>
          <p class="text-sm text-slate-500 mt-2 line-clamp-3 flex-1">{{ a.summary }}</p>
          <div class="text-sm text-brand-400 font-medium mt-3">Читать →</div>
        </router-link>
      </div>

      <div class="mt-10 glass rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div class="font-display font-semibold">Не нашли ответ?</div>
          <p class="text-sm text-slate-500 mt-1">AI-помощник знает базу знаний и подскажет по шагам, а сложный вопрос передаст администратору.</p>
        </div>
        <div class="flex gap-2 shrink-0">
          <router-link to="/faq" class="btn-ghost !py-2 !px-4 text-sm">Частые вопросы</router-link>
          <router-link to="/app/assistant" class="btn-primary !py-2 !px-4 text-sm">Спросить AI</router-link>
        </div>
      </div>
    </div>
  </PublicShell>
</template>
