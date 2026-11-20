<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  state: { type: String, default: 'idle' },
  size: { type: Number, default: 260 },
  crop: { type: String, default: 'full' }
});

const root = ref(null);
let blinkTimer = 0;
let lookTimer = 0;
let removeMove = null;

// Голова занимает 170px из 260 — для аватара кадрируем по ней.
const k = () => (props.crop === 'head' ? props.size / 170 : props.size / 260);
const frameHeight = computed(() => (props.crop === 'head' ? props.size : Math.round(props.size * (322 / 260))));

function onMove(e) {
  const el = root.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + (props.crop === 'head' ? r.height / 2 : r.height * 0.28);
  const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 240));
  const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 240));
  el.style.setProperty('--rb-ex', `${(dx * 7).toFixed(1)}px`);
  el.style.setProperty('--rb-ey', `${(dy * 5).toFixed(1)}px`);
  el.style.setProperty('--rb-tilt', `${(dx * 5).toFixed(1)}deg`);
}

function scheduleBlink() {
  blinkTimer = window.setTimeout(() => {
    const el = root.value;
    if (el) {
      el.classList.add('rb-blink');
      window.setTimeout(() => el && el.classList.remove('rb-blink'), 140);
    }
    scheduleBlink();
  }, 2800 + Math.random() * 3800);
}

function scheduleLook() {
  lookTimer = window.setTimeout(() => {
    const el = root.value;
    if (el && props.state === 'idle') {
      el.classList.add('rb-look');
      window.setTimeout(() => el && el.classList.remove('rb-look'), 1500);
    }
    scheduleLook();
  }, 7000 + Math.random() * 3000);
}

onMounted(() => {
  window.addEventListener('mousemove', onMove);
  removeMove = () => window.removeEventListener('mousemove', onMove);
  scheduleBlink();
  scheduleLook();
});

onBeforeUnmount(() => {
  window.clearTimeout(blinkTimer);
  window.clearTimeout(lookTimer);
  if (removeMove) removeMove();
});
</script>

<template>
  <div
    ref="root"
    class="rb-frame"
    :class="[`rb-crop-${crop}`, crop === 'full' ? 'rb-overflow-visible' : '']"
    :style="{ width: size + 'px', height: frameHeight + 'px' }"
  >
    <div
      class="rb-robot"
      :data-state="state"
      :style="{
        width: '260px',
        height: '322px',
        transform: `scale(${k()})`,
        left: '50%',
        marginLeft: '-130px',
        top: crop === 'head' ? '0px' : '-4px'
      }"
    >
      <div class="rb-antenna"></div>
      <div class="rb-head">
        <div class="rb-band"></div>
        <div class="rb-cup l"></div>
        <div class="rb-cup r"></div>
        <div class="rb-logo"><i></i><i></i><i></i><i></i></div>
        <div class="rb-visor">
          <div class="rb-eyes">
            <div class="rb-eye"><div class="rb-iris"></div></div>
            <div class="rb-eye"><div class="rb-iris"></div></div>
          </div>
          <div class="rb-smile"></div>
          <div class="rb-glow"></div>
        </div>
      </div>
      <div class="rb-torso"><div class="rb-chest"></div></div>
      <div class="rb-arm l"><div class="rb-bone"></div><div class="rb-elbow"></div><div class="rb-hand"></div></div>
      <div class="rb-arm r"><div class="rb-bone"></div><div class="rb-elbow"></div><div class="rb-hand"></div></div>
      <div class="rb-think"><span class="d1"></span><span class="d2"></span><span class="d3">💡</span></div>
      <div class="rb-hearts"><i></i><i></i><i></i></div>
      <div class="rb-confetti"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    </div>
  </div>
</template>

<style scoped>
.rb-frame {
  position: relative;
  overflow: hidden;
  flex: none;
}
.rb-overflow-visible { overflow: visible; }
.rb-crop-head { border-radius: 50%; }

.rb-robot {
  --rb-ex: 0px;
  --rb-ey: 0px;
  --rb-tilt: 0deg;
  position: absolute;
  transform-origin: 50% 0;
  animation: rb-bob 5.2s ease-in-out infinite;
  filter: drop-shadow(0 18px 26px rgba(20, 12, 50, .5));
}

