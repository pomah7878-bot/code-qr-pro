<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import BrandIcon from '../../components/BrandIcon.vue';

const ads = ref([]);
const totals = ref({ total: 0, active: 0, revenue: 0, impressions: 0, clicks: 0 });
const loading = ref(true);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const open = ref(false);
const editing = ref(null);
const imageData = ref('');
const removeImage = ref(false);

const empty = () => ({
  advertiser: '', title: '', text: '', targetUrl: '', placement: 'landing_banner',
  status: 'draft', price: 0, paid: false, startsAt: '', endsAt: '',
  impressionLimit: 0, clickLimit: 0
});
const form = reactive(empty());

const placements = [
  { id: 'landing_banner', label: 'Главная — под первым экраном' },
  { id: 'landing_middle', label: 'Главная — после блока возможностей' },
  { id: 'landing_bottom', label: 'Главная — перед FAQ' },
  { id: 'app_banner', label: 'Кабинет — под приветствием' },
  { id: 'app_bottom', label: 'Кабинет — внизу страницы' }
];
const statusLabels = { draft: 'Черновик', active: 'Активна', paused: 'Пауза', ended: 'Завершена' };
const statusClass = { draft: 'text-slate-500', active: 'text-emerald-500', paused: 'text-amber-500', ended: 'text-slate-400' };
const sqlToIso = (s) => s ? new Date(String(s).replace(' ', 'T') + 'Z').toISOString() : '';
const localInput = (s) => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localToIso = (s) => s ? new Date(s).toISOString() : '';
const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const money = (n) => Number(n || 0).toLocaleString('ru');
const ctr = (a) => a.impressions ? `${(a.clicks / a.impressions * 100).toFixed(1)}%` : '—';
const preview = computed(() => imageData.value || (!removeImage.value && editing.value?.imageUrl) || '');
const placementLabel = computed(() => placements.find((p) => p.id === form.placement)?.label || form.placement);
const statsOpen = ref(false);
const statsAd = ref(null);
const stats = ref(null);
const statsLoading = ref(false);
const statsDays = ref(30);

async function openStats(ad) {
  statsAd.value = ad; statsOpen.value = true; stats.value = null; statsLoading.value = true; error.value = '';
  try { stats.value = await api.adminAdStats(ad.id, statsDays.value); }
  catch (e) { error.value = e.message; }
  finally { statsLoading.value = false; }
}
async function reloadStats() {
  if (!statsAd.value) return;
  statsLoading.value = true;
  try { stats.value = await api.adminAdStats(statsAd.value.id, statsDays.value); }
  catch (e) { error.value = e.message; }
  finally { statsLoading.value = false; }
}
const maxStat = computed(() => Math.max(1, ...(stats.value?.daily || []).map((d) => Math.max(d.impressions, d.clicks))));
const barPct = (n) => `${Math.max(0, Math.round((n / maxStat.value) * 100))}%`;

async function load() {
  loading.value = true; error.value = '';
  try { const d = await api.adminAds(); ads.value = d.ads; totals.value = d.totals; }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}

function resetForm() {
  Object.assign(form, empty());
  imageData.value = ''; removeImage.value = false;
}

function openNew() {
  editing.value = null; resetForm(); open.value = true; error.value = '';
}

function openEdit(ad) {
  editing.value = ad;
  Object.assign(form, {
    advertiser: ad.advertiser, title: ad.title, text: ad.text, targetUrl: ad.targetUrl,
    placement: ad.placement, status: ad.status, price: ad.price, paid: ad.paid,
    startsAt: localInput(ad.startsAt),
    endsAt: localInput(ad.endsAt),
    impressionLimit: ad.impressionLimit, clickLimit: ad.clickLimit
  });
  imageData.value = ''; removeImage.value = false; open.value = true; error.value = '';
}

function onImage(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { error.value = 'Нужна картинка PNG, JPEG или WebP'; return; }
  if (file.size > 2_500_000) { error.value = 'Картинка больше 2,5 МБ'; return; }
  const reader = new FileReader();
  reader.onload = () => { imageData.value = String(reader.result); removeImage.value = false; };
  reader.readAsDataURL(file);
}

