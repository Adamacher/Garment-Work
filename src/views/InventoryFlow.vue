<template>
  <a-card class="content-card" :bordered="false">
    <PageSummaryStrip :items="summaryItems" />

    <div class="erp-toolbar">
      <div class="erp-toolbar__filters">
        <a-select v-model:value="filterField" :options="filterFieldOptions" style="width: 160px" />
        <a-input v-model:value="keywordInput" :placeholder="filterPlaceholder" allow-clear style="width: 360px" />
        <a-range-picker v-model:value="dateRange" value-format="YYYY-MM-DD" style="width: 260px" />
      </div>
      <div class="erp-toolbar__actions">
        <a-button class="toolbar-refresh-btn" :loading="loading" @click="loadList">刷新</a-button>
      </div>
    </div>

    <div class="erp-table-caption">
      库存流水按时间倒序展示，方便快速回溯每一次入库、发厂、回冲和作废带来的库存变化。
    </div>

    <a-table
      class="erp-dense-table"
      size="small"
      :data-source="filteredList"
      :columns="columns"
      :row-key="(row) => row.id"
      :pagination="{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }"
      :loading="loading"
      :scroll="{ x: 1640 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'image'">
          <HoverImageThumb :src="record.material_image_path" alt="material" />
        </template>
        <template v-else-if="column.key === 'material'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ record.material_code || '-' }}</div>
            <div class="table-secondary">{{ record.material_name || '-' }}</div>
          </div>
        </template>
      </template>
    </a-table>
  </a-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import HoverImageThumb from '@/components/HoverImageThumb.vue'
import PageSummaryStrip from '@/components/PageSummaryStrip.vue'
import { api } from '@/utils/api'
import { useDebouncedInput } from '@/composables/useDebouncedInput'

function formatQty(value, digits = 4) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return '0'
  return number.toFixed(digits).replace(/\.?0+$/, '')
}

function directionLabel(value) {
  return value === 'in' ? '入库' : value === 'out' ? '出库' : '-'
}

const list = ref([])
const loading = ref(false)
const { inputValue: keywordInput, debouncedValue: keyword } = useDebouncedInput('', 260)
const inventoryFlowViewStateStorageKey = 'inventory-flow.view.state'
const filterField = ref('keyword')
const dateRange = ref([])

function loadStoredViewState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(inventoryFlowViewStateStorageKey) || '{}')
    filterField.value = ['keyword', 'material_code', 'material_name', 'source_no', 'movement_type', 'operator_name'].includes(parsed.filterField)
      ? parsed.filterField
      : 'keyword'
    keywordInput.value = typeof parsed.keywordInput === 'string' ? parsed.keywordInput : ''
    dateRange.value = Array.isArray(parsed.dateRange) ? parsed.dateRange.filter(Boolean).slice(0, 2) : []
  } catch {
    filterField.value = 'keyword'
    keywordInput.value = ''
    dateRange.value = []
  }
}

function saveStoredViewState() {
  try {
    localStorage.setItem(
      inventoryFlowViewStateStorageKey,
      JSON.stringify({
        filterField: filterField.value,
        keywordInput: keywordInput.value,
        dateRange: Array.isArray(dateRange.value) ? dateRange.value : []
      })
    )
  } catch {
    // 本地存储不可用时不影响使用
  }
}

loadStoredViewState()

const filterFieldOptions = [
  { label: '综合搜索', value: 'keyword' },
  { label: '原料编码', value: 'material_code' },
  { label: '原料名称', value: 'material_name' },
  { label: '来源单号', value: 'source_no' },
  { label: '动作类型', value: 'movement_type' },
  { label: '操作人', value: 'operator_name' }
]

const filterPlaceholder = computed(() => {
  const map = {
    keyword: '搜索原料 / 来源单号 / 动作 / 操作人',
    material_code: '搜索原料编码',
    material_name: '搜索原料名称',
    source_no: '搜索来源单号',
    movement_type: '搜索动作类型',
    operator_name: '搜索操作人'
  }
  return map[filterField.value] || map.keyword
})

const filteredList = computed(() => list.value)

const summaryItems = computed(() => {
  const source = filteredList.value
  const inbound = source.filter((item) => item.direction === 'in').reduce((sum, item) => sum + Number(item.qty || 0), 0)
  const outbound = source.filter((item) => item.direction === 'out').reduce((sum, item) => sum + Number(item.qty || 0), 0)
  const operators = new Set(source.map((item) => String(item.operator_name || '').trim()).filter(Boolean))
  return [
    { label: '流水条数', value: `${source.length} 条`, note: '支持快速追踪每一次库存变化' },
    { label: '入库合计', value: formatQty(inbound, 2), note: '按当前筛选结果汇总' },
    { label: '出库合计', value: formatQty(outbound, 2), note: '按当前筛选结果汇总' },
    { label: '涉及操作人', value: `${operators.size} 人`, note: '可快速定位责任人' }
  ]
})

const columns = [
  { title: '图片', key: 'image', width: 72, fixed: 'left' },
  { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 170, fixed: 'left' },
  { title: '动作', dataIndex: 'movement_type', key: 'movement_type', width: 120 },
  {
    title: '方向',
    key: 'direction',
    width: 90,
    customRender: ({ record }) => directionLabel(record.direction)
  },
  { title: '原料', key: 'material', width: 180 },
  { title: '颜色', dataIndex: 'color', key: 'color', width: 120 },
  {
    title: '数量',
    key: 'qty',
    width: 130,
    customRender: ({ record }) => `${formatQty(record.qty)} ${record.unit || ''}`.trim()
  },
  {
    title: '变动后结存',
    key: 'balance_after',
    width: 140,
    customRender: ({ record }) => `${formatQty(record.balance_after)} ${record.unit || ''}`.trim()
  },
  { title: '来源单号', dataIndex: 'source_no', key: 'source_no', width: 160 },
  { title: '单据状态', dataIndex: 'document_status', key: 'document_status', width: 110 },
  { title: '操作人', dataIndex: 'operator_name', key: 'operator_name', width: 120 },
  { title: '客户端', dataIndex: 'client_name', key: 'client_name', width: 140 },
  { title: '备注', dataIndex: 'remark', key: 'remark', width: 220 }
]

async function loadList() {
  loading.value = true
  try {
    list.value = await api.db.getInventoryMovements({
      filterField: filterField.value,
      keyword: keyword.value,
      dateFrom: Array.isArray(dateRange.value) ? dateRange.value[0] : '',
      dateTo: Array.isArray(dateRange.value) ? dateRange.value[1] : '',
      limit: 800
    })
  } catch (error) {
    message.error(error.message || '加载库存流水失败')
  } finally {
    loading.value = false
  }
}

watch(
  [filterField, keyword, () => (Array.isArray(dateRange.value) ? dateRange.value.join('|') : '')],
  () => {
    loadList()
  },
  { immediate: true }
)

watch([filterField, keywordInput, dateRange], () => {
  saveStoredViewState()
})
</script>
