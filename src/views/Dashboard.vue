<template>
  <div class="erp-page dashboard-workbench">
    <section class="smart-hero">
      <div>
        <div class="smart-hero__eyebrow">智能工作台</div>
        <h1>今天先处理最重要的事</h1>
        <p>系统会把待审核、库存预警、预领用异常和常用入口集中到这里，点击卡片即可跳转并自动筛选。</p>
      </div>
      <div class="smart-hero__actions">
        <a-button class="toolbar-refresh-btn" :loading="pageRefreshing" @click="refreshPage">刷新工作台</a-button>
        <a-button type="primary" @click="chooseWorkspaceDirectory">更改当前工作目录</a-button>
      </div>
    </section>

    <div class="page-summary-strip stats-grid-extended">
      <button
        v-for="item in summaryItems"
        :key="item.key"
        type="button"
        class="page-summary-strip__item smart-stat-card"
        @click="goWorkbench(item.route)"
      >
        <div class="page-summary-strip__label">{{ item.label }}</div>
        <div class="page-summary-strip__value">{{ item.value }}</div>
        <div class="page-summary-strip__note">{{ item.note }}</div>
      </button>
    </div>

    <div class="workbench-grid">
      <a-card class="content-card smart-panel" :bordered="false">
        <template #title>智能待办</template>
        <div v-if="smartLoading" class="smart-skeleton">
          <a-skeleton active :paragraph="{ rows: 4 }" />
        </div>
        <div v-else class="smart-task-grid">
          <button
            v-for="card in smartCards"
            :key="card.key"
            type="button"
            :class="['smart-task-card', `smart-task-card--${card.tone}`]"
            @click="goWorkbench(card.route)"
          >
            <div class="smart-task-card__top">
              <span>{{ card.label }}</span>
              <a-tag :color="card.tagColor">{{ card.tag }}</a-tag>
            </div>
            <strong>{{ card.value }}</strong>
            <p>{{ card.note }}</p>
          </button>
        </div>
      </a-card>

      <a-card class="content-card smart-panel" :bordered="false">
        <template #title>快速动作</template>
        <div class="quick-action-grid">
          <a-button type="primary" @click="goWorkbench({ path: '/purchase', query: { action: 'create' } })">新增采购批次</a-button>
          <a-button type="primary" @click="goWorkbench({ path: '/production', query: { action: 'create' } })">新增生产单</a-button>
          <a-button @click="goWorkbench({ path: '/inventory', query: { stock_scope: 'warning' } })">查看库存预警</a-button>
          <a-button @click="goWorkbench({ path: '/factory-dispatch', query: { stock_scope: 'warehouse' } })">查看仓库库存</a-button>
        </div>
        <div class="smart-tip-box">
          <div class="smart-tip-box__title">智能提示</div>
          <div v-for="tip in smartTips" :key="tip" class="smart-tip-box__line">{{ tip }}</div>
        </div>
      </a-card>
    </div>

    <div class="workbench-grid workbench-grid--bottom">
      <a-card class="content-card" :bordered="false">
        <template #title>工作目录与备份</template>
        <div class="dashboard-actions dashboard-actions--compact">
          <a-button type="primary" @click="chooseWorkspaceDirectory">更改当前工作目录</a-button>
          <a-button @click="syncLocalDatabaseBackup">同步程序根目录备份</a-button>
          <a-button @click="exportDatabaseFile">导出完整数据库</a-button>
          <a-button @click="importDatabaseFile">从数据库文件恢复</a-button>
          <a-button :loading="workspaceInfo.storage_optimization_running" @click="optimizeStorage">
            {{ workspaceInfo.storage_optimization_running ? '数据库瘦身中' : '数据库瘦身' }}
          </a-button>
          <a-button :loading="autoLaunchLoading" :disabled="!autoLaunchSupported" @click="toggleAutoLaunch">
            {{ autoLaunch ? '关闭开机自启' : '开启开机自启' }}
          </a-button>
          <a-button @click="applyPatchPackage">导入补丁包升级</a-button>
        </div>

        <a-descriptions :column="1" bordered size="small" class="workspace-desc">
          <a-descriptions-item label="当前版本">{{ currentVersion }}</a-descriptions-item>
          <a-descriptions-item label="当前工作目录">{{ workspaceInfo.workspace_path || '加载中...' }}</a-descriptions-item>
          <a-descriptions-item label="当前数据库文件">{{ workspaceInfo.database_path || '-' }}</a-descriptions-item>
          <a-descriptions-item label="数据库大小">{{ workspaceInfo.file_size ? formatFileSize(workspaceInfo.file_size) : '-' }}</a-descriptions-item>
          <a-descriptions-item label="每日自动备份">
            {{ workspaceInfo.daily_backup_exists ? '今天已生成' : '今天尚未生成' }}
            <span v-if="workspaceInfo.daily_backup_updated_at">，最近更新：{{ workspaceInfo.daily_backup_updated_at }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="数据库瘦身">
            {{ workspaceInfo.storage_optimization_stage || '未开始' }}
            <span v-if="workspaceInfo.storage_optimization_running">，进度：{{ workspaceInfo.storage_optimization_progress_percent }}%</span>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <a-card class="content-card" :bordered="false">
        <template #title>使用说明</template>
        <div class="formula-box">
          <div>1. 工作台卡片可以直接跳转到对应页面，并自动带入筛选条件。</div>
          <div>2. 未审核生产单会形成预领用提示，审核后才会真正影响库存。</div>
          <div>3. 更换电脑或迁移数据时，优先导出完整数据库，再在新电脑恢复。</div>
          <div>4. 大量图片和表格会延迟加载，列表页只渲染当前分页，减少卡顿。</div>
        </div>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { api, formatMoney } from '@/utils/api'

const router = useRouter()

const stats = reactive({
  materialsCount: 0,
  garmentsCount: 0,
  batchesCount: 0,
  productionCount: 0,
  consumptionCount: 0,
  warningCount: 0,
  stockValue: 0,
})

const workspaceInfo = reactive({
  workspace_path: '',
  database_path: '',
  file_size: 0,
  daily_backup_exists: false,
  daily_backup_updated_at: '',
  storage_optimization_running: false,
  storage_optimization_stage: '',
  storage_optimization_progress_percent: 0,
})

const currentVersion = ref('-')
const pageRefreshing = ref(false)
const smartLoading = ref(false)
const autoLaunch = ref(false)
const autoLaunchSupported = ref(false)
const autoLaunchLoading = ref(false)
const purchaseSnapshot = ref([])
const productionSnapshot = ref([])
const inventorySnapshot = ref({ materials: [], batches: [] })
let optimizeStatusTimer = null

const summaryItems = computed(() => [
  { key: 'materials', label: '物料档案', value: stats.materialsCount, note: '点击进入物料资料', route: { path: '/material' } },
  { key: 'garments', label: '成衣款数', value: stats.garmentsCount, note: '点击进入成衣管理', route: { path: '/style' } },
  { key: 'batches', label: '采购批次', value: stats.batchesCount, note: '点击查看采购单', route: { path: '/purchase' } },
  { key: 'production', label: '生产制单', value: stats.productionCount, note: '点击查看生产单', route: { path: '/production' } },
  { key: '红色预警', label: '红色预警', value: stats.warningCount, note: '异常和预警汇总', route: { path: '/production', query: { only_warnings: '1' } } },
  { key: 'stockValue', label: '库存货值', value: formatMoney(stats.stockValue), note: '按库存均价计算', route: { path: '/inventory' } },
])

const pendingPurchases = computed(() => purchaseSnapshot.value.filter((item) => String(item.document_status || 'draft') === 'submitted'))
const pendingProductions = computed(() => productionSnapshot.value.filter((item) => String(item.document_status || 'draft') === 'submitted'))
const inventoryWarnings = computed(() =>
  (inventorySnapshot.value.materials || []).filter((item) =>
    Number(item.available_after_prealloc_qty ?? item.current_stock_qty ?? 0) < -0.0001 ||
    Number(item.factory_available_after_prealloc_qty ?? 0) < -0.0001 ||
    Number(item.current_stock_qty ?? 0) < 0.0001
  )
)
const preallocWarnings = computed(() =>
  (inventorySnapshot.value.materials || []).filter((item) => Number(item.pre_allocated_qty || 0) > 0 && Number(item.available_after_prealloc_qty || 0) < -0.0001)
)

const smartCards = computed(() => [
  {
    key: 'purchase-review',
    label: '待审核采购',
    value: `${pendingPurchases.value.length} 张`,
    note: '需要补图片、审核或退回草稿的采购单',
    tag: '采购',
    tagColor: 'blue',
    tone: pendingPurchases.value.length ? 'info' : 'safe',
    route: { path: '/purchase', query: { document_status: 'submitted' } }
  },
  {
    key: 'production-review',
    label: '待审核生产',
    value: `${pendingProductions.value.length} 张`,
    note: '进入审核后才会正式扣减库存',
    tag: '生产',
    tagColor: 'cyan',
    tone: pendingProductions.value.length ? 'info' : 'safe',
    route: { path: '/production', query: { document_status: 'submitted' } }
  },
  {
    key: 'inventory-warning',
    label: '库存预警',
    value: `${inventoryWarnings.value.length} 项`,
    note: '含负库存、零库存和预领后不足',
    tag: '库存',
    tagColor: inventoryWarnings.value.length ? 'red' : 'green',
    tone: inventoryWarnings.value.length ? 'danger' : 'safe',
    route: { path: '/inventory', query: { stock_scope: 'warning' } }
  },
  {
    key: 'prealloc-warning',
    label: '预领用异常',
    value: `${preallocWarnings.value.length} 项`,
    note: '未审核生产单占用后可用量不足',
    tag: '预领',
    tagColor: preallocWarnings.value.length ? 'orange' : 'green',
    tone: preallocWarnings.value.length ? 'warning' : 'safe',
    route: { path: '/inventory', query: { stock_scope: 'prealloc_warning' } }
  }
])

const smartTips = computed(() => {
  const tips = []
  if (pendingPurchases.value.length) tips.push(`有 ${pendingPurchases.value.length} 张采购单待审核，建议先确认图片和金额。`)
  if (pendingProductions.value.length) tips.push(`有 ${pendingProductions.value.length} 张生产单待审核，审核前请查看库存校验摘要。`)
  if (inventoryWarnings.value.length) tips.push(`有 ${inventoryWarnings.value.length} 项库存需要关注，点击库存预警可直接筛选。`)
  if (!tips.length) tips.push('当前没有明显待办，库存与审核状态整体平稳。')
  return tips
})

function formatFileSize(bytes) {
  const size = Number(bytes || 0)
  if (!size) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function loadStats() {
  Object.assign(stats, await api.db.getDashboardStats())
}

async function loadVersion() {
  try {
    const result = await api.app.getVersion()
    currentVersion.value = result?.version || '-'
  } catch {
    currentVersion.value = '-'
  }
}

async function loadSmartData() {
  smartLoading.value = true
  try {
    const [purchaseResult, productionResult, inventoryResult] = await Promise.allSettled([
      api.db.getPurchaseBatches({}),
      api.db.getProductionOrders({}),
      api.db.getInventorySummary()
    ])
    purchaseSnapshot.value = Array.isArray(purchaseResult.value) ? purchaseResult.value : []
    productionSnapshot.value = Array.isArray(productionResult.value) ? productionResult.value : []
    inventorySnapshot.value = inventoryResult.value || { materials: [], batches: [] }
  } finally {
    smartLoading.value = false
  }
}

async function loadWorkspaceInfo() {
  Object.assign(workspaceInfo, await api.db.getWorkspaceInfo())
  if (workspaceInfo.storage_optimization_running) startOptimizeStatusPolling()
  else stopOptimizeStatusPolling()
}

async function loadAutoLaunch() {
  try {
    const result = await api.app.getAutoLaunchSettings?.()
    autoLaunchSupported.value = !!result?.supported
    autoLaunch.value = !!result?.enabled
  } catch {
    autoLaunchSupported.value = false
    autoLaunch.value = false
  }
}

function stopOptimizeStatusPolling() {
  if (!optimizeStatusTimer) return
  clearInterval(optimizeStatusTimer)
  optimizeStatusTimer = null
}

function startOptimizeStatusPolling() {
  if (optimizeStatusTimer) return
  optimizeStatusTimer = setInterval(async () => {
    try {
      const result = await api.db.getOptimizeStorageStatus?.()
      if (result?.workspace_info) Object.assign(workspaceInfo, result.workspace_info)
      else if (result) Object.assign(workspaceInfo, result)
      if (!workspaceInfo.storage_optimization_running) stopOptimizeStatusPolling()
    } catch {
      stopOptimizeStatusPolling()
    }
  }, 1500)
}

async function loadSecondaryInfo() {
  try {
    await Promise.all([loadWorkspaceInfo(), loadAutoLaunch()])
  } catch {
    // 低优先级信息失败时，不阻塞智能工作台。
  }
}

function goWorkbench(target) {
  if (!target?.path) return
  router.push(target)
}

async function chooseWorkspaceDirectory() {
  try {
    const result = await api.db.chooseWorkspaceDirectory()
    if (result) message.success(result.message || '已更改当前工作目录，程序即将重启')
  } catch (error) {
    message.error(error.message || '更改当前工作目录失败')
  }
}

async function syncLocalDatabaseBackup() {
  try {
    const result = await api.db.syncLocalDatabaseBackup()
    const backupPath = result?.backup_path || result?.filePath
    message.success(backupPath ? `本地备份已同步到：${backupPath}` : '本地备份已同步')
    await loadWorkspaceInfo()
  } catch (error) {
    message.error(error.message || '同步本地备份失败')
  }
}

async function optimizeStorage() {
  try {
    const result = await api.db.optimizeStorage()
    await loadWorkspaceInfo()
    if (result?.running) {
      startOptimizeStatusPolling()
      message.success('数据库瘦身已转入后台，可以继续操作软件')
      return
    }
    message.success(`数据库瘦身完成：${formatFileSize(result?.before_size)} -> ${formatFileSize(result?.after_size)}`)
  } catch (error) {
    message.error(error.message || '数据库瘦身失败')
  }
}

async function toggleAutoLaunch() {
  if (!autoLaunchSupported.value) {
    message.error('当前系统环境不支持开机自启设置')
    return
  }
  autoLaunchLoading.value = true
  try {
    const result = await api.app.setAutoLaunchEnabled?.(!autoLaunch.value)
    autoLaunchSupported.value = !!result?.supported
    autoLaunch.value = !!result?.enabled
    message.success(autoLaunch.value ? '已开启开机自启' : '已关闭开机自启')
  } catch (error) {
    message.error(error.message || '设置开机自启失败')
  } finally {
    autoLaunchLoading.value = false
  }
}

async function exportDatabaseFile() {
  try {
    const result = await api.db.exportDatabaseFile?.()
    if (result) message.success('完整数据库文件已导出')
  } catch (error) {
    message.error(error.message || '导出数据库失败')
  }
}

async function importDatabaseFile() {
  try {
    const result = await api.db.importDatabaseFile?.()
    if (result) message.success('数据库已恢复，程序即将重启')
  } catch (error) {
    message.error(error.message || '恢复数据库失败')
  }
}

async function applyPatchPackage() {
  try {
    const result = await api.app.applyPatchPackage?.()
    if (result) message.success(`补丁已开始应用，程序将自动重启到 ${result.version}`)
  } catch (error) {
    message.error(error.message || '应用补丁失败')
  }
}

async function refreshPage() {
  pageRefreshing.value = true
  try {
    await Promise.all([loadStats(), loadSmartData(), loadVersion()])
    loadSecondaryInfo()
    message.success('已刷新')
  } catch (error) {
    message.error(error.message || '刷新首页失败')
  } finally {
    pageRefreshing.value = false
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadStats(), loadVersion(), loadSmartData()])
    window.setTimeout(loadSecondaryInfo, 80)
  } catch (error) {
    message.error(error.message || '加载经营总览失败')
  }
})

