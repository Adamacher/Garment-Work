<template>
  <a-select
    :value="modelValue"
    :options="selectOptions"
    :placeholder="placeholder"
    :allow-clear="allowClear"
    :show-search="showSearch"
    :list-height="dropdownListHeight"
    :dropdown-match-select-width="false"
    :dropdown-style="{ minWidth: `${dropdownMinWidth}px`, maxWidth: `${dropdownMaxWidth}px`, maxHeight: `${dropdownMaxHeight}px` }"
    :filter-option="filterOption"
    option-filter-prop="label"
    :disabled="disabled"
    @search="handleSearch"
    @update:value="handleValueChange"
  >
    <template #dropdownRender="{ menuNode }">
      <VNodes :vnodes="menuNode" />
      <a-divider style="margin: 8px 0" />
      <div class="inline-option-select__panel" @mousedown.stop @click.stop>
        <a-space-compact style="width: 100%">
          <a-input
            v-model:value="draftValue"
            :placeholder="`新增${addLabel || placeholder || '选项'}`"
            @pressEnter="handleAdd"
            @mousedown.stop
            @keydown.stop
          />
          <a-button type="primary" :loading="saving" @mousedown.stop @click="handleAdd">
            新增
          </a-button>
        </a-space-compact>

        <div v-if="normalizedEntries.length" class="inline-option-select__tags">
          <a-tag
            v-for="entry in normalizedEntries"
            :key="entry.id || entry.value"
            closable
            @close.prevent="handleDelete(entry.value)"
          >
            {{ entry.value }}
          </a-tag>
        </div>
      </div>
    </template>
  </a-select>
</template>

<script setup>
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { api, normalizeOptionEntries, toSelectOptions } from '@/utils/api'

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: undefined
  },
  entries: {
    type: Array,
    default: () => []
  },
  optionType: {
    type: String,
    required: true
  },
  placeholder: {
    type: String,
    default: ''
  },
  addLabel: {
    type: String,
    default: ''
  },
  allowClear: {
    type: Boolean,
    default: false
  },
  showSearch: {
    type: Boolean,
    default: true
  },
  disabled: {
    type: Boolean,
    default: false
  },
  dropdownMinWidth: {
    type: Number,
    default: 280
  },
  dropdownMaxWidth: {
    type: Number,
    default: 420
  },
  dropdownMaxHeight: {
    type: Number,
    default: 320
  },
  dropdownListHeight: {
    type: Number,
    default: 224
  }
})

const emit = defineEmits(['update:modelValue', 'options-updated'])

const draftValue = ref('')
const searchValue = ref('')
const saving = ref(false)

const normalizedEntries = computed(() => normalizeOptionEntries(props.entries))
const existingValueSet = computed(() => new Set(normalizedEntries.value.map((entry) => entry.value)))
const selectOptions = computed(() => {
  const options = toSelectOptions(props.entries)
  const searched = String(searchValue.value || '').trim()
  if (searched && !existingValueSet.value.has(searched)) {
    return [{ label: `新增：${searched}`, value: searched }, ...options]
  }
  return options
})

const VNodes = (_, { attrs }) => attrs.vnodes

function filterOption(input, option) {
  const keyword = String(input || '').trim().toLowerCase()
  if (!keyword) return true
  return String(option?.label || option?.value || '').toLowerCase().includes(keyword)
}

function handleSearch(value) {
  searchValue.value = String(value || '').trim()
  if (searchValue.value) draftValue.value = searchValue.value
}

async function ensureOptionValue(value) {
  const text = String(value || '').trim()
  if (!text || existingValueSet.value.has(text)) return null
  const optionLists = await api.db.saveOptionValue(props.optionType, text)
  emit('options-updated', optionLists)
  return optionLists
}

async function handleValueChange(value) {
  const text = String(value || '').trim()
  if (!text) {
    emit('update:modelValue', value)
    return
  }

  saving.value = true
  try {
    await ensureOptionValue(text)
    emit('update:modelValue', text)
    searchValue.value = ''
    draftValue.value = ''
  } catch (error) {
    message.error(error.message || '新增选项失败')
  } finally {
    saving.value = false
  }
}

async function handleAdd() {
  const value = String(draftValue.value || searchValue.value || '').trim()
  if (!value) {
    message.error(`请输入${props.addLabel || props.placeholder || '选项'}`)
    return
  }

  saving.value = true
  try {
    await ensureOptionValue(value)
    emit('update:modelValue', value)
    draftValue.value = ''
    searchValue.value = ''
    message.success(`${value} 已加入下拉选项`)
  } catch (error) {
    message.error(error.message || '新增选项失败')
  } finally {
    saving.value = false
  }
}

async function handleDelete(value) {
  saving.value = true
  try {
    const optionLists = await api.db.deleteOptionValue(props.optionType, value)
    emit('options-updated', optionLists)
    if (props.modelValue === value) emit('update:modelValue', undefined)
    message.success(`${value} 已删除`)
  } catch (error) {
    message.error(error.message || '删除选项失败')
  } finally {
    saving.value = false
  }
}
</script>
