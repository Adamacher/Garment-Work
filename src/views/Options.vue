<template>
  <section class="erp-page options-page">
    <a-card class="content-card" :bordered="false">
      <template #title>基础设置</template>

      <PageSummaryStrip :items="summaryItems" />

      <a-tabs v-model:activeKey="activeTab">
        <a-tab-pane v-for="tab in tabs" :key="tab.key" :tab="tab.label" />
      </a-tabs>

      <div class="erp-table-caption">
        这里统一维护供应商、加工厂、仓库、分类、单位和用料类型。修改供应商、工厂、仓库等名称时，会同步更新现有业务数据里的对应名称。
      </div>

      <div class="section-caption options-toolbar">
        <div>
          <div class="section-caption__title">{{ currentTab.label }}</div>
          <div class="section-caption__desc">
            支持新增、编辑、删除和拖动排序。编辑已有名称后，采购、库存、出仓入仓、BOM 和生产制单的下拉选项会一起更新。
          </div>
        </div>
        <div class="options-toolbar__actions">
          <a-button class="toolbar-refresh-btn" :loading="loading" @click="loadOptions">刷新</a-button>
          <a-space-compact>
            <a-input
              v-model:value="newValue"
              :placeholder="`新增${currentTab.label}`"
              class="options-toolbar__input"
              allow-clear
              @pressEnter="saveOption"
            />
            <a-button type="primary" :loading="saving" @click="saveOption">新增</a-button>
          </a-space-compact>
        </div>
      </div>

      <div v-if="!currentRows.length" class="formula-box">
        当前还没有可维护的选项，请先新增一条。
      </div>

      <div
        v-for="(record, index) in currentRows"
        :key="record.id || record.value"
        class="sortable-row option-row"
        draggable="true"
        @dragstart="startDrag(index)"
        @dragover.prevent
        @drop="dropDrag(index)"
      >
        <div class="sortable-row__bar option-row__bar">
          <div class="option-row__main">
            <span class="drag-handle" title="拖动排序">|||</span>
            <template v-if="editingValue === record.value">
              <a-input
                v-model:value="editingText"
                class="option-row__edit-input"
                size="small"
                allow-clear
                @pressEnter="confirmEdit(record)"
              />
            </template>
            <template v-else>
              <span class="sortable-row__title">{{ record.value }}</span>
              <span v-if="!record.id" class="option-row__source">来自业务数据</span>
            </template>
          </div>
          <div class="sortable-row__actions option-row__actions">
            <template v-if="editingValue === record.value">
              <a-button size="small" type="primary" :loading="editingSaving" @click="confirmEdit(record)">保存</a-button>
              <a-button size="small" @click="cancelEdit">取消</a-button>
            </template>
            <template v-else>
              <a-button size="small" @click="startEdit(record)">编辑</a-button>
              <a-popconfirm :title="`确认删除 ${record.value}？`" @confirm="removeOption(record.value)">
                <a-button size="small" danger>删除</a-button>
              </a-popconfirm>
            </template>
          </div>
        </div>
      </div>
    </a-card>
  </section>
</template>

