<template>
  <div class="erp-page">
    <div class="page-summary-strip stats-grid-extended">
      <div v-for="item in summaryItems" :key="item.key" class="page-summary-strip__item">
        <div class="page-summary-strip__label">{{ item.label }}</div>
        <div class="page-summary-strip__value">{{ item.value }}</div>
        <div class="page-summary-strip__note">{{ item.note }}</div>
      </div>
    </div>

    <div class="section-grid" style="margin-top: 20px;">
      <a-card class="content-card" :bordered="false">
        <template #title>工作目录与备份</template>

        <div class="formula-box" style="margin-bottom: 16px;">
          程序会把业务数据和图片保存在当前工作目录的数据库里。需要更换电脑、移动数据或切换目录时，可以在这里选择新的工作目录。
        </div>

        <div class="dashboard-actions">
          <a-button class="toolbar-refresh-btn" :loading="pageRefreshing" @click="refreshPage">刷新</a-button>
          <a-button type="primary" @click="chooseWorkspaceDirectory">更改当前工作目录</a-button>
          <a-button type="primary" :loading="lanConfig.loading" @click="enableRemoteShare">启用手机远程共享</a-button>
          <a-button :loading="lanConfig.loading" @click="disableRemoteShare">关闭远程共享</a-button>
          <a-button :disabled="!lanConfig.network.tailscale_host" @click="useTailscaleHost">使用 Tailscale 地址</a-button>
          <a-button @click="setCurrentComputerAsHost">设当前电脑为主机</a-button>
          <a-button @click="syncLocalDatabaseBackup">同步程序根目录备份</a-button>
          <a-button :loading="autoLaunchLoading" :disabled="!autoLaunchSupported" @click="toggleAutoLaunch">
            {{ autoLaunch ? '关闭开机自启' : '开启开机自启' }}
          </a-button>
          <a-button :loading="workspaceInfo.storage_optimization_running" @click="optimizeStorage">
            {{ workspaceInfo.storage_optimization_running ? '数据库瘦身中' : '数据库瘦身' }}
          </a-button>
          <a-button @click="exportDatabaseFile">导出完整数据库</a-button>
          <a-button @click="importDatabaseFile">从数据库文件恢复</a-button>
          <a-button @click="applyPatchPackage">导入补丁包升级</a-button>
        </div>

        <div class="formula-box" style="margin-bottom: 16px;">
          <div style="font-weight: 700; margin-bottom: 8px;">Windows 远程访问</div>
          <div style="margin-bottom: 12px; color: #5b6b8b;">
            其他 Windows 电脑也可以通过 Tailscale 访问这台主机，不需要再直接打开数据库文件。
          </div>
          <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
            <a-input
              v-model:value="remoteDesktopHost"
              style="width: 420px; max-width: 100%;"
              placeholder="请输入主机的 Tailscale 地址，例如：http://100.x.x.x:18680"
            />
            <a-button type="primary" :loading="lanConfig.loading" @click="enableWindowsRemoteAccess()">启用 Windows 远程访问</a-button>
            <a-button :disabled="!lanConfig.network.tailscale_host" @click="useCurrentTailscaleForWindowsRemote">填入当前 Tailscale 地址</a-button>
            <a-button :loading="lanConfig.loading" @click="disableWindowsRemoteAccess">恢复本机数据库</a-button>
          </div>
          <div style="margin-top: 12px; color: #5b6b8b;">{{ desktopRemoteModeText }}</div>
        </div>

        <div class="dashboard-share-status">
          <div class="dashboard-share-card">
            <div class="dashboard-share-title">远程共享状态</div>
            <div :class="['dashboard-share-value', lanConfig.runtime.running ? 'is-on' : 'is-off']">
              {{ lanConfig.runtime.running ? '已开启' : '未开启' }}
            </div>
            <div class="dashboard-share-desc">
              {{ lanConfig.runtime.message || (lanConfig.enabled ? '正在启动共享服务' : '当前未开放手机远程访问') }}
            </div>
          </div>

          <div class="dashboard-share-card">
            <div class="dashboard-share-title">Tailscale 地址</div>
            <div class="dashboard-share-copy">{{ lanConfig.network.tailscale_host || '未检测到 Tailscale' }}</div>
            <div class="dashboard-share-desc">手机和异地电脑优先使用这个地址访问，最稳定。</div>
          </div>

          <div class="dashboard-share-card">
            <div class="dashboard-share-title">当前工作目录</div>
            <div class="dashboard-share-copy">{{ workspaceInfo.workspace_path || '-' }}</div>
            <div class="dashboard-share-desc">业务数据库和图片都会跟随这个目录。</div>
          </div>
        </div>

        <a-descriptions :column="1" bordered size="small">
          <a-descriptions-item label="当前版本">{{ currentVersion }}</a-descriptions-item>
          <a-descriptions-item label="当前工作目录">{{ workspaceInfo.workspace_path || '-' }}</a-descriptions-item>
          <a-descriptions-item label="当前数据库文件">{{ workspaceInfo.database_path || '-' }}</a-descriptions-item>
          <a-descriptions-item label="主机电脑">{{ workspaceInfo.is_host ? '当前电脑' : (workspaceInfo.host_computer_name || '-') }}</a-descriptions-item>
          <a-descriptions-item label="远程共享主地址">{{ lanConfig.host || '-' }}</a-descriptions-item>
          <a-descriptions-item label="远程共享端口">{{ lanConfig.port || '-' }}</a-descriptions-item>
          <a-descriptions-item label="数据模式">{{ workspaceInfo.is_network_path ? '网络目录模式' : '本机目录模式' }}</a-descriptions-item>
          <a-descriptions-item label="访问模式">
            {{ workspaceInfo.access_mode_label || (workspaceInfo.is_read_only ? '只读模式' : '普通模式') }}
          </a-descriptions-item>
          <a-descriptions-item label="程序根目录备份">{{ workspaceInfo.local_backup_path || '-' }}</a-descriptions-item>
          <a-descriptions-item label="每日自动备份">
            {{ workspaceInfo.daily_backup_exists ? '今天已生成' : '今天尚未生成' }}
            <span v-if="workspaceInfo.daily_backup_updated_at">，最近更新：{{ workspaceInfo.daily_backup_updated_at }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="数据库大小">{{ workspaceInfo.file_size ? formatFileSize(workspaceInfo.file_size) : '-' }}</a-descriptions-item>
          <a-descriptions-item label="数据库瘦身">
            {{ workspaceInfo.storage_optimization_stage || '未开始' }}
            <span v-if="workspaceInfo.storage_optimization_running">，进度：{{ workspaceInfo.storage_optimization_progress_percent }}%</span>
            <span v-else-if="workspaceInfo.storage_optimization_finished_at">，完成时间：{{ workspaceInfo.storage_optimization_finished_at }}</span>
            <span v-if="workspaceInfo.storage_optimization_estimated_saved_size">
              ，预计释放：{{ formatFileSize(workspaceInfo.storage_optimization_estimated_saved_size) }}
            </span>
          </a-descriptions-item>
          <a-descriptions-item label="开机自启">
            {{ autoLaunchSupported ? (autoLaunch ? '已开启' : '未开启') : '当前环境不支持' }}
          </a-descriptions-item>
          <a-descriptions-item label="离线同步状态">
            <span v-if="workspaceInfo.offline_conflict">检测到离线期间主机数据已变化，当前未自动回传，请回主机电脑处理。</span>
            <span v-else-if="workspaceInfo.offline_pending_sync">当前有离线数据待主机恢复后自动回传。</span>
            <span v-else-if="workspaceInfo.offline_mode">当前处于离线本地模式，正在等待主机恢复。</span>
            <span v-else>当前没有待回传的离线数据。</span>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <a-card class="content-card" :bordered="false">
        <template #title>使用说明</template>
        <div class="formula-box">
          <div>1. 更改当前工作目录会把数据库切换到所选目录，程序会自动备份并重启。</div>
          <div>2. 当前数据库和图片都保存在同一份库里，备份、恢复和迁移时不会丢图。</div>
          <div>3. 需要换电脑使用时，优先导出完整数据库，再在新电脑恢复。</div>
          <div>4. 手机或异地电脑访问仍使用远程访问功能，不再通过首页设置局域网目录共享。</div>
          <div>5. 建议开启开机自启，主机电脑保持程序打开后远程访问会更稳定。</div>
        </div>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  api,
  checkRemoteHostHealth,
  clearStoredRemoteHost,
  formatMoney,
  getStoredRemoteHost,
  normalizeRemoteHost,
  setStoredRemoteHost,
} from '@/utils/api'

