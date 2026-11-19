<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { planFeatureRows } from '../lib/planFeatures.js';
import AdSlot from '../components/AdSlot.vue';

const plans = ref([]);
const reviews = ref([]);
const reviewCount = ref(0);
const reviewAvg = ref(0);
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const premium = () => plans.value.find(p => p.id === 'premium');
const free = () => plans.value.find(p => p.id === 'free');
const freeFeatures = computed(() => planFeatureRows(free()));
const premiumFeatures = computed(() => planFeatureRows(premium(), { onlyEnabled: true }));
const freeCodeLimit = computed(() => free()?.codesPerDay ?? 50);
const premiumCodeLimit = computed(() => premium()?.codesPerDay ?? 10000);
const minPerMonth = () => {
  const o = premium()?.offers || [];
  return o.length ? Math.min(...o.map(x => x.perMonth ?? Math.round((x.finalPrice ?? x.price) / x.days * 30))) : 1990;
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
  try { plans.value = (await api.plans()).plans; } catch {}
  try { const d = await api.reviews(); reviews.value = d.reviews.slice(0, 6); reviewCount.value = d.count; reviewAvg.value = d.avgRating; } catch {}
  await nextTick();
  setupReveal();
  animateCounters();
});
onUnmounted(() => { if (io) io.disconnect(); });

