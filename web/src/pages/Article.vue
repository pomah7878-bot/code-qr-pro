<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import PublicShell from '../components/PublicShell.vue';
import ArticleBody from '../components/ArticleBody.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { applySeo } from '../lib/seo.js';

const route = useRoute();
const article = ref(null);
const related = ref([]);
const loading = ref(true);
const error = ref('');
const copied = ref(false);

const tags = computed(() => (article.value?.tags || []).map((t) => String(t).trim()).filter(Boolean));
const fmtDate = (v) => {
  const s = String(v || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
};

async function load(slug) {
  loading.value = true;
  error.value = '';
  article.value = null;
  try {
    const [one, list] = await Promise.all([
      fetch('/api/public/articles/' + encodeURIComponent(slug), { headers: { Accept: 'application/json' } }),
      fetch('/api/public/articles', { headers: { Accept: 'application/json' } }).catch(() => null)
    ]);
    if (one.status === 404) {
      error.value = 'not-found';
      loading.value = false;
      return;
    }
    if (!one.ok) throw new Error('Не удалось загрузить статью');
    const data = await one.json();
    article.value = data.article || null;
    if (!article.value) {
      error.value = 'not-found';
      loading.value = false;
      return;
    }
    let all = [];
    if (list && list.ok) {
      const payload = await list.json();
      all = Array.isArray(payload.articles) ? payload.articles : [];
    }
    const first = (article.value.tags || [])[0] || '';
    related.value = all
      .filter((a) => a.slug !== article.value.slug)
      .sort((a, b) => {
        const sa = (a.tags || []).includes(first) ? 1 : 0;
        const sb = (b.tags || []).includes(first) ? 1 : 0;
        return sb - sa;
      })
      .slice(0, 3);
    applySeo('/articles/' + article.value.slug, {
      title: article.value.title + ' — CODE QR PRO',
      description: article.value.summary || 'Статья базы знаний CODE QR PRO.'
    });
  } catch (e) {
    error.value = e.message || 'Не удалось загрузить статью';
  } finally {
    loading.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1800);
  } catch { /* clipboard может быть недоступен */ }
}

watch(() => route.params.slug, (slug) => {
  if (slug) load(slug);
});
onMounted(() => {
  if (route.params.slug) load(route.params.slug);
});
</script>

<template>
  <PublicShell narrow>
    <router-link to="/articles" class="text-sm text-slate-500 hover:text-brand-400">← Все статьи</router-link>

    <div v-if="loading" class="mt-6 space-y-3">
      <div class="h-8 w-2/3 rounded bg-slate-200/70 dark:bg-white/10 animate-pulse"></div>
      <div class="h-4 w-1/2 rounded bg-slate-200/70 dark:bg-white/10 animate-pulse"></div>
      <div class="glass rounded-2xl h-64 mt-6 animate-pulse"></div>
    </div>

    <div v-else-if="error === 'not-found'" class="mt-8 glass rounded-2xl p-8 text-center">
      <div class="font-display font-bold text-xl">Статья не найдена</div>
      <p class="text-sm text-slate-500 mt-2">Возможно, она переименована или снята с публикации.</p>
      <router-link to="/articles" class="btn-primary !py-2 !px-4 text-sm mt-5 inline-flex">К списку статей</router-link>
    </div>

    <div v-else-if="error" class="mt-8 glass rounded-2xl p-6 text-sm text-red-500">
      {{ error }}
      <button class="btn-ghost !py-2 text-sm ml-3" @click="load(route.params.slug)">Повторить</button>
    </div>

    <article v-else-if="article" class="mt-4">
      <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span v-for="t in tags.slice(0, 4)" :key="t" class="chip-soon !text-[9px]">{{ t }}</span>
        <span v-if="fmtDate(article.updated_at)">обновлено {{ fmtDate(article.updated_at) }}</span>
      </div>
      <h1 class="font-display font-extrabold text-2xl sm:text-4xl mt-3 leading-tight">{{ article.title }}</h1>
      <p v-if="article.summary" class="text-slate-500 mt-3 text-lg">{{ article.summary }}</p>

      <div class="mt-6 glass rounded-2xl p-5 sm:p-8">
        <ArticleBody :text="article.body" />
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-2">
        <button class="btn-ghost !py-2 !px-4 text-sm" @click="copyLink">{{ copied ? 'Ссылка скопирована' : 'Скопировать ссылку' }}</button>
        <router-link to="/app/assistant" class="btn-primary !py-2 !px-4 text-sm">Спросить AI-помощника</router-link>
        <router-link to="/faq" class="btn-ghost !py-2 !px-4 text-sm">Частые вопросы</router-link>
      </div>

      <div v-if="related.length" class="mt-10">
        <div class="font-display font-semibold mb-3">Читайте также</div>
        <div class="grid sm:grid-cols-3 gap-3">
          <router-link
            v-for="a in related" :key="a.slug" :to="'/articles/' + a.slug"
            class="glass rounded-2xl p-4 transition hover:border-brand-500/40 border border-transparent"
          >
            <div class="font-semibold text-sm leading-snug">{{ a.title }}</div>
            <p class="text-xs text-slate-500 mt-1.5 line-clamp-2">{{ a.summary }}</p>
          </router-link>
        </div>
      </div>
    </article>

    <div class="mt-10 flex items-center gap-2 text-xs text-slate-500">
      <BrandIcon name="info" :size="15" />
      Данные о маркировке и статусах кодов предоставляются открытыми источниками и не заменяют официальную проверку в ГИС МТ.
    </div>
  </PublicShell>
</template>
