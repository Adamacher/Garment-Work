<template>
  <section class="erp-page dispatch-page">
    <div class="page-hero">
      <div>
        <h1 class="page-title">出仓入仓</h1>
        <p class="page-subtitle">
          从已入仓批次中完成出库到工厂、回收入仓与仓库去向维护，未分配部分继续留在仓库。
        </p>
      </div>
      <div class="page-hero-actions">
        <a-button class="toolbar-refresh-btn" :loading="loading" @click="loadData">刷新</a-button>
      </div>
    </div>

    <PageSummaryStrip :items="summaryItems" />

    <MobileFilterPanel>
      <template #filters>
        <a-select
          v-model:value="filterField"
          class="filter-select-input"
          :options="filterFieldOptions"
          :get-popup-container="getPopupContainer"
        />
        <a-select
          v-model:value="supplierFilter"
          allow-clear
          class="filter-select-input filter-select-input--wide"
          placeholder="供应商"
          :options="supplierOptions"
          show-search
          :filter-option="filterSelectOption"
          :get-popup-container="getPopupContainer"
        />
        <a-select
          v-model:value="factoryFilter"
          allow-clear
          class="filter-select-input filter-select-input--wide"
          placeholder="工厂"
          :options="factorySelectOptions"
          show-search
          :filter-option="filterSelectOption"
          :get-popup-container="getPopupContainer"
        />
        <a-select
          v-model:value="stockScopeFilter"
          class="filter-select-input filter-select-input--wide"
          :options="stockScopeOptions"
          :get-popup-container="getPopupContainer"
        />
        <a-input
          v-model:value="keywordInput"
          allow-clear
          class="filter-search-input"
          :placeholder="filterPlaceholder"
        />
        <a-range-picker
          v-model:value="dateRange"
          class="toolbar-range"
          value-format="YYYY-MM-DD"
          :get-popup-container="getPopupContainer"
        />
      </template>
    </MobileFilterPanel>

    <div v-if="activeDispatchFilterChips.length" class="smart-filter-bar">
      <span class="smart-filter-bar__label">当前筛选</span>
      <a-tag v-for="chip in activeDispatchFilterChips" :key="chip" color="blue">{{ chip }}</a-tag>
      <a-button size="small" @click="clearDispatchFilters">清空筛选</a-button>
    </div>

    <a-card class="content-card" :bordered="false">
      <template #title>出仓入仓台账</template>
      <div class="helper-text">
        这里只显示已审核并正式入仓的采购批次。工厂名称与后台工厂选项同步，也支持在本页直接维护；批次默认先进入仓库，再按需要出库到工厂或回收入仓。
      </div>

      <div v-if="isMobileLayout" class="erp-mobile-list">
        <div v-for="row in pagedRows" :key="row.id" class="erp-mobile-card">
          <div class="erp-mobile-card__head">
            <div>
              <div class="erp-mobile-card__title">{{ row.batch_no || '-' }}</div>
              <div class="erp-mobile-card__meta">{{ row.purchase_order_no || '-' }} · {{ row.supplier || '-' }}</div>
            </div>
            <HoverImageThumb
              :src="row.material_image_path || row.image_path"
              :alt="row.material_name || row.material_code"
              empty-text=""
            />
          </div>
          <div class="erp-mobile-card__section">
            <div class="erp-mobile-card__label">原料</div>
            <div class="erp-mobile-card__value">{{ row.material_code || '-' }}{{ row.material_name ? ` / ${row.material_name}` : '' }}</div>
            <div class="erp-mobile-card__sub">颜色 / 尺码：{{ formatColorWithSize(row) }}</div>
          </div>
          <div class="erp-mobile-card__grid">
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">条数</div>
              <div class="erp-mobile-card__value">{{ formatRollCount(row.roll_count) }}</div>
              <div class="erp-mobile-card__sub">{{ formatAdjustmentSummary(row) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">实际数量</div>
              <div class="erp-mobile-card__value">
                {{
                  formatQtyWithUnit(
                    row.actual_input_qty || row.purchase_input_qty || row.gross_qty,
                    row.actual_input_unit || row.purchase_input_unit || row.unit
                  )
                }}
              </div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">当前工厂</div>
              <div class="erp-mobile-card__value">{{ row.factory_name || '未发工厂' }}</div>
              <div class="erp-mobile-card__sub">仓库：{{ row.warehouse_name || '主仓库' }}</div>
              <div class="erp-mobile-card__sub">
                {{ Number(row.warehouse_remaining_qty || 0) > 0
                  ? `留仓：${formatQtyWithUnit(row.warehouse_remaining_qty, row.actual_input_unit || row.purchase_input_unit || row.unit)}`
                  : '已全部在工厂' }}
              </div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">成本单价</div>
              <div class="erp-mobile-card__value">{{ `${formatMoney(row.base_unit_price, 4)} / ${row.unit || ''}` }}</div>
              <div class="erp-mobile-card__sub">{{ priceTypeLabel(row.price_type) }}</div>
            </div>
          </div>
          <div class="erp-mobile-card__sub">到货日期：{{ formatDate(row.received_at) }}</div>
          <div class="erp-mobile-card__footer">
            <a-button type="primary" size="small" @click="openDispatch(row)">出库到工厂</a-button>
            <a-button v-if="Number(row.factory_allocated_qty || 0) > 0" size="small" @click="openRecover(row)">回收入仓</a-button>
            <a-button size="small" danger @click="openVerifyStock(row)">核实库存</a-button>
          </div>
        </div>
      </div>

      <div v-else class="erp-table-wrap">
        <table class="erp-data-table">
          <thead>
            <tr>
              <th>图片</th>
              <th>批次号</th>
              <th>采购单号</th>
              <th>原料</th>
              <th>颜色</th>
              <th>供应商</th>
              <th>条数</th>
              <th>价格类型</th>
              <th>实际数量</th>
              <th>当前工厂分配</th>
              <th>仓库库存</th>
              <th>成本单价</th>
              <th>到货日期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody v-if="pagedRows.length">
            <tr v-for="row in pagedRows" :key="row.id">
              <td>
                <HoverImageThumb
                  :src="row.material_image_path || row.image_path"
                  :alt="row.material_name || row.material_code"
                  empty-text=""
                />
              </td>
              <td>{{ row.batch_no || '-' }}</td>
              <td>{{ row.purchase_order_no || '-' }}</td>
              <td>
                <div class="table-stack table-stack--tight">
                  <div class="table-primary">{{ row.material_code || '-' }}</div>
                  <div class="table-secondary">{{ row.material_name || '-' }}</div>
                </div>
              </td>
              <td>{{ formatColorWithSize(row) }}</td>
              <td>{{ row.supplier || '-' }}</td>
              <td>
                <div>{{ formatRollCount(row.roll_count) }}</div>
                <div class="table-subtext">{{ formatAdjustmentSummary(row) }}</div>
              </td>
              <td>{{ priceTypeLabel(row.price_type) }}</td>
              <td>
                <div>
                  {{
                    formatQtyWithUnit(
                      row.actual_input_qty || row.purchase_input_qty || row.gross_qty,
                      row.actual_input_unit || row.purchase_input_unit || row.unit
                    )
                  }}
                </div>
                <div class="table-subtext">
                  {{ Number(row.warehouse_remaining_qty || 0) > 0
                    ? `留仓：${formatQtyWithUnit(row.warehouse_remaining_qty, row.actual_input_unit || row.purchase_input_unit || row.unit)}`
                    : '已全部在工厂' }}
                </div>
              </td>
              <td>
                <div class="table-primary">{{ row.factory_name || '未发工厂' }}</div>
                <div class="table-subtext">
                  已发 {{
                    formatQtyWithUnit(
                      row.factory_allocated_qty,
                      row.actual_input_unit || row.purchase_input_unit || row.unit
                    )
                  }}
                </div>
                <div class="table-subtext">仓库：{{ row.warehouse_name || '主仓库' }}</div>
              </td>
              <td>
                <div class="table-primary">
                  {{ formatQtyWithUnit(row.warehouse_remaining_qty, row.actual_input_unit || row.purchase_input_unit || row.unit) }}
                </div>
                <div class="table-subtext">{{ row.warehouse_name || '主仓库' }}</div>
              </td>
              <td>{{ `${formatMoney(row.base_unit_price, 4)} / ${row.unit || ''}` }}</td>
              <td>{{ formatDate(row.received_at) }}</td>
              <td>
                <div class="table-actions-inline">
                  <a-button type="primary" size="small" @click="openDispatch(row)">出库到工厂</a-button>
                  <a-button v-if="Number(row.factory_allocated_qty || 0) > 0" size="small" @click="openRecover(row)">回收入仓</a-button>
                  <a-button size="small" danger @click="openVerifyStock(row)">核实库存</a-button>
                </div>
              </td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr>
              <td colspan="14" class="erp-empty-cell">暂无数据</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="table-pagination">
        <label class="table-pagination__size">
          <span>每页</span>
          <select v-model.number="pageSize" class="table-pagination__native-select">
            <option v-for="size in pageSizeOptions" :key="`dispatch-${size}`" :value="Number(size)">{{ size }}</option>
          </select>
          <span>条</span>
        </label>
        <a-pagination
          v-model:current="currentPage"
          :page-size="pageSize"
          :total="filteredRows.length"
          show-less-items
        />
      </div>
    </a-card>

    <a-modal
      v-model:open="dispatchVisible"
      :title="dispatchMode === 'recover' ? '回收入仓' : '出库到工厂'"
      width="980px"
      ok-text="确定"
      cancel-text="取消"
      :confirm-loading="dispatchSaving"
      @ok="saveDispatch"
    >
      <div v-if="dispatchBatch" class="dispatch-panel">
        <div class="table-secondary">
          {{ dispatchMode === 'recover'
            ? '可减少工厂分配数量并回收到指定仓库；减少后的部分会自动回到所选仓库。'
            : '可直接填写出库数量，也可以填写出库条数；如果该批次本身有条数，系统会自动按比例折算到工厂实际数量。' }}
        </div>

        <a-row :gutter="12">
          <a-col :span="8"><a-input :value="`批次：${dispatchBatch.batch_no || '-'}`" readonly /></a-col>
          <a-col :span="8"><a-input :value="`原料：${dispatchBatch.material_code || '-'} / ${dispatchBatch.material_name || '-'}`" readonly /></a-col>
          <a-col :span="8"><a-input :value="`颜色：${dispatchBatch.color || '-'}`" readonly /></a-col>
        </a-row>

        <a-row :gutter="12" style="margin-top: 12px">
          <a-col :span="8"><a-input :value="`实际数量：${formatQtyWithUnit(dispatchBatch.actual_input_qty || dispatchBatch.purchase_input_qty || dispatchBatch.gross_qty, dispatchBatch.actual_input_unit || dispatchBatch.purchase_input_unit || dispatchBatch.unit)}`" readonly /></a-col>
          <a-col :span="8"><a-input :value="`已分配工厂：${formatQtyWithUnit(getAllocatedQty(), dispatchBatch.actual_input_unit || dispatchBatch.purchase_input_unit || dispatchBatch.unit)}`" readonly /></a-col>
          <a-col :span="8"><a-input :value="`留仓数量：${formatQtyWithUnit(getWarehouseQty(), dispatchBatch.actual_input_unit || dispatchBatch.purchase_input_unit || dispatchBatch.unit)}`" readonly /></a-col>
        </a-row>

        <a-row :gutter="12" style="margin-top: 12px">
          <a-col :span="12">
            <a-form-item :label="dispatchMode === 'recover' ? '回收入仓仓库' : '回收入仓 / 默认仓库'">
              <a-select
                v-model:value="selectedWarehouse"
                show-search
                allow-clear
                placeholder="选择仓库"
                :options="warehouseSelectOptions"
                :filter-option="filterSelectOption"
              />
            </a-form-item>
          </a-col>
          <a-col v-if="dispatchMode === 'recover'" :span="12">
            <a-form-item label="回收数量">
              <a-input-number
                v-model:value="recoverQty"
                style="width: 100%"
                :min="0"
                :max="Number(getAllocatedQty() || 0)"
                :step="0.0001"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <div v-if="dispatchMode !== 'recover'" class="dispatch-factory-panel">
          <div class="dispatch-factory-panel__title">工厂选项维护</div>
          <div class="dispatch-factory-panel__row">
            <a-select
              v-model:value="factoryDraftValue"
              show-search
              allow-clear
              style="width: 240px"
              placeholder="选择已有工厂"
              :options="factorySelectOptions"
              :filter-option="filterSelectOption"
            />
            <a-input
              v-model:value="factoryDraftText"
              style="width: 240px"
              placeholder="新增工厂名称"
              @pressEnter="saveFactoryOption"
            />
            <a-button type="primary" @click="saveFactoryOption">新增工厂</a-button>
            <a-popconfirm title="确认删除这个工厂选项吗？" @confirm="deleteFactoryOption">
              <a-button danger :disabled="!currentFactoryDeleteTarget">删除工厂</a-button>
            </a-popconfirm>
          </div>
          <div class="table-subtext">这里只删除工厂下拉选项，不会删除已经保存的业务数据。</div>
        </div>

        <div v-if="dispatchMode !== 'recover'" class="dispatch-factory-panel">
          <div class="dispatch-factory-panel__title">仓库选项维护</div>
          <div class="dispatch-factory-panel__row">
            <a-select
              v-model:value="warehouseDraftValue"
              show-search
              allow-clear
              style="width: 240px"
              placeholder="选择已有仓库"
              :options="warehouseSelectOptions"
              :filter-option="filterSelectOption"
            />
            <a-input
              v-model:value="warehouseDraftText"
              style="width: 240px"
              placeholder="新增仓库名称"
              @pressEnter="saveWarehouseOption"
            />
            <a-button type="primary" @click="saveWarehouseOption">新增仓库</a-button>
            <a-popconfirm title="确认删除这个仓库选项吗？" @confirm="deleteWarehouseOption">
              <a-button danger :disabled="!currentWarehouseDeleteTarget">删除仓库</a-button>
            </a-popconfirm>
          </div>
          <div class="table-subtext">这里只删除仓库下拉选项，不会删除已经保存的业务数据。</div>
        </div>

        <div v-if="dispatchMode === 'recover'" class="formula-box">
          当前可从工厂回收：{{ formatQtyWithUnit(getAllocatedQty(), dispatchBatch.actual_input_unit || dispatchBatch.purchase_input_unit || dispatchBatch.unit) }}
        </div>

        <div v-if="dispatchMode !== 'recover'" v-for="allocation in dispatchAllocations" :key="allocation.localKey" class="dispatch-allocation-card">
          <a-row :gutter="12">
            <a-col :span="10">
              <a-form-item label="出库到工厂">
                <a-select
                  v-model:value="allocation.factory_name"
                  show-search
                  allow-clear
                  placeholder="选择工厂"
                  :options="factorySelectOptions"
                  :filter-option="filterSelectOption"
                />
              </a-form-item>
            </a-col>
            <a-col :span="5">
              <a-form-item label="发往数量">
                <a-input-number v-model:value="allocation.qty" style="width: 100%" :min="0" :step="0.0001" />
              </a-form-item>
            </a-col>
            <a-col :span="4">
              <a-form-item label="发往条数">
                <a-input-number v-model:value="allocation.roll_count" style="width: 100%" :min="0" :step="1" />
              </a-form-item>
            </a-col>
            <a-col :span="2">
              <a-form-item label="单位">
                <a-input :value="dispatchBatch.actual_input_unit || dispatchBatch.purchase_input_unit || dispatchBatch.unit || ''" readonly />
              </a-form-item>
            </a-col>
            <a-col :span="3">
              <a-form-item label="操作">
                <a-button danger :disabled="dispatchAllocations.length === 1" @click="removeDispatchAllocation(allocation.localKey)">删除去向</a-button>
              </a-form-item>
            </a-col>
          </a-row>
          <div class="bom-row-hint">
            <div>
              折算实际数量：{{ formatQty(getAllocationActualQty(allocation)) }}
              {{ dispatchBatch.actual_input_unit || dispatchBatch.purchase_input_unit || dispatchBatch.unit || '' }}
            </div>
            <div v-if="Number(allocation.roll_count || 0) > 0">发往条数：{{ formatQty(allocation.roll_count, 0) }} 条</div>
          </div>
        </div>

        <a-button v-if="dispatchMode !== 'recover'" @click="addDispatchAllocation">新增去向</a-button>
      </div>
    </a-modal>

    <a-modal
      v-model:open="verifyVisible"
      title="核实库存"
      width="620px"
      ok-text="确认核实"
      cancel-text="取消"
      :confirm-loading="verifySaving"
      @ok="saveInventoryVerification"
    >
      <div v-if="verifyBatch" class="dispatch-panel">
        <div class="table-stack table-stack--tight" style="margin-bottom: 12px;">
          <div class="table-primary">{{ verifyBatch.batch_no || '-' }} / {{ verifyBatch.material_code || '-' }}</div>
          <div class="table-secondary">
            扣除已生产成衣后的当前剩余：{{ formatQtyWithUnit(getVerifyMaxQty(), verifyBatch.unit || verifyBatch.actual_input_unit || verifyBatch.purchase_input_unit) }}
          </div>
        </div>
        <a-form layout="vertical">
          <a-form-item label="核实后的实际剩余数量">
            <a-input-number
              v-model:value="verifyQty"
              style="width: 100%"
              :min="0"
              :max="getVerifyMaxQty()"
              :step="0.0001"
            />
          </a-form-item>
          <a-form-item label="备注">
            <a-input v-model:value="verifyRemark" placeholder="例如：盘点核实、残余报损、实物短缺" />
          </a-form-item>
        </a-form>
        <div class="formula-box">
          核实数量不能大于当前剩余；确认后会按该批次更新库存，并记录到库存流水。
        </div>
      </div>
    </a-modal>
  </section>
</template>

<script setup>
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import HoverImageThumb from '../components/HoverImageThumb.vue'
import MobileFilterPanel from '../components/MobileFilterPanel.vue'
import PageSummaryStrip from '../components/PageSummaryStrip.vue'
import { useMobileLayout } from '../composables/useMobileLayout'
import { api, formatMoney, toSelectOptions } from '../utils/api'
import { useDebouncedInput } from '../composables/useDebouncedInput'

const { isMobileLayout } = useMobileLayout()
const route = useRoute()

function getPopupContainer(node) {
  return node?.closest?.('.ant-modal-root, .ant-modal-wrap, .erp-page') || document.body
}

function formatQty(value, digits = 4) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return '0'
  return number.toFixed(digits).replace(/\.?0+$/, '') || '0'
}

function round(value, digits = 4) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return 0
  const precision = 10 ** digits
  return Math.round(number * precision) / precision
}

