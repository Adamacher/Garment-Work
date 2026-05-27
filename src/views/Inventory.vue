<template>
  <section class="erp-page inventory-ledger-page">
    <div class="page-hero">
      <div>
        <h1 class="page-title">{{ TEXT.title }}</h1>
        <p class="page-subtitle">{{ TEXT.subtitle }}</p>
      </div>
      <div class="page-hero-actions">
        <a-button class="toolbar-refresh-btn" :loading="loading" @click="loadInventory">
          {{ TEXT.refresh }}
        </a-button>
        <a-button class="toolbar-secondary-btn" :loading="exportLoading" @click="handleExport">
          {{ TEXT.export }}
        </a-button>
      </div>
    </div>

    <PageSummaryStrip :items="summary.summaryCards" />

    <MobileFilterPanel>
      <template #filters>
        <a-select
          v-model:value="filters.searchField"
          class="filter-select-input"
          :options="searchFieldOptions"
          :placeholder="TEXT.searchFieldLabel"
          :get-popup-container="getPopupContainer"
        />
        <a-input
          v-model:value="searchValue"
          allow-clear
          class="filter-search-input"
          :placeholder="searchPlaceholderText"
        />
        <a-select
          v-model:value="filters.supplier"
          allow-clear
          class="filter-select-input filter-select-input--wide"
          :placeholder="TEXT.filterBySupplier"
          :options="supplierSelectOptions"
          show-search
          :filter-option="filterSelectOption"
          :get-popup-container="getPopupContainer"
        />
        <a-select
          v-model:value="filters.factory"
          allow-clear
          class="filter-select-input filter-select-input--wide"
          :placeholder="TEXT.filterByFactory"
          :options="factorySelectOptions"
          show-search
          :filter-option="filterSelectOption"
          :get-popup-container="getPopupContainer"
        />
        <a-select
          v-model:value="filters.category"
          allow-clear
          class="filter-select-input filter-select-input--wide"
          :placeholder="TEXT.filterByCategory"
          :options="categorySelectOptions"
          show-search
          :filter-option="filterSelectOption"
          :get-popup-container="getPopupContainer"
        />
        <a-select
          v-model:value="filters.stockScope"
          class="filter-select-input filter-select-input--wide"
          :options="stockScopeOptions"
          :get-popup-container="getPopupContainer"
        />
      </template>
    </MobileFilterPanel>

    <div class="erp-table-caption">
      {{ TEXT.searchHelp }}
    </div>

    <a-card class="content-card" :bordered="false">
      <template #title>{{ TEXT.summarySection }}</template>
      <template #extra>
        <ColumnConfigButton
          v-model="materialVisibleKeys"
          :columns="materialColumnDefs"
          button-text="列配置"
        />
      </template>

      <div v-if="isMobileLayout" class="erp-mobile-list">
        <div v-for="row in pagedMaterials" :key="materialRowKey(row)" class="erp-mobile-card">
          <div class="erp-mobile-card__head">
            <div>
              <div class="erp-mobile-card__title">{{ row.material_code || '-' }}</div>
              <div class="erp-mobile-card__meta">{{ row.material_name || '-' }}</div>
            </div>
            <HoverImageThumb
              :src="row.material_image_path || row.image_path"
              :alt="row.material_name || row.material_code"
              empty-text=""
            />
          </div>
          <div class="erp-mobile-card__grid">
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.color }}</div>
              <div class="erp-mobile-card__value">{{ formatColorWithSize(row) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.category }}</div>
              <div class="erp-mobile-card__value">{{ row.category || '-' }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.supplier }}</div>
              <div class="erp-mobile-card__value">{{ row.supplier_name || '-' }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.factory }}</div>
              <div class="erp-mobile-card__value">{{ row.factory_name || '-' }}</div>
            </div>
          </div>
          <div class="erp-mobile-card__grid">
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.accumulatedPurchase }}</div>
              <div class="erp-mobile-card__value">{{ formatPurchaseSummary(row) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.currentStock }}</div>
              <div class="erp-mobile-card__value">{{ formatQtyWithUnit(row.current_stock_qty, row.base_unit) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.factoryUsed }}</div>
              <div class="erp-mobile-card__value">{{ formatQtyWithUnit(row.factory_used_qty, row.base_unit) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.warehouseRemain }}</div>
              <div class="erp-mobile-card__value">{{ formatQtyWithUnit(row.warehouse_remaining_qty, row.base_unit) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.preAllocated }}</div>
              <div class="erp-mobile-card__value">{{ formatQtyWithUnit(row.pre_allocated_qty, row.base_unit) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.factoryAvailableAfterPrealloc }}</div>
              <div class="erp-mobile-card__value" :class="qtyToneClass(row.factory_available_after_prealloc_qty)">{{ formatQtyWithUnit(row.factory_available_after_prealloc_qty, row.base_unit) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.availableAfterPrealloc }}</div>
              <div class="erp-mobile-card__value" :class="qtyToneClass(row.available_after_prealloc_qty)">{{ formatQtyWithUnit(row.available_after_prealloc_qty, row.base_unit) }}</div>
            </div>
          </div>
          <div class="erp-mobile-card__sub">
            {{ TEXT.rollCount }}：{{ formatRollCount(row.roll_count) }} / {{ buildAdjustmentSummary(row) }}
          </div>
          <div class="erp-mobile-card__sub">
            {{ TEXT.avgCost }}：{{ `${formatMoney(row.avg_cost_price, 4)}/${row.base_unit || ''}` }}
          </div>
          <div class="erp-mobile-card__sub">
            {{ TEXT.latestArrival }}：{{ formatDate(row.latest_received_at) }}
          </div>
        </div>
      </div>
      <div v-else class="erp-table-wrap">
        <table class="erp-data-table">
          <thead>
            <tr>
              <th v-for="column in materialColumns" :key="column.key">{{ column.title }}</th>
            </tr>
          </thead>
          <tbody v-if="pagedMaterials.length">
            <tr v-for="row in pagedMaterials" :key="materialRowKey(row)">
              <td v-for="column in materialColumns" :key="column.key">
                <template v-if="column.key === 'image'">
                  <HoverImageThumb
                    :src="row.material_image_path || row.image_path"
                    :alt="row.material_name || row.material_code"
                    empty-text=""
                  />
                </template>
                <template v-else-if="column.key === 'accumulated_purchase'">
                  <div class="table-stack table-stack--tight">
                    <div class="table-primary">历史采购：{{ formatHistoricalPurchaseText(row) }}</div>
                    <div class="table-secondary">历史实际：{{ formatHistoricalActualText(row) }}</div>
                  </div>
                </template>
                <template v-else-if="column.key === 'roll_count'">
                  <div class="table-stack table-stack--tight">
                    <div class="table-primary">{{ formatRollCount(row.roll_count) }}</div>
                    <div class="table-secondary">{{ buildAdjustmentSummary(row) }}</div>
                  </div>
                </template>
                <template v-else-if="column.key === 'avg_cost'">
                  {{ `${formatMoney(row.avg_cost_price, 4)}/${row.base_unit || ''}` }}
                </template>
                <template v-else-if="column.key === 'stock_value'">
                  {{ formatMoney(row.stock_value || 0, 2) }}
                </template>
                <template
                  v-else-if="['sent_to_factory', 'factory_used', 'factory_remaining', 'warehouse_remaining', 'current_stock', 'pre_allocated', 'factory_available_after_prealloc', 'available_after_prealloc'].includes(column.key)"
                >
                  <span :class="qtyToneClass(resolveMaterialQty(column.key, row))">
                    {{ formatQtyWithUnit(resolveMaterialQty(column.key, row), row.base_unit) }}
                  </span>
                </template>
                <template v-else-if="column.key === 'color'">
                  {{ formatColorWithSize(row) }}
                </template>
                <template v-else-if="column.key === 'latest_received_at'">
                  {{ formatDate(row.latest_received_at) }}
                </template>
                <template v-else>
                  {{ row[column.key] || '-' }}
                </template>
              </td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr>
              <td :colspan="materialColumns.length" class="erp-empty-cell">{{ TEXT.noData }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="table-pagination">
        <label class="table-pagination__size">
          <span>每页</span>
          <select v-model.number="materialPageSize" class="table-pagination__native-select">
            <option v-for="size in pageSizeOptions" :key="`material-${size}`" :value="Number(size)">{{ size }}</option>
          </select>
          <span>条</span>
        </label>
        <a-pagination
          v-model:current="materialCurrentPage"
          :page-size="materialPageSize"
          :total="filteredMaterials.length"
          show-less-items
        />
      </div>
    </a-card>

    <a-card class="content-card" :bordered="false">
      <template #title>{{ TEXT.transitSection }}</template>
      <template #extra>
        <ColumnConfigButton
          v-model="transitVisibleKeys"
          :columns="transitColumnDefs"
          button-text="列配置"
        />
      </template>

      <div v-if="isMobileLayout" class="erp-mobile-list">
        <div v-for="row in pagedInTransit" :key="transitRowKey(row)" class="erp-mobile-card">
          <div class="erp-mobile-card__head">
            <div>
              <div class="erp-mobile-card__title">{{ row.purchase_order_no || '-' }}</div>
              <div class="erp-mobile-card__meta">{{ row.material_code || '-' }} / {{ row.material_name || '-' }}</div>
            </div>
            <HoverImageThumb
              :src="row.material_image_path || row.image_path"
              :alt="row.material_name || row.material_code"
              empty-text=""
            />
          </div>
          <div class="erp-mobile-card__grid">
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.color }}</div>
              <div class="erp-mobile-card__value">{{ formatColorWithSize(row) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.supplier }}</div>
              <div class="erp-mobile-card__value">{{ row.supplier_name || '-' }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.purchaseDisplayQty }}</div>
              <div class="erp-mobile-card__value">{{ formatDisplayQtyText(row.purchase_display_text || row.purchase_display_qty, row.purchase_display_unit) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.actualDisplayQty }}</div>
              <div class="erp-mobile-card__value">{{ formatDisplayQtyText(row.actual_display_text || row.actual_display_qty, row.actual_display_unit) }}</div>
            </div>
          </div>
          <div class="erp-mobile-card__sub">{{ TEXT.priceInfo }}：{{ buildPriceSummary(row).replace(/\n/g, ' / ') }}</div>
          <div class="erp-mobile-card__sub">{{ TEXT.adjustment }}：{{ buildAdjustmentSummary(row) }}</div>
          <div class="erp-mobile-card__sub">{{ TEXT.arrivalDate }}：{{ formatDate(row.arrival_date) }}</div>
        </div>
      </div>
      <div v-else class="erp-table-wrap">
        <table class="erp-data-table">
          <thead>
            <tr>
              <th v-for="column in transitColumns" :key="column.key">{{ column.title }}</th>
            </tr>
          </thead>
          <tbody v-if="pagedInTransit.length">
            <tr v-for="row in pagedInTransit" :key="transitRowKey(row)">
              <td v-for="column in transitColumns" :key="column.key">
                <template v-if="column.key === 'image'">
                  <HoverImageThumb
                    :src="row.material_image_path || row.image_path"
                    :alt="row.material_name || row.material_code"
                    empty-text=""
                  />
                </template>
                <template v-else-if="column.key === 'price'">
                  <div class="table-stack table-stack--tight">
                    <div v-for="line in buildPriceSummary(row).split('\n')" :key="line" class="table-secondary">
                      {{ line }}
                    </div>
                  </div>
                </template>
                <template v-else-if="column.key === 'adjustment'">
                  {{ buildAdjustmentSummary(row) }}
                </template>
                <template v-else-if="column.key === 'purchase_display_qty'">
                  {{ formatDisplayQtyText(row.purchase_display_text || row.purchase_display_qty, row.purchase_display_unit) }}
                </template>
                <template v-else-if="column.key === 'actual_display_qty'">
                  {{ formatDisplayQtyText(row.actual_display_text || row.actual_display_qty, row.actual_display_unit) }}
                </template>
                <template v-else-if="column.key === 'arrival_date'">
                  {{ formatDate(row.arrival_date) }}
                </template>
                <template v-else>
                  {{ row[column.key] || '-' }}
                </template>
              </td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr>
              <td :colspan="transitColumns.length" class="erp-empty-cell">{{ TEXT.noData }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="table-pagination">
        <label class="table-pagination__size">
          <span>每页</span>
          <select v-model.number="transitPageSize" class="table-pagination__native-select">
            <option v-for="size in pageSizeOptions" :key="`transit-${size}`" :value="Number(size)">{{ size }}</option>
          </select>
          <span>条</span>
        </label>
        <a-pagination
          v-model:current="transitCurrentPage"
          :page-size="transitPageSize"
          :total="filteredInTransit.length"
          show-less-items
        />
      </div>
    </a-card>

    <a-card class="content-card" :bordered="false">
      <template #title>{{ TEXT.batchSection }}</template>
      <template #extra>
        <ColumnConfigButton
          v-model="batchVisibleKeys"
          :columns="batchColumnDefs"
          button-text="列配置"
        />
      </template>

      <div v-if="isMobileLayout" class="erp-mobile-list">
        <div v-for="row in pagedBatches" :key="batchRowKey(row)" class="erp-mobile-card">
          <div class="erp-mobile-card__head">
            <div>
              <div class="erp-mobile-card__title">{{ row.batch_no || '-' }}</div>
              <div class="erp-mobile-card__meta">{{ row.purchase_order_no || '-' }}</div>
            </div>
            <HoverImageThumb
              :src="row.material_image_path || row.image_path"
              :alt="row.material_name || row.material_code"
              empty-text=""
            />
          </div>
          <div class="erp-mobile-card__section">
            <div class="erp-mobile-card__value">{{ row.material_code || '-' }} / {{ row.material_name || '-' }}</div>
            <div class="erp-mobile-card__sub">颜色：{{ formatColorWithSize(row) }} / 供应商：{{ row.supplier_name || '-' }}</div>
          </div>
          <div class="erp-mobile-card__grid">
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">折合入库</div>
              <div class="erp-mobile-card__value">{{ formatQtyWithUnit(row.converted_qty, row.base_unit) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">批次剩余</div>
              <div class="erp-mobile-card__value">{{ formatQtyWithUnit(row.remaining_qty, row.base_unit) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.factoryRemain }}</div>
              <div class="erp-mobile-card__value">{{ formatQtyWithUnit(row.factory_remaining, row.base_unit) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">{{ TEXT.warehouseRemain }}</div>
              <div class="erp-mobile-card__value">{{ formatQtyWithUnit(row.warehouse_remaining, row.base_unit) }}</div>
            </div>
          </div>
          <div class="erp-mobile-card__sub">{{ TEXT.factory }}：{{ row.factory_name || '-' }}</div>
          <div class="erp-mobile-card__sub">{{ TEXT.priceInfo }}：{{ buildPriceSummary(row).replace(/\n/g, ' / ') }}</div>
          <div class="erp-mobile-card__sub">{{ TEXT.remark }}：{{ row.remark || '-' }}</div>
          <div class="erp-mobile-card__sub">{{ TEXT.arrivalDate }}：{{ formatDate(row.received_at) }}</div>
        </div>
      </div>
      <div v-else class="erp-table-wrap">
        <table class="erp-data-table">
          <thead>
            <tr>
              <th v-for="column in batchColumns" :key="column.key">{{ column.title }}</th>
            </tr>
          </thead>
          <tbody v-if="pagedBatches.length">
            <tr v-for="row in pagedBatches" :key="batchRowKey(row)">
              <td v-for="column in batchColumns" :key="column.key">
                <template v-if="column.key === 'image'">
                  <HoverImageThumb
                    :src="row.material_image_path || row.image_path"
                    :alt="row.material_name || row.material_code"
                    empty-text=""
                  />
                </template>
                <template v-else-if="column.key === 'roll_count'">
                  <div class="table-stack table-stack--tight">
                    <div class="table-primary">{{ formatRollCount(row.roll_count) }}</div>
                    <div class="table-secondary">{{ buildAdjustmentSummary(row) }}</div>
                  </div>
                </template>
                <template v-else-if="column.key === 'price'">
                  <div class="table-stack table-stack--tight">
                    <div v-for="line in buildPriceSummary(row).split('\n')" :key="line" class="table-secondary">
                      {{ line }}
                    </div>
                  </div>
                </template>
                <template v-else-if="column.key === 'converted_qty'">
                  {{ formatQtyWithUnit(row.converted_qty, row.base_unit) }}
                </template>
                <template v-else-if="column.key === 'color'">
                  {{ formatColorWithSize(row) }}
                </template>
                <template v-else-if="column.key === 'remaining_qty'">
                  {{ formatQtyWithUnit(row.remaining_qty, row.base_unit) }}
                </template>
                <template v-else-if="column.key === 'factory_remaining'">
                  {{ formatQtyWithUnit(row.factory_remaining, row.base_unit) }}
                </template>
                <template v-else-if="column.key === 'warehouse_remaining'">
                  {{ formatQtyWithUnit(row.warehouse_remaining, row.base_unit) }}
                </template>
                <template v-else-if="column.key === 'received_at'">
                  {{ formatDate(row.received_at) }}
                </template>
                <template v-else>
                  {{ row[column.key] || '-' }}
                </template>
              </td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr>
              <td :colspan="batchColumns.length" class="erp-empty-cell">{{ TEXT.noData }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="table-pagination">
        <label class="table-pagination__size">
          <span>每页</span>
          <select v-model.number="batchPageSize" class="table-pagination__native-select">
            <option v-for="size in pageSizeOptions" :key="`batch-${size}`" :value="Number(size)">{{ size }}</option>
          </select>
          <span>条</span>
        </label>
        <a-pagination
          v-model:current="batchCurrentPage"
          :page-size="batchPageSize"
          :total="filteredBatches.length"
          show-less-items
        />
      </div>
    </a-card>
  </section>
</template>

<script setup>
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import HoverImageThumb from '../components/HoverImageThumb.vue'
import PageSummaryStrip from '../components/PageSummaryStrip.vue'
import ColumnConfigButton from '../components/ColumnConfigButton.vue'
import MobileFilterPanel from '../components/MobileFilterPanel.vue'
import { api, formatMoney } from '../utils/api'
import { useMobileLayout } from '../composables/useMobileLayout'
import { useDebouncedInput } from '../composables/useDebouncedInput'

const { isMobileLayout } = useMobileLayout()

const TEXT = {
  title: '库存台账',
  subtitle: '台账用于跟踪仓库与工厂结存，原料出库与回收入仓请在「出仓入仓」页面集中操作。',
  refresh: '刷新',
  export: '导出Excel',
  searchFieldLabel: '搜索内容',
  summarySection: '库存汇总台账',
  transitSection: '采购在途',
  batchSection: '批次库存台账',
  searchPlaceholder: '搜索原料编码 / 名称 / 颜色 / 供应商 / 备注',
  searchHelp: '先选择搜索字段，再输入关键词；供应商、工厂、分类会在当前结果上继续筛选。',
  searchAll: '综合搜索',
  searchMaterialCode: '原料编码',
  searchMaterialName: '原料名称',
  searchColor: '颜色',
  searchSupplier: '供应商',
  searchRemark: '备注',
  filterBySupplier: '按供应商筛选',
  filterByFactory: '按工厂筛选',
  filterByCategory: '按分类筛选',
  filterByStockScope: '库存位置',
  image: '图片',
  materialCode: '原料编码',
  materialName: '原料名称',
  color: '颜色',
  category: '分类',
  supplier: '供应商',
  factory: '所在工厂',
  rollCount: '条数',
  accumulatedPurchase: '历史累计采购',
  sentToFactory: '已发工厂',
  factoryUsed: '工厂已使用',
  factoryRemain: '工厂剩余',
  warehouseRemain: '仓库剩余',
  currentStock: '当前总库存',
  preAllocated: '预领用',
  factoryAvailableAfterPrealloc: '工厂预领后',
  availableAfterPrealloc: '预领后可用',
  avgCost: '库存均价',
  stockValue: '库存货值',
  latestArrival: '最近到货',
  purchaseOrderNo: '采购单号',
  batchNo: '批次号',
  purchaseDisplayQty: '采购数量',
  actualDisplayQty: '实际数量',
  priceInfo: '价格',
  remark: '备注',
  arrivalDate: '到货日期',
  adjustment: '空差',
  normal: '正常',
  noData: '暂无数据',
  exported: '已导出Excel'
}

const loading = ref(false)
const exportLoading = ref(false)
const { inputValue: searchValue, debouncedValue: debouncedSearch } = useDebouncedInput('', 280)
const inventoryViewStateStorageKey = 'inventory.view.state'
const pageSizeOptions = ['12', '24', '50', '100']

const filters = reactive({
  searchField: 'keyword',
  supplier: undefined,
  factory: undefined,
  category: undefined,
  stockScope: 'all'
})

const materialCurrentPage = ref(1)
const materialPageSize = ref(12)
const transitCurrentPage = ref(1)
const transitPageSize = ref(12)
const batchCurrentPage = ref(1)
const batchPageSize = ref(12)

const summary = reactive({
  summaryCards: [],
  materials: [],
  inTransit: [],
  batches: []
})

const materialColumnDefs = [
  { key: 'image', title: TEXT.image },
  { key: 'material_code', title: TEXT.materialCode },
  { key: 'material_name', title: TEXT.materialName },
  { key: 'color', title: TEXT.color },
  { key: 'category', title: TEXT.category },
  { key: 'supplier_name', title: TEXT.supplier },
  { key: 'factory_name', title: TEXT.factory },
  { key: 'roll_count', title: TEXT.rollCount },
  { key: 'accumulated_purchase', title: TEXT.accumulatedPurchase },
  { key: 'sent_to_factory', title: TEXT.sentToFactory },
  { key: 'factory_used', title: TEXT.factoryUsed },
  { key: 'factory_remaining', title: TEXT.factoryRemain },
  { key: 'warehouse_remaining', title: TEXT.warehouseRemain },
  { key: 'current_stock', title: TEXT.currentStock },
  { key: 'pre_allocated', title: TEXT.preAllocated },
  { key: 'factory_available_after_prealloc', title: TEXT.factoryAvailableAfterPrealloc },
  { key: 'available_after_prealloc', title: TEXT.availableAfterPrealloc },
  { key: 'avg_cost', title: TEXT.avgCost },
  { key: 'stock_value', title: TEXT.stockValue },
  { key: 'latest_received_at', title: TEXT.latestArrival }
]

const transitColumnDefs = [
  { key: 'image', title: TEXT.image },
  { key: 'purchase_order_no', title: TEXT.purchaseOrderNo },
  { key: 'material_code', title: TEXT.materialCode },
  { key: 'material_name', title: TEXT.materialName },
  { key: 'color', title: TEXT.color },
  { key: 'supplier_name', title: TEXT.supplier },
  { key: 'purchase_display_qty', title: TEXT.purchaseDisplayQty },
  { key: 'actual_display_qty', title: TEXT.actualDisplayQty },
  { key: 'price', title: TEXT.priceInfo },
  { key: 'adjustment', title: TEXT.adjustment },
  { key: 'arrival_date', title: TEXT.arrivalDate }
]

const batchColumnDefs = [
  { key: 'image', title: TEXT.image },
  { key: 'batch_no', title: TEXT.batchNo },
  { key: 'purchase_order_no', title: TEXT.purchaseOrderNo },
  { key: 'material_code', title: TEXT.materialCode },
  { key: 'material_name', title: TEXT.materialName },
  { key: 'color', title: TEXT.color },
  { key: 'supplier_name', title: TEXT.supplier },
  { key: 'roll_count', title: TEXT.rollCount },
  { key: 'factory_name', title: TEXT.factory },
  { key: 'converted_qty', title: '折合入库' },
  { key: 'remaining_qty', title: '批次剩余' },
  { key: 'factory_remaining', title: TEXT.factoryRemain },
  { key: 'warehouse_remaining', title: TEXT.warehouseRemain },
  { key: 'price', title: TEXT.priceInfo },
  { key: 'remark', title: TEXT.remark },
  { key: 'received_at', title: TEXT.arrivalDate }
]

function getPopupContainer(node) {
  return node?.closest?.('.erp-page') || document.body
}

function loadStoredColumnKeys(storageKey, columns) {
  const allKeys = columns.map((column) => column.key)
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]')
    const selected = Array.isArray(parsed) ? parsed.filter((key) => allKeys.includes(key)) : []
    return selected.length ? selected : allKeys
  } catch {
    return allKeys
  }
}

function persistColumnKeys(storageKey, keysRef) {
  watch(
    keysRef,
    (keys) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(keys))
      } catch {
        // ignore localStorage failure
      }
    },
    { deep: true }
  )
}

const materialVisibleKeys = ref(loadStoredColumnKeys('inventory.material.columns', materialColumnDefs))
const transitVisibleKeys = ref(loadStoredColumnKeys('inventory.transit.columns', transitColumnDefs))
const batchVisibleKeys = ref(loadStoredColumnKeys('inventory.batch.columns', batchColumnDefs))

persistColumnKeys('inventory.material.columns', materialVisibleKeys)
persistColumnKeys('inventory.transit.columns', transitVisibleKeys)
persistColumnKeys('inventory.batch.columns', batchVisibleKeys)

function loadStoredViewState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(inventoryViewStateStorageKey) || '{}')
    searchValue.value = typeof parsed.searchValue === 'string' ? parsed.searchValue : ''
    filters.searchField = ['keyword', 'material_code', 'material_name', 'color', 'supplier', 'remark'].includes(parsed.searchField)
      ? parsed.searchField
      : 'keyword'
    filters.supplier = typeof parsed.supplier === 'string' && parsed.supplier.trim() ? parsed.supplier : undefined
    filters.factory = typeof parsed.factory === 'string' && parsed.factory.trim() ? parsed.factory : undefined
    filters.category = typeof parsed.category === 'string' && parsed.category.trim() ? parsed.category : undefined
    filters.stockScope = ['all', 'warehouse', 'factory'].includes(parsed.stockScope) ? parsed.stockScope : 'all'
    materialCurrentPage.value = Number(parsed.materialCurrentPage || 1)
    materialPageSize.value = Number(parsed.materialPageSize || 12)
    transitCurrentPage.value = Number(parsed.transitCurrentPage || 1)
    transitPageSize.value = Number(parsed.transitPageSize || 12)
    batchCurrentPage.value = Number(parsed.batchCurrentPage || 1)
    batchPageSize.value = Number(parsed.batchPageSize || 12)
  } catch {
    searchValue.value = ''
  }
}

