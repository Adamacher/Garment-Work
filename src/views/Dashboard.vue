<template>
  <div class="erp-page dashboard-workbench">
    <section class="smart-hero">
      <div>
        <div class="smart-hero__eyebrow">智能工作台</div>
        <h1>今天先处理最重要的事</h1>
        <p>系统会把待审核、预领用异常和常用入口集中到这里，点击卡片即可跳转并自动筛选。</p>
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
        <AppIcon :name="item.icon" class="smart-stat-card__icon" />
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
              <span class="smart-task-card__title">
                <AppIcon :name="card.icon" class="smart-task-card__icon" />
                {{ card.label }}
              </span>
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
          <a-button type="primary" @click="goWorkbench({ path: '/purchase', query: { action: 'create' } })">
            <AppIcon name="purchase" class="quick-action-icon" />
            新增采购批次
          </a-button>
          <a-button type="primary" @click="goWorkbench({ path: '/production', query: { action: 'create' } })">
            <AppIcon name="production" class="quick-action-icon" />
            新增生产单
          </a-button>
          <a-button @click="goWorkbench({ path: '/factory-dispatch', query: { stock_scope: 'warehouse' } })">
            <AppIcon name="inventory" class="quick-action-icon" />
            查看仓库库存
          </a-button>
          <a-button @click="goWorkbench({ path: '/purchase', query: { document_status: 'approved', q: '换货' } })">
            <AppIcon name="purchase" class="quick-action-icon" />
            查看退换记录
          </a-button>
          <a-button @click="goWorkbench({ path: '/factory-dispatch', query: { stock_scope: 'factory' } })">
            <AppIcon name="dispatch" class="quick-action-icon" />
            工厂退换处理
          </a-button>
          <a-button @click="goWorkbench({ path: '/dashboard', query: { section: 'tailscale' } })">
            <AppIcon name="link" class="quick-action-icon" />
            连接远程数据库
          </a-button>
        </div>
        <div class="smart-tip-box">
          <div class="smart-tip-box__title">智能提示</div>
          <div v-for="tip in smartTips" :key="tip" class="smart-tip-box__line">{{ tip }}</div>
        </div>
      </a-card>
    </div>

    <div class="workbench-grid workbench-grid--bottom">
      <a-card class="content-card workspace-panel" :bordered="false">
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

        <div class="workspace-info-grid">
          <div class="workspace-info-card">
            <span>当前版本</span>
            <strong>{{ currentVersion }}</strong>
          </div>
          <div class="workspace-info-card workspace-info-card--wide">
            <span>当前工作目录</span>
            <strong>{{ workspaceInfo.workspace_path || '加载中...' }}</strong>
          </div>
          <div class="workspace-info-card workspace-info-card--wide">
            <span>当前数据库文件</span>
            <strong>{{ workspaceInfo.database_path || '-' }}</strong>
          </div>
          <div class="workspace-info-card">
            <span>数据库大小</span>
            <strong>{{ workspaceInfo.file_size ? formatFileSize(workspaceInfo.file_size) : '-' }}</strong>
          </div>
          <div class="workspace-info-card">
            <span>每日自动备份</span>
            <strong>
              {{ workspaceInfo.daily_backup_exists ? '今天已生成' : '今天尚未生成' }}
              <small v-if="workspaceInfo.daily_backup_updated_at">{{ workspaceInfo.daily_backup_updated_at }}</small>
            </strong>
          </div>
          <div class="workspace-info-card">
            <span>数据库瘦身</span>
            <strong>
              {{ workspaceInfo.storage_optimization_stage || '未开始' }}
              <small v-if="workspaceInfo.storage_optimization_running">进度 {{ workspaceInfo.storage_optimization_progress_percent }}%</small>
            </strong>
          </div>
        </div>
      </a-card>

      <a-card class="content-card remote-share-panel" :bordered="false">
        <template #title>Tailscale 远程共享数据库</template>
        <div class="dashboard-share-status">
          <div class="dashboard-share-card">
            <div class="dashboard-share-title">共享服务</div>
            <div :class="['dashboard-share-value', lanConfig.runtime?.running ? 'is-on' : 'is-off']">
              {{ lanConfig.runtime?.running ? '已开启' : '未开启' }}
            </div>
            <div class="dashboard-share-desc">
              {{ lanConfig.runtime?.message || '本机可作为主机，把数据库通过 Tailscale 提供给其他电脑。' }}
            </div>
          </div>
          <div class="dashboard-share-card">
            <div class="dashboard-share-title">Tailscale 地址</div>
            <div class="dashboard-share-copy">{{ tailscaleShareHost || '未检测到 Tailscale 地址' }}</div>
            <div class="dashboard-share-desc">
              主机电脑需要先打开 Tailscale，并保持本软件运行。
            </div>
          </div>
          <div class="dashboard-share-card">
            <div class="dashboard-share-title">当前连接</div>
            <div :class="['dashboard-share-value', lanConfig.prefer_remote ? 'is-on' : '']">
              {{ lanConfig.prefer_remote ? '远程数据库' : '本机数据库' }}
            </div>
            <div class="dashboard-share-desc">
              {{ lanConfig.prefer_remote ? `正在连接：${lanConfig.host || '-'}` : '当前操作使用本机工作目录里的数据库。' }}
            </div>
          </div>
        </div>

        <div class="remote-share-actions">
          <a-button type="primary" :loading="lanLoading === 'host'" @click="enableTailscaleHost">
            本机作为主机共享
          </a-button>
          <a-button :disabled="!tailscaleShareHost" @click="copyTailscaleHost">复制 Tailscale 地址</a-button>
          <a-button :loading="lanLoading === 'stop'" @click="stopTailscaleHost">关闭本机共享</a-button>
        </div>

        <div class="remote-connect-row">
          <a-input
            v-model:value="remoteHostInput"
            allow-clear
            placeholder="在其他电脑填写主机地址，例如：http://100.x.x.x:18680"
          />
          <a-button type="primary" :loading="lanLoading === 'connect'" @click="connectRemoteHost">
            连接远程数据库
          </a-button>
          <a-button :loading="lanLoading === 'local'" @click="useLocalDatabase">切回本机数据库</a-button>
        </div>

        <div class="formula-box remote-share-tip">
          主机电脑点击“本机作为主机共享”，其他电脑复制或填写主机的 Tailscale 地址后点击“连接远程数据库”。这不是旧的局域网共享目录，不需要映射网络盘。
        </div>
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
import AppIcon from '@/components/AppIcon.vue'
import { api, checkRemoteHostHealth, formatMoney, normalizeRemoteHost } from '@/utils/api'

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

