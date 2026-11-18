<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { store } from '../store.js';

const router = useRouter();
const email = ref('');
const password = ref('');
const code = ref('');
const step = ref('password');
const ticket = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const d = await api.login({ email: email.value, password: password.value });
    if (d.twoFactor) {
      ticket.value = d.ticket;
      step.value = 'code';
    } else {
      store.setSession(d);
      router.push('/app');
    }
  } catch (e) { error.value = e.message; }
  busy.value = false;
}

async function submitCode() {
  error.value = '';
  busy.value = true;
  try {
    const d = await api.twoFactorChallenge({ ticket: ticket.value, code: code.value.trim() });
    store.setSession(d);
    router.push('/app');
  } catch (e) { error.value = e.message; }
  busy.value = false;
}

function back() {
  step.value = 'password';
  code.value = '';
  error.value = '';
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-20">
    <div class="glass rounded-3xl p-8">
      <template v-if="step === 'password'">
        <h1 class="font-display font-bold text-2xl mb-6">Вход</h1>
        <form @submit.prevent="submit" class="space-y-4">
          <div><label class="label" for="login-email">Email</label><input id="login-email" v-model="email" type="email" class="input" required autocomplete="email"></div>
          <div><label class="label" for="login-password">Пароль</label><input id="login-password" v-model="password" type="password" class="input" required autocomplete="current-password"></div>
          <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
          <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Входим…' : 'Войти' }}</button>
        </form>
      </template>

      <template v-else>
        <h1 class="font-display font-bold text-2xl mb-2">Подтверждение входа</h1>
        <p class="text-sm text-slate-500 mb-6">Введите код из приложения-аутентификатора или резервный код для <b>{{ email }}</b>.</p>
        <form @submit.prevent="submitCode" class="space-y-4">
          <div>
            <label class="label" for="login-code">Код</label>
            <input id="login-code" v-model="code" class="input text-center font-mono tracking-[0.3em]" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required autofocus placeholder="000000">
          </div>
          <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
          <button class="btn-primary w-full" :disabled="busy || code.length < 6">{{ busy ? 'Проверяем…' : 'Подтвердить' }}</button>
          <button type="button" class="btn-ghost w-full" @click="back">Назад</button>
        </form>
      </template>

      <p class="mt-5 text-sm text-slate-500 text-center">
        Нет аккаунта? <router-link to="/register" class="text-brand-400 font-medium">Зарегистрироваться</router-link>
      </p>
    </div>
  </div>
</template>
