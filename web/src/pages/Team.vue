<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import SideNav from '../components/SideNav.vue';

const error = ref('');
const notice = ref('');
const busy = ref(false);
const data = ref(null);
const activity = ref([]);
const inviting = ref(false);
const form = reactive({ email: '', name: '', role: 'operator' });

async function load() {
  error.value = '';
  try {
    const [team, act] = await Promise.all([api.teamInfo(), api.teamActivity().catch(() => ({ items: [] }))]);
    data.value = team;
    activity.value = act.items || [];
  } catch (e) {
    if (e.status === 403 || e.code === 'team_member_forbidden') error.value = 'Раздел доступен только владельцу аккаунта.';
    else error.value = e.message;
  }
}

async function invite() {
  error.value = ''; notice.value = '';
  if (!form.email.trim()) { error.value = 'Укажите email сотрудника'; return; }
  inviting.value = true;
  try {
    const r = await api.teamInvite({ email: form.email.trim(), name: form.name.trim(), role: form.role });
    notice.value = r.emailSent ? 'Приглашение отправлено на email.' : 'Письмо не отправлено — скопируйте ссылку и передайте сотруднику.';
    if (r.link && !r.emailSent) window.prompt('Ссылка для входа сотрудника:', r.link);
    form.email = ''; form.name = '';
    await load();
  } catch (e) { error.value = e.message; }
  finally { inviting.value = false; }
}

async function reinvite(m) {
  try {
    const r = await api.teamReinvite(m.id);
    if (r.emailSent) notice.value = 'Приглашение отправлено повторно.';
    else if (r.link) window.prompt('Новая ссылка для входа:', r.link);
    await load();
  } catch (e) { error.value = e.message; }
}

