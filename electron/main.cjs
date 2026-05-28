const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const http = require('http')
const packageMeta = require('../package.json')

let mainWindow = null
let lanBridgeServer = null
const ipcInvokeHandlerMap = new Map()
let lanBridgeState = {
  running: false,
  port: 0,
  host: '',
  message: ''
}
const LAN_LOCAL_ONLY_CHANNELS = new Set([
  'db:getWorkspaceInfo',
  'db:syncLocalDatabaseBackup',
  'db:chooseWorkspaceDirectory',
  'db:setupSimpleLanShare',
  'db:openWorkspaceReadOnly',
  'db:setCurrentComputerAsHost',
  'db:tryOfflineAutoSync',
  'db:exportDatabaseFile',
  'db:importDatabaseFile',
  'db:copyBackupText',
  'db:exportBackupText',
  'db:exportBackupFile',
  'db:importBackupText',
  'db:importBackupFile',
  'db:optimizeStorage',
  'db:getOptimizeStorageStatus'
])
const APP_ID = packageMeta.build?.appId || 'com.zhiyi.ems'
const APP_NAME = packageMeta.build?.productName || packageMeta.productName || packageMeta.name || 'Garment EMS'
const STARTUP_FALLBACK_LOG_FILE = path.join(path.dirname(process.execPath), 'startup-main.log')
const RENDERER_RECOVERY_MARK = 'garment-ems-renderer-recovery'
let dbApi = null
const originalIpcMainHandle = ipcMain.handle.bind(ipcMain)
const originalIpcMainRemoveHandler = typeof ipcMain.removeHandler === 'function'
  ? ipcMain.removeHandler.bind(ipcMain)
  : null

ipcMain.handle = (channel, listener) => {
  ipcInvokeHandlerMap.set(channel, listener)
  return originalIpcMainHandle(channel, listener)
}

if (originalIpcMainRemoveHandler) {
  ipcMain.removeHandler = (channel) => {
    ipcInvokeHandlerMap.delete(channel)
    return originalIpcMainRemoveHandler(channel)
  }
}

function writeStartupLog(message, extra = '') {
  try {
    const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${extra}` : ''}${os.EOL}`
    fs.appendFileSync(STARTUP_FALLBACK_LOG_FILE, line, 'utf8')
    try {
      const userDataLogFile = path.join(app.getPath('userData'), 'startup.log')
      fs.appendFileSync(userDataLogFile, line, 'utf8')
    } catch {}
  } catch {}
}

process.on('uncaughtException', (error) => {
  writeStartupLog('uncaughtException', error?.stack || String(error || ''))
  try {
    dialog.showErrorBox('启动错误', `程序启动时发生异常：${error?.message || error || '未知错误'}`)
  } catch {}
})

process.on('unhandledRejection', (reason) => {
  writeStartupLog('unhandledRejection', reason?.stack || String(reason || ''))
})

function getDbApi() {
  if (!dbApi) {
    writeStartupLog('db:module-load:start')
    dbApi = require('./db')
    writeStartupLog('db:module-load:ok')
  }
  return dbApi
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isDatabaseLockedError(error) {
  const text = String(error?.message || error || '').toLowerCase()
  return text.includes('database is locked') || text.includes('database busy')
}

async function ensureDbApiReady(options = {}) {
  const attempts = Number(options.attempts || 5)
  const delayMs = Number(options.delayMs || 3000)

  for (let index = 0; index < attempts; index += 1) {
    try {
      return getDbApi()
    } catch (error) {
      const attemptNo = index + 1
      writeStartupLog('db:module-load:retry-failed', `attempt=${attemptNo}/${attempts} error=${error?.stack || error}`)
      if (!isDatabaseLockedError(error) || attemptNo >= attempts) {
        throw error
      }
      await delay(delayMs)
    }
  }

  return getDbApi()
}

function showStartupFailure(error) {
  const rawMessage = String(error?.message || error || '未知错误')
  const message = isDatabaseLockedError(error)
    ? '数据库正在被其他程序占用，程序暂时无法启动。\n\n请先关闭其它正在使用同一数据库的程序版本，等待几秒后再重试。'
    : `程序启动失败：${rawMessage}`
  try {
    dialog.showErrorBox('启动失败', message)
  } catch {}
}

function resolveRendererEntry() {
  writeStartupLog('resolveRendererEntry:start')
  const devUrl = process.env.VITE_DEV_SERVER_URL
  const distEntry = path.join(__dirname, '../dist/index.html')

  if (devUrl) {
    writeStartupLog('resolveRendererEntry:devUrl', devUrl)
    return { type: 'url', value: devUrl }
  }
  if (!fs.existsSync(distEntry)) {
    writeStartupLog('resolveRendererEntry:missingDist', distEntry)
    throw new Error(`找不到前端构建文件：${distEntry}`)
  }
  writeStartupLog('resolveRendererEntry:file', distEntry)
  return { type: 'file', value: distEntry }
}

function createWindow() {
  writeStartupLog('createWindow:start')
  mainWindow = new BrowserWindow({
    title: `${APP_NAME} v${packageMeta.version}`,
    width: 1480,
    height: 960,
    show: false,
    backgroundColor: '#f5faff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const rendererEntry = resolveRendererEntry()
  if (rendererEntry.type === 'url') {
    writeStartupLog('createWindow:loadURL', rendererEntry.value)
    mainWindow.loadURL(rendererEntry.value)
    mainWindow.webContents.openDevTools()
  } else {
    writeStartupLog('createWindow:loadFile', rendererEntry.value)
    mainWindow.loadFile(rendererEntry.value)
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    writeStartupLog('webContents:did-fail-load', `code=${errorCode} desc=${errorDescription} url=${validatedURL}`)
  })

  mainWindow.webContents.on('did-navigate', (_event, url) => {
    if (/\.css(?:$|[?#])/i.test(String(url || ''))) {
      writeStartupLog('webContents:css-navigation-recover', url)
      const fallbackEntry = resolveRendererEntry()
      if (fallbackEntry.type === 'url') {
        mainWindow.loadURL(fallbackEntry.value)
      } else {
        mainWindow.loadFile(fallbackEntry.value)
      }
    }
  })

  mainWindow.webContents.on('did-finish-load', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      const recoveryState = await mainWindow.webContents.executeJavaScript(`
        (() => {
          const text = (document.body && document.body.innerText || '').trim()
          const hasAppRoot = Boolean(document.querySelector('#app'))
          const looksLikeCss = text.startsWith('.anticon') || text.startsWith(':where(') || text.includes('.ant-card') || text.includes('.ant-form')
          return { hasAppRoot, looksLikeCss, textLength: text.length, title: document.title }
        })()
      `)
      if (recoveryState?.looksLikeCss && !recoveryState?.hasAppRoot) {
        writeStartupLog('webContents:css-document-recover', JSON.stringify(recoveryState))
        const currentUrl = mainWindow.webContents.getURL()
        if (!String(currentUrl || '').includes(RENDERER_RECOVERY_MARK)) {
          const fallbackEntry = resolveRendererEntry()
          if (fallbackEntry.type === 'url') {
            mainWindow.loadURL(fallbackEntry.value)
          } else {
            mainWindow.loadFile(fallbackEntry.value, { query: { [RENDERER_RECOVERY_MARK]: '1' } })
          }
        }
      }
    } catch (error) {
      writeStartupLog('webContents:finish-load-check-failed', error?.message || String(error || ''))
    }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeStartupLog('webContents:render-process-gone', JSON.stringify(details || {}))
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      writeStartupLog('webContents:console', `level=${level} line=${line} source=${sourceId} msg=${message}`)
    }
  })

  mainWindow.once('ready-to-show', () => {
    writeStartupLog('createWindow:ready-to-show')
    try {
      mainWindow.setTitle(`${APP_NAME} v${packageMeta.version}`)
    } catch {}
    mainWindow.show()
  })
  mainWindow.on('unresponsive', () => {
    writeStartupLog('createWindow:unresponsive')
  })
  mainWindow.on('close', () => {
    writeStartupLog('createWindow:close')
  })
  mainWindow.on('closed', () => {
    writeStartupLog('createWindow:closed')
    mainWindow = null
  })
}

async function stopLanBridgeServer() {
  writeStartupLog('lanBridge:stop:start')
  if (!lanBridgeServer) {
    lanBridgeState = {
      running: false,
      port: 0,
      host: '',
      message: ''
    }
    writeStartupLog('lanBridge:stop:no-server')
    return lanBridgeState
  }
  await new Promise((resolve) => {
    try {
      lanBridgeServer.close(() => resolve())
    } catch {
      resolve()
    }
  })
  lanBridgeServer = null
  lanBridgeState = {
    running: false,
    port: 0,
    host: '',
    message: ''
  }
  writeStartupLog('lanBridge:stop:done')
  return lanBridgeState
}

function getLanNetworkSnapshot(port = 0) {
  const safePort = Number(port || 0)
  const interfaces = os.networkInterfaces()
  const rows = []
  const seen = new Set()
  Object.entries(interfaces || {}).forEach(([name, values]) => {
    ;(values || []).forEach((entry) => {
      if (!entry || entry.family !== 'IPv4' || entry.internal) return
      const address = String(entry.address || '').trim()
      if (!address || seen.has(address)) return
      seen.add(address)
      const lowerName = String(name || '').toLowerCase()
      const kind = lowerName.includes('tailscale')
        ? 'tailscale'
        : lowerName.includes('wlan') || lowerName.includes('wi-fi') || lowerName.includes('wireless')
          ? 'wifi'
          : 'lan'
      rows.push({
        name,
        address,
        kind,
        host: safePort ? `http://${address}:${safePort}` : `http://${address}`
      })
    })
  })
  const tailscale = rows.find((item) => item.kind === 'tailscale') || null
  const preferred = tailscale || rows[0] || null
  return {
    preferred_host: preferred?.host || '',
    tailscale_host: tailscale?.host || '',
    tailscale_ip: tailscale?.address || '',
    local_hosts: rows
  }
}

async function invokeRegisteredHandler(channel, args = []) {
  const handler = ipcInvokeHandlerMap.get(channel)
  if (typeof handler !== 'function') {
    throw new Error(`未注册可调用接口：${channel}`)
  }
  const safeArgs = Array.isArray(args) ? args : []
  const mockEvent = {
    sender: mainWindow?.webContents || null,
    reply() {},
    returnValue: undefined
  }
  return handler(mockEvent, ...safeArgs)
}

async function startLanBridgeServer() {
  const { getLanBridgeConfig } = getDbApi()
  const config = getLanBridgeConfig()
  writeStartupLog('lanBridge:start:config', JSON.stringify(config || {}))
  if (!config.enabled) {
    writeStartupLog('lanBridge:start:disabled')
    return stopLanBridgeServer()
  }
  if (lanBridgeServer && lanBridgeState.running && lanBridgeState.port === Number(config.port || 0)) {
    writeStartupLog('lanBridge:start:reuse', JSON.stringify(lanBridgeState || {}))
    return lanBridgeState
  }
  await stopLanBridgeServer()
  lanBridgeServer = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        })
        res.end()
        return
      }
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        })
        res.end(JSON.stringify({
          ok: true,
          app: APP_NAME,
          version: app.getVersion(),
          port: config.port
        }))
        return
      }
      if (req.method === 'POST' && req.url === '/invoke') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const channel = String(payload.channel || '')
        if (!(channel.startsWith('db:') || channel.startsWith('auth:'))) {
          throw new Error(`当前仅支持局域网访问数据库与登录接口：${channel}`)
        }
        const result = await Promise.resolve(invokeRegisteredHandler(channel, Array.isArray(payload.args) ? payload.args : []))
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        })
        res.end(JSON.stringify({ ok: true, result }))
        return
      }
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      })
      res.end(JSON.stringify({ ok: false, error: 'Not found' }))
    } catch (error) {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      })
      res.end(JSON.stringify({ ok: false, error: error?.message || '局域网服务调用失败' }))
    }
  })
  await new Promise((resolve, reject) => {
    lanBridgeServer.once('error', reject)
    lanBridgeServer.listen(Number(config.port || 0), () => {
      lanBridgeServer.off('error', reject)
      resolve()
    })
  })
  const addressInfo = lanBridgeServer.address()
  lanBridgeState = {
    running: true,
    port: Number(config.port || 0),
    host: config.host || '',
    message: `局域网服务已启动：${config.host || ''}`
  }
  writeStartupLog('lanBridge:start:ok', JSON.stringify({
    requestedPort: Number(config.port || 0),
    actualAddress: addressInfo
  }))
  return lanBridgeState
}

async function refreshLanBridgeServer() {
  try {
    const result = await startLanBridgeServer()
    writeStartupLog('lanBridge:refresh:ok', JSON.stringify(result || {}))
    return result
  } catch (error) {
    lanBridgeState = {
      running: false,
      port: 0,
      host: '',
      message: error?.message || '局域网服务启动失败'
    }
    writeStartupLog('lanBridge:refresh:error', error?.stack || String(error || ''))
    return lanBridgeState
  }
}

function shouldUseRemoteLanChannel(channel, config) {
  if (!channel || !(channel.startsWith('db:') || channel.startsWith('auth:'))) return false
  if (LAN_LOCAL_ONLY_CHANNELS.has(channel)) return false
  if (!config?.prefer_remote || !config?.host || config?.is_host) return false
  return true
}

