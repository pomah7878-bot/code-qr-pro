<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import LineChart from '../../components/admin/LineChart.vue';
import BrandIcon from '../../components/BrandIcon.vue';
import { api } from '../../api.js';

const days = ref(30);
const data = ref(null);
const loading = ref(true);
const error = ref('');
const metric = ref('visits');
let timer = 0;

const METRICS = {
  visits: { label: 'Визиты', color: '#818cf8' },
  pageviews: { label: 'Просмотры', color: '#22d3ee' },
  search: { label: 'Поисковый трафик', color: '#34d399' },
  bots: { label: 'Краулинг ботов', color: '#fbbf24' }
};

const series = computed(() => data.value?.series || []);
const kpi = computed(() => data.value?.kpi || {});
const sources = computed(() => data.value?.sources || []);
const pages = computed(() => data.value?.pages || []);
const queries = computed(() => data.value?.queries || []);
const wmQueries = computed(() => data.value?.webmasterQueries || []);
const engines = computed(() => data.value?.searchEngines || []);
const devices = computed(() => data.value?.devices || []);
const bots = computed(() => data.value?.bots || { total: 0, engines: [], pages: [] });
const seo = computed(() => data.value?.seo || { score: 0, checks: [], articles: 0, faq: 0, legal: 0 });
const webmaster = computed(() => data.value?.webmaster || {});
const wmSnapshot = computed(() => webmaster.value.snapshot || null);
const sevLabel = { FATAL: 'фатальная', CRITICAL: 'критичная', POSSIBLE_PROBLEM: 'возможная', RECOMMENDATION: 'рекомендация' };
const sevClass = { FATAL: 'text-red-500 border-red-500/30 bg-red-500/10', CRITICAL: 'text-orange-500 border-orange-500/30 bg-orange-500/10', POSSIBLE_PROBLEM: 'text-amber-500 border-amber-500/30 bg-amber-500/10', RECOMMENDATION: 'text-sky-500 border-sky-500/30 bg-sky-500/10' };

const maxSource = computed(() => Math.max(1, ...sources.value.map((s) => s.visits || 0)));
const maxDevice = computed(() => Math.max(1, ...devices.value.map((s) => s.visits || 0)));
const maxEngine = computed(() => Math.max(1, ...engines.value.map((s) => s.visits || 0)));

const trend = computed(() => {
  const rows = series.value;
  if (rows.length < 14) return null;
  const last7 = rows.slice(-7).reduce((s, r) => s + (r.visits || 0), 0);
  const prev7 = rows.slice(-14, -7).reduce((s, r) => s + (r.visits || 0), 0);
  if (!prev7 && !last7) return 0;
  if (!prev7) return 100;
  return Math.round(((last7 - prev7) / prev7) * 100);
});

const sourceLabel = (s) => s.label || s.source || '—';
const deviceLabel = (d) => ({ desktop: 'Компьютеры', mobile: 'Телефоны', tablet: 'Планшеты' })[d.device] || d.device || '—';
const engineLabel = (e) => e.label || e.engine || '—';
const botLabel = (e) => ({ yandex: 'Яндекс', google: 'Google', bing: 'Bing', mailru: 'Mail.ru', duckduckgo: 'DuckDuckGo', apple: 'Apple', baidu: 'Baidu', 'seo-tools': 'SEO-краулеры', other: 'Другие' })[e.engine] || e.engine || '—';
const fmt = (n) => Number(n || 0).toLocaleString('ru');
const fmtMoney = (n) => Number(n || 0).toLocaleString('ru') + ' ₽';
const fmtDate = (v) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '—';
};
const fmtDateTime = (v) => {
  if (!v) return '—';
  const d = new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const ctr = (q) => (q.impressions ? Math.round((q.clicks / q.impressions) * 1000) / 10 : 0);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.adminSeoDashboard(days.value);
    if (!wm.value.clientId && data.value?.webmaster?.clientId) wm.value.clientId = data.value.webmaster.clientId;
  } catch (e) {
    error.value = e.message || 'Не удалось загрузить аналитику';
  } finally {
    loading.value = false;
  }
}

const WEBMASTER_REDIRECT = 'https://code-qr.stockcity.ru/app/admin/analytics';
const wm = ref({ token: '', clientId: '', hostId: '', saving: false, syncing: false, message: '', error: '' });
const oauthUrl = computed(() => wm.value.clientId
  ? 'https://oauth.yandex.ru/authorize?response_type=token&client_id=' + encodeURIComponent(wm.value.clientId) + '&redirect_uri=' + encodeURIComponent(WEBMASTER_REDIRECT)
  : '');
