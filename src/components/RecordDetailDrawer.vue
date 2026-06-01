<template>
  <a-drawer
    class="record-detail-drawer"
    :open="open"
    :title="title"
    :width="width"
    @close="$emit('update:open', false)"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </a-drawer>
</template>

<script setup>
defineProps({
  open: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ''
  },
  width: {
    type: [String, Number],
    default: 520
  }
})

defineEmits(['update:open'])
</script>
