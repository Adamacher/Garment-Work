const REMOTE_HOST_KEY = 'garment_remote_host'
const REMOTE_TIMEOUT_MS = 20000

const electronDb = window.electronAPI?.db || null
const orderApi = window.electronAPI?.order || null
const appApi = window.electronAPI?.app || null
const authApi = window.electronAPI?.auth || null
const miscApi = window.electronAPI?.misc || null
const lanApi = window.electronAPI?.lan || null

const dbMethodNames = [
  'getDashboardStats',
  'getMaterials',
  'addMaterial',
  'updateMaterial',
  'deleteMaterial',
  'getGarments',
  'addGarment',
  'updateGarment',
  'batchUpdateGarmentMarkup',
  'batchUpdatePurchaseBatchDocumentStatus',
  'approvePurchaseBatches',
  'voidPurchaseBatches',
  'returnPurchaseBatchesToDraft',
  'batchUpdateProductionOrderDocumentStatus',
  'approveProductionOrders',
  'voidProductionOrders',
  'returnProductionOrdersToDraft',
  'deleteGarment',
  'getBomsByGarment',
  'saveBomItem',
  'replaceBomItemsByGarment',
  'deleteBomItem',
  'getPurchaseBatches',
  'getInventorySummary',
  'verifyInventoryStock',
  'clearInventoryResidue',
  'updatePurchaseBatchFactoryAllocations',
  'processPurchaseBatchAfterSale',
  'getInventoryMovements',
  'getAuditLogs',
  'getNextBatchNo',
  'getNextPurchaseOrderNo',
  'getOptionLists',
  'saveOptionValue',
  'renameOptionValue',
  'deleteOptionValue',
  'reorderOptionValues',
  'getWorkspaceInfo',
  'syncLocalDatabaseBackup',
  'chooseWorkspaceDirectory',
  'setupSimpleLanShare',
  'openWorkspaceReadOnly',
  'setCurrentComputerAsHost',
  'tryOfflineAutoSync',
  'exportDatabaseFile',
  'importDatabaseFile',
  'copyBackupText',
  'exportBackupText',
  'exportBackupFile',
  'importBackupText',
  'importBackupFile',
  'optimizeStorage',
  'getOptimizeStorageStatus',
  'previewEffectivePrice',
  'savePurchaseBatch',
  'splitPurchaseBatch',
  'mergePurchaseBatches',
  'unmergePurchaseBatches',
  'deletePurchaseBatch',
  'getConsumptionRecords',
  'saveConsumptionRecord',
  'deleteConsumptionRecord',
  'getProductionOrders',
  'getProductionOrderDetail',
  'updateProductionOrderStatus',
  'getNextProductionOrderNo',
  'saveProductionOrder',
  'deleteProductionOrder',
]

const authMethodNames = ['login', 'getUsers', 'saveUser', 'deleteUser']

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore storage failures
  }
}

function safeStorageRemove(key) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore storage failures
  }
}

function isLikelyAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim())
}

export function normalizeRemoteHost(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const withProtocol = isLikelyAbsoluteUrl(raw) ? raw : `http://${raw}`
  return withProtocol.replace(/\/+$/, '')
}

export function getStoredRemoteHost() {
  return normalizeRemoteHost(safeStorageGet(REMOTE_HOST_KEY))
}

export function setStoredRemoteHost(value) {
  const normalized = normalizeRemoteHost(value)
  if (!normalized) {
    safeStorageRemove(REMOTE_HOST_KEY)
    return ''
  }
  safeStorageSet(REMOTE_HOST_KEY, normalized)
  return normalized
}

export function clearStoredRemoteHost() {
  safeStorageRemove(REMOTE_HOST_KEY)
}

export const isBrowserRemoteMode = !window.electronAPI

export async function checkRemoteHostHealth(hostValue) {
  const host = normalizeRemoteHost(hostValue || getStoredRemoteHost())
  if (!host) {
    throw new Error('请先填写主机地址，例如：http://100.x.x.x:18680')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(`${host}/health`, {
      method: 'GET',
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `主机健康检查失败：${response.status}`)
    }
    return payload
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('连接主机超时，请确认主机电脑程序已打开，并且 18680 端口可访问')
    }
    if (String(error?.message || '').includes('Failed to fetch')) {
      throw new Error('无法连接主机服务，请确认主机电脑程序已打开、已设为主机，并检查 18680 端口或防火墙设置')
    }
    throw new Error(error?.message || '无法连接主机服务')
  } finally {
    clearTimeout(timeout)
  }
}

