<template>
  <a-card class="content-card" :bordered="false">
    <template #title>BOM 配置</template>

    <div class="toolbar">
      <div class="toolbar-left">
        <a-select
          v-model:value="selectedGarmentId"
          style="width: 360px"
          :options="garmentOptions"
          show-search
          option-filter-prop="label"
          placeholder="先选择需要维护 BOM 的成衣"
        />
      </div>
      <div class="toolbar-right">
        <a-button class="toolbar-refresh-btn" @click="refreshPage">刷新</a-button>
        <a-button type="primary" :disabled="!selectedGarmentId" @click="openCreate">新增 BOM 物料</a-button>
      </div>
    </div>

    <div class="erp-table-caption">
      这里既可以维护单件 BOM，也可以按目标件数自动反推采购量，并勾选生成草稿采购单。
    </div>

    <a-empty v-if="!selectedGarmentId" description="请选择成衣后查看和维护 BOM" />

    <template v-else>
      <a-table :data-source="bomList" :columns="columns" :pagination="false" :row-key="(row) => row.id">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'material'">
            <div>{{ [record.material_code, record.material_name].filter(Boolean).join(' / ') || '-' }}</div>
            <div class="table-secondary">颜色：{{ record.material_color || '-' }}</div>
            <div class="table-secondary">供料：{{ supplyModeLabel(record.supply_mode) }}</div>
          </template>

          <template v-else-if="column.key === 'usage'">
            <div>单件用量：{{ formatQty(record.usage) }} {{ normalizeUnit(record.usage_unit) }}</div>
            <div>折合基础单位：{{ formatQty(resolveUsageInMaterialUnit(record)) }} {{ normalizeUnit(record.material_unit) }}</div>
            <div>损耗率：{{ formatPercent(record.loss_rate) }}</div>
          </template>

          <template v-else-if="column.key === 'price'">
            <div>核价口径：{{ record.price_type_label || priceTypeLabel(record.cost_price_type) }}</div>
            <div>参考单价：{{ formatMoney(record.current_unit_cost, 4) }} / {{ normalizeUnit(record.material_unit) }}</div>
            <div>单件参考成本：{{ formatMoney(record.per_piece_cost, 4) }}</div>
          </template>

          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button size="small" @click="openEdit(record)">编辑</a-button>
              <a-popconfirm title="确认删除该 BOM 项？" @confirm="remove(record.id)">
                <a-button size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>

      <a-divider />

      <div class="section-caption" style="margin-bottom: 12px;">
        <div>
          <div class="section-caption__title">工厂加工费配置</div>
          <div class="section-caption__desc">这里维护当前成衣对应不同工厂的加工费，生产制单选择加工厂后会自动带出。</div>
        </div>
        <a-space>
          <a-button size="small" @click="addFactoryFeeRow">新增工厂加工费</a-button>
          <a-button size="small" type="primary" :disabled="!selectedGarmentId" @click="saveGarmentFactoryFees">保存工厂加工费</a-button>
        </a-space>
      </div>

      <div v-if="!factoryFeeRows.length" class="formula-box" style="margin-bottom: 12px;">
        当前未设置工厂加工费。建议在这里直接按工厂维护加工费，生产制单选择加工厂后会自动带出。
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

      <a-divider />

      <div class="section-caption" style="margin-bottom: 12px;">
        <div>
          <div class="section-caption__title">按件数反推采购量</div>
          <div class="section-caption__desc">输入计划制作数量后，系统会按 BOM 单件用量和损耗率自动换算采购需求。</div>
        </div>
      </div>

      <a-row :gutter="16" style="margin-bottom: 16px;">
        <a-col :span="8">
          <a-form-item label="计划制作数量">
            <a-input-number v-model:value="planQuantity" style="width: 100%" :min="0" :step="1" />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="生成采购单备注">
            <a-input :value="purchaseRemark" readonly />
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="操作">
            <a-space>
              <a-button @click="selectAllPlanRows">全选</a-button>
              <a-button @click="clearPlanSelection">清空选择</a-button>
              <a-button :disabled="!selectedGarmentId" @click="openCreateProductionOrder">
                生成生产制单
              </a-button>
              <a-button type="primary" :disabled="!selectedPlanKeys.length || !planQuantity" @click="generatePurchaseDrafts">
                生成采购单
              </a-button>
            </a-space>
          </a-form-item>
        </a-col>
      </a-row>

      <a-table
        :data-source="planRows"
        :columns="planColumns"
        :pagination="false"
        :row-key="(row) => row.id"
        :row-selection="{ selectedRowKeys: selectedPlanKeys, onChange: onPlanSelectionChange }"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'material'">
            <div>{{ [record.material_code, record.material_name].filter(Boolean).join(' / ') || '-' }}</div>
            <div class="table-secondary">颜色：{{ record.material_color || '-' }}</div>
            <div class="table-secondary">供应商：{{ record.supplier || '-' }}</div>
          </template>

          <template v-else-if="column.key === 'purchase_unit'">
            <a-select
              :value="planUnitMap[record.id]"
              :options="getPurchaseUnitOptions(record)"
              style="width: 110px"
              @change="(value) => updatePlanUnit(record.id, value)"
            />
          </template>

          <template v-else-if="column.key === 'required_qty'">
            <div>{{ formatQty(record.required_qty) }} {{ normalizeUnit(record.material_unit) }}</div>
            <div class="table-secondary">含损耗后基础量</div>
          </template>

          <template v-else-if="column.key === 'purchase_qty'">
            <div>{{ formatQty(record.purchase_qty) }} {{ normalizeUnit(planUnitMap[record.id] || record.material_unit) }}</div>
            <div class="table-secondary">按采购单位换算</div>
          </template>

          <template v-else-if="column.key === 'purchase_price'">
            <div>{{ formatMoney(record.purchase_price, 4) }} / {{ normalizeUnit(planUnitMap[record.id] || record.material_unit) }}</div>
            <div class="table-secondary">{{ priceTypeLabel(record.cost_price_type) }}</div>
          </template>
        </template>
      </a-table>
    </template>

    <a-modal v-model:open="visible" :title="form.id ? '编辑 BOM' : '新增 BOM'" width="860px" @ok="save">
      <a-form layout="vertical">
        <a-form-item label="物料" required>
          <a-select v-model:value="form.material_id" :options="materialOptions" show-search option-filter-prop="label" />
        </a-form-item>

        <a-row :gutter="16">
          <a-col :span="8">
            <a-form-item label="颜色">
              <a-select v-model:value="form.material_color" class="material-related-select" style="width: 100%" show-search option-filter-prop="label" allow-clear :options="colorOptions" placeholder="选择颜色" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="供料方式">
              <a-select v-model:value="form.supply_mode" :options="supplyModeOptions" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="成本核价口径">
              <a-select v-model:value="form.cost_price_type" :options="priceTypeOptions" />
            </a-form-item>
          </a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="8">
            <a-form-item label="用料类型">
              <a-select v-model:value="form.material_role" :options="materialRoleOptions" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="计料方式">
              <a-select v-model:value="form.usage_mode" :options="usageModeOptions" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="损耗率">
              <a-input-number v-model:value="form.loss_rate" style="width: 100%" :min="0" :step="0.01" />
            </a-form-item>
          </a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="单件用量" required>
              <a-input-number v-model:value="form.usage" style="width: 100%" :min="0" :step="0.0001" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="用量单位">
              <a-select v-model:value="form.usage_unit" :options="usageUnitOptions" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="productionVisible"
      title="BOM 一键生成生产制单"
      width="920px"
      ok-text="生成生产制单"
      cancel-text="取消"
      :confirm-loading="productionSaving"
      @ok="confirmCreateProductionOrder"
    >
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="8">
            <a-form-item label="制单号">
              <a-input v-model:value="productionForm.order_no" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="加工厂">
              <InlineOptionSelect
                v-model="productionForm.factory_name"
                :entries="optionLists.factories"
                option-type="factory"
                add-label="加工厂"
                placeholder="选择或新增工厂"
                allow-clear
                @options-updated="handleOptionsUpdated"
              />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="加工费(元/件)">
              <a-input-number v-model:value="productionForm.process_fee" style="width: 100%" :min="0" />
            </a-form-item>
          </a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="8">
            <a-form-item label="下单日期">
              <a-input v-model:value="productionForm.pending_date" placeholder="YYYY-MM-DD" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="交期">
              <a-input v-model:value="productionForm.delivery_date" placeholder="YYYY-MM-DD" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="单据状态">
              <a-select v-model:value="productionForm.document_status" :options="productionDocumentStatusOptions" />
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item label="整单备注">
          <a-textarea v-model:value="productionForm.remark" :rows="3" />
        </a-form-item>

        <div class="section-caption" style="margin: 8px 0 12px;">
          <div>
            <div class="section-caption__title">尺码数量</div>
            <div class="section-caption__desc">这里直接填写待生产各尺码数量，系统会自动汇总制单数量。</div>
          </div>
          <a-button size="small" @click="addProductionSizeRow">新增尺码</a-button>
        </div>

        <div v-for="(row, index) in productionSizeRows" :key="row.localKey" class="bom-row" style="margin-bottom: 10px;">
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item :label="`尺码 ${index + 1}`" style="margin-bottom: 0;">
                <a-input v-model:value="row.size" placeholder="如：S / M / L / XL" />
              </a-form-item>
            </a-col>
            <a-col :span="10">
              <a-form-item label="数量" style="margin-bottom: 0;">
                <a-input-number v-model:value="row.qty" style="width: 100%" :min="0" :step="1" />
              </a-form-item>
            </a-col>
            <a-col :span="2" style="text-align: right;">
              <a-button danger size="small" @click="removeProductionSizeRow(index)">删除</a-button>
            </a-col>
          </a-row>
        </div>

        <div class="formula-box">
          制单数量合计：{{ productionTotalQty }}
        </div>
      </a-form>
    </a-modal>
  </a-card>