function formatQtyWithUnit(value, unit) {
  return `${formatQty(value)} ${unit || ''}`.trim()
}

function formatRollCount(value) {
  if (!value || Number(value) <= 0) return '-'
  return formatQty(value, 0)
}

function formatColorWithSize(row = {}) {
  const color = String(row?.color || '-').trim() || '-'
  const size = String(row?.size || '').trim()
  return size ? `${color} / ${size}` : color
}

function formatDate(value) {
  if (!value) return '-'
  return String(value).slice(0, 10)
}

function formatAdjustmentSummary(record) {
  if (!record) return '正常'
  if (String(record.price_type || '') === 'sample') return '正常'
  if (String(record.adjustment_type || '') === 'weight_gap') {
    return `空差 ${formatQty(record.left_gap, 2)}+${formatQty(record.right_gap, 2)}`
  }
  if (String(record.adjustment_type || '') === 'rate') {
    return `空 ${formatQty(record.gap_ratio, 2)}`
  }
  return String(record.adjustment_summary || '').trim() || '正常'
}

function priceTypeLabel(value) {
  if (value === 'sample') return '版布价'
  if (value === 'net') return '净布价'
  return '大货价'
}

function isDateInRange(dateText, range) {
  if (!Array.isArray(range) || range.length !== 2 || !range[0] || !range[1]) return true
  const value = String(dateText || '').slice(0, 10)
  if (!value) return false
  return value >= range[0] && value <= range[1]
}

