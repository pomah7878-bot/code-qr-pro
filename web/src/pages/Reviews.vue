<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import SideNav from '../components/SideNav.vue';

const reviews = ref([]);
const count = ref(0);
const avg = ref(0);
const mine = ref(null);
const rating = ref(5);
const text = ref('');
const authorName = ref('');
const error = ref('');
const notice = ref('');
const busy = ref(false);

async function load() {
  try {
    const d = await api.reviews();
    reviews.value = d.reviews; count.value = d.count; avg.value = d.avgRating;
    if (store.user) {
      const m = await api.myReview();
      mine.value = m.review;
      if (m.review) { rating.value = m.review.rating; text.value = m.review.text; authorName.value = m.review.authorName; }
      else authorName.value = store.user.name || '';
    }
  } catch (e) { error.value = e.message; }
}
async function submit() {
  error.value = ''; notice.value = ''; busy.value = true;
  try {
    await api.submitReview({ rating: rating.value, text: text.value, authorName: authorName.value });
    notice.value = 'Спасибо! Отзыв отправлен на модерацию и появится после проверки.';
    await load();
  } catch (e) { error.value = e.message; }
  busy.value = false;
}
async function removeMine() {
  if (!mine.value) return;
  try { await api.deleteReview(mine.value.id); mine.value = null; text.value = ''; rating.value = 5; notice.value = 'Отзыв удалён'; await load(); }
  catch (e) { error.value = e.message; }
}
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const fmt = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('ru') : '';
const statusText = (s) => s === 'approved' ? 'опубликован' : s === 'hidden' ? 'скрыт модератором' : 'на модерации';
onMounted(load);
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/reviews" />
    <section class="space-y-6 min-w-0">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <h1 class="font-display font-bold text-3xl">Отзывы</h1>
        <div v-if="count" class="text-sm text-slate-500"><span class="text-amber-500 text-lg">★</span> <b class="text-slate-700 dark:text-slate-200">{{ avg }}</b> · {{ count }} отзывов</div>
      </div>

      <div v-if="store.user" class="glass rounded-2xl p-6">
        <h2 class="font-display font-semibold mb-3">{{ mine ? 'Ваш отзыв' : 'Оставить отзыв' }}</h2>
        <div class="flex items-center gap-1 mb-3 text-2xl">
          <button v-for="n in 5" :key="n" @click="rating = n" class="transition" :class="n <= rating ? 'text-amber-500' : 'text-slate-300 dark:text-white/20'">★</button>
          <span class="text-sm text-slate-500 ml-2">{{ rating }} из 5</span>
        </div>
        <input v-model="authorName" class="input mb-3" placeholder="Ваше имя (как подписать отзыв)" maxlength="60">
        <textarea v-model="text" rows="4" class="input" placeholder="Расскажите о вашем опыте (минимум 10 символов)" maxlength="2000"></textarea>
        <div class="flex gap-3 mt-3">
          <button class="btn-primary" :disabled="busy" @click="submit">{{ busy ? 'Отправляем…' : (mine ? 'Обновить отзыв' : 'Отправить отзыв') }}</button>
          <button v-if="mine" class="btn-ghost text-red-500" @click="removeMine">Удалить</button>
        </div>
        <p v-if="mine" class="text-xs mt-2" :class="mine.status === 'approved' ? 'text-emerald-500' : 'text-amber-500'">Статус: {{ statusText(mine.status) }}</p>
      </div>
      <div v-else class="glass rounded-2xl p-6 text-sm text-slate-500">
        <router-link to="/login" class="text-brand-400 font-medium">Войдите</router-link>, чтобы оставить отзыв.
      </div>

      <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

      <div class="space-y-4">
        <div v-for="r in reviews" :key="r.id" class="glass rounded-2xl p-5">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-amber-500">{{ stars(r.rating) }}</span>
            <b class="text-sm">{{ r.authorName }}</b>
            <span class="text-xs text-slate-500 ml-auto">{{ fmt(r.createdAt) }}</span>
          </div>
          <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{{ r.text }}</p>
        </div>
        <p v-if="!reviews.length" class="text-sm text-slate-500 text-center py-6">Отзывов пока нет — будьте первым!</p>
      </div>
    </section>
  </div>
</template>
