<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';

const plans = ref(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const FORMATS = ['png', 'svg', 'pdf', 'zip'];

async function load() {
  error.value = '';
  try {
    const d = await api.adminPlans();
    plans.value = { free: { ...d.free }, premium: { ...d.premium } };
  } catch (e) { error.value = e.message; }
}

function toggleFormat(plan, format) {
  const i = plans.value[plan].formats.indexOf(format);
  if (i === -1) plans.value[plan].formats.push(format);
  else if (plans.value[plan].formats.length > 1) plans.value[plan].formats.splice(i, 1);
}

async function save() {
  error.value = '';
  notice.value = '';
  busy.value = true;
  try {
    const d = await api.adminSavePlans({ free: plans.value.free, premium: plans.value.premium });
    plans.value = { free: { ...d.free }, premium: { ...d.premium } };
    notice.value = 'Лимиты тарифов сохранены';
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="glass rounded-2xl p-6">
    <h2 class="font-display font-semibold mb-1">Лимиты тарифов</h2>
    <p class="text-xs text-slate-500 mb-4">Что доступно на FREE и PREMIUM. Изменения применяются сразу, без деплоя.</p>
    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div v-if="plans" class="grid md:grid-cols-2 gap-4 mt-2">
      <div v-for="id in ['free', 'premium']" :key="id" class="rounded-2xl border border-slate-200 dark:border-white/10 p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-display font-semibold" :class="id === 'premium' ? 'grad-text' : ''">{{ id.toUpperCase() }}</h3>
          <span class="text-xs text-slate-500">{{ id === 'premium' ? 'платный' : 'базовый' }}</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label !text-xs" :for="`plan-${id}-codes`">Кодов в день</label>
            <input :id="`plan-${id}-codes`" v-model.number="plans[id].codesPerDay" type="number" min="1" max="1000000" class="input !py-2 text-sm">
          </div>
          <div>
            <label class="label !text-xs" :for="`plan-${id}-batch`">Строк в пакете</label>
            <input :id="`plan-${id}-batch`" v-model.number="plans[id].batchMax" type="number" min="1" max="100000" class="input !py-2 text-sm">
          </div>
          <div class="col-span-2">
            <label class="label !text-xs" :for="`plan-${id}-history`">История заданий, дней</label>
            <input :id="`plan-${id}-history`" v-model.number="plans[id].historyDays" type="number" min="1" max="3650" class="input !py-2 text-sm">
          </div>
        </div>
        <div class="mt-3">
          <div class="text-xs text-slate-500 mb-1.5">Форматы экспорта</div>
          <div class="flex flex-wrap gap-2">
            <label v-for="f in FORMATS" :key="f" class="flex items-center gap-1.5 text-sm">
              <input type="checkbox" :checked="plans[id].formats.includes(f)" @change="toggleFormat(id, f)"> {{ f.toUpperCase() }}
            </label>
          </div>
        </div>
        <div class="mt-3 space-y-1.5 text-sm">
          <label class="flex items-center gap-2"><input v-model="plans[id].apiAccess" type="checkbox"> API-доступ</label>
          <label class="flex items-center gap-2"><input v-model="plans[id].labelEditor" type="checkbox"> Редактор этикеток</label>
          <label class="flex items-center gap-2"><input v-model="plans[id].printBridge" type="checkbox"> Print Bridge</label>
        </div>
      </div>
    </div>

    <div class="flex justify-end mt-4">
      <button class="btn-primary !py-2 text-sm" :disabled="busy || !plans" @click="save">{{ busy ? 'Сохраняем…' : 'Сохранить лимиты' }}</button>
    </div>
  </div>
</template>