function filterSelectOption(input, option) {
  return String(option?.label || '').toLowerCase().includes(String(input || '').toLowerCase())
}

function compareBatchNoDesc(left = {}, right = {}) {
  const leftNo = String(left.batch_no || '').trim()
  const rightNo = String(right.batch_no || '').trim()
  if (leftNo || rightNo) {
    const byBatchNo = rightNo.localeCompare(leftNo, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    if (byBatchNo) return byBatchNo
  }
  return Number(right.id || 0) - Number(left.id || 0)
}

let dispatchSeed = 1
function createDispatchAllocation(item = {}) {
  return {
    localKey: `dispatch_${Date.now()}_${dispatchSeed++}`,
    factory_name: String(item.factory_name || '').trim(),
    qty: Number(item.input_allocated_qty || item.allocated_qty || 0),
    roll_count: Number(item.allocated_roll_count || 0)
  }
}

function normalizeAllocationRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((item) => createDispatchAllocation(item))
}

const { inputValue: keywordInput, debouncedValue: keyword } = useDebouncedInput('', 260)
const factoryDispatchViewStateStorageKey = 'factory-dispatch.view.state'
const loading = ref(false)
const summary = reactive({ batches: [] })
const optionLists = ref({ factories: [], warehouses: ['主仓库'] })
const filterField = ref('keyword')
const supplierFilter = ref(undefined)
const factoryFilter = ref(undefined)
const stockScopeFilter = ref('all')
const dateRange = ref([])
const currentPage = ref(1)
const pageSize = ref(12)
const pageSizeOptions = ['12', '24', '50', '100']

