<template>
  <section class="smart-table-frame">
    <header v-if="title || $slots.actions" class="smart-table-frame__header">
      <h3 v-if="title">{{ title }}</h3>
      <div v-if="$slots.actions" class="smart-table-frame__actions">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    default: ''
  }
})
</script>