const lanConfig = reactive({
  enabled: false,
  port: 18680,
  host: '',
  host_computer_name: '',
  prefer_remote: false,
  is_host: false,
  network: {
    preferred_host: '',
    tailscale_host: '',
    tailscale_ip: '',
    local_hosts: [],
  },
  runtime: {
    running: false,
    port: 0,
    host: '',
    message: '',
  },
})

const currentVersion = ref('-')
const pageRefreshing = ref(false)
const smartLoading = ref(false)
const autoLaunch = ref(false)
const autoLaunchSupported = ref(false)
const autoLaunchLoading = ref(false)
const lanLoading = ref('')
const remoteHostInput = ref('')
const purchaseSnapshot = ref([])
const productionSnapshot = ref([])
const inventorySnapshot = ref({ materials: [], batches: [] })
let optimizeStatusTimer = null

const tailscaleShareHost = computed(() =>
  lanConfig.network?.tailscale_host || lanConfig.host || lanConfig.network?.preferred_host || ''
)

const summaryItems = computed(() => [
  { key: 'materials', icon: 'material', label: '物料档案', value: stats.materialsCount, note: '点击进入物料资料', route: { path: '/material' } },
  { key: 'garments', icon: 'style', label: '成衣款数', value: stats.garmentsCount, note: '点击进入成衣管理', route: { path: '/style' } },
  { key: 'batches', icon: 'purchase', label: '采购批次', value: stats.batchesCount, note: '点击查看采购单', route: { path: '/purchase' } },
  { key: 'production', icon: 'production', label: '生产制单', value: stats.productionCount, note: '点击查看生产单', route: { path: '/production' } },
  { key: 'stockValue', icon: 'value', label: '库存货值', value: formatMoney(stats.stockValue), note: '按库存均价计算', route: { path: '/inventory' } },
])

const pendingPurchases = computed(() => purchaseSnapshot.value.filter((item) => String(item.document_status || 'draft') === 'submitted'))
const pendingProductions = computed(() => productionSnapshot.value.filter((item) => String(item.document_status || 'draft') === 'submitted'))
const preallocWarnings = computed(() =>
  (inventorySnapshot.value.materials || []).filter((item) => Number(item.pre_allocated_qty || 0) > 0 && Number(item.available_after_prealloc_qty || 0) < -0.0001)
)
const factoryShortages = computed(() =>
  (inventorySnapshot.value.materials || []).filter((item) =>
    Number(item.factory_available_after_prealloc_qty ?? item.factory_remaining_qty ?? 0) < -0.0001
  )
)
const supplierExchanges = computed(() =>
  purchaseSnapshot.value.filter((item) =>
    Number(item.after_sale_out_qty || 0) > 0
      || Number(item.after_sale_in_ref_count || 0) > 0
      || String(item.remark || '').includes('换货')
  )
)
const costAbnormalProductions = computed(() =>
  productionSnapshot.value.filter((item) => {
    const materialCost = Number(item.material_cost || item.total_material_cost || 0)
    const processingCost = Number(item.processing_cost || item.total_processing_cost || 0)
    const unitCost = Number(item.unit_cost || item.actual_unit_cost || 0)
    return unitCost < 0 || materialCost < 0 || processingCost < 0 || Number(item.loss_rate || 0) > 30
  })
)