async function save() {
  error.value = ''; notice.value = '';
  busy.value = true;
  try {
    const body = {
      ...form,
      startsAt: localToIso(form.startsAt),
      endsAt: localToIso(form.endsAt),
      image: imageData.value || undefined,
      removeImage: removeImage.value
    };
    if (editing.value) await api.adminUpdateAd(editing.value.id, body);
    else await api.adminCreateAd(body);
    open.value = false;
    notice.value = editing.value ? 'Кампания обновлена' : 'Кампания создана';
    await load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function toggle(ad) {
  busy.value = true; error.value = '';
  try {
    await api.adminUpdateAd(ad.id, {
      advertiser: ad.advertiser, title: ad.title, text: ad.text, targetUrl: ad.targetUrl,
      placement: ad.placement, status: ad.status === 'active' ? 'paused' : 'active',
      price: ad.price, paid: ad.paid, startsAt: sqlToIso(ad.startsAt), endsAt: sqlToIso(ad.endsAt),
      impressionLimit: ad.impressionLimit, clickLimit: ad.clickLimit
    });
    await load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function remove(ad) {
  if (!confirm(`Удалить рекламную кампанию «${ad.title}»?`)) return;
  busy.value = true; error.value = '';
  try { await api.adminDeleteAd(ad.id); notice.value = 'Кампания удалена'; await load(); }
  catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-bold text-xl">Реклама на сайте</h2>
        <p class="text-xs text-slate-500 mt-1">Кампании показываются только после статуса «Активна» и отметки «Оплачено».</p>
      </div>
      <button class="btn-primary !py-2 !px-4 text-sm" @click="openNew">+ Новая кампания</button>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ totals.total }}</div><div class="text-xs text-slate-500 mt-1">кампаний</div></div>
      <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold text-emerald-500">{{ totals.active }}</div><div class="text-xs text-slate-500 mt-1">активных</div></div>
      <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ money(totals.revenue) }} ₽</div><div class="text-xs text-slate-500 mt-1">оплачено</div></div>
      <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ Number(totals.impressions || 0).toLocaleString('ru') }}</div><div class="text-xs text-slate-500 mt-1">показов</div></div>
      <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ Number(totals.clicks || 0).toLocaleString('ru') }}</div><div class="text-xs text-slate-500 mt-1">кликов</div></div>
    </div>

    <p v-if="loading" class="text-sm text-slate-500">Загружаем кампании…</p>
    <div v-else class="glass rounded-2xl overflow-x-auto">
      <table class="w-full text-sm min-w-[980px]">
        <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
          <th class="p-3">Кампания</th><th class="p-3">Место</th><th class="p-3">Период</th><th class="p-3">Цена</th><th class="p-3">Оплата</th><th class="p-3">Статус</th><th class="p-3">Показы</th><th class="p-3">Клики</th><th class="p-3">CTR</th><th class="p-3"></th>
        </tr></thead>
        <tbody>
          <tr v-for="a in ads" :key="a.id" class="border-b border-slate-100 dark:border-white/5 align-top">
            <td class="p-3">
              <div class="flex gap-2">
                <img v-if="a.imageUrl" :src="a.imageUrl" alt="" class="w-16 h-10 rounded object-cover border border-slate-200 dark:border-white/10">
                <div class="min-w-0"><div class="font-medium truncate max-w-[220px]">{{ a.title }}</div><div class="text-xs text-slate-500 truncate max-w-[220px]">{{ a.advertiser }}</div></div>
              </div>
            </td>
            <td class="p-3 text-xs">{{ placements.find((p) => p.id === a.placement)?.label || a.placement }}</td>
            <td class="p-3 text-xs text-slate-500">{{ fmtDate(a.startsAt) }}<br>{{ fmtDate(a.endsAt) }}</td>
            <td class="p-3">{{ money(a.price) }} ₽</td>
            <td class="p-3"><span class="text-xs" :class="a.paid ? 'text-emerald-500' : 'text-amber-500'">{{ a.paid ? 'Оплачено' : 'Не оплачено' }}</span></td>
            <td class="p-3"><span class="text-xs" :class="statusClass[a.status]">{{ statusLabels[a.status] || a.status }}</span></td>
            <td class="p-3">{{ Number(a.impressions).toLocaleString('ru') }}</td>
            <td class="p-3">{{ Number(a.clicks).toLocaleString('ru') }}</td>
            <td class="p-3">{{ ctr(a) }}</td>
            <td class="p-3 text-right whitespace-nowrap">
              <button class="btn-ghost !py-1 !px-2 text-xs" @click="openEdit(a)">Изменить</button>
              <button class="btn-ghost !py-1 !px-2 text-xs" @click="openStats(a)">Статистика</button>
              <button class="btn-ghost !py-1 !px-2 text-xs" :disabled="busy" @click="toggle(a)">{{ a.status === 'active' ? 'Пауза' : 'Запустить' }}</button>
              <button class="btn-ghost !py-1 !px-2 text-xs text-red-500" :disabled="busy" @click="remove(a)">Удалить</button>
            </td>
          </tr>
          <tr v-if="!ads.length"><td colspan="10" class="p-6 text-center text-slate-500">Кампаний пока нет.</td></tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm p-4 overflow-y-auto" @click.self="open = false">
        <div class="mx-auto mt-8 w-full max-w-2xl rounded-2xl bg-white dark:bg-ink-900 border border-slate-200 dark:border-white/10 p-5 shadow-2xl">
          <div class="flex items-start justify-between gap-2 mb-4">
            <h3 class="font-display font-bold text-xl">{{ editing ? 'Изменить кампанию' : 'Новая кампания' }}</h3>
            <button class="text-slate-400 text-xl" @click="open = false"><BrandIcon name="close" :size="18" /></button>
          </div>
          <div class="grid md:grid-cols-2 gap-3">
            <div><label class="label !text-xs">Рекламодатель</label><input v-model="form.advertiser" class="input !py-2 text-sm" placeholder="ООО «Ромашка»"></div>
            <div><label class="label !text-xs">Цена, ₽</label><input v-model.number="form.price" type="number" min="0" class="input !py-2 text-sm"></div>
            <div class="md:col-span-2"><label class="label !text-xs">Заголовок</label><input v-model="form.title" class="input !py-2 text-sm" placeholder="Скидка на термопринтеры"></div>
            <div class="md:col-span-2"><label class="label !text-xs">Текст</label><textarea v-model="form.text" rows="2" class="input !py-2 text-sm" placeholder="Короткое описание"></textarea></div>
            <div class="md:col-span-2"><label class="label !text-xs">Ссылка</label><input v-model="form.targetUrl" class="input !py-2 text-sm" placeholder="https://..."></div>
            <div><label class="label !text-xs">Место</label><select v-model="form.placement" class="input !py-2 text-sm"><option v-for="p in placements" :key="p.id" :value="p.id">{{ p.label }}</option></select></div>
            <div><label class="label !text-xs">Статус</label><select v-model="form.status" class="input !py-2 text-sm"><option value="draft">Черновик</option><option value="active">Активна</option><option value="paused">Пауза</option><option value="ended">Завершена</option></select></div>
            <div><label class="label !text-xs">Начало</label><input v-model="form.startsAt" type="datetime-local" class="input !py-2 text-sm"></div>
            <div><label class="label !text-xs">Окончание</label><input v-model="form.endsAt" type="datetime-local" class="input !py-2 text-sm"></div>
            <div><label class="label !text-xs">Лимит показов</label><input v-model.number="form.impressionLimit" type="number" min="0" class="input !py-2 text-sm" placeholder="0 — без лимита"></div>
            <div><label class="label !text-xs">Лимит кликов</label><input v-model.number="form.clickLimit" type="number" min="0" class="input !py-2 text-sm" placeholder="0 — без лимита"></div>
            <label class="flex items-center gap-2 text-sm md:col-span-2"><input v-model="form.paid" type="checkbox"> Оплачено — можно показывать</label>
            <div class="md:col-span-2">
              <label class="label !text-xs">Картинка (PNG/JPEG/WebP, до 2,5 МБ)</label>
              <div class="flex flex-wrap items-center gap-3">
                <input type="file" accept="image/png,image/jpeg,image/webp" class="text-xs" @change="onImage">
                <label v-if="editing?.imageUrl" class="flex items-center gap-1 text-xs"><input v-model="removeImage" type="checkbox"> удалить текущую</label>
              </div>
              <img v-if="preview" :src="preview" alt="Предпросмотр" class="mt-2 max-h-28 rounded-lg border border-slate-200 dark:border-white/10">
            </div>
            <div class="md:col-span-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
              <div class="text-[10px] uppercase tracking-widest text-amber-600/80 mb-2">Предпросмотр · {{ placementLabel }}</div>
              <div class="flex items-center gap-3">
                <img v-if="preview" :src="preview" alt="" class="h-14 w-24 rounded-lg object-cover border border-slate-200 dark:border-white/10">
                <div class="min-w-0">
                  <div class="font-semibold text-sm truncate">{{ form.title || 'Заголовок объявления' }}</div>
                  <div class="text-xs text-slate-500 line-clamp-2">{{ form.text || 'Текст объявления' }}</div>
                  <div class="text-[11px] text-slate-400 mt-1">{{ form.advertiser || 'Рекламодатель' }} · Реклама</div>
                </div>
              </div>
            </div>
          </div>
          <p v-if="error" class="text-sm text-red-500 mt-3">{{ error }}</p>
          <div class="flex justify-end gap-2 mt-4">
            <button class="btn-ghost !py-2 text-sm" @click="open = false">Отмена</button>
            <button class="btn-primary !py-2 text-sm" :disabled="busy" @click="save">{{ busy ? 'Сохраняем…' : 'Сохранить' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="statsOpen" class="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm p-4 overflow-y-auto" @click.self="statsOpen = false">
        <div class="mx-auto mt-8 w-full max-w-3xl rounded-2xl bg-white dark:bg-ink-900 border border-slate-200 dark:border-white/10 p-5 shadow-2xl">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 class="font-display font-bold text-xl">Статистика</h3>
              <p class="text-xs text-slate-500 mt-1">{{ statsAd?.title }}</p>
            </div>
            <div class="flex items-center gap-2">
              <select v-model.number="statsDays" class="input !py-1.5 !px-2 text-xs" @change="reloadStats">
                <option :value="7">7 дней</option>
                <option :value="14">14 дней</option>
                <option :value="30">30 дней</option>
                <option :value="90">90 дней</option>
              </select>
              <button class="text-slate-400 text-xl" @click="statsOpen = false"><BrandIcon name="close" :size="18" /></button>
            </div>
          </div>
          <p v-if="error" class="text-sm text-red-500 mb-3">{{ error }}</p>
          <p v-if="statsLoading" class="text-sm text-slate-500">Загружаем статистику…</p>
          <template v-else-if="stats">
            <div class="grid grid-cols-3 gap-3 mb-5">
              <div class="rounded-xl bg-slate-50 dark:bg-white/[0.04] p-3"><div class="text-2xl font-extrabold">{{ stats.totals.impressions.toLocaleString('ru') }}</div><div class="text-xs text-slate-500">показов</div></div>
              <div class="rounded-xl bg-slate-50 dark:bg-white/[0.04] p-3"><div class="text-2xl font-extrabold">{{ stats.totals.clicks.toLocaleString('ru') }}</div><div class="text-xs text-slate-500">кликов</div></div>
              <div class="rounded-xl bg-slate-50 dark:bg-white/[0.04] p-3"><div class="text-2xl font-extrabold">{{ stats.totals.ctr.toFixed(1) }}%</div><div class="text-xs text-slate-500">CTR</div></div>
            </div>
            <div class="flex items-end gap-1 h-44 border-b border-slate-200 dark:border-white/10 pb-1">
              <div v-for="(d, i) in stats.daily" :key="d.day" class="flex-1 min-w-0 flex items-end justify-center gap-[1px] h-full" :title="`${d.day}: ${d.impressions} показов, ${d.clicks} кликов`">
                <div class="w-1/2 rounded-t bg-brand-500/80" :style="{ height: barPct(d.impressions) }"></div>
                <div class="w-1/2 rounded-t bg-emerald-500/80" :style="{ height: barPct(d.clicks) }"></div>
              </div>
            </div>
            <div class="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>{{ stats.daily[0]?.day.slice(5) }}</span>
              <span class="flex items-center gap-2"><i class="inline-block w-2 h-2 rounded bg-brand-500"></i> показы <i class="inline-block w-2 h-2 rounded bg-emerald-500"></i> клики</span>
              <span>{{ stats.daily[stats.daily.length - 1]?.day.slice(5) }}</span>
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>
