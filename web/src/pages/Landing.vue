<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import DataMatrixArt from '../components/DataMatrixArt.vue';
const plans = ref([]);
onMounted(async () => { try { plans.value = (await api.plans()).plans; } catch {} });
const features = [
  { icon: '▦', title: 'GS1 DataMatrix engine', text: 'Корректные AI, FNC1 и ECC200. Криптохвост «Честного ЗНАКа» — без повреждений.', soon: false },
  { icon: '📥', title: 'Импорт CSV / XLSX', text: 'Загрузите файл с GTIN, серийниками и криптохвостами — колонки распознаются автоматически.', soon: true },
  { icon: '🛡️', title: 'Валидация данных', text: 'Проверка длины GTIN, контрольных цифр и структуры кода до генерации.', soon: true },
  { icon: '🏷️', title: 'Редактор этикеток', text: 'Шаблоны, размеры, штрихкоды и текст. Экспорт PDF под лист или рулон.', soon: true },
  { icon: '🖨️', title: 'Термопринтеры', text: 'Windows Print Bridge: печать напрямую на TSC, Zebra, Xprinter и другие.', soon: true },
  { icon: '🔌', title: 'API для 1С и складов', text: 'Генерация кодов из ваших учётных систем по REST API.', soon: true }
];
const steps = [
  { n: '01', t: 'Загрузите данные', d: 'CSV, XLSX или вставка списка кодов маркировки.' },
  { n: '02', t: 'Проверьте и сгенерируйте', d: 'Валидация GS1, пакетная генерация DataMatrix с прогрессом.' },
  { n: '03', t: 'Печатайте или выгружайте', d: 'PNG/SVG/PDF/ZIP, этикетки и прямая печать на термопринтер.' }
];
</script>

<template>
  <div>
    <!-- hero -->
    <section class="max-w-6xl mx-auto px-4 pt-16 pb-20 grid lg:grid-cols-2 gap-12 items-center">
      <div>
        <div class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent-400 border border-accent-400/30 bg-accent-400/10 rounded-full px-4 py-1.5 mb-6">
          Для маркировки «Честный ЗНАК»
        </div>
        <h1 class="font-display font-extrabold text-4xl md:text-5xl leading-tight mb-6">
          GS1 DataMatrix.<br><span class="grad-text">Пакетно. Точно.</span><br>Готово к печати.
        </h1>
        <p class="text-lg text-slate-600 dark:text-slate-300 mb-8 max-w-lg">
          CODE QR PRO генерирует коды маркировки из ваших файлов, проверяет каждый код
          и печатает этикетки на термопринтере. Без ручных настроек и испорченных криптохвостов.
        </p>
        <div class="flex flex-wrap gap-3">
          <router-link to="/register" class="btn-primary">Начать бесплатно →</router-link>
          <a href="#pricing" class="btn-ghost">Тарифы</a>
        </div>
        <p class="mt-4 text-sm text-slate-500">FREE — 50 кодов в день. Без карты.</p>
      </div>
      <DataMatrixArt class="max-w-md mx-auto w-full" />
    </section>

    <!-- features -->
    <section class="max-w-6xl mx-auto px-4 py-16">
      <h2 class="font-display font-bold text-3xl mb-3 text-center">Всё для маркировки — в одном окне</h2>
      <p class="text-center text-slate-500 mb-10">От файла с кодами до напечатанной этикетки</p>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div v-for="f in features" :key="f.title" class="glass rounded-2xl p-6">
          <div class="flex items-center justify-between mb-3">
            <span class="text-3xl">{{ f.icon }}</span>
            <span v-if="f.soon" class="chip-soon">скоро</span>
          </div>
          <h3 class="font-display font-semibold text-lg mb-2">{{ f.title }}</h3>
          <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{{ f.text }}</p>
        </div>
      </div>
    </section>

    <!-- steps -->
    <section class="max-w-6xl mx-auto px-4 py-16">
      <div class="grid md:grid-cols-3 gap-5">
        <div v-for="s in steps" :key="s.n" class="rounded-2xl p-6 border border-slate-200 dark:border-white/10">
          <div class="font-display font-extrabold text-4xl grad-text mb-3">{{ s.n }}</div>
          <h3 class="font-semibold text-lg mb-1.5">{{ s.t }}</h3>
          <p class="text-sm text-slate-600 dark:text-slate-400">{{ s.d }}</p>
        </div>
      </div>
    </section>

    <!-- pricing -->
    <section id="pricing" class="max-w-4xl mx-auto px-4 py-16">
      <h2 class="font-display font-bold text-3xl mb-10 text-center">Тарифы</h2>
      <div class="grid md:grid-cols-2 gap-6">
        <div v-for="p in plans" :key="p.id"
             class="glass rounded-3xl p-8 relative"
             :class="p.id === 'premium' ? 'ring-2 ring-brand-500/60' : ''">
          <div v-if="p.id === 'premium'" class="absolute -top-3 left-8 text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-brand-500 to-accent-500 text-white rounded-full px-4 py-1">Для бизнеса</div>
          <h3 class="font-display font-extrabold text-2xl mb-1">{{ p.title }}</h3>
          <div class="text-4xl font-extrabold mb-6">
            <template v-if="p.priceMonthly === 0">0 ₽</template>
            <template v-else-if="p.priceMonthly">{{ p.priceMonthly }} ₽<span class="text-base font-medium text-slate-500">/мес</span></template>
            <template v-else><span class="text-2xl grad-text">цена скоро</span></template>
          </div>
          <ul class="space-y-2.5 text-sm mb-8">
            <li>✓ {{ p.codesPerDay.toLocaleString('ru') }} кодов в день</li>
            <li>✓ Пакет до {{ p.batchMax.toLocaleString('ru') }} строк</li>
            <li>✓ Форматы: {{ p.formats.join(', ').toUpperCase() }}</li>
            <li :class="p.labelEditor ? '' : 'opacity-40'">{{ p.labelEditor ? '✓' : '✗' }} Редактор этикеток</li>
            <li :class="p.printBridge ? '' : 'opacity-40'">{{ p.printBridge ? '✓' : '✗' }} Печать на термопринтер</li>
            <li :class="p.apiAccess ? '' : 'opacity-40'">{{ p.apiAccess ? '✓' : '✗' }} API</li>
            <li>✓ История {{ p.historyDays }} дн.</li>
          </ul>
          <router-link to="/register" class="w-full" :class="p.id === 'premium' ? 'btn-primary' : 'btn-ghost'">
            {{ p.id === 'premium' ? 'Оформить PREMIUM' : 'Начать бесплатно' }}
          </router-link>
        </div>
      </div>
    </section>

    <!-- final CTA -->
    <section class="max-w-4xl mx-auto px-4 pb-20">
      <div class="glass rounded-3xl p-10 text-center">
        <h2 class="font-display font-bold text-2xl md:text-3xl mb-4">Первые 50 кодов — бесплатно, прямо сейчас</h2>
        <router-link to="/register" class="btn-primary">Создать аккаунт →</router-link>
      </div>
    </section>
  </div>
</template>