</template>

<script setup>
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { api, formatMoney } from '@/utils/api'
import { convertQuantity, convertUnitPrice, normalizeUnit } from '@/utils/material'
import InlineOptionSelect from '@/components/InlineOptionSelect.vue'

const garments = ref([])
const materials = ref([])
const bomList = ref([])
const selectedGarmentId = ref(null)
const visible = ref(false)
const planQuantity = ref(0)
const selectedPlanKeys = ref([])
const planUnitMap = reactive({})
const optionLists = ref({ factories: [] })
const factoryFeeRows = ref([])
const productionVisible = ref(false)
const productionSaving = ref(false)
const productionSizeRows = ref([])

const productionForm = reactive({
  order_no: '',
  factory_name: '',
  process_fee: 0,
  pending_date: '',
  delivery_date: '',
  document_status: 'draft',
  remark: ''
})

const usageUnitOptions = [
  { label: '米', value: '米' },
  { label: '码', value: '码' },
  { label: '公斤', value: '公斤' },
  { label: '厘米', value: '厘米' },
  { label: '个', value: '个' },
  { label: '条', value: '条' },
  { label: '对', value: '对' },
  { label: '套', value: '套' }
]

const priceTypeOptions = [
  { label: '大货价', value: 'bulk' },
  { label: '版布价', value: 'sample' },
  { label: '净布价', value: 'net' }
]