function loadStoredViewState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(factoryDispatchViewStateStorageKey) || '{}')
    filterField.value = ['keyword', 'batch_no', 'purchase_order_no', 'material_code', 'material_name', 'color', 'supplier'].includes(parsed.filterField)
      ? parsed.filterField
      : 'keyword'
    keywordInput.value = typeof parsed.keywordInput === 'string' ? parsed.keywordInput : ''
    supplierFilter.value = parsed.supplierFilter || undefined
    factoryFilter.value = parsed.factoryFilter || undefined
    stockScopeFilter.value = ['all', 'warehouse', 'factory'].includes(parsed.stockScopeFilter) ? parsed.stockScopeFilter : 'all'
    dateRange.value = Array.isArray(parsed.dateRange) ? parsed.dateRange.filter(Boolean).slice(0, 2) : []
    currentPage.value = Number(parsed.currentPage || 1)
    pageSize.value = Number(parsed.pageSize || 12)
  } catch {
    filterField.value = 'keyword'
    keywordInput.value = ''
    supplierFilter.value = undefined
    factoryFilter.value = undefined
    stockScopeFilter.value = 'all'
    dateRange.value = []
    currentPage.value = 1
    pageSize.value = 12
  }
  applyRouteQueryFilters()
}

function applyRouteQueryFilters(query = route.query || {}) {
  const scope = String(query.stock_scope || query.stockScope || '')
  if (['all', 'warehouse', 'factory'].includes(scope)) stockScopeFilter.value = scope
  if (query.q) keywordInput.value = String(query.q)
}

