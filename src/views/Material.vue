<template>
  <a-card class="content-card" :bordered="false">
    <template #title>物料资料</template>
    <PageSummaryStrip :items="summaryItems" />

    <MobileFilterPanel>
      <template #filters>
        <a-input v-model:value="keywordInput" placeholder="搜索原料编码 / 名称" allow-clear style="width:260px" />
        <a-select v-model:value="majorCategoryFilter" :options="majorCategoryOptions" allow-clear placeholder="大类（一级分类）" style="width:180px" />
        <a-select v-model:value="categoryFilter" :options="categoryOptions" allow-clear placeholder="物料分类（二级分类）" style="width:180px" />
        <a-select v-model:value="subCategoryFilter" :options="subCategoryOptions" allow-clear placeholder="原料属性（三级分类）" style="width:180px" />
        <a-select v-model:value="supplierFilter" :options="supplierOptions" allow-clear placeholder="供应商" style="width:160px" />
      </template>
      <template #actions>
        <a-button class="toolbar-refresh-btn" :loading="listLoading" @click="loadBaseData">刷新</a-button>
        <a-button type="primary" @click="openCreate">新增原料</a-button>
      </template>
    </MobileFilterPanel>

    <div class="erp-table-caption">支持按分类与供应商精确筛选，图片支持鼠标悬浮大图预览。</div>

    <div v-if="isMobileLayout" class="erp-mobile-list">
      <div v-for="record in filteredList" :key="record.id" class="erp-mobile-card">
        <div class="erp-mobile-card__head">
          <div>
            <div class="erp-mobile-card__title">{{ record.code || '-' }}</div>
            <div class="erp-mobile-card__meta">{{ record.name || '-' }}</div>
          </div>
          <HoverImageThumb :src="record.image_path" alt="material" empty-text="" />
        </div>
        <div class="erp-mobile-card__section">
          <div class="erp-mobile-card__label">分类 / 供应商</div>
          <div class="erp-mobile-card__value">{{ record.major_category || '-' }} / {{ record.category || '-' }} / {{ record.sub_category || '-' }}</div>
          <div class="erp-mobile-card__sub">供应商：{{ record.supplier || '-' }}</div>
        </div>
        <div class="erp-mobile-card__grid">
          <div class="erp-mobile-card__stat">
            <div class="erp-mobile-card__label">基础单位</div>
            <div class="erp-mobile-card__value">{{ normalizeUnit(record.unit) || '-' }}</div>
          </div>
          <div class="erp-mobile-card__stat">
            <div class="erp-mobile-card__label">规格</div>
            <div class="erp-mobile-card__value">{{ record.composition || '-' }}</div>
            <div class="erp-mobile-card__sub">
              {{ record.width ? `${record.width} cm` : '-' }} / {{ record.weight ? `${record.weight} g/m²` : '-' }}
            </div>
          </div>
        </div>
        <div class="erp-mobile-card__section">
          <div class="erp-mobile-card__label">原始价格</div>
          <div class="erp-mobile-card__sub">
            <div v-for="profile in (record.colorProfiles || []).slice(0, 2)" :key="`${record.id}-${profile.color}`">
              {{ profile.color || '未分色' }}：{{ profileRawSummary(profile, record) }}
            </div>
            <div v-if="!(record.colorProfiles || []).length">未设置</div>
          </div>
        </div>
        <div class="erp-mobile-card__section">
          <div class="erp-mobile-card__label">换算后价格</div>
          <div class="erp-mobile-card__sub">
            <div v-for="profile in (record.colorProfiles || []).slice(0, 2)" :key="`${record.id}-${profile.color}-adjusted-mobile`">
              {{ profile.color || '未分色' }}：{{ profileAdjustedSummary(profile, record) }}
            </div>
            <div v-if="!(record.colorProfiles || []).length">未设置</div>
          </div>
        </div>
        <div class="erp-mobile-card__footer">
          <a-button size="small" @click="openEdit(record)">编辑</a-button>
          <a-popconfirm title="确认删除该原料？" @confirm="remove(record.id)">
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
      :row-key="(row) => row.id"
      :pagination="{ pageSize: 12, showSizeChanger: true, pageSizeOptions: ['12','24','50'] }"
      :scroll="{ x: 1280 }"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'image'">
          <HoverImageThumb :src="record.image_path" alt="material" empty-text="" />
        </template>
        <template v-else-if="column.key === 'base'">
          <div>{{ record.major_category || '-' }} / {{ record.category || '-' }} / {{ record.sub_category || '-' }}</div>
          <div class="table-secondary">供应商：{{ record.supplier || '-' }}</div>
          <div class="table-secondary">基础单位：{{ normalizeUnit(record.unit) || '-' }}</div>
        </template>
        <template v-else-if="column.key === 'spec'">
          <div>成分：{{ record.composition || '-' }}</div>
          <div class="table-secondary">门幅：{{ record.width ? `${record.width} cm` : '-' }}</div>
          <div class="table-secondary">克重：{{ record.weight ? `${record.weight} g/m²` : '-' }}</div>
        </template>
        <template v-else-if="column.key === 'rule_raw'">
          <div v-for="profile in (record.colorProfiles || []).slice(0, 2)" :key="`${record.id}-${profile.color}`" class="table-secondary">
            {{ profile.color || '未分色' }}：{{ profileRawSummary(profile, record) }}
          </div>
          <div v-if="(record.colorProfiles || []).length > 2" class="table-secondary">另有 {{ record.colorProfiles.length - 2 }} 个颜色规则</div>
          <div v-if="!(record.colorProfiles || []).length" class="table-secondary">未设置</div>
        </template>
        <template v-else-if="column.key === 'rule_adjusted'">
          <div v-for="profile in (record.colorProfiles || []).slice(0, 2)" :key="`${record.id}-${profile.color}-adjusted`" class="table-secondary">
            {{ profile.color || '未分色' }}：{{ profileAdjustedSummary(profile, record) }}
          </div>
          <div v-if="(record.colorProfiles || []).length > 2" class="table-secondary">另有 {{ record.colorProfiles.length - 2 }} 个颜色规则</div>
          <div v-if="!(record.colorProfiles || []).length" class="table-secondary">未设置</div>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button size="small" @click="openEdit(record)">编辑</a-button>
            <a-popconfirm title="确认删除该原料？" @confirm="remove(record.id)">
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="visible" :title="form.id ? '编辑原料' : '新增原料'" width="1160px" @ok="save">
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="8"><a-form-item label="原料编码" required><a-input v-model:value="form.code" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="原料名称（可选）"><a-input v-model:value="form.name" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="大类（一级分类)"><InlineOptionSelect v-model="form.major_category" :entries="optionLists.materialMajorCategories" option-type="material_major_category" add-label="一级分类" placeholder="一级分类" allow-clear @options-updated="handleOptionsUpdated" /></a-form-item></a-col>
        </a-row>

        <a-form-item label="商品图片"><ImageDropInput v-model="form.image_path" title="原料图片" /></a-form-item>

        <a-row :gutter="16">
          <a-col :span="8"><a-form-item label="物料分类（二级分类)"><InlineOptionSelect v-model="form.category" :entries="optionLists.materialCategories" option-type="material_category" add-label="二级分类" placeholder="二级分类" allow-clear @options-updated="handleOptionsUpdated" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="原料属性（三级分类)"><InlineOptionSelect v-model="form.sub_category" :entries="optionLists.materialSubCategories" option-type="material_sub_category" add-label="三级分类" placeholder="三级分类" allow-clear @options-updated="handleOptionsUpdated" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="供应商"><InlineOptionSelect v-model="form.supplier" :entries="optionLists.suppliers" option-type="supplier" add-label="供应商" placeholder="供应商" allow-clear @options-updated="handleOptionsUpdated" /></a-form-item></a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="6"><a-form-item label="基础单位"><InlineOptionSelect v-model="form.unit" :entries="optionLists.units" option-type="unit" add-label="单位" placeholder="单位" @options-updated="handleOptionsUpdated" /></a-form-item></a-col>
          <a-col :span="6"><a-form-item label="默认单价（可选）"><a-input-number v-model:value="form.default_price" style="width:100%" :min="0" /></a-form-item></a-col>
          <a-col :span="6"><a-form-item label="默认单价单位"><InlineOptionSelect v-model="form.default_price_unit" :entries="optionLists.units" option-type="unit" add-label="单位" placeholder="单位" @options-updated="handleOptionsUpdated" /></a-form-item></a-col>
          <a-col :span="6"><a-form-item label="原料成分"><a-input v-model:value="form.composition" placeholder="如：92%天丝 8%氨纶" /></a-form-item></a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="8"><a-form-item label="门幅(cm)"><a-input-number v-model:value="form.width" style="width:100%" :min="0" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="克重(g/m²)"><a-input-number v-model:value="form.weight" style="width:100%" :min="0" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="每公斤出米数"><a-input-number v-model:value="form.meter_per_kg" style="width:100%" :min="0" :disabled="!isFabric" /></a-form-item></a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="6"><a-form-item label="自定义换算左值"><a-input-number v-model:value="form.custom_conversion_from_qty" style="width:100%" :min="0" /></a-form-item></a-col>
          <a-col :span="6"><a-form-item label="左侧单位"><InlineOptionSelect v-model="form.custom_conversion_from_unit" :entries="optionLists.units" option-type="unit" add-label="单位" placeholder="单位" allow-clear @options-updated="handleOptionsUpdated" /></a-form-item></a-col>
          <a-col :span="6"><a-form-item label="自定义换算右值"><a-input-number v-model:value="form.custom_conversion_to_qty" style="width:100%" :min="0" /></a-form-item></a-col>
          <a-col :span="6"><a-form-item label="右侧单位"><InlineOptionSelect v-model="form.custom_conversion_to_unit" :entries="optionLists.units" option-type="unit" add-label="单位" placeholder="单位" allow-clear @options-updated="handleOptionsUpdated" /></a-form-item></a-col>
        </a-row>
        <div class="table-secondary" style="margin-bottom:12px;">自定义换算示例：1 条 = 3 码。设置后，采购、BOM、生产制单会沿着这条关系继续换算。</div>

        <a-row :gutter="16">
          <a-col :span="8"><a-form-item label="空差类型"><a-select v-model:value="form.adjustment_type" :options="adjustmentOptions" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="左空差"><a-input-number v-model:value="form.left_gap" style="width:100%" :min="0" :disabled="form.adjustment_type !== 'weight_gap'" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item :label="form.adjustment_type === 'rate' ? '空 X' : '右空差'"><a-input-number v-model:value="dynamicGapValue" style="width:100%" :min="0" :disabled="form.adjustment_type === 'none'" /></a-form-item></a-col>
        </a-row>
        <a-row v-if="form.adjustment_type === 'weight_gap'" :gutter="16">
          <a-col :span="8"><a-form-item label="单条参考重量/数量"><a-input-number v-model:value="form.gap_reference_qty" style="width:100%" :min="0" /></a-form-item></a-col>
          <a-col :span="16">
            <div class="table-secondary" style="padding-top:30px;">
              按每 1 条布原本的参考量填写，例如一条布通常按 30 公斤结算，空差 0.5+0 时这里填 30，系统会按 30 ÷ 29.5 计算大货实际价。
            </div>
          </a-col>
        </a-row>

        <a-form-item label="备注"><a-textarea v-model:value="form.remark" :rows="3" :auto-size="{ minRows: 3, maxRows: 6 }" /></a-form-item>

        <a-divider>价格规则管理</a-divider>
        <div class="section-caption">
          <div>
            <div class="section-caption__title">颜色档</div>
            <div class="section-caption__desc">普通原料按“颜色 → 单价”维护；胸杯按“颜色 → 尺码 → 单价”维护；面料可继续维护版布价、净布价和大货价。</div>
          </div>
          <a-space>
            <a-select v-model:value="colorFillField" :options="colorFillFieldOptions" style="width:170px" />
            <a-select v-model:value="colorFillUnit" :options="colorFillUnitOptions" style="width:110px" />
            <a-input-number v-model:value="colorFillValue" :min="0" placeholder="统一单价" style="width:140px" />
            <a-button @click="applyColorProfileFill" :disabled="!colorProfiles.length">单价一键填充</a-button>
            <a-button @click="addColorProfile">新增颜色档</a-button>
            <a-button type="primary" :disabled="!colorProfiles.length" @click="openRuleManager(0)">打开规则窗口</a-button>
          </a-space>
        </div>

        <div v-for="(item, index) in colorProfiles" :key="item.localKey" class="bom-row material-color-card">
          <div class="sortable-row__bar">
            <span class="sortable-row__title">颜色档 {{ index + 1 }}</span>
            <div class="sortable-row__actions">
              <a-button size="small" @click="moveColorProfile(index, -1)" :disabled="index === 0">上移</a-button>
              <a-button size="small" @click="moveColorProfile(index, 1)" :disabled="index === colorProfiles.length - 1">下移</a-button>
              <a-button size="small" @click="openRuleManager(index)">管理价格</a-button>
              <a-button size="small" danger @click="removeColorProfile(index)">删除</a-button>
            </div>
          </div>
          <a-row :gutter="12">
            <a-col :span="8"><a-form-item label="颜色" required><a-input v-model:value="item.color" placeholder="如：白色 / 黑色 / 浅蓝色" /></a-form-item></a-col>
            <a-col :span="16"><a-form-item label="规则摘要"><a-input :value="profileSummary(item, form)" readonly /></a-form-item></a-col>
          </a-row>
        </div>
      </a-form>
    </a-modal>
    <a-modal v-model:open="ruleVisible" title="价格规则管理" width="920px" @ok="ruleVisible = false">
      <template v-if="activeProfile">
        <a-alert type="info" show-icon style="margin-bottom:16px;" :message="ruleManagerHint" />
        <a-row :gutter="16">
          <a-col :span="8"><a-form-item label="颜色"><a-input v-model:value="activeProfile.color" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="颜色默认单价"><a-input-number v-model:value="activeProfile.default_price" style="width:100%" :min="0" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="颜色单价单位"><InlineOptionSelect v-model="activeProfile.default_price_unit" :entries="optionLists.units" option-type="unit" add-label="单位" placeholder="单位" @options-updated="handleOptionsUpdated" /></a-form-item></a-col>
        </a-row>

        <template v-if="isCupMaterial">
          <a-divider>胸杯：颜色 + 尺码 + 单价</a-divider>
          <div class="section-caption">
            <div>
              <div class="section-caption__title">胸杯尺码价</div>
              <div class="section-caption__desc">默认 S / M / L，可继续新增自定义尺码。采购单和生产制单会直接读取这里的尺码价格。</div>
            </div>
            <a-space>
              <a-input-number v-model:value="ruleSizeFillValue" :min="0" placeholder="统一价格" />
              <a-button @click="fillActiveProfileSizePrices(ruleSizeFillValue)">一键填充</a-button>
              <a-button @click="addActiveProfileSizePrice">新增尺码</a-button>
            </a-space>
          </div>
          <div class="size-grid size-grid--compact">
            <div v-for="(sizeItem, sizeIndex) in activeProfile.sizePrices" :key="sizeItem.localKey" class="size-grid__item">
              <a-input v-model:value="sizeItem.size" placeholder="尺码" />
              <a-input-number v-model:value="sizeItem.price" :min="0" style="width:100%" />
              <a-input :value="normalizeUnit(sizeItem.unit || activeProfile.default_price_unit || form.default_price_unit || form.unit)" readonly />
              <a-button size="small" danger @click="removeActiveProfileSizePrice(sizeIndex)" :disabled="activeProfile.sizePrices.length === 1">删除</a-button>
            </div>
          </div>
        </template>

        <template v-if="isFabric">
          <a-divider>面料高级价格</a-divider>
          <a-row :gutter="16">
            <a-col :span="8"><a-form-item label="版布价（米价）"><a-input-number v-model:value="activeProfile.sample_price_meter" style="width:100%" :min="0" /></a-form-item></a-col>
            <a-col :span="8"><a-form-item label="版布价（公斤价）"><a-input-number v-model:value="activeProfile.sample_price_kg" style="width:100%" :min="0" /></a-form-item></a-col>
            <a-col :span="8"><a-form-item label="版布价（码价）"><a-input-number v-model:value="activeProfile.sample_price_yard" style="width:100%" :min="0" /></a-form-item></a-col>
          </a-row>
          <a-row :gutter="16">
            <a-col :span="8"><a-form-item label="净布价（米价）"><a-input-number v-model:value="activeProfile.net_price_meter" style="width:100%" :min="0" /></a-form-item></a-col>
            <a-col :span="8"></a-col>
            <a-col :span="8"></a-col>
          </a-row>
          <a-row :gutter="16">
            <a-col :span="8"><a-form-item label="大货价（公斤）"><a-input-number v-model:value="activeProfile.bulk_price_kg" style="width:100%" :min="0" @change="(value) => syncBulkPrices(activeProfile, '公斤', value)" /></a-form-item></a-col>
            <a-col :span="8"><a-form-item label="大货价（米）"><a-input-number v-model:value="activeProfile.bulk_price_meter" style="width:100%" :min="0" @change="(value) => syncBulkPrices(activeProfile, '米', value)" /></a-form-item></a-col>
            <a-col :span="8"><a-form-item label="大货价（码）"><a-input-number v-model:value="activeProfile.bulk_price_yard" style="width:100%" :min="0" @change="(value) => syncBulkPrices(activeProfile, '码', value)" /></a-form-item></a-col>
          </a-row>
          <div class="table-secondary" style="margin-top:-6px; margin-bottom:12px;">
            <div v-for="line in getFabricPriceExplainLines(activeProfile)" :key="line.label" style="margin-bottom:4px;">
              {{ line.label }}：录入价 {{ line.raw }}，实际价 {{ line.adjusted }}
            </div>
          </div>
        </template>

        <a-form-item label="颜色备注"><a-textarea v-model:value="activeProfile.remark" :rows="3" :auto-size="{ minRows: 3, maxRows: 6 }" /></a-form-item>
      </template>
    </a-modal>
  </a-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import ImageDropInput from '@/components/ImageDropInput.vue'
