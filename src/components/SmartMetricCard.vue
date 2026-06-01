<template>
  <button type="button" class="smart-metric-card" :class="toneClass" @click="$emit('click')">
    <span class="smart-metric-card__icon">{{ icon }}</span>
    <span class="smart-metric-card__body">
      <span class="smart-metric-card__label">{{ label }}</span>
      <strong>{{ value }}</strong>
      <small v-if="note">{{ note }}</small>
    </span>
  </button>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  icon: {
    type: String,
    default: '•'
  },
  label: {
    type: String,
    default: ''
  },
  value: {
    type: [String, Number],
    default: ''
  },
  note: {
    type: String,
    default: ''
  },
  tone: {
    type: String,
    default: 'blue'
  }
})

defineEmits(['click'])

const toneClass = computed(() => `smart-metric-card--${props.tone}`)
</script>
