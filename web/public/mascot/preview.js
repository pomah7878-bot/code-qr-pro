// «Моргание»: иногда подменяем открытые глаза на закрытые (поза с сердцем)
  const targets = [...document.querySelectorAll('.blink-target')];
  setInterval(() => {
    const el = targets[Math.floor(Math.random() * targets.length)];
    if (!el || el.tagName !== 'IMG') return;
    const open = el.currentSrc || el.src;
    const closed = open.replace(/(question|avatar)\.png/, 'avatar-blink.png');
    if (closed === open) return;
    el.src = closed;
    setTimeout(() => { el.src = open; }, 180);
  }, 4200);

  // Легкий наклон роботов за курсором
  document.addEventListener('mousemove', (e) => {
    const dx = (e.clientX - window.innerWidth / 2) / window.innerWidth;
    document.querySelectorAll('.avatar-launcher, .peek-launcher .robot').forEach((el) => {
      el.style.transform = `rotate(${(dx * 4).toFixed(2)}deg)`;
    });
  });
