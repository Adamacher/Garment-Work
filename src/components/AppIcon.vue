<template>
  <span class="app-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none">
      <path
        v-for="path in paths"
        :key="path"
        :d="path"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: {
    type: String,
    default: 'dashboard'
  }
})

const iconMap = {
  app: ['M4 7.8 12 3.5l8 4.3v8.4l-8 4.3-8-4.3V7.8Z', 'M12 3.5v8.8m-8-4.5 8 4.5 8-4.5', 'M8.3 14.6h7.4'],
  dashboard: ['M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8.5Z'],
  material: ['M6 4h8l4 4v12H6V4Z', 'M14 4v5h5', 'M9 13h6M9 17h7'],
  purchase: ['M5 6h2l1.5 9h8.5l2-6H8', 'M10 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z'],
  inventory: ['M4 8 12 4l8 4-8 4-8-4Z', 'M4 12l8 4 8-4', 'M4 16l8 4 8-4'],
  dispatch: ['M5 7h9v10H5z', 'M14 10h3l2 3v4h-5', 'M8 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm8 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'],
  flow: ['M7 7h8l-2-2', 'M15 17H7l2 2', 'M17 9a5 5 0 0 1-1 6M7 15a5 5 0 0 1 1-6'],
  style: ['M8 5l4 3 4-3 3 3-2 3v9H7v-9L5 8l3-3Z', 'M10 7c.5 1 1.2 1.5 2 1.5S13.5 8 14 7'],
  bom: ['M6 5h12v4H6z', 'M6 15h12v4H6z', 'M9 9v6m6-6v6'],
  production: ['M6 7h12v10H6z', 'M9 4v3m6-3v3M9 17v3m6-3v3', 'M10 11h4'],
  consumption: ['M5 19V9', 'M10 19V5', 'M15 19v-7', 'M20 19V8'],
  options: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 3v2m0 14v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M3 12h2m14 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  users: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M3.5 20a5.5 5.5 0 0 1 11 0', 'M16 9a2.5 2.5 0 1 0 0-5', 'M15 14c2.8.2 5 2.4 5 5'],
  audit: ['M7 4h10v16H7z', 'M9 8h6M9 12h6M9 16h4', 'M6 7H5v14h11v-1'],
  review: ['M9 12l2 2 4-5', 'M5 5h14v14H5z'],
  warning: ['M12 4l9 16H3L12 4Z', 'M12 10v4m0 3h.01'],
  value: ['M12 3v18', 'M7 7.5h7.5a3 3 0 0 1 0 6H9.5a3 3 0 0 0 0 6H17'],
  database: ['M5 7c0-2 14-2 14 0v10c0 2-14 2-14 0V7Z', 'M5 7c0 2 14 2 14 0M5 12c0 2 14 2 14 0'],
  link: ['M9.5 14.5 14.5 9.5', 'M8.5 10.5l-1 1a3.5 3.5 0 0 0 5 5l1-1', 'M15.5 13.5l1-1a3.5 3.5 0 0 0-5-5l-1 1']
}

const paths = computed(() => iconMap[props.name] || iconMap.dashboard)
</script>
