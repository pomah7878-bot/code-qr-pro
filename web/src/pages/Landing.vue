<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { planFeatureRows } from '../lib/planFeatures.js';
import AdSlot from '../components/AdSlot.vue';
import BrandIcon from '../components/BrandIcon.vue';

const plans = ref([]);
const reviews = ref([]);
const reviewCount = ref(0);
const reviewAvg = ref(0);
const premium = () => plans.value.find(p => p.id === 'pro' || p.id === 'premium');
const free = () => plans.value.find(p => p.id === 'free');
const freeFeatures = computed(() => planFeatureRows(free()));
const premiumFeatures = computed(() => planFeatureRows(premium(), { onlyEnabled: true }));
const freeCodeLimit = computed(() => free()?.codesPerDay ?? 20);
const landingPeriod = ref('month');
const pricingPlans = computed(() => {
  const list = plans.value || [];
  return ['free', 'start', 'pro', 'business']
    .map((id) => list.find((p) => p.id === id))
    .filter(Boolean);
});
const priceOf = (plan) => landingPeriod.value === 'year'
  ? (Number(plan.priceYearly) || Math.round(Number(plan.priceMonthly || 0) * 12))
  : (Number(plan.priceMonthly) || 0);
const perMonthOf = (plan) => Math.round(priceOf(plan) / (landingPeriod.value === 'year' ? 12 : 1));
const yearlySavings = (plan) => Math.max(0, Math.round((Number(plan.priceMonthly) || 0) * 12 - priceOf(plan)));
const landingFeatures = (plan) => planFeatureRows(plan, { onlyEnabled: true });
const landingCta = (plan) => plan.id === 'free'
  ? { to: '/register', label: 'Начать бесплатно' }
  : { to: store.user ? '/app/billing' : '/register', label: 'Выбрать ' + plan.title };
const premiumCodeLimit = computed(() => premium()?.opsPerPeriod ?? 5000);
const minPerMonth = () => {
  const o = premium()?.offers || [];
  return o.length ? Math.min(...o.map(x => x.perMonth ?? Math.round((x.finalPrice ?? x.price) / x.days * 30))) : 349;
};
// лучшее предложение = минимальная цена за месяц
const bestOffer = () => {
  const o = premium()?.offers || [];
  if (!o.length) return null;
  return o.reduce((a, b) => ((b.perMonth ?? b.finalPrice / b.days * 30) < (a.perMonth ?? a.finalPrice / a.days * 30) ? b : a));
};
const maxDiscount = () => Math.max(0, ...(premium()?.offers || []).map(o => o.discount || 0));
const saving = (o) => Math.round(o.price - (o.finalPrice ?? o.price));
const periodLabel = (d) => d >= 365 ? 'год' : d >= 180 ? 'полгода' : d >= 90 ? 'квартал' : d + ' дн.';