async function forwardLanInvoke(channel, args = []) {
  const { getLanBridgeConfig } = getDbApi()
  const config = getLanBridgeConfig()
  if (!shouldUseRemoteLanChannel(channel, config)) {
    return invokeRegisteredHandler(channel, args)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`${config.host}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args }),
      signal: controller.signal
    })
    const result = await response.json()
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || `主机服务调用失败：${response.status}`)
    }
    return result.result
  } finally {
    clearTimeout(timeout)
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatMultilineHtml(value, fallback = '-') {
  const text = String(value ?? '').trim()
  if (!text) return fallback
  return escapeHtml(text).replace(/\r?\n/g, '<br />')
}

function formatFixed(value, digits = 4) {
  return Number(value || 0).toFixed(digits)
}

function formatFixedTrimmed(value, digits = 2) {
  return Number(value || 0).toFixed(digits)
}

function chunkItems(list, size) {
  const source = Array.isArray(list) ? list : []
  const chunkSize = Math.max(1, Number(size || 1))
  const chunks = []
  for (let index = 0; index < source.length; index += chunkSize) {
    chunks.push(source.slice(index, index + chunkSize))
  }
  return chunks
}

function pxToMicrons(px) {
  return Math.max(1000, Math.ceil(Number(px || 0) * 264.583333))
}

function buildPurchaseItemRemark(item) {
  const parts = []
  const lineRemark = String(item.color_remark || '').trim()
  const processingNote = String(item.processing_note || '').trim()
  if (lineRemark) parts.push(lineRemark)
  if (processingNote) parts.push(processingNote)
  return parts.join('\n')
}

function normalizePurchaseExportOptions(options = {}) {
  return {
    layout_mode: options?.layout_mode === 'card' ? 'card' : 'a4',
    show_images: options?.show_images === true,
    show_material_name: options?.show_material_name === true,
    show_color: options?.show_color !== false,
    show_price_type: options?.show_price_type === true,
    show_unit_price: options?.show_unit_price !== false,
    show_item_remark: options?.show_item_remark === true,
    show_order_remark: options?.show_order_remark !== false
  }
}

function getPurchaseExportRenderOptions(options = {}) {
  const exportOptions = normalizePurchaseExportOptions(options)
  const isCardLayout = exportOptions.layout_mode === 'card'
  return {
    ...exportOptions,
    isCardLayout,
    sheetWidth: isCardLayout ? 1120 : 1080,
    pdfPageSize: isCardLayout ? 'A5' : 'A4',
    imageOptions: isCardLayout
      ? { zoomFactor: 2.8, baseWidth: 1748, baseHeight: 1240, maxWidth: 5200, maxHeight: 14000, multiPage: true }
      : { zoomFactor: 3.0, baseWidth: 2480, baseHeight: 3508, maxWidth: 12000, maxHeight: 20000 }
  }
}

function sanitizeFileNameSegment(value, fallback = '未命名') {
  const text = String(value ?? '').trim() || fallback
  return text.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || fallback
}

function getLastExportDirStorePath() {
  try {
    return path.join(app.getPath('userData'), 'last-export-dir.json')
  } catch {
    return path.join(path.dirname(process.execPath), 'last-export-dir.json')
  }
}

function getDefaultExportDir() {
  try {
    return app.getPath('documents')
  } catch {
    return process.cwd()
  }
}

function readLastExportDir() {
  try {
    const storePath = getLastExportDirStorePath()
    if (!fs.existsSync(storePath)) return ''
    const raw = fs.readFileSync(storePath, 'utf8')
    const parsed = JSON.parse(raw || '{}')
    const dirPath = String(parsed?.dirPath || '').trim()
    if (!dirPath) return ''
    if (!fs.existsSync(dirPath)) return ''
    const stat = fs.statSync(dirPath)
    return stat.isDirectory() ? dirPath : ''
  } catch {
    return ''
  }
}

function rememberExportDir(targetPath) {
  try {
    const rawPath = String(targetPath || '').trim()
    if (!rawPath) return
    const dirPath = fs.existsSync(rawPath) && fs.statSync(rawPath).isDirectory()
      ? rawPath
      : path.dirname(rawPath)
    if (!dirPath || !fs.existsSync(dirPath)) return
    fs.writeFileSync(
      getLastExportDirStorePath(),
      JSON.stringify({
        dirPath,
        updatedAt: new Date().toISOString()
      }, null, 2),
      'utf8'
    )
  } catch {}
}

function resolveExportDefaultPath(defaultPath) {
  const rememberedDir = readLastExportDir() || getDefaultExportDir()
  const safeDefaultPath = String(defaultPath || '').trim()
  if (!safeDefaultPath) return rememberedDir
  const fileName = path.basename(safeDefaultPath)
  return path.join(rememberedDir, fileName)
}

function parseSizeBreakdown(rawValue, fallbackTotal = 0) {
  const raw = String(rawValue || '').trim()
  if (!raw) {
    return {
      entries: [],
      total: Number(fallbackTotal || 0),
      displayText: '-'
    }
  }

  let parsedEntries = []

  try {
    const jsonValue = JSON.parse(raw)
    if (Array.isArray(jsonValue)) {
      parsedEntries = jsonValue
        .map((item) => ({
          size: String(item?.size || item?.label || '').trim(),
          qty: Number(item?.qty ?? item?.value ?? 0)
        }))
        .filter((item) => item.size)
    } else if (jsonValue && typeof jsonValue === 'object') {
      parsedEntries = Object.entries(jsonValue)
        .map(([size, qty]) => ({
          size: String(size || '').trim(),
          qty: Number(qty || 0)
        }))
        .filter((item) => item.size)
    }
  } catch {}

  if (!parsedEntries.length) {
    const normalized = raw
      .replace(/[：]/g, ':')
      .replace(/[；;、，,]/g, '/')
      .replace(/\r?\n/g, '/')
    const segments = normalized
      .split('/')
      .map((item) => item.trim())
      .filter(Boolean)

    parsedEntries = segments
      .map((segment) => {
        const match = segment.match(/^([A-Za-z0-9+\-]+)\s*[:=]\s*(\d+(?:\.\d+)?)$/)
        if (!match) return null
        return {
          size: String(match[1] || '').trim(),
          qty: Number(match[2] || 0)
        }
      })
      .filter(Boolean)
  }

  const entries = parsedEntries.filter((item) => item.size)
  const total = entries.length
    ? entries.reduce((sum, item) => sum + Number(item.qty || 0), 0)
    : Number(fallbackTotal || 0)

  return {
    entries,
    total,
    displayText: entries.length
      ? entries.map((item) => `${item.size}:${Number(item.qty || 0)}`).join(' / ')
      : raw
  }
}

function compareVersions(left, right) {
  const leftParts = String(left || '0').split('.').map((item) => Number(item || 0))
  const rightParts = String(right || '0').split('.').map((item) => Number(item || 0))
  const maxLength = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0
    const rightValue = rightParts[index] || 0
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }
  return 0
}

function normalizeAutoLaunchSettings(settings = {}) {
  return {
    supported:
      typeof app.getLoginItemSettings === 'function' &&
      typeof app.setLoginItemSettings === 'function',
    enabled: Boolean(settings.openAtLogin),
    openAtLogin: Boolean(settings.openAtLogin),
    openAsHidden: Boolean(settings.openAsHidden),
    wasOpenedAtLogin: Boolean(settings.wasOpenedAtLogin),
    isPackaged: Boolean(app.isPackaged)
  }
}

function getAutoLaunchSettings() {
  if (
    typeof app.getLoginItemSettings !== 'function' ||
    typeof app.setLoginItemSettings !== 'function'
  ) {
    return normalizeAutoLaunchSettings()
  }

  try {
    return normalizeAutoLaunchSettings(app.getLoginItemSettings())
  } catch {
    return normalizeAutoLaunchSettings()
  }
}

function setAutoLaunchEnabled(enabled) {
  if (
    typeof app.getLoginItemSettings !== 'function' ||
    typeof app.setLoginItemSettings !== 'function'
  ) {
    throw new Error('当前系统环境不支持开机自启设置')
  }

  const options = {
    openAtLogin: Boolean(enabled),
    openAsHidden: false
  }

  if (process.platform === 'win32') {
    options.path = app.getPath('exe')
    options.args = []
  }

  app.setLoginItemSettings(options)
  return getAutoLaunchSettings()
}

function toPowerShellLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`
}

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true
    })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '')
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(stderr.trim() || 'PowerShell 执行失败'))
    })
  })
}

async function applyPatchPackage(patchFilePath) {
  const targetAsarPath = path.join(process.resourcesPath, 'app.asar')
  if (!fs.existsSync(targetAsarPath)) {
    throw new Error('当前环境不是安装版程序，无法直接应用补丁包')
  }

  const { getWorkspaceInfo, backupDatabaseFile } = getDbApi()
  const workspaceInfo = getWorkspaceInfo()
  const backupDir = path.join(app.getPath('documents'), 'Garment EMS Backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const backupFilePath = path.join(
    backupDir,
    `garment-ems-pre-patch-${Date.now()}.gemsdb`
  )
  await backupDatabaseFile(backupFilePath)

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'garment-ems-patch-'))
  const extractDir = path.join(tempRoot, 'extract')
  fs.mkdirSync(extractDir, { recursive: true })

  await runPowerShell(`Expand-Archive -LiteralPath ${toPowerShellLiteral(patchFilePath)} -DestinationPath ${toPowerShellLiteral(extractDir)} -Force`)

  const manifestPath = path.join(extractDir, 'manifest.json')
  const patchAsarPath = path.join(extractDir, 'app.asar')
  if (!fs.existsSync(manifestPath) || !fs.existsSync(patchAsarPath)) {
    throw new Error('补丁包内容不完整，缺少 manifest.json 或 app.asar')
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (String(manifest.appId || '') !== APP_ID) {
    throw new Error('补丁包不属于当前软件，无法应用')
  }
  if (compareVersions(manifest.version, app.getVersion()) < 0) {
    throw new Error(`补丁版本 ${manifest.version} 低于当前版本 ${app.getVersion()}，已阻止降级`)
  }

  const updaterScriptPath = path.join(tempRoot, 'apply-patch.ps1')
  const exePath = app.getPath('exe')
  const backupAsarPath = path.join(process.resourcesPath, 'app.asar.bak')
  const script = `
$ErrorActionPreference = 'Stop'
$source = ${toPowerShellLiteral(patchAsarPath)}
$target = ${toPowerShellLiteral(targetAsarPath)}
$backup = ${toPowerShellLiteral(backupAsarPath)}
$exe = ${toPowerShellLiteral(exePath)}
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Milliseconds 900
  try {
    if (Test-Path -LiteralPath $target) {
      Copy-Item -LiteralPath $target -Destination $backup -Force
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
    Start-Process -FilePath $exe
    exit 0
  } catch {
    try {
      if (Test-Path -LiteralPath $backup) {
        Copy-Item -LiteralPath $backup -Destination $target -Force
      }
    } catch {}
    try {
      if (Test-Path -LiteralPath $exe) {
        Start-Process -FilePath $exe
      }
    } catch {}
    if ($i -ge 44) { throw }
  }
}
throw '补丁写入超时'
`.trim()
  fs.writeFileSync(updaterScriptPath, script, 'utf8')

  const detached = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', updaterScriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  detached.unref()

  setTimeout(() => app.quit(), 300)
  return {
    version: manifest.version,
    restarting: true,
    backupPath: backupFilePath,
    databasePath: workspaceInfo.database_path
  }
}

function readImageAsDataUri(imagePath) {
  if (!imagePath) return ''
  if (String(imagePath).startsWith('data:image/')) return String(imagePath)
  const normalized = imagePath.replace(/^file:\/\//, '')
  if (!fs.existsSync(normalized)) return ''
  const ext = path.extname(normalized).slice(1).toLowerCase() || 'png'
  const base64 = fs.readFileSync(normalized).toString('base64')
  return `data:image/${ext};base64,${base64}`
}

async function withTempHtmlWindow(html, callback) {
  const tempHtmlPath = path.join(os.tmpdir(), `garment-ems-${Date.now()}-${Math.random().toString(16).slice(2)}.html`)
  fs.writeFileSync(tempHtmlPath, html, 'utf8')

  const tempWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: false
    }
  })

  try {
    await tempWindow.loadFile(tempHtmlPath)
    await tempWindow.webContents.executeJavaScript(
      `new Promise((resolve) => {
        const done = () => setTimeout(resolve, 220)
        if (document.readyState === 'complete') {
          done()
        } else {
          window.addEventListener('load', done, { once: true })
        }
      })`
    )
    return await callback(tempWindow)
  } finally {
    if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath)
    if (!tempWindow.isDestroyed()) await tempWindow.close()
  }
}

