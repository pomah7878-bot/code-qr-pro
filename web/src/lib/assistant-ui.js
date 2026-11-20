import { reactive } from 'vue';

/** Общее состояние окна AI-помощника: открыть можно из меню, кнопки «Помощь» и т.п. */
export const assistantUi = reactive({ open: false, pageKey: '' });

export function openAssistant(pageKey = '') {
  assistantUi.pageKey = pageKey;
  assistantUi.open = true;
}

export function closeAssistant() {
  assistantUi.open = false;
}