function saveStoredViewState() {
  try {
    localStorage.setItem(
      factoryDispatchViewStateStorageKey,
      JSON.stringify({
        filterField: filterField.value,
        keywordInput: keywordInput.value,
        supplierFilter: supplierFilter.value,
        factoryFilter: factoryFilter.value,
        stockScopeFilter: stockScopeFilter.value,
        dateRange: Array.isArray(dateRange.value) ? dateRange.value : [],
        currentPage: currentPage.value,
        pageSize: pageSize.value
      })
    )
  } catch {
    // 本地存储不可用时不影响使用
  }
}

const dispatchVisible = ref(false)
const dispatchSaving = ref(false)
const dispatchBatch = ref(null)
const dispatchAllocations = ref([])
const existingDispatchAllocations = ref([])
const dispatchMode = ref('dispatch')
const selectedWarehouse = ref('主仓库')
const recoverQty = ref(0)
const factoryDraftValue = ref(undefined)
const factoryDraftText = ref('')
const warehouseDraftValue = ref(undefined)
const warehouseDraftText = ref('')
const verifyVisible = ref(false)
const verifySaving = ref(false)
const verifyBatch = ref(null)
const verifyQty = ref(0)
const verifyRemark = ref('')

const filterFieldOptions = [
  { label: '综合搜索', value: 'keyword' },
  { label: '批次号', value: 'batch_no' },
  { label: '采购单号', value: 'purchase_order_no' },
  { label: '原料编码', value: 'material_code' },
  { label: '原料名称', value: 'material_name' },
  { label: '颜色', value: 'color' },
  { label: '供应商', value: 'supplier' }
]

const stockScopeOptions = [
  { label: '全部库存', value: 'all' },
  { label: '只看仓库库存', value: 'warehouse' },
  { label: '只看工厂库存', value: 'factory' }
]

const supplierOptions = computed(() =>
  [...new Set(summary.batches.map((item) => String(item.supplier || '').trim()).filter(Boolean))]
    .map((item) => ({ label: item, value: item }))
)

const factorySelectOptions = computed(() => toSelectOptions(optionLists.value.factories || []))
const warehouseSelectOptions = computed(() => toSelectOptions(optionLists.value.warehouses || ['主仓库']))
const currentFactoryDeleteTarget = computed(() => String(factoryDraftText.value || factoryDraftValue.value || '').trim())
const currentWarehouseDeleteTarget = computed(() => String(warehouseDraftText.value || warehouseDraftValue.value || '').trim())

const filterPlaceholder = computed(() => {
  const labelMap = {
    keyword: '搜索批次号 / 采购单号 / 原料编码 / 名称 / 颜色 / 供应商',
    batch_no: '搜索批次号',
    purchase_order_no: '搜索采购单号',
    material_code: '搜索原料编码',
    material_name: '搜索原料名称',
    color: '搜索颜色',
    supplier: '搜索供应商'
  }
  return labelMap[filterField.value] || labelMap.keyword
})

const stockScopeLabelMap = {
  all: '全部库存',
  warehouse: '只看仓库库存',
  factory: '只看工厂库存'
}