const features = [
  { icon: '▦', title: 'GS1 DataMatrix', text: 'Корректные AI, FNC1 и ECC200. Криптохвост «Честного ЗНАКа» — без повреждений.' },
  { icon: '📥', title: 'Импорт CSV, XLSX, PDF', text: 'Загрузите файл с GTIN, серийниками и криптохвостами — колонки распознаются автоматически, из PDF извлекаются только коды.' },
  { icon: '🛡️', title: 'Проверка перед печатью', text: 'GTIN, контрольные цифры, серийник, дубли, криптохвост и соответствие товару — до выхода на печать.' },
  { icon: '🏷️', title: 'Этикетки и все штрихкоды', text: 'DataMatrix, EAN-13, EAN-8, UPC-A, Code128, Code39, ITF-14, GS1-128, QR и PDF417 в одном редакторе.' },
  { icon: '🎁', title: 'Наборы: КИН + вложения', text: 'Загрузите коды набора и состава — сервис сам распределит КИЗ по вложениям и соберёт PDF: набор плюс все позиции.' },
  { icon: '🖨️', title: 'Печать прямо с сайта', text: 'PDF, печать из браузера или напрямую через Windows Print Bridge на TSC, Zebra, Xprinter и другие.' },
  { icon: '🕘', title: 'История и архив', text: 'Все пакеты, проверки и печать — в одном месте. ZIP-архивы, срок хранения и занятое место по тарифу.' },
  { icon: '🔌', title: 'API для 1С и складов', text: 'REST API: генерация, проверка и получение результатов прямо из учётной системы.' },
  { icon: '🔐', title: 'Безопасность', text: 'Двухфакторная аутентификация, активные сессии, защита аккаунта и API-ключи.' }
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
  { q: 'Можно ли интегрировать с 1С?', a: 'Да, на тарифе PREMIUM доступен REST API: генерация кодов, проверка и получение результатов прямо из вашей учётной системы.' },
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
    <section class="relative max-w-6xl mx-auto px-4 pt-12 pb-16 lg:pt-20 lg:pb-24 grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
      <div>
        <div class="reveal inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-violet-600 dark:text-violet-300 border border-violet-500/30 bg-violet-500/10 rounded-full px-4 py-1.5 mb-6">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Маркировка, наборы и печать
        </div>
        <h1 class="reveal reveal-d1 font-display font-extrabold text-[2rem] leading-[1.1] sm:text-4xl md:text-6xl md:leading-[1.05] mb-6">
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
        <p class="reveal reveal-d4 mt-5 text-sm text-slate-500">FREE — {{ freeCodeLimit.toLocaleString('ru') }} кодов в день. Без карты. Регистрация за 30 секунд.</p>
        <!-- счётчики -->
        <div class="reveal reveal-d5 grid grid-cols-3 gap-2 sm:gap-4 mt-10 max-w-xl">
          <div class="min-w-0"><div class="font-display font-extrabold text-xl sm:text-2xl lg:text-3xl leading-none tracking-tight whitespace-nowrap grad-text">{{ counters.codes.toLocaleString('ru') }}</div><div class="text-[11px] sm:text-xs text-slate-500 mt-2 leading-snug">кодов/день на PREMIUM</div></div>
          <div class="min-w-0"><div class="font-display font-extrabold text-xl sm:text-2xl lg:text-3xl leading-none tracking-tight whitespace-nowrap grad-text">{{ counters.uptime }}%</div><div class="text-[11px] sm:text-xs text-slate-500 mt-2 leading-snug">аптайм сервиса</div></div>
          <div class="min-w-0"><div class="font-display font-extrabold text-xl sm:text-2xl lg:text-3xl leading-none tracking-tight whitespace-nowrap grad-text">30с</div><div class="text-[11px] sm:text-xs text-slate-500 mt-2 leading-snug">до первого кода</div></div>
        </div>
      </div>
      <!-- QR-визуал со сканером -->
      <div class="reveal reveal-d2 relative anim-float order-first lg:order-last">
        <div class="absolute inset-0 orb bg-violet-600/25 w-full h-full"></div>
        <div class="relative glass rounded-3xl p-6 sm:p-8 max-w-sm lg:max-w-md mx-auto">
          <img src="/qr-icon.svg" alt="CODE QR PRO" class="w-full h-auto drop-shadow-2xl">
          <div class="scan-line"></div>
          <div class="mt-5 flex items-center justify-between text-xs font-mono text-slate-500">
            <span>GS1 · ECC200 · FNC1</span><span class="text-emerald-500 font-bold">✓ валиден</span>
          </div>
        </div>
      </div>
    </section>

    <div class="max-w-6xl mx-auto px-4 pb-6">
      <AdSlot placement="landing_banner" />
    </div>

    <!-- ДОВЕРИЕ / ВЫГОДЫ -->
    <section class="max-w-6xl mx-auto px-4 py-12">
      <div class="reveal grid md:grid-cols-2 lg:grid-cols-4 gap-5">
        <div class="glass rounded-2xl p-6 text-center"><div class="text-3xl mb-2">⚡</div><div class="font-display font-bold text-lg mb-1">В 10 раз быстрее</div><p class="text-sm text-slate-500">Пакетная генерация тысяч кодов вместо ручной работы</p></div>
        <div class="glass rounded-2xl p-6 text-center"><div class="text-3xl mb-2">🎯</div><div class="font-display font-bold text-lg mb-1">Без ошибок</div><p class="text-sm text-slate-500">Валидация GS1 до генерации — коды проходят проверку</p></div>
        <div class="glass rounded-2xl p-6 text-center"><div class="text-3xl mb-2">🎁</div><div class="font-display font-bold text-lg mb-1">Наборы под ключ</div><p class="text-sm text-slate-500">КИН набора и этикетки для каждого вложения</p></div>
        <div class="glass rounded-2xl p-6 text-center"><div class="text-3xl mb-2">🖨️</div><div class="font-display font-bold text-lg mb-1">Сразу на печать</div><p class="text-sm text-slate-500">PDF, браузер или термопринтер в один клик</p></div>
      </div>
    </section>

    <!-- FEATURES -->
    <section class="max-w-6xl mx-auto px-4 py-16">
      <div class="reveal text-center mb-12">
        <h2 class="font-display font-bold text-3xl md:text-4xl mb-3">Всё для маркировки — в одном окне</h2>
        <p class="text-slate-500">От файла с кодами до напечатанной этикетки</p>
      </div>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div v-for="(f, i) in features" :key="f.title" class="reveal glass rounded-2xl p-6 hover:-translate-y-1 transition-transform" :class="'reveal-d' + ((i % 3) + 1)">
          <div class="text-3xl mb-3">{{ f.icon }}</div>
          <h3 class="font-display font-semibold text-lg mb-2">{{ f.title }}</h3>
          <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{{ f.text }}</p>
        </div>
      </div>
    </section>

    <!-- SEO / ПОЛЕЗНАЯ ИНФОРМАЦИЯ -->
    <section class="max-w-6xl mx-auto px-4 py-16">
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
          <p>На тарифе PREMIUM доступен REST API: создание пакета, проверка кодов и получение результата. Подходит для 1С, WMS и складских систем, где маркировка должна запускаться автоматически.</p>
        </div>
      </div>
      <p class="reveal text-sm text-slate-500 mt-6">
        Начните с <router-link to="/register" class="text-brand-400 font-medium">бесплатной регистрации</router-link>
        или посмотрите <a href="#pricing" class="text-brand-400 font-medium">тарифы и лимиты</a>.
      </p>
    </section>

    <!-- STEPS -->
    <section class="max-w-6xl mx-auto px-4 py-16">
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
    <section id="pricing" class="relative max-w-5xl mx-auto px-4 py-20">
      <div class="orb anim-glow w-[400px] h-[400px] bg-violet-600/15 top-20 left-1/2 -translate-x-1/2"></div>
      <div class="reveal relative text-center mb-14">
        <div class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-full px-4 py-1.5 mb-5">
          <span v-if="maxDiscount() > 0">🔥 Скидки до {{ maxDiscount() }}% на длинные периоды</span>
          <span v-else>Выгоднее при оплате за год</span>
        </div>
        <h2 class="font-display font-bold text-3xl md:text-5xl mb-4">Выберите свой тариф</h2>
        <p class="text-slate-500 text-lg">Начните бесплатно. PREMIUM окупается с первой партии маркировки.</p>
      </div>
      <div class="relative grid md:grid-cols-2 gap-8 items-stretch">
        <!-- FREE -->
        <div v-if="free()" class="reveal glass rounded-3xl p-6 sm:p-8 flex flex-col hover:-translate-y-1 transition-transform duration-300">
          <div class="flex items-center gap-3 mb-2">
            <div class="w-11 h-11 rounded-xl bg-slate-100 dark:bg-white/10 flex items-center justify-center text-xl">🌱</div>
            <h3 class="font-display font-extrabold text-2xl">FREE</h3>
          </div>
          <p class="text-sm text-slate-500 mb-5">Попробовать без риска</p>
          <div class="text-4xl sm:text-5xl font-extrabold mb-1">0 ₽</div>
          <div class="text-sm text-slate-500 mb-7">навсегда, без карты</div>
          <ul class="space-y-3 text-sm mb-8 flex-1">
            <li v-for="f in freeFeatures" :key="f.text" class="flex items-center gap-2.5" :class="f.on ? '' : 'opacity-40'">
              <span :class="f.on ? 'text-emerald-500' : ''">{{ f.on ? '✓' : '✗' }}</span> {{ f.text }}
            </li>
          </ul>
          <router-link to="/register" class="btn-ghost w-full !py-3.5">Начать бесплатно</router-link>
        </div>
        <!-- PREMIUM -->
        <div v-if="premium()" class="reveal reveal-d2 plan-premium rounded-3xl p-6 sm:p-8 relative flex flex-col shadow-2xl shadow-violet-600/20 md:scale-[1.03] hover:-translate-y-1 transition-transform duration-300">
          <div class="absolute -top-3.5 left-1/2 -translate-x-1/2 text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-violet-600 to-accent-500 text-white rounded-full px-5 py-1.5 shadow-lg shadow-violet-600/40 whitespace-nowrap">⭐ Выбор бизнеса</div>
          <div class="flex items-center gap-3 mb-2 mt-2">
            <div class="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 to-accent-500 flex items-center justify-center text-xl shadow-lg shadow-violet-600/40">👑</div>
            <h3 class="font-display font-extrabold text-2xl grad-text">PREMIUM</h3>
          </div>
          <p class="text-sm text-slate-500 mb-5">Всё для профессиональной маркировки</p>
          <div class="flex items-end gap-2 mb-1">
            <span class="text-4xl sm:text-5xl font-extrabold grad-text">{{ minPerMonth().toLocaleString('ru') }} ₽</span>
            <span class="text-base font-medium text-slate-500 mb-1.5">/мес</span>
          </div>
          <div class="text-sm text-emerald-600 dark:text-emerald-400 font-medium mb-6">при оплате за {{ periodLabel(bestOffer()?.days || 365) }} · экономия до {{ saving(bestOffer() || {price:0}).toLocaleString('ru') }} ₽</div>
          <!-- периоды -->
          <div class="space-y-2.5 mb-7">
            <div v-for="o in premium().offers" :key="o.days"
              class="relative flex items-center justify-between rounded-2xl border px-4 py-3 text-sm transition-all"
              :class="bestOffer() && o.days === bestOffer().days ? 'border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/30' : 'border-slate-200 dark:border-white/10 bg-white/50 dark:bg-white/5'">
              <span class="flex items-center gap-2 font-medium">
                {{ periodLabel(o.days) }}
                <span v-if="bestOffer() && o.days === bestOffer().days" class="text-[9px] font-bold uppercase bg-violet-600 text-white rounded px-1.5 py-0.5">выгодно</span>
              </span>
              <span class="flex items-center gap-2">
                <span v-if="o.discount > 0" class="text-[10px] font-bold bg-emerald-500 text-white rounded-full px-2 py-0.5 shadow">−{{ o.discount }}%</span>
                <span v-if="o.discount > 0" class="text-xs text-slate-400 line-through">{{ o.price.toLocaleString('ru') }}</span>
                <b class="text-base">{{ (o.finalPrice ?? o.price).toLocaleString('ru') }} ₽</b>
              </span>
            </div>
          </div>
          <ul class="space-y-3 text-sm mb-8 flex-1">
            <li v-for="f in premiumFeatures" :key="f.text" class="flex items-center gap-2.5">
              <span class="text-emerald-500 font-bold">✓</span> {{ f.text }}
            </li>
          </ul>
          <router-link :to="store.user ? '/app/billing' : '/register'" class="btn-glow w-full text-base">Оформить PREMIUM →</router-link>
          <p class="text-center text-xs text-slate-500 mt-3">🔒 Оплата через YooKassa · чек по 54-ФЗ · без автосписаний</p>
        </div>
      </div>
      <p class="reveal text-center text-sm text-slate-500 mt-8">💡 Не уверены? Начните с FREE — {{ freeCodeLimit.toLocaleString('ru') }} кодов в день бесплатно, переход на PREMIUM в любой момент.</p>
    </section>

    <!-- REVIEWS -->
    <section v-if="reviews.length" class="max-w-6xl mx-auto px-4 py-16">
      <div class="reveal text-center mb-10">
        <h2 class="font-display font-bold text-3xl md:text-4xl mb-2">Отзывы клиентов</h2>
        <p class="text-slate-500"><span class="text-amber-500">★</span> {{ reviewAvg }} из 5 · {{ reviewCount }} отзывов</p>
      </div>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div v-for="(r, i) in reviews" :key="r.id" class="reveal glass rounded-2xl p-5" :class="'reveal-d' + ((i % 3) + 1)">
          <div class="text-amber-500 mb-2">{{ stars(r.rating) }}</div>
          <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">{{ r.text }}</p>
          <div class="text-sm font-semibold">{{ r.authorName }}</div>
        </div>
      </div>
      <div class="reveal text-center mt-8"><router-link to="/app/reviews" class="btn-ghost">Все отзывы и оставить свой →</router-link></div>
    </section>

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
