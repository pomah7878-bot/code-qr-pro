<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { store } from '../store.js';
const router = useRouter();
const email = ref(''), password = ref(''), error = ref(''), busy = ref(false);
async function submit() {
  error.value = ''; busy.value = true;
  try {
    const d = await api.login({ email: email.value, password: password.value });
    store.setSession(d); router.push('/app');
  } catch (e) { error.value = e.message; }
  busy.value = false;
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-20">
    <div class="glass rounded-3xl p-8">
      <h1 class="font-display font-bold text-2xl mb-6">Вход</h1>
      <form @submit.prevent="submit" class="space-y-4">
        <div><label class="label">Email</label><input v-model="email" type="email" class="input" required autocomplete="email"></div>
        <div><label class="label">Пароль</label><input v-model="password" type="password" class="input" required autocomplete="current-password"></div>
        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Входим…' : 'Войти' }}</button>
      </form>
      <p class="mt-5 text-sm text-slate-500 text-center">
        Нет аккаунта? <router-link to="/register" class="text-brand-400 font-medium">Зарегистрироваться</router-link>
      </p>
    </div>
  </div>
</template>
