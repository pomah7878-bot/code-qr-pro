<script setup>
defineProps({
  narrow: { type: Boolean, default: false }
});
</script>

<template>
  <div :class="narrow ? 'max-w-[860px]' : 'max-w-[1200px]'" class="mx-auto px-4 py-8 sm:py-12">
    <slot />
  </div>
</template>
