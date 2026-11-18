import { createRouter, createWebHistory } from 'vue-router';
import { store } from './store.js';
import Landing from './pages/Landing.vue';
import Login from './pages/Login.vue';
import Register from './pages/Register.vue';
import Dashboard from './pages/Dashboard.vue';
import Generator from './pages/Generator.vue';
import Labels from './pages/Labels.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Landing },
    { path: '/login', component: Login },
    { path: '/register', component: Register },
    { path: '/app', component: Dashboard, meta: { auth: true } },
    { path: '/app/generate', component: Generator, meta: { auth: true } },
    { path: '/app/labels', component: Labels, meta: { auth: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ],
  scrollBehavior: () => ({ top: 0 })
});

router.beforeEach(async (to) => {
  if (!store.ready) await store.load();
  if (to.meta.auth && !store.user) return '/login';
  if ((to.path === '/login' || to.path === '/register') && store.user) return '/app';
});

export default router;
