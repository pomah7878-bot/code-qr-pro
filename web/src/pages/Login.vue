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
const notice = ref('');
const busy = ref(false);
const resetCode = ref('');
const newPassword = ref('');
const newPassword2 = ref('');

async function submit() {
  error.value = '';
  notice.value = '';
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

async function requestReset() {
  error.value = '';
  notice.value = '';
  if (!email.value.trim()) { error.value = 'Укажите email'; return; }
  busy.value = true;
  try {
    const d = await api.forgotPassword({ email: email.value.trim() });
    step.value = 'reset';
    resetCode.value = '';
    newPassword.value = '';
    newPassword2.value = '';
    notice.value = d.message || 'Код отправлен на почту';
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function submitReset() {
  error.value = '';
  notice.value = '';
  if (resetCode.value.trim().length !== 6) { error.value = 'Введите 6-значный код из письма'; return; }
  if (newPassword.value.length < 8) { error.value = 'Новый пароль минимум 8 символов'; return; }
  if (newPassword.value !== newPassword2.value) { error.value = 'Пароли не совпадают'; return; }
  busy.value = true;
  try {
    await api.resetPassword({ email: email.value.trim(), code: resetCode.value.trim(), password: newPassword.value });
    step.value = 'password';
    password.value = '';
    resetCode.value = '';
    newPassword.value = '';
    newPassword2.value = '';
    notice.value = 'Пароль изменён. Войдите с новым паролем.';
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

function back() {
  step.value = 'password';
  code.value = '';
  resetCode.value = '';
  newPassword.value = '';
  newPassword2.value = '';
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
          <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
          <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Входим…' : 'Войти' }}</button>
          <button type="button" class="text-sm text-brand-400 font-medium" @click="step = 'forgot'; error = ''; notice = ''">Забыли пароль?</button>
        </form>
      </template>

      <template v-else-if="step === 'code'">
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

      <template v-else-if="step === 'forgot'">
        <h1 class="font-display font-bold text-2xl mb-2">Восстановление пароля</h1>
        <p class="text-sm text-slate-500 mb-6">Укажите email, на который зарегистрирован аккаунт. Мы отправим код для смены пароля.</p>
        <form @submit.prevent="requestReset" class="space-y-4">
          <div><label class="label" for="forgot-email">Email</label><input id="forgot-email" v-model="email" type="email" class="input" required autocomplete="email"></div>
          <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
          <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Отправляем…' : 'Отправить код' }}</button>
          <button type="button" class="btn-ghost w-full" @click="back">Назад ко входу</button>
        </form>
      </template>

      <template v-else>
        <h1 class="font-display font-bold text-2xl mb-2">Новый пароль</h1>
        <p class="text-sm text-slate-500 mb-6">Код отправлен на <b>{{ email }}</b>. Введите его и придумайте новый пароль.</p>
        <form @submit.prevent="submitReset" class="space-y-4">
          <div>
            <label class="label" for="reset-code">Код из письма</label>
            <input id="reset-code" v-model="resetCode" class="input text-center font-mono tracking-[0.3em]" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required autofocus placeholder="000000">
          </div>
          <div><label class="label" for="reset-password">Новый пароль</label><input id="reset-password" v-model="newPassword" type="password" class="input" required minlength="8" autocomplete="new-password"></div>
          <div><label class="label" for="reset-password2">Повторите пароль</label><input id="reset-password2" v-model="newPassword2" type="password" class="input" required minlength="8" autocomplete="new-password"></div>
          <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
          <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
          <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Меняем…' : 'Сменить пароль' }}</button>
          <button type="button" class="btn-ghost w-full" :disabled="busy" @click="requestReset">Отправить код ещё раз</button>
          <button type="button" class="btn-ghost w-full" @click="back">Назад ко входу</button>
        </form>
      </template>

      <p class="mt-5 text-sm text-slate-500 text-center">
        Нет аккаунта? <router-link to="/register" class="text-brand-400 font-medium">Зарегистрироваться</router-link>
      </p>
    </div>
  </div>
</template>