async function prepareExportWindow(targetWindow, options = {}) {
  const zoomFactor = Math.max(1, Number(options.zoomFactor || 1))
  const baseWidth = Math.max(1100, Number(options.baseWidth || 1400))
  const baseHeight = Math.max(700, Number(options.baseHeight || 900))
  targetWindow.setContentSize(baseWidth, baseHeight)
  targetWindow.webContents.setZoomFactor(zoomFactor)

  await targetWindow.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const finish = () => setTimeout(resolve, 220)
      const waitFonts = document.fonts?.ready || Promise.resolve()
      const images = Array.from(document.images || [])
      const waitImages = Promise.all(images.map((img) => {
        if (img.complete) return Promise.resolve()
        return new Promise((done) => {
          img.addEventListener('load', done, { once: true })
          img.addEventListener('error', done, { once: true })
          setTimeout(done, 2000)
        })
      }))
      Promise.all([waitFonts, waitImages]).then(() => {
        document.documentElement.style.background = '#ffffff'
        document.body.style.background = '#ffffff'
        document.documentElement.style.margin = '0'
        document.documentElement.style.overflow = 'visible'
        document.documentElement.style.width = 'auto'
        document.body.style.overflow = 'visible'
        document.body.style.margin = '0'
        document.body.style.padding = '0'
        const root =
          document.querySelector('.export-page')
          || document.querySelector('.sheet')
          || document.querySelector('.document-sheet')
          || document.querySelector('.page')
          || document.body.firstElementChild
          || document.body
        if (root) {
          root.style.boxSizing = 'border-box'
          root.style.margin = '0 auto'
          root.style.background = '#ffffff'
        }
        const autoFitRoots = Array.from(document.querySelectorAll('[data-auto-fit="card"]'))
        autoFitRoots.forEach((fitRoot) => {
          const surface = fitRoot.querySelector('.fit-surface') || fitRoot.firstElementChild || fitRoot
          if (!surface) return
          const preferredWidth = Math.max(1, Number(fitRoot.getAttribute('data-fit-width') || 0))
          fitRoot.style.overflow = 'visible'
          if (preferredWidth > 0) {
            fitRoot.style.width = String(preferredWidth) + 'px'
            fitRoot.style.maxWidth = String(preferredWidth) + 'px'
          }
          surface.style.transform = 'none'
          surface.style.transformOrigin = 'top left'
          surface.style.display = 'block'
          surface.style.width = 'max-content'
          surface.style.maxWidth = 'none'
          const availableWidth = Math.max(1, Math.floor(fitRoot.clientWidth || fitRoot.getBoundingClientRect().width || 0))
          const naturalWidth = Math.max(
            1,
            Math.ceil(surface.scrollWidth || 0),
            Math.ceil(surface.getBoundingClientRect().width || 0),
            Math.ceil(document.documentElement.scrollWidth || 0),
            Math.ceil(document.body.scrollWidth || 0)
          )
          const scale = Math.min(1, (availableWidth - 2) / naturalWidth)
          if (scale < 0.999) {
            surface.style.width = String(naturalWidth) + 'px'
            surface.style.transform = 'scale(' + String(scale) + ')'
            fitRoot.style.minHeight = String(Math.ceil((surface.scrollHeight || surface.getBoundingClientRect().height || 0) * scale)) + 'px'
          } else {
            surface.style.width = '100%'
            surface.style.maxWidth = '100%'
            fitRoot.style.minHeight = '0'
          }
        })
        const style = document.createElement('style')
        style.innerHTML = '::-webkit-scrollbar{width:0!important;height:0!important;display:none!important} html,body{scrollbar-width:none!important;}'
        document.head.appendChild(style)
        finish()
      })
    })
  `)

  const pageSize = await targetWindow.webContents.executeJavaScript(`
    (() => {
      const target =
        document.querySelector('.export-page')
        || document.querySelector('.sheet')
        || document.querySelector('.document-sheet')
        || document.querySelector('.page')
        || document.body.firstElementChild
        || document.body
      const rect = target.getBoundingClientRect()
      return {
        width: Math.max(
          Math.ceil(rect.width),
          target.scrollWidth || 0,
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
          ${baseWidth}
        ),
        height: Math.max(
          Math.ceil(rect.height),
          target.scrollHeight || 0,
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          ${baseHeight}
        )
      }
    })()
  `)

  const finalWidth = Math.min(6200, Math.ceil(Number(pageSize.width || baseWidth) + 24))
  const finalHeight = Math.min(26000, Math.ceil(Number(pageSize.height || baseHeight) + 24))
  targetWindow.setContentSize(finalWidth, finalHeight)
  await new Promise((resolve) => setTimeout(resolve, 220))

  return targetWindow.webContents.executeJavaScript(`
    (() => {
      const target =
        document.querySelector('.export-page')
        || document.querySelector('.sheet')
        || document.querySelector('.document-sheet')
        || document.querySelector('.page')
        || document.body.firstElementChild
        || document.body
      const rect = target.getBoundingClientRect()
      return {
        x: Math.max(0, Math.floor(rect.left)),
        y: Math.max(0, Math.floor(rect.top)),
        width: Math.max(Math.ceil(rect.width), target.scrollWidth || 0, ${finalWidth}),
        height: Math.max(Math.ceil(rect.height), target.scrollHeight || 0, ${finalHeight})
      }
    })()
  `)
}

function baseStyles() {
  return `
    body {
      font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      color: #2e241b;
      padding: 28px;
      font-size: 12px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
    }
    .title {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(180px, 1fr));
      gap: 8px 18px;
      max-width: 760px;
    }
    .card {
      border: 1px solid #d8cfc3;
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 18px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid #d8cfc3;
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f4ede3;
    }
    .remark {
      white-space: pre-wrap;
      line-height: 1.8;
    }
    .tips {
      color: #8b6a49;
      line-height: 1.8;
    }
  `
}

function buildFactoryOrderHtml(order, options = {}) {
  const isExcel = Boolean(options.excel)
  const includeProcessFee = Boolean(options.include_process_fee || options.includeProcessFee)
  const imageData = readImageAsDataUri(order.image_path)
  const planItemDetailMap = new Map(
    (order.planItems || []).map((item) => [
      `${item.material_id || item.materialId}__${item.material_color || item.materialColor || ''}`,
      item
    ])
  )
  const planItemImageMap = new Map(
    (order.planItems || []).map((item) => [
      `${item.material_id || item.materialId}__${item.material_color || item.materialColor || ''}`,
      item.material_image_path || item.materialImagePath || ''
    ])
  )

  const planItems = (order.factoryDocument?.materials || order.planItems || []).map((item) => {
    const key = `${item.material_id || item.materialId}__${item.material_color || item.materialColor || ''}`
    const detailItem = planItemDetailMap.get(key) || {}
    const materialImagePath = item.material_image_path
      || item.materialImagePath
      || planItemImageMap.get(key)
      || ''

    return {
      ...detailItem,
      ...item,
      usageModeLabel: item.usageModeLabel || item.usage_mode_label || detailItem.usageModeLabel || detailItem.usage_mode_label || '-',
      materialComposition: item.materialComposition || item.material_composition || detailItem.materialComposition || detailItem.material_composition || '',
      materialWidth: Number(item.materialWidth || item.material_width || detailItem.materialWidth || detailItem.material_width || 0),
      materialWeight: Number(item.materialWeight || item.material_weight || detailItem.materialWeight || detailItem.material_weight || 0),
      processingRequirements: item.processingRequirements || item.processing_requirements || detailItem.processingRequirements || detailItem.processing_requirements || [],
      actualIssuedUnit: item.actualIssuedUnit || item.actual_issued_unit || detailItem.actualIssuedUnit || detailItem.actual_issued_unit || item.materialUnit || item.material_unit || '',
      materialImagePath,
      materialImageData: readImageAsDataUri(materialImagePath)
    }
  })

  const hasMaterialImages = planItems.some((item) => item.materialImageData)
  const sizeBreakdown = parseSizeBreakdown(order.size_breakdown || order.factoryDocument?.sizeBreakdown || '', order.quantity)
  const sizeEntries = sizeBreakdown.entries.length ? sizeBreakdown.entries : [{ size: '总数', qty: Number(order.quantity || 0) }]
  const sizeCellCount = Math.max(sizeEntries.length, 4)
  const paddedSizeEntries = Array.from({ length: sizeCellCount }, (_, index) => sizeEntries[index] || { size: '', qty: '' })
  const sizeHeaderCells = paddedSizeEntries
    .map((item) => `<th class="size-head">${item.size ? escapeHtml(item.size) : '&nbsp;'}</th>`)
    .join('')
  const sizeValueCells = paddedSizeEntries
    .map((item) => `<td class="size-value">${item.size ? escapeHtml(String(item.qty)) : '&nbsp;'}</td>`)
    .join('')
  const processFeeMetaRows = includeProcessFee
    ? `
                <tr>
                  <th class="meta-label">加工费</th>
                  <td class="meta-value">${escapeHtml(`${formatFixed(order.process_fee || 0, 4)} 元/件`)}</td>
                  <th class="meta-label">加工费小计</th>
                  <td class="meta-value" colspan="2">${escapeHtml(`${formatFixed(Number(order.process_cost || 0), 2)} 元`)}</td>
                </tr>
      `
    : ''

  const widthWeightLabel = (item) => {
    const parts = []
    if (Number(item.materialWidth || 0) > 0) parts.push(`门幅 ${formatFixed(item.materialWidth, 0)}cm`)
    if (Number(item.materialWeight || 0) > 0) parts.push(`克重 ${formatFixed(item.materialWeight, 0)}g/m²`)
    return parts.join(' / ') || '-'
  }

  const processingText = (item) => {
    const values = Array.isArray(item.processingRequirements)
      ? item.processingRequirements
      : String(item.processingRequirements || '').split(/[,\n/]/).map((part) => part.trim()).filter(Boolean)
    return values.join('、') || '-'
  }

  const materialRows = planItems.length
    ? planItems
        .map(
          (item, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(item.materialRole || item.material_role || '-')}</td>
              <td class="mono">${escapeHtml(item.materialCode || item.material_code || '-')}</td>
              <td class="text-left material-name">${escapeHtml(item.materialName || item.material_name || '-')}</td>
              <td>${escapeHtml(item.materialColor || item.material_color || '-')}</td>
              <td>${escapeHtml(widthWeightLabel(item))}</td>
              <td class="text-left material-name">${escapeHtml(item.materialComposition || '-')}</td>
              <td>${escapeHtml(item.supplyModeLabel || (item.supply_mode === 'factory_supply' ? '工厂自配' : (item.supply_mode === 'our_supply' ? '我方提供' : '-')))}</td>
              <td>${escapeHtml(item.usageModeLabel || '-')}</td>
              <td class="number-cell">${formatFixed(item.usagePerPiece ?? item.usage ?? 0, 2)} ${escapeHtml(item.usageUnit || item.usage_unit || '米')}</td>
              <td class="number-cell">${formatFixed(item.requiredQty || 0)} ${escapeHtml(item.materialUnit || item.material_unit || '')}</td>
              <td class="text-left material-name">${escapeHtml(processingText(item))}</td>
            </tr>
          `
        )
        .join('')
    : `
      <tr>
        <td colspan="12" class="empty-row">暂无用料明细</td>
      </tr>
    `

  const materialImageRows = hasMaterialImages
    ? planItems
        .filter((item) => item.materialImageData)
        .map(
          (item, index) => `
            <tr>
              <td>${index + 1}</td>
              <td class="mono">${escapeHtml(item.materialCode || item.material_code || '-')}</td>
              <td class="text-left">${escapeHtml(item.materialName || item.material_name || '-')}</td>
              <td>${escapeHtml(item.materialColor || item.material_color || '-')}</td>
              <td class="image-cell"><img class="line-image" src="${item.materialImageData}" alt="material" /></td>
            </tr>
          `
        )
        .join('')
    : ''

  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        ${isExcel ? '<meta name="ProgId" content="Excel.Sheet" />' : ''}
        <title>${escapeHtml(order.order_no)}</title>
        <style>
          ${baseStyles()}
          @page {
            size: A4 landscape;
            margin: 8mm;
          }
          body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #1f2937;
            font-size: ${isExcel ? '11.5px' : '13px'};
          }
          .page {
            page-break-after: always;
          }
          .page:last-child {
            page-break-after: auto;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          th, td {
            border: 1px solid #1f2937;
            padding: ${isExcel ? '6px 8px' : '8px 10px'};
            vertical-align: middle;
            box-sizing: border-box;
          }
          .sheet {
            border: 1.5px solid #1f2937;
          }
          .section-band,
          .image-table th,
          .material-table th,
          .size-head,
          .meta-label {
            background: #f5efe6;
            font-weight: 700;
            text-align: center;
          }
          .sheet-header td {
            padding: ${isExcel ? '8px 10px' : '10px 12px'};
          }
          .sheet-title {
            text-align: center;
            font-size: ${isExcel ? '20px' : '30px'};
            font-weight: 700;
            letter-spacing: 1px;
          }
          .sheet-copy {
            width: 112px;
            text-align: center;
            font-size: ${isExcel ? '11px' : '12px'};
            line-height: 1.45;
            white-space: nowrap;
          }
          .section-band {
            padding: ${isExcel ? '6px 8px' : '8px 10px'};
            font-size: ${isExcel ? '12px' : '15px'};
          }
          .meta-table td,
          .meta-table th,
          .size-table td,
          .size-table th,
          .material-table td,
          .material-table th,
          .remark-table td,
          .remark-table th {
            border: 1px solid #1f2937;
            padding: ${isExcel ? '6px 8px' : '8px 10px'};
          }
          .meta-label {
            width: 96px;
          }
          .meta-value {
            background: #fffdfa;
          }
          .thumb-cell {
            width: 8.6cm;
            background: #fffdfa;
            padding: ${isExcel ? '10px 8px' : '12px 10px'};
          }
          .thumb-box {
            width: 8cm;
            height: 8cm;
            margin: 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f8f4ed;
            overflow: hidden;
          }
          .thumb-image {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
          }
          .empty-box {
            color: #9a7d60;
            font-size: 12px;
          }
          .size-table td {
            background: #fffdfa;
            text-align: center;
          }
          .size-label {
            width: 88px;
            background: #f5efe6;
            font-weight: 700;
            text-align: center;
          }
          .size-head {
            font-size: ${isExcel ? '10.5px' : '12px'};
          }
          .size-value {
            font-size: ${isExcel ? '10.5px' : '12px'};
            min-width: 56px;
          }
          .size-total {
            width: 72px;
            background: #f5efe6;
            font-weight: 700;
          }
          .size-total-value {
            width: 86px;
            font-weight: 700;
          }
          .material-table th {
            font-size: ${isExcel ? '10.5px' : '12px'};
          }
          .material-table td {
            background: #ffffff;
            text-align: center;
            font-size: ${isExcel ? '10.5px' : '11.5px'};
            line-height: 1.45;
            overflow-wrap: anywhere;
            word-break: break-word;
            white-space: normal;
          }
          .material-table .text-left,
          .image-table .text-left {
            text-align: left;
          }
          .mono {
            font-family: 'Consolas', 'Segoe UI', monospace;
            white-space: nowrap;
          }
          .material-name {
            font-size: ${isExcel ? '10px' : '11px'};
            line-height: 1.35;
            white-space: normal;
            word-break: break-all;
            overflow-wrap: anywhere;
          }
          .number-cell {
            white-space: nowrap;
          }
          .remark-table td {
            background: #fffdfa;
            vertical-align: top;
            line-height: 1.7;
          }
          .remark-body {
            white-space: pre-wrap;
            min-height: 54px;
          }
          .empty-row {
            padding: 16px 8px;
            text-align: center;
            color: #8b6a49;
            background: #fffdfa !important;
          }
          .image-page-title {
            font-size: ${isExcel ? '18px' : '24px'};
            font-weight: 700;
            text-align: center;
            margin-bottom: 10px;
          }
          .image-page-sub {
            text-align: center;
            color: #6b7280;
            margin-bottom: 14px;
          }
          .image-table th {
            background: #f5efe6;
          }
          .image-table td {
            background: #ffffff;
            text-align: center;
            padding: ${isExcel ? '6px 8px' : '8px 10px'};
            white-space: normal;
            word-break: break-all;
            overflow-wrap: anywhere;
          }
          .image-table .mono {
            white-space: normal;
            word-break: break-all;
            overflow-wrap: anywhere;
          }
          .image-cell {
            width: ${isExcel ? '88px' : '100px'};
          }
          .line-image {
            width: ${isExcel ? '44px' : '56px'};
            height: ${isExcel ? '44px' : '56px'};
            object-fit: contain;
            background: #f8f4ed;
            padding: 4px;
          }
        </style>
      </head>
      <body>
        <div class="export-page page">
          <div class="sheet">
            <table class="sheet-header">
              <tr>
                <td class="sheet-title">工厂生产制单</td>
                <td class="sheet-copy">Factory Copy<br />内部版本</td>
              </tr>
            </table>

            <table>
              <tr>
                <td class="section-band">一、基本信息</td>
              </tr>
            </table>

            <table class="meta-table">
              <colgroup>
                <col style="width: 88px;" />
                <col />
                <col style="width: 88px;" />
                <col style="width: 20%;" />
                <col style="width: 8.6cm;" />
              </colgroup>
              <tbody>
                <tr>
                  <th class="meta-label">成衣编号</th>
                  <td class="meta-value">${escapeHtml(order.style_code || '-')}</td>
                  <th class="meta-label">制单号</th>
                  <td class="meta-value">${escapeHtml(order.order_no || '-')}</td>
                  <td class="thumb-cell" rowspan="4">
                    <div class="thumb-box">
                      ${imageData ? `<img class="thumb-image" src="${imageData}" alt="product" />` : '<div class="empty-box">未设置成衣图片</div>'}
                    </div>
                  </td>
                </tr>
                <tr>
                  <th class="meta-label">成衣名称</th>
                  <td class="meta-value">${escapeHtml(order.garment_name || '-')}</td>
                  <th class="meta-label">品类</th>
                  <td class="meta-value">${escapeHtml(order.garment_category || '-')}</td>
                </tr>
                <tr>
                  <th class="meta-label">加工厂</th>
                  <td class="meta-value">${escapeHtml(order.factory_name || '-')}</td>
                  <th class="meta-label">制单数量</th>
                  <td class="meta-value">${escapeHtml(`${Number(order.quantity || 0)} 件`)}</td>
                </tr>
                <tr>
                  <th class="meta-label">交期</th>
                  <td class="meta-value">${escapeHtml(order.delivery_date || '-')}</td>
                  <th class="meta-label">状态</th>
                  <td class="meta-value">${escapeHtml(order.status || '-')}</td>
                </tr>
                ${processFeeMetaRows}
              </tbody>
            </table>

            <table>
              <tr>
                <td class="section-band">二、尺码分配</td>
              </tr>
            </table>

            <table class="size-table">
              <tbody>
                <tr>
                  <th class="size-label">尺码</th>
                  ${sizeHeaderCells}
                  <th class="size-total">合计</th>
                </tr>
                <tr>
                  <th class="size-label">数量</th>
                  ${sizeValueCells}
                  <td class="size-total-value">${escapeHtml(String(sizeBreakdown.total || Number(order.quantity || 0) || 0))}</td>
                </tr>
                <tr>
                  <th class="size-label">说明</th>
                  <td colspan="${sizeCellCount + 1}" class="text-left">${formatMultilineHtml(sizeBreakdown.displayText, '-')}</td>
                </tr>
              </tbody>
            </table>

            <table>
              <tr>
                <td class="section-band">三、面料与辅料信息</td>
              </tr>
            </table>

            <table class="material-table">
              <colgroup>
                <col style="width: 46px;" />
                <col style="width: 78px;" />
                <col style="width: 92px;" />
                <col style="width: 128px;" />
                <col style="width: 74px;" />
                <col style="width: 78px;" />
                <col style="width: 120px;" />
                <col style="width: 90px;" />
                <col style="width: 84px;" />
                <col style="width: 78px;" />
                <col style="width: 100px;" />
                <col style="width: 106px;" />
                <col style="width: 120px;" />
              </colgroup>
              <thead>
                <tr>
                  <th>序号</th>
                  <th>用料类型</th>
                  <th>原料编码</th>
                  <th>原料名称</th>
                  <th>颜色</th>
                  <th>门幅克重</th>
                  <th>原料成分</th>
                  <th>供料方式</th>
                  <th>计料方式</th>
                  <th>单件用量</th>
                  <th>预估投料</th>
                  <th>处理要求</th>
                </tr>
              </thead>
              <tbody>${materialRows}</tbody>
            </table>

            <table class="remark-table">
              <tbody>
                <tr>
                  <th class="meta-label">本单备注</th>
                  <td>
                    <div class="remark-body">${formatMultilineHtml(order.remark, '-')}</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        ${hasMaterialImages ? `
          <div class="export-page page">
            <div class="image-page-title">原料图片对照</div>
            <div class="image-page-sub">原料编码 / 名称 / 颜色 / 图片</div>
            <table class="image-table">
              <colgroup>
                <col style="width: 52px;" />
                <col style="width: 130px;" />
                <col />
                <col style="width: 120px;" />
                <col style="width: ${isExcel ? '110px' : '140px'};" />
              </colgroup>
              <thead>
                <tr>
                  <th>序号</th>
                  <th>原料编码</th>
                  <th>原料名称</th>
                  <th>颜色</th>
                  <th>图片</th>
                </tr>
              </thead>
              <tbody>${materialImageRows}</tbody>
            </table>
          </div>
        ` : ''}
      </body>
    </html>
  `
}

function buildPurchaseOrderHtml(document, options = {}) {
  const isExcel = Boolean(options.excel)
  const exportOptions = getPurchaseExportRenderOptions(options)
  const items = (document.items || []).map((item) => ({
    ...item,
    materialImageData: readImageAsDataUri(item.material_image_path)
  }))
  if (exportOptions.isCardLayout) {
    const cardItems = items.map((item) => ({
      ...item,
      remarkText: [buildPurchaseItemRemark(item), item.display_size ? `尺码：${item.display_size}` : '']
        .filter(Boolean)
        .join('\n')
    }))
    const hasMaterialImages = cardItems.some((item) => item.materialImageData)
    const showItemRemark = exportOptions.show_item_remark
    const showOrderRemark = exportOptions.show_order_remark
    const cardRemarkRows = cardItems
      .map((item) => {
        if (!String(item.remarkText || '').trim()) return ''
        return `
          <div class="remark-item">
            <div class="remark-item__title">#${item.seqNo} ${escapeHtml(item.material_code || '-')} / ${escapeHtml(item.color || '-')}</div>
            <div class="remark-item__content">${formatMultilineHtml(item.remarkText, '-')}</div>
          </div>
        `
      })
      .filter(Boolean)
      .join('')
    const cardRows = cardItems
      .map(
        (item) => `
          <tr>
            <td class="center-cell">${item.seqNo}</td>
            ${hasMaterialImages ? `
              <td class="thumb-cell">
                ${item.materialImageData ? `
                  <div class="thumb-box">
                    <div class="purchase-thumb-media" style="background-image:url('${item.materialImageData}')"></div>
                  </div>
                ` : '<div class="thumb-box thumb-box--empty"></div>'}
              </td>
            ` : ''}
            <td class="code-cell">${escapeHtml(item.material_code || '-')}</td>
            <td>${escapeHtml(item.color || '-')}</td>
            <td class="number-cell">${formatFixedTrimmed(item.display_qty || item.gross_qty || 0, 2)}</td>
            <td class="center-cell">${escapeHtml(item.display_unit || item.price_unit || item.unit || '-')}</td>
            <td class="number-cell">${formatFixedTrimmed(item.price || 0, 2)} / ${escapeHtml(item.price_unit || item.unit || '')}</td>
            ${showItemRemark ? `<td class="remark-cell">${formatMultilineHtml(item.remarkText, '-')}</td>` : ''}
          </tr>
        `
      )
      .join('')
    const orderRemarkText = String(document.remark || '').trim()
    const cardCols = `
      <col style="width: 42px;" />
      ${hasMaterialImages ? '<col style="width: 72px;" />' : ''}
      <col style="width: 190px;" />
      <col style="width: 84px;" />
      <col style="width: 94px;" />
      <col style="width: 46px;" />
      <col style="width: 78px;" />
      ${showItemRemark ? '<col style="width: auto;" />' : ''}
    `

    return `
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8" />
          ${isExcel ? '<meta name="ProgId" content="Excel.Sheet" />' : ''}
          <title>${escapeHtml(document.purchaseOrderNo)}</title>
          <style>
            ${baseStyles()}
            @page {
              size: A5 landscape;
              margin: 8mm;
            }
            body {
              margin: 0;
              padding: 0;
              background: #ffffff;
              color: #2a2118;
              font-size: 11px;
              overflow: visible;
              box-sizing: border-box;
            }
            .sheet {
              width: 760px;
              max-width: 760px;
              margin: 0 auto;
              padding: 8px 10px;
              box-sizing: border-box;
            }
            .title {
              margin: 0 0 10px;
              font-size: 30px;
              line-height: 1.1;
              font-weight: 800;
              letter-spacing: 0.5px;
              color: #2f241a;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 6px 26px;
              margin-bottom: 12px;
              font-size: 11px;
              line-height: 1.35;
            }
            .meta-item,
            .meta-item strong,
            .panel,
            .panel-title,
            table,
            th,
            td,
            .remark-item__title,
            .remark-item__content,
            .order-remark__content {
              overflow-wrap: anywhere;
              word-break: break-word;
            }
            .meta-item strong {
              color: #6a4b24;
            }
            .panel {
              border: 1.5px solid #d7c8b5;
              border-radius: 14px;
              padding: 12px 14px;
              background: #fffdfa;
              margin-bottom: 10px;
            }
            .panel-title {
              margin: 0 0 10px;
              font-size: 18px;
              line-height: 1.2;
              font-weight: 800;
              color: #2f241a;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }
            th, td {
              border: 1px solid #d7c8b5;
              padding: 5px 6px;
              vertical-align: top;
              line-height: 1.22;
              word-break: break-word;
              overflow: hidden;
              background: #ffffff;
            }
            th {
              background: #f4ecdf;
              color: #2f241a;
              font-size: 11px;
              font-weight: 800;
              text-align: left;
            }
            td {
              font-size: 11px;
            }
            .center-cell {
              text-align: center;
              white-space: nowrap;
            }
            .number-cell {
              text-align: right;
              white-space: nowrap;
              font-variant-numeric: tabular-nums;
            }
            .code-cell {
              font-weight: 700;
            }
            .thumb-cell {
              width: 72px;
              min-width: 72px;
              max-width: 72px;
              padding: 4px !important;
              text-align: center;
              vertical-align: middle;
              height: 66px;
            }
            .thumb-box {
              display: flex;
              align-items: center;
              justify-content: center;
              width: 52px;
              height: 52px;
              min-width: 52px;
              min-height: 52px;
              max-width: 52px;
              max-height: 52px;
              margin: 0 auto;
              overflow: hidden;
              border: 1px solid #d8cfc3;
              border-radius: 10px;
              background: #f8f6f1;
              box-sizing: border-box;
            }
            .purchase-thumb-media {
              width: 100%;
              height: 100%;
              background-repeat: no-repeat;
              background-position: center center;
              background-size: contain;
            }
            .thumb-box--empty {
              background: #fbfaf7;
            }
            .remarks-block {
              margin-top: 10px;
              padding-top: 10px;
              border-top: 1px dashed #d7c8b5;
            }
            .remarks-title {
              margin-bottom: 4px;
              font-size: 11px;
              font-weight: 800;
              color: #6a4b24;
            }
            .remark-item {
              margin-bottom: 8px;
            }
            .remark-item__title {
              font-size: 11px;
              font-weight: 700;
              color: #6a4b24;
              margin-bottom: 2px;
            }
            .remark-cell,
            .remark-item__content,
            .order-remark__content {
              min-height: 0;
              font-size: 10.5px;
              line-height: 1.28;
              white-space: normal;
              word-break: break-word;
              color: #403328;
            }
          </style>
        </head>
        <body>
          <div class="sheet">
            <div class="fit-surface">
            <h1 class="title">原料采购单</h1>
            <div class="meta-grid">
              <div class="meta-item"><strong>供应商：</strong>${escapeHtml(document.supplier || '-')}</div>
              <div class="meta-item"><strong>采购单号：</strong>${escapeHtml(document.purchaseOrderNo || '-')}</div>
              <div class="meta-item"><strong>到货日期：</strong>${escapeHtml(document.receivedAt || '-')}</div>
              <div class="meta-item"><strong>明细行数：</strong>${Number((document.items || []).length || 0)}</div>
            </div>
            <div class="panel">
              <div class="panel-title">采购明细</div>
              <table>
                <colgroup>${cardCols}</colgroup>
                <thead>
                  <tr>
                    <th class="center-cell">序号</th>
                    ${hasMaterialImages ? '<th class="center-cell">图片</th>' : ''}
                    <th>原料编码</th>
                    <th>颜色</th>
                    <th>采购数量</th>
                    <th>单位</th>
                    <th>单价</th>
                    ${showItemRemark ? '<th>备注</th>' : ''}
                  </tr>
                </thead>
                <tbody>${cardRows}</tbody>
              </table>
              <div class="remarks-block">
                ${!showItemRemark && cardRemarkRows ? `
                  <div class="remarks-title">明细备注</div>
                  ${cardRemarkRows}
                ` : ''}
                ${showOrderRemark ? `
                  <div class="remarks-title">采购单备注</div>
                  <div class="order-remark__content">${formatMultilineHtml(orderRemarkText, '-')}</div>
                ` : ''}
              </div>
            </div>
            </div>
          </div>
        </body>
      </html>
    `
  }
  const hasMaterialImages = exportOptions.show_images && items.some((item) => item.materialImageData)
  const showMaterialName = exportOptions.show_material_name
  const showColor = exportOptions.show_color
  const showPriceType = exportOptions.show_price_type
  const showUnitPrice = exportOptions.show_unit_price
  const showItemRemark = exportOptions.show_item_remark
  const visibleColumnCount = 4 + (hasMaterialImages ? 1 : 0) + 1 + (showMaterialName ? 1 : 0) + (showColor ? 1 : 0) + (showPriceType ? 1 : 0) + (showUnitPrice ? 1 : 0) + (showItemRemark ? 1 : 0)
  const rowCount = items.length || 1
  const compactLevel = exportOptions.isCardLayout
    ? (rowCount >= 6 || visibleColumnCount >= 8 ? 2 : rowCount >= 4 || visibleColumnCount >= 7 ? 1 : 0)
    : 0
  const maxWidth = exportOptions.isCardLayout
    ? 790
    : 1080
  const rowImageBoxSize = exportOptions.isCardLayout ? 52 : 64
  const rows = items
    .map(
      (item) => `
      <tr>
        <td>${item.seqNo}</td>
        ${hasMaterialImages ? `<td class="image-td" style="text-align:center;vertical-align:middle;padding:3px !important;overflow:hidden !important;">${item.materialImageData ? `<div class="image-box" style="width:${rowImageBoxSize}px;height:${rowImageBoxSize}px;min-width:${rowImageBoxSize}px;min-height:${rowImageBoxSize}px;max-width:${rowImageBoxSize}px;max-height:${rowImageBoxSize}px;margin:0 auto;overflow:hidden !important;background:#f8f6f1;border:1px solid #d7c8b5;border-radius:10px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;"><div class="purchase-image-media" style="background-image:url('${item.materialImageData}')"></div></div>` : ''}</td>` : ''}
        <td>${escapeHtml(item.material_code || '')}</td>
        ${showMaterialName ? `<td>${escapeHtml(item.material_name || '-')}</td>` : ''}
        ${showColor ? `<td>${escapeHtml(item.color || '-')}</td>` : ''}
        <td class="number-cell">${formatFixedTrimmed(item.display_qty || item.gross_qty || 0, 2)}</td>
        <td>${escapeHtml(item.display_unit || item.price_unit || item.unit || '')}</td>
        ${showPriceType ? `<td>${escapeHtml(item.priceTypeLabel || '-')}</td>` : ''}
        ${showUnitPrice ? `<td class="number-cell">${formatFixedTrimmed(item.price || 0, 2)} / ${escapeHtml(item.price_unit || item.unit || '')}</td>` : ''}
        ${showItemRemark ? `<td class="remark">${formatMultilineHtml([buildPurchaseItemRemark(item), item.display_size ? `尺码：${item.display_size}` : ''].filter(Boolean).join('\n'), '-')}</td>` : ''}
      </tr>
    `
    )
    .join('')

  const orderRemarkHtml = exportOptions.show_order_remark
    ? formatMultilineHtml(document.remark, '-')
    : ''
  const cardHeaderCols = `
    <col style="width: 42px;" />
    ${hasMaterialImages ? '<col style="width: 66px;" />' : ''}
    <col style="width: 96px;" />
    ${showMaterialName ? '<col style="width: 88px;" />' : ''}
    ${showColor ? '<col style="width: 72px;" />' : ''}
    <col style="width: 82px;" />
    <col style="width: 54px;" />
    ${showPriceType ? '<col style="width: 72px;" />' : ''}
    ${showUnitPrice ? '<col style="width: 88px;" />' : ''}
    ${showItemRemark ? '<col style="width: auto;" />' : ''}
  `

  if (!exportOptions.isCardLayout) {
    const a4HeaderCols = `
      <col style="width: 50px;" />
      ${hasMaterialImages ? '<col style="width: 72px;" />' : ''}
      <col style="width: 132px;" />
      ${showMaterialName ? '<col style="width: 62px;" />' : ''}
      ${showColor ? '<col style="width: 62px;" />' : ''}
      <col style="width: 84px;" />
      <col style="width: 42px;" />
      ${showPriceType ? '<col style="width: 66px;" />' : ''}
      ${showUnitPrice ? '<col style="width: 68px;" />' : ''}
      ${showItemRemark ? '<col style="width: auto;" />' : ''}
    `

    return `
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8" />
          ${isExcel ? '<meta name="ProgId" content="Excel.Sheet" />' : ''}
          <title>${escapeHtml(document.purchaseOrderNo)}</title>
          <style>
            ${baseStyles()}
            @page {
              size: A4 portrait;
              margin: 8mm;
            }
            body {
              margin: 0;
              padding: 0;
              background: #ffffff;
              color: #2b2118;
              font-size: ${isExcel ? '10px' : '11px'};
            }
            .sheet {
              width: 100%;
              max-width: ${isExcel ? '980px' : `${maxWidth}px`};
              margin: 0 auto;
            }
            .title {
              font-size: ${isExcel ? '28px' : '34px'};
              font-weight: 800;
              letter-spacing: 1px;
              margin: 0 0 10px;
              color: #2f241a;
            }
            .header-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 2px 28px;
              margin-bottom: 12px;
            }
            .header-item {
              display: flex;
              align-items: baseline;
              gap: 6px;
              min-height: 24px;
            }
            .header-label {
              font-weight: 700;
              color: #6a4b24;
              white-space: nowrap;
            }
            .header-value {
              font-weight: 600;
              word-break: break-all;
            }
            .panel {
              border: 1.5px solid #d7c8b5;
              border-radius: 16px;
              padding: 12px 14px;
              margin-top: 10px;
              background: #fffefc;
            }
            .panel-title {
              font-size: 19px;
              font-weight: 800;
              margin: 0 0 10px;
              color: #2f241a;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }
            th, td {
              border: 1px solid #d7c8b5;
              padding: 5px 6px;
              vertical-align: top;
              word-break: break-word;
              line-height: 1.2;
              overflow: hidden;
            }
            th {
              background: #f4ecdf;
              color: #2f241a;
              font-size: ${isExcel ? '9px' : '9.5px'};
              font-weight: 800;
              text-align: left;
            }
            td {
              background: #ffffff;
              font-size: ${isExcel ? '8.8px' : '9.4px'};
            }
            .center { text-align: center; }
            .number-cell {
              text-align: right;
              white-space: nowrap;
              font-variant-numeric: tabular-nums;
            }
            .code-cell {
              font-weight: 700;
              color: #2f241a;
            }
            .remark {
              white-space: pre-wrap;
              word-break: break-word;
              overflow-wrap: anywhere;
              line-height: 1.18;
              color: #3f3328;
              font-size: ${isExcel ? '8.4px' : '8.9px'};
            }
            .remark-box {
              min-height: 48px;
              border: 1px solid #e2d6c7;
              border-radius: 12px;
              background: #fff;
              padding: 7px 9px;
            }
            .image-td {
              text-align: center;
              vertical-align: middle;
              width: 72px;
              min-width: 72px;
              max-width: 72px;
              padding: 4px !important;
              overflow: hidden;
            }
            .image-box {
              width: 56px;
              height: 56px;
              min-width: 56px;
              min-height: 56px;
              max-width: 56px;
              max-height: 56px;
              margin: 0 auto;
              box-sizing: border-box;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              background: #f8f6f1;
              border: 1px solid #d7c8b5;
              border-radius: 10px;
            }
            .purchase-image-media {
              width: 100%;
              height: 100%;
              background-repeat: no-repeat;
              background-position: center center;
              background-size: contain;
            }
          </style>
        </head>
        <body>
          <div class="sheet">
            <h1 class="title">原料采购单</h1>
            <div class="header-grid">
              <div class="header-item"><span class="header-label">供应商：</span><span class="header-value">${escapeHtml(document.supplier || '-')}</span></div>
              <div class="header-item"><span class="header-label">采购单号：</span><span class="header-value">${escapeHtml(document.purchaseOrderNo)}</span></div>
              <div class="header-item"><span class="header-label">到货日期：</span><span class="header-value">${escapeHtml(document.receivedAt || '-')}</span></div>
              <div class="header-item"><span class="header-label">明细行数：</span><span class="header-value">${Number((document.items || []).length || 0)}</span></div>
            </div>

            <div class="panel">
              <div class="panel-title">采购明细</div>
              <table>
                <colgroup>${a4HeaderCols}</colgroup>
                <thead>
                  <tr>
                    <th class="center">序号</th>
                    ${hasMaterialImages ? '<th class="center">图片</th>' : ''}
                    <th>原料编码</th>
                    ${showMaterialName ? '<th>名称</th>' : ''}
                    ${showColor ? '<th>颜色</th>' : ''}
                    <th>采购数量</th>
                    <th>单位</th>
                    ${showPriceType ? '<th>单价类型</th>' : ''}
                    ${showUnitPrice ? '<th>单价</th>' : ''}
                    ${showItemRemark ? '<th>备注</th>' : ''}
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>

            ${exportOptions.show_order_remark ? `
              <div class="panel">
                <div class="panel-title">采购单备注</div>
                <div class="remark-box remark">${formatMultilineHtml(document.remark, '-')}</div>
              </div>
            ` : ''}
          </div>
        </body>
      </html>
    `
  }

  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        ${isExcel ? '<meta name="ProgId" content="Excel.Sheet" />' : ''}
        <title>${escapeHtml(document.purchaseOrderNo)}</title>
        <style>
          ${baseStyles()}
          body {
            padding: ${isExcel ? '10px' : '16px'};
            font-size: ${exportOptions.isCardLayout ? (compactLevel >= 2 ? '8.5px' : compactLevel === 1 ? '9px' : (isExcel ? '9.5px' : '10px')) : (isExcel ? '11.5px' : '13px')};
            background: #ffffff;
            overflow: visible;
            box-sizing: border-box;
          }
          .sheet {
            width: 100%;
            max-width: ${isExcel ? `${Math.max(720, maxWidth - 40)}px` : `${maxWidth}px`};
            min-height: ${exportOptions.isCardLayout ? '503px' : 'auto'};
            margin: 0 auto;
            box-sizing: border-box;
          }
          table {
            table-layout: ${exportOptions.isCardLayout ? 'fixed' : 'auto'};
            width: 100%;
          }
          th, td {
            padding: ${exportOptions.isCardLayout ? (compactLevel >= 2 ? '3px' : compactLevel === 1 ? '5px' : '6px') : (isExcel ? '7px' : '9px')};
            word-break: break-word;
            line-height: ${exportOptions.isCardLayout ? '1.22' : '1.5'};
            vertical-align: top;
          }
          th:nth-child(1),
          td:nth-child(1) {
            width: ${exportOptions.isCardLayout ? '42px' : '52px'};
            text-align: center;
            white-space: nowrap;
          }
          .card-table {
            table-layout: fixed !important;
          }
          .card-table td,
          .card-table th {
            overflow: hidden;
          }
          .card {
            padding: ${exportOptions.isCardLayout ? (compactLevel >= 2 ? '6px 8px' : '8px 10px') : (isExcel ? '10px 12px' : '14px 16px')};
            margin-bottom: ${isExcel ? '12px' : '18px'};
            border-radius: ${isExcel ? '10px' : '14px'};
          }
          .title {
            font-size: ${exportOptions.isCardLayout ? (compactLevel >= 2 ? '18px' : '22px') : (isExcel ? '22px' : '30px')};
          }
          .meta {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px 18px;
            margin-top: ${exportOptions.isCardLayout ? '6px' : '10px'};
            font-size: ${exportOptions.isCardLayout ? (compactLevel >= 2 ? '8px' : '9px') : (isExcel ? '11px' : '12px')};
          }
          .meta strong {
            color: #5b3c14;
          }
          .image-td {
            padding: ${isExcel ? '4px' : '8px'} !important;
            text-align: center;
            vertical-align: middle;
            width: ${exportOptions.isCardLayout ? '66px' : 'auto'};
            min-width: ${exportOptions.isCardLayout ? '66px' : 'auto'};
            max-width: ${exportOptions.isCardLayout ? '66px' : 'auto'};
          }
          .image-box {
            width: ${exportOptions.isCardLayout ? (compactLevel >= 2 ? '44px' : compactLevel === 1 ? '52px' : (isExcel ? '52px' : '64px')) : (isExcel ? '88px' : '116px')};
            height: ${exportOptions.isCardLayout ? (compactLevel >= 2 ? '44px' : compactLevel === 1 ? '52px' : (isExcel ? '52px' : '64px')) : (isExcel ? '88px' : '116px')};
            margin: 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            background: #f6f2eb;
            border: 1px solid #d8cfc3;
            border-radius: 10px;
          }
          .line-image {
            max-width: 100%;
            max-height: 100%;
            width: 100%;
            height: 100%;
            object-fit: contain;
            image-rendering: auto;
          }
          .sub-cell {
            margin-top: 4px;
            color: #8b6a49;
            font-size: 11px;
          }
          .number-cell {
            white-space: nowrap;
            text-align: right;
            font-variant-numeric: tabular-nums;
          }
          .order-remark-card {
            border-top: 0;
            margin-top: -4px;
          }
          .section-title {
            font-size: ${exportOptions.isCardLayout ? (compactLevel >= 2 ? '13px' : '15px') : '20px'};
            margin-bottom: ${exportOptions.isCardLayout ? '6px' : '12px'};
          }
          .remark {
            font-size: ${exportOptions.isCardLayout ? (compactLevel >= 2 ? '9px' : '10px') : '13px'};
            line-height: ${exportOptions.isCardLayout ? '1.4' : '1.7'};
          }
          .inline-remark {
            margin-top: 8px;
            padding-top: 6px;
            border-top: 1px solid #d8cfc3;
          }
          .inline-remark__label {
            font-weight: 700;
            color: #6a4b24;
            margin-bottom: 4px;
          }
        </style>
      </head>
      <body>
        <div class="export-page sheet">
          <div class="header">
            <div>
              <div class="title">原料采购单</div>
              <div class="meta">
                <div><strong>供应商：</strong>${escapeHtml(document.supplier || '-')}</div>
                <div><strong>采购单号：</strong>${escapeHtml(document.purchaseOrderNo)}</div>
                <div>到货日期：${escapeHtml(document.receivedAt || '-')}</div>
                <div>明细行数：${Number((document.items || []).length || 0)}</div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="section-title">采购明细</div>
            <table class="${exportOptions.isCardLayout ? 'card-table' : ''}">
              ${exportOptions.isCardLayout ? `<colgroup>${cardHeaderCols}</colgroup>` : ''}
              <thead>
                <tr>
                  <th>序号</th>
                  ${hasMaterialImages ? '<th>图片</th>' : ''}
                  <th>原料编码</th>
                  ${showMaterialName ? '<th>名称</th>' : ''}
                  ${showColor ? '<th>颜色</th>' : ''}
                  <th>采购数量</th>
                  <th>单位</th>
                  ${showPriceType ? '<th>单价类型</th>' : ''}
                  ${showUnitPrice ? '<th>单价</th>' : ''}
                  ${showItemRemark ? '<th>备注</th>' : ''}
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            ${exportOptions.show_order_remark ? `
              <div class="inline-remark remark">
                <div class="inline-remark__label">采购单备注</div>
                <div>${orderRemarkHtml}</div>
              </div>
            ` : ''}
          </div>
        </div>
      </body>
    </html>
  `
}

function buildMergedPurchaseOrderHtml(documents = [], options = {}) {
  const isExcel = Boolean(options.excel)
  const exportOptions = getPurchaseExportRenderOptions(options)
  if (exportOptions.isCardLayout) {
    const sections = (documents || []).map((document) => {
      const items = (document.items || []).map((item) => ({
        ...item,
        materialImageData: readImageAsDataUri(item.material_image_path),
        remarkText: [buildPurchaseItemRemark(item), item.display_size ? `尺码：${item.display_size}` : '']
          .filter(Boolean)
          .join('\n')
      }))
      const hasMaterialImages = items.some((item) => item.materialImageData)
      const remarkRows = items
        .map((item) => {
          if (!String(item.remarkText || '').trim()) return ''
          return `
            <div class="remark-item">
              <div class="remark-item__title">#${item.seqNo} ${escapeHtml(item.material_code || '-')} / ${escapeHtml(item.color || '-')}</div>
              <div class="remark-item__content">${formatMultilineHtml(item.remarkText, '-')}</div>
            </div>
          `
        })
        .filter(Boolean)
        .join('')
      const rows = items
        .map(
          (item) => `
            <tr>
              <td class="center-cell">${item.seqNo}</td>
              ${hasMaterialImages ? `
                <td class="thumb-cell">
                  ${item.materialImageData ? `
                    <div class="thumb-box">
                      <div class="purchase-thumb-media" style="background-image:url('${item.materialImageData}')"></div>
                    </div>
                  ` : '<div class="thumb-box thumb-box--empty"></div>'}
                </td>
              ` : ''}
              <td class="code-cell">${escapeHtml(item.material_code || '-')}</td>
              <td>${escapeHtml(item.color || '-')}</td>
              <td class="number-cell">${formatFixedTrimmed(item.display_qty || item.gross_qty || 0, 2)}</td>
              <td class="center-cell">${escapeHtml(item.display_unit || item.price_unit || item.unit || '-')}</td>
              <td class="number-cell">${formatFixedTrimmed(item.price || 0, 2)} / ${escapeHtml(item.price_unit || item.unit || '')}</td>
            </tr>
          `
        )
        .join('')
      const cardCols = `
        <col style="width: 8%;" />
        ${hasMaterialImages ? '<col style="width: 12%;" />' : ''}
        <col style="width: 24%;" />
        <col style="width: 14%;" />
        <col style="width: 16%;" />
        <col style="width: 9%;" />
        <col style="width: 17%;" />
      `
      return `
        <section class="doc-card">
          <div class="doc-title">采购单：${escapeHtml(document.purchaseOrderNo || '-')}</div>
          <div class="meta-grid">
            <div class="meta-item"><strong>供应商：</strong>${escapeHtml(document.supplier || '-')}</div>
            <div class="meta-item"><strong>到货日期：</strong>${escapeHtml(document.receivedAt || '-')}</div>
            <div class="meta-item"><strong>明细行数：</strong>${Number((document.items || []).length || 0)}</div>
            <div class="meta-item"><strong>单据备注：</strong>${escapeHtml(String(document.remark || '').trim() || '-')}</div>
          </div>
          <table>
            <colgroup>${cardCols}</colgroup>
            <thead>
              <tr>
                <th class="center-cell">序号</th>
                ${hasMaterialImages ? '<th class="center-cell">图片</th>' : ''}
                <th>原料编码</th>
                <th>颜色</th>
                <th>采购数量</th>
                <th>单位</th>
                <th>单价</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="remarks-block">
            ${remarkRows ? `
              <div class="remarks-title">明细备注</div>
              ${remarkRows}
            ` : ''}
            <div class="remarks-title">采购单备注</div>
            <div class="order-remark__content">${formatMultilineHtml(document.remark, '-')}</div>
          </div>
        </section>
      `
    }).join('')

    return `
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8" />
          ${isExcel ? '<meta name="ProgId" content="Excel.Sheet" />' : ''}
          <title>合并采购单</title>
          <style>
            ${baseStyles()}
            body {
              margin: 0;
              padding: 0;
              background: #ffffff;
              color: #2a2118;
              font-size: 8px;
              box-sizing: border-box;
            }
            .sheet {
              width: 742px;
              max-width: 742px;
              margin: 0 auto;
              padding: 4px 6px;
            }
            .page-title {
              margin: 0 0 6px;
              font-size: 13px;
              line-height: 1.1;
              font-weight: 800;
              color: #2f241a;
            }
            .doc-card {
              border: 1px solid #d7c8b5;
              border-radius: 8px;
              padding: 6px 6px 5px;
              background: #fffdfa;
              margin-bottom: 6px;
            }
            .doc-title {
              margin: 0 0 5px;
              font-size: 9px;
              line-height: 1.2;
              font-weight: 800;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 1px 10px;
              margin-bottom: 5px;
              font-size: 7.2px;
              line-height: 1.16;
            }
            .meta-item strong {
              color: #6a4b24;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }
            th, td {
              border: 1px solid #d7c8b5;
              padding: 2px 3px;
              vertical-align: top;
              line-height: 1.12;
              word-break: break-word;
              overflow: hidden;
              background: #ffffff;
            }
            th {
              background: #f4ecdf;
              color: #2f241a;
              font-size: 7.2px;
              font-weight: 800;
              text-align: left;
            }
            .center-cell {
              text-align: center;
              white-space: nowrap;
            }
            .number-cell {
              text-align: right;
              white-space: nowrap;
              font-variant-numeric: tabular-nums;
            }
            .code-cell {
              font-weight: 700;
            }
            .thumb-cell {
              padding: 2px !important;
              text-align: center;
              vertical-align: middle;
            }
            .thumb-box {
              width: 34px;
              height: 34px;
              margin: 0 auto;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              border: 1px solid #d8cfc3;
              border-radius: 8px;
              background: #f8f6f1;
            }
            .thumb-box--empty {
              background: #fbfaf7;
            }
            .purchase-thumb-media {
              width: 100%;
              height: 100%;
              background-repeat: no-repeat;
              background-position: center center;
              background-size: contain;
            }
            .remarks-block {
              margin-top: 5px;
              padding-top: 5px;
              border-top: 1px dashed #d7c8b5;
            }
            .remarks-title {
              margin-bottom: 3px;
              font-size: 7.4px;
              font-weight: 800;
              color: #6a4b24;
            }
            .remark-item {
              margin-bottom: 4px;
            }
            .remark-item__title {
              font-size: 7px;
              font-weight: 700;
              color: #6a4b24;
              margin-bottom: 1px;
            }
            .remark-item__content,
            .order-remark__content {
              font-size: 7px;
              line-height: 1.14;
              white-space: normal;
              word-break: break-word;
              color: #403328;
            }
          </style>
        </head>
        <body>
        <div class="sheet" data-auto-fit="card" data-fit-width="680">
            <div class="fit-surface">
            <h1 class="page-title">合并采购单</h1>
            ${sections}
            </div>
          </div>
        </body>
      </html>
    `
  }
  const sections = (documents || []).map((document) => {
    const items = (document.items || []).map((item) => ({
      ...item,
      materialImageData: readImageAsDataUri(item.material_image_path)
    }))
    const hasMaterialImages = exportOptions.show_images && items.some((item) => item.materialImageData)
    const showMaterialName = exportOptions.show_material_name
    const showColor = exportOptions.show_color
    const showPriceType = exportOptions.show_price_type
    const showUnitPrice = exportOptions.show_unit_price
    const showItemRemark = exportOptions.show_item_remark
    const rowCount = items.length || 1
    const visibleColumnCount = 4 + (hasMaterialImages ? 1 : 0) + 1 + (showMaterialName ? 1 : 0) + (showColor ? 1 : 0) + (showPriceType ? 1 : 0) + (showUnitPrice ? 1 : 0) + (showItemRemark ? 1 : 0)
    const compactLevel = exportOptions.isCardLayout
      ? (rowCount >= 6 || visibleColumnCount >= 8 ? 2 : rowCount >= 4 || visibleColumnCount >= 7 ? 1 : 0)
      : 0
    const rows = items
      .map(
        (item) => {
          const mergedImageBoxSize = exportOptions.isCardLayout ? '52px' : '88px'
          const mergedImageCellHtml = hasMaterialImages
            ? `<td class="image-td" style="text-align:center;vertical-align:middle;padding:6px !important;overflow:hidden !important;">${
                item.materialImageData
                  ? `<div class="image-box" style="width:${mergedImageBoxSize};height:${mergedImageBoxSize};max-width:${mergedImageBoxSize};max-height:${mergedImageBoxSize};margin:0 auto;overflow:hidden;background:#f8f6f1;border:1px solid #d8cfc3;border-radius:10px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;"><div class="purchase-image-media" style="background-image:url('${item.materialImageData}')"></div></div>`
                  : `<div class="image-box" style="width:${mergedImageBoxSize};height:${mergedImageBoxSize};max-width:${mergedImageBoxSize};max-height:${mergedImageBoxSize};margin:0 auto;overflow:hidden;background:#f8f6f1;border:1px solid #d8cfc3;border-radius:10px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;"></div>`
              }</td>`
            : ''
          return `
        <tr>
          <td>${item.seqNo}</td>
          ${mergedImageCellHtml}
          <td>${escapeHtml(item.material_code || '')}</td>
          ${showMaterialName ? `<td>${escapeHtml(item.material_name || '-')}</td>` : ''}
          ${showColor ? `<td>${escapeHtml(item.color || '-')}</td>` : ''}
          <td class="number-cell">${formatFixedTrimmed(item.display_qty || item.gross_qty || 0, 2)}</td>
          <td>${escapeHtml(item.display_unit || item.price_unit || item.unit || '')}</td>
          ${showPriceType ? `<td>${escapeHtml(item.priceTypeLabel || '-')}</td>` : ''}
          ${showUnitPrice ? `<td class="number-cell">${formatFixedTrimmed(item.price || 0, 2)} / ${escapeHtml(item.price_unit || item.unit || '')}</td>` : ''}
          ${showItemRemark ? `<td class="remark">${formatMultilineHtml([buildPurchaseItemRemark(item), item.display_size ? `尺码：${item.display_size}` : ''].filter(Boolean).join('\n'), '-')}</td>` : ''}
        </tr>
      `
        }
      )
      .join('')

    return `
      <div class="card">
        <div class="section-title">采购单：${escapeHtml(document.purchaseOrderNo)}</div>
        <div class="meta section-meta">
          <div><strong>供应商：</strong>${escapeHtml(document.supplier || '-')}</div>
          <div><strong>到货日期：</strong>${escapeHtml(document.receivedAt || '-')}</div>
          <div><strong>明细行数：</strong>${Number((document.items || []).length || 0)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>序号</th>
              ${hasMaterialImages ? '<th>图片</th>' : ''}
              <th>原料编码</th>
              ${showMaterialName ? '<th>名称</th>' : ''}
              ${showColor ? '<th>颜色</th>' : ''}
              <th>采购数量</th>
              <th>单位</th>
              ${showPriceType ? '<th>单价类型</th>' : ''}
              ${showUnitPrice ? '<th>单价</th>' : ''}
              ${showItemRemark ? '<th>备注</th>' : ''}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${exportOptions.show_order_remark && String(document.remark || '').trim() ? `
          <div class="remark" style="margin-top: 10px;"><strong>采购单备注：</strong>${formatMultilineHtml(document.remark, '-')}</div>
        ` : ''}
      </div>
    `
  }).join('')

  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        ${isExcel ? '<meta name="ProgId" content="Excel.Sheet" />' : ''}
        <title>合并采购单</title>
        <style>
          ${baseStyles()}
          body {
            padding: ${isExcel ? '10px' : '16px'};
            font-size: ${isExcel ? '11.5px' : '13px'};
            overflow: visible;
            box-sizing: border-box;
          }
          table { table-layout: fixed; }
          th, td { padding: ${isExcel ? '7px' : '9px'}; word-break: break-word; }
          .card {
            padding: ${isExcel ? '12px' : '18px'};
            margin-bottom: ${isExcel ? '12px' : '18px'};
            border-radius: ${isExcel ? '10px' : '14px'};
          }
          .title { font-size: ${isExcel ? '22px' : '30px'}; }
          .meta {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px 18px;
            margin-top: 10px;
            font-size: ${isExcel ? '11px' : '12px'};
          }
          .meta strong {
            color: #5b3c14;
          }
          .image-td {
            padding: ${isExcel ? '4px' : '8px'} !important;
            text-align: center;
            vertical-align: middle;
            overflow: hidden;
          }
          .image-box {
            width: ${isExcel ? '88px' : '116px'};
            height: ${isExcel ? '88px' : '116px'};
            margin: 0 auto;
            overflow: hidden;
            background: #f6f2eb;
            border: 1px solid #d8cfc3;
            border-radius: 10px;
            background-repeat: no-repeat;
            background-position: center center;
            background-size: contain;
          }
          .purchase-image-media {
            width: 100%;
            height: 100%;
            background-repeat: no-repeat;
            background-position: center center;
            background-size: contain;
          }
          .sub-cell {
            margin-top: 4px;
            color: #8b6a49;
            font-size: 11px;
          }
          .section-meta {
            margin-bottom: 12px;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px 16px;
          }
          table {
            table-layout: ${exportOptions.isCardLayout ? 'fixed' : 'auto'};
            width: 100%;
          }
          th, td {
            padding: ${exportOptions.isCardLayout ? (compactLevel >= 2 ? '4px' : compactLevel === 1 ? '6px' : '7px') : (isExcel ? '7px' : '9px')};
            word-break: break-word;
            line-height: ${exportOptions.isCardLayout ? '1.32' : '1.5'};
            vertical-align: top;
          }
          .number-cell {
            white-space: nowrap;
            text-align: right;
            font-variant-numeric: tabular-nums;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="title">合并采购单</div>
            <div class="meta">
              <div>采购单数：${Number((documents || []).length || 0)}</div>
              <div>合并明细数：${Number((documents || []).reduce((sum, item) => sum + Number((item.items || []).length || 0), 0))}</div>
            </div>
          </div>
        </div>
        ${sections}
      </body>
    </html>
  `
}

async function exportPdfFile(html, defaultPath, title, options = {}) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title,
    defaultPath: resolveExportDefaultPath(defaultPath),
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
  })

  if (canceled || !filePath) return null

  return withTempHtmlWindow(html, async (pdfWindow) => {
    const shouldLandscape = options.landscape ?? html.includes('Factory Copy')
    const size = await prepareExportWindow(pdfWindow, {
      zoomFactor: options.zoomFactor || 1,
      baseWidth: options.baseWidth || 2200,
      baseHeight: options.baseHeight || 1600
    })
    let pageSize = options.pageSize || 'A4'
    if (pageSize === 'content') {
      pageSize = {
        width: pxToMicrons(Number(size.width || 820) + 24),
        height: pxToMicrons(Number(size.height || 620) + 24)
      }
    }
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      pageSize,
      landscape: Boolean(shouldLandscape),
      printBackground: true,
      margins: {
        top: 0.5,
        bottom: 0.5,
        left: 0.4,
        right: 0.4
      }
    })
    fs.writeFileSync(filePath, pdfBuffer)
    rememberExportDir(filePath)
    return filePath
  })
}

async function exportPdfToPath(html, filePath, options = {}) {
  return withTempHtmlWindow(html, async (pdfWindow) => {
    const shouldLandscape = options.landscape ?? html.includes('Factory Copy')
    const size = await prepareExportWindow(pdfWindow, {
      zoomFactor: options.zoomFactor || 1,
      baseWidth: options.baseWidth || 2200,
      baseHeight: options.baseHeight || 1600
    })
    let pageSize = options.pageSize || 'A4'
    if (pageSize === 'content') {
      pageSize = {
        width: pxToMicrons(Number(size.width || 820) + 24),
        height: pxToMicrons(Number(size.height || 620) + 24)
      }
    }
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      pageSize,
      landscape: Boolean(shouldLandscape),
      printBackground: true,
      margins: {
        top: 0.5,
        bottom: 0.5,
        left: 0.4,
        right: 0.4
      }
    })
    fs.writeFileSync(filePath, pdfBuffer)
    rememberExportDir(filePath)
    return filePath
  })
}

async function exportExcelFile(html, defaultPath, title) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title,
    defaultPath: resolveExportDefaultPath(defaultPath),
    filters: [{ name: 'Excel 文件', extensions: ['xls'] }]
  })

  if (canceled || !filePath) return null
  fs.writeFileSync(filePath, `\ufeff${html}`, 'utf8')
  rememberExportDir(filePath)
  return filePath
}

async function exportExcelToPath(html, filePath) {
  fs.writeFileSync(filePath, `\ufeff${html}`, 'utf8')
  rememberExportDir(filePath)
  return filePath
}

async function exportImageFile(html, defaultPath, title, options = {}) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title,
    defaultPath: resolveExportDefaultPath(defaultPath),
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  })

  if (canceled || !filePath) return null

  return exportImageToPath(html, filePath, options)
}

async function exportImageToPath(html, filePath, options = {}) {
  if (options.multiPage) {
    return withTempHtmlWindow(html, async (imageWindow) => {
      const zoomFactor = Math.max(1, Number(options.zoomFactor || 2.4))
      const baseWidth = Math.max(790, Number(options.baseWidth || 790))
      const baseHeight = Math.max(503, Number(options.baseHeight || 503))
      imageWindow.setContentSize(baseWidth, Math.max(baseHeight, 900))
      imageWindow.webContents.setZoomFactor(zoomFactor)

      const pageRects = await imageWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const finish = () => setTimeout(() => {
            const pages = Array.from(document.querySelectorAll('.export-page'))
            const rects = (pages.length ? pages : [document.body]).map((node) => {
              const rect = node.getBoundingClientRect()
              const isRootNode = node === document.body || node === document.documentElement
              const scrollWidth = Math.max(
                Math.ceil(node.scrollWidth || 0),
                isRootNode ? Math.ceil(document.documentElement.scrollWidth || 0) : 0,
                isRootNode ? Math.ceil(document.body.scrollWidth || 0) : 0
              )
              const scrollHeight = Math.max(
                Math.ceil(node.scrollHeight || 0),
                isRootNode ? Math.ceil(document.documentElement.scrollHeight || 0) : 0,
                isRootNode ? Math.ceil(document.body.scrollHeight || 0) : 0
              )
              return {
                x: Math.max(0, Math.floor(rect.left)),
                y: Math.max(0, Math.floor(rect.top)),
                width: Math.max(Math.ceil(rect.width || 0), scrollWidth),
                height: Math.max(Math.ceil(rect.height || 0), scrollHeight)
              }
            })
            resolve(rects)
          }, 240)
          const waitFonts = document.fonts?.ready || Promise.resolve()
          const images = Array.from(document.images || [])
          const waitImages = Promise.all(images.map((img) => {
            if (img.complete) return Promise.resolve()
            return new Promise((done) => {
              img.addEventListener('load', done, { once: true })
              img.addEventListener('error', done, { once: true })
              setTimeout(done, 2500)
            })
          }))
          Promise.all([waitFonts, waitImages]).then(() => {
            document.documentElement.style.background = '#ffffff'
            document.body.style.background = '#ffffff'
            document.documentElement.style.margin = '0'
            document.body.style.margin = '0'
            document.body.style.padding = '0'
            finish()
          })
        })
      `)

      const safeRects = Array.isArray(pageRects) && pageRects.length ? pageRects : [{ x: 0, y: 0, width: baseWidth, height: baseHeight }]
      const finalWidth = Math.min(6200, Math.max(baseWidth, ...safeRects.map((rect) => Math.ceil((rect.x || 0) + (rect.width || 0) + 24))))
      const finalHeight = Math.min(26000, Math.max(baseHeight, ...safeRects.map((rect) => Math.ceil((rect.y || 0) + (rect.height || 0) + 24))))
      imageWindow.setContentSize(finalWidth, finalHeight)
      await new Promise((resolve) => setTimeout(resolve, 220))

      const ext = path.extname(filePath)
      const baseFilePath = ext ? filePath.slice(0, -ext.length) : filePath
      const imagePaths = []
      for (let index = 0; index < safeRects.length; index += 1) {
        const rect = safeRects[index]
        const image = await imageWindow.webContents.capturePage({
          x: Math.max(0, Math.floor(Number(rect.x || 0))),
          y: Math.max(0, Math.floor(Number(rect.y || 0))),
          width: Math.min(Math.ceil(Number(rect.width || baseWidth)), Number(options.maxWidth || 10000)),
          height: Math.min(Math.ceil(Number(rect.height || baseHeight)), Number(options.maxHeight || 22000))
        })
        const currentPath = safeRects.length === 1
          ? `${baseFilePath}.png`
          : `${baseFilePath}-${index + 1}.png`
        fs.writeFileSync(currentPath, image.toPNG())
        rememberExportDir(currentPath)
        imagePaths.push(currentPath)
      }
      return imagePaths.length === 1 ? imagePaths[0] : imagePaths
    })
  }

  return withTempHtmlWindow(html, async (imageWindow) => {
    const pageSize = await prepareExportWindow(imageWindow, {
      zoomFactor: options.zoomFactor || 2.4,
      baseWidth: options.baseWidth || 2600,
      baseHeight: options.baseHeight || 2600
    })
    const captureX = Math.max(0, Math.floor(Number(pageSize.x || 0)))
    const captureY = Math.max(0, Math.floor(Number(pageSize.y || 0)))
    const captureWidth = Math.min(Math.ceil(Number(pageSize.width || 980)), Number(options.maxWidth || 10000))
    const captureHeight = Math.min(Math.ceil(Number(pageSize.height || 620)), Number(options.maxHeight || 22000))
    const image = await imageWindow.webContents.capturePage({
      x: captureX,
      y: captureY,
      width: captureWidth,
      height: captureHeight
    })
    fs.writeFileSync(filePath, image.toPNG())
    rememberExportDir(filePath)
    return filePath
  })
}

