<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';

const form = reactive({
  endpoint: '', region: 'auto', bucket: '', prefix: 'artifacts',
  accessKey: '', secretKey: '', forcePathStyle: false
});
const state = reactive({ configured: false, accessKeySet: false, secretKeySet: false });
const error = ref('');
const notice = ref('');
const busy = ref(false);

async function load() {
  error.value = '';
  try {
    const d = await api.adminStorage();
    Object.assign(state, d);
    form.endpoint = d.endpoint || '';
    form.region = d.region || 'auto';
    form.bucket = d.bucket || '';
    form.prefix = d.prefix || 'artifacts';
    form.forcePathStyle = Boolean(d.forcePathStyle);
  } catch (e) { error.value = e.message; }
}

async function save() {
  error.value = ''; notice.value = ''; busy.value = true;
  try {
    const d = await api.adminSaveStorage(form);
    state.configured = d.configured;
    notice.value = d.configured ? 'S3/R2 сохранено — новые архивы пойдут в объектное хранилище' : 'Сохранено, но S3 не настроен — архивы остаются локально';
    await load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function test() {
  error.value = ''; notice.value = ''; busy.value = true;
  try {
    const d = await api.adminTestStorage();
    notice.value = `Подключение работает: ${d.bucket}`;
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="glass rounded-2xl p-6">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div>
        <h2 class="font-display font-semibold">Хранилище архивов (S3/R2)</h2>
        <p class="text-xs text-slate-500 mt-1">Cloudflare R2, Selectel, MinIO или другой S3-совместимый сервис. Если не настроено — архивы хранятся локально.</p>
      </div>
      <span class="text-xs rounded-full px-2 py-0.5" :class="state.configured ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-500/10 text-slate-500'">{{ state.configured ? 'S3 подключён' : 'локально' }}</span>
    </div>

    <div class="grid md:grid-cols-2 gap-3">
      <div><label class="label !text-xs" for="s3-endpoint">Endpoint</label><input id="s3-endpoint" v-model="form.endpoint" class="input !py-2 text-sm" placeholder="https://...r2.cloudflarestorage.com"></div>
      <div><label class="label !text-xs" for="s3-region">Region</label><input id="s3-region" v-model="form.region" class="input !py-2 text-sm" placeholder="auto"></div>
      <div><label class="label !text-xs" for="s3-bucket">Bucket</label><input id="s3-bucket" v-model="form.bucket" class="input !py-2 text-sm" placeholder="code-qr-archives"></div>
      <div><label class="label !text-xs" for="s3-prefix">Папка</label><input id="s3-prefix" v-model="form.prefix" class="input !py-2 text-sm" placeholder="artifacts"></div>
      <div><label class="label !text-xs" for="s3-access">Access Key</label><input id="s3-access" v-model="form.accessKey" class="input !py-2 text-sm font-mono" :placeholder="state.accessKeySet ? 'сохранён — оставьте пустым' : 'access key'"></div>
      <div><label class="label !text-xs" for="s3-secret">Secret Key</label><input id="s3-secret" v-model="form.secretKey" type="password" class="input !py-2 text-sm font-mono" :placeholder="state.secretKeySet ? 'сохранён — оставьте пустым' : 'secret key'"></div>
      <label class="flex items-center gap-2 text-sm md:col-span-2"><input v-model="form.forcePathStyle" type="checkbox"> Path-style URL (MinIO и некоторые провайдеры)</label>
    </div>

    <p v-if="error" class="text-sm text-red-500 mt-3">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500 mt-3">{{ notice }}</p>
    <div class="flex flex-wrap gap-2 mt-3">
      <button class="btn-primary !py-2 text-sm" :disabled="busy" @click="save">{{ busy ? 'Сохраняем…' : 'Сохранить' }}</button>
      <button class="btn-ghost !py-2 text-sm" :disabled="busy || !state.configured" @click="test">Проверить подключение</button>
    </div>
  </div>
</template>
