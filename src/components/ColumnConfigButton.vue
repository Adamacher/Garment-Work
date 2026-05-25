<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  columns: {
    type: Array,
    default: () => []
  },
  modelValue: {
    type: Array,
    default: () => []
  },
  buttonText: {
    type: String,
    default: '列配置'
  }
})

const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const localKeys = ref([])

const allKeys = computed(() => props.columns.map((column) => column.key))

function normalizeKeys(keys) {
  const incoming = Array.isArray(keys) && keys.length ? keys : allKeys.value
  const ordered = incoming.filter((key) => allKeys.value.includes(key))
  const missing = allKeys.value.filter((key) => !ordered.includes(key))
  return [...ordered, ...missing]
}

watch(
  [() => props.columns, () => props.modelValue],
  () => {
    localKeys.value = normalizeKeys(props.modelValue)
  },
  { immediate: true, deep: true }
)

function isChecked(key) {
  return localKeys.value.includes(key)
}

function toggleKey(key, checked) {
  if (checked) {
    if (!localKeys.value.includes(key)) {
      localKeys.value = [...localKeys.value, key]
    }
  } else if (localKeys.value.length > 1) {
    localKeys.value = localKeys.value.filter((item) => item !== key)
  }
  emit('update:modelValue', [...localKeys.value])
}

function moveKey(key, direction) {
  const index = localKeys.value.indexOf(key)
  const target = index + direction
  if (index < 0 || target < 0 || target >= localKeys.value.length) return
  const next = [...localKeys.value]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  localKeys.value = next
  emit('update:modelValue', [...next])
}

function resetColumns() {
  const next = [...allKeys.value]
  localKeys.value = next
  emit('update:modelValue', next)
}
</script>

<template>
  <a-popover
    v-model:open="open"
    trigger="click"
    placement="bottomRight"
    overlay-class-name="column-config-popover"
  >
    <template #content>
      <div class="column-config-panel">
        <div class="column-config-head">
          <span>显示列</span>
          <a-button type="link" size="small" @click="resetColumns">
            重置
          </a-button>
        </div>
        <div class="column-config-list">
          <div
            v-for="column in columns"
            :key="column.key"
            class="column-config-item"
          >
            <label class="column-config-label">
              <input
                :checked="isChecked(column.key)"
                class="column-config-checkbox"
                type="checkbox"
                @change="toggleKey(column.key, $event.target.checked)"
              />
              <span>{{ column.title }}</span>
            </label>
            <div class="column-config-actions">
              <button
                type="button"
                class="column-config-move"
                :disabled="localKeys.indexOf(column.key) <= 0"
                @click="moveKey(column.key, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="column-config-move"
                :disabled="localKeys.indexOf(column.key) === localKeys.length - 1"
                @click="moveKey(column.key, 1)"
              >
                ↓
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <a-button class="toolbar-secondary-btn toolbar-column-config-btn">
      {{ buttonText }}
    </a-button>
  </a-popover>
</template>
