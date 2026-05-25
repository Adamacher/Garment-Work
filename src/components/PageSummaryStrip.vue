<template>
  <div class="page-summary-strip">
    <div v-for="item in items" :key="item.label" class="page-summary-strip__item">
      <div class="page-summary-strip__label">{{ item.label }}</div>
      <div class="page-summary-strip__value">{{ item.value }}</div>
      <div v-if="item.note" class="page-summary-strip__note">{{ item.note }}</div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  items: {
    type: Array,
    default: () => []
  }
})
</script>
