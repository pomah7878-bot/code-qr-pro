import { createRouter, createWebHistory } from 'vue-router';
import { store } from './store.js';
import { applySeo } from './lib/seo.js';

// Лендинг грузим сразу (это первый экран для большинства посетителей),
// остальные страницы — отдельными чанками по требованию. Раньше весь
// интерфейс (включая xlsx для импорта и админку) лежал в одном файле
// ~850 КБ и скачивался даже на /app/reprint и /login.
const Landing = () => import('./pages/Landing.vue');
const Login = () => import('./pages/Login.vue');
const Register = () => import('./pages/Register.vue');
const Dashboard = () => import('./pages/Dashboard.vue');
const Generator = () => import('./pages/Generator.vue');
const Labels = () => import('./pages/Labels.vue');
const Reprint = () => import('./pages/Reprint.vue');
const Security = () => import('./pages/Security.vue');
const Team = () => import('./pages/Team.vue');
const TeamAccept = () => import('./pages/TeamAccept.vue');
const Notifications = () => import('./pages/Notifications.vue');
const History = () => import('./pages/History.vue');
const Sets = () => import('./pages/Sets.vue');
const Billing = () => import('./pages/Billing.vue');
const Pricing = () => import('./pages/Pricing.vue');
const PublicCheck = () => import('./pages/PublicCheck.vue');
const ApiKeys = () => import('./pages/ApiKeys.vue');
const Cz = () => import('./pages/Cz.vue');
const Reviews = () => import('./pages/Reviews.vue');
const AdminLayout = () => import('./pages/admin/AdminLayout.vue');
const AdminOverview = () => import('./pages/admin/AdminOverview.vue');
const AdminUsers = () => import('./pages/admin/AdminUsers.vue');
const AdminUser = () => import('./pages/admin/AdminUser.vue');
const AdminOrders = () => import('./pages/admin/AdminOrders.vue');
const AdminJobs = () => import('./pages/admin/AdminJobs.vue');
const AdminAudit = () => import('./pages/admin/AdminAudit.vue');
const AdminLogs = () => import('./pages/admin/AdminLogs.vue');
const AdminAi = () => import('./pages/admin/AdminAi.vue');
const AdminMarketing = () => import('./pages/admin/AdminMarketing.vue');
const AdminSettings = () => import('./pages/admin/AdminSettings.vue');
const AdminStorage = () => import('./pages/admin/AdminStorage.vue');
const AdminAds = () => import('./pages/admin/AdminAds.vue');
const NotFound = () => import('./pages/NotFound.vue');
const Assistant = () => import('./pages/Assistant.vue');
const Help = () => import('./pages/Help.vue');
const AdminSupport = () => import('./pages/admin/AdminSupport.vue');
const AdminBilling = () => import('./pages/admin/AdminBilling.vue');
const AdminBank = () => import('./pages/admin/AdminBank.vue');
const AdminSystem = () => import('./pages/admin/AdminSystem.vue');
const AdminReviews = () => import('./pages/admin/AdminReviews.vue');
const AdminContent = () => import('./pages/admin/AdminContent.vue');
const AdminAnalytics = () => import('./pages/admin/AdminAnalytics.vue');
const Articles = () => import('./pages/Articles.vue');
const Article = () => import('./pages/Article.vue');
const Faq = () => import('./pages/Faq.vue');
const Legal = () => import('./pages/Legal.vue');

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Landing },
    { path: '/check', component: PublicCheck },
    { path: '/pricing', component: Pricing },
    { path: '/articles', component: Articles },
    { path: '/articles/:slug', component: Article, props: true },
    { path: '/faq', component: Faq },
    { path: '/offer', component: Legal, props: { slug: 'offer' } },
    { path: '/terms', component: Legal, props: { slug: 'terms' } },
    { path: '/privacy', component: Legal, props: { slug: 'privacy' } },
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
    { path: '/app/team', component: Team, meta: { auth: true, owner: true } },
    { path: '/app/notifications', component: Notifications, meta: { auth: true } },
    { path: '/team/accept', component: TeamAccept },
    { path: '/app/history', component: History, meta: { auth: true } },
    { path: '/app/assistant', component: Assistant, meta: { auth: true } },
    { path: '/app/help', component: Help, meta: { auth: true } },
    {
      path: '/app/admin',
      component: AdminLayout,
      meta: { auth: true, admin: true },
      children: [
        { path: '', component: AdminOverview, meta: { adminOnly: true } },
        { path: 'users', component: AdminUsers },
        { path: 'users/:id', component: AdminUser, props: true },
        { path: 'orders', component: AdminOrders, meta: { adminOnly: true } },
        { path: 'billing', component: AdminBilling, meta: { adminOnly: true } },
        { path: 'bank', component: AdminBank, meta: { adminOnly: true } },
        { path: 'system', component: AdminSystem, meta: { adminOnly: true } },
        { path: 'reviews', component: AdminReviews, meta: { adminOnly: true } },
        { path: 'content', component: AdminContent, meta: { adminOnly: true } },
        { path: 'jobs', component: AdminJobs },
        { path: 'audit', component: AdminAudit, meta: { adminOnly: true } },
        { path: 'logs', component: AdminLogs, meta: { adminOnly: true } },
        { path: 'support', component: AdminSupport, meta: { adminOnly: true } },
        { path: 'ai', component: AdminAi, meta: { adminOnly: true } },
        { path: 'analytics', component: AdminAnalytics, meta: { adminOnly: true } },
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
  if (to.meta.owner && store.user?.teamMember) return '/app';
  if (to.meta.admin && !['admin', 'support'].includes(store.user?.role)) return '/app';
  if (to.meta.adminOnly && store.user?.role !== 'admin') return '/app/admin/users';
  if ((to.path === '/login' || to.path === '/register') && store.user) return '/app';
});

router.afterEach((to) => applySeo(to.path));

export default router;