import HoverImageThumb from '@/components/HoverImageThumb.vue'
import InlineOptionSelect from '@/components/InlineOptionSelect.vue'
import MobileFilterPanel from '@/components/MobileFilterPanel.vue'
import PageSummaryStrip from '@/components/PageSummaryStrip.vue'
import { useDebouncedInput } from '@/composables/useDebouncedInput'
import { useMobileLayout } from '@/composables/useMobileLayout'
import { api, formatMoney, optionalNumber, toSelectOptions } from '@/utils/api'
import { convertUnitPrice, normalizeUnit } from '@/utils/material'

const { isMobileLayout } = useMobileLayout()

const defaultCupSizes = ['S', 'M', 'L']

function createEmptyForm() {
  return {
    id: null,
    code: '',
    style_code: '',
    name: '',
    image_path: '',
    major_category: '面料',
    category: undefined,
    sub_category: undefined,
    leaf_category: '',
    composition: '',
    color: '',
    width: null,
    weight: null,
    meter_per_kg: null,
    adjustment_type: 'none',
    left_gap: 0,
    right_gap: 0,
    gap_reference_qty: null,
    gap_ratio: 95,
    custom_formula: '',
    custom_conversion_from_qty: null,
    custom_conversion_from_unit: '',
    custom_conversion_to_qty: null,
    custom_conversion_to_unit: '',
    unit: '公斤',
    default_price: 0,
    default_price_unit: '公斤',
    supplier: undefined,
    remark: ''
  }
}

