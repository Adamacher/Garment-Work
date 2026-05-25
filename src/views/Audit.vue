<template>
  <a-card class="content-card" :bordered="false">
    <PageSummaryStrip :items="summaryItems" />

    <div class="erp-toolbar">
      <div class="erp-toolbar__filters">
        <a-select v-model:value="filterField" :options="filterFieldOptions" style="width: 160px" />
        <a-input v-model:value="keywordInput" :placeholder="filterPlaceholder" allow-clear style="width: 360px" />
      </div>
      <div class="erp-toolbar__actions">
        <a-button class="toolbar-refresh-btn" :loading="loading" @click="loadList">刷新</a-button>
      </div>
    </div>

    <div class="erp-table-caption">
      为了保证长期使用不卡顿，当前默认只加载最近 120 条操作审计记录，并支持按模块、动作、对象、操作人快速筛选。
    </div>

    <a-table
      class="erp-dense-table"
      :data-source="pagedList"
      :columns="columns"
      :row-key="(row) => row.id"
      :pagination="false"
      :loading="loading"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'change'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ record.entity_label || '-' }}</div>
            <div class="table-secondary">前：{{ record.before_preview || '-' }}</div>
            <div class="table-secondary">后：{{ record.after_preview || '-' }}</div>
          </div>
        </template>
      </template>
    </a-table>

    <div class="table-pagination">
      <a-pagination
        v-model:current="currentPage"
        v-model:page-size="pageSize"
        :total="filteredList.length"
        :page-size-options="['12', '24', '50']"
        show-size-changer
        show-less-items
      />
    </div>
  </a-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import PageSummaryStrip from '@/components/PageSummaryStrip.vue'
import { api } from '@/utils/api'
import { useDebouncedInput } from '@/composables/useDebouncedInput'

const list = ref([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(12)
const { inputValue: keywordInput, debouncedValue: keyword } = useDebouncedInput('', 320)
const filterField = ref('keyword')

const filterFieldOptions = [
  { label: '综合搜索', value: 'keyword' },
  { label: '模块', value: 'module' },
  { label: '动作', value: 'action' },
  { label: '对象', value: 'entity_label' },
  { label: '操作人', value: 'operator_name' }
]

const filterPlaceholder = computed(() => {
  const map = {
    keyword: '搜索模块 / 动作 / 对象 / 操作人 / 备注',
    module: '搜索模块',
    action: '搜索动作',
    entity_label: '搜索对象',
    operator_name: '搜索操作人'
  }
  return map[filterField.value] || map.keyword
})

const filteredList = computed(() => {
  const text = String(keyword.value || '').trim().toLowerCase()
  if (!text) return list.value
  return list.value.filter((item) => {
    const sourceMap = {
      keyword: [item.module, item.action, item.entity_label, item.operator_name, item.client_name, item.remark],
      module: [item.module],
      action: [item.action],
      entity_label: [item.entity_label],
      operator_name: [item.operator_name]
    }
    return (sourceMap[filterField.value] || sourceMap.keyword)
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(text)
  })
})

const pagedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredList.value.slice(start, start + pageSize.value)
})

const summaryItems = computed(() => {
  const source = filteredList.value
  const operators = new Set(source.map((item) => String(item.operator_name || '').trim()).filter(Boolean))
  const modules = new Set(source.map((item) => String(item.module || '').trim()).filter(Boolean))
  return [
    { label: '审计条数', value: `${source.length} 条`, note: '支持快速检索操作记录' },
    { label: '涉及人员', value: `${operators.size} 人`, note: '记录操作账号与客户端信息' },
    { label: '涉及模块', value: `${modules.size} 个`, note: '采购、生产、物料、账号等全链路留痕' },
    { label: '最近动作', value: source[0]?.action || '-', note: source[0]?.created_at || '暂无记录' }
  ]
})

const columns = [
  { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 170 },
  { title: '模块', dataIndex: 'module', key: 'module', width: 120 },
  { title: '动作', dataIndex: 'action', key: 'action', width: 120 },
  { title: '对象变化', key: 'change', width: 360 },
  { title: '操作人', dataIndex: 'operator_name', key: 'operator_name', width: 120 },
  { title: '客户端', dataIndex: 'client_name', key: 'client_name', width: 140 },
  { title: '备注', dataIndex: 'remark', key: 'remark' }
]

async function loadList() {
  loading.value = true
  try {
    list.value = await api.db.getAuditLogs({ limit: 120 })
  } catch (error) {
    message.error(error.message || '加载操作审计失败')
  } finally {
    loading.value = false
  }
}

watch([filterField, keyword], () => {
  currentPage.value = 1
})

watch(pageSize, () => {
  currentPage.value = 1
})

loadList()
</script>