function saveStoredViewState() {
  try {
    localStorage.setItem(
      inventoryViewStateStorageKey,
      JSON.stringify({
        searchValue: searchValue.value,
        searchField: filters.searchField,
        supplier: filters.supplier,
        factory: filters.factory,
        category: filters.category,
        stockScope: filters.stockScope,
        materialCurrentPage: materialCurrentPage.value,
        materialPageSize: materialPageSize.value,
        transitCurrentPage: transitCurrentPage.value,
        transitPageSize: transitPageSize.value,
        batchCurrentPage: batchCurrentPage.value,
        batchPageSize: batchPageSize.value
      })
    )
  } catch {
    // ignore localStorage failure
  }
}

loadStoredViewState()

const materialColumns = computed(() => materialColumnDefs.filter((column) => materialVisibleKeys.value.includes(column.key)))
const transitColumns = computed(() => transitColumnDefs.filter((column) => transitVisibleKeys.value.includes(column.key)))
const batchColumns = computed(() => batchColumnDefs.filter((column) => batchVisibleKeys.value.includes(column.key)))

function normalizeFilterText(value) {
  return String(value || '').trim()
}

function resolveSupplierText(item = {}) {
  return normalizeFilterText(item.supplier_name || item.supplier || '')
}

function resolveFactoryText(item = {}) {
  return normalizeFilterText(item.factory_name || '')
}