const { inputValue: keywordInput, debouncedValue: keyword } = useDebouncedInput('', 260)
const majorCategoryFilter = ref(undefined)
const categoryFilter = ref(undefined)
const subCategoryFilter = ref(undefined)
const supplierFilter = ref(undefined)
const visible = ref(false)
const ruleVisible = ref(false)
const ruleSizeFillValue = ref(0)
const colorFillField = ref('default_price')
const colorFillUnit = ref('公斤')
const colorFillValue = ref(0)
const list = ref([])
const listLoading = ref(false)
const colorProfiles = ref([])
const activeColorIndex = ref(-1)
const optionLists = ref({ materialMajorCategories: [], materialCategories: [], materialSubCategories: [], materialLeafCategories: [], suppliers: [], units: [] })

const columns = [
  { title: '图片', key: 'image', width: 110 },
  { title: '原料编码', dataIndex: 'code', key: 'code', width: 150 },
  { title: '原料名称', dataIndex: 'name', key: 'name', width: 180 },
  { title: '基础信息', key: 'base', width: 220 },
  { title: '规格信息', key: 'spec', width: 220 },
  { title: '录入价格规则', key: 'rule_raw', width: 340 },
  { title: '实际价格规则', key: 'rule_adjusted', width: 340 },
  { title: '操作', key: 'action', width: 140, fixed: 'right' }
]

