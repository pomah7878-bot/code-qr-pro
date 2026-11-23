import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import { initTheme } from './store.js';
import { installTooltips } from './lib/tooltip.js';
import './style.css';

initTheme();
installTooltips();

const app = createApp(App);
app.use(router);

// Клиентские ошибки → /api/logs/client. Дедупликация и лимит, чтобы не спамить.
const reportedErrors = new Set();
function reportClientError(event, payload) {
  try {
    const message = String(payload?.message || 'Ошибка во фронтенде').slice(0, 500);
    const key = `${event}|${message}|${payload?.url || ''}`;
    if (reportedErrors.has(key) || reportedErrors.size > 30) return;
    reportedErrors.add(key);
    fetch('/api/logs/client', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        event,
        message,
        stack: String(payload?.stack || '').slice(0, 4000),
        url: String(payload?.url || location.pathname).slice(0, 300),
        route: location.pathname,
        app: 'web',
        line: payload?.line ? String(payload.line) : ''
      })
    }).catch(() => { /* сеть недоступна — не мешаем приложению */ });
  } catch { /* никогда не ломаем приложение из-за логирования */ }
}

window.addEventListener('error', (e) => {
  const source = String(e.filename || '');
  const message = String(e.message || '');
  const stack = String(e.error?.stack || '');
  // Встроенные Android/Instagram WebView вставляют собственный navigation logger.
  // Это не ошибка CODE QR PRO и не должно засорять журнал сервера.
  if (/iabjs:\/\/|navigation_performance_logger_android/i.test(source + ' ' + stack)) return;
  if (/Java object is gone/i.test(message) && /Instagram/i.test(navigator.userAgent)) return;
  reportClientError('window_error', {
    message: e.message,
    stack: e.error?.stack,
    url: e.filename || location.pathname,
    line: e.lineno
  });
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  reportClientError('unhandled_rejection', {
    message: reason?.message || String(reason),
    stack: reason?.stack
  });
});
app.config.errorHandler = (err, _instance, info) => {
  reportClientError('vue_error', { message: err?.message || String(err), stack: err?.stack, line: info });
  console.error(err);
};

app.mount('#app');