function resolveCategoryText(item = {}) {
  return normalizeFilterText(item.category || item.material_category || '')
}

const supplierOptions = computed(() =>
  Array.from(
    new Set(
      [...summary.materials, ...summary.inTransit, ...summary.batches]
        .map((item) => resolveSupplierText(item))
        .filter(Boolean)
    )
  )
)

const factoryOptions = computed(() =>
  Array.from(
    new Set(
      [...summary.materials, ...summary.batches]
        .map((item) => resolveFactoryText(item))
        .filter(Boolean)
    )
  )
)

const categoryOptions = computed(() =>
  Array.from(
    new Set(
      [...summary.materials, ...summary.inTransit, ...summary.batches]
        .map((item) => resolveCategoryText(item))
        .filter(Boolean)
    )
  )
)

const supplierSelectOptions = computed(() => supplierOptions.value.map((item) => ({ label: item, value: item })))
const factorySelectOptions = computed(() => factoryOptions.value.map((item) => ({ label: item, value: item })))
const categorySelectOptions = computed(() => categoryOptions.value.map((item) => ({ label: item, value: item })))

const searchFieldOptions = [
  { label: TEXT.searchAll, value: 'keyword' },
  { label: TEXT.searchMaterialCode, value: 'material_code' },
  { label: TEXT.searchMaterialName, value: 'material_name' },
  { label: TEXT.searchColor, value: 'color' },
  { label: TEXT.searchSupplier, value: 'supplier' },
  { label: TEXT.searchRemark, value: 'remark' }
]

