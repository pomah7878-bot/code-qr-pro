import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import { initTheme } from './store.js';
import './style.css';

initTheme();
createApp(App).use(router).mount('#app');