const stats = reactive({
  materialsCount: 0,
  garmentsCount: 0,
  batchesCount: 0,
  productionCount: 0,
  consumptionCount: 0,
  warningCount: 0,
  stockValue: 0,
})

const currentVersion = ref('-')
const pageRefreshing = ref(false)
const remoteDesktopHost = ref('')
const autoLaunch = ref(false)
const autoLaunchSupported = ref(false)
const autoLaunchLoading = ref(false)
let optimizeStatusTimer = null

const workspaceInfo = reactive({
  workspace_path: '',
  database_path: '',
  file_size: 0,
  is_network_path: false,
  is_read_only: false,
  access_mode_label: '',
  sharing_tip: '',
  host_computer_name: '',
  host_workspace_path: '',
  preferred_shared_workspace_path: '',
  is_host: false,
  offline_mode: false,
  offline_pending_sync: false,
  offline_conflict: false,
  local_backup_path: '',
  local_backup_exists: false,
  local_backup_updated_at: '',
  daily_backup_exists: false,
  daily_backup_updated_at: '',
  storage_optimization_running: false,
  storage_optimization_stage: '',
  storage_optimization_progress_percent: 0,
  storage_optimization_started_at: '',
  storage_optimization_finished_at: '',
  storage_optimization_message: '',
  storage_optimization_estimated_saved_size: 0,
})