const adjustmentOptions = [
  { label: '正常单价', value: 'none' },
  { label: '空差 X+Y', value: 'weight_gap' },
  { label: '空 X', value: 'rate' },
  { label: '自定义公式', value: 'custom' }
]

const form = reactive(createEmptyForm())
const isFabric = computed(() => String(form.major_category || '').trim() === '面料')
const isCupMaterial = computed(() => isCupMaterialRecord(form))
const activeProfile = computed(() => colorProfiles.value[activeColorIndex.value] || null)
const dynamicGapValue = computed({
  get: () => (form.adjustment_type === 'rate' ? form.gap_ratio : form.right_gap),
  set: (value) => { if (form.adjustment_type === 'rate') form.gap_ratio = value; else form.right_gap = value }
})

const majorCategoryOptions = computed(() => toSelectOptions(optionLists.value.materialMajorCategories))
const categoryOptions = computed(() => toSelectOptions(optionLists.value.materialCategories))
const subCategoryOptions = computed(() => toSelectOptions(optionLists.value.materialSubCategories))
const supplierOptions = computed(() => toSelectOptions(optionLists.value.suppliers))
const colorFillFieldOptions = computed(() => {
  const options = [{ label: '颜色默认单价', value: 'default_price' }]
  if (isFabric.value) {
    options.push(
      { label: '版布价（米）', value: 'sample_price_meter' },
      { label: '版布价（公斤）', value: 'sample_price_kg' },
      { label: '版布价（码）', value: 'sample_price_yard' },
      { label: '净布价（米）', value: 'net_price_meter' },
      { label: '大货价（公斤）', value: 'bulk_price_kg' },
      { label: '大货价（米）', value: 'bulk_price_meter' },
      { label: '大货价（码）', value: 'bulk_price_yard' }
    )
  }
  return options
})

const colorFillUnitOptions = computed(() => {
  if (colorFillField.value === 'sample_price_meter' || colorFillField.value === 'net_price_meter' || colorFillField.value === 'bulk_price_meter') return [{ label: '米', value: '米' }]
  if (colorFillField.value === 'sample_price_kg' || colorFillField.value === 'bulk_price_kg') return [{ label: '公斤', value: '公斤' }]
  if (colorFillField.value === 'sample_price_yard' || colorFillField.value === 'bulk_price_yard') return [{ label: '码', value: '码' }]
  return toSelectOptions(optionLists.value.units || []).map((item) => ({ ...item, value: normalizeUnit(item.value) }))
})

const filteredList = computed(() => {
  const value = String(keyword.value || '').trim().toLowerCase()
  return list.value.filter((item) => {
    const matchKeyword = !value || [item.code, item.name].some((field) => String(field || '').toLowerCase().includes(value))
    return matchKeyword
      && (!majorCategoryFilter.value || item.major_category === majorCategoryFilter.value)
      && (!categoryFilter.value || item.category === categoryFilter.value)
      && (!subCategoryFilter.value || item.sub_category === subCategoryFilter.value)
      && (!supplierFilter.value || item.supplier === supplierFilter.value)
  })
})