<script setup>
import { computed, onActivated, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import PageSummaryStrip from '@/components/PageSummaryStrip.vue'
import { api, normalizeOptionEntries } from '@/utils/api'

const tabs = [
  { key: 'material_major_category', label: '大类（一级分类）', dataKey: 'materialMajorCategories' },
  { key: 'material_category', label: '物料分类（二级分类）', dataKey: 'materialCategories' },
  { key: 'material_sub_category', label: '原料属性（三级分类）', dataKey: 'materialSubCategories' },
  { key: 'material_leaf_category', label: '扩展分类', dataKey: 'materialLeafCategories' },
  { key: 'garment_category', label: '成衣品类', dataKey: 'garmentCategories' },
  { key: 'supplier', label: '供应商', dataKey: 'suppliers' },
  { key: 'warehouse', label: '仓库', dataKey: 'warehouses' },
  { key: 'factory', label: '加工厂', dataKey: 'factories' },
  { key: 'unit', label: '单位', dataKey: 'units' },
  { key: 'material_role', label: '用料类型', dataKey: 'materialRoles' }
]

const activeTab = ref('material_major_category')
const newValue = ref('')
const dragIndex = ref(null)
const loading = ref(false)
const saving = ref(false)
const editingSaving = ref(false)
const editingValue = ref('')
const editingText = ref('')
const optionLists = ref({
  materialMajorCategories: [],
  materialCategories: [],
  materialSubCategories: [],
  materialLeafCategories: [],
  garmentCategories: [],
  suppliers: [],
  warehouses: [],
  factories: [],
  units: [],
  materialRoles: []
})

const currentTab = computed(() => tabs.find((tab) => tab.key === activeTab.value) || tabs[0])
const currentRows = computed(() => normalizeOptionEntries(optionLists.value[currentTab.value.dataKey] || []))

const summaryItems = computed(() => {
  const totalCount = tabs.reduce((sum, tab) => sum + normalizeOptionEntries(optionLists.value[tab.dataKey] || []).length, 0)
  const supplierCount = normalizeOptionEntries(optionLists.value.suppliers || []).length
  const factoryCount = normalizeOptionEntries(optionLists.value.factories || []).length
  const warehouseCount = normalizeOptionEntries(optionLists.value.warehouses || []).length
  return [
    { label: '当前模块', value: currentTab.value.label, note: '正在维护的基础数据类型' },
    { label: '当前条数', value: `${currentRows.value.length} 项`, note: '支持编辑、删除和拖动排序' },
    { label: '供应商 / 工厂', value: `${supplierCount} / ${factoryCount}`, note: '名称修改会同步到业务数据' },
    { label: '仓库维护', value: warehouseCount ? `${warehouseCount} 个` : '待维护', note: '用于入仓、出仓和回收入仓' },
    { label: '全部基础项', value: `${totalCount} 项`, note: '同步到采购、库存、BOM、生产制单' }
  ]
})

function moveItem(list, fromIndex, toIndex) {
  if (fromIndex === null || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return list
  const next = [...list]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function startDrag(index) {
  dragIndex.value = index
}

async function dropDrag(index) {
  const ordered = moveItem(currentRows.value, dragIndex.value, index)
  dragIndex.value = null
  if (!ordered.length) return
  try {
    optionLists.value = await api.db.reorderOptionValues(activeTab.value, ordered.map((item) => item.value))
    message.success(`${currentTab.value.label}排序已更新`)
  } catch (error) {
    message.error(error?.message || '排序保存失败')
  }
}

async function loadOptions() {
  loading.value = true
  try {
    optionLists.value = await api.db.getOptionLists()
  } catch (error) {
    message.error(error?.message || '加载基础设置失败')
  } finally {
    loading.value = false
  }
}

async function saveOption() {
  const value = String(newValue.value || '').trim()
  if (!value) {
    message.error(`请输入${currentTab.value.label}`)
    return
  }
  saving.value = true
  try {
    optionLists.value = await api.db.saveOptionValue(activeTab.value, value)
    newValue.value = ''
    message.success(`${currentTab.value.label}已新增`)
  } catch (error) {
    message.error(error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function startEdit(record) {
  editingValue.value = record.value
  editingText.value = record.value
}

function cancelEdit() {
  editingValue.value = ''
  editingText.value = ''
}

async function confirmEdit(record) {
  const oldValue = String(record?.value || '').trim()
  const nextValue = String(editingText.value || '').trim()
  if (!oldValue) return
  if (!nextValue) {
    message.error('请输入新的名称')
    return
  }
  if (oldValue === nextValue) {
    cancelEdit()
    return
  }
  editingSaving.value = true
  try {
    optionLists.value = await api.db.renameOptionValue(activeTab.value, oldValue, nextValue)
    message.success(`${oldValue} 已修改为 ${nextValue}`)
    cancelEdit()
  } catch (error) {
    message.error(error?.message || '修改失败')
  } finally {
    editingSaving.value = false
  }
}

async function removeOption(value) {
  try {
    optionLists.value = await api.db.deleteOptionValue(activeTab.value, value)
    if (editingValue.value === value) cancelEdit()
    message.success(`${currentTab.value.label}已删除`)
  } catch (error) {
    message.error(error?.message || '删除失败')
  }
}

onMounted(loadOptions)
onActivated(loadOptions)
</script>

<style scoped>
.options-page {
  padding-left: 24px;
}

.options-toolbar {
  margin-bottom: 16px;
}

.options-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.options-toolbar__input {
  width: 260px;
}

.option-row + .option-row {
  margin-top: 12px;
}

.option-row__bar {
  gap: 12px;
}

.option-row__main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
}

.option-row__source {
  flex: none;
  color: #7a8faa;
  font-size: 12px;
}

.option-row__edit-input {
  max-width: 360px;
}

.option-row__actions {
  flex: none;
}

@media (max-width: 900px) {
  .options-page {
    padding-left: 0;
  }

  .options-toolbar__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .options-toolbar__input {
    width: 180px;
  }
}
</style>