const stockScopeOptions = [
  { label: '全部库存', value: 'all' },
  { label: '只看仓库库存', value: 'warehouse' },
  { label: '只看工厂库存', value: 'factory' }
]

const searchPlaceholderText = computed(() => {
  const map = {
    keyword: TEXT.searchPlaceholder,
    material_code: '搜索原料编码',
    material_name: '搜索原料名称',
    color: '搜索颜色',
    supplier: '搜索供应商',
    remark: '搜索备注'
  }
  return map[filters.searchField] || TEXT.searchPlaceholder
})

function filterSelectOption(input, option) {
  const label = String(option?.label ?? option?.value ?? '').toLowerCase()
  return label.includes(String(input || '').toLowerCase())
}

function formatDate(value) {
  if (!value) return '-'
  return String(value).slice(0, 10)
}

function formatQty(value, digits = 4) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number.toFixed(digits).replace(/\.?0+$/, '') || '0' : '0'
}

function formatQtyWithUnit(value, unit, digits = 4) {
  return `${formatQty(value, digits)} ${unit || ''}`.trim()
}

function formatDisplayQtyText(value, unit) {
  if (typeof value === 'string' && value.trim()) return value
  return formatQtyWithUnit(value, unit)
}

function formatRollCount(value) {
  if (!value || Number(value) <= 0) return '-'
  return formatQty(value, 2)
}

