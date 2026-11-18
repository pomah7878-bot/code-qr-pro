<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';

const plans = ref([]);
const reviews = ref([]);
const reviewCount = ref(0);
const reviewAvg = ref(0);
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const premium = () => plans.value.find(p => p.id === 'premium');
const free = () => plans.value.find(p => p.id === 'free');
const minPerMonth = () => {
  const o = premium()?.offers || [];
  return o.length ? Math.min(...o.map(x => x.perMonth ?? Math.round((x.finalPrice ?? x.price) / x.days * 30))) : 1990;
};

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
  const targets = { codes: 10000, clients: reviewCount.value || 120, uptime: 99 };
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
  { icon: '▦', title: 'GS1 DataMatrix engine', text: 'Корректные AI, FNC1 и ECC200. Криптохвост «Честного ЗНАКа» — без повреждений.' },
  { icon: '📥', title: 'Импорт CSV / XLSX', text: 'Загрузите файл с GTIN, серийниками и криптохвостами — колонки распознаются автоматически.' },
  { icon: '🛡️', title: 'Валидация данных', text: 'Проверка длины GTIN, контрольных цифр и структуры кода до генерации.' },
  { icon: '🏷️', title: 'Редактор этикеток', text: 'Шаблоны, размеры, штрихкоды и текст. Экспорт PDF под лист или рулон.' },
  { icon: '🖨️', title: 'Термопринтеры', text: 'Windows Print Bridge: печать напрямую на TSC, Zebra, Xprinter и другие.' },
  { icon: '🔌', title: 'API для 1С и складов', text: 'Генерация кодов из ваших учётных систем по REST API.' }
];
const steps = [
  { n: '01', t: 'Загрузите данные', d: 'CSV, XLSX или вставка списка кодов маркировки.' },
  { n: '02', t: 'Проверьте и сгенерируйте', d: 'Валидация GS1, пакетная генерация DataMatrix с прогрессом.' },
  { n: '03', t: 'Печатайте или выгружайте', d: 'PNG/SVG/PDF/ZIP, этикетки и прямая печать на термопринтер.' }
];
const faq = [
  { q: 'Что такое GS1 DataMatrix и зачем он нужен?', a: 'Это двумерный код маркировки товаров для системы «Честный ЗНАК». Без него нельзя легально продавать обувь, одежду, парфюм, шины и многие другие товары в РФ.' },
  { q: 'Подойдёт ли для моего принтера?', a: 'Да. Windows Print Bridge печатает через драйвер любого термопринтера: TSC, Zebra, Xprinter, Godex и других. Размер этикетки задаётся в миллиметрах.' },
  { q: 'Можно ли интегрировать с 1С?', a: 'Да, на тарифе PREMIUM доступен REST API: генерация кодов и получение результатов прямо из вашей учётной системы.' },
  { q: 'Что если код не пройдёт проверку?', a: 'Валидатор проверяет GTIN, контрольные цифры, серийник и криптохвост до генерации — вы сразу видите ошибки и исправляете их.' }
];
const openFaq = ref(null);
</script>