const activeDispatchFilterChips = computed(() => {
  const chips = []
  if (keywordInput.value) chips.push(`关键词：${keywordInput.value}`)
  if (supplierFilter.value) chips.push(`供应商：${supplierFilter.value}`)
  if (factoryFilter.value) chips.push(`工厂：${factoryFilter.value}`)
  if (stockScopeFilter.value !== 'all') chips.push(stockScopeLabelMap[stockScopeFilter.value] || stockScopeFilter.value)
  if (dateRange.value?.filter(Boolean).length) chips.push(`日期：${dateRange.value.filter(Boolean).join(' 至 ')}`)
  return chips
})

function clearDispatchFilters() {
  filterField.value = 'keyword'
  keywordInput.value = ''
  supplierFilter.value = undefined
  factoryFilter.value = undefined
  stockScopeFilter.value = 'all'
  dateRange.value = []
  currentPage.value = 1
}

const filteredRows = computed(() => {
  const value = String(keyword.value || '').trim().toLowerCase()
  let rows = [...summary.batches]

  if (supplierFilter.value) {
    rows = rows.filter((item) => String(item.supplier || '').trim() === String(supplierFilter.value || '').trim())
  }
  if (factoryFilter.value) {
    const targetFactory = String(factoryFilter.value || '').trim()
    rows = rows.filter((item) => {
      const allocations = Array.isArray(item.allocations) ? item.allocations : []
      return allocations.some((allocation) => String(allocation.factory_name || '').trim() === targetFactory)
    })
  }
  if (stockScopeFilter.value === 'warehouse') {
    rows = rows.filter((item) => Number(item.warehouse_remaining_qty || 0) > 0.0001)
  }
  if (stockScopeFilter.value === 'factory') {
    rows = rows.filter((item) => Number(item.factory_remaining || item.factory_remaining_qty || item.factory_allocated_qty || 0) > 0.0001)
  }

  rows = rows.filter((item) => isDateInRange(item.received_at, dateRange.value))

  rows = rows.sort(compareBatchNoDesc)
  if (!value) return rows

  const fieldMap = {
    keyword: (item) => [item.batch_no, item.purchase_order_no, item.material_code, item.material_name, item.color, item.supplier],
    batch_no: (item) => [item.batch_no],
    purchase_order_no: (item) => [item.purchase_order_no],
    material_code: (item) => [item.material_code],
    material_name: (item) => [item.material_name],
    color: (item) => [item.color],
    supplier: (item) => [item.supplier]
  }

  return rows.filter((item) =>
    (fieldMap[filterField.value] || fieldMap.keyword)(item).some((field) => String(field || '').toLowerCase().includes(value))
  ).sort(compareBatchNoDesc)
})

const pagedRows = computed(() => {
  const size = Math.max(Number(pageSize.value || 12), 1)
  const page = Math.max(Number(currentPage.value || 1), 1)
  const start = (page - 1) * size
  return filteredRows.value.slice(start, start + size)
})

const summaryItems = computed(() => {
  const actualQty = filteredRows.value.reduce(
    (sum, item) => sum + Number(item.actual_input_qty || item.purchase_input_qty || item.gross_qty || 0),
    0
  )
  const allocatedQty = filteredRows.value.reduce((sum, item) => sum + Number(item.factory_allocated_qty || 0), 0)
  const warehouseQty = filteredRows.value.reduce((sum, item) => sum + Number(item.warehouse_remaining_qty || 0), 0)

  return [
    { label: '可发厂批次', value: `${filteredRows.value.length} 批`, note: '仅显示已审核并正式入仓的采购批次' },
    { label: '实际数量', value: formatQty(actualQty, 2), note: '按批次实际数量汇总' },
    { label: '已发工厂', value: formatQty(allocatedQty, 2), note: '按当前工厂分配汇总' },
    { label: '仓库剩余', value: formatQty(warehouseQty, 2), note: '未分配工厂的部分仍留在仓库' }
  ]
})

loadStoredViewState()

async function loadData() {
  loading.value = true
  try {
    const [result, options] = await Promise.all([api.db.getInventorySummary(), api.db.getOptionLists()])
    summary.batches = Array.isArray(result?.batches) ? result.batches : []
    optionLists.value = options || { factories: [], warehouses: ['主仓库'] }
  } catch (error) {
    message.error(error?.message || '加载出仓入仓数据失败')
  } finally {
    loading.value = false
  }
}

function openDispatch(record) {
  dispatchMode.value = 'dispatch'
  recoverQty.value = 0
  selectedWarehouse.value = String(record?.warehouse_name || '主仓库').trim() || '主仓库'
  dispatchBatch.value = { ...record }
  existingDispatchAllocations.value = normalizeAllocationRows(record?.allocations || [])
  dispatchAllocations.value = [createDispatchAllocation()]
  dispatchVisible.value = true
}

function openRecover(record) {
  dispatchMode.value = 'recover'
  recoverQty.value = Number(record?.factory_allocated_qty || 0)
  selectedWarehouse.value = String(record?.warehouse_name || '主仓库').trim() || '主仓库'
  dispatchBatch.value = { ...record }
  existingDispatchAllocations.value = []
  const allocations = Array.isArray(record?.allocations) ? record.allocations : []
  dispatchAllocations.value = allocations.length
    ? allocations.map((item) => createDispatchAllocation(item))
    : [createDispatchAllocation()]
  dispatchVisible.value = true
}