const summaryItems = computed(() => {
  const source = filteredList.value
  return [
    { label: '原料主档', value: `${source.length} 项`, note: '按当前筛选范围统计' },
    { label: '面料档案', value: `${source.filter((item) => item.major_category === '面料').length} 项`, note: '支持版布价 / 净布价 / 大货价' },
    { label: '胸杯档案', value: `${source.filter((item) => isCupMaterialRecord(item)).length} 项`, note: '支持颜色 + 尺码 + 单价' },
    { label: '颜色规则', value: `${source.reduce((sum, item) => sum + Number(item.colorProfiles?.length || 0), 0)} 条`, note: '采购与生产会直接读取' }
  ]
})

const ruleManagerHint = computed(() => {
  if (isCupMaterial.value) return '胸杯按“颜色 → 尺码 → 单价”维护，采购单和生产制单都会读取这里的规则。'
  if (isFabric.value) return '面料按颜色维护版布价、净布价和大货价；版布价不参与空差，大货价会按空差显示实际价。'
  return '普通原料按“颜色 → 单价”维护，采购时选择颜色会自动带价。'
})

function normalizedText(value) {
  return String(value || '').trim().toLowerCase()
}

function uniqueNonEmpty(list = []) {
  const seen = new Set()
  return list.map((item) => String(item || '').trim()).filter((item) => item && !seen.has(normalizedText(item)) && seen.add(normalizedText(item)))
}

function getDefaultRuleUnit() {
  return normalizeUnit(form.default_price_unit || form.unit || (isCupMaterial.value ? '对' : '米'))
}

function getProfileRuleUnit(profile = null, materialLike = form) {
  return normalizeUnit(profile?.default_price_unit || materialLike?.default_price_unit || materialLike?.unit || (isCupMaterialRecord(materialLike) ? '对' : '米'))
}

function normalizeSizePriceListLocal(list = [], fallbackUnit = '') {
  const source = Array.isArray(list) ? list : []
  const unit = normalizeUnit(fallbackUnit || getDefaultRuleUnit())
  return uniqueNonEmpty(source.map((item) => item?.size)).map((size) => {
    const matched = source.find((item) => normalizedText(item?.size) === normalizedText(size)) || {}
    return {
      localKey: matched.localKey || `${Date.now()}-${Math.random()}`,
      size,
      price: Number(matched.price || 0),
      unit: normalizeUnit(matched.unit || unit)
    }
  })
}

function syncProfileSizeUnits(profile, materialLike = form) {
  if (!profile) return
  const unit = getProfileRuleUnit(profile, materialLike)
  profile.default_price_unit = unit
  profile.sizePrices = normalizeSizePriceListLocal(profile.sizePrices || [], unit).map((item) => ({ ...item, unit }))
}

function createColorProfile(data = {}) {
  const profileUnit = getProfileRuleUnit(data, form)
  return {
    localKey: `${Date.now()}-${Math.random()}`,
    color: String(data.color || '').trim(),
    default_price: Number(data.default_price || 0),
    default_price_unit: profileUnit,
    sizePrices: normalizeSizePriceListLocal(data.sizePrices || data.size_price_json || [], profileUnit),
    sample_price_meter: Number(data.sample_price_meter || 0),
    sample_price_kg: Number(data.sample_price_kg || 0),
    sample_price_yard: Number(data.sample_price_yard || 0),
    net_price_meter: Number(data.net_price_meter || 0),
    bulk_price_kg: Number(data.bulk_price_kg || 0),
    bulk_price_meter: Number(data.bulk_price_meter || 0),
    bulk_price_yard: Number(data.bulk_price_yard || 0),
    remark: String(data.remark || '')
  }
}

function normalizeColorProfilesForSave(listValue = []) {
  const seen = new Set()
  return listValue.map((item, index) => {
    const profileUnit = getProfileRuleUnit(item, form)
    return {
      color: String(item.color || '').trim(),
      default_price: Number(item.default_price || 0),
      default_price_unit: profileUnit,
      sizePrices: normalizeSizePriceListLocal(item.sizePrices || [], profileUnit).map((sizeItem, sizeIndex) => ({ size: sizeItem.size, price: Number(sizeItem.price || 0), unit: profileUnit, sort_order: sizeIndex + 1 })),
      sample_price_meter: Number(item.sample_price_meter || 0),
      sample_price_kg: Number(item.sample_price_kg || 0),
      sample_price_yard: Number(item.sample_price_yard || 0),
      net_price_meter: Number(item.net_price_meter || 0),
      bulk_price_kg: Number(item.bulk_price_kg || 0),
      bulk_price_meter: Number(item.bulk_price_meter || 0),
      bulk_price_yard: Number(item.bulk_price_yard || 0),
      remark: String(item.remark || ''),
      sort_order: index + 1
    }
  }).filter((item) => item.color && !seen.has(normalizedText(item.color)) && seen.add(normalizedText(item.color)))
}

function isCupMaterialRecord(record) {
  return [record?.category, record?.sub_category, record?.leaf_category].some((item) => String(item || '').trim() === '胸杯')
}

function getAdjustedBulkPrice(price, materialLike = form) {
  const rawPrice = Number(price || 0)
  if (!rawPrice) return 0
  const adjustmentType = String(materialLike.adjustment_type || 'none')
  if (adjustmentType === 'rate') {
    const rawGapRatio = Number(materialLike.gap_ratio || 0)
    const gapRatio = rawGapRatio > 1 ? rawGapRatio / 100 : rawGapRatio
    if (gapRatio > 0) return Number((rawPrice / gapRatio).toFixed(6))
  }
  if (adjustmentType === 'weight_gap') {
    const referenceQty = Number(materialLike.gap_reference_qty || 0)
    const deduction = Math.max(Number(materialLike.left_gap || 0), 0) + Math.max(Number(materialLike.right_gap || 0), 0)
    const netQty = referenceQty - deduction
    if (referenceQty > 0 && netQty > 0) return Number((rawPrice * (referenceQty / netQty)).toFixed(6))
  }
  return rawPrice
}

