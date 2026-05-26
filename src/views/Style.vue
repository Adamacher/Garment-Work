<template>
  <a-card class="content-card" :bordered="false">
    <PageSummaryStrip :items="summaryItems" />
    <template #title>成衣管理</template>

    <MobileFilterPanel>
      <template #filters>
        <a-select v-model:value="filterField" :options="filterFieldOptions" style="width: 160px" />
        <InlineOptionSelect
          v-if="filterField === 'category'"
          v-model="categoryFilter"
          :entries="optionLists.garmentCategories"
          option-type="garment_category"
          placeholder="选择成衣分类"
          add-label="成衣分类"
          allow-clear
          @options-updated="handleOptionsUpdated"
        />
        <a-input v-else v-model:value="keywordInput" placeholder="搜索款号 / 成衣名称" style="width: 300px" allow-clear />
        <a-select v-model:value="sortField" :options="sortFieldOptions" style="width: 150px" />
        <a-select v-model:value="sortOrder" :options="sortOrderOptions" style="width: 120px" />
        <a-select v-model:value="costFactoryFilter" :options="costFactoryOptions" style="width: 220px" />
      </template>
      <template #actions>
        <a-button class="toolbar-refresh-btn" :loading="listLoading" @click="loadList">刷新</a-button>
        <a-button :disabled="!selectedRowKeys.length" @click="openBatchMarkup">批量同步上浮</a-button>
        <a-button :disabled="!selectedRowKeys.length" @click="openBatchProduction">批量生成生产单</a-button>
        <a-button type="primary" @click="openCreate">新增成衣</a-button>
      </template>
    </MobileFilterPanel>

    <div class="erp-table-caption">
      支持按分类与关键词快速定位成衣；图片采用悬浮大图预览，成本、上浮与 BOM 配置保持高密度对照展示。
    </div>

    <div v-if="isMobileLayout" class="erp-mobile-list">
      <div
        v-for="record in filteredList"
        :key="record.id"
        class="erp-mobile-card"
      >
        <div class="erp-mobile-card__head">
          <div>
            <div class="erp-mobile-card__title">{{ record.style_code }}</div>
            <div class="erp-mobile-card__meta">{{ record.name || '-' }} · {{ record.category || '-' }}</div>
          </div>
          <HoverImageThumb :src="record.image_path" alt="garment" />
        </div>
        <div class="erp-mobile-card__grid">
          <div class="erp-mobile-card__stat">
            <div class="erp-mobile-card__label">衣服成本</div>
            <div class="erp-mobile-card__value" :class="{ 'cost-text--warning': record.actual_production_cost_missing }">
              {{ formatMoney(record.garment_cost_estimate, 4) }}/件
            </div>
            <div v-if="record.actual_production_cost_missing" class="cost-source-warning">暂无实际生产成本，按最低加工费参考</div>
          </div>
          <div class="erp-mobile-card__stat">
            <div class="erp-mobile-card__label">上浮后单价</div>
            <div class="erp-mobile-card__value">{{ formatMoney(record.markup_price, 4) }}/件</div>
          </div>
          <div class="erp-mobile-card__stat">
            <div class="erp-mobile-card__label">已配原料</div>
            <div class="erp-mobile-card__value">{{ record.bom_count || 0 }} 项</div>
          </div>
          <div class="erp-mobile-card__stat">
            <div class="erp-mobile-card__label">上浮比例</div>
            <div class="erp-mobile-card__value">{{ formatMoney((record.markup_rate || 0) * 100, 2) }}%</div>
          </div>
        </div>
        <div v-if="record.remark" class="erp-mobile-card__sub">{{ record.remark }}</div>
        <div class="erp-mobile-card__footer">
          <a-button size="small" @click="openCopy(record)">复制</a-button>
          <a-button size="small" @click="openEdit(record)">编辑</a-button>
          <a-popconfirm title="确认删除该成衣？" @confirm="remove(record.id)">
            <a-button size="small" danger>删除</a-button>
          </a-popconfirm>
        </div>
      </div>
    </div>

    <a-table
      v-else
      class="erp-dense-table"
      :data-source="filteredList"
      :columns="columns"
      :loading="listLoading"
      :pagination="{ pageSize: 12, showSizeChanger: true, pageSizeOptions: ['12', '24', '50'] }"
      :scroll="{ x: 1380 }"
      :row-key="(row) => row.id"
      :row-selection="rowSelection"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'image'">
          <HoverImageThumb :src="record.image_path" alt="garment" />
        </template>

        <template v-else-if="column.key === 'cost'">
          <div class="table-stack table-stack--tight">
            <div class="table-metric">原料加权成本：{{ formatMoney(record.material_cost_estimate, 4) }}/件</div>
            <div class="table-secondary">加工费：{{ formatMoney(record.process_cost_estimate, 4) }}/件</div>
            <div class="table-emphasis" :class="{ 'cost-text--warning': record.actual_production_cost_missing }">
              衣服成本：{{ formatMoney(record.garment_cost_estimate, 4) }}/件
            </div>
            <div v-if="record.actual_production_cost_missing" class="cost-source-warning">暂无实际生产成本，按最低加工费参考</div>
            <div class="table-secondary">上浮比例：{{ formatMoney((record.markup_rate || 0) * 100, 2) }}%</div>
            <div class="table-emphasis">上浮后单价：{{ formatMoney(record.markup_price, 4) }}/件</div>
          </div>
        </template>

        <template v-else-if="column.key === 'bom'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">已配原料：{{ record.bom_count || 0 }} 项</div>
            <div class="table-secondary">默认类别：{{ record.category || '-' }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button size="small" @click="openCopy(record)">复制</a-button>
            <a-button size="small" @click="openEdit(record)">编辑</a-button>
            <a-popconfirm title="确认删除该成衣？" @confirm="remove(record.id)">
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="visible" :title="form.id ? '编辑成衣与原料' : '新增成衣与原料'" width="1180px" @ok="save">
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="8">
            <a-form-item label="款号" required>
              <a-input v-model:value="form.style_code" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="成衣名称">
              <a-input v-model:value="form.name" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="品类">
              <InlineOptionSelect
                v-model="form.category"
                :entries="optionLists.garmentCategories"
                option-type="garment_category"
                placeholder="选择成衣分类"
                add-label="成衣分类"
                allow-clear
                @options-updated="handleOptionsUpdated"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="8">
            <a-form-item label="上浮比例(%)">
              <a-input-number v-model:value="form.markup_rate_percent" style="width: 100%" :min="0" :step="0.1" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="商品图片">
              <ImageDropInput v-model="form.image_path" title="成衣图片" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="工厂加工费摘要">
              <a-input :value="factoryFeeSummaryText" readonly placeholder="请在下方按工厂配置加工费" />
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item label="备注">
          <a-textarea v-model:value="form.remark" :rows="2" />
        </a-form-item>

        <div class="section-caption" style="margin-bottom: 10px;">
          <div>
            <div class="section-caption__title">工厂加工费配置</div>
            <div class="section-caption__desc">同一款号可按不同工厂设置不同加工费；生产制单选择加工厂后会自动带出对应加工费。</div>
          </div>
          <a-button size="small" @click="addFactoryFeeRow">新增工厂加工费</a-button>
        </div>

        <div v-if="!factoryFeeRows.length" class="formula-box" style="margin-bottom: 12px;">
          当前未设置工厂加工费。建议直接在这里按工厂维护不同加工费，生产制单会按所选工厂自动带出。
        </div>

        <div v-for="(row, index) in factoryFeeRows" :key="row.localKey" class="bom-row" style="margin-bottom: 12px;">
          <a-row :gutter="12" align="middle">
            <a-col :span="14">
              <a-form-item :label="`工厂 ${index + 1}`" style="margin-bottom: 0;">
                <InlineOptionSelect
                  v-model="row.factory_name"
                  :entries="optionLists.factories"
                  option-type="factory"
                  add-label="加工厂"
                  placeholder="选择或新增加工厂"
                  allow-clear
                  @options-updated="handleOptionsUpdated"
                />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="加工费(元/件)" style="margin-bottom: 0;">
                <a-input-number v-model:value="row.process_fee" style="width: 100%" :min="0" />
              </a-form-item>
            </a-col>
            <a-col :span="2" style="text-align: right;">
              <a-button danger size="small" @click="removeFactoryFeeRow(index)">删除</a-button>
            </a-col>
          </a-row>
        </div>
      </a-form>

      <a-divider />

      <div class="section-caption">
        <div>
          <div class="section-caption__title">成衣原料配置</div>
          <div class="section-caption__desc">
            成衣成本优先按已完成生产单的实际加权成本显示；“尽裁”适合主料，“按量”适合辅料和按单件回算的用料。
          </div>
        </div>
        <a-button @click="addBomRow">新增原料</a-button>
      </div>

      <div v-if="!bomRows.length" class="formula-box">
        当前未配置原料。你可以在这里直接把这件衣服需要的物料、颜色、核价口径、单件用量和损耗率一次录好。
      </div>

      <div
        v-for="(row, index) in bomRows"
        :key="row.localKey"
        class="bom-row sortable-row"
        draggable="true"
        @dragstart="startBomDrag(index)"
        @dragover.prevent
        @drop="dropBomDrag(index)"
      >
        <div class="sortable-row__bar">
          <span class="sortable-row__title">原料 {{ index + 1 }}</span>
          <div class="sortable-row__actions">
            <button type="button" class="drag-handle" title="拖动排序">|||</button>
            <a-button danger size="small" @click="removeBomRow(index)">删除</a-button>
          </div>
        </div>

        <a-row :gutter="12" class="plan-editor-row">
          <a-col :span="4">
            <a-form-item label="原料" required>
              <a-select
                v-model:value="row.material_id"
                :options="materialOptions"
                show-search
                option-filter-prop="label"
                placeholder="选择原料"
                @change="() => handleBomMaterialChange(row)"
              />
            </a-form-item>
          </a-col>
          <a-col :span="2">
            <a-form-item label="用料类型">
              <InlineOptionSelect
                v-model="row.material_role"
                :entries="optionLists.materialRoles"
                option-type="material_role"
                add-label="用料类型"
                placeholder="用料类型"
                @options-updated="handleOptionsUpdated"
                @update:modelValue="() => updateUsageModeByRole(row)"
              />
            </a-form-item>
          </a-col>
          <a-col :span="3">
            <a-form-item label="供料方式">
              <a-select v-model:value="row.supply_mode" :options="supplyModeOptions" />
            </a-form-item>
          </a-col>
          <a-col :span="2">
            <a-form-item label="计料方式">
              <a-select v-model:value="row.usage_mode" :options="usageModeOptions" />
            </a-form-item>
          </a-col>
          <a-col :span="3">
            <a-form-item label="颜色">
              <a-select
                v-model:value="row.material_color"
                class="material-related-select"
                style="width: 100%"
                show-search
                option-filter-prop="label"
                allow-clear
                :options="getColorOptions(row.material_id)"
                placeholder="选择颜色"
              />
            </a-form-item>
          </a-col>
          <a-col :span="2">
            <a-form-item label="核价口径">
              <a-select v-model:value="row.cost_price_type" :options="priceTypeOptions" />
            </a-form-item>
          </a-col>
          <a-col :span="3">
            <a-form-item label="处理要求">
              <a-select
                v-model:value="row.processing_requirements"
                mode="tags"
                :options="processingRequirementOptions"
                placeholder="默认预缩/对色/验布，可自定义"
              />
            </a-form-item>
          </a-col>
          <a-col :span="2">
            <a-form-item label="单件用量">
              <a-input-number v-model:value="row.usage" style="width: 100%" :min="0" :step="0.0001" placeholder="可不填" />
            </a-form-item>
          </a-col>
          <a-col :span="2">
            <a-form-item label="用量单位">
              <InlineOptionSelect
                v-model="row.usage_unit"
                :entries="optionLists.units"
                option-type="unit"
                placeholder="选择单位"
                add-label="单位"
                :dropdown-min-width="240"
                @options-updated="handleOptionsUpdated"
              />
            </a-form-item>
          </a-col>
          <a-col :span="1">
            <a-form-item label="损耗率">
              <a-input-number v-model:value="row.loss_rate" style="width: 100%" :min="0" :step="0.01" />
            </a-form-item>
          </a-col>
        </a-row>

        <div class="bom-row-hint">
          <template v-if="getMaterial(row.material_id)">
            <div>用料类型：{{ row.material_role || '辅料' }}</div>
            <div>供料方式：{{ row.supply_mode === 'factory_supply' ? '工厂自配' : '我方提供' }}</div>
            <div>计料方式：{{ usageModeLabel(row.usage_mode, row.material_role) }}</div>
            <div>采购单位：{{ normalizeUnit(getMaterial(row.material_id).unit) }}</div>
            <div>颜色成本：{{ formatMoney(resolveRowUnitCost(row), 4) }} / {{ normalizeUnit(getMaterial(row.material_id).unit) }}</div>
            <div>
              折算后单件投料：
              {{ getConvertedUsage(row) ? `${getConvertedUsage(row)} ${normalizeUnit(getMaterial(row.material_id).unit)}` : '请补充完整换算参数' }}
            </div>
            <div>参考单件原料成本：{{ formatMoney(getReferenceCost(row), 4) }}</div>
          </template>
        </div>
      </div>
    </a-modal>

    <a-modal v-model:open="batchMarkupVisible" title="批量同步成衣上浮" width="420px" @ok="applyBatchMarkup">
      <a-alert type="info" show-icon style="margin-bottom: 16px;" message="会把当前勾选的成衣统一更新为同一个上浮比例，不改动成本来源。" />
      <a-form layout="vertical">
        <a-form-item label="统一上浮比例(%)">
          <a-input-number v-model:value="batchMarkupPercent" style="width: 100%" :min="0" :step="0.1" />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="batchProductionVisible"
      title="批量生成生产制单"
      width="760px"
      :confirm-loading="batchProductionSaving"
      @ok="confirmBatchProduction"
    >
      <a-alert
        type="info"
        show-icon
        style="margin-bottom: 16px;"
        :message="`将为当前勾选的 ${selectedRowKeys.length} 个成衣分别生成草稿生产单，尺码数量会统一覆盖到每一张生产单。`"
      />
      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="8">
            <a-form-item label="加工厂">
              <InlineOptionSelect
                v-model="batchProductionForm.factory_name"
                :entries="optionLists.factories"
                option-type="factory"
                add-label="加工厂"
                placeholder="选择加工厂"
                allow-clear
                @options-updated="handleOptionsUpdated"
              />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="下单日期">
              <a-date-picker v-model:value="batchProductionForm.pending_date" value-format="YYYY-MM-DD" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="交期">
              <a-date-picker v-model:value="batchProductionForm.delivery_date" value-format="YYYY-MM-DD" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="备注">
          <a-textarea v-model:value="batchProductionForm.remark" :rows="2" placeholder="可填写批量生成备注" />
        </a-form-item>
      </a-form>
      <div class="section-caption" style="margin-bottom: 10px;">
        <div>
          <div class="section-caption__title">统一尺码数量分布</div>
          <div class="section-caption__desc">这里填写的尺码和数量会覆盖所有勾选成衣的待生产数量。</div>
        </div>
        <a-button size="small" @click="addBatchProductionSizeRow">新增尺码</a-button>
      </div>
      <div class="size-grid size-grid--dialog">
        <div v-for="(item, index) in batchProductionSizeRows" :key="item.localKey" class="size-grid__item">
          <a-input v-model:value="item.size" placeholder="尺码" />
          <a-input-number v-model:value="item.qty" :min="0" style="width: 100%" />
          <a-button size="small" danger @click="removeBatchProductionSizeRow(index)">删除</a-button>
        </div>
      </div>
      <div class="table-secondary" style="margin-top: 12px;">合计：{{ batchProductionTotalQty }}</div>
    </a-modal>
  </a-card>
</template>

<script setup>
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import HoverImageThumb from '@/components/HoverImageThumb.vue'
import ImageDropInput from '@/components/ImageDropInput.vue'
import InlineOptionSelect from '@/components/InlineOptionSelect.vue'
import MobileFilterPanel from '@/components/MobileFilterPanel.vue'
import PageSummaryStrip from '@/components/PageSummaryStrip.vue'
import { useDebouncedInput } from '@/composables/useDebouncedInput'
import { useMobileLayout } from '@/composables/useMobileLayout'
import { api, formatMoney } from '@/utils/api'
import { convertQuantity, convertUnitPrice, normalizeUnit } from '@/utils/material'

const { inputValue: keywordInput, debouncedValue: keyword } = useDebouncedInput('', 260)
const styleViewStateStorageKey = 'style.view.state'
const { isMobileLayout } = useMobileLayout()
const actualProductionCostOption = '__actual_production_cost'
const recordLowestCostOption = '__record'
const filterField = ref('keyword')
const categoryFilter = ref(undefined)
const sortField = ref('created_at')
const sortOrder = ref('desc')
const costFactoryFilter = ref(recordLowestCostOption)
const visible = ref(false)
const batchMarkupVisible = ref(false)
const batchMarkupPercent = ref(0)
const batchProductionVisible = ref(false)
const batchProductionSaving = ref(false)
const batchProductionSizeRows = ref([])
const selectedRowKeys = ref([])
const list = ref([])
const listLoading = ref(false)
const materials = ref([])
const bomRows = ref([])
const bomDragIndex = ref(null)
const inventoryColorCostMap = ref(new Map())
const inventoryMaterialCostMap = ref(new Map())
const optionLists = ref({
  materialMajorCategories: [],
  materialCategories: [],
  garmentCategories: [],
  suppliers: [],
  factories: [],
  units: [],
  materialRoles: []
})
let listLoadToken = 0
let reloadTimer = null
const lastLoadedAt = ref(0)

const filterFieldOptions = [
  { label: '按款号/名称', value: 'keyword' },
  { label: '按成衣分类', value: 'category' }
]

const sortFieldOptions = [
  { label: '按新增顺序', value: 'created_at' },
  { label: '按款号', value: 'style_code' },
  { label: '按品类', value: 'category' },
  { label: '按成本', value: 'garment_cost_estimate' }
]

const sortOrderOptions = [
  { label: '倒序', value: 'desc' },
  { label: '正序', value: 'asc' }
]

const costFactoryOptions = computed(() => {
  const factories = new Set()
  ;(optionLists.value?.factories || []).forEach((item) => {
    const value = typeof item === 'object' ? item.value : item
    if (String(value || '').trim()) factories.add(String(value || '').trim())
  })
  ;(list.value || []).forEach((garment) => {
    ;(garment.factory_process_fees || []).forEach((item) => {
      if (String(item?.factory_name || '').trim()) factories.add(String(item.factory_name).trim())
    })
  })
  return [
    { label: '实际生产成本', value: actualProductionCostOption },
    { label: '按原成本加工费(最低)', value: recordLowestCostOption },
    ...[...factories].map((item) => ({ label: `按${item}加工费`, value: item }))
  ]
})

const priceTypeOptions = [
  { label: '大货价', value: 'bulk' },
  { label: '版布价', value: 'sample' },
  { label: '净布价', value: 'net' }
]

const materialRoleOptions = computed(() => {
  const source = Array.isArray(optionLists.value?.materialRoles) ? optionLists.value.materialRoles : []
  const normalized = source
    .map((item) => {
      if (item && typeof item === 'object') return String(item.value || '').trim()
      return String(item || '').trim()
    })
    .filter(Boolean)
  const fallback = ['A料', 'B料', 'C料', 'D料', '里布', '辅料', '其他']
  const values = [...new Set([...(normalized.length ? normalized : fallback), ...fallback])]
  return values.map((item) => ({ label: item, value: item }))
})

const supplyModeOptions = [
  { label: '我方提供', value: 'our_supply' },
  { label: '工厂自配', value: 'factory_supply' }
]

const usageModeOptions = [
  { label: '尽裁', value: 'full_cut' },
  { label: '按量', value: 'by_usage' }
]

const processingRequirementOptions = ['预缩', '对色', '验布'].map((item) => ({ label: item, value: item }))

const form = reactive({
  id: null,
  style_code: '',
  name: '',
  image_path: '',
  category: '',
  process_fee: 0,
  markup_rate_percent: 0,
  remark: ''
})
const batchProductionForm = reactive({
  factory_name: '',
  pending_date: new Date().toISOString().slice(0, 10),
  delivery_date: '',
  remark: ''
})
const factoryFeeRows = ref([])
const factoryFeeSummaryText = computed(() => {
  const rows = normalizeFactoryFeePayload(factoryFeeRows.value)
  if (!rows.length) return ''
  return rows.map((item) => `${item.factory_name}:${formatMoney(item.process_fee, 2)}`).join('；')
})

const columns = [
  { title: '图片', key: 'image', width: 110 },
  { title: '款号', dataIndex: 'style_code', key: 'style_code', width: 120 },
  { title: '成衣名称', dataIndex: 'name', key: 'name', width: 180 },
  { title: '品类', dataIndex: 'category', key: 'category', width: 120 },
  { title: '成本', key: 'cost', width: 220 },
  { title: '原料配置', key: 'bom', width: 160 },
  { title: '备注', dataIndex: 'remark', key: 'remark' },
  { title: '操作', key: 'action', width: 140 }
]

const materialOptions = computed(() =>
  materials.value.map((item) => ({
    label: (() => {
      const code = String(item?.code || '').trim()
      const name = String(item?.name || '').trim()
      const unit = normalizeUnit(item?.unit || '')
      const base = code && name ? `${code} / ${name}` : (code || name || '-')
      return unit ? `${base} / ${unit}` : base
    })(),
    value: item.id
  }))
)

const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  onChange: (keys) => {
    selectedRowKeys.value = keys
  }
}))