const lanConfig = reactive({
  enabled: false,
  port: 18680,
  host: '',
  host_computer_name: '',
  prefer_remote: false,
  is_host: false,
  loading: false,
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

const summaryItems = computed(() => [
  { key: 'materials', label: '物料档案', value: stats.materialsCount, note: '已建立的原料基础档案数' },
  { key: 'garments', label: '成衣款数', value: stats.garmentsCount, note: '当前维护中的款号数量' },
  { key: 'batches', label: '采购批次', value: stats.batchesCount, note: '采购批次与采购单数量概览' },
  { key: 'production', label: '生产制单', value: stats.productionCount, note: '生产单据与阶段流转情况' },
  { key: 'consumption', label: '单耗记录', value: stats.consumptionCount, note: '单耗分析已记录条数' },
  { key: 'warning', label: '红色预警', value: stats.warningCount, note: '当前异常或预警条目数' },
  { key: 'stockValue', label: '库存货值', value: formatMoney(stats.stockValue), note: '按库存均价计算的当前货值' },
])

const desktopRemoteModeText = computed(() => {
  if (lanConfig.is_host) {
    return `当前电脑是主机：${lanConfig.host || lanConfig.network.preferred_host || '本机共享中'}`
  }
  if (lanConfig.prefer_remote && lanConfig.host) {
    return `当前为 Windows 远程访问模式：${lanConfig.host}`
  }
  return '当前为本机数据库模式'
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

async function loadWorkspaceInfo() {
  Object.assign(workspaceInfo, await api.db.getWorkspaceInfo())
  if (workspaceInfo.storage_optimization_running) {
    startOptimizeStatusPolling()
  } else {
    stopOptimizeStatusPolling()
  }
}

async function loadLanConfig() {
  try {
    Object.assign(lanConfig, await api.lan.getConfig?.())
    remoteDesktopHost.value = normalizeRemoteHost(lanConfig.host || lanConfig.network.tailscale_host || '')
  } catch (error) {
    lanConfig.runtime.message = error.message || '远程共享状态读取失败'
  }
}

function stopOptimizeStatusPolling() {
  if (optimizeStatusTimer) {
    clearInterval(optimizeStatusTimer)
    optimizeStatusTimer = null
  }
}

function startOptimizeStatusPolling() {
  if (optimizeStatusTimer) return
  optimizeStatusTimer = setInterval(async () => {
    try {
      const result = await api.db.getOptimizeStorageStatus?.()
      if (result?.workspace_info) {
        Object.assign(workspaceInfo, result.workspace_info)
      } else if (result) {
        Object.assign(workspaceInfo, result)
      }
      if (!workspaceInfo.storage_optimization_running) {
        stopOptimizeStatusPolling()
      }
    } catch {
      stopOptimizeStatusPolling()
    }
  }, 1500)
}

async function updateLanConfig(payload, successText = '') {
  lanConfig.loading = true
  try {
    const result = await api.lan.updateConfig(payload)
    Object.assign(lanConfig, result || {})
    if (successText) {
      message.success(successText)
    }
  } catch (error) {
    message.error(error.message || '更新远程共享设置失败')
  } finally {
    lanConfig.loading = false
  }
}

async function enableRemoteShare() {
  const preferredHost = lanConfig.network.tailscale_host || lanConfig.network.preferred_host || lanConfig.host
  await updateLanConfig(
    { enabled: true, host: preferredHost, prefer_remote: false },
    '远程共享已开启，手机可通过上方地址访问同一数据库'
  )
}

async function disableRemoteShare() {
  await updateLanConfig({ enabled: false }, '远程共享已关闭')
}

async function useTailscaleHost() {
  if (!lanConfig.network.tailscale_host) {
    message.error('当前电脑未检测到 Tailscale 地址')
    return
  }
  await updateLanConfig(
    { enabled: true, host: lanConfig.network.tailscale_host, prefer_remote: false },
    '已切换为 Tailscale 地址，手机和异地设备可优先使用这个地址访问'
  )
}

function useCurrentTailscaleForWindowsRemote() {
  if (!lanConfig.network.tailscale_host) {
    message.error('当前电脑未检测到 Tailscale 地址')
    return
  }
  remoteDesktopHost.value = normalizeRemoteHost(lanConfig.network.tailscale_host)
  message.success('已填入当前 Tailscale 地址，可用于 Windows 远程访问')
}

async function enableWindowsRemoteAccess(hostOverride = '') {
  const host = normalizeRemoteHost(hostOverride || remoteDesktopHost.value || lanConfig.host || '')
  if (!host) {
    message.error('请先填写主机的 Tailscale 地址')
    return
  }
  lanConfig.loading = true
  try {
    await checkRemoteHostHealth(host)
    setStoredRemoteHost(host)
    const result = await api.lan.updateConfig({ enabled: false, host, prefer_remote: true })
    Object.assign(lanConfig, result || {})
    remoteDesktopHost.value = normalizeRemoteHost(host)
    message.success('Windows 客户端已切换为 Tailscale 远程访问模式')
  } catch (error) {
    message.error(error.message || '无法连接主机，请检查 Tailscale 地址和主机状态')
  } finally {
    lanConfig.loading = false
  }
}

async function disableWindowsRemoteAccess() {
  clearStoredRemoteHost()
  await updateLanConfig({ prefer_remote: false }, '已关闭 Windows 远程访问，恢复为本机数据库模式')
}

async function chooseWorkspaceDirectory() {
  try {
    const result = await api.db.chooseWorkspaceDirectory()
    if (!result) return
    message.success(result.message || '已更改当前工作目录，程序即将重启')
  } catch (error) {
    message.error(error.message || '更改当前工作目录失败')
  }
}

async function setCurrentComputerAsHost() {
  try {
    const result = await api.db.setCurrentComputerAsHost()
    if (result?.message) {
      message.success(result.message)
    }
    await Promise.all([loadWorkspaceInfo(), loadLanConfig()])
  } catch (error) {
    message.error(error.message || '设置主机失败')
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
    if (result) {
      message.success('完整数据库文件已导出')
    }
  } catch (error) {
    message.error(error.message || '导出数据库失败')
  }
}

async function importDatabaseFile() {
  try {
    const result = await api.db.importDatabaseFile?.()
    if (!result) return
    message.success('数据库已恢复，程序即将重启')
  } catch (error) {
    message.error(error.message || '恢复数据库失败')
  }
}

async function applyPatchPackage() {
  try {
    const result = await api.app.applyPatchPackage?.()
    if (!result) return
    message.success(`补丁已开始应用，程序将自动重启到 ${result.version}`)
  } catch (error) {
    message.error(error.message || '应用补丁失败')
  }
}

async function refreshPage() {
  pageRefreshing.value = true
  try {
    await Promise.all([loadStats(), loadVersion(), loadWorkspaceInfo(), loadAutoLaunch(), loadLanConfig()])
    message.success('已刷新')
  } catch (error) {
    message.error(error.message || '刷新首页失败')
  } finally {
    pageRefreshing.value = false
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadStats(), loadVersion(), loadWorkspaceInfo(), loadAutoLaunch(), loadLanConfig()])
  } catch (error) {
    message.error(error.message || '加载经营总览失败')
  }
})

onUnmounted(() => {
  stopOptimizeStatusPolling()
})
</script>
