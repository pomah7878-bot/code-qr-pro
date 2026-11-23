<script setup>
import { computed, onMounted, ref } from 'vue';
import PublicShell from '../components/PublicShell.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { api } from '../api.js';
import { applySeo } from '../lib/seo.js';

const presets = [100, 300, 500, 1000, 3000];
const amount = ref(300);
const custom = ref('');
const email = ref('');
const message = ref('');
const busy = ref(false);
const error = ref('');
const thanks = computed(() => new URLSearchParams(window.location.search).get('thanks') === '1');
const value = computed(() => {
  const n = Number(custom.value || amount.value);
  return Number.isFinite(n) ? Math.round(n) : 0;
});

async function donate() {
  error.value = '';
  if (value.value < 100) { error.value = 'Минимальная сумма поддержки — 100 ₽'; return; }
  busy.value = true;
  try {
    const r = await api.publicDonate({ amount: value.value, email: email.value.trim(), message: message.value.trim() });
    if (r.confirmationUrl) window.location.href = r.confirmationUrl;
    else error.value = 'Не удалось получить ссылку на оплату';
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

onMounted(() => applySeo('/support'));
</script>

<template>
  <PublicShell>
    <div class="max-w-4xl mx-auto">
      <div v-if="thanks" class="glass rounded-3xl p-8 text-center mb-6">
        <div class="text-4xl mb-2">💜</div>
        <h1 class="font-display font-bold text-2xl">Спасибо за поддержку!</h1>
        <p class="text-sm text-slate-500 mt-2">Платёж обрабатывается. Если статус не обновился, напишите на code-qr-pro@mail.ru с номером платежа.</p>
      </div>

      <div class="text-center max-w-3xl mx-auto">
        <div class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-violet-400 border border-violet-500/30 bg-violet-500/10 rounded-full px-4 py-1.5 mb-5">
          <BrandIcon name="star-filled" :size="15" /> Открытый проект · поддержка
        </div>
        <h1 class="font-display font-extrabold text-3xl sm:text-5xl leading-tight">Поддержать CODE QR PRO</h1>
        <p class="text-slate-500 mt-3 text-sm sm:text-base">CODE QR PRO помогает бизнесу печатать GS1 DataMatrix, проверять коды «Честного ЗНАКа» и работать с маркировкой без сложных интеграций. Если сервис полезен — помогите развивать его финансово.</p>
      </div>

      <div class="grid sm:grid-cols-3 gap-3 mt-8">
        <figure class="glass rounded-2xl overflow-hidden">
          <img src="/support/landing.png" alt="CODE QR PRO — главная страница сервиса маркировки" class="w-full h-40 object-cover object-top" loading="lazy">
          <figcaption class="px-3 py-2 text-xs text-slate-500">Маркировка и печать этикеток</figcaption>
        </figure>
        <figure class="glass rounded-2xl overflow-hidden">
          <img src="/support/check.png" alt="Проверка кода Честного ЗНАКа в CODE QR PRO" class="w-full h-40 object-cover object-top" loading="lazy">
          <figcaption class="px-3 py-2 text-xs text-slate-500">Проверка кодов и карточки</figcaption>
        </figure>
        <figure class="glass rounded-2xl overflow-hidden">
          <img src="/support/support.png" alt="Админ-панель поддержки CODE QR PRO" class="w-full h-40 object-cover object-top" loading="lazy">
          <figcaption class="px-3 py-2 text-xs text-slate-500">Поддержка и админ-панель</figcaption>
        </figure>
      </div>

      <div class="grid md:grid-cols-2 gap-4 mt-6">
        <div class="glass rounded-2xl p-5">
          <h2 class="font-semibold">На что идёт поддержка</h2>
          <ul class="text-sm text-slate-500 mt-2 space-y-1.5 list-disc pl-5">
            <li>серверы, домены и резервное копирование;</li>
            <li>внешние проверки кодов и каталог;</li>
            <li>развитие печати, API и коннекторов;</li>
            <li>поддержка пользователей и база знаний.</li>
          </ul>
        </div>
        <div class="glass rounded-2xl p-5">
          <h2 class="font-semibold">Поддержка — это не покупка тарифа</h2>
          <p class="text-sm text-slate-500 mt-2">Это добровольный разовый платёж. Он не даёт доступа к платным функциям и не заменяет подписку. Для работы с лимитами и командой выберите <router-link to="/pricing" class="text-brand-400 hover:underline">тариф</router-link>.</p>
        </div>
      </div>

      <div class="glass rounded-3xl p-6 mt-6">
        <h2 class="font-display font-bold text-xl">Выберите сумму</h2>
        <div class="flex flex-wrap gap-2 mt-3">
          <button v-for="p in presets" :key="p" class="btn-ghost !py-2 !px-4 text-sm" :class="Number(custom || amount) === p ? '!border-brand-500/60 !text-brand-400' : ''" @click="custom = ''; amount = p">{{ p.toLocaleString('ru') }} ₽</button>
          <input v-model="custom" type="number" min="100" max="100000" class="input !py-2 text-sm w-36" placeholder="Своя сумма">
        </div>
        <div class="grid sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label class="label !text-xs" for="don-email">Email для связи (необязательно)</label>
            <input id="don-email" v-model="email" type="email" class="input !py-2 text-sm" placeholder="you@example.com" autocomplete="email">
          </div>
          <div>
            <label class="label !text-xs" for="don-message">Сообщение (необязательно)</label>
            <input id="don-message" v-model="message" class="input !py-2 text-sm" maxlength="500" placeholder="Спасибо за…">
          </div>
        </div>
        <p class="text-xs text-slate-500 mt-3">К оплате: <b>{{ value.toLocaleString('ru') }} ₽</b>. Оплата через ЮKassa. Это добровольный платёж, возврат — через поддержку.</p>
        <p v-if="error" class="text-sm text-red-500 mt-2">{{ error }}</p>
        <button class="btn-primary w-full mt-4" :disabled="busy || value < 100" @click="donate">{{ busy ? 'Создаём платёж…' : 'Поддержать через ЮKassa' }}</button>
        <p class="text-[11px] text-slate-500 mt-2">Нажимая кнопку, вы соглашаетесь с <router-link to="/terms" class="text-brand-400 hover:underline">условиями</router-link> и <router-link to="/privacy" class="text-brand-400 hover:underline">политикой данных</router-link>. Сервис не является официальным сервисом «Честного ЗНАКа».</p>
      </div>

      <p class="text-center text-xs text-slate-500 mt-8">Хотите помочь не деньгами? Расскажите о сервисе, пришлите идею или сообщите об ошибке на <a href="mailto:code-qr-pro@mail.ru" class="text-brand-400 hover:underline">code-qr-pro@mail.ru</a>.</p>
    </div>
  </PublicShell>
</template>