function formatColorWithSize(row) {
  const color = String(row?.color || '-').trim() || '-'
  const size = String(row?.size || '').trim()
  return size ? `${color} / ${size}` : color
}

function buildAdjustmentSummary(item) {
  if (item.price_type === 'sample') return TEXT.normal
  const type = item.adjustment_type || ''
  if (type === 'space_x') {
    return `绌?${formatQty(item.adjustment_x, 2)}`
  }
  if (type === 'space_xy') {
    return `绌哄樊 ${formatQty(item.adjustment_left, 2)}+${formatQty(item.adjustment_right, 2)}`
  }
  return TEXT.normal
}

function buildPriceSummary(item) {
  const lines = []
  if (item.entered_unit_price) {
    lines.push(`录入：${formatMoney(item.entered_unit_price, 4)}/${item.entered_price_unit || item.base_unit || ''}`)
  }
  if (item.avg_cost_price) {
    lines.push(`成本：${formatMoney(item.avg_cost_price, 4)}/${item.base_unit || ''}`)
  }
  if (!lines.length) return '-'
  return lines.join('\n')
}

function formatPurchaseSummary(row) {
  const purchaseText = formatHistoricalPurchaseText(row)
  const actualText = formatHistoricalActualText(row)
  return `历史采购：${purchaseText} / 历史实际：${actualText}`
}

