<template>
  <article class="mobile-record-card" @click="$emit('click')">
    <header class="mobile-record-card__header">
      <div>
        <strong>{{ title }}</strong>
        <span v-if="subtitle">{{ subtitle }}</span>
      </div>
      <slot name="tag" />
    </header>
    <slot />
    <footer v-if="$slots.actions" class="mobile-record-card__actions">
      <slot name="actions" />
    </footer>
  </article>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    default: ''
  },
  subtitle: {
    type: String,
    default: ''
  }
})

defineEmits(['click'])
</script>