async function chooseBatchExportDirectory(title) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title,
    defaultPath: readLastExportDir() || getDefaultExportDir(),
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || !filePaths?.[0]) return ''
  rememberExportDir(filePaths[0])
  return filePaths[0]
}

function getExportExtension(format) {
  if (format === 'excel') return 'xls'
  if (format === 'image') return 'png'
  return 'pdf'
}

async function exportByFormatToPath({ format, html, filePath, landscape = false, pageSize, imageOptions = {} } = {}) {
  if (format === 'excel') return exportExcelToPath(html, filePath)
  if (format === 'image') {
    return exportImageToPath(html, filePath, {
      zoomFactor: imageOptions.zoomFactor || 2.2,
      baseWidth: imageOptions.baseWidth || 2600,
      baseHeight: imageOptions.baseHeight || 2600,
      maxWidth: imageOptions.maxWidth || 10000,
      maxHeight: imageOptions.maxHeight || 22000
    })
  }
  return exportPdfToPath(html, filePath, { landscape, pageSize })
}

ipcMain.handle('misc:exportHtmlExcel', async (event, payload = {}) => {
  const html = String(payload?.html || '')
  if (!html.trim()) throw new Error('导出内容不能为空')

  const defaultName = String(payload?.defaultName || '导出数据.xls')
  return exportExcelFile(
    html,
    path.join(app.getPath('documents'), defaultName),
    '导出 Excel'
  )
})

function parseProductionExportPayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      orderId: Number(payload.id || payload.orderId || 0),
      options: payload.options || {}
    }
  }
  return {
    orderId: Number(payload || 0),
    options: {}
  }
}

ipcMain.handle('order:exportPdf', async (event, payload) => {
  const { orderId, options } = parseProductionExportPayload(payload)
  const { getProductionOrderById } = getDbApi()
  const order = getProductionOrderById(orderId)
  if (!order) throw new Error('生产制单不存在')

  return exportPdfFile(
    buildFactoryOrderHtml(order, options),
    path.join(app.getPath('documents'), `${sanitizeFileNameSegment(order.style_code || '未命名成衣')}-${sanitizeFileNameSegment(order.order_no || '未命名制单')}-工厂制单.pdf`),
    '导出工厂生产制单 PDF'
  )
})

ipcMain.handle('order:exportExcel', async (event, payload) => {
  const { orderId, options } = parseProductionExportPayload(payload)
  const { getProductionOrderById } = getDbApi()
  const order = getProductionOrderById(orderId)
  if (!order) throw new Error('生产制单不存在')

  return exportExcelFile(
    buildFactoryOrderHtml(order, { ...options, excel: true }),
    path.join(app.getPath('documents'), `${sanitizeFileNameSegment(order.style_code || '未命名成衣')}-${sanitizeFileNameSegment(order.order_no || '未命名制单')}-工厂制单.xls`),
    '导出工厂生产制单 Excel'
  )
})