<template>
  <div class="relative overflow-hidden">
    <!-- фоновые орбы -->
    <div class="orb anim-glow w-[500px] h-[500px] bg-violet-600/20 -top-40 -left-40"></div>
    <div class="orb anim-glow w-[400px] h-[400px] bg-accent-500/15 top-[600px] -right-32" style="animation-delay:1.5s"></div>

    <!-- HERO -->
    <section class="relative max-w-6xl mx-auto px-4 pt-20 pb-24 grid lg:grid-cols-2 gap-14 items-center">
      <div>
        <div class="reveal inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-violet-600 dark:text-violet-300 border border-violet-500/30 bg-violet-500/10 rounded-full px-4 py-1.5 mb-6">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Для маркировки «Честный ЗНАК»
        </div>
        <h1 class="reveal reveal-d1 font-display font-extrabold text-4xl md:text-6xl leading-[1.05] mb-6">
          Коды маркировки<br><span class="grad-text grad-animated">за минуты,</span><br>а не за дни
        </h1>
        <p class="reveal reveal-d2 text-lg text-slate-600 dark:text-slate-300 mb-8 max-w-lg leading-relaxed">
          CODE QR PRO генерирует GS1 DataMatrix из ваших файлов, проверяет каждый код
          и печатает этикетки на термопринтере. Без ручных настроек и испорченных криптохвостов.
        </p>
        <div class="reveal reveal-d3 flex flex-wrap gap-4 items-center">
          <router-link to="/register" class="btn-glow">Начать бесплатно →</router-link>
          <a href="#pricing" class="btn-ghost !py-4 !px-6">Тарифы</a>
        </div>
        <p class="reveal reveal-d4 mt-5 text-sm text-slate-500">FREE — 50 кодов в день. Без карты. Регистрация за 30 секунд.</p>
        <!-- счётчики -->
        <div class="reveal reveal-d5 grid grid-cols-3 gap-6 mt-10 max-w-md">
          <div><div class="font-display font-extrabold text-3xl grad-text">{{ counters.codes.toLocaleString('ru') }}</div><div class="text-xs text-slate-500 mt-1">кодов/день на PREMIUM</div></div>
          <div><div class="font-display font-extrabold text-3xl grad-text">{{ counters.uptime }}%</div><div class="text-xs text-slate-500 mt-1">аптайм сервиса</div></div>
          <div><div class="font-display font-extrabold text-3xl grad-text">30с</div><div class="text-xs text-slate-500 mt-1">до первого кода</div></div>
        </div>
      </div>
      <!-- QR-визуал со сканером -->
      <div class="reveal reveal-d2 relative anim-float">
        <div class="absolute inset-0 orb bg-violet-600/25 w-full h-full"></div>
        <div class="relative glass rounded-3xl p-8 max-w-md mx-auto">
          <img src="/qr-icon.svg" alt="CODE QR PRO" class="w-full h-auto drop-shadow-2xl">
          <div class="scan-line"></div>
          <div class="mt-5 flex items-center justify-between text-xs font-mono text-slate-500">
            <span>GS1 · ECC200 · FNC1</span><span class="text-emerald-500 font-bold">✓ валиден</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ДОВЕРИЕ / ВЫГОДЫ -->
    <section class="max-w-6xl mx-auto px-4 py-12">
      <div class="reveal grid md:grid-cols-3 gap-5">
        <div class="glass rounded-2xl p-6 text-center"><div class="text-3xl mb-2">⚡</div><div class="font-display font-bold text-lg mb-1">В 10 раз быстрее</div><p class="text-sm text-slate-500">Пакетная генерация тысяч кодов вместо ручной работы</p></div>
        <div class="glass rounded-2xl p-6 text-center"><div class="text-3xl mb-2">🎯</div><div class="font-display font-bold text-lg mb-1">Без ошибок</div><p class="text-sm text-slate-500">Валидация GS1 до генерации — коды проходят проверку</p></div>
        <div class="glass rounded-2xl p-6 text-center"><div class="text-3xl mb-2">🖨️</div><div class="font-display font-bold text-lg mb-1">Сразу на печать</div><p class="text-sm text-slate-500">Этикетки на ваш термопринтер в один клик</p></div>
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
    <section id="pricing" class="max-w-5xl mx-auto px-4 py-16">
      <div class="reveal text-center mb-12">
        <h2 class="font-display font-bold text-3xl md:text-4xl mb-3">Тарифы</h2>
        <p class="text-slate-500">Начните бесплатно. PREMIUM — от {{ minPerMonth().toLocaleString('ru') }} ₽/мес при годовой оплате</p>
      </div>
      <div class="grid md:grid-cols-2 gap-6 items-start">
        <!-- FREE -->
        <div v-if="free()" class="reveal glass rounded-3xl p-8">
          <h3 class="font-display font-extrabold text-2xl mb-1">FREE</h3>
          <div class="text-4xl font-extrabold mb-6">0 ₽<span class="text-base font-medium text-slate-500">/навсегда</span></div>
          <ul class="space-y-2.5 text-sm mb-8">
            <li>✓ {{ free().codesPerDay }} кодов в день</li>
            <li>✓ Пакет до {{ free().batchMax }} строк</li>
            <li>✓ Форматы PNG, SVG</li>
            <li class="opacity-40">✗ Редактор этикеток</li>
            <li class="opacity-40">✗ Печать на термопринтер</li>
            <li class="opacity-40">✗ API</li>
          </ul>
          <router-link to="/register" class="btn-ghost w-full">Начать бесплатно</router-link>
        </div>
        <!-- PREMIUM -->
        <div v-if="premium()" class="reveal reveal-d2 plan-premium rounded-3xl p-8 relative">
          <div class="absolute -top-3 left-8 text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-violet-600 to-accent-500 text-white rounded-full px-4 py-1 shadow-lg">Популярный</div>
          <h3 class="font-display font-extrabold text-2xl mb-1 grad-text">PREMIUM</h3>
          <div class="text-4xl font-extrabold mb-1">{{ minPerMonth().toLocaleString('ru') }} ₽<span class="text-base font-medium text-slate-500">/мес</span></div>
          <div class="text-xs text-slate-500 mb-6">при оплате за год · помесячно дороже</div>
          <!-- периоды -->
          <div class="space-y-2 mb-6">
            <div v-for="o in premium().offers" :key="o.days" class="flex items-center justify-between rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm bg-white/50 dark:bg-white/5">
              <span class="font-medium">{{ o.days }} дней</span>
              <span class="flex items-center gap-2">
                <span v-if="o.discount > 0" class="text-[10px] font-bold bg-emerald-500 text-white rounded-full px-2 py-0.5">−{{ o.discount }}%</span>
                <span v-if="o.discount > 0" class="text-xs text-slate-400 line-through">{{ o.price.toLocaleString('ru') }}</span>
                <b>{{ (o.finalPrice ?? o.price).toLocaleString('ru') }} ₽</b>
              </span>
            </div>
          </div>
          <ul class="space-y-2.5 text-sm mb-8">
            <li>✓ {{ premium().codesPerDay.toLocaleString('ru') }} кодов в день</li>
            <li>✓ Пакеты до {{ premium().batchMax.toLocaleString('ru') }} строк</li>
            <li>✓ Экспорт ZIP и PDF</li>
            <li>✓ Редактор этикеток + Print Bridge</li>
            <li>✓ API для 1С и складов</li>
            <li>✓ История 365 дней</li>
          </ul>
          <router-link :to="store.user ? '/app/billing' : '/register'" class="btn-glow w-full">Оформить PREMIUM</router-link>
        </div>
      </div>
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
          <h2 class="font-display font-bold text-3xl md:text-4xl mb-4">Первые 50 кодов — бесплатно,<br>прямо сейчас</h2>
          <p class="text-slate-500 mb-8">Регистрация за 30 секунд. Без карты. Без обязательств.</p>
          <router-link to="/register" class="btn-glow text-lg">Создать аккаунт →</router-link>
        </div>
      </div>
    </section>
  </div>
</template>
