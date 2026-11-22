<script setup>
import { LEGAL, LEGAL_DOC_LIST } from '../content/legal.js';
const year = new Date().getFullYear();
</script>

<template>
  <footer data-nosnippet class="border-t border-slate-200/80 dark:border-white/10 bg-white/60 dark:bg-white/[.02] mt-auto">
    <div class="max-w-[1200px] mx-auto px-4 py-10">
      <div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <router-link to="/" rel="nofollow" class="flex items-center gap-2">
            <img src="/favicon.svg" alt="CODE QR PRO" class="w-8 h-8" />
            <span class="font-display font-extrabold">CODE QR <span class="grad-text">PRO</span></span>
          </router-link>
          <p class="text-sm text-slate-500 mt-3 leading-relaxed">Маркировка «Честный ЗНАК», GS1 DataMatrix, этикетки, повторная печать и API для 1С.</p>
          <a :href="'mailto:' + LEGAL.email" rel="nofollow" class="text-sm text-brand-400 font-medium mt-3 inline-block">{{ LEGAL.email }}</a>
        </div>
        <div>
          <div class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Сервис</div>
          <ul class="space-y-2 text-sm">
            <li><router-link to="/" rel="nofollow" class="hover:text-brand-400">Возможности</router-link></li>
            <li><router-link to="/pricing" rel="nofollow" class="hover:text-brand-400">Тарифы</router-link></li>
            <li><router-link to="/articles" rel="nofollow" class="hover:text-brand-400">Статьи</router-link></li>
            <li><router-link to="/check" rel="nofollow" class="hover:text-brand-400">Проверить код ЧЗ</router-link></li>
            <li><router-link to="/faq" rel="nofollow" class="hover:text-brand-400">Частые вопросы</router-link></li>
          </ul>
        </div>
        <div>
          <div class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Помощь</div>
          <ul class="space-y-2 text-sm">
            <li><router-link to="/articles" rel="nofollow" class="hover:text-brand-400">База знаний</router-link></li>
            <li><router-link to="/faq" rel="nofollow" class="hover:text-brand-400">Ответы на вопросы</router-link></li>
            <li><router-link to="/app/assistant" rel="nofollow" class="hover:text-brand-400">AI-помощник</router-link></li>
            <li><a :href="'mailto:' + LEGAL.email" rel="nofollow" class="hover:text-brand-400">Поддержка</a></li>
          </ul>
        </div>
        <div>
          <div class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Документы</div>
          <ul class="space-y-2 text-sm">
            <li v-for="d in LEGAL_DOC_LIST" :key="d.slug">
              <router-link :to="d.to" rel="nofollow" class="hover:text-brand-400">{{ d.title }}</router-link>
            </li>
          </ul>
        </div>
      </div>

      <div class="mt-8 pt-6 border-t border-slate-200/80 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500">
        <div>© {{ year }} CODE QR PRO. Сервис не является официальным сервисом «Честного ЗНАКа».</div>
        <router-link to="/offer" rel="nofollow" class="hover:text-brand-400">Реквизиты и документы →</router-link>
      </div>
    </div>
  </footer>
</template>