ipcMain.handle('order:exportImage', async (event, payload) => {
  const { orderId, options } = parseProductionExportPayload(payload)
  const { getProductionOrderById } = getDbApi()
  const order = getProductionOrderById(orderId)
  if (!order) throw new Error('生产制单不存在')

  return exportImageFile(
    buildFactoryOrderHtml(order, options),
    path.join(app.getPath('documents'), `${sanitizeFileNameSegment(order.style_code || '未命名成衣')}-${sanitizeFileNameSegment(order.order_no || '未命名制单')}-工厂制单.png`),
    '导出工厂生产制单图片',
    { zoomFactor: 2.5, baseWidth: 2800, baseHeight: 3200, maxWidth: 10000, maxHeight: 22000 }
  )
})

function parsePurchaseExportPayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      batchId: Number(payload.id || payload.batchId || 0),
      options: normalizePurchaseExportOptions(payload.options || {})
    }
  }
  return {
    batchId: Number(payload || 0),
    options: normalizePurchaseExportOptions({})
  }
}

ipcMain.handle('order:exportPurchasePdf', async (event, payload) => {
  const { batchId, options } = parsePurchaseExportPayload(payload)
  const { getPurchaseOrderDocumentByBatchId } = getDbApi()
  const document = getPurchaseOrderDocumentByBatchId(batchId)
  if (!document) throw new Error('采购批次不存在')
  const renderOptions = getPurchaseExportRenderOptions(options)

  return exportPdfFile(
    buildPurchaseOrderHtml(document, renderOptions),
    path.join(app.getPath('documents'), `${sanitizeFileNameSegment(document.supplier || '未命名供应商')}-${sanitizeFileNameSegment(document.purchaseOrderNo || '未命名采购单')}-原料采购单.pdf`),
    '导出供应商采购单 PDF',
    {
      pageSize: renderOptions.pdfPageSize,
      baseWidth: renderOptions.imageOptions.baseWidth,
      baseHeight: renderOptions.imageOptions.baseHeight,
      zoomFactor: renderOptions.isCardLayout ? 1.2 : 1
    }
  )
})

