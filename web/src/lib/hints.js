import { reactive } from 'vue';

const ENABLED_KEY = 'cq_hints_enabled';
const DISMISSED_KEY = 'cq_hint_dismissed';

function readEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) !== '0'; } catch { return true; }
}
function readDismissed() {
  try {
    const list = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch { return new Set(); }
}

const state = reactive({
  enabled: readEnabled(),
  dismissed: readDismissed()
});

function saveEnabled() {
  try { localStorage.setItem(ENABLED_KEY, state.enabled ? '1' : '0'); } catch { /* ignore */ }
}
function saveDismissed() {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...state.dismissed])); } catch { /* ignore */ }
}

export const hints = {
  get enabled() { return state.enabled; },
  isVisible(id) { return state.enabled && !state.dismissed.has(id); },
  dismiss(id) {
    state.dismissed.add(id);
    saveDismissed();
  },
  disable() {
    state.enabled = false;
    saveEnabled();
  },
  enable() {
    state.enabled = true;
    saveEnabled();
  },
  toggle() {
    state.enabled = !state.enabled;
    saveEnabled();
  },
  resetAll() {
    state.enabled = true;
    state.dismissed.clear();
    saveEnabled();
    saveDismissed();
  }
};
