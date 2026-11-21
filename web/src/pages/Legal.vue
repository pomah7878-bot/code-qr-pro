<script setup>
import { computed, onMounted, watch } from 'vue';
import PublicShell from '../components/PublicShell.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { LEGAL, LEGAL_DOCS, LEGAL_DOC_LIST } from '../content/legal.js';
import { applySeo } from '../lib/seo.js';

const props = defineProps({
  slug: { type: String, required: true }
});

const doc = computed(() => LEGAL_DOCS[props.slug] || LEGAL_DOCS.offer);
const isCurrent = (s) => s === props.slug;
const sectionId = (i) => 'section-' + (i + 1);

function printDoc() { window.print(); }

function sync() {
  const d = LEGAL_DOCS[props.slug] || LEGAL_DOCS.offer;
  applySeo('/' + d.slug, {
    title: d.title + ' — CODE QR PRO',
    description: d.short
  });
}
onMounted(sync);
watch(() => props.slug, sync);
</script>

<template>
  <PublicShell>
    <div class="flex flex-wrap gap-2 mb-5">
      <router-link
        v-for="d in LEGAL_DOC_LIST" :key="d.slug" :to="d.to"
        class="px-3 py-1.5 rounded-full text-xs border transition"
        :class="isCurrent(d.slug) ? 'bg-brand-500/15 border-brand-500/40 text-brand-400 font-semibold' : 'border-slate-200 dark:border-white/10 text-slate-500 hover:border-slate-300'"
      >{{ d.title }}</router-link>
    </div>

    <div class="grid lg:grid-cols-[260px_1fr] gap-8 items-start">
      <aside class="lg:sticky lg:top-24 order-2 lg:order-1">
        <div class="glass rounded-2xl p-4">
          <div class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Содержание</div>
          <nav class="space-y-1 max-h-[60vh] overflow-auto pr-1">
            <a
              v-for="(s, i) in doc.sections" :key="i" :href="'#' + sectionId(i)"
              class="block text-[13px] text-slate-500 hover:text-brand-400 leading-snug py-1"
            >{{ s.title }}</a>
          </nav>
          <button class="btn-ghost !py-2 !px-3 text-xs w-full mt-3" @click="printDoc">Печать / PDF</button>
        </div>
        <div class="text-[11px] text-slate-500 mt-3 px-1">
          {{ LEGAL.operator.label }}<br>
          {{ LEGAL.operator.status }}<br>
          ИНН {{ LEGAL.operator.inn }}<br>
          <a :href="'mailto:' + LEGAL.email" class="text-brand-400">{{ LEGAL.email }}</a>
        </div>
      </aside>

      <article class="order-1 lg:order-2 min-w-0">
        <h1 class="font-display font-extrabold text-2xl sm:text-4xl leading-tight">{{ doc.title }}</h1>
        <div class="text-sm text-slate-500 mt-2">{{ doc.version }} · {{ LEGAL.domain }}</div>
        <p class="text-slate-500 mt-4 max-w-[760px]">{{ doc.short }}</p>

        <div class="mt-6 glass rounded-2xl p-5 sm:p-8 space-y-8">
          <section v-for="(s, i) in doc.sections" :key="i" :id="sectionId(i)" class="scroll-mt-24">
            <h2 class="font-display font-semibold text-lg sm:text-xl mb-3">{{ s.title }}</h2>
            <div class="space-y-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
              <p v-for="(p, j) in s.paragraphs" :key="j" class="whitespace-pre-wrap">{{ p }}</p>
            </div>
          </section>
        </div>

        <div class="mt-6 flex flex-wrap items-center gap-2 text-sm">
          <router-link v-for="d in LEGAL_DOC_LIST.filter((x) => x.slug !== doc.slug)" :key="d.slug" :to="d.to" class="btn-ghost !py-2 !px-4 text-sm">
            {{ d.title }}
          </router-link>
          <router-link to="/faq" class="btn-ghost !py-2 !px-4 text-sm">Частые вопросы</router-link>
          <a :href="'mailto:' + LEGAL.email" class="btn-primary !py-2 !px-4 text-sm">Написать в поддержку</a>
        </div>

        <div class="mt-8 flex items-start gap-2 text-xs text-slate-500">
          <BrandIcon name="info" :size="15" class="mt-0.5 shrink-0" />
          <span>Документ опубликован в электронном виде и доступен по постоянному адресу. Актуальная редакция всегда на этой странице.</span>
        </div>
      </article>
    </div>
  </PublicShell>
</template>