ipcMain.handle('order:exportPurchaseExcel', async (event, payload) => {
  const { batchId, options } = parsePurchaseExportPayload(payload)
  const { getPurchaseOrderDocumentByBatchId } = getDbApi()
  const document = getPurchaseOrderDocumentByBatchId(batchId)
  if (!document) throw new Error('采购批次不存在')
  const renderOptions = getPurchaseExportRenderOptions(options)

  return exportExcelFile(
    buildPurchaseOrderHtml(document, { ...renderOptions, excel: true }),
    path.join(app.getPath('documents'), `${sanitizeFileNameSegment(document.supplier || '未命名供应商')}-${sanitizeFileNameSegment(document.purchaseOrderNo || '未命名采购单')}-原料采购单.xls`),
    '导出供应商采购单 Excel'
  )
})

ipcMain.handle('order:exportPurchaseImage', async (event, payload) => {
  const { batchId, options } = parsePurchaseExportPayload(payload)
  const { getPurchaseOrderDocumentByBatchId } = getDbApi()
  const document = getPurchaseOrderDocumentByBatchId(batchId)
  if (!document) throw new Error('采购批次不存在')
  const renderOptions = getPurchaseExportRenderOptions(options)

  return exportImageFile(
    buildPurchaseOrderHtml(document, renderOptions),
    path.join(app.getPath('documents'), `${sanitizeFileNameSegment(document.supplier || '未命名供应商')}-${sanitizeFileNameSegment(document.purchaseOrderNo || '未命名采购单')}-原料采购单.png`),
    '导出供应商采购单图片',
    renderOptions.imageOptions
  )
})