const filteredList = computed(() => {
  let source = list.value.map((item) => applyCostFactoryBasis(item))

  if (filterField.value === 'category') {
    if (categoryFilter.value) {
      source = source.filter((item) => String(item.category || '') === String(categoryFilter.value))
    }
  } else {
    const value = keyword.value.trim().toLowerCase()
    if (value) {
      source = source.filter((item) =>
        [item.style_code, item.name, item.category].some((field) =>
          String(field || '').toLowerCase().includes(value)
        )
      )
    }
  }

  const direction = sortOrder.value === 'asc' ? 1 : -1
  source.sort((left, right) => {
    if (sortField.value === 'style_code') {
      return String(left.style_code || '').localeCompare(String(right.style_code || ''), 'zh-Hans-CN', { numeric: true }) * direction
    }
    if (sortField.value === 'category') {
      return String(left.category || '').localeCompare(String(right.category || ''), 'zh-Hans-CN', { numeric: true }) * direction
    }
    if (sortField.value === 'garment_cost_estimate') {
      return (Number(left.garment_cost_estimate || 0) - Number(right.garment_cost_estimate || 0)) * direction
    }
    return String(left.created_at || '').localeCompare(String(right.created_at || ''), 'zh-Hans-CN', { numeric: true }) * direction
  })

  return source
})