function formatHistoricalPurchaseText(row) {
  return row.purchase_display_text
    || formatQtyWithUnit(row.historical_purchased_qty, row.base_unit)
    || '-'
}

function formatHistoricalActualText(row) {
  return row.actual_display_text
    || formatQtyWithUnit(row.historical_actual_qty, row.base_unit)
    || '-'
}

function resolveMaterialQty(key, row) {
  const map = {
    sent_to_factory: row.sent_to_factory_qty,
    factory_used: row.factory_used_qty,
    factory_remaining: row.factory_remaining_qty,
    warehouse_remaining: row.warehouse_remaining_qty,
    current_stock: row.current_stock_qty,
    pre_allocated: row.pre_allocated_qty,
    factory_available_after_prealloc: row.factory_available_after_prealloc_qty,
    available_after_prealloc: row.available_after_prealloc_qty
  }
  return map[key] || 0
}

function qtyToneClass(value) {
  return Number(value || 0) < -0.0001 ? 'erp-number--negative' : ''
}

function normalizeSearchSource(item) {
  return {
    keyword: [
      item.material_code,
      item.material_name,
      item.color,
      resolveSupplierText(item),
      item.remark
    ],
    material_code: [item.material_code],
    material_name: [item.material_name],
    color: [item.color],
    supplier: [resolveSupplierText(item)],
    remark: [item.remark]
  }
}

