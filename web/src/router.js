import { createRouter, createWebHistory } from 'vue-router';
import { store } from './store.js';
import { applySeo } from './lib/seo.js';
import Landing from './pages/Landing.vue';
import Login from './pages/Login.vue';
import Register from './pages/Register.vue';
import Dashboard from './pages/Dashboard.vue';
import Generator from './pages/Generator.vue';
import Labels from './pages/Labels.vue';
import Reprint from './pages/Reprint.vue';
import Security from './pages/Security.vue';
import History from './pages/History.vue';
import Sets from './pages/Sets.vue';
import Billing from './pages/Billing.vue';
import ApiKeys from './pages/ApiKeys.vue';
import Cz from './pages/Cz.vue';
import Reviews from './pages/Reviews.vue';
import AdminLayout from './pages/admin/AdminLayout.vue';
import AdminOverview from './pages/admin/AdminOverview.vue';
import AdminUsers from './pages/admin/AdminUsers.vue';
import AdminUser from './pages/admin/AdminUser.vue';
import AdminOrders from './pages/admin/AdminOrders.vue';
import AdminJobs from './pages/admin/AdminJobs.vue';
import AdminAudit from './pages/admin/AdminAudit.vue';
import AdminMarketing from './pages/admin/AdminMarketing.vue';
import AdminSettings from './pages/admin/AdminSettings.vue';
import AdminStorage from './pages/admin/AdminStorage.vue';
import AdminAds from './pages/admin/AdminAds.vue';
import NotFound from './pages/NotFound.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Landing },
    { path: '/login', component: Login },
    { path: '/register', component: Register },
    { path: '/app', component: Dashboard, meta: { auth: true } },
    { path: '/app/generate', component: Generator, meta: { auth: true } },
    { path: '/app/labels', component: Labels, meta: { auth: true } },
    { path: '/app/sets', component: Sets, meta: { auth: true } },
    { path: '/app/reprint', component: Reprint, meta: { auth: true } },
    { path: '/app/billing', component: Billing, meta: { auth: true } },
    { path: '/app/apikeys', component: ApiKeys, meta: { auth: true } },
    { path: '/app/cz', component: Cz, meta: { auth: true } },
    { path: '/app/reviews', component: Reviews, meta: { auth: true } },
    { path: '/app/security', component: Security, meta: { auth: true } },
    { path: '/app/history', component: History, meta: { auth: true } },
    {
      path: '/app/admin',
      component: AdminLayout,
      meta: { auth: true, admin: true },
      children: [
        { path: '', component: AdminOverview, meta: { adminOnly: true } },
        { path: 'users', component: AdminUsers },
        { path: 'users/:id', component: AdminUser, props: true },
        { path: 'orders', component: AdminOrders, meta: { adminOnly: true } },
        { path: 'jobs', component: AdminJobs },
        { path: 'audit', component: AdminAudit, meta: { adminOnly: true } },
        { path: 'marketing', component: AdminMarketing, meta: { adminOnly: true } },
        { path: 'ads', component: AdminAds, meta: { adminOnly: true } },
        { path: 'storage', component: AdminStorage, meta: { adminOnly: true } },
        { path: 'settings', component: AdminSettings, meta: { adminOnly: true } }
      ]
    },
    { path: '/:pathMatch(.*)*', component: NotFound }
  ],
  scrollBehavior: () => ({ top: 0 })
});

router.beforeEach(async (to) => {
  if (!store.ready) await store.load();
  if (to.meta.auth && !store.user) return '/login';
  if (to.meta.admin && !['admin', 'support'].includes(store.user?.role)) return '/app';
  if (to.meta.adminOnly && store.user?.role !== 'admin') return '/app/admin/users';
  if ((to.path === '/login' || to.path === '/register') && store.user) return '/app';
});

router.afterEach((to) => applySeo(to.path));

export default router;