ipcMain.handle('order:exportMergedPurchasePdf', async (event, batchIds) => {
  const { getPurchaseOrderDocumentsByBatchIds } = getDbApi()
  const documents = getPurchaseOrderDocumentsByBatchIds(batchIds)
  if (!documents.length) throw new Error('未找到可导出的采购单')

  return exportPdfFile(
    buildMergedPurchaseOrderHtml(documents),
    path.join(app.getPath('documents'), `合并采购单-${Date.now()}.pdf`),
    '导出合并采购单 PDF',
    { pageSize: 'content' }
  )
})

ipcMain.handle('order:exportMergedPurchaseExcel', async (event, batchIds) => {
  const { getPurchaseOrderDocumentsByBatchIds } = getDbApi()
  const documents = getPurchaseOrderDocumentsByBatchIds(batchIds)
  if (!documents.length) throw new Error('未找到可导出的采购单')

  return exportExcelFile(
    buildMergedPurchaseOrderHtml(documents, { excel: true }),
    path.join(app.getPath('documents'), `合并采购单-${Date.now()}.xls`),
    '导出合并采购单 Excel'
  )
})

ipcMain.handle('order:exportMergedPurchaseImage', async (event, batchIds) => {
  const { getPurchaseOrderDocumentsByBatchIds } = getDbApi()
  const documents = getPurchaseOrderDocumentsByBatchIds(batchIds)
  if (!documents.length) throw new Error('未找到可导出的采购单')

  return exportImageFile(
    buildMergedPurchaseOrderHtml(documents),
    path.join(app.getPath('documents'), `合并采购单-${Date.now()}.png`),
    '导出合并采购单图片',
    { zoomFactor: 2.2, baseWidth: 2600, baseHeight: 2600, maxWidth: 10000, maxHeight: 22000 }
  )
})

ipcMain.handle('order:batchExportPurchaseDocuments', async (event, payload = {}) => {
  const ids = Array.isArray(payload?.ids) ? payload.ids : []
  const format = String(payload?.format || 'pdf').toLowerCase()
  const options = normalizePurchaseExportOptions(payload?.options || {})
  const { getPurchaseOrderDocumentsByBatchIds } = getDbApi()
  const documents = getPurchaseOrderDocumentsByBatchIds(ids)
  if (!documents.length) throw new Error('未找到可导出的采购单')

  const dirPath = await chooseBatchExportDirectory('选择采购单批量导出文件夹')
  if (!dirPath) return null

  const extension = getExportExtension(format)
  const outputPaths = []
  for (const document of documents) {
    const renderOptions = getPurchaseExportRenderOptions(options)
    const fileName = `${sanitizeFileNameSegment(document.supplier || '未命名供应商')}-${sanitizeFileNameSegment(document.purchaseOrderNo || '未命名采购单')}-原料采购单.${extension}`
    const filePath = path.join(dirPath, fileName)
    await exportByFormatToPath({
      format,
      html: buildPurchaseOrderHtml(document, { ...renderOptions, excel: format === 'excel' }),
      filePath,
      landscape: false,
      pageSize: format === 'pdf' ? renderOptions.pdfPageSize : undefined,
      imageOptions: format === 'image' ? renderOptions.imageOptions : undefined
    })
    outputPaths.push(filePath)
  }

  return { dirPath, count: outputPaths.length, paths: outputPaths }
})

ipcMain.handle('order:batchExportProductionOrders', async (event, payload = {}) => {
  const ids = Array.isArray(payload?.ids) ? payload.ids : []
  const format = String(payload?.format || 'pdf').toLowerCase()
  const options = payload?.options || {}
  const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter(Boolean))]
  if (!uniqueIds.length) throw new Error('未找到可导出的生产制单')

  const dirPath = await chooseBatchExportDirectory('选择生产制单批量导出文件夹')
  if (!dirPath) return null

  const extension = getExportExtension(format)
  const outputPaths = []
  const { getProductionOrderById } = getDbApi()
  for (const id of uniqueIds) {
    const order = getProductionOrderById(id)
    if (!order) continue
    const fileName = `${sanitizeFileNameSegment(order.style_code || '未命名成衣')}-${sanitizeFileNameSegment(order.order_no || `生产单-${id}`)}-工厂制单.${extension}`
    const filePath = path.join(dirPath, fileName)
    await exportByFormatToPath({
      format,
      html: buildFactoryOrderHtml(order, { ...options, excel: format === 'excel' }),
      filePath,
      landscape: format !== 'image'
    })
    outputPaths.push(filePath)
  }

  if (!outputPaths.length) throw new Error('未找到可导出的生产制单')
  return { dirPath, count: outputPaths.length, paths: outputPaths }
})

ipcMain.handle('app:getVersion', () => ({
  version: app.getVersion(),
  name: APP_NAME
}))

ipcMain.handle('lan:invoke', async (_event, payload = {}) =>
  forwardLanInvoke(String(payload.channel || ''), Array.isArray(payload.args) ? payload.args : [])
)

ipcMain.handle('lan:getConfig', async () => {
  const { getLanBridgeConfig } = getDbApi()
  const baseConfig = getLanBridgeConfig()
  const network = getLanNetworkSnapshot(baseConfig.port)
  return {
    ...baseConfig,
    network,
    runtime: { ...lanBridgeState }
  }
})

ipcMain.handle('lan:updateConfig', async (_event, payload = {}) => {
  const { updateLanBridgeConfig } = getDbApi()
  const nextConfig = updateLanBridgeConfig(payload || {})
  const runtime = await refreshLanBridgeServer()
  const network = getLanNetworkSnapshot(nextConfig.port)
  return {
    ...nextConfig,
    network,
    runtime
  }
})

ipcMain.handle('app:getAutoLaunchSettings', () => getAutoLaunchSettings())

ipcMain.handle('app:setAutoLaunchEnabled', (event, enabled) =>
  setAutoLaunchEnabled(enabled)
)

ipcMain.handle('app:applyPatchPackage', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择补丁包',
    properties: ['openFile'],
    filters: [{ name: '补丁包', extensions: ['zip'] }]
  })

  if (canceled || !filePaths?.[0]) return null
  return applyPatchPackage(filePaths[0])
})

app.whenReady().then(async () => {
  writeStartupLog('app:whenReady')
  try {
    await ensureDbApiReady({ attempts: 5, delayMs: 3000 })
  } catch (error) {
    writeStartupLog('app:startup-failed', error?.stack || String(error || ''))
    showStartupFailure(error)
    app.quit()
    return
  }

  refreshLanBridgeServer().catch(() => {})
  createWindow()

  app.on('activate', () => {
    writeStartupLog('app:activate')
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  writeStartupLog('app:window-all-closed')
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopLanBridgeServer().catch(() => {})
})


