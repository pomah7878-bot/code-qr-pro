import { createRouter, createWebHistory } from 'vue-router';
import { store } from './store.js';
import Landing from './pages/Landing.vue';
import Login from './pages/Login.vue';
import Register from './pages/Register.vue';
import Dashboard from './pages/Dashboard.vue';
import Generator from './pages/Generator.vue';
import Labels from './pages/Labels.vue';
import Billing from './pages/Billing.vue';
import Admin from './pages/Admin.vue';
import ApiKeys from './pages/ApiKeys.vue';
import Cz from './pages/Cz.vue';
import Reviews from './pages/Reviews.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Landing },
    { path: '/login', component: Login },
    { path: '/register', component: Register },
    { path: '/app', component: Dashboard, meta: { auth: true } },
    { path: '/app/generate', component: Generator, meta: { auth: true } },
    { path: '/app/labels', component: Labels, meta: { auth: true } },
    { path: '/app/billing', component: Billing, meta: { auth: true } },
    { path: '/app/admin', component: Admin, meta: { auth: true } },
    { path: '/app/apikeys', component: ApiKeys, meta: { auth: true } },
    { path: '/app/cz', component: Cz, meta: { auth: true } },
    { path: '/app/reviews', component: Reviews, meta: { auth: true } },
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