function formatUnitPrice(price, unit) {
  return `${formatMoney(price, 4)}/${normalizeUnit(unit)}`
}

function bulkPriceSummary(profile, materialLike = form) {
  const parts = []
  if (Number(profile.bulk_price_kg || 0) > 0) parts.push(`大货价 ${formatMoney(getAdjustedBulkPrice(profile.bulk_price_kg, materialLike), 4)}/公斤`)
  if (Number(profile.bulk_price_meter || 0) > 0) parts.push(`${formatMoney(getAdjustedBulkPrice(profile.bulk_price_meter, materialLike), 4)}/米`)
  if (Number(profile.bulk_price_yard || 0) > 0) parts.push(`${formatMoney(getAdjustedBulkPrice(profile.bulk_price_yard, materialLike), 4)}/码`)
  return parts.join(' / ')
}

function bulkRawPriceSummary(profile) {
  const parts = []
  if (Number(profile.bulk_price_kg || 0) > 0) parts.push(`大货价 ${formatMoney(profile.bulk_price_kg, 4)}/公斤`)
  if (Number(profile.bulk_price_meter || 0) > 0) parts.push(`${formatMoney(profile.bulk_price_meter, 4)}/米`)
  if (Number(profile.bulk_price_yard || 0) > 0) parts.push(`${formatMoney(profile.bulk_price_yard, 4)}/码`)
  return parts.join(' / ')
}

function profileRawSummary(profile, materialLike = form) {
  if (isCupMaterialRecord(materialLike)) {
    const profileUnit = getProfileRuleUnit(profile, materialLike)
    const sizes = normalizeSizePriceListLocal(profile.sizePrices || [], profileUnit).slice(0, 3).map((item) => `${item.size}:${formatMoney(item.price, 4)}/${normalizeUnit(item.unit || profileUnit)}`)
    return sizes.length ? sizes.join('，') : '未设置'
  }
  if (String(materialLike.major_category || '').trim() === '面料') {
    const parts = []
    if (Number(profile.sample_price_meter || 0) > 0) parts.push(`版布价 ${formatMoney(profile.sample_price_meter, 4)}/米`)
    if (Number(profile.sample_price_kg || 0) > 0) parts.push(`${formatMoney(profile.sample_price_kg, 4)}/公斤`)
    if (Number(profile.sample_price_yard || 0) > 0) parts.push(`${formatMoney(profile.sample_price_yard, 4)}/码`)
    if (Number(profile.net_price_meter || 0) > 0) parts.push(`净布价 ${formatMoney(profile.net_price_meter, 4)}/米`)
    const bulkSummary = bulkRawPriceSummary(profile)
    if (bulkSummary) parts.push(bulkSummary)
    if (!parts.length && Number(profile.default_price || 0) > 0) parts.push(`颜色价 ${formatMoney(profile.default_price, 4)}/${normalizeUnit(profile.default_price_unit || getProfileRuleUnit(profile, materialLike))}`)
    return parts.join(' / ') || '未设置'
  }
  if (Number(profile.default_price || 0) > 0) return `${formatMoney(profile.default_price, 4)}/${normalizeUnit(profile.default_price_unit || getProfileRuleUnit(profile, materialLike))}`
  return '未设置'
}

function profileAdjustedSummary(profile, materialLike = form) {
  return profileSummary(profile, materialLike)
}

function profileSummary(profile, materialLike = form) {
  if (isCupMaterialRecord(materialLike)) {
    const profileUnit = getProfileRuleUnit(profile, materialLike)
    const sizes = normalizeSizePriceListLocal(profile.sizePrices || [], profileUnit).slice(0, 3).map((item) => `${item.size}:${formatMoney(item.price, 4)}/${normalizeUnit(item.unit || profileUnit)}`)
    return sizes.length ? sizes.join('，') : '未设置'
  }
  if (String(materialLike.major_category || '').trim() === '面料') {
    const parts = []
    if (Number(profile.sample_price_meter || 0) > 0) parts.push(`版布价 ${formatMoney(profile.sample_price_meter, 4)}/米`)
    if (Number(profile.sample_price_kg || 0) > 0) parts.push(`${formatMoney(profile.sample_price_kg, 4)}/公斤`)
    if (Number(profile.sample_price_yard || 0) > 0) parts.push(`${formatMoney(profile.sample_price_yard, 4)}/码`)
    if (Number(profile.net_price_meter || 0) > 0) parts.push(`净布价 ${formatMoney(profile.net_price_meter, 4)}/米`)
    const bulkSummary = bulkPriceSummary(profile, materialLike)
    if (bulkSummary) parts.push(bulkSummary)
    if (!parts.length && Number(profile.default_price || 0) > 0) parts.push(`颜色价 ${formatMoney(profile.default_price, 4)}/${normalizeUnit(profile.default_price_unit || getProfileRuleUnit(profile, materialLike))}`)
    return parts.join(' / ') || '未设置'
  }
  if (Number(profile.default_price || 0) > 0) return `${formatMoney(profile.default_price, 4)}/${normalizeUnit(profile.default_price_unit || getProfileRuleUnit(profile, materialLike))}`
  return '未设置'
}

function getFabricPriceExplainLines(profile) {
  const lines = []
  if (Number(profile.sample_price_meter || 0) > 0) lines.push({ label: '版布价（米）', raw: formatUnitPrice(profile.sample_price_meter, '米'), adjusted: formatUnitPrice(profile.sample_price_meter, '米') })
  if (Number(profile.sample_price_kg || 0) > 0) lines.push({ label: '版布价（公斤）', raw: formatUnitPrice(profile.sample_price_kg, '公斤'), adjusted: formatUnitPrice(profile.sample_price_kg, '公斤') })
  if (Number(profile.sample_price_yard || 0) > 0) lines.push({ label: '版布价（码）', raw: formatUnitPrice(profile.sample_price_yard, '码'), adjusted: formatUnitPrice(profile.sample_price_yard, '码') })
  if (Number(profile.net_price_meter || 0) > 0) lines.push({ label: '净布价（米）', raw: formatUnitPrice(profile.net_price_meter, '米'), adjusted: formatUnitPrice(profile.net_price_meter, '米') })
  if (Number(profile.bulk_price_kg || 0) > 0) lines.push({ label: '大货价（公斤）', raw: formatUnitPrice(profile.bulk_price_kg, '公斤'), adjusted: formatUnitPrice(getAdjustedBulkPrice(profile.bulk_price_kg, form), '公斤') })
  if (Number(profile.bulk_price_meter || 0) > 0) lines.push({ label: '大货价（米）', raw: formatUnitPrice(profile.bulk_price_meter, '米'), adjusted: formatUnitPrice(getAdjustedBulkPrice(profile.bulk_price_meter, form), '米') })
  if (Number(profile.bulk_price_yard || 0) > 0) lines.push({ label: '大货价（码）', raw: formatUnitPrice(profile.bulk_price_yard, '码'), adjusted: formatUnitPrice(getAdjustedBulkPrice(profile.bulk_price_yard, form), '码') })
  return lines
}
function handleOptionsUpdated(nextLists) {
  optionLists.value = nextLists
}