function addDispatchAllocation() {
  dispatchAllocations.value.push(createDispatchAllocation())
}

function removeDispatchAllocation(localKey) {
  if (dispatchAllocations.value.length <= 1) return
  dispatchAllocations.value = dispatchAllocations.value.filter((item) => item.localKey !== localKey)
}

function getAllocationActualQty(allocation) {
  if (!dispatchBatch.value) return 0
  const batchRollCount = Math.max(Number(dispatchBatch.value.roll_count || 0), 0)
  const allocationRollCount = Math.max(Number(allocation.roll_count || 0), 0)
  const actualQty = Number(
    dispatchBatch.value.actual_input_qty || dispatchBatch.value.purchase_input_qty || dispatchBatch.value.gross_qty || 0
  )
  if (batchRollCount > 0 && allocationRollCount > 0) {
    return (actualQty * allocationRollCount) / batchRollCount
  }
  return Number(allocation.qty || 0)
}

function getAllocatedQty() {
  const currentQty = dispatchAllocations.value.reduce((sum, item) => sum + Number(getAllocationActualQty(item) || 0), 0)
  if (dispatchMode.value !== 'dispatch') return currentQty
  const existingQty = existingDispatchAllocations.value.reduce((sum, item) => sum + Number(getAllocationActualQty(item) || 0), 0)
  return existingQty + currentQty
}

function getWarehouseQty() {
  const total = Number(
    dispatchBatch.value?.actual_input_qty || dispatchBatch.value?.purchase_input_qty || dispatchBatch.value?.gross_qty || 0
  )
  return Math.max(total - getAllocatedQty(), 0)
}

function getVerifyMaxQty() {
  return Number(verifyBatch.value?.remaining_qty || 0)
}

function openVerifyStock(record) {
  verifyBatch.value = { ...record }
  verifyQty.value = Number(record?.remaining_qty || 0)
  verifyRemark.value = ''
  verifyVisible.value = true
}

async function saveFactoryOption() {
  const value = String(factoryDraftText.value || factoryDraftValue.value || '').trim()
  if (!value) {
    message.error('请先输入工厂名称')
    return
  }
  try {
    optionLists.value = await api.db.saveOptionValue('factory', value)
    factoryDraftValue.value = value
    factoryDraftText.value = ''
    message.success(`${value} 已加入工厂选项`)
  } catch (error) {
    message.error(error?.message || '新增工厂失败')
  }
}

async function deleteFactoryOption() {
  const value = currentFactoryDeleteTarget.value
  if (!value) {
    message.error('请先选择要删除的工厂')
    return
  }
  try {
    optionLists.value = await api.db.deleteOptionValue('factory', value)
    if (factoryDraftValue.value === value) factoryDraftValue.value = undefined
    if (factoryDraftText.value === value) factoryDraftText.value = ''
    dispatchAllocations.value = dispatchAllocations.value.map((item) =>
      item.factory_name === value ? { ...item, factory_name: '' } : item
    )
    message.success(`${value} 已从工厂选项中删除`)
  } catch (error) {
    message.error(error?.message || '删除工厂失败')
  }
}

async function saveWarehouseOption() {
  const value = String(warehouseDraftText.value || warehouseDraftValue.value || '').trim()
  if (!value) {
    message.error('请先输入仓库名称')
    return
  }
  try {
    optionLists.value = await api.db.saveOptionValue('warehouse', value)
    warehouseDraftValue.value = value
    warehouseDraftText.value = ''
    selectedWarehouse.value = value
    message.success(`${value} 已加入仓库选项`)
  } catch (error) {
    message.error(error?.message || '新增仓库失败')
  }
}

async function deleteWarehouseOption() {
  const value = currentWarehouseDeleteTarget.value
  if (!value) {
    message.error('请先选择要删除的仓库')
    return
  }
  try {
    optionLists.value = await api.db.deleteOptionValue('warehouse', value)
    if (warehouseDraftValue.value === value) warehouseDraftValue.value = undefined
    if (warehouseDraftText.value === value) warehouseDraftText.value = ''
    if (selectedWarehouse.value === value) selectedWarehouse.value = '主仓库'
    message.success(`${value} 已从仓库选项中删除`)
  } catch (error) {
    message.error(error?.message || '删除仓库失败')
  }
}

