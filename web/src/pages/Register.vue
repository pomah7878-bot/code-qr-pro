<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { store } from '../store.js';
import { onPlansChanged } from '../lib/plans-sync.js';
const router = useRouter();
const name = ref(''), email = ref(''), password = ref(''), consent = ref(false), error = ref(''), busy = ref(false);
const CONSENT_VERSION = '2026-11-21';
const freeLimit = ref(50);
let plansSyncOff = null;
async function loadFreeLimit() {
  try {
    const plans = (await api.plans()).plans;
    const free = plans.find((p) => p.id === 'free');
    freeLimit.value = free?.dailyOps || Math.round((free?.opsPerPeriod || 600) / 30);
  } catch { /* остаётся значение по умолчанию */ }
}
onMounted(async () => {
  await loadFreeLimit();
  plansSyncOff = onPlansChanged(loadFreeLimit);
});
onUnmounted(() => { plansSyncOff?.(); });
async function submit() {
  error.value = '';
  if (!consent.value) {
    error.value = 'Подтвердите принятие документов и согласие на обработку персональных данных';
    return;
  }
  busy.value = true;
  try {
    const d = await api.register({ name: name.value, email: email.value, password: password.value, consent: true, consentVersion: CONSENT_VERSION });
    store.setSession(d); router.push('/app');
  } catch (e) { error.value = e.message; }
  busy.value = false;
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-20">
    <div class="glass rounded-3xl p-8">
      <h1 class="font-display font-bold text-2xl mb-1">Регистрация</h1>
      <p class="text-sm text-slate-500 mb-6">FREE-тариф: 600 операций в месяц (до {{ freeLimit.toLocaleString('ru') }} в день), без карты</p>
      <form @submit.prevent="submit" class="space-y-4">
        <div><label class="label">Имя</label><input v-model="name" class="input" autocomplete="name" placeholder="Как к вам обращаться"></div>
        <div><label class="label">Email</label><input v-model="email" type="email" class="input" required autocomplete="email"></div>
        <div><label class="label">Пароль</label><input v-model="password" type="password" class="input" required minlength="8" maxlength="200" autocomplete="new-password" placeholder="Минимум 8 символов"></div>
        <div class="flex items-start gap-2.5">
          <input id="register-consent" v-model="consent" type="checkbox" required class="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-500 focus:ring-brand-500">
          <label for="register-consent" class="text-xs text-slate-500 leading-relaxed">
            Я принимаю
            <router-link to="/terms" target="_blank" class="text-brand-400 font-medium">Пользовательское соглашение</router-link>
            и
            <router-link to="/offer" target="_blank" class="text-brand-400 font-medium">Публичную оферту</router-link>,
            даю согласие на обработку персональных данных в соответствии с
            <router-link to="/privacy" target="_blank" class="text-brand-400 font-medium">Политикой обработки персональных данных</router-link>.
          </label>
        </div>
        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="busy || !consent">{{ busy ? 'Создаём…' : 'Создать аккаунт' }}</button>
      </form>
      <p class="mt-5 text-sm text-slate-500 text-center">
        Уже есть аккаунт? <router-link to="/login" class="text-brand-400 font-medium">Войти</router-link>
      </p>
    </div>
  </div>
</template>
