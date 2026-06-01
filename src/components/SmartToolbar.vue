<template>
  <div class="smart-toolbar">
    <div class="smart-toolbar__filters">
      <slot />
    </div>
    <div v-if="$slots.actions" class="smart-toolbar__actions">
      <slot name="actions" />
    </div>
  </div>
</template>