// scroll-reveal через IntersectionObserver
let io = null;
function setupReveal() {
  io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

// анимированные счётчики
const counters = ref({ codes: 0, clients: 0, uptime: 0 });
function animateCounters() {
  const targets = { codes: premiumCodeLimit.value, clients: reviewCount.value || 120, uptime: 99 };
  const dur = 1600; const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const ease = 1 - Math.pow(1 - p, 3);
    counters.value.codes = Math.round(targets.codes * ease);
    counters.value.clients = Math.round(targets.clients * ease);
    counters.value.uptime = Math.round(targets.uptime * ease);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

onMounted(async () => {
  try { const d = await api.plans(); plans.value = d.list || d.plans; } catch {}
  try { const d = await api.reviews(); reviews.value = d.reviews.slice(0, 6); reviewCount.value = d.count; reviewAvg.value = d.avgRating; } catch {}
  await nextTick();
  setupReveal();
  animateCounters();
});
onUnmounted(() => { if (io) io.disconnect(); });

const features = [
  { icon: 'matrix', title: 'GS1 DataMatrix', text: 'Корректные AI, FNC1 и ECC200. Криптохвост «Честного ЗНАКа» — без повреждений.' },
  { icon: 'import', title: 'Импорт CSV, XLSX, PDF', text: 'Загрузите файл с GTIN, серийниками и криптохвостами — колонки распознаются автоматически, из PDF извлекаются только коды.' },
  { icon: 'check', title: 'Проверка перед печатью', text: 'GTIN, контрольные цифры, серийник, дубли, криптохвост и соответствие товару — до выхода на печать.' },
  { icon: 'label', title: 'Этикетки и все штрихкоды', text: 'DataMatrix, EAN-13, EAN-8, UPC-A, Code128, Code39, ITF-14, GS1-128, QR и PDF417 в одном редакторе.' },
  { icon: 'set', title: 'Наборы: КИН + вложения', text: 'Загрузите коды набора и состава — сервис сам распределит КИЗ по вложениям и соберёт PDF: набор плюс все позиции.' },
  { icon: 'print', title: 'Печать прямо с сайта', text: 'PDF, печать из браузера или напрямую через Windows Print Bridge на TSC, Zebra, Xprinter и другие.' },
  { icon: 'archive', title: 'История и архив', text: 'Все пакеты, проверки и печать — в одном месте. ZIP-архивы, срок хранения и занятое место по тарифу.' },
  { icon: 'api', title: 'API для 1С и складов', text: 'REST API: генерация, проверка и получение результатов прямо из учётной системы.' },
  { icon: 'ai', title: 'AI-помощник 24/7', text: 'Отвечает по «Честному ЗНАКу» и работе сервиса, подсказывает по шагам и передаёт сложное администратору. Входит в PRO.' },
  { icon: 'lock', title: 'Безопасность', text: 'Двухфакторная аутентификация, активные сессии, защита аккаунта и API-ключи.' }
];
const steps = [
  { n: '01', t: 'Загрузите данные', d: 'CSV, XLSX, PDF, вставка кодов или готовый набор с составом.' },
  { n: '02', t: 'Проверьте коды', d: 'GTIN, серийники, криптохвосты, дубли и соответствие товару — до печати.' },
  { n: '03', t: 'Печатайте сразу', d: 'PDF, печать из браузера или Print Bridge на термопринтер.' }
];
const faq = [
  { q: 'Что такое GS1 DataMatrix и зачем он нужен?', a: 'Это двумерный код маркировки товаров для системы «Честный ЗНАК». Без него нельзя легально продавать обувь, одежду, парфюм, косметику, шины и многие другие товары в РФ.' },
  { q: 'Подойдёт ли для моего принтера?', a: 'Да. Windows Print Bridge печатает через драйвер любого термопринтера: TSC, Zebra, Xprinter, Godex и других. Можно скачать PDF по размеру этикетки или печатать прямо из браузера.' },
  { q: 'Можно ли печатать наборы?', a: 'Да. Загрузите КИН набора и КИЗ вложений — сервис распределит коды по составу и подготовит этикетку набора и этикетки каждого вложения. Для неразборной упаковки есть режим «Только набор».' },
  { q: 'Можно ли печатать без скачивания PDF?', a: 'Да. Кнопка «Печать» открывает готовый макет и системное окно печати. В окне печати выберите принтер этикеток и нужный размер бумаги.' },
  { q: 'Можно ли интегрировать с 1С?', a: 'Да, на тарифе PRO доступен REST API: генерация кодов, проверка и получение результатов прямо из вашей учётной системы.' },
  { q: 'Что если код не пройдёт проверку?', a: 'Валидатор проверит GTIN, контрольные цифры, серийник, криптохвост и дубли до генерации. Вы сразу увидите ошибку и сможете исправить файл.' }
];
const openFaq = ref(null);
</script>

<template>
  <div class="relative overflow-hidden">
    <!-- фоновые орбы -->
    <div class="orb anim-glow w-[500px] h-[500px] bg-violet-600/20 -top-40 -left-40"></div>
    <div class="orb anim-glow w-[400px] h-[400px] bg-accent-500/15 top-[600px] -right-32" style="animation-delay:1.5s"></div>

    <!-- HERO -->
    <section class="relative max-w-[1680px] mx-auto px-4 pt-8 pb-10 sm:pt-12 sm:pb-16 lg:pt-20 lg:pb-24 grid lg:grid-cols-2 gap-8 sm:gap-10 lg:gap-14 items-center">
      <div>
        <div class="reveal inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-violet-600 dark:text-violet-300 border border-violet-500/30 bg-violet-500/10 rounded-full px-4 py-1.5 mb-6">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Маркировка, наборы и печать
        </div>
        <h1 class="reveal reveal-d1 font-display font-extrabold text-[1.9rem] leading-[1.1] sm:text-4xl md:text-6xl md:leading-[1.05] mb-5 sm:mb-6">
          Коды маркировки<br><span class="grad-text grad-animated">за минуты,</span><br>а не за дни
        </h1>
        <p class="reveal reveal-d2 text-lg text-slate-600 dark:text-slate-300 mb-8 max-w-lg leading-relaxed">
          CODE QR PRO генерирует GS1 DataMatrix из ваших файлов, проверяет каждый код,
          собирает наборы с КИН и печатает этикетки — PDF, из браузера или сразу на термопринтере.
        </p>
        <div class="reveal reveal-d3 flex flex-wrap gap-4 items-center">
          <router-link to="/register" class="btn-glow">Начать бесплатно →</router-link>
          <a href="#pricing" class="btn-ghost !py-4 !px-6">Тарифы</a>
        </div>
        <p class="reveal reveal-d4 mt-5 text-sm text-slate-500">FREE — {{ freeCodeLimit.toLocaleString('ru') }} операций в день. Без карты. Регистрация за 30 секунд.</p>
        <!-- счётчики -->
        <div class="reveal reveal-d5 grid grid-cols-3 gap-2 sm:gap-4 mt-10 max-w-xl">
          <div class="min-w-0"><div class="font-display font-extrabold text-xl sm:text-2xl lg:text-3xl leading-none tracking-tight whitespace-nowrap grad-text">{{ counters.codes.toLocaleString('ru') }}</div><div class="text-[11px] sm:text-xs text-slate-500 mt-2 leading-snug">операций/мес на PRO</div></div>
          <div class="min-w-0"><div class="font-display font-extrabold text-xl sm:text-2xl lg:text-3xl leading-none tracking-tight whitespace-nowrap grad-text">{{ counters.uptime }}%</div><div class="text-[11px] sm:text-xs text-slate-500 mt-2 leading-snug">аптайм сервиса</div></div>
          <div class="min-w-0"><div class="font-display font-extrabold text-xl sm:text-2xl lg:text-3xl leading-none tracking-tight whitespace-nowrap grad-text">30с</div><div class="text-[11px] sm:text-xs text-slate-500 mt-2 leading-snug">до первого кода</div></div>
        </div>
      </div>
      <!-- QR-визуал со сканером -->
      <div class="reveal reveal-d2 relative anim-float hidden sm:block order-first lg:order-last">
        <div class="absolute inset-0 orb bg-violet-600/25 w-full h-full"></div>
        <div class="relative glass rounded-3xl p-6 sm:p-8 max-w-sm lg:max-w-md mx-auto">
          <img src="/qr-icon.svg" alt="CODE QR PRO" class="w-full h-auto drop-shadow-2xl">
          <div class="scan-line"></div>
          <div class="mt-5 flex items-center justify-between text-xs font-mono text-slate-500">
            <span>GS1 · ECC200 · FNC1</span><span class="inline-flex items-center gap-1 text-emerald-500 font-bold"><BrandIcon name="check" :size="13" />валиден</span>
          </div>
        </div>
      </div>
    </section>

    <div class="max-w-[1680px] mx-auto px-4 pb-6">
      <AdSlot placement="landing_banner" />
    </div>

    <!-- ДОВЕРИЕ / ВЫГОДЫ -->
    <section class="max-w-[1680px] mx-auto px-4 py-12">
      <div class="reveal grid md:grid-cols-2 lg:grid-cols-4 gap-5">
        <div class="glass rounded-2xl p-6 text-center"><div class="mb-3 flex justify-center"><span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20 shadow-[0_0_24px_-12px_rgba(139,92,246,.8)]"><BrandIcon name="speed" :size="26" /></span></div><div class="font-display font-bold text-lg mb-1">В 10 раз быстрее</div><p class="text-sm text-slate-500">Пакетная генерация тысяч кодов вместо ручной работы</p></div>
        <div class="glass rounded-2xl p-6 text-center"><div class="mb-3 flex justify-center"><span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20 shadow-[0_0_24px_-12px_rgba(139,92,246,.8)]"><BrandIcon name="check" :size="26" /></span></div><div class="font-display font-bold text-lg mb-1">Без ошибок</div><p class="text-sm text-slate-500">Валидация GS1 до генерации — коды проходят проверку</p></div>
        <div class="glass rounded-2xl p-6 text-center"><div class="mb-3 flex justify-center"><span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20 shadow-[0_0_24px_-12px_rgba(139,92,246,.8)]"><BrandIcon name="set" :size="26" /></span></div><div class="font-display font-bold text-lg mb-1">Наборы под ключ</div><p class="text-sm text-slate-500">КИН набора и этикетки для каждого вложения</p></div>
        <div class="glass rounded-2xl p-6 text-center"><div class="mb-3 flex justify-center"><span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20 shadow-[0_0_24px_-12px_rgba(139,92,246,.8)]"><BrandIcon name="print" :size="26" /></span></div><div class="font-display font-bold text-lg mb-1">Сразу на печать</div><p class="text-sm text-slate-500">PDF, браузер или термопринтер в один клик</p></div>
      </div>
    </section>

    <!-- FEATURES -->
    <section class="max-w-[1680px] mx-auto px-4 py-16">
      <div class="reveal text-center mb-12">
        <h2 class="font-display font-bold text-3xl md:text-4xl mb-3">Всё для маркировки — в одном окне</h2>
        <p class="text-slate-500">От файла с кодами до напечатанной этикетки</p>
      </div>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div v-for="(f, i) in features" :key="f.title" class="reveal glass rounded-2xl p-6 hover:-translate-y-1 transition-transform" :class="'reveal-d' + ((i % 3) + 1)">
          <div class="mb-4"><span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20 shadow-[0_0_24px_-12px_rgba(139,92,246,.8)]"><BrandIcon :name="f.icon" :size="26" /></span></div>
          <h3 class="font-display font-semibold text-lg mb-2">{{ f.title }}</h3>
          <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{{ f.text }}</p>
        </div>
      </div>
    </section>

    <!-- НОВЫЕ ВОЗМОЖНОСТИ PRO -->
    <section class="max-w-[1680px] mx-auto px-4 py-16">
      <div class="reveal text-center mb-10">
        <span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded-full px-3 py-1 mb-4">
          <BrandIcon name="star-filled" :size="12" />Новое в PRO
        </span>
        <h2 class="font-display font-bold text-3xl md:text-4xl mb-3">Помощник, который знает «Честный ЗНАК»</h2>
        <p class="text-slate-500 max-w-2xl mx-auto">AI-помощник, база знаний и живая поддержка — включены в PRO без доплат.</p>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div class="reveal glass rounded-2xl p-6 relative overflow-hidden hover:-translate-y-1 transition-transform">
          <div class="absolute right-3 top-3 text-[9px] font-bold uppercase tracking-wider text-white bg-gradient-to-r from-violet-600 to-accent-500 rounded-full px-2 py-0.5">PRO</div>
          <div class="mb-4"><span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-accent-500 text-white shadow-lg shadow-violet-600/30"><BrandIcon name="ai" :size="24" solid="#ffffff" /></span></div>
          <h3 class="font-display font-semibold text-lg mb-2">AI-помощник 24/7</h3>
          <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">Отвечает по GS1 DataMatrix, «Честному ЗНАКу» и работе сервиса. Понимает, в каком разделе вы находитесь, и подсказывает по шагам.</p>
        </div>
        <div class="reveal reveal-d1 glass rounded-2xl p-6 relative overflow-hidden hover:-translate-y-1 transition-transform">
          <div class="mb-4"><span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20"><BrandIcon name="check" :size="26" /></span></div>
          <h3 class="font-display font-semibold text-lg mb-2">База знаний</h3>
          <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">Инструкции по генерации, наборам, печати, проверке кодов, ошибкам и настройке аккаунта — ответ со ссылкой на источник.</p>
        </div>
        <div class="reveal reveal-d2 glass rounded-2xl p-6 relative overflow-hidden hover:-translate-y-1 transition-transform">
          <div class="mb-4"><span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20"><BrandIcon name="users" :size="26" /></span></div>
          <h3 class="font-display font-semibold text-lg mb-2">Поддержка с историей</h3>
          <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">Если помощник не решил вопрос — обращение уходит администратору вместе с диалогом. Статус и ответ видны в кабинете.</p>
        </div>
        <div class="reveal reveal-d3 glass rounded-2xl p-6 relative overflow-hidden hover:-translate-y-1 transition-transform">
          <div class="mb-4"><span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20"><BrandIcon name="print" :size="26" /></span></div>
          <h3 class="font-display font-semibold text-lg mb-2">Мобильная печать</h3>
          <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">Печать этикеток прямо с iPhone и Android: AirPrint, Mopria, сохранение в «Файлы» — без компьютера.</p>
        </div>
      </div>
      <p class="reveal text-center text-xs text-slate-500 mt-6">Финансовые вопросы помощник не решает — только подсказывает, где смотреть, и передаёт администратору.</p>
    </section>

    <div class="max-w-[1680px] mx-auto px-4 pb-6">
      <AdSlot placement="landing_middle" />
    </div>

    <!-- SEO / ПОЛЕЗНАЯ ИНФОРМАЦИЯ -->
    <section class="max-w-[1680px] mx-auto px-4 py-16">
      <div class="reveal max-w-3xl mb-8">
        <h2 class="font-display font-bold text-3xl md:text-4xl mb-4">Маркировка «Честного ЗНАКа»: что умеет CODE QR PRO</h2>
        <p class="text-slate-600 dark:text-slate-300 leading-relaxed">
          Сервис помогает производителям, импортёрам, оптовикам и рознице работать с маркировкой без ручной сборки кодов:
          от файла с GTIN и серийниками до готовой этикетки на термопринтере.
        </p>
      </div>
      <div class="grid md:grid-cols-2 gap-6 text-sm text-slate-600 dark:text-slate-300">
        <div class="glass rounded-2xl p-6">
          <h3 class="font-display font-semibold text-lg text-slate-900 dark:text-white mb-2">Генерация GS1 DataMatrix</h3>
          <p>Загрузите CSV, XLSX, PDF или вставьте коды списком. Сервис проверит GTIN, контрольную цифру, серийный номер и криптохвост, соберёт DataMatrix с FNC1 и ECC200 и покажет ошибки до печати.</p>
        </div>
        <div class="glass rounded-2xl p-6">
          <h3 class="font-display font-semibold text-lg text-slate-900 dark:text-white mb-2">Этикетки и печать</h3>
          <p>Соберите макет с DataMatrix, EAN-13, QR, PDF417 или Code128, добавьте название и состав. Скачайте PDF по размеру этикетки, распечатайте прямо из браузера или отправьте на TSC, Zebra, Xprinter через Windows Print Bridge.</p>
        </div>
        <div class="glass rounded-2xl p-6">
          <h3 class="font-display font-semibold text-lg text-slate-900 dark:text-white mb-2">Наборы: КИН и вложения</h3>
          <p>Для набора укажите GTIN набора и состав. Загрузите КИН и КИЗ вложений — сервис распределит коды по позициям и подготовит этикетку набора и каждую этикетку вложения. Для неразборной упаковки есть режим «Только набор».</p>
        </div>
        <div class="glass rounded-2xl p-6">
          <h3 class="font-display font-semibold text-lg text-slate-900 dark:text-white mb-2">API для 1С и склада</h3>
          <p>На тарифе PRO доступен REST API: создание пакета, проверка кодов и получение результата. Подходит для 1С, WMS и складских систем, где маркировка должна запускаться автоматически.</p>
        </div>
      </div>
      <p class="reveal text-sm text-slate-500 mt-6">
        Начните с <router-link to="/register" class="text-brand-400 font-medium">бесплатной регистрации</router-link>
        или посмотрите <router-link to="/pricing" class="text-brand-400 font-medium">тарифы и лимиты</router-link>.
      </p>
    </section>

    <!-- STEPS -->
    <section class="max-w-[1680px] mx-auto px-4 py-16">
      <div class="reveal text-center mb-12"><h2 class="font-display font-bold text-3xl md:text-4xl">Как это работает</h2></div>
      <div class="grid md:grid-cols-3 gap-6">
        <div v-for="(s, i) in steps" :key="s.n" class="reveal relative rounded-2xl p-7 border border-slate-200 dark:border-white/10" :class="'reveal-d' + (i + 1)">
          <div class="font-display font-extrabold text-5xl grad-text grad-animated mb-4">{{ s.n }}</div>
          <h3 class="font-semibold text-lg mb-2">{{ s.t }}</h3>
          <p class="text-sm text-slate-600 dark:text-slate-400">{{ s.d }}</p>
        </div>
      </div>
    </section>

    <!-- PRICING -->
    <section id="pricing" class="relative max-w-[1680px] mx-auto px-4 sm:px-6 py-20">
      <div class="orb anim-glow w-[400px] h-[400px] bg-violet-600/15 top-20 left-1/2 -translate-x-1/2"></div>
      <div class="reveal relative text-center mb-14">
        <div class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-full px-4 py-1.5 mb-5">
          <span v-if="maxDiscount() > 0" class="inline-flex items-center gap-1.5"><BrandIcon name="flame" :size="15" />Скидки до {{ maxDiscount() }}% на длинные периоды</span>
          <span v-else>Выгоднее при оплате за год</span>
        </div>
        <h2 class="font-display font-bold text-3xl md:text-5xl mb-4">Выберите свой тариф</h2>
        <p class="text-slate-500 text-lg">Начните бесплатно. PRO окупается с первой партии маркировки.</p>
      </div>
      <div class="reveal flex justify-center mb-8">
        <div class="inline-flex rounded-2xl border border-slate-200 dark:border-white/15 p-1">
          <button class="px-5 py-2 rounded-xl text-sm font-medium" :class="landingPeriod === 'month' ? 'bg-violet-600 text-white' : 'text-slate-500'" @click="landingPeriod = 'month'">Месяц</button>
          <button class="px-5 py-2 rounded-xl text-sm font-medium" :class="landingPeriod === 'year' ? 'bg-violet-600 text-white' : 'text-slate-500'" @click="landingPeriod = 'year'">Год <span class="text-xs opacity-80">· 2 месяца в подарок</span></button>
        </div>
      </div>
      <div class="relative grid sm:grid-cols-2 xl:grid-cols-4 gap-5 items-stretch">
        <div v-for="plan in pricingPlans" :key="plan.id"
          class="reveal glass rounded-3xl p-6 flex flex-col relative"
          :class="plan.id === 'pro' ? 'plan-premium shadow-2xl shadow-violet-600/20 ring-2 ring-violet-500/40' : 'hover:-translate-y-1 transition-transform duration-300'">
          <div v-if="plan.recommended" class="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[11px] font-bold uppercase tracking-wider bg-gradient-to-r from-violet-600 to-accent-500 text-white rounded-full px-4 py-1 shadow-lg whitespace-nowrap">Рекомендуем</div>
          <div class="flex items-center gap-2 mb-2 mt-1">
            <h3 class="font-display font-extrabold text-2xl" :class="plan.id === 'pro' ? 'grad-text' : ''">{{ plan.title }}</h3>
          </div>
          <p class="text-sm text-slate-500 mb-4 min-h-[44px]">{{ plan.description }}</p>
          <div class="flex items-end gap-1.5 mb-1">
            <span class="text-4xl font-extrabold" :class="plan.id === 'pro' ? 'grad-text' : ''">{{ priceOf(plan).toLocaleString('ru') }} ₽</span>
            <span v-if="plan.id !== 'free'" class="text-sm text-slate-500 mb-1">/{{ landingPeriod === 'year' ? 'год' : 'мес' }}</span>
          </div>
          <div v-if="plan.id === 'free'" class="text-xs text-slate-500 mb-5">бесплатно, без карты</div>
          <div v-else class="text-xs text-slate-500 mb-5">{{ landingPeriod === 'year' ? perMonthOf(plan).toLocaleString('ru') + ' ₽/мес · экономия ' + yearlySavings(plan).toLocaleString('ru') + ' ₽' : 'без автопродления' }}</div>
          <ul class="space-y-2 text-sm mb-6 flex-1">
            <li v-for="f in landingFeatures(plan)" :key="f.text" class="flex items-start gap-2">
              <span class="text-emerald-500 font-bold mt-0.5"><BrandIcon name="check" :size="14" /></span> {{ f.text }}
            </li>
          </ul>
          <router-link :to="landingCta(plan).to" class="w-full text-center" :class="plan.id === 'pro' ? 'btn-glow' : 'btn-ghost'">{{ landingCta(plan).label }}</router-link>
        </div>
      </div>
      <p class="reveal text-center text-sm text-slate-500 mt-8"><BrandIcon name="info" :size="15" class="inline-block mr-1 -mt-0.5" />Не уверены? Начните с FREE — {{ freeCodeLimit.toLocaleString('ru') }} операций в день бесплатно, переход на платный тариф в любой момент.</p>
      <p class="reveal text-center mt-3"><router-link to="/pricing" class="text-brand-400 font-medium text-sm">Сравнить все тарифы и возможности →</router-link></p>
    </section>

    <!-- REVIEWS -->
    <section v-if="reviews.length" class="max-w-[1680px] mx-auto px-4 py-16">
      <div class="reveal text-center mb-10">
        <h2 class="font-display font-bold text-3xl md:text-4xl mb-2">Отзывы клиентов</h2>
        <p class="text-slate-500"><span class="text-amber-500"><BrandIcon name="star-filled" :size="15" /></span> {{ reviewAvg }} из 5 · {{ reviewCount }} отзывов</p>
      </div>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div v-for="(r, i) in reviews" :key="r.id" class="reveal glass rounded-2xl p-5" :class="'reveal-d' + ((i % 3) + 1)">
          <div class="mb-2 flex gap-0.5 text-amber-500"><BrandIcon v-for="i in 5" :key="i" :name="i <= r.rating ? 'star-filled' : 'star'" :size="14" /></div>
          <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">{{ r.text }}</p>
          <div class="text-sm font-semibold">{{ r.authorName }}</div>
        </div>
      </div>
      <div class="reveal text-center mt-8"><router-link to="/app/reviews" class="btn-ghost">Все отзывы и оставить свой →</router-link></div>
    </section>

    <div class="max-w-[1680px] mx-auto px-4 pb-6">
      <AdSlot placement="landing_bottom" />
    </div>

    <!-- FAQ -->
    <section class="max-w-3xl mx-auto px-4 py-16">
      <div class="reveal text-center mb-10"><h2 class="font-display font-bold text-3xl md:text-4xl">Частые вопросы</h2></div>
      <div class="space-y-3">
        <div v-for="(f, i) in faq" :key="i" class="reveal glass rounded-2xl overflow-hidden">
          <button class="w-full flex items-center justify-between gap-4 p-5 text-left font-semibold" @click="openFaq = openFaq === i ? null : i">
            <span>{{ f.q }}</span>
            <span class="text-brand-400 transition-transform" :class="openFaq === i ? 'rotate-45' : ''">+</span>
          </button>
          <div v-show="openFaq === i" class="px-5 pb-5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{{ f.a }}</div>
        </div>
      </div>
      <div class="reveal text-center mt-8">
        <router-link to="/faq" class="text-brand-400 font-medium text-sm">Все ответы на вопросы →</router-link>
      </div>
    </section>

    <!-- FINAL CTA -->
    <section class="max-w-4xl mx-auto px-4 pb-24">
      <div class="reveal relative rounded-3xl p-12 text-center overflow-hidden plan-premium">
        <div class="orb anim-glow w-[300px] h-[300px] bg-violet-600/30 -top-20 left-1/2 -translate-x-1/2"></div>
        <div class="relative">
          <h2 class="font-display font-bold text-3xl md:text-4xl mb-4">Первые {{ freeCodeLimit.toLocaleString('ru') }} кодов — бесплатно,<br>прямо сейчас</h2>
          <p class="text-slate-500 mb-8">Регистрация за 30 секунд. Без карты. Без обязательств.</p>
          <router-link to="/register" class="btn-glow text-lg">Создать аккаунт →</router-link>
        </div>
      </div>
    </section>

  </div>
</template>
