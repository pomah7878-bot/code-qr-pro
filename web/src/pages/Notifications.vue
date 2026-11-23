<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import SideNav from '../components/SideNav.vue';

const rows = ref([]);
const unread = ref(0);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true; error.value = '';
  try { const d = await api.notifications(); rows.value = d.notifications || []; unread.value = d.unread || 0; }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}

async function read(id) {
  try { await api.notificationsRead(id ? { id } : {}); await load(); }
  catch (e) { error.value = e.message; }
}

async function open(n) {
  if (!n.read_at) await api.notificationsRead({ id: n.id }).catch(() => {});
  if (n.link) window.location.href = n.link;
  else await load();
}

onMounted(load);
</script>

<template>
  <div class="max-w-[1680px] mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/notifications" />
    <section class="space-y-5 min-w-0">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="font-display font-bold text-3xl">Уведомления</h1>
          <p class="text-sm text-slate-500 mt-1">Комментарии, упоминания, назначения и действия команды.</p>
        </div>
        <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="!unread" @click="read()">Отметить всё прочитанным</button>
      </div>
      <div v-if="error" class="text-sm text-red-500">{{ error }}</div>
      <p v-if="loading" class="text-sm text-slate-500">Загружаем…</p>
      <p v-else-if="!rows.length" class="glass rounded-2xl p-8 text-sm text-slate-500">Уведомлений пока нет.</p>
      <div v-else class="space-y-2">
        <button v-for="n in rows" :key="n.id" class="glass rounded-2xl p-4 w-full text-left" :class="n.read_at ? '' : 'border-brand-500/30'" @click="open(n)">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold">{{ n.title }}</span>
            <span v-if="!n.read_at" class="text-[10px] rounded-full bg-brand-500/15 text-brand-400 px-2 py-0.5">новое</span>
            <span class="text-xs text-slate-500 ml-auto">{{ n.created_at }}</span>
          </div>
          <div class="text-sm text-slate-500 mt-1 whitespace-pre-wrap">{{ n.text }}</div>
        </button>
      </div>
    </section>
  </div>
</template>
