<script setup>
import { ref } from 'vue';
import { hints } from '../lib/hints.js';
import BrandIcon from './BrandIcon.vue';

const open = ref(false);
</script>

<template>
  <div class="fixed bottom-5 right-5 z-40 print:hidden">
    <button
      class="flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 hover:opacity-95"
      @click="open = true"
    >
      <BrandIcon name="help" :size="18" />
      <span class="hidden sm:inline">Помощь</span>
    </button>
  </div>

  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm p-4 overflow-y-auto" @click.self="open = false">
      <div class="mx-auto mt-10 w-full max-w-lg rounded-2xl bg-white dark:bg-ink-900 border border-slate-200 dark:border-white/10 p-5 shadow-2xl">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="font-display font-bold text-xl">Помощь</h2>
            <p class="text-xs text-slate-500 mt-1">Короткие подсказки по работе с сервисом.</p>
          </div>
          <button class="text-slate-400 hover:text-slate-700 dark:hover:text-white text-xl leading-none" aria-label="Закрыть" @click="open = false"><BrandIcon name="close" :size="18" /></button>
        </div>

        <div class="mt-4 rounded-xl border border-slate-200 dark:border-white/10 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="text-sm font-semibold">Подсказки на страницах</div>
              <div class="text-xs text-slate-500">{{ hints.enabled ? 'Включены — показываем инструкции на каждом разделе.' : 'Выключены — вы их скрыли.' }}</div>
            </div>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="hints.toggle()">{{ hints.enabled ? 'Отключить' : 'Включить' }}</button>
          </div>
          <button class="text-[11px] text-brand-400 font-medium mt-2" @click="hints.resetAll()">Показать все подсказки заново</button>
        </div>

        <div class="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <div>
            <div class="flex items-center gap-2 font-semibold text-slate-800 dark:text-white"><BrandIcon name="generate" :size="17" />Генерация</div>
            <p>Загрузите CSV/XLSX/PDF или вставьте коды → проверьте пакет → скачайте PDF или ZIP.</p>
          </div>
          <div>
            <div class="flex items-center gap-2 font-semibold text-slate-800 dark:text-white"><BrandIcon name="print" :size="17" />Повторная печать</div>
            <p>Вставьте коды или отсканируйте камерой → выберите размер → нажмите «Скачать PDF». Проверка запустится сама.</p>
          </div>
          <div>
            <div class="flex items-center gap-2 font-semibold text-slate-800 dark:text-white"><BrandIcon name="label" :size="17" />Этикетки</div>
            <p>Загрузите КИЗ и данные → настройте макет → скачайте PDF по размеру этикетки.</p>
          </div>
          <div>
            <div class="flex items-center gap-2 font-semibold text-slate-800 dark:text-white"><BrandIcon name="api" :size="17" />API</div>
            <p>Создайте ключ, передавайте его в заголовке <code class="text-xs">X-API-Key</code>. Генерация — <code class="text-xs">POST /api/v1/generate</code>, статус — <code class="text-xs">GET /api/v1/jobs/{id}</code>.</p>
          </div>
          <div>
            <div class="flex items-center gap-2 font-semibold text-slate-800 dark:text-white"><BrandIcon name="cz" :size="17" />Честный ЗНАК</div>
            <p>Вставьте коды и нажмите «Проверить». «Валидный» — значит формат GS1 верный, но это не подтверждение подлинности в ГИС МТ.</p>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap gap-2">
          <router-link to="/app/generate" class="btn-primary !py-2 text-sm" @click="open = false">Генерация</router-link>
          <router-link to="/app/reprint" class="btn-ghost !py-2 text-sm" @click="open = false">Повторная печать</router-link>
          <router-link to="/app/labels" class="btn-ghost !py-2 text-sm" @click="open = false">Этикетки</router-link>
        </div>
      </div>
    </div>
  </Teleport>
</template>