async function removeMember(m) {
  if (!window.confirm(`Отозвать доступ у ${m.email}?\nВсе сессии сотрудника будут завершены.`)) return;
  busy.value = true; error.value = '';
  try { await api.teamRemove(m.id); notice.value = 'Доступ отозван.'; await load(); }
  catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

function roleLabel(role) {
  return role === 'manager' ? 'Менеджер' : role === 'viewer' ? 'Просмотр' : 'Сотрудник';
}

function statusLabel(s) {
  return s === 'active' ? 'Активен' : s === 'invited' ? 'Приглашён' : s;
}

onMounted(load);
</script>

<template>
  <div class="max-w-[1680px] mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/team" />
    <section class="space-y-6 min-w-0">
      <div>
        <h1 class="font-display font-bold text-3xl">Команда</h1>
        <p class="text-sm text-slate-500 mt-1">Сотрудники работают в вашем аккаунте по приглашению. Вы можете отозвать доступ в любой момент.</p>
      </div>

      <div v-if="error" class="glass rounded-2xl p-4 text-sm text-red-500">{{ error }}</div>
      <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

      <template v-if="data">
        <div class="grid sm:grid-cols-3 gap-3">
          <div class="glass rounded-2xl p-4"><div class="text-xs text-slate-500">Мест для сотрудников</div><div class="text-2xl font-bold mt-1">{{ data.seats.used }} / {{ data.seats.limit }}</div></div>
          <div class="glass rounded-2xl p-4"><div class="text-xs text-slate-500">Свободно</div><div class="text-2xl font-bold mt-1">{{ data.seats.available }}</div></div>
          <div class="glass rounded-2xl p-4"><div class="text-xs text-slate-500">Тариф</div><div class="text-2xl font-bold mt-1 uppercase">{{ store.user?.plan || 'free' }}</div></div>
        </div>

        <div class="glass rounded-2xl p-5">
          <h2 class="font-semibold mb-3">Пригласить сотрудника</h2>
          <div class="grid sm:grid-cols-3 gap-3">
            <div class="sm:col-span-2">
              <label class="label !text-xs" for="team-email">Email</label>
              <input id="team-email" v-model="form.email" class="input !py-2 text-sm" type="email" placeholder="employee@company.ru" autocomplete="off">
            </div>
            <div>
              <label class="label !text-xs" for="team-role">Роль</label>
              <select id="team-role" v-model="form.role" class="input !py-2 text-sm">
                <option value="operator">Сотрудник</option>
                <option value="manager">Менеджер</option>
                <option value="viewer">Просмотр</option>
              </select>
            </div>
            <div class="sm:col-span-3">
              <label class="label !text-xs" for="team-name">Имя (необязательно)</label>
              <input id="team-name" v-model="form.name" class="input !py-2 text-sm" placeholder="Как обращаться к сотруднику">
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-3 mt-3">
            <button class="btn-primary" :disabled="inviting || data.seats.available <= 0" @click="invite">{{ inviting ? 'Отправляем…' : 'Пригласить' }}</button>
            <span v-if="data.seats.available <= 0" class="text-xs text-amber-500">Лимит мест исчерпан. Смените тариф или отзовите доступ.</span>
          </div>
        </div>

        <div class="glass rounded-2xl overflow-hidden">
          <div class="px-5 py-4 border-b border-slate-200 dark:border-white/10 font-semibold">Сотрудники</div>
          <div v-if="!data.members.length" class="px-5 py-8 text-sm text-slate-500">Пока никого нет. Пригласите первого сотрудника.</div>
          <div v-for="m in data.members" :key="m.id" class="px-5 py-4 border-b border-slate-100 dark:border-white/5 last:border-0 flex flex-wrap items-center gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">{{ m.name || m.email }}</div>
              <div class="text-xs text-slate-500 truncate">{{ m.email }} · {{ m.roleLabel || roleLabel(m.role) }} · {{ statusLabel(m.status) }}</div>
            </div>
            <button v-if="!m.hasAccount" class="btn-ghost !py-1.5 !px-2.5 text-xs" @click="reinvite(m)">Отправить снова</button>
            <span v-else class="text-[11px] text-slate-500">Личный вход</span>
            <button class="btn-ghost !py-1.5 !px-2.5 text-xs text-red-500" :disabled="busy" @click="removeMember(m)">Отозвать</button>
          </div>
        </div>

        <p v-if="data.seats.used > data.seats.limit" class="text-xs text-amber-500">На тарифе сейчас меньше мест, чем сотрудников ({{ data.seats.used }} из {{ data.seats.limit }}). Новые приглашения заблокированы; отзовите лишние доступы или смените тариф.</p>
        <div class="glass rounded-2xl p-5">
          <h2 class="font-semibold mb-3">Последние действия команды</h2>
          <div v-if="!activity.length" class="text-sm text-slate-500">Действий сотрудников пока нет.</div>
          <div v-for="a in activity" :key="a.type + '-' + a.id" class="flex flex-wrap items-start gap-2 py-2 border-b border-slate-100 dark:border-white/5 last:border-0 text-sm">
            <span class="text-slate-500 text-xs shrink-0">{{ a.createdAt }}</span>
            <span class="font-medium">{{ a.actor || 'Сотрудник' }}</span>
            <span class="text-slate-500">{{ a.type === 'job' ? 'создал задание' : 'выполнил операцию' }}: {{ a.title }}</span>
            <span class="ml-auto text-xs" :class="a.status === 'error' ? 'text-red-500' : 'text-slate-500'">{{ a.status }}</span>
          </div>
        </div>

        <p class="text-xs text-slate-500">Владелец аккаунта не занимает место в команде. Сотрудник активирует личный вход по ссылке и дальше входит на /login по email и паролю. Менеджер может управлять всеми операционными заданиями, сотрудник — только своими. Ссылка даёт доступ к вашему аккаунту, поэтому передавайте её лично. Роль «Просмотр» пока работает как ограничение интерфейса; для полного разделения прав используйте отдельный аккаунт.</p>
      </template>
      <div v-else-if="!error" class="text-sm text-slate-500">Загрузка…</div>
    </section>
  </div>
</template>
