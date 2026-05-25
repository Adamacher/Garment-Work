<template>
  <a-card class="content-card" :bordered="false">
    <PageSummaryStrip :items="summaryItems" />
    <template #title>单耗分析</template>

    <div class="toolbar">
      <div class="toolbar-left">
        <a-input v-model:value="keyword" placeholder="搜索款号 / 工厂 / 面料类型" allow-clear style="width: 320px" />
        <a-select v-model:value="warningFilter" :options="warningOptions" allow-clear placeholder="预警状态" style="width: 160px" />
      </div>
      <div class="toolbar-right">
        <a-button class="toolbar-refresh-btn" @click="loadList">刷新</a-button>
        <a-button type="primary" @click="openCreate">新增单耗记录</a-button>
      </div>
    </div>

    <div class="erp-table-caption">
      通过款号、工厂与面料类型快速查看预估单耗、实际单耗与偏差率，适合复盘异常批次并沉淀下次建议单耗。
    </div>

    <a-table class="erp-dense-table" :data-source="filteredList" :columns="columns" :pagination="{ pageSize: 12, showSizeChanger: true, pageSizeOptions: ['12', '24', '50'] }" :scroll="{ x: 1180 }" :row-key="(row) => row.id" size="small">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'fabric'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ record.fabric_type }}</div>
            <div class="table-secondary">克重 {{ record.gram_weight || '-' }} / 幅宽 {{ record.width || '-' }}</div>
          </div>
        </template>
        <template v-else-if="column.key === 'forecast'">
          <div class="table-stack table-stack--tight">
            <div class="table-secondary">版师单耗：{{ Number(record.pattern_consumption || 0).toFixed(4) }}</div>
            <div class="table-secondary">损耗率：{{ formatPercent(record.loss_rate) }}</div>
            <div class="table-primary">预估单耗：{{ Number(record.estimated_single_consumption || 0).toFixed(4) }}</div>
            <div class="table-secondary">建议下单：{{ Number(record.order_material_qty || 0).toFixed(2) }}</div>
          </div>
        </template>
        <template v-else-if="column.key === 'actual'">
          <div class="table-stack table-stack--tight">
            <div class="table-secondary">下单数量：{{ record.order_qty }}</div>
            <div class="table-secondary">实际产出：{{ record.actual_output_qty || '-' }}</div>
            <div class="table-secondary">实际用料：{{ record.actual_material_qty || '-' }}</div>
            <div class="table-primary">实际单耗：{{ record.actual_single_consumption ? Number(record.actual_single_consumption).toFixed(4) : '-' }}</div>
          </div>
        </template>
        <template v-else-if="column.key === 'warning'">
          <div class="table-stack table-stack--tight">
            <div class="table-secondary">偏差率：{{ record.actual_single_consumption ? formatPercent(record.deviation_rate) : '-' }}</div>
            <a-tag v-if="record.warning_level === 'warning'" color="red">异常</a-tag>
            <a-tag v-else-if="record.warning_level === 'normal'" color="green">正常</a-tag>
            <a-tag v-else>待录入实际</a-tag>
          </div>
        </template>
        <template v-else-if="column.key === 'suggestion'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ record.suggested_single_consumption ? Number(record.suggested_single_consumption).toFixed(4) : '-' }}</div>
            <div class="table-secondary">{{ record.suggestion_source_label || '-' }}</div>
          </div>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button size="small" @click="openEdit(record)">编辑</a-button>
            <a-popconfirm title="确认删除这条单耗记录？" @confirm="remove(record.id)">
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="visible" :title="form.id ? '编辑单耗记录' : '新增单耗记录'" width="980px" @ok="save">
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="8"><a-form-item label="款号" required><a-input v-model:value="form.style_code" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="工厂"><a-input v-model:value="form.factory_name" placeholder="用于工厂维度沉淀" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="面料类型" required><a-select v-model:value="form.fabric_type" :options="fabricTypeOptions" /></a-form-item></a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="8"><a-form-item label="克重"><a-input-number v-model:value="form.gram_weight" style="width: 100%" :min="0" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="幅宽"><a-input-number v-model:value="form.width" style="width: 100%" :min="0" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="版师单耗" required><a-input-number v-model:value="form.pattern_consumption" style="width: 100%" :min="0" :step="0.0001" /></a-form-item></a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="8"><a-form-item label="损耗率(%)"><a-input-number v-model:value="lossRatePercent" style="width: 100%" :min="0" :step="0.1" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="下单数量" required><a-input-number v-model:value="form.order_qty" style="width: 100%" :min="1" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="实际产出数量"><a-input-number v-model:value="form.actual_output_qty" style="width: 100%" :min="0" /></a-form-item></a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="8"><a-form-item label="实际用料"><a-input-number v-model:value="form.actual_material_qty" style="width: 100%" :min="0" :step="0.0001" /></a-form-item></a-col>
          <a-col :span="16"><a-form-item label="备注"><a-input v-model:value="form.remark" /></a-form-item></a-col>
        </a-row>
      </a-form>

      <a-alert type="info" show-icon style="margin-bottom: 16px;" :message="lossRateHint" />

      <div class="consumption-preview-grid">
        <a-card size="small" class="hint-card" :bordered="false">
          <div class="preview-title">预估阶段</div>
          <div>预估单耗：{{ preview.estimated }}</div>
          <div>建议下单用量：{{ preview.orderQty }}</div>
        </a-card>
        <a-card size="small" class="hint-card" :bordered="false">
          <div class="preview-title">实际阶段</div>
          <div>实际单耗：{{ preview.actual }}</div>
          <div>偏差率：{{ preview.deviation }}</div>
        </a-card>
        <a-card size="small" class="hint-card" :bordered="false">
          <div class="preview-title">系统判断</div>
          <div>{{ preview.warning }}</div>
          <div style="color: #8b6a49;">保存后系统会沉淀下次建议单耗</div>
        </a-card>
      </div>
    </a-modal>
  </a-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import PageSummaryStrip from '@/components/PageSummaryStrip.vue'