onUnmounted(() => {
  stopOptimizeStatusPolling()
})
</script>

<style scoped>
.dashboard-workbench {
  display: grid;
  gap: 18px;
}

.smart-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 24px;
  border: 1px solid rgba(154, 190, 255, 0.38);
  border-radius: 28px;
  background:
    radial-gradient(circle at 8% 0%, rgba(0, 122, 255, 0.16), transparent 30%),
    linear-gradient(135deg, #ffffff 0%, #f3f9ff 100%);
}

.smart-hero__eyebrow {
  margin-bottom: 6px;
  color: #007aff;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.smart-hero h1 {
  margin: 0;
  color: #10233f;
  font-size: 30px;
  line-height: 1.2;
}

.smart-hero p {
  max-width: 760px;
  margin: 8px 0 0;
  color: #5b6b80;
  line-height: 1.7;
}

.smart-hero__actions,
.dashboard-actions--compact {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.smart-stat-card {
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.workbench-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
  gap: 18px;
}

.workbench-grid--bottom {
  align-items: start;
}

.smart-task-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.smart-task-card {
  min-height: 148px;
  padding: 16px;
  border: 1px solid #dce9fb;
  border-radius: 20px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease;
}

.smart-task-card:hover {
  transform: translateY(-2px);
  border-color: #99c7ff;
}

.smart-task-card--danger {
  background: linear-gradient(180deg, #fff8f8 0%, #fff 100%);
}

.smart-task-card--warning {
  background: linear-gradient(180deg, #fffaf0 0%, #fff 100%);
}

.smart-task-card--safe {
  background: linear-gradient(180deg, #f4fff9 0%, #fff 100%);
}

.smart-task-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #536982;
  font-weight: 700;
}

.smart-task-card strong {
  display: block;
  margin-top: 14px;
  color: #10233f;
  font-size: 30px;
}

.smart-task-card p {
  margin: 8px 0 0;
  color: #6a7d96;
  line-height: 1.55;
}

.quick-action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.smart-tip-box {
  margin-top: 14px;
  padding: 14px;
  border-radius: 18px;
  background: #f4f9ff;
  border: 1px solid #dce9fb;
}

.smart-tip-box__title {
  margin-bottom: 8px;
  color: #143255;
  font-weight: 800;
}

.smart-tip-box__line {
  color: #5b6b80;
  line-height: 1.7;
}

.workspace-desc {
  margin-top: 16px;
}

@media (max-width: 1100px) {
  .smart-hero,
  .workbench-grid {
    grid-template-columns: 1fr;
  }

  .smart-hero {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 760px) {
  .smart-task-grid,
  .quick-action-grid {
    grid-template-columns: 1fr;
  }
}
</style>