async function saveDispatch() {
  if (!dispatchBatch.value?.id) return
  dispatchSaving.value = true
  try {
    let allocationsPayload = []
    if (dispatchMode.value === 'recover') {
      const recoverAmount = Number(recoverQty.value || 0)
      const allocatedTotal = Number(getAllocatedQty() || 0)
      if (recoverAmount <= 0) {
        throw new Error('请先填写回收数量')
      }
      if (recoverAmount - allocatedTotal > 0.0001) {
        throw new Error(`回收数量不能大于当前已分配到工厂的数量，当前最多可回收 ${formatQtyWithUnit(allocatedTotal, dispatchBatch.value.actual_input_unit || dispatchBatch.value.purchase_input_unit || dispatchBatch.value.unit)}`)
      }
      let remainingRecoverQty = recoverAmount
      const normalizedAllocations = [...dispatchAllocations.value].map((item) => ({
        ...item,
        qty: Number(item.qty || 0),
        roll_count: Number(item.roll_count || 0)
      }))
      const nextAllocations = []
      for (let index = normalizedAllocations.length - 1; index >= 0; index -= 1) {
        const item = normalizedAllocations[index]
        const currentActualQty = Number(getAllocationActualQty(item) || 0)
        if (remainingRecoverQty <= 0 || currentActualQty <= 0) {
          nextAllocations.unshift(item)
          continue
        }
        const deductedActualQty = Math.min(currentActualQty, remainingRecoverQty)
        remainingRecoverQty = Math.max(remainingRecoverQty - deductedActualQty, 0)
        const ratio = currentActualQty > 0 ? Math.max((currentActualQty - deductedActualQty) / currentActualQty, 0) : 0
        const nextQty = round(item.qty * ratio, 4)
        const nextRollCount = round(item.roll_count * ratio, 4)
        if (nextQty > 0.0001 || nextRollCount > 0.0001) {
          nextAllocations.unshift({
            ...item,
            qty: nextQty,
            roll_count: nextRollCount
          })
        }
      }
      if (remainingRecoverQty > 0.0001) {
        throw new Error(`回收数量超过当前工厂已分配数量，请刷新后重试。当前仅剩 ${formatQtyWithUnit(allocatedTotal, dispatchBatch.value.actual_input_unit || dispatchBatch.value.purchase_input_unit || dispatchBatch.value.unit)} 可回收`)
      }
      allocationsPayload = nextAllocations
    } else {
      allocationsPayload = dispatchAllocations.value.map((item) => ({
        ...item,
        qty: Number(item.qty || 0),
        roll_count: Number(item.roll_count || 0)
      }))
    }

    await api.db.updatePurchaseBatchFactoryAllocations({
      id: dispatchBatch.value.id,
      allocations: allocationsPayload.map((item) => ({
        factory_name: item.factory_name || '',
        factory_allocated_qty: Number(item.qty || 0),
        factory_allocated_roll_count: Number(item.roll_count || 0),
        factory_allocated_unit: dispatchBatch.value.actual_input_unit || dispatchBatch.value.purchase_input_unit || dispatchBatch.value.unit || ''
      })),
      mode: dispatchMode.value === 'dispatch' ? 'append' : 'replace',
      warehouse_name: selectedWarehouse.value || '主仓库'
    })
    message.success(dispatchMode.value === 'recover' ? '回收入仓信息已更新' : '出库到工厂信息已更新')
    dispatchVisible.value = false
    dispatchBatch.value = null
    dispatchAllocations.value = []
    existingDispatchAllocations.value = []
    recoverQty.value = 0
    await loadData()
  } catch (error) {
    message.error(error?.message || '更新出仓入仓信息失败')
  } finally {
    dispatchSaving.value = false
  }
}

async function saveInventoryVerification() {
  if (!verifyBatch.value?.id) return
  const nextQty = Number(verifyQty.value || 0)
  const maxQty = getVerifyMaxQty()
  if (nextQty < 0) {
    message.error('核实库存数量不能小于 0')
    return
  }
  if (nextQty - maxQty > 0.0001) {
    message.error(`核实库存不能大于当前剩余，最多 ${formatQtyWithUnit(maxQty, verifyBatch.value.unit || verifyBatch.value.actual_input_unit || verifyBatch.value.purchase_input_unit)}`)
    return
  }
  verifySaving.value = true
  try {
    await api.db.verifyInventoryStock({
      batch_id: Number(verifyBatch.value.id),
      verified_qty: nextQty,
      remark: verifyRemark.value || ''
    })
    message.success('库存核实已保存')
    verifyVisible.value = false
    verifyBatch.value = null
    await loadData()
  } catch (error) {
    message.error(error?.message || '核实库存失败')
  } finally {
    verifySaving.value = false
  }
}

onMounted(loadData)
onActivated(() => {
  if (!loading.value) loadData()
})

watch([filterField, keywordInput, supplierFilter, factoryFilter, stockScopeFilter, dateRange], () => {
  currentPage.value = 1
})

watch(
  () => route.query,
  (query) => {
    applyRouteQueryFilters(query)
    currentPage.value = 1
  },
  { deep: true }
)

watch([filteredRows, pageSize], () => {
  const totalPages = Math.max(1, Math.ceil(filteredRows.value.length / Math.max(Number(pageSize.value || 12), 1)))
  if (currentPage.value > totalPages) currentPage.value = totalPages
})

watch([filterField, keywordInput, supplierFilter, factoryFilter, stockScopeFilter, dateRange, currentPage, pageSize], () => {
  saveStoredViewState()
})
</script>

<style scoped>
.dispatch-page {
  padding-left: 24px;
}

.dispatch-page :deep(.ant-card),
.dispatch-page :deep(.ant-card-body),
.dispatch-page :deep(.table-pagination),
.dispatch-page :deep(.ant-pagination),
.dispatch-page :deep(.erp-table-wrap),
.dispatch-page :deep(.ant-modal-content),
.dispatch-page :deep(.ant-modal-body) {
  overflow: visible;
}

.dispatch-page .table-actions-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dispatch-page .table-pagination {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding-top: 16px;
}

.dispatch-page .table-pagination__size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #6f84a3;
  font-size: 12px;
}

.dispatch-page .table-pagination__native-select {
  min-width: 74px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #d6e0ef;
  border-radius: 12px;
  background: #fff;
  color: #173255;
  font-size: 12px;
}

@media (max-width: 900px) {
  .dispatch-page {
    padding-left: 0;
  }
}
</style>