function addColorProfile() {
  const defaultColor = String(colorProfiles.value[colorProfiles.value.length - 1]?.color || '').trim() || '白色'
  const profile = createColorProfile({ color: defaultColor, default_price_unit: getDefaultRuleUnit() })
  if (isCupMaterial.value) {
    profile.sizePrices = defaultCupSizes.map((size) => ({ localKey: `${Date.now()}-${Math.random()}`, size, price: 0, unit: getProfileRuleUnit(profile, form) }))
  }
  colorProfiles.value.push(profile)
}

function removeColorProfile(index) {
  colorProfiles.value.splice(index, 1)
  if (activeColorIndex.value >= colorProfiles.value.length) activeColorIndex.value = colorProfiles.value.length - 1
}

function moveColorProfile(index, delta) {
  const next = index + delta
  if (next < 0 || next >= colorProfiles.value.length) return
  const listValue = [...colorProfiles.value]
  const [item] = listValue.splice(index, 1)
  listValue.splice(next, 0, item)
  colorProfiles.value = listValue
  if (activeColorIndex.value === index) activeColorIndex.value = next
}

function openRuleManager(index) {
  if (!colorProfiles.value.length) addColorProfile()
  activeColorIndex.value = Math.max(0, index)
  if (isCupMaterial.value && activeProfile.value && !activeProfile.value.sizePrices.length) {
    activeProfile.value.sizePrices = defaultCupSizes.map((size) => ({ localKey: `${Date.now()}-${Math.random()}`, size, price: 0, unit: getProfileRuleUnit(activeProfile.value, form) }))
  }
  syncProfileSizeUnits(activeProfile.value, form)
  ruleVisible.value = true
}

function addActiveProfileSizePrice() {
  if (!activeProfile.value) return
  activeProfile.value.sizePrices.push({ localKey: `${Date.now()}-${Math.random()}`, size: '', price: 0, unit: getProfileRuleUnit(activeProfile.value, form) })
}

function removeActiveProfileSizePrice(index) {
  if (!activeProfile.value || activeProfile.value.sizePrices.length === 1) return
  activeProfile.value.sizePrices.splice(index, 1)
}

function fillActiveProfileSizePrices(price = 0) {
  if (!activeProfile.value) return
  activeProfile.value.sizePrices.forEach((item) => {
    item.price = Number(price || 0)
    item.unit = getProfileRuleUnit(activeProfile.value, form)
  })
}

function applyColorProfileFill() {
  if (!colorProfiles.value.length) return
  const fillValue = Number(colorFillValue.value || 0)
  const fillUnit = normalizeUnit(colorFillUnit.value || form.default_price_unit || form.unit || '公斤')
  colorProfiles.value.forEach((profile) => {
    if (colorFillField.value === 'default_price') {
      profile.default_price = fillValue
      profile.default_price_unit = fillUnit
      syncProfileSizeUnits(profile, form)
      return
    }
    if (colorFillField.value === 'sample_price_meter') { profile.sample_price_meter = fillValue; return }
    if (colorFillField.value === 'sample_price_kg') { profile.sample_price_kg = fillValue; return }
    if (colorFillField.value === 'sample_price_yard') { profile.sample_price_yard = fillValue; return }
    if (colorFillField.value === 'net_price_meter') { profile.net_price_meter = fillValue; return }
    if (colorFillField.value === 'bulk_price_kg') { syncBulkPrices(profile, '公斤', fillValue); return }
    if (colorFillField.value === 'bulk_price_meter') { syncBulkPrices(profile, '米', fillValue); return }
    if (colorFillField.value === 'bulk_price_yard') syncBulkPrices(profile, '码', fillValue)
  })
  message.success('已按当前规则批量填充颜色价格')
}

function syncBulkPrices(profile, sourceUnit, value) {
  const price = Number(value || 0)
  const material = {
    width: form.width,
    weight: form.weight,
    meter_per_kg: form.meter_per_kg,
    custom_conversion_from_qty: form.custom_conversion_from_qty,
    custom_conversion_from_unit: form.custom_conversion_from_unit,
    custom_conversion_to_qty: form.custom_conversion_to_qty,
    custom_conversion_to_unit: form.custom_conversion_to_unit
  }
  if (!price) {
    profile.bulk_price_kg = 0
    profile.bulk_price_meter = 0
    profile.bulk_price_yard = 0
    return
  }
  profile.bulk_price_kg = Number(convertUnitPrice(price, sourceUnit, '公斤', material) || 0)
  profile.bulk_price_meter = Number(convertUnitPrice(price, sourceUnit, '米', material) || 0)
  profile.bulk_price_yard = Number(convertUnitPrice(price, sourceUnit, '码', material) || 0)
}

function resetForm() {
  Object.assign(form, createEmptyForm())
  colorProfiles.value = []
  activeColorIndex.value = -1
  ruleSizeFillValue.value = 0
  colorFillField.value = 'default_price'
  colorFillUnit.value = '公斤'
  colorFillValue.value = 0
}

function openCreate() {
  resetForm()
  addColorProfile()
  visible.value = true
}