async function saveWebmaster() {
  wm.value.saving = true; wm.value.message = ''; wm.value.error = '';
  try {
    const r = await api.adminWebmasterSave({ token: wm.value.token, hostId: wm.value.hostId, clientId: wm.value.clientId });
    if (!wm.value.token) {
      wm.value.message = 'Client ID сохранён — теперь получите токен по кнопке ниже.';
    } else {
      wm.value.message = r.resolvedHost ? `Подключено: ${r.resolvedHost.url || r.hostId}` : `Токен сохранён, хост: ${r.hostId || 'не выбран'}`;
      wm.value.token = '';
    }
    await load();
  } catch (e) { wm.value.error = e.message || 'Не удалось подключить Вебмастер'; }
  finally { wm.value.saving = false; }
}
async function syncWebmaster() {
  wm.value.syncing = true; wm.value.message = ''; wm.value.error = '';
  try {
    const r = await api.adminWebmasterSync(days.value);
    wm.value.message = `Загружено запросов: ${r.saved} за ${fmtDate(r.from)} — ${fmtDate(r.to)}${r.summary ? ` · ИКС ${r.summary.sqi}, страниц в поиске ${r.summary.searchablePages}` : ''}`;
    await load();
  } catch (e) { wm.value.error = e.message || 'Не удалось синхронизировать запросы'; }
  finally { wm.value.syncing = false; }
}

