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
  },
  title: {
    type: String,
    default: '显示列配置'
  }
})

const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const localKeys = ref([])
const orderKeys = ref([])

const allKeys = computed(() => props.columns.map((column) => column.key).filter(Boolean))
const columnMap = computed(() => new Map(props.columns.map((column) => [column.key, column])))
const orderedColumns = computed(() => orderKeys.value.map((key) => columnMap.value.get(key)).filter(Boolean))
const checkedCount = computed(() => localKeys.value.length)
const allChecked = computed(() => checkedCount.value === allKeys.value.length && allKeys.value.length > 0)
const partiallyChecked = computed(() => checkedCount.value > 0 && checkedCount.value < allKeys.value.length)

function normalizeVisibleKeys(keys) {
  const incoming = Array.isArray(keys) ? keys : []
  return incoming.filter((key, index) => allKeys.value.includes(key) && incoming.indexOf(key) === index)
}

function normalizeOrderKeys(keys) {
  const incoming = Array.isArray(keys) && keys.length ? keys : allKeys.value
  const ordered = incoming.filter((key, index) => allKeys.value.includes(key) && incoming.indexOf(key) === index)
  const missing = allKeys.value.filter((key) => !ordered.includes(key))
  return [...ordered, ...missing]
}

watch(
  [() => props.columns, () => props.modelValue],
  () => {
    const visible = normalizeVisibleKeys(props.modelValue)
    localKeys.value = visible.length ? visible : [...allKeys.value]
    orderKeys.value = normalizeOrderKeys([...localKeys.value, ...orderKeys.value])
  },
  { immediate: true, deep: true }
)

function commit(nextVisibleKeys, nextOrderKeys = orderKeys.value) {
  localKeys.value = normalizeVisibleKeys(nextVisibleKeys)
  if (!localKeys.value.length && allKeys.value.length) localKeys.value = [allKeys.value[0]]
  orderKeys.value = normalizeOrderKeys(nextOrderKeys)
  emit('update:modelValue', [...localKeys.value])
}

function toggleKey(key, checked) {
  if (checked) {
    commit(localKeys.value.includes(key) ? localKeys.value : [...localKeys.value, key])
    return
  }
  if (localKeys.value.length <= 1) return
  commit(localKeys.value.filter((item) => item !== key))
}

function moveKey(key, direction) {
  const index = orderKeys.value.indexOf(key)
  const target = index + direction
  if (index < 0 || target < 0 || target >= orderKeys.value.length) return
  const nextOrder = [...orderKeys.value]
  const [item] = nextOrder.splice(index, 1)
  nextOrder.splice(target, 0, item)
  commit(localKeys.value, nextOrder)
}

function selectAllColumns() {
  commit([...allKeys.value], orderKeys.value)
}

function clearSelectedColumns() {
  if (!allKeys.value.length) return
  commit([allKeys.value[0]], orderKeys.value)
}

function resetColumns() {
  commit([...allKeys.value], [...allKeys.value])
}

function showModal() {
  localKeys.value = normalizeVisibleKeys(props.modelValue)
  if (!localKeys.value.length && allKeys.value.length) localKeys.value = [...allKeys.value]
  orderKeys.value = normalizeOrderKeys([...orderKeys.value, ...localKeys.value])
  open.value = true
}
</script>

<template>
  <a-button class="toolbar-secondary-btn toolbar-column-config-btn" @click="showModal">
    {{ buttonText }}
  </a-button>

  <a-modal
    v-model:open="open"
    :title="title"
    centered
    width="520px"
    :footer="null"
    wrap-class-name="column-config-modal"
  >
    <div class="column-config-panel">
      <div class="column-config-head">
        <span>勾选要显示的列，可用上下按钮调整顺序。</span>
        <a-button type="link" size="small" @click="resetColumns">重置</a-button>
      </div>

      <div class="column-config-bulk">
        <a-checkbox
          :checked="allChecked"
          :indeterminate="partiallyChecked"
          @change="$event.target.checked ? selectAllColumns() : clearSelectedColumns()"
        >
          全选 / 取消全选
        </a-checkbox>
        <span>{{ checkedCount }} / {{ allKeys.length }} 列</span>
      </div>

      <div class="column-config-list">
        <div v-for="column in orderedColumns" :key="column.key" class="column-config-item">
          <a-checkbox
            :checked="localKeys.includes(column.key)"
            @change="toggleKey(column.key, $event.target.checked)"
          >
            {{ column.title }}
          </a-checkbox>
          <div class="column-config-actions">
            <button
              type="button"
              class="column-config-move"
              :disabled="orderKeys.indexOf(column.key) <= 0"
              @click="moveKey(column.key, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              class="column-config-move"
              :disabled="orderKeys.indexOf(column.key) === orderKeys.length - 1"
              @click="moveKey(column.key, 1)"
            >
              ↓
            </button>
          </div>
        </div>
      </div>

      <div class="column-config-footer">
        <span>至少保留 1 列显示，修改会自动保存。</span>
        <a-button type="primary" @click="open = false">完成</a-button>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
.column-config-panel {
  display: grid;
  gap: 14px;
}

.column-config-head,
.column-config-bulk,
.column-config-footer,
.column-config-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.column-config-head,
.column-config-bulk {
  color: #4f6078;
  font-size: 13px;
}

.column-config-list {
  display: grid;
  gap: 8px;
  max-height: 420px;
  overflow: auto;
  padding: 4px;
}

.column-config-item {
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 122, 255, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.82);
}

.column-config-actions {
  display: flex;
  gap: 8px;
}

.column-config-move {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(0, 122, 255, 0.14);
  border-radius: 10px;
  background: #fff;
  color: #0067d8;
  cursor: pointer;
}

.column-config-move:disabled {
  color: #b6c0ce;
  cursor: not-allowed;
}

.column-config-footer {
  padding-top: 10px;
  border-top: 1px solid rgba(0, 122, 255, 0.1);
  color: #7b8794;
  font-size: 12px;
}
</style>