function buildInventoryLinkKey(row = {}) {
  return [
    row.material_id || row.material_code || '',
    row.color || '',
    row.size || '',
    resolveSupplierText(row)
  ].join('::')
}

function keywordMatch(item) {
  const keyword = String(debouncedSearch.value || '').trim().toLowerCase()
  if (!keyword) return true
  const source = normalizeSearchSource(item)
  return (source[filters.searchField] || source.keyword)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(keyword)
}

function filterRows(rows) {
  return rows.filter((item) => {
    if (!keywordMatch(item)) return false
    if (filters.supplier && resolveSupplierText(item) !== normalizeFilterText(filters.supplier)) return false
    if (filters.factory && resolveFactoryText(item) !== normalizeFilterText(filters.factory)) return false
    if (filters.category && resolveCategoryText(item) !== normalizeFilterText(filters.category)) return false
    if (filters.stockScope === 'warehouse') {
      const warehouseQty = Number(item.warehouse_remaining_qty ?? item.warehouse_remaining ?? item.warehouse_qty ?? 0)
      if (warehouseQty <= 0.0001) return false
    }
    if (filters.stockScope === 'factory') {
      const factoryQty = Number(item.factory_remaining_qty ?? item.factory_remaining ?? 0)
      if (factoryQty <= 0.0001) return false
    }
    return true
  })
}

const directFilteredMaterials = computed(() => filterRows(summary.materials))
const directFilteredInTransit = computed(() => filterRows(summary.inTransit))
const filteredLinkKeys = computed(() => {
  const keys = new Set()
  for (const item of directFilteredMaterials.value) keys.add(buildInventoryLinkKey(item))
  for (const item of directFilteredInTransit.value) keys.add(buildInventoryLinkKey(item))
  return keys
})
const filteredMaterials = computed(() => {
  if (!filteredLinkKeys.value.size) return directFilteredMaterials.value
  return summary.materials.filter((item) => filteredLinkKeys.value.has(buildInventoryLinkKey(item)))
})
const filteredInTransit = computed(() => {
  if (!filteredLinkKeys.value.size) return directFilteredInTransit.value
  return summary.inTransit.filter((item) => filteredLinkKeys.value.has(buildInventoryLinkKey(item)))
})
const filteredBatches = computed(() => filterRows(summary.batches))

const pagedMaterials = computed(() => {
  const start = (materialCurrentPage.value - 1) * materialPageSize.value
  return filteredMaterials.value.slice(start, start + materialPageSize.value)
})
const pagedInTransit = computed(() => {
  const start = (transitCurrentPage.value - 1) * transitPageSize.value
  return filteredInTransit.value.slice(start, start + transitPageSize.value)
})
const pagedBatches = computed(() => {
  const start = (batchCurrentPage.value - 1) * batchPageSize.value
  return filteredBatches.value.slice(start, start + batchPageSize.value)
})

function materialRowKey(row) {
  return [
    row.material_id || row.material_code || 'material',
    row.color || '-',
    row.size || '',
    row.supplier_name || row.supplier || '-',
    row.factory_name || '-'
  ].join('::')
}
function transitRowKey(row) {
  return `${row.id || row.purchase_order_no || 'transit'}::${row.material_id || row.material_code || '-'}::${row.color || '-'}`
}
function batchRowKey(row) {
  return `${row.id || row.batch_no || 'batch'}`
}

async function loadInventory() {
  loading.value = true
  try {
    const response = await api.db.getInventorySummary()
    summary.summaryCards = response?.summaryCards || []
    summary.materials = response?.materials || []
    summary.inTransit = response?.inTransit || response?.inTransitBatches || []
    summary.batches = response?.batches || []
  } catch (error) {
    message.error(error?.message || '库存台账加载失败')
  } finally {
    loading.value = false
  }
}

