<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime } from '../../lib/format.js';
import BrandIcon from '../../components/BrandIcon.vue';

const rows = ref([]);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const search = ref('');
const form = reactive({ id: null, slug: '', title: '', summary: '', body: '', tags: '', published: true });

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((a) => `${a.title} ${a.slug} ${a.tags}`.toLowerCase().includes(q));
});

async function load() {
  loading.value = true; error.value = '';
  try { rows.value = (await api.adminKbList()).articles || []; }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}

function reset() {
  Object.assign(form, { id: null, slug: '', title: '', summary: '', body: '', tags: '', published: true });
  error.value = ''; notice.value = '';
}

async function select(a) {
  error.value = ''; notice.value = '';
  try {
    const r = await api.adminKbGet(a.id);
    const x = r.article;
    Object.assign(form, { id: x.id, slug: x.slug, title: x.title, summary: x.summary, body: x.body, tags: x.tags, published: Boolean(x.published) });
  } catch (e) { error.value = e.message; }
}

async function save() {
  busy.value = true; error.value = ''; notice.value = '';
  try {
    const r = await api.adminKbSave({
      id: form.id || undefined, slug: form.slug, title: form.title, summary: form.summary,
      body: form.body, tags: form.tags, published: form.published
    });
    notice.value = form.id ? 'Статья обновлена' : 'Статья создана';
    await load();
    if (!form.id && r.id) {
      const x = (await api.adminKbGet(r.id)).article;
      Object.assign(form, { id: x.id, slug: x.slug, title: x.title, summary: x.summary, body: x.body, tags: x.tags, published: Boolean(x.published) });
    }
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function remove() {
  if (!form.id) { reset(); return; }
  if (!window.confirm(`Удалить статью «${form.title}» навсегда?`)) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    await api.adminKbDelete(form.id);
    notice.value = 'Статья удалена';
    reset(); await load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold text-lg">Статьи и база знаний</h2>
        <p class="text-xs text-slate-500 mt-0.5">Публичные статьи для SEO, помощи и AI-помощника. Неопубликованные статьи скрыты с сайта.</p>
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" data-tooltip="Создать новую статью" @click="reset">Новая статья</button>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div class="grid lg:grid-cols-[320px_1fr] gap-4 items-start">
      <div class="glass rounded-2xl p-4">
        <input v-model="search" class="input !py-2 text-sm" placeholder="Поиск по статьям" data-tooltip="Поиск по заголовку, slug и тегам">
        <div class="mt-3 space-y-1 max-h-[60vh] overflow-auto">
          <button v-for="a in filtered" :key="a.id" class="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-100 dark:hover:bg-white/5" :class="form.id === a.id ? 'bg-brand-500/15 text-brand-400 font-semibold' : ''" @click="select(a)">
            <span class="block truncate">{{ a.title }}</span>
            <span class="block text-[11px] text-slate-500 truncate">{{ a.slug }}</span>
            <span v-if="!a.published" class="text-[10px] text-amber-500">черновик</span>
          </button>
          <div v-if="!filtered.length" class="text-sm text-slate-500 py-4 text-center">Статей нет.</div>
        </div>
      </div>

      <div class="glass rounded-2xl p-5 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-semibold">{{ form.id ? 'Редактирование статьи №' + form.id : 'Новая статья' }}</div>
          <a v-if="form.id && form.published" :href="'/articles/' + form.slug" target="_blank" rel="noopener" class="text-xs text-brand-400 hover:underline" data-tooltip="Открыть опубликованную статью на сайте">Открыть на сайте →</a>
        </div>

        <div class="grid sm:grid-cols-2 gap-3">
          <div><label class="label !text-xs">Slug (латиница)</label><input v-model="form.slug" class="input !py-2 text-sm" placeholder="marking-guide"></div>
          <div><label class="label !text-xs">Теги</label><input v-model="form.tags" class="input !py-2 text-sm" placeholder="маркировка, честный знак"></div>
          <div class="sm:col-span-2"><label class="label !text-xs">Заголовок</label><input v-model="form.title" class="input !py-2 text-sm"></div>
          <div class="sm:col-span-2"><label class="label !text-xs">Краткое описание</label><textarea v-model="form.summary" rows="2" class="input !py-2 text-sm"></textarea></div>
          <div class="sm:col-span-2"><label class="label !text-xs">Текст статьи</label><textarea v-model="form.body" rows="16" class="input !py-2 text-sm font-mono" placeholder="Текст статьи (Markdown/HTML в зависимости от рендера)"></textarea></div>
        </div>

        <label class="inline-flex items-center gap-2 text-sm"><input v-model="form.published" type="checkbox"> Опубликована на сайте</label>

        <div class="flex flex-wrap gap-2 pt-1">
          <button class="btn-primary !py-2 text-sm" :disabled="busy || !form.title || !form.slug" data-tooltip="Сохранить статью" @click="save">{{ busy ? 'Сохраняем…' : 'Сохранить' }}</button>
          <button v-if="form.id" class="btn-ghost !py-2 text-sm text-red-500" :disabled="busy" data-tooltip="Удалить статью навсегда" @click="remove">Удалить</button>
          <button class="btn-ghost !py-2 text-sm" :disabled="busy" @click="reset">Очистить</button>
        </div>
        <p class="text-[11px] text-slate-500">Изменения публикуются сразу после сохранения. Проверяйте текст и ссылки перед публикацией.</p>
      </div>
    </div>
  </div>
</template>