async function remoteInvoke(channel, ...args) {
  const host = getStoredRemoteHost()
  if (!host) {
    throw new Error('请先填写主机地址，例如：http://100.x.x.x:18680')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS)

  try {
    const response = await fetch(`${host}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args }),
      signal: controller.signal,
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `主机服务调用失败：${response.status}`)
    }
    return payload?.result
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('连接主机超时，请检查主机是否在线、地址是否正确')
    }
    if (String(error?.message || '').includes('Failed to fetch')) {
      throw new Error('无法连接主机服务，请确认主机电脑程序已打开、已设为主机，并检查 18680 端口或防火墙设置')
    }
    throw new Error(error?.message || '无法连接主机服务')
  } finally {
    clearTimeout(timeout)
  }
}

function unsupportedDesktopOnly(featureName) {
  return async () => {
    throw new Error(`安卓端暂不支持${featureName}，请在电脑端使用`)
  }
}

function createRemoteMethodGroup(methodNames, prefix) {
  return methodNames.reduce((result, methodName) => {
    result[methodName] = (...args) => remoteInvoke(`${prefix}:${methodName}`, ...args)
    return result
  }, {})
}

const remoteDbApi = createRemoteMethodGroup(dbMethodNames, 'db')
const remoteAuthApi = createRemoteMethodGroup(authMethodNames, 'auth')

const browserSafeAppApi = {
  async getVersion() {
    return { version: '安卓远程版' }
  },
  async getAutoLaunchSettings() {
    return {
      supported: false,
      enabled: false,
    }
  },
  setAutoLaunchEnabled: unsupportedDesktopOnly('开机自启设置'),
  applyPatchPackage: unsupportedDesktopOnly('补丁升级'),
}

const browserSafeLanApi = {
  async getConfig() {
    return {
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
        message: '当前为浏览器远程模式，无法读取本机共享状态',
      },
    }
  },
  updateConfig: unsupportedDesktopOnly('远程共享设置'),
}

export const api = {
  db: electronDb || remoteDbApi,
  auth: authApi || remoteAuthApi,
  order: orderApi || {
    exportPdf: unsupportedDesktopOnly('生产单导出'),
    exportExcel: unsupportedDesktopOnly('生产单导出'),
    exportImage: unsupportedDesktopOnly('生产单导出'),
    exportPurchasePdf: unsupportedDesktopOnly('采购单导出'),
    exportPurchaseExcel: unsupportedDesktopOnly('采购单导出'),
    exportPurchaseImage: unsupportedDesktopOnly('采购单导出'),
    batchExportPurchaseDocuments: unsupportedDesktopOnly('批量导出采购单'),
    batchExportProductionOrders: unsupportedDesktopOnly('批量导出生产单'),
    exportMergedPurchasePdf: unsupportedDesktopOnly('合并导出采购单'),
    exportMergedPurchaseExcel: unsupportedDesktopOnly('合并导出采购单'),
    exportMergedPurchaseImage: unsupportedDesktopOnly('合并导出采购单'),
  },
  app: appApi || browserSafeAppApi,
  lan: lanApi || browserSafeLanApi,
  misc: miscApi || {
    exportHtmlExcel: unsupportedDesktopOnly('Excel 导出'),
  },
}

export function toNumber(value, fallbackValue = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallbackValue
}

export function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

export function formatMoney(value, digits = 2) {
  return toNumber(value).toFixed(digits)
}

export function formatPercent(value, digits = 2) {
  return `${(toNumber(value) * 100).toFixed(digits)}%`
}

export function normalizeOptionEntries(list = []) {
  return (list || [])
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          id: null,
          value: item,
          sort_order: index + 1,
        }
      }

      return {
        id: item?.id ?? null,
        value: String(item?.value || '').trim(),
        sort_order: Number(item?.sort_order || index + 1),
      }
    })
    .filter((item) => item.value)
}

export function toSelectOptions(list = []) {
  return normalizeOptionEntries(list).map((item) => ({
    label: item.value,
    value: item.value,
  }))
}