function buildExportTable(title, columns, rows) {
  const exportColumns = columns.filter((column) => !['image', 'actions'].includes(column.key))
  const heads = exportColumns.map((column) => `<th>${column.title}</th>`).join('')
  const body = rows.map((row) => {
    const cells = exportColumns.map((column) => `<td>${renderCellText(column.key, row)}</td>`).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return `
    <section style="margin-bottom:24px;">
      <h2 style="font-size:18px;margin:0 0 12px;">${title}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr>${heads}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  `
}

function renderCellText(key, row) {
  switch (key) {
    case 'accumulated_purchase':
      return formatPurchaseSummary(row).replace(' / ', '\n')
    case 'roll_count':
      return `${formatRollCount(row.roll_count)} / ${buildAdjustmentSummary(row)}`
    case 'avg_cost':
      return `${formatMoney(row.avg_cost_price, 4)}/${row.base_unit || ''}`
    case 'stock_value':
      return formatMoney(row.stock_value || 0, 2)
    case 'sent_to_factory':
    case 'factory_used':
    case 'factory_remaining':
    case 'warehouse_remaining':
    case 'current_stock':
    case 'pre_allocated':
    case 'factory_available_after_prealloc':
    case 'available_after_prealloc':
      return formatQtyWithUnit(resolveMaterialQty(key, row), row.base_unit)
    case 'purchase_display_qty':
      return formatDisplayQtyText(row.purchase_display_text || row.purchase_display_qty, row.purchase_display_unit)
    case 'actual_display_qty':
      return formatDisplayQtyText(row.actual_display_text || row.actual_display_qty, row.actual_display_unit)
    case 'price':
      return buildPriceSummary(row).replace(/\n/g, ' / ')
    case 'adjustment':
      return buildAdjustmentSummary(row)
    case 'converted_qty':
      return formatQtyWithUnit(row.converted_qty, row.base_unit)
    case 'remaining_qty':
      return formatQtyWithUnit(row.remaining_qty, row.base_unit)
    case 'received_at':
    case 'arrival_date':
    case 'latest_received_at':
      return formatDate(row.received_at || row.arrival_date || row.latest_received_at)
    default:
      return row[key] || '-'
  }
}

async function handleExport() {
  exportLoading.value = true
  try {
    const html = `
      <html>
        <head><meta charset="utf-8" /><title>${TEXT.title}</title></head>
        <body style="font-family:'Microsoft YaHei',sans-serif;padding:24px;color:#1f2937;">
          <h1 style="margin:0 0 8px;">${TEXT.title}</h1>
          <p style="margin:0 0 24px;color:#6b7280;">${TEXT.subtitle}</p>
          ${buildExportTable(TEXT.summarySection, materialColumns.value, filteredMaterials.value)}
          ${buildExportTable(TEXT.transitSection, transitColumns.value, filteredInTransit.value)}
          ${buildExportTable(TEXT.batchSection, batchColumns.value, filteredBatches.value)}
        </body>
      </html>
    `
    await api.misc.exportHtmlExcel({
      html,
      defaultName: 'inventory-ledger'
    })
    message.success(TEXT.exported)
  } catch (error) {
    message.error(error?.message || '导出失败')
  } finally {
    exportLoading.value = false
  }
}

onMounted(loadInventory)
onActivated(() => {
  if (!loading.value) loadInventory()
})

watch(
  [
    searchValue,
    () => filters.searchField,
    () => filters.supplier,
    () => filters.factory,
    () => filters.category,
    () => filters.stockScope
  ],
  () => {
    materialCurrentPage.value = 1
    transitCurrentPage.value = 1
    batchCurrentPage.value = 1
    saveStoredViewState()
  }
)

watch([materialPageSize, transitPageSize, batchPageSize], () => {
  materialCurrentPage.value = 1
  transitCurrentPage.value = 1
  batchCurrentPage.value = 1
  saveStoredViewState()
})

watch(filteredMaterials, (rows) => {
  const maxPage = Math.max(1, Math.ceil(rows.length / materialPageSize.value))
  if (materialCurrentPage.value > maxPage) materialCurrentPage.value = maxPage
})
watch(filteredInTransit, (rows) => {
  const maxPage = Math.max(1, Math.ceil(rows.length / transitPageSize.value))
  if (transitCurrentPage.value > maxPage) transitCurrentPage.value = maxPage
})
watch(filteredBatches, (rows) => {
  const maxPage = Math.max(1, Math.ceil(rows.length / batchPageSize.value))
  if (batchCurrentPage.value > maxPage) batchCurrentPage.value = maxPage
})
</script>

<style scoped>
.inventory-ledger-page {
  padding-left: 24px;
}

.inventory-ledger-page :deep(.ant-card),
.inventory-ledger-page :deep(.ant-card-body),
.inventory-ledger-page :deep(.table-pagination),
.inventory-ledger-page :deep(.ant-pagination),
.inventory-ledger-page :deep(.erp-table-wrap) {
  overflow: visible;
}

.inventory-ledger-page :deep(.ant-select-selector),
.inventory-ledger-page :deep(.ant-input),
.inventory-ledger-page :deep(.ant-input-affix-wrapper) {
  border-radius: 12px !important;
}

.inventory-ledger-page .table-pagination {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding-top: 16px;
}

.inventory-ledger-page .table-pagination__size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #6f84a3;
  font-size: 12px;
}

.inventory-ledger-page .table-pagination__native-select {
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
  .inventory-ledger-page {
    padding-left: 0;
  }
}
</style>