/* антенна */
.rb-antenna { position: absolute; left: 50%; top: -18px; translate: -50% 0; width: 5px; height: 34px; border-radius: 3px; background: linear-gradient(#c7d2fe, #6366f1); }
.rb-antenna::after {
  content: ''; position: absolute; left: 50%; top: -14px; translate: -50% 0;
  width: 15px; height: 15px; border-radius: 50%;
  background: radial-gradient(circle at 32% 30%, #fff, #a78bfa 45%, #7c3aed);
  box-shadow: 0 0 18px rgba(167, 139, 250, .95), 0 0 40px rgba(124, 58, 237, .6);
  animation: rb-led 2.6s ease-in-out infinite;
}

/* голова */
.rb-head {
  position: absolute; left: 45px; top: 12px; width: 170px; height: 152px;
  background: linear-gradient(165deg, #ffffff 0%, #eef1ff 48%, #c9d0f2 100%);
  border-radius: 48% 48% 44% 44% / 52% 52% 46% 46%;
  box-shadow: inset 0 -16px 26px rgba(99, 102, 241, .18), inset 0 5px 0 rgba(255, 255, 255, .95), 0 12px 26px rgba(18, 12, 40, .4);
  transition: transform .3s ease;
}
.rb-cup { position: absolute; top: 46px; width: 30px; height: 62px; border-radius: 15px;
  background: linear-gradient(180deg, #3a3468, #14112a);
  box-shadow: inset 0 0 0 2px rgba(129, 140, 248, .35), 0 0 20px rgba(79, 140, 255, .5); }
.rb-cup::after { content: ''; position: absolute; inset: 6px 7px; border-radius: 10px;
  background: radial-gradient(circle at 50% 40%, rgba(96, 165, 250, .9), rgba(37, 99, 235, .25) 60%, transparent 70%);
  animation: rb-led 3.4s ease-in-out infinite; }
.rb-cup.l { left: -16px; }
.rb-cup.r { right: -16px; }
.rb-band { position: absolute; left: 18px; top: -6px; width: 134px; height: 60px; border-radius: 50%;
  border: 5px solid #2a2550; border-bottom: none; box-shadow: inset 0 0 0 2px rgba(129, 140, 248, .25); }

.rb-visor {
  position: absolute; left: 15px; top: 26px; width: 140px; height: 98px;
  border-radius: 48px 48px 52px 52px;
  background: radial-gradient(120% 130% at 50% 18%, #232043 0%, #0b0917 68%);
  box-shadow: inset 0 8px 18px rgba(0, 0, 0, .85), inset 0 -8px 12px rgba(120, 150, 255, .12);
  overflow: hidden;
}
.rb-eyes { display: flex; justify-content: center; gap: 14px; padding-top: 20px; }
.rb-eye {
  position: relative; width: 38px; height: 40px; border-radius: 50%;
  background: radial-gradient(circle at 50% 35%, #ffffff, #dfe7ff 70%, #b9c6f5);
  box-shadow: inset 0 -5px 9px rgba(30, 40, 90, .4), 0 0 14px rgba(96, 165, 250, .45);
  overflow: hidden; transition: transform .12s ease;
}
.rb-iris {
  position: absolute; left: 50%; top: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #bfe3ff, #3b82f6 52%, #0b2f8a 100%);
  transform: translate(var(--rb-ex), var(--rb-ey));
  transition: transform .08s linear;
  box-shadow: 0 0 12px rgba(59, 130, 246, .9);
}
.rb-iris::after { content: ''; position: absolute; left: 17%; top: 14%; width: 34%; height: 34%; border-radius: 50%; background: rgba(255, 255, 255, .95); }
.rb-smile { position: absolute; left: 50%; bottom: 12px; translate: -50% 0;
  width: 26px; height: 11px; border: 3px solid rgba(147, 197, 253, .9);
  border-top: 0; border-radius: 0 0 16px 16px; box-shadow: 0 2px 8px rgba(96, 165, 250, .5); transition: all .3s ease; }
.rb-logo { position: absolute; left: 50%; top: 7px; translate: -50% 0; display: grid; grid-template-columns: 1fr 1fr; gap: 3px; width: 28px; height: 28px; }
.rb-logo i { background: linear-gradient(135deg, #6d5df6, #3b2fbe); border-radius: 3px; box-shadow: 0 1px 2px rgba(49, 29, 140, .5); }
.rb-glow { position: absolute; inset: 0; border-radius: inherit; background: radial-gradient(60% 40% at 50% 0%, rgba(120, 160, 255, .18), transparent 70%); pointer-events: none; }

/* тело */
.rb-torso {
  position: absolute; left: 72px; top: 148px; width: 116px; height: 118px;
  background: linear-gradient(170deg, #f7f8ff, #d6dcfa 70%, #b9c1ee);
  border-radius: 42px 42px 46px 46px;
  box-shadow: inset 0 -14px 24px rgba(70, 80, 150, .22), inset 0 3px 0 rgba(255, 255, 255, .9), 0 12px 24px rgba(18, 12, 40, .35);
}
.rb-chest { position: absolute; left: 50%; top: 34px; translate: -50% 0; width: 34px; height: 34px;
  border-radius: 10px; background: #16132b; box-shadow: inset 0 0 0 2px rgba(129, 140, 248, .5); display: grid; place-items: center; }
.rb-chest::after { content: ''; width: 12px; height: 12px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #c7f0ff, #38bdf8 55%, #1d4ed8);
  box-shadow: 0 0 16px rgba(56, 189, 248, .95); animation: rb-core 2.2s ease-in-out infinite; }

/* руки */
.rb-arm { position: absolute; top: 162px; width: 30px; height: 116px; transform-origin: 50% 8px; transition: transform .35s cubic-bezier(.34, 1.4, .64, 1); }
.rb-arm.l { left: 42px; }
.rb-arm.r { left: 188px; }
.rb-bone { position: absolute; left: 50%; top: 8px; translate: -50% 0; width: 15px; height: 48px;
  border-radius: 9px; background: linear-gradient(#eef1ff, #b8c0ee); box-shadow: inset -2px 0 4px rgba(90, 100, 160, .25); }
.rb-elbow { position: absolute; left: 50%; top: 46px; translate: -50% 0; width: 26px; height: 26px;
  border-radius: 50%; background: linear-gradient(160deg, #2f2a58, #171331); box-shadow: inset 0 0 0 2px rgba(129, 140, 248, .35), 0 0 12px rgba(79, 140, 255, .35); }
.rb-hand { position: absolute; left: 50%; top: 66px; translate: -50% 0; width: 30px; height: 30px;
  border-radius: 46% 46% 50% 50%; background: linear-gradient(160deg, #f2f4ff, #c6cdf2);
  box-shadow: inset -2px -4px 6px rgba(90, 100, 160, .3), 0 3px 6px rgba(20, 15, 40, .3); }
.rb-hand::after { content: ''; position: absolute; left: 3px; top: 4px; width: 9px; height: 10px; border-radius: 50%; background: rgba(255, 255, 255, .75); }

/* состояния */
.rb-robot[data-state="idle"] .rb-arm.l { transform: rotate(7deg); animation: rb-sway-l 4.4s ease-in-out infinite; }
.rb-robot[data-state="idle"] .rb-arm.r { transform: rotate(-7deg); animation: rb-sway-r 4.4s ease-in-out infinite .5s; }
.rb-robot[data-state="wave"] .rb-arm.r { animation: rb-wave 1.05s ease-in-out infinite; }
.rb-robot[data-state="wave"] .rb-arm.l { transform: rotate(9deg); }
.rb-robot[data-state="wave"] .rb-smile { width: 34px; height: 15px; }
.rb-robot[data-state="think"] .rb-head { transform: rotate(-6deg); }
.rb-robot[data-state="think"] .rb-arm.l { transform: rotate(122deg); }
.rb-robot[data-state="think"] .rb-arm.r { transform: rotate(-16deg); }
.rb-robot[data-state="think"] .rb-smile { width: 16px; height: 4px; border-radius: 0 0 8px 8px; opacity: .8; }
.rb-robot[data-state="think"] .rb-iris { translate: 4px -3px; }
.rb-robot[data-state="heart"] .rb-arm.l { transform: rotate(92deg); }
.rb-robot[data-state="heart"] .rb-arm.r { transform: rotate(-92deg); }
.rb-robot[data-state="heart"] .rb-eye { transform: scaleY(.14); }
.rb-robot[data-state="heart"] .rb-smile { width: 30px; height: 14px; }
.rb-robot[data-state="cheer"] .rb-arm.l { transform: rotate(-152deg); animation: rb-cheer-l .8s ease-in-out infinite; }
.rb-robot[data-state="cheer"] .rb-arm.r { transform: rotate(152deg); animation: rb-cheer-r .8s ease-in-out infinite .2s; }
.rb-robot[data-state="cheer"] .rb-eye { transform: scaleY(.16); }
.rb-robot[data-state="cheer"] .rb-smile { width: 34px; height: 16px; }
.rb-robot.rb-blink .rb-eye { transform: scaleY(.12); }
.rb-robot.rb-look .rb-head { transform: rotate(var(--rb-tilt)); }

/* пузырь «думает» */
.rb-think { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .3s; }
.rb-robot[data-state="think"] .rb-think { opacity: 1; }
.rb-think span { position: absolute; border-radius: 50%; background: linear-gradient(160deg, #eef1ff, #cfd6f5);
  box-shadow: 0 0 0 2px rgba(129, 140, 248, .35), 0 6px 16px rgba(20, 15, 40, .4); }
.rb-think .d1 { width: 8px; height: 8px; left: 186px; top: 96px; animation: rb-th 1.6s ease-in-out infinite; }
.rb-think .d2 { width: 13px; height: 13px; left: 196px; top: 78px; animation: rb-th 1.6s ease-in-out infinite .2s; }
.rb-think .d3 { width: 44px; height: 44px; left: 208px; top: 40px; display: grid; place-items: center; font-size: 20px; animation: rb-th 1.6s ease-in-out infinite .4s; }

/* сердечки */
.rb-hearts { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .3s; }
.rb-robot[data-state="heart"] .rb-hearts { opacity: 1; }
.rb-hearts i { position: absolute; left: 52%; bottom: 108px; width: 16px; height: 16px;
  background: linear-gradient(140deg, #f0abfc, #d946ef); transform: rotate(45deg);
  border-radius: 50% 50% 0 50%; box-shadow: 0 0 14px rgba(217, 70, 239, .9); animation: rb-heart 2.6s ease-out infinite; }
.rb-hearts i::before, .rb-hearts i::after { content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%; background: inherit; }
.rb-hearts i::before { left: -8px; top: 0; }
.rb-hearts i::after { left: 0; top: -8px; }
.rb-hearts i:nth-child(2) { left: 36%; animation-delay: .8s; }
.rb-hearts i:nth-child(3) { left: 62%; animation-delay: 1.5s; }

/* конфетти */
.rb-confetti { position: absolute; inset: 0; pointer-events: none; opacity: 0; }
.rb-robot[data-state="cheer"] .rb-confetti { opacity: 1; }
.rb-confetti i { position: absolute; width: 10px; height: 14px; border-radius: 3px; animation: rb-conf 1.6s linear infinite; opacity: 0; }
.rb-confetti i:nth-child(1) { left: 24px; top: 6px; background: #a78bfa; animation-delay: 0s; }
.rb-confetti i:nth-child(2) { left: 58px; top: -4px; background: #f472b6; animation-delay: .18s; }
.rb-confetti i:nth-child(3) { left: 96px; top: 10px; background: #38bdf8; animation-delay: .36s; }
.rb-confetti i:nth-child(4) { left: 132px; top: -2px; background: #34d399; animation-delay: .54s; }
.rb-confetti i:nth-child(5) { left: 166px; top: 12px; background: #fbbf24; animation-delay: .72s; }
.rb-confetti i:nth-child(6) { left: 200px; top: 2px; background: #f0abfc; animation-delay: .9s; }
.rb-confetti i:nth-child(7) { left: 226px; top: 18px; background: #60a5fa; animation-delay: 1.08s; }
.rb-confetti i:nth-child(8) { left: 40px; top: 44px; background: #c4b5fd; animation-delay: .27s; }
.rb-confetti i:nth-child(9) { left: 214px; top: 48px; background: #fda4af; animation-delay: .63s; }

@keyframes rb-bob { 0%, 100% { translate: 0 0; } 50% { translate: 0 -6px; } }
@keyframes rb-led { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .55; transform: scale(.86); } }
@keyframes rb-core { 0%, 100% { transform: scale(1); opacity: .95; } 50% { transform: scale(1.18); opacity: 1; } }
@keyframes rb-sway-l { 0%, 100% { transform: rotate(7deg); } 50% { transform: rotate(2deg); } }
@keyframes rb-sway-r { 0%, 100% { transform: rotate(-7deg); } 50% { transform: rotate(-2deg); } }
@keyframes rb-wave { 0%, 100% { transform: rotate(-146deg); } 50% { transform: rotate(-176deg); } }
@keyframes rb-cheer-l { 0%, 100% { transform: rotate(-148deg); } 50% { transform: rotate(-162deg); } }
@keyframes rb-cheer-r { 0%, 100% { transform: rotate(148deg); } 50% { transform: rotate(162deg); } }
@keyframes rb-th { 0%, 100% { opacity: .65; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
@keyframes rb-heart {
  0% { opacity: 0; transform: translateY(6px) rotate(45deg) scale(.5); }
  14% { opacity: 1; }
  72% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-92px) rotate(45deg) scale(1.2); }
}
@keyframes rb-conf {
  0% { transform: translateY(-16px) rotate(0) scale(.8); opacity: 0; }
  15% { opacity: 1; }
  100% { transform: translateY(130px) rotate(340deg) scale(1); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .rb-robot, .rb-robot * { animation: none !important; }
}
</style>