const smartCards = computed(() => [
  {
    key: 'purchase-review',
    icon: 'purchase',
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
    icon: 'production',
    label: '待审核生产',
    value: `${pendingProductions.value.length} 张`,
    note: '进入审核后才会正式扣减库存',
    tag: '生产',
    tagColor: 'cyan',
    tone: pendingProductions.value.length ? 'info' : 'safe',
    route: { path: '/production', query: { document_status: 'submitted' } }
  },
  {
    key: 'prealloc-warning',
    icon: 'warning',
    label: '预领用异常',
    value: `${preallocWarnings.value.length} 项`,
    note: '未审核生产单占用后可用量不足',
    tag: '预领',
    tagColor: preallocWarnings.value.length ? 'orange' : 'green',
    tone: preallocWarnings.value.length ? 'warning' : 'safe',
    route: { path: '/inventory', query: { stock_scope: 'prealloc_warning' } }
  },
  {
    key: 'factory-shortage',
    icon: 'dispatch',
    label: '工厂缺料',
    value: `${factoryShortages.value.length} 项`,
    note: '工厂预领后不足，需要补调或核实库存',
    tag: '工厂',
    tagColor: factoryShortages.value.length ? 'red' : 'green',
    tone: factoryShortages.value.length ? 'danger' : 'safe',
    route: { path: '/inventory', query: { stock_scope: 'prealloc_warning' } }
  },
  {
    key: 'supplier-exchange',
    icon: 'purchase',
    label: '供应商退换',
    value: `${supplierExchanges.value.length} 单`,
    note: '已登记退货、换货或补回入库记录',
    tag: '退换',
    tagColor: supplierExchanges.value.length ? 'purple' : 'default',
    tone: supplierExchanges.value.length ? 'info' : 'safe',
    route: { path: '/purchase', query: { document_status: 'approved', q: '换货' } }
  },
  {
    key: 'cost-abnormal',
    icon: 'value',
    label: '成本异常',
    value: `${costAbnormalProductions.value.length} 项`,
    note: '损耗率或成本字段异常，需要复核制单',
    tag: '成本',
    tagColor: costAbnormalProductions.value.length ? 'orange' : 'green',
    tone: costAbnormalProductions.value.length ? 'warning' : 'safe',
    route: { path: '/production', query: { only_warnings: '1' } }
  }
])