const summaryItems = computed(() => {
  const sourceList = filteredList.value
  const bomCount = sourceList.reduce((sum, item) => sum + Number(item.bom_count || 0), 0)
  const averageCost = sourceList.length
    ? sourceList.reduce((sum, item) => sum + Number(item.garment_cost_estimate || 0), 0) / sourceList.length
    : 0
  const withImageCount = sourceList.filter((item) => String(item.image_path || '').trim()).length

  return [
    { label: '成衣款数', value: `${sourceList.length} 款`, note: '可按当前筛选范围统计' },
    { label: '原料配置', value: `${bomCount} 条`, note: '支持颜色与核价口径区分' },
    { label: '平均衣服成本', value: `${formatMoney(averageCost, 4)}/件`, note: '按筛选范围与真实产出加权' },
    { label: '已配图片', value: `${withImageCount} 款`, note: '支持拖拽与粘贴上传' }
  ]
})

const batchProductionTotalQty = computed(() =>
  normalizeProductionSizeRows(batchProductionSizeRows.value)
    .reduce((sum, item) => sum + Number(item.qty || 0), 0)
)

function loadStoredViewState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(styleViewStateStorageKey) || '{}')
    filterField.value = parsed.filterField === 'category' ? 'category' : 'keyword'
    keywordInput.value = String(parsed.keyword || '')
    categoryFilter.value = parsed.categoryFilter || undefined
    sortField.value = ['created_at', 'style_code', 'category', 'garment_cost_estimate'].includes(parsed.sortField)
      ? parsed.sortField
      : 'created_at'
    sortOrder.value = parsed.sortOrder === 'asc' ? 'asc' : 'desc'
    costFactoryFilter.value = parsed.costFactoryFilter || recordLowestCostOption
  } catch {}
}

