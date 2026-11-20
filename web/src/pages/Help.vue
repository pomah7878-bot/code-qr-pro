<script setup>
import { hints } from '../lib/hints.js';
import { openAssistant } from '../lib/assistant-ui.js';
import SideNav from '../components/SideNav.vue';
import BrandIcon from '../components/BrandIcon.vue';

const blocks = [
  {
    icon: 'generate',
    title: 'Генерация',
    text: 'Загрузите CSV/XLSX/PDF или вставьте коды → проверьте пакет → скачайте PDF или ZIP.',
    to: '/app/generate'
  },
  {
    icon: 'print',
    title: 'Повторная печать',
    text: 'Вставьте коды или отсканируйте камерой → выберите размер → нажмите «Скачать PDF». Проверка запустится сама.',
    to: '/app/reprint'
  },
  {
    icon: 'label',
    title: 'Этикетки',
    text: 'Загрузите КИЗ и данные → настройте макет → скачайте PDF по размеру этикетки.',
    to: '/app/labels'
  },
  {
    icon: 'set',
    title: 'Наборы',
    text: 'Создайте набор с КИН, укажите состав и количество → скачайте PDF набора для наклейки.',
    to: '/app/sets'
  },
  {
    icon: 'cz',
    title: 'Честный ЗНАК',
    text: 'Вставьте коды и нажмите «Проверить». «Валидный» — значит формат GS1 верный, но это не подтверждение подлинности в ГИС МТ.',
    to: '/app/cz'
  },
  {
    icon: 'api',
    title: 'API',
    text: 'Создайте ключ, передавайте его в заголовке X-API-Key. Генерация — POST /api/v1/generate, статус — GET /api/v1/jobs/{id}.',
    to: '/app/apikeys'
  }
];
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/help" />
    <div class="space-y-4">
      <div>
        <h1 class="font-display font-bold text-2xl">Помощь</h1>
        <p class="text-sm text-slate-500 mt-1">Короткие подсказки по работе с сервисом и быстрый доступ к AI-помощнику.</p>
      </div>

      <div class="glass rounded-2xl p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <img src="/qr-icon.svg" alt="CODE QR PRO" class="w-10 h-10 rounded-xl">
            <div>
              <div class="flex items-center gap-2">
                <div class="font-display font-semibold">AI-помощник</div>
                <span class="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-brand-500/10 border border-brand-500/30 text-brand-400">PREMIUM</span>
              </div>
              <div class="text-xs text-slate-500 mt-0.5">Отвечает по «Честному ЗНАКу» и работе сервиса. Сложные вопросы передаёт администратору.</div>
            </div>
          </div>
          <button class="btn-primary !py-2 !px-4 text-sm" @click="openAssistant()">Спросить</button>
        </div>
      </div>

      <div class="glass rounded-2xl p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="font-semibold text-sm">Подсказки на страницах</div>
            <div class="text-xs text-slate-500">{{ hints.enabled ? 'Включены — показываем инструкции на каждом разделе.' : 'Выключены — вы их скрыли.' }}</div>
          </div>
          <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="hints.toggle()">{{ hints.enabled ? 'Отключить' : 'Включить' }}</button>
        </div>
        <button class="text-[11px] text-brand-400 font-medium mt-2" @click="hints.resetAll()">Показать все подсказки заново</button>
      </div>

      <div class="grid sm:grid-cols-2 gap-3">
        <router-link v-for="b in blocks" :key="b.title" :to="b.to"
          class="glass rounded-2xl p-4 transition hover:border-brand-500/40 border border-transparent">
          <div class="flex items-center gap-2 font-semibold text-sm text-slate-800 dark:text-white">
            <BrandIcon :name="b.icon" :size="18" class="text-brand-400" />{{ b.title }}
          </div>
          <p class="text-xs text-slate-500 mt-1.5">{{ b.text }}</p>
        </router-link>
      </div>

      <div class="glass rounded-2xl p-5">
        <div class="font-semibold text-sm mb-2">Печать с телефона</div>
        <div class="text-sm text-slate-600 dark:text-slate-300 space-y-2">
          <p><b>iPhone/iPad:</b> «Печать» или «PDF» → «Поделиться» → «Напечатать». Принтер находится сам через AirPrint, если он в той же Wi-Fi сети — драйверы и приложения не нужны.</p>
          <p><b>Android:</b> «Печать» открывает системное окно печати (Mopria / Default Print Service). Если не открылось — скачайте PDF и выберите в браузере меню ⋮ → «Печать».</p>
          <p>В диалоге печати укажите размер бумаги этикетки (например, 58×40 мм), иначе масштаб съедет. Для старых принтеров на Android может понадобиться «Mopria Print Service» из Play Market.</p>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <router-link to="/app/generate" class="btn-primary !py-2 text-sm">Генерация</router-link>
        <router-link to="/app/reprint" class="btn-ghost !py-2 text-sm">Повторная печать</router-link>
        <router-link to="/app/labels" class="btn-ghost !py-2 text-sm">Этикетки</router-link>
        <router-link to="/app/assistant" class="btn-ghost !py-2 text-sm">Полная страница AI-помощника</router-link>
      </div>
    </div>
  </div>
</template>