import { api, formatPercent, optionalNumber } from '@/utils/api'

const keyword = ref('')
const warningFilter = ref(undefined)
const visible = ref(false)
const list = ref([])

const fabricTypeOptions = [
  { label: '针织', value: '针织' },
  { label: '梭织', value: '梭织' }
]
const warningOptions = [
  { label: '红色预警', value: 'warning' },
  { label: '正常', value: 'normal' },
  { label: '待录入实际', value: 'pending' }
]
const columns = [
  { title: '款号', dataIndex: 'style_code', key: 'style_code', width: 140 },
  { title: '面料信息', key: 'fabric', width: 180 },
  { title: '预估', key: 'forecast', width: 220 },
  { title: '实际', key: 'actual', width: 220 },
  { title: '预警', key: 'warning', width: 140 },
  { title: '下次建议', key: 'suggestion', width: 140 },
  { title: '操作', key: 'action', width: 120 }
]

const form = reactive({
  id: null,
  style_code: '',
  factory_name: '',
  fabric_type: '针织',
  gram_weight: null,
  width: null,
  pattern_consumption: 0,
  loss_rate: 0.1,
  order_qty: 0,
  actual_output_qty: null,
  actual_material_qty: null,
  remark: ''
})

const filteredList = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return list.value.filter((item) => {
    if (warningFilter.value && item.warning_level !== warningFilter.value) return false
    if (!text) return true
    return [item.style_code, item.factory_name, item.fabric_type].some((field) => String(field || '').toLowerCase().includes(text))
  })
})

