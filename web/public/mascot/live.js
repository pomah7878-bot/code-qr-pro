const ROBOT = `
    <div class="robot" data-state="idle">
      <div class="r-antenna"></div>
      <div class="r-head">
        <div class="r-band"></div>
        <div class="r-cup l"></div>
        <div class="r-cup r"></div>
        <div class="r-logo"><i></i><i></i><i></i><i></i></div>
        <div class="r-visor">
          <div class="r-eyes">
            <div class="r-eye"><div class="r-iris"></div></div>
            <div class="r-eye"><div class="r-iris"></div></div>
          </div>
          <div class="r-smile"></div>
          <div class="r-glow"></div>
        </div>
      </div>
      <div class="r-torso"><div class="r-chest"></div></div>
      <div class="r-arm l"><div class="bone"></div><div class="elbow"></div><div class="hand"></div></div>
      <div class="r-arm r"><div class="bone"></div><div class="elbow"></div><div class="hand"></div></div>
      <div class="r-think-bubble"><span class="d1"></span><span class="d2"></span><span class="d3">💡</span></div>
      <div class="r-hearts"><i></i><i></i><i></i></div>
      <div class="r-confetti"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    </div>`;

  const mounts = [
    { id: 'main-mount', state: 'idle' },
    { id: 'avatar-mount', state: 'idle' },
    { id: 'peek-mount', state: 'idle' },
    { id: 'head-mount', state: 'idle' }
  ];
  for (const m of mounts) {
    const el = document.getElementById(m.id);
    if (el) el.innerHTML = ROBOT;
  }

  const galleryStates = [
    { state: 'wave', title: 'Машет', text: 'приветствие' },
    { state: 'think', title: 'Думает', text: 'ищет ответ в базе' },
    { state: 'heart', title: 'Любит', text: 'после благодарности' },
    { state: 'cheer', title: 'Радуется', text: 'ответ готов' }
  ];
  const gallery = document.getElementById('gallery');
  for (const g of galleryStates) {
    const card = document.createElement('div');
    card.className = 'gcard';
    card.innerHTML = `<div class="robot-mount"></div><div class="label"><b>${g.title}</b>${g.text}</div>`;
    gallery.appendChild(card);
    const mount = card.querySelector('.robot-mount');
    mount.innerHTML = ROBOT;
    mount.querySelector('.robot').dataset.state = g.state;
  }

  // все роботы на странице
  const robots = [...document.querySelectorAll('.robot')].map((el) => ({ el, mount: el.parentElement }));
  const main = document.querySelector('#main-mount .robot');

  // глаза следят за курсором
  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  window.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });
  function trackEyes() {
    for (const { el } of robots) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + 90;
      const dx = Math.max(-1, Math.min(1, (mx - cx) / 260));
      const dy = Math.max(-1, Math.min(1, (my - cy) / 260));
      el.style.setProperty('--ex', (dx * 7).toFixed(1) + 'px');
      el.style.setProperty('--ey', (dy * 5).toFixed(1) + 'px');
      el.style.setProperty('--tilt', (dx * 5).toFixed(1) + 'deg');
    }
    requestAnimationFrame(trackEyes);
  }
  requestAnimationFrame(trackEyes);

  // моргание
  function blink() {
    const { el } = robots[Math.floor(Math.random() * robots.length)];
    el.classList.add('blink');
    setTimeout(() => el.classList.remove('blink'), 140);
  }
  setInterval(blink, 3200);

  // изредка оглядывается
  setInterval(() => {
    if (!main || main.dataset.state !== 'idle') return;
    main.classList.add('look');
    setTimeout(() => main.classList.remove('look'), 1400);
  }, 7000);

  // состояния большого робота
  const chips = document.getElementById('state-chips');
  let idleTimer = 0;
  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-state]');
    if (!btn || !main) return;
    [...chips.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b === btn));
    main.dataset.state = btn.dataset.state;
    main.classList.remove('happy');
    clearTimeout(idleTimer);
    if (btn.dataset.state !== 'idle') {
      idleTimer = setTimeout(() => {
        main.dataset.state = 'idle';
        [...chips.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.state === 'idle'));
      }, 6500);
    }
  });

  // клик по роботу: подпрыгнул и зажмурился
  if (main) {
    main.addEventListener('click', () => {
      main.animate(
        [
          { transform: 'translateY(0) scale(1)' },
          { transform: 'translateY(-18px) scale(1.04)' },
          { transform: 'translateY(0) scale(1)' }
        ],
        { duration: 460, easing: 'cubic-bezier(.34,1.56,.64,1)' }
      );
      main.classList.add('happy');
      setTimeout(() => main.classList.remove('happy'), 900);
    });
  }