function saveStoredViewState() {
  try {
    localStorage.setItem(
      styleViewStateStorageKey,
      JSON.stringify({
        filterField: filterField.value,
        keyword: keywordInput.value,
        categoryFilter: categoryFilter.value,
        sortField: sortField.value,
        sortOrder: sortOrder.value,
        costFactoryFilter: costFactoryFilter.value
      })
    )
  } catch {}
}

function handleOptionsUpdated(nextLists) {
  optionLists.value = nextLists
}

function createProductionSizeRow(size = '', qty = 0) {
  return {
    localKey: `${Date.now()}-${Math.random()}`,
    size: String(size || '').trim(),
    qty: Number(qty || 0)
  }
}

function normalizeProductionSizeRows(rows = []) {
  return (rows || [])
    .map((item) => ({ size: String(item?.size || '').trim(), qty: Number(item?.qty || 0) }))
    .filter((item) => item.size || item.qty)
}

function stringifyProductionSizeRows(rows = []) {
  return JSON.stringify(normalizeProductionSizeRows(rows))
}

function createBomRow(data = {}) {
  const material = data.material_id ? getMaterial(Number(data.material_id)) : null
  const materialId = data.material_id ? Number(data.material_id) : null
  return {
    localKey: `${Date.now()}-${Math.random()}`,
    material_id: materialId,
    _original_material_id: materialId,
    material_role: data.material_role || '辅料',
    supply_mode: data.supply_mode || 'our_supply',
    usage_mode: data.usage_mode || (data.material_role === 'A料' ? 'full_cut' : 'by_usage'),
    processing_requirements: Array.isArray(data.processing_requirements)
      ? data.processing_requirements
      : String(data.processing_requirements || '').split(/[,\n/]/).map((item) => item.trim()).filter(Boolean),
    material_color: data.material_color || '',
    cost_price_type: data.cost_price_type || 'bulk',
    usage: data.usage === null || data.usage === undefined || data.usage === '' ? null : Number(data.usage || 0),
    usage_unit: normalizeUnit(data.usage_unit || material?.unit || ''),
    loss_rate: Number(data.loss_rate || 0),
    sort_order: Number(data.sort_order || 0)
  }
}