function exportCsv() {
  const rows = [['Дата', 'Визиты', 'Просмотры', 'Уникальные', 'Поисковые визиты', 'Боты', 'Регистрации', 'Оплаты', 'Выручка']];
  for (const r of series.value) rows.push([r.date, r.visits, r.pageviews, r.unique, r.search, r.bots, r.registrations, r.payments, r.revenue]);
  const csv = '\ufeff' + rows.map((r) => r.join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `seo-analytics-${days.value}d-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function handleOAuthHash() {
  try {
    const params = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    const token = params.get('access_token');
    const err = params.get('error_description') || params.get('error');
    if (token) {
      wm.value.token = token;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      saveWebmaster();
    } else if (err) {
      wm.value.error = 'Яндекс: ' + err;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch { /* ignore */ }
}
onMounted(() => {
  load();
  handleOAuthHash();
  timer = window.setInterval(() => { if (!document.hidden) load(); }, 60000);
});
onUnmounted(() => window.clearInterval(timer));
watch(days, load);
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display font-bold text-2xl flex items-center gap-2">
          <BrandIcon name="marketing" :size="22" class="text-brand-400" /> SEO и аналитика
        </h1>
        <p class="text-sm text-slate-500 mt-1">Поисковый трафик, запросы, краулинг ботов, конверсии и здоровье SEO — без внешних счётчиков.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex rounded-xl border border-slate-200 dark:border-white/10 p-1">
          <button v-for="d in [7, 30, 90]" :key="d" class="px-3 py-1.5 rounded-lg text-xs font-semibold" :class="days === d ? 'bg-brand-500 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'" @click="days = d">{{ d }} дней</button>
        </div>
        <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="loading" @click="load"><BrandIcon name="refresh" :size="15" class="inline-block mr-1 -mt-0.5" />Обновить</button>
        <button class="btn-ghost !py-2 !px-3 text-sm" @click="exportCsv">CSV</button>
      </div>
    </div>

    <div v-if="error" class="glass rounded-2xl p-4 text-sm text-red-500">
      {{ error }} <button class="underline ml-2" @click="load">Повторить</button>
    </div>

    <div v-if="loading && !data" class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <div v-for="i in 8" :key="i" class="glass rounded-2xl h-24 animate-pulse"></div>
    </div>

    <template v-else-if="data">
      <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div class="glass rounded-2xl p-4">
          <div class="text-[11px] uppercase tracking-wider text-slate-500">Визиты</div>
          <div class="font-display font-extrabold text-2xl mt-1">{{ fmt(kpi.visits) }}</div>
          <div class="text-[11px] mt-1" :class="trend === null ? 'text-slate-500' : trend >= 0 ? 'text-emerald-500' : 'text-red-500'">
            {{ trend === null ? 'накапливаем данные' : (trend >= 0 ? '+' : '') + trend + '% к прошлой неделе' }}
          </div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-[11px] uppercase tracking-wider text-slate-500">Посетители</div>
          <div class="font-display font-extrabold text-2xl mt-1">{{ fmt(kpi.visitors) }}</div>
          <div class="text-[11px] text-slate-500 mt-1">просмотров: {{ fmt(kpi.pageviews) }}</div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-[11px] uppercase tracking-wider text-slate-500">Поисковый трафик</div>
          <div class="font-display font-extrabold text-2xl mt-1">{{ fmt(kpi.searchVisits) }}</div>
          <div class="text-[11px] text-slate-500 mt-1">{{ kpi.searchShare || 0 }}% от просмотров</div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-[11px] uppercase tracking-wider text-slate-500">Краулинг ботов</div>
          <div class="font-display font-extrabold text-2xl mt-1">{{ fmt(kpi.bots) }}</div>
          <div class="text-[11px] text-slate-500 mt-1">заходов поисковых роботов</div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-[11px] uppercase tracking-wider text-slate-500">Регистрации</div>
          <div class="font-display font-extrabold text-2xl mt-1">{{ fmt(kpi.registrations) }}</div>
          <div class="text-[11px] text-slate-500 mt-1">конверсия {{ kpi.conversion || 0 }}% от визитов</div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-[11px] uppercase tracking-wider text-slate-500">Пробные периоды</div>
          <div class="font-display font-extrabold text-2xl mt-1">{{ fmt(kpi.trials) }}</div>
          <div class="text-[11px] text-slate-500 mt-1">активаций PRO-триала</div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-[11px] uppercase tracking-wider text-slate-500">Оплаты</div>
          <div class="font-display font-extrabold text-2xl mt-1">{{ fmt(kpi.payments) }}</div>
          <div class="text-[11px] text-slate-500 mt-1">выручка {{ fmtMoney(kpi.revenue) }}</div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-[11px] uppercase tracking-wider text-slate-500">Позиции в Яндексе</div>
          <div class="font-display font-extrabold text-2xl mt-1">{{ kpi.avgPosition ? kpi.avgPosition : '—' }}</div>
          <div class="text-[11px] text-slate-500 mt-1">средняя позиция · CTR {{ kpi.ctr || 0 }}%</div>
        </div>
      </div>

      <div class="grid xl:grid-cols-[1.6fr_1fr] gap-4">
        <div class="glass rounded-2xl p-4">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <div class="font-semibold">Динамика трафика</div>
              <div class="text-xs text-slate-500">{{ fmtDate(data.period.from) }} — {{ fmtDate(data.period.to) }}</div>
            </div>
            <div class="flex flex-wrap gap-1">
              <button v-for="(m, key) in METRICS" :key="key" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold" :class="metric === key ? 'bg-brand-500/15 text-brand-400' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'" @click="metric = key">{{ m.label }}</button>
            </div>
          </div>
          <LineChart :points="series" :value-key="metric" :label="METRICS[metric].label" :color="METRICS[metric].color" :height="220" />
        </div>

        <div class="glass rounded-2xl p-4 flex flex-col">
          <div class="flex items-center justify-between">
            <div class="font-semibold">Здоровье SEO</div>
            <div class="text-2xl font-extrabold grad-text">{{ seo.score }}<span class="text-sm text-slate-500">/100</span></div>
          </div>
          <div class="mt-2 h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
            <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500" :style="{ width: seo.score + '%' }"></div>
          </div>
          <div class="mt-3 space-y-2 flex-1">
            <div v-for="c in seo.checks" :key="c.id" class="flex items-start gap-2 text-xs">
              <span class="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0" :class="c.ok ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'">
                <BrandIcon :name="c.ok ? 'check' : 'warning'" :size="11" />
              </span>
              <span class="min-w-0">
                <span class="font-medium" :class="c.ok ? 'text-slate-700 dark:text-slate-200' : 'text-amber-600 dark:text-amber-400'">{{ c.label }}</span>
                <span class="block text-slate-500 leading-snug">{{ c.detail }}</span>
              </span>
            </div>
          </div>
          <button class="btn-ghost !py-2 text-xs mt-3" @click="load">Проверить снова</button>
        </div>
      </div>

      <div class="grid lg:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-4">
          <div class="font-semibold mb-3">Источники трафика</div>
          <div v-if="!sources.length" class="text-sm text-slate-500 py-6 text-center">Пока нет визитов — трекер уже установлен.</div>
          <div v-else class="space-y-2.5">
            <div v-for="s in sources" :key="s.source" class="text-xs">
              <div class="flex justify-between gap-2"><span class="font-medium">{{ sourceLabel(s) }}</span><span class="text-slate-500">{{ fmt(s.visits) }}</span></div>
              <div class="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden"><div class="h-full rounded-full bg-brand-500" :style="{ width: Math.round((s.visits / maxSource) * 100) + '%' }"></div></div>
            </div>
          </div>
        </div>

        <div class="glass rounded-2xl p-4">
          <div class="font-semibold mb-3">Поисковые системы и устройства</div>
          <div v-if="!engines.length" class="text-sm text-slate-500 py-3">Поисковые переходы появятся после первых визитов из Яндекса/Google.</div>
          <div v-else class="space-y-2.5 mb-4">
            <div v-for="e in engines" :key="e.engine" class="text-xs">
              <div class="flex justify-between gap-2"><span class="font-medium">{{ engineLabel(e) }}</span><span class="text-slate-500">{{ fmt(e.visits) }}</span></div>
              <div class="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden"><div class="h-full rounded-full bg-emerald-500" :style="{ width: Math.round((e.visits / maxEngine) * 100) + '%' }"></div></div>
            </div>
          </div>
          <div class="pt-3 border-t border-slate-200/70 dark:border-white/10 space-y-1.5">
            <div v-for="d in devices" :key="d.device" class="flex items-center gap-2 text-xs">
              <span class="w-24 text-slate-500">{{ deviceLabel(d) }}</span>
              <div class="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden"><div class="h-full rounded-full bg-accent-500" :style="{ width: Math.round((d.visits / maxDevice) * 100) + '%' }"></div></div>
              <span class="w-10 text-right text-slate-500">{{ fmt(d.visits) }}</span>
            </div>
            <div v-if="!devices.length" class="text-xs text-slate-500">Нет данных об устройствах.</div>
          </div>
        </div>
      </div>

      <div class="grid lg:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-4 overflow-hidden">
          <div class="font-semibold mb-3">Топ страниц</div>
          <div v-if="!pages.length" class="text-sm text-slate-500 py-6 text-center">Данные появятся после визитов на публичные страницы.</div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead><tr class="text-left text-slate-500 border-b border-slate-200/70 dark:border-white/10"><th class="py-1.5 pr-2">Страница</th><th class="py-1.5 text-right">Просмотры</th></tr></thead>
              <tbody>
                <tr v-for="p in pages" :key="p.path" class="border-b border-slate-100 dark:border-white/5 last:border-0">
                  <td class="py-2 pr-2"><a :href="p.path" target="_blank" class="font-mono text-[11px] hover:text-brand-400 break-all">{{ p.path }}</a></td>
                  <td class="py-2 text-right font-semibold">{{ fmt(p.pageviews) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="glass rounded-2xl p-4 overflow-hidden">
          <div class="flex items-center justify-between mb-3">
            <div class="font-semibold">Поисковые запросы</div>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/30">Вебмастер</span>
          </div>
          <div v-if="wmQueries.length" class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead><tr class="text-left text-slate-500 border-b border-slate-200/70 dark:border-white/10"><th class="py-1.5 pr-2">Запрос</th><th class="py-1.5 text-right">Показы</th><th class="py-1.5 text-right">Клики</th><th class="py-1.5 text-right">CTR</th><th class="py-1.5 text-right">Поз.</th></tr></thead>
              <tbody>
                <tr v-for="q in wmQueries.slice(0, 10)" :key="q.query" class="border-b border-slate-100 dark:border-white/5 last:border-0">
                  <td class="py-2 pr-2 max-w-[220px] truncate" :title="q.query">{{ q.query }}</td>
                  <td class="py-2 text-right">{{ fmt(q.impressions) }}</td>
                  <td class="py-2 text-right">{{ fmt(q.clicks) }}</td>
                  <td class="py-2 text-right">{{ ctr(q) }}%</td>
                  <td class="py-2 text-right">{{ Math.round(q.position * 10) / 10 }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else-if="queries.length" class="overflow-x-auto">
            <div class="text-[11px] text-slate-500 mb-2">Запросы из переходов поисковиков (Вебмастер не подключён):</div>
            <table class="w-full text-xs">
              <thead><tr class="text-left text-slate-500 border-b border-slate-200/70 dark:border-white/10"><th class="py-1.5 pr-2">Запрос</th><th class="py-1.5 text-right">Переходы</th></tr></thead>
              <tbody><tr v-for="q in queries.slice(0, 10)" :key="q.query" class="border-b border-slate-100 dark:border-white/5 last:border-0"><td class="py-2 pr-2 max-w-[260px] truncate" :title="q.query">{{ q.query }}</td><td class="py-2 text-right">{{ fmt(q.visits) }}</td></tr></tbody>
            </table>
          </div>
          <div v-else class="text-sm text-slate-500 py-6 text-center">
            Запросы, показы и позиции появятся после подключения <b>Яндекс.Вебмастера</b> — блок ниже.
          </div>
        </div>
      </div>

      <div class="grid lg:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="font-semibold">Индексация: поисковые роботы</div>
            <span class="text-[11px] text-slate-500">последний заход: {{ fmtDateTime(bots.lastSeen) }}</span>
          </div>
          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <div class="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Роботы</div>
              <div v-if="!bots.engines?.length" class="text-xs text-slate-500">Заходы Яндекса и Google будут видны здесь.</div>
              <div v-else class="space-y-1.5">
                <div v-for="b in bots.engines" :key="b.engine" class="flex items-center justify-between text-xs gap-2"><span>{{ botLabel(b) }}</span><span class="font-semibold">{{ fmt(b.hits) }}</span></div>
              </div>
            </div>
            <div>
              <div class="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Обход страниц</div>
              <div v-if="!bots.pages?.length" class="text-xs text-slate-500">—</div>
              <div v-else class="space-y-1.5">
                <div v-for="p in bots.pages.slice(0, 6)" :key="p.path" class="flex items-center justify-between text-xs gap-2"><span class="font-mono text-[10px] truncate">{{ p.path }}</span><span class="font-semibold">{{ fmt(p.hits) }}</span></div>
              </div>
            </div>
          </div>
          <p class="text-[11px] text-slate-500 mt-3">Данные собираются сервером по User-Agent поисковых ботов — без внешних счётчиков и влияния на скорость сайта.</p>
        </div>

        <div class="glass rounded-2xl p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="font-semibold">Яндекс.Вебмастер</div>
            <span class="text-[10px] px-2 py-0.5 rounded-full border" :class="webmaster.configured ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' : 'bg-amber-500/10 text-amber-500 border-amber-500/30'">{{ webmaster.configured ? 'подключён' : 'не подключён' }}</span>
          </div>
          <p class="text-xs text-slate-500">Показы, клики, CTR и позиции по поисковым запросам из Яндекса. Хост <b>code-qr.stockcity.ru</b> определится автоматически.</p>

          <div class="mt-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[.03] p-3 text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5">
            <div><b>1.</b> В OAuth-приложении Яндекса («Веб-сервисы») добавьте доступ <code class="font-mono">webmaster:hostinfo</code> — это API Вебмастера. Доступы <code class="font-mono">webmaster:verify</code> и <code class="font-mono">direct:api</code> не нужны.</div>
            <div><b>2.</b> Redirect URI: <code class="font-mono break-all">https://code-qr.stockcity.ru/app/admin/analytics</code></div>
            <div><b>3.</b> Скопируйте Client ID приложения, сохраните ниже и нажмите «Получить токен в Яндексе».</div>
          </div>

          <div v-if="webmaster.configured" class="mt-2 text-[11px] text-slate-500">
            Хост: {{ webmaster.hostId || '—' }} · последняя синхронизация: {{ fmtDateTime(webmaster.lastSyncAt) }}
          </div>
          <div v-if="wmSnapshot?.summary" class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div class="rounded-xl border border-slate-200 dark:border-white/10 p-2">
              <div class="text-[10px] uppercase tracking-wider text-slate-500">ИКС</div>
              <div class="font-display font-bold text-lg">{{ wmSnapshot.summary.sqi }}</div>
            </div>
            <div class="rounded-xl border border-slate-200 dark:border-white/10 p-2">
              <div class="text-[10px] uppercase tracking-wider text-slate-500">В поиске</div>
              <div class="font-display font-bold text-lg">{{ fmt(wmSnapshot.summary.searchablePages) }}</div>
            </div>
            <div class="rounded-xl border border-slate-200 dark:border-white/10 p-2">
              <div class="text-[10px] uppercase tracking-wider text-slate-500">Исключено</div>
              <div class="font-display font-bold text-lg">{{ fmt(wmSnapshot.summary.excludedPages) }}</div>
            </div>
            <div class="rounded-xl border border-slate-200 dark:border-white/10 p-2">
              <div class="text-[10px] uppercase tracking-wider text-slate-500">Sitemap</div>
              <div class="font-display font-bold text-lg">{{ wmSnapshot.sitemaps?.count || 0 }}</div>
              <div class="text-[10px] text-slate-500">{{ wmSnapshot.sitemaps?.errors ? 'ошибок: ' + wmSnapshot.sitemaps.errors : 'без ошибок' }}</div>
            </div>
          </div>
          <div v-if="wmSnapshot?.diagnostics?.length" class="mt-3">
            <div class="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Диагностика Вебмастера</div>
            <div class="space-y-1.5">
              <div v-for="d in wmSnapshot.diagnostics.slice(0, 6)" :key="d.type" class="flex items-center justify-between gap-2 text-[11px]">
                <span class="font-mono truncate">{{ d.type }}</span>
                <span class="shrink-0 px-2 py-0.5 rounded-full border" :class="sevClass[d.severity] || 'text-slate-500 border-slate-200 dark:border-white/10'">{{ sevLabel[d.severity] || d.severity }}</span>
              </div>
            </div>
          </div>
          <div v-if="wmSnapshot?.syncedAt" class="mt-2 text-[11px] text-emerald-500">Данные Вебмастера: {{ fmtDateTime(wmSnapshot.syncedAt) }}</div>

          <div class="mt-3 space-y-2">
            <div class="flex flex-col sm:flex-row gap-2">
              <input v-model="wm.clientId" class="input !py-2 text-sm flex-1" placeholder="Client ID OAuth-приложения Яндекса" autocomplete="off">
              <button class="btn-ghost !py-2 !px-3 text-xs shrink-0" :disabled="wm.saving || !wm.clientId" @click="saveWebmaster">Сохранить Client ID</button>
            </div>
            <a v-if="oauthUrl" :href="oauthUrl" target="_blank" rel="noopener" class="btn-primary !py-2 !px-3 text-xs inline-flex">Получить токен в Яндексе →</a>
            <details class="text-[11px] text-slate-500">
              <summary class="cursor-pointer">Вставить токен вручную</summary>
              <div class="mt-2 space-y-2">
                <input v-model="wm.token" class="input !py-2 text-sm" type="password" autocomplete="off" placeholder="OAuth-токен Вебмастера">
                <input v-model="wm.hostId" class="input !py-2 text-sm" placeholder="host_id (необязательно, определится сам)">
              </div>
            </details>
            <div class="flex flex-wrap gap-2">
              <button class="btn-primary !py-2 !px-3 text-xs" :disabled="wm.saving || !wm.token" @click="saveWebmaster">{{ wm.saving ? 'Проверяем…' : 'Подключить токен' }}</button>
              <button class="btn-ghost !py-2 !px-3 text-xs" :disabled="wm.syncing || !webmaster.configured" @click="syncWebmaster">{{ wm.syncing ? 'Загружаем…' : 'Синхронизировать запросы' }}</button>
            </div>
            <p v-if="wm.message" class="text-xs text-emerald-500">{{ wm.message }}</p>
            <p v-if="wm.error" class="text-xs text-red-500">{{ wm.error }}</p>
            <p class="text-[11px] text-slate-500">Токен хранится в зашифрованном виде на сервере. Если хост ещё не добавлен в Вебмастер — сначала подтвердите его в панели Вебмастера.</p>
          </div>
        </div>
      </div>

      <div v-if="!data.hasData" class="glass rounded-2xl p-6 text-sm text-slate-500">
        <b class="text-slate-700 dark:text-slate-200">Данные начнут собираться автоматически.</b>
        Трекер уже стоит на публичных страницах: визиты, источники, устройства и боты будут появляться здесь по мере посещений.
        Для истории можно импортировать access-логи сервера скриптом <code class="font-mono text-xs">scripts/analytics-import-nginx.mjs</code>.
      </div>

      <div class="text-[11px] text-slate-500">Обновлено: {{ fmtDateTime(data.updatedAt) }} · обновление каждые 60 секунд.</div>
    </template>
  </div>
</template>