function openEdit(row) {
  resetForm()
  Object.assign(form, {
    ...createEmptyForm(),
    ...row,
    unit: normalizeUnit(row.unit || '公斤'),
    default_price: Number(row.default_price || 0),
    default_price_unit: normalizeUnit(row.default_price_unit || row.unit || (isCupMaterialRecord(row) ? '对' : '公斤'))
  })
  colorProfiles.value = (row.colorProfiles || []).map((item) => createColorProfile(item))
  if (!colorProfiles.value.length) {
    const fallbackColor = String(row.primaryColor || row.color || '').trim() || '白色'
    colorProfiles.value = [createColorProfile({ color: fallbackColor, default_price_unit: form.default_price_unit })]
  }
  colorProfiles.value.forEach((profile) => syncProfileSizeUnits(profile, row))
  visible.value = true
}

async function loadBaseData() {
  listLoading.value = true
  try {
    const [materialsResult, optionsResult] = await Promise.all([api.db.getMaterials(), api.db.getOptionLists()])
    list.value = materialsResult
    optionLists.value = optionsResult
  } catch (error) {
    message.error(error.message || '加载物料资料失败')
  } finally {
    listLoading.value = false
  }
}

let baseReloadTimer = null

function scheduleBaseReload(delay = 100) {
  if (baseReloadTimer) {
    clearTimeout(baseReloadTimer)
  }
  baseReloadTimer = setTimeout(() => {
    baseReloadTimer = null
    loadBaseData()
  }, delay)
}

function buildMaterialPayload() {
  const validProfiles = normalizeColorProfilesForSave(colorProfiles.value)
  const mergedSizeRows = isCupMaterial.value
    ? uniqueNonEmpty(validProfiles.flatMap((item) => (item.sizePrices || []).map((sizeItem) => sizeItem.size))).map((size) => {
      const matched = validProfiles.flatMap((item) => item.sizePrices || []).find((sizeItem) => normalizedText(sizeItem.size) === normalizedText(size)) || {}
      return { size, price: Number(matched.price || 0), unit: normalizeUnit(matched.unit || getDefaultRuleUnit()) }
    })
    : []

  return JSON.parse(JSON.stringify({
    id: form.id ? Number(form.id) : null,
    code: String(form.code || '').trim(),
    style_code: '',
    name: String(form.name || '').trim(),
    image_path: String(form.image_path || '').trim(),
    major_category: String(form.major_category || '').trim(),
    category: String(form.category || '').trim(),
    sub_category: String(form.sub_category || '').trim(),
    leaf_category: '',
    composition: String(form.composition || '').trim(),
    color: validProfiles[0]?.color || '',
    width: optionalNumber(form.width),
    weight: optionalNumber(form.weight),
    meter_per_kg: optionalNumber(form.meter_per_kg),
    adjustment_type: String(form.adjustment_type || 'none'),
    left_gap: Number(form.left_gap || 0),
    right_gap: Number(form.right_gap || 0),
    gap_reference_qty: optionalNumber(form.gap_reference_qty),
    gap_ratio: Number(form.gap_ratio || 0),
    custom_formula: String(form.custom_formula || ''),
    custom_conversion_from_qty: optionalNumber(form.custom_conversion_from_qty),
    custom_conversion_from_unit: normalizeUnit(form.custom_conversion_from_unit || ''),
    custom_conversion_to_qty: optionalNumber(form.custom_conversion_to_qty),
    custom_conversion_to_unit: normalizeUnit(form.custom_conversion_to_unit || ''),
    unit: normalizeUnit(form.unit),
    default_price: Number(form.default_price || 0),
    default_price_unit: normalizeUnit(form.default_price_unit || form.unit),
    size_price_json: JSON.stringify(mergedSizeRows),
    supplier: String(form.supplier || '').trim(),
    remark: String(form.remark || ''),
    color_profiles: validProfiles
  }))
}

async function save() {
  if (!String(form.code || '').trim()) return message.error('请填写原料编码')
  const payload = buildMaterialPayload()
  if (!payload.color_profiles.length) return message.error('请至少维护一个颜色档')
  try {
    if (form.id) await api.db.updateMaterial(payload)
    else await api.db.addMaterial(payload)
    message.success('原料资料已保存')
    visible.value = false
    ruleVisible.value = false
    scheduleBaseReload()
  } catch (error) {
    message.error(error.message || '保存原料资料失败')
  }
}

async function remove(id) {
  try {
    await api.db.deleteMaterial(id)
    message.success('原料资料已删除')
    scheduleBaseReload()
  } catch (error) {
    message.error(error.message || '删除原料失败')
  }
}

onMounted(loadBaseData)
watch(() => [form.category, form.sub_category, form.leaf_category], () => {
  if (!isCupMaterial.value) return
  colorProfiles.value.forEach((profile) => {
    if (!profile.sizePrices?.length) {
      profile.sizePrices = defaultCupSizes.map((size) => ({ localKey: `${Date.now()}-${Math.random()}`, size, price: 0, unit: getProfileRuleUnit(profile, form) }))
    }
    syncProfileSizeUnits(profile, form)
  })
})
watch(() => activeProfile.value?.default_price_unit, () => syncProfileSizeUnits(activeProfile.value, form))
watch([colorFillField, () => form.default_price_unit, () => form.unit], () => {
  if (colorFillField.value === 'default_price') { colorFillUnit.value = normalizeUnit(form.default_price_unit || form.unit || (isCupMaterial.value ? '对' : '公斤')); return }
  if (colorFillField.value === 'sample_price_meter' || colorFillField.value === 'net_price_meter' || colorFillField.value === 'bulk_price_meter') { colorFillUnit.value = '米'; return }
  if (colorFillField.value === 'sample_price_kg' || colorFillField.value === 'bulk_price_kg') { colorFillUnit.value = '公斤'; return }
  if (colorFillField.value === 'sample_price_yard' || colorFillField.value === 'bulk_price_yard') { colorFillUnit.value = '码'; return }
}, { immediate: true })
</script>

<style scoped>
.material-color-card { margin-bottom: 14px; }
.size-grid--compact { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
</style>

