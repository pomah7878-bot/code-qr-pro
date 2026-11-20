// Скрипт страницы печати этикеток (отдельный файл, чтобы не нарушать CSP script-src 'self').
// Кнопки в разметке помечены data-print / data-close — inline-обработчики запрещены политикой.
(function () {
  function printPage() {
    try {
      window.print();
    } catch (e) {
      // На некоторых мобильных браузерах печать доступна только через меню/«Поделиться».
      var hint = document.querySelector('.bar-hint');
      if (hint) hint.textContent = 'Откройте меню браузера и выберите «Печать» (или «Поделиться» → «Напечатать»).';
    }
  }

  document.addEventListener('click', function (event) {
    var printBtn = event.target && event.target.closest ? event.target.closest('[data-print]') : null;
    if (printBtn) {
      event.preventDefault();
      printPage();
      return;
    }
    var closeBtn = event.target && event.target.closest ? event.target.closest('[data-close]') : null;
    if (closeBtn) {
      event.preventDefault();
      try { window.close(); } catch (e) { /* ignore */ }
    }
  });

  // Автопечать по кнопке «Печать» из кабинета: openPrintWindow уже вызывает print(),
  // но если браузер проигнорировал вызов — подскажем пользователю, а не оставим пустоту.
  window.__cqPrintReady = true;
})();
