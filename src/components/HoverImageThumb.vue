<template>
  <div class="inventory-image-cell">
    <a-popover v-if="src" placement="rightTop" trigger="hover" overlay-class-name="inventory-image-popover">
      <template #content>
        <img :src="src" class="inventory-image-preview inventory-image-preview--full" :alt="alt" />
      </template>
      <img :src="src" class="inventory-image-thumb" :alt="alt" loading="lazy" />
    </a-popover>
    <div v-else class="inventory-image-empty">{{ emptyText }}</div>
  </div>
</template>

<script setup>
defineProps({
  src: {
    type: String,
    default: ''
  },
  alt: {
    type: String,
    default: ''
  },
  emptyText: {
    type: String,
    default: ''
  }
})
</script>