const summaryItems = computed(() => [
  { label: '记录数', value: `${filteredList.value.length} 条`, note: '按当前筛选范围统计' },
  { label: '红色预警', value: `${filteredList.value.filter((item) => item.warning_level === 'warning').length} 条`, note: '偏差率大于 5%' },
  { label: '正常记录', value: `${filteredList.value.filter((item) => item.warning_level === 'normal').length} 条`, note: '有实际数据且未超阈值' },
  { label: '待补实际', value: `${filteredList.value.filter((item) => item.warning_level === 'pending').length} 条`, note: '尚未录入实际产出或实际用料' }
])

const lossRatePercent = computed({
  get: () => Number(form.loss_rate || 0) * 100,
  set: (value) => {
    form.loss_rate = Number(value || 0) / 100
  }
})

const lossRateHint = computed(() => {
  const type = form.fabric_type === '梭织' ? '梭织' : '针织'
  return type === '针织'
    ? '针织面料常见损耗率区间为 8% ~ 12%，保存后系统会按当前填写值计算预估单耗和建议下单量。'
    : '梭织面料常见损耗率区间为 5% ~ 8%，保存后系统会按当前填写值计算预估单耗和建议下单量。'
})

const preview = computed(() => {
  const estimated = Number(form.pattern_consumption || 0) * (1 + Number(form.loss_rate || 0))
  const orderQty = estimated * Number(form.order_qty || 0) * 1.02
  const actual = Number(form.actual_output_qty || 0) > 0 && Number(form.actual_material_qty || 0) > 0
    ? Number(form.actual_material_qty || 0) / Number(form.actual_output_qty || 0)
    : null
  const deviation = actual && estimated ? (actual - estimated) / estimated : null
  return {
    estimated: estimated ? estimated.toFixed(4) : '0.0000',
    orderQty: orderQty ? orderQty.toFixed(2) : '0.00',
    actual: actual ? actual.toFixed(4) : '-',
    deviation: deviation !== null ? formatPercent(deviation) : '-',
    warning: deviation === null ? '待录入实际数据' : (deviation > 0.05 ? '异常（红色预警）' : '正常')
  }
})

function resetForm() {
  form.id = null
  form.style_code = ''
  form.factory_name = ''
  form.fabric_type = '针织'
  form.gram_weight = null
  form.width = null
  form.pattern_consumption = 0
  form.loss_rate = 0.1
  form.order_qty = 0
  form.actual_output_qty = null
  form.actual_material_qty = null
  form.remark = ''
}

async function loadList() {
  list.value = await api.db.getConsumptionRecords()
}

function openCreate() {
  resetForm()
  visible.value = true
}

function openEdit(record) {
  form.id = record.id
  form.style_code = record.style_code || ''
  form.factory_name = record.factory_name || ''
  form.fabric_type = record.fabric_type || '针织'
  form.gram_weight = optionalNumber(record.gram_weight)
  form.width = optionalNumber(record.width)
  form.pattern_consumption = Number(record.pattern_consumption || 0)
  form.loss_rate = Number(record.loss_rate || 0)
  form.order_qty = Number(record.order_qty || 0)
  form.actual_output_qty = optionalNumber(record.actual_output_qty)
  form.actual_material_qty = optionalNumber(record.actual_material_qty)
  form.remark = record.remark || ''
  visible.value = true
}

async function save() {
  try {
    await api.db.saveConsumptionRecord({
      ...form,
      gram_weight: optionalNumber(form.gram_weight),
      width: optionalNumber(form.width),
      actual_output_qty: optionalNumber(form.actual_output_qty),
      actual_material_qty: optionalNumber(form.actual_material_qty)
    })
    message.success(form.id ? '单耗记录已更新' : '单耗记录已保存')
    visible.value = false
    loadList()
  } catch (error) {
    message.error(error.message || '保存失败')
  }
}

async function remove(id) {
  try {
    await api.db.deleteConsumptionRecord(id)
    message.success('删除成功')
    loadList()
  } catch (error) {
    message.error(error.message || '删除失败')
  }
}

onMounted(loadList)
</script>