function handleBomMaterialChange(row) {
  if (!row) return
  const material = getMaterial(row.material_id)
  if (!material) return
  const currentMaterialId = Number(row.material_id || 0) || null
  const originalMaterialId = Number(row._original_material_id || 0) || null
  const hasExplicitUsageUnit = Boolean(String(row.usage_unit || '').trim())
  if (!hasExplicitUsageUnit) {
    row.usage_unit = normalizeUnit(material.unit || '米')
  }
  if (!row.material_color) {
    row.material_color = getColorOptions(row.material_id)[0]?.value || ''
  }
  if (currentMaterialId !== originalMaterialId) {
    row._original_material_id = currentMaterialId
  }
}

function createFactoryFeeRow(data = {}) {
  return {
    localKey: `${Date.now()}-${Math.random()}`,
    factory_name: String(data.factory_name || '').trim(),
    process_fee: Number(data.process_fee || 0)
  }
}

function addFactoryFeeRow() {
  factoryFeeRows.value.push(createFactoryFeeRow())
}

function removeFactoryFeeRow(index) {
  factoryFeeRows.value.splice(index, 1)
}

function normalizeFactoryFeePayload(rows = []) {
  const seen = new Set()
  return rows
    .map((item) => ({
      factory_name: String(item.factory_name || '').trim(),
      process_fee: Number(item.process_fee || 0)
    }))
    .filter((item) => item.factory_name)
    .filter((item) => {
      const key = item.factory_name.toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function moveItem(listValue, fromIndex, toIndex) {
  if (fromIndex === null || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
  const [moved] = listValue.splice(fromIndex, 1)
  listValue.splice(toIndex, 0, moved)
}

function startBomDrag(index) {
  bomDragIndex.value = index
}

function dropBomDrag(index) {
  moveItem(bomRows.value, bomDragIndex.value, index)
  bomDragIndex.value = null
}

function addBomRow() {
  bomRows.value.push(createBomRow())
}

function removeBomRow(index) {
  bomRows.value.splice(index, 1)
}

function getMaterial(materialId) {
  return materials.value.find((item) => item.id === materialId)
}

function getColorOptions(materialId) {
  const material = getMaterial(materialId)
  const profileColors = (material?.colorProfiles || []).map((item) => item?.color)
  return [...new Set([...(material?.allColors || []), ...(material?.colors || []), ...profileColors]
    .map((item) => String(item || '').trim())
    .filter(Boolean))]
    .map((item) => ({ label: item, value: item }))
}

function usageModeLabel(mode, role = '') {
  if (mode === 'full_cut') return '尽裁'
  if (mode === 'by_usage') return '按量'
  return role === 'A料' ? '尽裁' : '按量'
}

function updateUsageModeByRole(row) {
  if (!row) return
  if (row.material_role === 'A料' && row.usage_mode !== 'full_cut') {
    row.usage_mode = 'full_cut'
  }
}

function getConvertedUsage(row) {
  const material = getMaterial(row.material_id)
  if (!material || row.usage === null || row.usage === undefined || row.usage === '') return 0
  return convertQuantity(row.usage, row.usage_unit, material.unit, material)
}

function getAdjustedUnitPrice(price, material = {}) {
  const rawPrice = Number(price || 0)
  if (!rawPrice) return 0
  const adjustmentType = String(material.adjustment_type || 'none').trim()
  if (adjustmentType === 'rate') {
    const rawGapRatio = Number(material.gap_ratio || 0)
    const gapRatio = rawGapRatio > 1 ? rawGapRatio / 100 : rawGapRatio
    if (gapRatio > 0) return Number((rawPrice / gapRatio).toFixed(6))
  }
  if (adjustmentType === 'weight_gap') {
    const referenceQty = Number(material.gap_reference_qty || 0)
    const deduction = Math.max(Number(material.left_gap || 0), 0) + Math.max(Number(material.right_gap || 0), 0)
    const netQty = referenceQty - deduction
    if (referenceQty > 0 && netQty > 0) return Number((rawPrice * (referenceQty / netQty)).toFixed(6))
  }
  return Number(rawPrice.toFixed(6))
}

function resolveProfileUnitCost(material, color, priceType) {
  const profiles = material?.colorProfiles || []
  const normalizedColor = String(color || '').trim().toLowerCase()
  const profile = profiles.find((item) => String(item.color || '').trim().toLowerCase() === normalizedColor) || profiles[0]
  const usageUnit = normalizeUnit(material.unit)
  if (!profile) {
    if (Number(material?.default_price || 0) > 0) {
      return Number(convertUnitPrice(getAdjustedUnitPrice(material.default_price, material), material.default_price_unit || material.unit, material.unit, material) || 0)
    }
    return 0
  }

  if (priceType === 'sample') {
    const preferredSamplePrice = usageUnit === '公斤' ? profile.sample_price_kg : usageUnit === '码' ? profile.sample_price_yard : profile.sample_price_meter
    if (Number(preferredSamplePrice || 0) > 0) {
      return Number(convertUnitPrice(getAdjustedUnitPrice(preferredSamplePrice, material), usageUnit, material.unit, material) || 0)
    }
    if (Number(profile.sample_price_meter || 0) > 0) {
      return Number(convertUnitPrice(getAdjustedUnitPrice(profile.sample_price_meter, material), '米', material.unit, material) || 0)
    }
    if (Number(profile.sample_price_kg || 0) > 0) {
      return Number(convertUnitPrice(getAdjustedUnitPrice(profile.sample_price_kg, material), '公斤', material.unit, material) || 0)
    }
    if (Number(profile.sample_price_yard || 0) > 0) {
      return Number(convertUnitPrice(getAdjustedUnitPrice(profile.sample_price_yard, material), '码', material.unit, material) || 0)
    }
  }
  if (priceType === 'net' && Number(profile.net_price_meter || 0) > 0) {
    return Number(convertUnitPrice(getAdjustedUnitPrice(profile.net_price_meter, material), '米', material.unit, material) || 0)
  }

  const preferredBulkPrice = usageUnit === '公斤' ? profile.bulk_price_kg : usageUnit === '码' ? profile.bulk_price_yard : profile.bulk_price_meter
  if (Number(preferredBulkPrice || 0) > 0) {
    return Number(convertUnitPrice(getAdjustedUnitPrice(preferredBulkPrice, material), usageUnit, material.unit, material) || 0)
  }
  const candidates = [
    { price: Number(getAdjustedUnitPrice(profile.bulk_price_kg, material) || 0), unit: '公斤' },
    { price: Number(getAdjustedUnitPrice(profile.bulk_price_meter, material) || 0), unit: '米' },
    { price: Number(getAdjustedUnitPrice(profile.bulk_price_yard, material) || 0), unit: '码' }
  ]
  const source = candidates.find((item) => item.price > 0)
  if (!source) {
    if (Number(profile.default_price || 0) > 0) {
      return Number(convertUnitPrice(getAdjustedUnitPrice(profile.default_price, material), profile.default_price_unit || material.default_price_unit || material.unit, material.unit, material) || 0)
    }
    if (Number(material?.default_price || 0) > 0) {
      return Number(convertUnitPrice(getAdjustedUnitPrice(material.default_price, material), material.default_price_unit || material.unit, material.unit, material) || 0)
    }
    return 0
  }
  return Number(convertUnitPrice(source.price, source.unit, material.unit, material) || 0)
}

function resolveRowUnitCost(row) {
  const material = getMaterial(row.material_id)
  if (!material) return 0
  if (row.supply_mode === 'factory_supply') {
    return resolveProfileUnitCost(material, row.material_color, row.cost_price_type)
  }

  const normalizedColor = String(row.material_color || '').trim() || '未分色'
  const exactKey = `${material.id}__${normalizedColor}`
  const colorCost = Number(inventoryColorCostMap.value.get(exactKey) || 0)
  if (colorCost > 0) return colorCost
  const materialCost = Number(inventoryMaterialCostMap.value.get(material.id) || 0)
  if (materialCost > 0) return materialCost
  return resolveProfileUnitCost(material, row.material_color, row.cost_price_type)
}

function getReferenceCost(row) {
  const material = getMaterial(row.material_id)
  if (!material || row.usage === null || row.usage === undefined || row.usage === '') return 0
  const converted = getConvertedUsage(row)
  return converted * (1 + Number(row.loss_rate || 0)) * resolveRowUnitCost(row)
}

function estimateBomCost(bomList = [], processFee = 0) {
  const materialCost = bomList.reduce((sum, row) => sum + getReferenceCost(row), 0)
  return {
    material_cost_estimate: Number(materialCost.toFixed(4)),
    process_cost_estimate: Number(Number(processFee || 0).toFixed(4)),
    garment_cost_estimate: Number((materialCost + Number(processFee || 0)).toFixed(4))
  }
}

function resolveFactoryProcessFee(record = {}, factoryName = '') {
  const target = String(factoryName || '').trim()
  if (!target) return resolveLowestFactoryProcessFee(record)
  const match = (record.factory_process_fees || []).find((item) =>
    String(item?.factory_name || '').trim() === target
  )
  return Number(match?.process_fee ?? 0)
}

function resolveLowestFactoryProcessFee(record = {}) {
  const fees = (record.factory_process_fees || [])
    .map((item) => Number(item?.process_fee || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (fees.length) return Math.min(...fees)
  return Number(record.process_cost_estimate ?? record.process_fee ?? 0)
}

function applyCostFactoryBasis(record = {}) {
  const usingActualProductionCost = costFactoryFilter.value === actualProductionCostOption
  const hasActualProductionCost = Number(record.completed_weighted_qty || 0) > 0
    && String(record.cost_source || '') === 'completed_production_weighted'

  if (usingActualProductionCost && hasActualProductionCost) {
    return {
      ...record,
      actual_production_cost_missing: false,
      markup_price: Number((Number(record.garment_cost_estimate || 0) * (1 + Number(record.markup_rate || 0))).toFixed(4))
    }
  }

  const processCost = costFactoryFilter.value === recordLowestCostOption || usingActualProductionCost
    ? resolveLowestFactoryProcessFee(record)
    : resolveFactoryProcessFee(record, costFactoryFilter.value)
  const materialCost = Number(record.material_cost_estimate || 0)
  const garmentCost = Number((materialCost + processCost).toFixed(4))
  return {
    ...record,
    process_cost_estimate: Number(processCost.toFixed(4)),
    garment_cost_estimate: garmentCost,
    markup_price: Number((garmentCost * (1 + Number(record.markup_rate || 0))).toFixed(4)),
    actual_production_cost_missing: usingActualProductionCost
  }
}

function buildInventoryMaps(inventory = {}) {
  const colorMap = new Map()
  const materialAccumulation = new Map()

  ;(inventory.materials || []).forEach((item) => {
    const colorKey = `${item.material_id}__${item.color || '未分色'}`
    const avgCost = Number(item.avg_unit_cost || 0)
    if (avgCost > 0) colorMap.set(colorKey, avgCost)

    const current = materialAccumulation.get(item.material_id) || { qty: 0, value: 0 }
    const qty = Number(item.stock_qty || 0)
    const value = Number(item.stock_value || 0)
    materialAccumulation.set(item.material_id, {
      qty: current.qty + qty,
      value: current.value + value
    })
  })

  const materialMap = new Map()
  materialAccumulation.forEach((value, key) => {
    const avgCost = value.qty > 0 ? Number((value.value / value.qty).toFixed(6)) : 0
    if (avgCost > 0) materialMap.set(key, avgCost)
  })

  inventoryColorCostMap.value = colorMap
  inventoryMaterialCostMap.value = materialMap
}

function summarizeCompletedOrderDetails(orderDetails = []) {
  const summaryMap = new Map()

  ;(orderDetails || []).forEach((order) => {
    const baseQty = Number(order.actual_output_qty || order.cut_output_qty || order.quantity || 0)
    if (!order?.garment_id || !baseQty) return

    const materialCost = Number((order.materials || []).reduce((sum, item) => sum + Number(item.line_cost || 0), 0))
    const processCost = Number(order.process_fee || 0) * baseQty
    const totalCost = materialCost + processCost
    const current = summaryMap.get(order.garment_id) || {
      qty: 0,
      material: 0,
      process: 0,
      total: 0
    }

    current.qty += baseQty
    current.material += materialCost
    current.process += processCost
    current.total += totalCost
    summaryMap.set(order.garment_id, current)
  })

  return summaryMap
}

function buildGarmentPayload() {
  const normalizedFactoryFees = normalizeFactoryFeePayload(factoryFeeRows.value)
  return JSON.parse(JSON.stringify({
    id: form.id ? Number(form.id) : null,
    style_code: String(form.style_code || '').trim(),
    name: String(form.name || '').trim(),
    image_path: String(form.image_path || '').trim(),
    category: String(form.category || '').trim(),
    process_fee: normalizedFactoryFees.length ? Number(normalizedFactoryFees[0].process_fee || 0) : Number(form.process_fee || 0),
    factory_process_fees: normalizedFactoryFees,
    markup_rate: Number(form.markup_rate_percent || 0) / 100,
    remark: String(form.remark || '')
  }))
}

function buildBomPayload() {
  return JSON.parse(JSON.stringify(
    bomRows.value
      .filter((item) => item.material_id)
        .map((item, index) => ({
          material_id: Number(item.material_id),
          material_role: String(item.material_role || '辅料'),
          supply_mode: String(item.supply_mode || 'our_supply'),
          usage_mode: String(item.usage_mode || (item.material_role === 'A料' ? 'full_cut' : 'by_usage')),
          processing_requirements: Array.isArray(item.processing_requirements) ? item.processing_requirements : [],
          material_color: String(item.material_color || ''),
          cost_price_type: String(item.cost_price_type || 'bulk'),
          usage: Number(item.usage || 0),
          usage_unit: normalizeUnit(item.usage_unit || getMaterial(item.material_id)?.unit || '米'),
          loss_rate: Number(item.loss_rate || 0),
          sort_order: index + 1
        }))
  ))
}

function resetForm() {
  Object.assign(form, {
    id: null,
    style_code: '',
    name: '',
    image_path: '',
    category: '',
    process_fee: 0,
    markup_rate_percent: 0,
    remark: ''
  })
  factoryFeeRows.value = []
  bomRows.value = []
}

async function loadList() {
  const token = ++listLoadToken
  listLoading.value = true
  try {
    const [garments, materialList, inventory, options] = await Promise.all([
      api.db.getGarments(),
      api.db.getMaterials(),
      api.db.getInventorySummary(),
      api.db.getOptionLists()
    ])

    materials.value = materialList
    optionLists.value = options
    buildInventoryMaps(inventory)

    const bomGroupMap = new Map()
    const pendingBomIds = []

    for (const item of garments) {
      if (String(item.cost_source || '') === 'completed_production_weighted'
        && Number(item.completed_weighted_qty || 0) > 0) {
        continue
      }
      pendingBomIds.push(item.id)
    }

    if (pendingBomIds.length) {
      const bomResults = await Promise.all(
        pendingBomIds.map(async (garmentId) => [garmentId, await api.db.getBomsByGarment(garmentId)])
      )
      bomResults.forEach(([garmentId, rows]) => {
        bomGroupMap.set(garmentId, rows || [])
      })
    }

    const nextList = garments.map((item) => {
      const estimated = estimateBomCost(bomGroupMap.get(item.id) || [], item.process_fee)

      if (String(item.cost_source || '') === 'completed_production_weighted'
        && Number(item.completed_weighted_qty || 0) > 0) {
        return {
          ...item,
          name: item.name || ''
        }
      }

      return {
        ...item,
        name: item.name || '',
        material_cost_estimate: estimated.material_cost_estimate,
        process_cost_estimate: estimated.process_cost_estimate,
        garment_cost_estimate: estimated.garment_cost_estimate,
        markup_price: Number((estimated.garment_cost_estimate * (1 + Number(item.markup_rate || 0))).toFixed(4))
      }
    })
    if (token === listLoadToken) {
      list.value = nextList
      selectedRowKeys.value = selectedRowKeys.value.filter((id) => nextList.some((item) => item.id === id))
      lastLoadedAt.value = Date.now()
    }
  } catch (error) {
    message.error(error.message || '加载成衣失败')
  } finally {
    if (token === listLoadToken) listLoading.value = false
  }
}

function scheduleListReload(delay = 120) {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    loadList()
  }, delay)
}

function openCreate() {
  resetForm()
  visible.value = true
}

async function openEdit(row) {
  resetForm()
  Object.assign(form, {
    ...row,
    markup_rate_percent: Number(row.markup_rate || 0) * 100
  })
  factoryFeeRows.value = (Array.isArray(row.factory_process_fees) ? row.factory_process_fees : []).map((item) => createFactoryFeeRow(item))
  try {
    const bomList = await api.db.getBomsByGarment(row.id)
    bomRows.value = bomList.map((item) => createBomRow(item))
    visible.value = true
  } catch (error) {
    message.error(error.message || '加载成衣原料失败')
  }
}

async function openCopy(row) {
  resetForm()
  Object.assign(form, {
    ...row,
    id: null,
    style_code: row.style_code ? `${row.style_code}-复制` : '',
    markup_rate_percent: Number(row.markup_rate || 0) * 100
  })
  factoryFeeRows.value = (Array.isArray(row.factory_process_fees) ? row.factory_process_fees : []).map((item) => createFactoryFeeRow(item))
  try {
    const bomList = await api.db.getBomsByGarment(row.id)
    bomRows.value = bomList.map((item) =>
      createBomRow({
        ...item,
        id: null
      })
    )
    visible.value = true
    message.success('已复制成衣内容，可修改后另存')
  } catch (error) {
    message.error(error.message || '复制成衣失败')
  }
}

function openBatchMarkup() {
  if (!selectedRowKeys.value.length) {
    message.error('请先勾选需要同步上浮的成衣')
    return
  }

  const selectedItems = list.value.filter((item) => selectedRowKeys.value.includes(item.id))
  batchMarkupPercent.value = Number(selectedItems[0]?.markup_rate || 0) * 100
  batchMarkupVisible.value = true
}

function addBatchProductionSizeRow(size = '', qty = 0) {
  batchProductionSizeRows.value.push(createProductionSizeRow(size, qty))
}

function removeBatchProductionSizeRow(index) {
  if (batchProductionSizeRows.value.length <= 1) return
  batchProductionSizeRows.value.splice(index, 1)
}

function openBatchProduction() {
  if (!selectedRowKeys.value.length) {
    message.error('请先勾选需要生成生产单的成衣')
    return
  }
  batchProductionForm.factory_name = ''
  batchProductionForm.pending_date = new Date().toISOString().slice(0, 10)
  batchProductionForm.delivery_date = ''
  batchProductionForm.remark = ''
  batchProductionSizeRows.value = ['S', 'M', 'L'].map((item) => createProductionSizeRow(item, 0))
  batchProductionVisible.value = true
}

function resolveBomUsageInMaterialUnit(row = {}) {
  if (Number(row.usage_in_material_unit || 0) > 0) return Number(row.usage_in_material_unit || 0)
  const material = getMaterial(row.material_id)
  const materialUnit = normalizeUnit(row.material_unit || material?.unit || '米')
  try {
    return Number(convertQuantity(Number(row.usage || 0), normalizeUnit(row.usage_unit || materialUnit), materialUnit, material || {}) || 0)
  } catch {
    return Number(row.usage || 0)
  }
}

function buildProductionMaterialsPayload(bomList = []) {
  return (bomList || []).map((row, index) => ({
    material_id: row.material_id,
    sort_order: index + 1,
    usage: Number(row.usage || 0),
    usage_in_material_unit: Number(resolveBomUsageInMaterialUnit(row) || 0),
    usage_unit: normalizeUnit(row.usage_unit || row.material_unit || getMaterial(row.material_id)?.unit || '米'),
    loss_rate: Number(row.loss_rate || 0),
    material_role: row.material_role || '辅料',
    supply_mode: row.supply_mode || 'our_supply',
    processing_requirements: Array.isArray(row.processing_requirements) ? [...row.processing_requirements] : [],
    material_color: row.material_color || '',
    usage_mode: row.usage_mode || 'by_usage',
    material_size_breakdown: Array.isArray(row.material_size_breakdown) ? row.material_size_breakdown : [],
    actual_issued_qty_raw: 0,
    actual_roll_count: 0,
    actual_issued_unit: normalizeUnit(row.material_unit || getMaterial(row.material_id)?.unit || '米'),
    actual_total_amount: 0,
    cost_price_type: row.cost_price_type || 'bulk',
    current_unit_cost: Number(row.current_unit_cost || 0),
    current_unit_cost_per_meter: Number(row.current_unit_cost_per_meter || 0)
  }))
}

async function confirmBatchProduction() {
  const selectedItems = list.value.filter((item) => selectedRowKeys.value.includes(item.id))
  if (!selectedItems.length) {
    message.error('请先勾选需要生成生产单的成衣')
    return
  }
  const sizeRows = normalizeProductionSizeRows(batchProductionSizeRows.value)
  const totalQty = sizeRows.reduce((sum, item) => sum + Number(item.qty || 0), 0)
  if (totalQty <= 0) {
    message.error('请先填写尺码数量')
    return
  }

  batchProductionSaving.value = true
  try {
    let createdCount = 0
    for (const garment of selectedItems) {
      const bomList = await api.db.getBomsByGarment(garment.id)
      if (!bomList?.length) {
        throw new Error(`成衣【${garment.style_code || garment.name || garment.id}】尚未配置原料，已停止生成`)
      }
      const orderNo = await api.db.getNextProductionOrderNo()
      await api.db.saveProductionOrder({
        order_no: String(orderNo || '').trim(),
        garment_id: Number(garment.id),
        factory_name: String(batchProductionForm.factory_name || '').trim(),
        process_fee: Number(batchProductionForm.factory_name
          ? resolveFactoryProcessFee(garment, batchProductionForm.factory_name)
          : resolveLowestFactoryProcessFee(garment)
        ),
        document_status: 'draft',
        status: '待生产',
        pending_date: batchProductionForm.pending_date || new Date().toISOString().slice(0, 10),
        cut_date: '',
        completed_date: '',
        delivery_date: batchProductionForm.delivery_date || '',
        remark: String(batchProductionForm.remark || garment.remark || '').trim(),
        quantity: totalQty,
        size_breakdown: stringifyProductionSizeRows(sizeRows),
        cut_output_qty: null,
        cut_size_breakdown: '[]',
        actual_output_qty: null,
        actual_size_breakdown: '[]',
        materials: buildProductionMaterialsPayload(bomList)
      })
      createdCount += 1
    }
    batchProductionVisible.value = false
    selectedRowKeys.value = []
    message.success(`已生成 ${createdCount} 张草稿生产制单`)
  } catch (error) {
    message.error(error.message || '批量生成生产制单失败')
  } finally {
    batchProductionSaving.value = false
  }
}

async function applyBatchMarkup() {
  if (!selectedRowKeys.value.length) {
    message.error('请先勾选需要同步上浮的成衣')
    return
  }

  try {
    await api.db.batchUpdateGarmentMarkup({
      ids: [...selectedRowKeys.value].map((id) => Number(id)).filter(Boolean),
      markup_rate: Number(batchMarkupPercent.value || 0) / 100
    })
    message.success('勾选成衣的上浮比例已同步')
    batchMarkupVisible.value = false
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '批量同步上浮失败')
  }
}

async function save() {
  if (!form.style_code) {
    message.error('请填写款号')
    return
  }

  try {
    const garmentPayload = buildGarmentPayload()
    const bomPayload = buildBomPayload()
    const garmentId = form.id
      ? (await api.db.updateGarment(garmentPayload), Number(form.id))
      : await api.db.addGarment(garmentPayload)

    await api.db.replaceBomItemsByGarment(Number(garmentId), bomPayload)

    message.success('成衣和原料配置已保存')
    visible.value = false
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '保存成衣失败')
  }
}

async function remove(id) {
  try {
    await api.db.deleteGarment(id)
    message.success('成衣已删除')
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '删除失败')
  }
}

loadStoredViewState()

onMounted(loadList)

onActivated(() => {
  if (!list.value.length || Date.now() - lastLoadedAt.value > 45000) {
    scheduleListReload(40)
  }
})

watch(
  bomRows,
  (rows) => {
    rows.forEach((row) => {
      const material = getMaterial(row.material_id)
      if (!material) return
      if (!row.material_color && material.colorProfiles?.length) row.material_color = material.colorProfiles[0].color
    })
  },
  { deep: true }
)

watch(filterField, (value) => {
  if (value === 'category') {
    keyword.value = ''
  } else {
    categoryFilter.value = undefined
  }
})

watch([filterField, keywordInput, categoryFilter, sortField, sortOrder, costFactoryFilter], () => {
  saveStoredViewState()
}, { deep: true })
</script>


