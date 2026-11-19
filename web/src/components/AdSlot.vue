<script setup>
import { onMounted, ref } from 'vue';

const props = defineProps({
  placement: { type: String, default: 'landing_banner' },
  compact: Boolean
});
const ad = ref(null);
const box = ref(null);
let tracked = false;

async function trackImpression() {
  if (tracked || !ad.value) return;
  tracked = true;
  try {
    await fetch(`/api/ads/${ad.value.id}/impression`, { method: 'POST', credentials: 'include', keepalive: true });
  } catch { /* реклама не должна ломать страницу */ }
}

onMounted(async () => {
  try {
    const res = await fetch(`/api/ads/slot?placement=${encodeURIComponent(props.placement)}`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    ad.value = data.ad || null;
    if (!ad.value) return;
    if (typeof IntersectionObserver === 'undefined') {
      trackImpression();
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        trackImpression();
        io.disconnect();
      }
    }, { threshold: 0.35 });
    if (box.value) io.observe(box.value);
  } catch { /* ignore */ }
});
</script>

<template>
  <div v-if="ad" ref="box" class="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-r from-amber-500/10 via-white/40 to-violet-500/10 dark:via-white/[0.03] p-4">
    <div class="absolute right-3 top-3 text-[10px] uppercase tracking-widest text-amber-600/70 dark:text-amber-300/70">Реклама</div>
    <a :href="ad.targetUrl" target="_blank" rel="sponsored noopener" class="flex items-center gap-4 pr-16">
      <img v-if="ad.imageUrl" :src="ad.imageUrl" :alt="ad.title" class="h-16 w-28 sm:h-20 sm:w-40 rounded-xl object-cover shrink-0">
      <div class="min-w-0">
        <div class="font-display font-semibold text-sm sm:text-base text-slate-900 dark:text-white truncate">{{ ad.title }}</div>
        <div v-if="ad.text" class="text-xs text-slate-500 mt-1 line-clamp-2">{{ ad.text }}</div>
        <div v-if="ad.advertiser" class="text-[11px] text-slate-400 mt-1">{{ ad.advertiser }}</div>
      </div>
    </a>
  </div>
</template>
