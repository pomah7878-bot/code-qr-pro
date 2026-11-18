import { reactive } from 'vue';
import { api } from './api.js';

export const store = reactive({
  user: null, plan: null, usage: null, ready: false,
  async load() {
    try {
      const d = await api.me();
      this.user = d.user; this.plan = d.plan; this.usage = d.usage;
    } catch { this.user = null; }
    this.ready = true;
  },
  setSession(d) { this.user = d.user; this.load(); },
  async logout() { await api.logout(); this.user = null; this.plan = null; this.usage = null; }
});

export function initTheme() {
  const saved = localStorage.getItem('cq_theme') || 'dark';
  document.documentElement.classList.toggle('dark', saved === 'dark');
}
export function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('cq_theme', dark ? 'dark' : 'light');
}