const usageModeOptions = [
  { label: '按量', value: 'by_usage' },
  { label: '尽裁', value: 'full_cut' }
]

const supplyModeOptions = [
  { label: '我方提供', value: 'our_supply' },
  { label: '工厂自配', value: 'factory_supply' }
]

const materialRoleOptions = [
  { label: 'A料', value: 'A料' },
  { label: 'B料', value: 'B料' },
  { label: '辅料', value: '辅料' },
  { label: '里布', value: '里布' },
  { label: 'D料', value: 'D料' }
]

const form = reactive({
  id: null,
  material_id: null,
  material_color: '',
  cost_price_type: 'bulk',
  usage: 0,
  usage_unit: '米',
  loss_rate: 0,
  material_role: '辅料',
  usage_mode: 'by_usage',
  supply_mode: 'our_supply'
})

const columns = [
  { title: '物料', key: 'material' },
  { title: '用量', key: 'usage', width: 220 },
  { title: '成本参考', key: 'price', width: 240 },
  { title: '操作', key: 'action', width: 140 }
]

const planColumns = [
  { title: '物料', key: 'material', width: 260 },
  { title: '采购单位', key: 'purchase_unit', width: 130 },
  { title: '需求基础量', key: 'required_qty', width: 160 },
  { title: '采购数量', key: 'purchase_qty', width: 160 },
  { title: '参考采购单价', key: 'purchase_price', width: 180 }
]

const productionDocumentStatusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已提交', value: 'submitted' }
]

const garmentOptions = computed(() =>
  garments.value.map((item) => ({
    label: item.name ? `${item.style_code} / ${item.name}` : `${item.style_code}`,
    value: item.id
  }))
)

const selectedGarment = computed(() =>
  garments.value.find((item) => Number(item.id) === Number(selectedGarmentId.value)) || null
)

const productionTotalQty = computed(() =>
  productionSizeRows.value.reduce((sum, item) => sum + Number(item.qty || 0), 0)
)

function createFactoryFeeRow(data = {}) {
  return {
    localKey: `${Date.now()}-${Math.random()}`,
    factory_name: String(data.factory_name || '').trim(),
    process_fee: Number(data.process_fee || 0)
  }
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

function addFactoryFeeRow() {
  factoryFeeRows.value.push(createFactoryFeeRow())
}

function removeFactoryFeeRow(index) {
  factoryFeeRows.value.splice(index, 1)
}

function handleOptionsUpdated(nextLists) {
  optionLists.value = nextLists
}

const purchaseRemark = computed(() => {
  const styleText = String(selectedGarment.value?.style_code || selectedGarment.value?.name || '').trim()
  return styleText ? `款号：${styleText}` : '款号：-'
})

const purchaseColorRemark = computed(() => {
  const styleCode = String(selectedGarment.value?.style_code || '').trim()
  return styleCode ? `款号：${styleCode}` : ''
})

function resolveMaterial(materialId) {
  return materials.value.find((item) => Number(item.id) === Number(materialId)) || null
}

function formatMaterialLabel(item) {
  const code = String(item?.code || item?.material_code || '').trim()
  const name = String(item?.name || item?.material_name || '').trim()
  const unit = normalizeUnit(item?.unit || item?.material_unit || '')
  const base = code && name ? `${code} / ${name}` : (code || name || '-')
  return unit ? `${base} / ${unit}` : base
}

const materialOptions = computed(() =>
  materials.value.map((item) => ({
    label: formatMaterialLabel(item),
    value: item.id
  }))
)

const colorOptions = computed(() => {
  const selected = resolveMaterial(form.material_id)
  return [...new Set([...(selected?.allColors || []), ...(selected?.colors || []), ...((selected?.colorProfiles || []).map((item) => item?.color))].map((item) => String(item || '').trim()).filter(Boolean))]
    .map((item) => ({ label: item, value: item }))
})

function resetForm() {
  Object.assign(form, {
    id: null,
    material_id: null,
    material_color: '',
    cost_price_type: 'bulk',
    usage: 0,
    usage_unit: '',
    loss_rate: 0,
    material_role: '辅料',
    usage_mode: 'by_usage',
    supply_mode: 'our_supply'
  })
}

function priceTypeLabel(value) {
  if (value === 'sample') return '版布价'
  if (value === 'net') return '净布价'
  return '大货价'
}

function supplyModeLabel(value) {
  return value === 'factory_supply' ? '工厂自配' : '我方提供'
}

function formatQty(value) {
  return Number(value || 0).toFixed(4).replace(/\.?0+$/, '') || '0'
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`
}

function isFabricMaterial(material) {
  return String(material?.major_category || '').trim() === '面料'
}

function resolveUsageInMaterialUnit(row) {
  const material = resolveMaterial(row.material_id)
  const materialUnit = normalizeUnit(row.material_unit || material?.unit || '米')
  try {
    const converted = convertQuantity(Number(row.usage || 0), normalizeUnit(row.usage_unit || materialUnit), materialUnit, material || {})
    return Number(converted || 0)
  } catch {
    return Number(row.usage_in_material_unit || row.usage || 0)
  }
}

function getPurchaseUnitOptions(row) {
  const material = resolveMaterial(row.material_id)
  const baseUnit = normalizeUnit(row.material_unit || material?.unit || '米')
  const options = [baseUnit]
  if (isFabricMaterial(material)) options.push('米', '码', '公斤')
  return [...new Set(options.filter(Boolean))].map((item) => ({ label: item, value: item }))
}

function getDefaultPlanUnit(row) {
  const options = getPurchaseUnitOptions(row)
  return options[0]?.value || normalizeUnit(row.material_unit || '米')
}

const planRows = computed(() =>
  bomList.value.map((row) => {
    const material = resolveMaterial(row.material_id)
    const materialUnit = normalizeUnit(row.material_unit || material?.unit || '米')
    const requiredQty = Number(resolveUsageInMaterialUnit(row) || 0) * (1 + Number(row.loss_rate || 0)) * Number(planQuantity.value || 0)
    const purchaseUnit = normalizeUnit(planUnitMap[row.id] || getDefaultPlanUnit(row))
    const purchaseQty = Number(convertQuantity(requiredQty, materialUnit, purchaseUnit, material || {}) || 0)
    const purchasePrice = Number(convertUnitPrice(Number(row.current_unit_cost || 0), materialUnit, purchaseUnit, material || {}) || 0)
    return {
      ...row,
      supplier: String(material?.supplier || '').trim(),
      material_unit: materialUnit,
      required_qty: requiredQty,
      purchase_qty: purchaseQty,
      purchase_unit: purchaseUnit,
      purchase_price: purchasePrice
    }
  })
)

function syncPlanSelection() {
  const nextIds = planRows.value.map((item) => item.id)
  selectedPlanKeys.value = selectedPlanKeys.value.length ? selectedPlanKeys.value.filter((id) => nextIds.includes(id)) : nextIds
  if (!selectedPlanKeys.value.length) selectedPlanKeys.value = nextIds
}

function selectAllPlanRows() {
  selectedPlanKeys.value = planRows.value.map((item) => item.id)
}

function clearPlanSelection() {
  selectedPlanKeys.value = []
}

function onPlanSelectionChange(keys) {
  selectedPlanKeys.value = keys
}

function updatePlanUnit(id, value) {
  planUnitMap[id] = normalizeUnit(value)
}

function resolveProcessFeeForFactory(factoryName = '') {
  const normalizedFactoryName = String(factoryName || '').trim()
  const feeMap = Array.isArray(selectedGarment.value?.factory_process_fees) ? selectedGarment.value.factory_process_fees : []
  const match = feeMap.find((item) => String(item.factory_name || '').trim() === normalizedFactoryName)
  return Number(match?.process_fee ?? 0)
}

function resetProductionCreateForm() {
  productionForm.order_no = ''
  productionForm.factory_name = ''
  productionForm.process_fee = 0
  productionForm.pending_date = new Date().toISOString().slice(0, 10)
  productionForm.delivery_date = ''
  productionForm.document_status = 'draft'
  productionForm.remark = String(selectedGarment.value?.remark || '').trim()
  productionSizeRows.value = ['S', 'M', 'L'].map((item) => createProductionSizeRow(item, 0))
}

async function openCreateProductionOrder() {
  if (!selectedGarmentId.value) {
    message.error('请先选择成衣')
    return
  }
  resetProductionCreateForm()
  productionForm.order_no = await api.db.getNextProductionOrderNo()
  productionVisible.value = true
}

function addProductionSizeRow() {
  productionSizeRows.value.push(createProductionSizeRow())
}

function removeProductionSizeRow(index) {
  if (productionSizeRows.value.length <= 1) return
  productionSizeRows.value.splice(index, 1)
}

watch(
  () => productionForm.factory_name,
  (value) => {
    productionForm.process_fee = resolveProcessFeeForFactory(value)
  }
)

async function confirmCreateProductionOrder() {
  if (!selectedGarmentId.value || !selectedGarment.value) {
    message.error('请先选择成衣')
    return
  }
  const sizeRows = normalizeProductionSizeRows(productionSizeRows.value)
  const totalQty = sizeRows.reduce((sum, item) => sum + Number(item.qty || 0), 0)
  if (!String(productionForm.order_no || '').trim()) {
    message.error('请先填写制单号')
    return
  }
  if (totalQty <= 0) {
    message.error('请先填写各尺码数量')
    return
  }
  productionSaving.value = true
  try {
    const materialsPayload = bomList.value.map((row, index) => ({
      material_id: row.material_id,
      sort_order: index + 1,
      usage: Number(row.usage || 0),
      usage_in_material_unit: Number(resolveUsageInMaterialUnit(row) || 0),
      usage_unit: normalizeUnit(row.usage_unit || row.material_unit || '米'),
      loss_rate: Number(row.loss_rate || 0),
      material_role: row.material_role || '辅料',
      supply_mode: row.supply_mode || 'our_supply',
      processing_requirements: Array.isArray(row.processing_requirements) ? [...row.processing_requirements] : [],
      material_color: row.material_color || '',
      usage_mode: row.usage_mode || 'by_usage',
      material_size_breakdown: Array.isArray(row.material_size_breakdown) ? row.material_size_breakdown : [],
      actual_issued_qty_raw: 0,
      actual_roll_count: 0,
      actual_issued_unit: normalizeUnit(row.material_unit || '米'),
      cost_price_type: row.cost_price_type || 'bulk',
      current_unit_cost: Number(row.current_unit_cost || 0),
      current_unit_cost_per_meter: Number(row.current_unit_cost_per_meter || 0)
    }))

    await api.db.saveProductionOrder({
      order_no: String(productionForm.order_no || '').trim(),
      garment_id: Number(selectedGarmentId.value),
      factory_name: String(productionForm.factory_name || '').trim(),
      process_fee: Number(productionForm.process_fee || 0),
      document_status: productionForm.document_status || 'draft',
      status: '待生产',
      pending_date: productionForm.pending_date || new Date().toISOString().slice(0, 10),
      cut_date: '',
      completed_date: '',
      delivery_date: productionForm.delivery_date || '',
      remark: String(productionForm.remark || '').trim(),
      quantity: totalQty,
      size_breakdown: stringifyProductionSizeRows(sizeRows),
      cut_output_qty: null,
      cut_size_breakdown: '[]',
      actual_output_qty: null,
      actual_size_breakdown: '[]',
      materials: materialsPayload
    })
    productionVisible.value = false
    message.success('已根据 BOM 生成草稿生产制单')
  } catch (error) {
    message.error(error.message || '生成生产制单失败')
  } finally {
    productionSaving.value = false
  }
}

function openCreate() {
  resetForm()
  visible.value = true
}

function openEdit(row) {
  Object.assign(form, {
    id: row.id,
    material_id: row.material_id,
    material_color: row.material_color || '',
    cost_price_type: row.cost_price_type || 'bulk',
    usage: Number(row.usage || 0),
    usage_unit: normalizeUnit(row.usage_unit || row.material_unit || '米'),
    loss_rate: Number(row.loss_rate || 0),
    material_role: row.material_role || '辅料',
    usage_mode: row.usage_mode || 'by_usage',
    supply_mode: row.supply_mode || 'our_supply'
  })
  visible.value = true
}

async function loadBaseData() {
  try {
    const [garmentResult, materialResult, optionResult] = await Promise.all([
      api.db.getGarments(),
      api.db.getMaterials(),
      api.db.getOptionLists()
    ])
    garments.value = garmentResult || []
    materials.value = materialResult || []
    optionLists.value = optionResult || { factories: [] }
  } catch (error) {
    message.error(error.message || '加载基础资料失败')
  }
}

async function saveGarmentFactoryFees() {
  if (!selectedGarment.value?.id) {
    message.error('请先选择成衣')
    return
  }
  try {
    await api.db.updateGarment({
      id: Number(selectedGarment.value.id),
      style_code: String(selectedGarment.value.style_code || '').trim(),
      name: String(selectedGarment.value.name || '').trim(),
      image_path: String(selectedGarment.value.image_path || '').trim(),
      category: String(selectedGarment.value.category || '').trim(),
      process_fee: Number(selectedGarment.value.process_fee || 0),
      factory_process_fees: normalizeFactoryFeePayload(factoryFeeRows.value),
      markup_rate: Number(selectedGarment.value.markup_rate || 0),
      remark: String(selectedGarment.value.remark || '')
    })
    await loadBaseData()
    message.success('工厂加工费已保存')
  } catch (error) {
    message.error(error.message || '保存工厂加工费失败')
  }
}

async function loadBom() {
  if (!selectedGarmentId.value) {
    bomList.value = []
    return
  }
  try {
    bomList.value = await api.db.getBomsByGarment(selectedGarmentId.value)
    syncPlanSelection()
  } catch (error) {
    message.error(error.message || '加载 BOM 失败')
  }
}

async function refreshPage() {
  try {
    await loadBaseData()
    await loadBom()
    message.success('BOM 已刷新')
  } catch (error) {
    message.error(error.message || '刷新 BOM 失败')
  }
}

async function save() {
  if (!selectedGarmentId.value || !form.material_id || !Number(form.usage || 0)) {
    message.error('请先选择成衣，并填写物料和单件用量')
    return
  }

  try {
    await api.db.saveBomItem({
      ...form,
      usage_unit: normalizeUnit(form.usage_unit),
      garment_id: selectedGarmentId.value
    })
    message.success('BOM 已保存')
    visible.value = false
    await loadBom()
  } catch (error) {
    message.error(error.message || '保存 BOM 失败')
  }
}

async function remove(id) {
  try {
    await api.db.deleteBomItem(id)
    message.success('BOM 项已删除')
    await loadBom()
  } catch (error) {
    message.error(error.message || '删除 BOM 失败')
  }
}

async function generatePurchaseDrafts() {
  if (!selectedGarmentId.value) {
    message.error('请先选择成衣')
    return
  }
  if (Number(planQuantity.value || 0) <= 0) {
    message.error('请先输入计划制作数量')
    return
  }
  const selectedRows = planRows.value.filter((item) => selectedPlanKeys.value.includes(item.id))
  if (!selectedRows.length) {
    message.error('请先勾选需要生成采购单的原料')
    return
  }

  const supplierPoMap = new Map()
  try {
    for (const row of selectedRows) {
      const supplier = String(row.supplier || '').trim()
      if (!supplier) throw new Error(`原料【${formatMaterialLabel(row)}】未设置供应商，无法生成采购单`)
      if (Number(row.purchase_qty || 0) <= 0) continue
      if (!supplierPoMap.has(supplier)) {
        supplierPoMap.set(supplier, await api.db.getNextPurchaseOrderNo())
      }
      await api.db.savePurchaseBatch({
        batch_no: await api.db.getNextBatchNo(),
        document_status: 'draft',
        purchase_order_no: supplierPoMap.get(supplier),
        supplier,
        material_id: row.material_id,
        color: row.material_color || '',
        color_remark: purchaseColorRemark.value,
        size: '',
        roll_count: 0,
        purchase_input_qty: Number(row.purchase_qty || 0),
        purchase_input_unit: normalizeUnit(planUnitMap[row.id] || row.material_unit),
        price_type: row.cost_price_type || 'bulk',
        price_unit: normalizeUnit(planUnitMap[row.id] || row.material_unit),
        price: Number(row.purchase_price || 0),
        processing_cost: 0,
        processing_note: '',
        received_at: '',
        remark: purchaseRemark.value
      })
    }
    message.success(`已生成 ${supplierPoMap.size} 张草稿采购单`)
  } catch (error) {
    message.error(error.message || '生成采购单失败')
  }
}

watch(selectedGarmentId, async () => {
  await loadBom()
  factoryFeeRows.value = (Array.isArray(selectedGarment.value?.factory_process_fees) ? selectedGarment.value.factory_process_fees : [])
    .map((item) => createFactoryFeeRow(item))
})
watch(
  () => form.material_id,
  (value) => {
    if (!value) return
    const selected = resolveMaterial(value)
    if (!form.material_color && selected?.allColors?.length) {
      form.material_color = selected.allColors[0]
    }
    if (!form.usage_unit || form.usage_unit === '米') {
      form.usage_unit = normalizeUnit(selected?.unit || '米')
    }
  }
)

watch([bomList, planQuantity], () => {
  syncPlanSelection()
}, { deep: true })

watch(
  bomList,
  (rows) => {
    rows.forEach((row) => {
      if (!planUnitMap[row.id]) {
        planUnitMap[row.id] = getDefaultPlanUnit(row)
      }
    })
  },
  { immediate: true, deep: true }
)

onMounted(async () => {
  await loadBaseData()
  await loadBom()
})

onActivated(async () => {
  await loadBaseData()
  await loadBom()
})
</script>


