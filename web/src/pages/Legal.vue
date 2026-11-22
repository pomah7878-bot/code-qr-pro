<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import PublicShell from '../components/PublicShell.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { LEGAL, LEGAL_DOCS, LEGAL_DOC_LIST } from '../content/legal.js';
import { applySeo } from '../lib/seo.js';
import { api } from '../api.js';
import { onPlansChanged } from '../lib/plans-sync.js';

const props = defineProps({
  slug: { type: String, required: true }
});

const doc = computed(() => LEGAL_DOCS[props.slug] || LEGAL_DOCS.offer);
const isCurrent = (s) => s === props.slug;
const sectionId = (i) => 'section-' + (i + 1);

const plans = ref([]);
const plansSyncOff = ref(null);
const offerPlans = computed(() => (plans.value || []).filter((p) => p.id !== 'archive' && p.active !== false));
const money = (n) => Number(n || 0).toLocaleString('ru');
const planFormats = (p) => (Array.isArray(p.formats) ? p.formats : []).map((x) => String(x).toUpperCase()).join(', ');
const planFunctions = (p) => {
  const f = p.features || {};
  const out = [];
  if (f.labelEditor) out.push('редактор этикеток');
  if (f.printBridge) out.push('Print Bridge');
  if (f.templates) out.push('шаблоны');
  if (f.apiAccess) out.push('API');
  if (f.aiAssistant) out.push('AI-помощник');
  if (f.employees > 1) out.push(`до ${f.employees} сотрудников`);
  return out.join(', ');
};
const planOps = (p) => {
  const ops = Number(p.opsPerPeriod || 0).toLocaleString('ru');
  return p.dailyOps ? `${ops} (до ${Number(p.dailyOps).toLocaleString('ru')}/день)` : ops;
};
async function loadPlans() {
  try {
    const d = await api.plans();
    plans.value = d.list || d.plans || [];
  } catch { /* таблица останется скрытой */ }
}

function printDoc() { window.print(); }

function sync() {
  const d = LEGAL_DOCS[props.slug] || LEGAL_DOCS.offer;
  applySeo('/' + d.slug, {
    title: d.title + ' — CODE QR PRO',
    description: d.short
  });
}
onMounted(async () => {
  sync();
  if (props.slug === 'offer') await loadPlans();
  plansSyncOff.value = onPlansChanged(loadPlans);
});
onUnmounted(() => { plansSyncOff.value?.(); });
watch(() => props.slug, async () => {
  sync();
  if (props.slug === 'offer') await loadPlans();
});
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
            <div v-if="props.slug === 'offer' && s.title.startsWith('4.') && offerPlans.length" class="mt-4 overflow-x-auto">
              <table class="w-full min-w-[760px] text-xs sm:text-sm border-collapse">
                <thead>
                  <tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
                    <th class="py-2 pr-3">Тариф</th>
                    <th class="py-2 pr-3 whitespace-nowrap">Цена/мес</th>
                    <th class="py-2 pr-3 whitespace-nowrap">Цена/год</th>
                    <th class="py-2 pr-3">Операции</th>
                    <th class="py-2 pr-3">Проверки</th>
                    <th class="py-2 pr-3">Экспорт</th>
                    <th class="py-2 pr-3">API</th>
                    <th class="py-2 pr-3">История</th>
                    <th class="py-2 pr-3">Архив</th>
                    <th class="py-2">Функции</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in offerPlans" :key="p.id" class="border-b border-slate-100 dark:border-white/5 last:border-0 align-top">
                    <td class="py-2 pr-3 font-semibold whitespace-nowrap">{{ p.title }}</td>
                    <td class="py-2 pr-3 whitespace-nowrap">{{ money(p.priceMonthly) }} ₽</td>
                    <td class="py-2 pr-3 whitespace-nowrap">{{ money(p.priceYearly) }} ₽</td>
                    <td class="py-2 pr-3">{{ planOps(p) }}</td>
                    <td class="py-2 pr-3">{{ p.checksPerPeriod > 0 ? Number(p.checksPerPeriod).toLocaleString('ru') : '—' }}</td>
                    <td class="py-2 pr-3">{{ Number(p.exportsPerPeriod || 0).toLocaleString('ru') }}</td>
                    <td class="py-2 pr-3">{{ Number(p.apiCallsPerPeriod || 0).toLocaleString('ru') }}</td>
                    <td class="py-2 pr-3 whitespace-nowrap">{{ p.historyDays }} дн.</td>
                    <td class="py-2 pr-3 whitespace-nowrap">{{ Number(p.archiveMb || 0).toLocaleString('ru') }} МБ</td>
                    <td class="py-2">{{ [planFormats(p), planFunctions(p)].filter(Boolean).join(' · ') || '—' }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="text-[11px] text-slate-500 mt-2">Цены и лимиты обновляются автоматически из настроек тарифов. Генерация, расширенные проверки, экспорт и API учитываются раздельно. Годовая оплата = 10 месячных платежей (2 месяца в подарок).</p>
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