const smartTips = computed(() => {
  const tips = []
  if (pendingPurchases.value.length) tips.push(`有 ${pendingPurchases.value.length} 张采购单待审核，建议先确认图片和金额。`)
  if (pendingProductions.value.length) tips.push(`有 ${pendingProductions.value.length} 张生产单待审核，审核前请查看库存校验摘要。`)
  if (factoryShortages.value.length) tips.push(`有 ${factoryShortages.value.length} 项工厂缺料，请优先看库存详情或从仓库补调。`)
  if (supplierExchanges.value.length) tips.push(`有 ${supplierExchanges.value.length} 单退换记录，建议核对换入批次是否已入库。`)
  if (costAbnormalProductions.value.length) tips.push(`有 ${costAbnormalProductions.value.length} 项成本异常，建议复核实际总金额和加工费。`)
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
    const inventory = inventoryResult.value && typeof inventoryResult.value === 'object' ? inventoryResult.value : {}
    inventorySnapshot.value = {
      materials: Array.isArray(inventory.materials) ? inventory.materials : [],
      batches: Array.isArray(inventory.batches) ? inventory.batches : [],
      inTransit: Array.isArray(inventory.inTransit) ? inventory.inTransit : []
    }
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

async function loadLanConfig() {
  try {
    const result = await api.lan.getConfig()
    Object.assign(lanConfig, result || {})
    if (!remoteHostInput.value) {
      remoteHostInput.value = result?.host || result?.network?.tailscale_host || result?.network?.preferred_host || ''
    }
  } catch {
    // 远程共享状态不影响首页其他功能。
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
    await Promise.all([loadWorkspaceInfo(), loadAutoLaunch(), loadLanConfig()])
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

async function enableTailscaleHost() {
  lanLoading.value = 'host'
  try {
    await api.db.setCurrentComputerAsHost?.()
    const latest = await api.lan.getConfig()
    const host = latest?.network?.tailscale_host || latest?.network?.preferred_host || latest?.host
    const result = await api.lan.updateConfig({
      enabled: true,
      port: Number(latest?.port || 18680),
      host,
      prefer_remote: false,
    })
    Object.assign(lanConfig, result || {})
    remoteHostInput.value = result?.network?.tailscale_host || result?.host || host || ''
    message.success('Tailscale 远程共享数据库已开启，其他电脑可使用显示的地址连接')
  } catch (error) {
    message.error(error.message || '开启 Tailscale 远程共享失败')
  } finally {
    lanLoading.value = ''
  }
}

async function stopTailscaleHost() {
  lanLoading.value = 'stop'
  try {
    const result = await api.lan.updateConfig({ enabled: false, prefer_remote: false })
    Object.assign(lanConfig, result || {})
    message.success('已关闭本机远程共享服务')
  } catch (error) {
    message.error(error.message || '关闭远程共享失败')
  } finally {
    lanLoading.value = ''
  }
}

async function connectRemoteHost() {
  const host = normalizeRemoteHost(remoteHostInput.value)
  if (!host) {
    message.error('请填写主机的 Tailscale 地址，例如：http://100.x.x.x:18680')
    return
  }
  lanLoading.value = 'connect'
  try {
    await checkRemoteHostHealth(host)
    const result = await api.lan.updateConfig({
      enabled: false,
      host,
      prefer_remote: true,
      host_computer_name: '',
    })
    Object.assign(lanConfig, result || {})
    remoteHostInput.value = host
    await Promise.all([loadStats(), loadSmartData(), loadWorkspaceInfo()])
    message.success('已连接远程共享数据库')
  } catch (error) {
    message.error(error.message || '连接远程数据库失败')
  } finally {
    lanLoading.value = ''
  }
}

async function useLocalDatabase() {
  lanLoading.value = 'local'
  try {
    const result = await api.lan.updateConfig({ prefer_remote: false })
    Object.assign(lanConfig, result || {})
    await Promise.all([loadStats(), loadSmartData(), loadWorkspaceInfo()])
    message.success('已切回本机数据库')
  } catch (error) {
    message.error(error.message || '切回本机数据库失败')
  } finally {
    lanLoading.value = ''
  }
}

async function copyTailscaleHost() {
  const host = tailscaleShareHost.value
  if (!host) {
    message.error('当前没有可复制的 Tailscale 地址')
    return
  }
  try {
    await navigator.clipboard.writeText(host)
    message.success('Tailscale 地址已复制')
  } catch {
    message.error(`复制失败，请手动复制：${host}`)
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

.smart-stat-card__icon,
.smart-task-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 13px;
  background: linear-gradient(135deg, rgba(47, 125, 255, 0.16), rgba(90, 200, 250, 0.12));
  color: #1677ff;
}

.smart-stat-card__icon {
  margin-bottom: 10px;
}

.smart-stat-card__icon :deep(svg),
.smart-task-card__icon :deep(svg),
.quick-action-icon :deep(svg) {
  width: 19px;
  height: 19px;
  display: block;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.workbench-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
  gap: 18px;
}

.workbench-grid--bottom {
  align-items: start;
  grid-template-columns: 1fr;
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

.smart-task-card__title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
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

.quick-action-grid :deep(.ant-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.quick-action-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
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

.workspace-panel :deep(.ant-card-body) {
  display: grid;
  gap: 14px;
}

.workspace-info-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.workspace-info-card {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid #dce9fb;
  border-radius: 18px;
  background: linear-gradient(180deg, #ffffff 0%, #f6fbff 100%);
}

.workspace-info-card--wide {
  grid-column: span 3;
}

.workspace-info-card span {
  display: block;
  margin-bottom: 6px;
  color: #6b7f98;
  font-size: 12px;
  font-weight: 800;
}

.workspace-info-card strong {
  display: block;
  color: #132946;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.55;
  word-break: break-all;
}

.workspace-info-card small {
  display: block;
  margin-top: 3px;
  color: #7287a0;
  font-size: 12px;
  font-weight: 600;
}

.workspace-desc {
  margin-top: 16px;
}

.remote-share-panel {
  overflow: hidden;
}

.remote-share-actions,
.remote-connect-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.remote-connect-row :deep(.ant-input) {
  min-width: 320px;
  flex: 1;
}

.remote-share-tip {
  margin-top: 8px;
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
  .quick-action-grid,
  .workspace-info-grid {
    grid-template-columns: 1fr;
  }

  .workspace-info-card--wide {
    grid-column: span 1;
  }
}
</style>
