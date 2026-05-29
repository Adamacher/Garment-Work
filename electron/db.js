const { app, ipcMain } = require('electron')
const path = require('path')
const { clipboard } = require('electron')
const { dialog } = require('electron')
const { nativeImage: electronNativeImage } = require('electron')
const fs = require('fs')
const crypto = require('crypto')
const zlib = require('zlib')
const Database = require('better-sqlite3')

const userDataPath = app.getPath('userData')
const WORKSPACE_DB_NAME = 'garment_ems.db'
const WORKSPACE_CONFIG_PATH = path.join(userDataPath, 'workspace-config.json')
const SHARED_WORKSPACE_INFO_FILE = 'workspace-info.json'
const AUTH_SUPER_ADMIN = 'super_admin'
const DEFAULT_SUPER_ADMIN_USERNAME = 'Admin'
const DEFAULT_SUPER_ADMIN_PASSWORD_HASH = '5c4d3231c580237c6101a6b4474ee114:7f69c4842a0f3ac71df9d5a05ed949a622ea3bd1dbd0281dafd262b927b269e3'
const LAN_BRIDGE_DEFAULT_PORT = 18680

function resolveProgramRootDirectory() {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'))
  }
  return path.resolve(__dirname, '..')
}

function defaultLocalWorkspacePath() {
  return path.join(userDataPath, 'workspace')
}

const LOCAL_DATABASE_BACKUP_DIR = path.join(resolveProgramRootDirectory(), 'DATABASE')
const DAILY_BACKUP_RETENTION_DAYS = 3

function ensureDirectory(targetPath) {
  if (!fs.existsSync(targetPath)) fs.mkdirSync(targetPath, { recursive: true })
}

function readWorkspaceConfig() {
  try {
    if (!fs.existsSync(WORKSPACE_CONFIG_PATH)) return {}
    return JSON.parse(fs.readFileSync(WORKSPACE_CONFIG_PATH, 'utf8') || '{}')
  } catch {
    return {}
  }
}

function writeWorkspaceConfig(payload = {}) {
  ensureDirectory(userDataPath)
  const nextPayload = {
    ...readWorkspaceConfig(),
    ...payload
  }
  fs.writeFileSync(WORKSPACE_CONFIG_PATH, JSON.stringify(nextPayload, null, 2), 'utf8')
}

function isNetworkWorkspacePath(targetPath = '') {
  return String(targetPath || '').startsWith('\\\\')
}

function getPreferredSharedWorkspacePath() {
  const currentConfig = readWorkspaceConfig()
  const preferred = cleanText(currentConfig?.preferredSharedWorkspacePath || '')
  if (preferred) return preferred
  const savedPath = cleanText(currentConfig?.workspacePath || '')
  return isNetworkWorkspacePath(savedPath) ? savedPath : ''
}

function resolveWorkspacePath() {
  ensureDirectory(userDataPath)
  const currentConfig = readWorkspaceConfig()
  const savedPath = String(currentConfig?.workspacePath || '').trim()
  const targetPath = savedPath || defaultLocalWorkspacePath()
  ensureDirectory(targetPath)
  if (!savedPath) writeWorkspaceConfig({ workspacePath: targetPath, readOnlyMode: Boolean(currentConfig?.readOnlyMode) })
  return targetPath
}

function resolveWorkspaceReadOnly() {
  return Boolean(readWorkspaceConfig()?.readOnlyMode)
}

function resolveDatabasePath(targetWorkspacePath) {
  return path.join(targetWorkspacePath, WORKSPACE_DB_NAME)
}

function resolveSharedWorkspaceInfoPath(targetWorkspacePath) {
  return path.join(targetWorkspacePath, SHARED_WORKSPACE_INFO_FILE)
}

function normalizeLanPort(value) {
  const port = Number(value || 0)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return LAN_BRIDGE_DEFAULT_PORT
  return port
}

function normalizeLanHost(value, port = LAN_BRIDGE_DEFAULT_PORT) {
  const text = cleanText(value)
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) {
    return text.replace(/\/+$/, '')
  }
  return `http://${text}:${normalizeLanPort(port)}`
}

function buildLanBridgeConfig(source = readWorkspaceConfig()) {
  const port = normalizeLanPort(source?.lanServicePort)
  const hostComputerName = cleanText(source?.hostComputerName || '')
  const preferredHost = cleanText(source?.lanServiceHost || '')
  const host = normalizeLanHost(preferredHost || hostComputerName, port)
  return {
    enabled: Boolean(source?.lanServiceEnabled),
    port,
    host,
    host_computer_name: hostComputerName,
    prefer_remote: Boolean(source?.preferLanService) && Boolean(host),
    is_host: hostComputerName === getClientName()
  }
}

function readSharedWorkspaceInfo(targetWorkspacePath = workspacePath) {
  try {
    const filePath = resolveSharedWorkspaceInfoPath(targetWorkspacePath)
    if (!fs.existsSync(filePath)) return {}
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}')
  } catch {
    return {}
  }
}

function writeSharedWorkspaceInfo(targetWorkspacePath = workspacePath, payload = {}) {
  try {
    ensureDirectory(targetWorkspacePath)
    const nextPayload = {
      ...readSharedWorkspaceInfo(targetWorkspacePath),
      ...payload,
      updatedAt: new Date().toISOString()
    }
    fs.writeFileSync(resolveSharedWorkspaceInfoPath(targetWorkspacePath), JSON.stringify(nextPayload, null, 2), 'utf8')
    return nextPayload
  } catch {
    return null
  }
}

function getFileSignature(targetFilePath) {
  if (!targetFilePath || !fs.existsSync(targetFilePath)) return null
  const stats = fs.statSync(targetFilePath)
  return {
    size: Number(stats.size || 0),
    mtime_ms: Math.round(Number(stats.mtimeMs || 0))
  }
}

function signaturesMatch(left, right) {
  if (!left || !right) return false
  return Number(left.size || 0) === Number(right.size || 0) && Number(left.mtime_ms || 0) === Number(right.mtime_ms || 0)
}

function openDatabase(targetDbPath, readOnlyMode = false) {
  ensureDirectory(path.dirname(targetDbPath))
  const instance = new Database(targetDbPath, readOnlyMode
    ? { readonly: true, fileMustExist: true }
    : undefined)
  instance.pragma('foreign_keys = ON')
  try {
    instance.pragma('journal_mode = DELETE')
  } catch {}
  try {
    instance.pragma('busy_timeout = 15000')
  } catch {}
  try {
    instance.pragma('synchronous = NORMAL')
  } catch {}
  try {
    instance.pragma('temp_store = MEMORY')
  } catch {}
  try {
    instance.pragma('cache_size = -32000')
  } catch {}
  try {
    instance.pragma('mmap_size = 268435456')
  } catch {}
  return instance
}

function safelyCloseDatabase(instance) {
  if (!instance) return
  try {
    instance.close()
  } catch {}
}

function isDatabaseOpen(instance = db) {
  if (!instance) return false
  try {
    return instance.open !== false
  } catch {
    return false
  }
}

function ensureActiveDatabaseConnection(targetDbPath = dbPath, readOnlyMode = workspaceReadOnly) {
  if (isDatabaseOpen(db)) return db
  const nextDbPath = targetDbPath || resolveDatabasePath(workspacePath)
  dbPath = nextDbPath
  db = openDatabase(dbPath, Boolean(readOnlyMode))
  return db
}

function reopenDatabaseConnection(targetDbPath = dbPath, readOnlyMode = workspaceReadOnly) {
  const nextDbPath = targetDbPath || resolveDatabasePath(workspacePath)
  databaseSwitching = true
  try {
    const previousDb = db
    const nextDb = openDatabase(nextDbPath, Boolean(readOnlyMode))
    dbPath = nextDbPath
    db = nextDb
    safelyCloseDatabase(previousDb)
    bumpDataRevision()
    return db
  } finally {
    databaseSwitching = false
  }
}

let workspacePath = resolveWorkspacePath()
let workspaceReadOnly = resolveWorkspaceReadOnly()
let dbPath = resolveDatabasePath(workspacePath)
let db
let databaseSwitching = false
let storageOptimizationPromise = null
let dataRevision = 0
const queryCache = new Map()
let storageOptimizationState = {
  running: false,
  stage: 'idle',
  stage_label: '未开始',
  started_at: '',
  finished_at: '',
  updated_at: '',
  total_items: 0,
  processed_items: 0,
  progress_percent: 0,
  before_size: 0,
  after_size: 0,
  saved_size: 0,
  estimated_saved_size: 0,
  updated_material_images: 0,
  updated_garment_images: 0,
  updated_purchase_image_sets: 0,
  updated_production_image_sets: 0,
  vacuum_performed: false,
  vacuum_skipped: false,
  message: ''
}

try {
  db = openDatabase(dbPath, workspaceReadOnly)
} catch {
  const fallbackSharedPath = isNetworkWorkspacePath(workspacePath) ? workspacePath : getPreferredSharedWorkspacePath()
  workspacePath = defaultLocalWorkspacePath()
  workspaceReadOnly = false
  writeWorkspaceConfig({
    workspacePath,
    readOnlyMode: false,
    preferredSharedWorkspacePath: fallbackSharedPath,
    offlineMode: Boolean(fallbackSharedPath)
  })
  dbPath = resolveDatabasePath(workspacePath)
  db = openDatabase(dbPath, workspaceReadOnly)
}

function updateStorageOptimizationState(patch = {}) {
  const nextState = {
    ...storageOptimizationState,
    ...patch
  }
  const totalItems = Math.max(Number(nextState.total_items || 0), 0)
  const processedItems = Math.max(Number(nextState.processed_items || 0), 0)
  nextState.progress_percent = totalItems > 0
    ? Math.max(0, Math.min(100, Math.round((processedItems / totalItems) * 100)))
    : (nextState.running ? 0 : 100)
  nextState.updated_at = new Date().toISOString()
  storageOptimizationState = nextState
  return storageOptimizationState
}

function getStorageOptimizationState() {
  return { ...storageOptimizationState }
}

function bumpDataRevision() {
  dataRevision += 1
  queryCache.clear()
}

function getCachedQueryResult(cacheKey, resolver, ttlMs = 8000) {
  ensureActiveDatabaseConnection()
  const now = Date.now()
  const cached = queryCache.get(cacheKey)
  if (cached && cached.revision === dataRevision && now - cached.createdAt <= ttlMs) {
    return cached.value
  }
  const value = resolver()
  queryCache.set(cacheKey, {
    revision: dataRevision,
    createdAt: now,
    value
  })
  return value
}

function waitForMainLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const MATERIAL_FIELDS = `
  id,
  code,
  style_code,
  name,
  image_path,
  major_category,
  category,
  sub_category,
  leaf_category,
  composition,
  color,
  width,
  weight,
  meter_per_kg,
  adjustment_type,
  left_gap,
  right_gap,
  gap_reference_qty,
  gap_ratio,
  custom_formula,
  custom_conversion_from_qty,
  custom_conversion_from_unit,
  custom_conversion_to_qty,
  custom_conversion_to_unit,
  unit,
  default_price,
  default_price_unit,
  size_price_json,
  supplier,
  remark,
  sort_order,
  created_at
`

const PRICE_TYPE_LABELS = {
  bulk: '大货价',
  sample: '版布价',
  net: '净布价'
}

const DOCUMENT_STATUS_LABELS = {
  draft: '草稿',
  submitted: '已提交',
  approved: '已审核',
  voided: '已作废'
}

const USAGE_MODE_LABELS = {
  full_cut: '尽裁',
  by_usage: '按量'
}

let currentActor = {
  username: 'system',
  display_name: '系统',
  role: 'system'
}

const tableColumnsCache = new Map()

function hasColumn(table, column) {
  const tableName = cleanText(table)
  const columnName = cleanText(column)
  if (!tableName || !columnName) return false
  if (!tableColumnsCache.has(tableName)) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all()
    tableColumnsCache.set(tableName, new Set(columns.map((row) => cleanText(row.name)).filter(Boolean)))
  }
  return tableColumnsCache.get(tableName).has(columnName)
}

const deferredStartupTasks = []
let deferredStartupTimer = null
let deferredStartupMaintenanceTimer = null

function isDatabaseLockedError(error) {
  const text = String(error?.message || error || '').toLowerCase()
  return text.includes('database is locked') || text.includes('database busy')
}

function logDeferredStartupIssue(label, error) {
  try {
    console.warn(`[startup-db] ${label}`, error?.message || error || '')
  } catch {}
}

function queueDeferredStartupTask(label, handler) {
  if (typeof handler !== 'function') return
  deferredStartupTasks.push({ label, handler })
  if (deferredStartupTimer) return
  deferredStartupTimer = setTimeout(() => {
    deferredStartupTimer = null
    flushDeferredStartupTasks()
  }, 1800)
}

function flushDeferredStartupTasks() {
  if (!deferredStartupTasks.length || databaseSwitching || !isDatabaseOpen(db)) return
  const pending = deferredStartupTasks.splice(0)
  pending.forEach((task) => {
    try {
      task.handler()
    } catch (error) {
      if (isDatabaseLockedError(error)) {
        logDeferredStartupIssue(`${task.label}:retry-locked`, error)
        queueDeferredStartupTask(task.label, task.handler)
        return
      }
      logDeferredStartupIssue(`${task.label}:failed`, error)
    }
  })
}

function runStartupWriteStep(label, handler, options = {}) {
  const { deferOnLocked = true } = options
  try {
    return handler()
  } catch (error) {
    if (deferOnLocked && isDatabaseLockedError(error)) {
      logDeferredStartupIssue(`${label}:deferred`, error)
      queueDeferredStartupTask(label, handler)
      return null
    }
    throw error
  }
}

function scheduleDeferredStartupMaintenance() {
  if (deferredStartupMaintenanceTimer) return
  deferredStartupMaintenanceTimer = setTimeout(() => {
    deferredStartupMaintenanceTimer = null
    flushDeferredStartupTasks()
    try {
      repairPurchaseBatchQuantities()
    } catch (error) {
      if (isDatabaseLockedError(error)) {
        queueDeferredStartupTask('repairPurchaseBatchQuantities', repairPurchaseBatchQuantities)
      } else {
        logDeferredStartupIssue('repairPurchaseBatchQuantities', error)
      }
    }
    runPostWriteMaintenance().catch((error) => {
      if (isDatabaseLockedError(error)) {
        queueDeferredStartupTask('runPostWriteMaintenance', () => {
          runPostWriteMaintenance().catch(() => {})
        })
      } else {
        logDeferredStartupIssue('runPostWriteMaintenance', error)
      }
    })
  }, 2200)
}

function ensureColumn(table, column, definition) {
  if (!hasColumn(table, column)) {
    runStartupWriteStep(`ensureColumn:${table}.${column}`, () => {
      if (!hasColumn(table, column)) {
        const safeDefinition = String(definition || '').replace(/\s+DEFAULT\s+CURRENT_(?:TIMESTAMP|DATE|TIME)\b/gi, '')
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${safeDefinition || definition}`)
        const tableName = cleanText(table)
        const columnName = cleanText(column)
        if (tableName && columnName) {
          if (!tableColumnsCache.has(tableName)) tableColumnsCache.set(tableName, new Set())
          tableColumnsCache.get(tableName).add(columnName)
        }
      }
    })
  }
}

function round(value, digits = 4) {
  return Number(Number(value || 0).toFixed(digits))
}

function cleanText(value) {
  return String(value || '').trim()
}

function normalizePurchaseColorRemarkText(value) {
  const text = cleanText(value)
  if (!text) return ''
  return text
    .replace(/^\?{2,}\s*/u, '款号：')
    .replace(/^款号[:：]?\s*/u, '款号：')
}

function buildPurchaseDocumentScope(seedBatch) {
  return {
    mergeGroupId: cleanText(seedBatch?.merge_group_id),
    purchaseOrderNo: cleanText(seedBatch?.purchase_order_no),
    supplier: cleanText(seedBatch?.supplier)
  }
}

function uniqueNonEmpty(values = []) {
  return [...new Set(values.map((item) => cleanText(item)).filter(Boolean))]
}

function nextSortOrder(table, whereClause = '', params = []) {
  const suffix = whereClause ? ` WHERE ${whereClause}` : ''
  const row = db.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_value
    FROM ${table}
    ${suffix}
  `).get(...params)
  return Number(row?.next_value || 1)
}

function resequenceSortOrders(table, items = [], keyColumn = 'id', extraAssignments = {}) {
  const update = db.prepare(`
    UPDATE ${table}
    SET sort_order=@sort_order
    WHERE ${keyColumn}=@key_value
  `)

  ;(items || []).forEach((item, index) => {
    update.run({
      sort_order: index + 1,
      key_value: item[keyColumn],
      ...extraAssignments
    })
  })
}

function getClientName() {
  return cleanText(process.env.COMPUTERNAME || process.env.HOSTNAME || app.getName() || '本机')
}

function normalizeDocumentStatus(value) {
  const raw = cleanText(value)
  if (['草稿', '已提交', '已审核', '已作废'].includes(raw)) {
    return Object.entries(DOCUMENT_STATUS_LABELS).find(([, label]) => label === raw)?.[0] || 'draft'
  }
  if (Object.keys(DOCUMENT_STATUS_LABELS).includes(raw)) return raw
  return 'draft'
}

function getDocumentStatusLabel(value) {
  return DOCUMENT_STATUS_LABELS[normalizeDocumentStatus(value)] || DOCUMENT_STATUS_LABELS.draft
}

function rebuildProductionOrderMaterialsTableIfNeeded() {
  const columns = db.prepare(`PRAGMA table_info(production_order_materials)`).all()
  if (!columns.length) return

  const batchIdColumn = columns.find((item) => item.name === 'batch_id')
  if (!batchIdColumn || !Number(batchIdColumn.notnull || 0)) return

  db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.exec(`
      ALTER TABLE production_order_materials RENAME TO production_order_materials_legacy;

      CREATE TABLE production_order_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        garment_id INTEGER NOT NULL,
        material_id INTEGER NOT NULL,
        batch_id INTEGER DEFAULT NULL,
        material_name TEXT DEFAULT '',
        material_code TEXT DEFAULT '',
        material_unit TEXT DEFAULT '',
        material_role TEXT DEFAULT '辅料',
        material_color TEXT DEFAULT '',
        usage_per_piece REAL DEFAULT 0,
        usage_input_unit TEXT DEFAULT '米',
        usage_converted_per_piece REAL DEFAULT 0,
        loss_rate REAL DEFAULT 0,
        usage_mode TEXT DEFAULT 'by_usage',
        supply_mode TEXT DEFAULT 'our_supply',
        processing_requirements TEXT DEFAULT '[]',
        required_qty REAL DEFAULT 0,
        actual_issued_qty REAL DEFAULT 0,
        actual_issued_unit TEXT DEFAULT '',
        allocated_qty REAL DEFAULT 0,
        consumed_qty REAL DEFAULT 0,
        unit_cost REAL DEFAULT 0,
        line_cost REAL DEFAULT 0,
        cost_price_type TEXT DEFAULT 'bulk',
        price_source_label TEXT DEFAULT '',
        FOREIGN KEY(order_id) REFERENCES production_orders(id),
        FOREIGN KEY(batch_id) REFERENCES purchase_batches(id)
      );

      INSERT INTO production_order_materials (
        id, order_id, garment_id, material_id, batch_id, material_name, material_code, material_unit,
        material_role, material_color, usage_per_piece, usage_input_unit, usage_converted_per_piece,
        loss_rate, usage_mode, supply_mode, processing_requirements, required_qty, actual_issued_qty,
        actual_issued_unit, allocated_qty, consumed_qty, unit_cost, line_cost, cost_price_type, price_source_label
      )
      SELECT
        id,
        order_id,
        garment_id,
        material_id,
        CASE WHEN COALESCE(batch_id, 0) <= 0 THEN NULL ELSE batch_id END,
        material_name,
        material_code,
        material_unit,
        COALESCE(material_role, '辅料'),
        COALESCE(material_color, ''),
        COALESCE(usage_per_piece, 0),
        COALESCE(usage_input_unit, '米'),
        COALESCE(usage_converted_per_piece, 0),
        COALESCE(loss_rate, 0),
        COALESCE(usage_mode, 'by_usage'),
        COALESCE(supply_mode, 'our_supply'),
        COALESCE(processing_requirements, '[]'),
        COALESCE(required_qty, 0),
        COALESCE(actual_issued_qty, 0),
        COALESCE(actual_issued_unit, ''),
        COALESCE(allocated_qty, 0),
        COALESCE(consumed_qty, 0),
        COALESCE(unit_cost, 0),
        COALESCE(line_cost, 0),
        COALESCE(cost_price_type, 'bulk'),
        COALESCE(price_source_label, '')
      FROM production_order_materials_legacy;

      DROP TABLE production_order_materials_legacy;
    `)
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function safeJsonStringify(value, fallback = '') {
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

function normalizedText(value) {
  return cleanText(value).toLowerCase()
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const digest = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex')
  return `${salt}:${digest}`
}

function verifyPassword(password, storedHash) {
  const [salt, digest] = String(storedHash || '').split(':')
  if (!salt || !digest) return false
  const candidate = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex')
  return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(candidate, 'hex'))
}

function normalizePermissions(value) {
  const rawList = Array.isArray(value) ? value : safeJsonParse(value, [])
  const normalized = uniqueNonEmpty(rawList)
  return normalized.includes('*') ? ['*'] : normalized
}

function normalizeStringList(value) {
  const rawList = Array.isArray(value)
    ? value
    : safeJsonParse(value, String(value || '').split(/[,\n/]/).map((item) => item.trim()))
  return uniqueNonEmpty(rawList)
}

function normalizeImageList(value) {
  const rawList = Array.isArray(value) ? value : safeJsonParse(value, [])
  return uniqueNonEmpty((rawList || []).map((item) => String(item || '').trim()))
}

function isDataImageUrl(value) {
  return /^data:image\//i.test(cleanText(value))
}

function compressStoredImage(value, options = {}) {
  const source = cleanText(value)
  if (!isDataImageUrl(source)) return source
  if (source.length < Number(options.minLength || 420 * 1024)) return source

  try {
    const image = electronNativeImage.createFromDataURL(source)
    if (!image || image.isEmpty()) return source

    const { width, height } = image.getSize()
    const maxEdge = Math.max(Number(options.maxEdge || 2400), 1)
    const sourceMaxEdge = Math.max(Number(width || 0), Number(height || 0), 1)
    const scale = Math.min(1, maxEdge / sourceMaxEdge)
    const resized = scale < 0.999
      ? image.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'best'
        })
      : image

    const quality = Math.min(Math.max(Number(options.quality || 90), 78), 96)
    const isPngLike = /^data:image\/png/i.test(source)
    const outputBuffer = isPngLike ? resized.toPNG() : resized.toJPEG(quality)
    const outputMime = isPngLike ? 'image/png' : 'image/jpeg'
    const nextValue = `data:${outputMime};base64,${outputBuffer.toString('base64')}`
    return nextValue.length && nextValue.length < source.length ? nextValue : source
  } catch {
    return source
  }
}

function compressStoredImageList(value, options = {}) {
  return normalizeImageList(value).map((item) => compressStoredImage(item, options))
}

function normalizeReviewImagesForStorage(value) {
  return normalizeImageList(value)
}

function compressImagePayloadForStorage(payload = {}, fieldName = 'image_path', options = {}) {
  return {
    ...payload,
    [fieldName]: compressStoredImage(payload?.[fieldName], options)
  }
}

function userCanAccess(user = {}, feature) {
  if (cleanText(user.role) === AUTH_SUPER_ADMIN) return true
  const permissions = normalizePermissions(user.permissions_json || user.permissions || [])
  return permissions.includes('*') || permissions.includes(cleanText(feature))
}

function sanitizeUserRecord(row = {}) {
  return {
    id: Number(row.id || 0),
    username: cleanText(row.username),
    display_name: cleanText(row.display_name) || cleanText(row.username),
    role: cleanText(row.role) || 'user',
    permissions: normalizePermissions(row.permissions_json || row.permissions || []),
    enabled: Number(row.enabled || 0) ? 1 : 0,
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  }
}

function normalizeUnit(unit) {
  const value = String(unit || '').trim().toLowerCase()
  if (['m', 'meter', 'meters', '米'].includes(value)) return '米'
  if (['yd', 'yard', 'yards', '码', '碼'].includes(value)) return '码'
  if (['kg', '公斤', '千克'].includes(value)) return '公斤'
  if (['cm', '厘米'].includes(value)) return '厘米'
  if (['个'].includes(value)) return '个'
  if (['条'].includes(value)) return '条'
  if (['对'].includes(value)) return '对'
  if (['卷'].includes(value)) return '卷'
  return String(unit || '').trim() || '米'
}

function isConvertibleUnit(unit) {
  return ['厘米', '米', '码', '公斤'].includes(normalizeUnit(unit))
}

function calculateAutoMetersPerKg(material = {}) {
  const width = Number(material.width || 0)
  const weight = Number(material.weight || 0)
  if (!width || !weight) return 0
  return round(100000 / (width * weight), 6)
}

function resolveMetersPerKg(material = {}) {
  const manual = Number(material.meter_per_kg || 0)
  if (manual > 0) return manual
  return calculateAutoMetersPerKg(material)
}

function getCustomConversion(material = {}) {
  const fromQty = Number(material.custom_conversion_from_qty || 0)
  const toQty = Number(material.custom_conversion_to_qty || 0)
  const fromUnit = normalizeUnit(material.custom_conversion_from_unit || '')
  const toUnit = normalizeUnit(material.custom_conversion_to_unit || '')
  if (fromQty <= 0 || toQty <= 0 || !fromUnit || !toUnit || fromUnit === toUnit) return null
  return { fromQty, toQty, fromUnit, toUnit }
}

function buildConversionGraph(material = {}) {
  const graph = new Map()
  const addEdge = (from, to, factor) => {
    if (!from || !to || !factor) return
    const safeFactor = Number(factor || 0)
    if (!safeFactor) return
    if (!graph.has(from)) graph.set(from, [])
    graph.get(from).push({ to, factor: safeFactor })
  }

  addEdge('米', '厘米', 100)
  addEdge('厘米', '米', 0.01)
  addEdge('米', '码', 1 / 0.9144)
  addEdge('码', '米', 0.9144)

  const metersPerKg = resolveMetersPerKg(material)
  if (metersPerKg > 0) {
    addEdge('公斤', '米', metersPerKg)
    addEdge('米', '公斤', 1 / metersPerKg)
  }

  const custom = getCustomConversion(material)
  if (custom) {
    addEdge(custom.fromUnit, custom.toUnit, custom.toQty / custom.fromQty)
    addEdge(custom.toUnit, custom.fromUnit, custom.fromQty / custom.toQty)
  }

  return graph
}

function resolveConversionFactor(fromUnit, toUnit, material = {}) {
  const sourceUnit = normalizeUnit(fromUnit)
  const targetUnit = normalizeUnit(toUnit)
  if (!sourceUnit || !targetUnit) return 0
  if (sourceUnit === targetUnit) return 1

  const graph = buildConversionGraph(material)
  const queue = [{ unit: sourceUnit, factor: 1 }]
  const visited = new Set([sourceUnit])

  while (queue.length) {
    const current = queue.shift()
    const edges = graph.get(current.unit) || []
    for (const edge of edges) {
      const nextFactor = current.factor * edge.factor
      if (edge.to === targetUnit) return nextFactor
      if (!visited.has(edge.to)) {
        visited.add(edge.to)
        queue.push({ unit: edge.to, factor: nextFactor })
      }
    }
  }

  return 0
}

function convertQuantity(value, fromUnit, toUnit, material = {}) {
  const amount = Number(value || 0)
  const sourceUnit = normalizeUnit(fromUnit)
  const targetUnit = normalizeUnit(toUnit)

  if (!amount || sourceUnit === targetUnit) return amount
  const factor = resolveConversionFactor(sourceUnit, targetUnit, material)
  if (!factor) {
    throw new Error(`暂不支持单位【${sourceUnit}】与【${targetUnit}】之间换算`)
  }
  return round(amount * factor, 6)
}

function tryConvertQuantity(value, fromUnit, toUnit, material = {}, fallbackValue = 0) {
  try {
    return Number(convertQuantity(value, fromUnit, toUnit, material) || 0)
  } catch {
    return Number(fallbackValue || 0)
  }
}

function sumSizeBreakdownQty(list = []) {
  return normalizeSizeBreakdownList(list)
    .reduce((sum, item) => sum + Number(item.qty || 0), 0)
}

function normalizeInventorySize(value) {
  return cleanText(value)
}

function buildInventoryRowKey(materialId, color = '未分色', size = '', supplier = '') {
  return [
    Number(materialId || 0),
    String(color || '未分色').trim() || '未分色',
    normalizeInventorySize(size),
    cleanText(supplier)
  ].join('__')
}

function rebuildInventoryClearedRowsTableIfNeeded() {
  const columns = db.prepare(`PRAGMA table_info(inventory_cleared_rows)`).all()
  if (!columns.length) return

  const pkColumns = columns
    .filter((item) => Number(item.pk || 0) > 0)
    .sort((a, b) => Number(a.pk || 0) - Number(b.pk || 0))
    .map((item) => item.name)
  const hasSupplier = columns.some((item) => item.name === 'supplier')
  const expectedPk = ['material_id', 'color', 'size', 'supplier']
  if (hasSupplier && pkColumns.join('|') === expectedPk.join('|')) return

  const legacyRows = db.prepare(`SELECT * FROM inventory_cleared_rows`).all()
  const insertRows = db.transaction((rows) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO inventory_cleared_rows (
        material_id,
        color,
        size,
        supplier,
        created_at
      ) VALUES (?, ?, ?, ?, ?)
    `)
    rows.forEach((row) => {
      insert.run(
        Number(row.material_id || 0),
        cleanText(row.color) || '未分色',
        cleanText(row.size),
        cleanText(row.supplier),
        row.created_at || null
      )
    })
  })

  db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.exec(`
      ALTER TABLE inventory_cleared_rows RENAME TO inventory_cleared_rows_legacy;
      CREATE TABLE inventory_cleared_rows (
        material_id INTEGER NOT NULL,
        color TEXT NOT NULL DEFAULT '',
        size TEXT NOT NULL DEFAULT '',
        supplier TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (material_id, color, size, supplier)
      );
    `)
    insertRows(legacyRows)
    db.exec(`DROP TABLE inventory_cleared_rows_legacy;`)
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

function rebuildInventoryClearedBatchesTableIfNeeded() {
  const columns = db.prepare(`PRAGMA table_info(inventory_cleared_batches)`).all()
  if (!columns.length) return

  const pkColumns = columns
    .filter((item) => Number(item.pk || 0) > 0)
    .sort((a, b) => Number(a.pk || 0) - Number(b.pk || 0))
    .map((item) => item.name)

  const expectedPk = ['batch_id']
  if (pkColumns.join('|') === expectedPk.join('|')) return

  const legacyRows = db.prepare(`SELECT * FROM inventory_cleared_batches`).all()
  const insertRows = db.transaction((rows) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO inventory_cleared_batches (
        batch_id,
        created_at
      ) VALUES (?, ?)
    `)
    rows.forEach((row) => {
      const batchId = Number(row.batch_id || 0)
      if (!batchId) return
      insert.run(batchId, row.created_at || null)
    })
  })

  db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.exec(`
      ALTER TABLE inventory_cleared_batches RENAME TO inventory_cleared_batches_legacy;
      CREATE TABLE inventory_cleared_batches (
        batch_id INTEGER PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
    insertRows(legacyRows)
    db.exec(`DROP TABLE inventory_cleared_batches_legacy;`)
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

function convertIssuedQtyToMaterialUnit(row = {}, material = {}) {
  const rawQty = Number((row.actual_issued_qty_raw ?? row.actual_issued_qty) || 0)
  const targetUnit = normalizeUnit(row.material_unit || material.unit || '米')
  const sourceUnit = normalizeUnit(row.actual_issued_unit || targetUnit)
  const sizeBreakdownQty = sumSizeBreakdownQty(row.material_size_breakdown)
  if (rawQty <= 0) {
    if (sizeBreakdownQty > 0) {
      return {
        qty: round(sizeBreakdownQty, 6),
        sourceUnit: targetUnit,
        targetUnit
      }
    }
    return {
      qty: 0,
      sourceUnit,
      targetUnit
    }
  }

  if (sourceUnit === targetUnit) {
    return {
      qty: round(rawQty, 6),
      sourceUnit,
      targetUnit
    }
  }

  try {
    return {
      qty: Number(convertQuantity(rawQty, sourceUnit, targetUnit, material) || 0),
      sourceUnit,
      targetUnit
    }
  } catch (error) {
    const materialLabel = row.material_name || material.name || row.material_code || material.code || '该原料'
    if (normalizeUsageMode(row.usage_mode, row) === 'full_cut') {
      throw new Error(`尽裁原料【${materialLabel}】的实际用量单位【${sourceUnit}】无法换算，请改成与物料资料一致的【${targetUnit}】`)
    }
    return {
      qty: 0,
      sourceUnit,
      targetUnit
    }
  }
}

function resolvePurchaseInputQtyFromActualQty(payload = {}, material = {}) {
  const actualQty = Number(
    payload.actual_input_qty ?? payload.purchase_input_qty ?? payload.gross_qty ?? payload.remaining_qty ?? 0
  )
  if (!actualQty) return 0

  const adjustmentPayload = buildAdjustmentPayloadFromMaterial(material, payload)
  const adjustmentType = adjustmentPayload.adjustment_type || 'none'

  if (adjustmentType === 'rate') {
    const rawGapRatio = Number(adjustmentPayload.gap_ratio || 0)
    const ratio = rawGapRatio > 1 ? rawGapRatio / 100 : rawGapRatio
    if (ratio > 0) return round(actualQty / ratio, 6)
  }

  if (adjustmentType === 'weight_gap') {
    const rollCount = Math.max(Number(payload.roll_count || 0), 0)
    const deductionPerRoll = Math.max(Number(adjustmentPayload.left_gap || 0), 0) + Math.max(Number(adjustmentPayload.right_gap || 0), 0)
    if (rollCount > 0 && deductionPerRoll > 0) {
      return round(actualQty + rollCount * deductionPerRoll, 6)
    }
  }

  return round(actualQty, 6)
}

function convertIssuedCostQtyToMaterialUnit(row = {}, material = {}) {
  // “实际用量”录入的是实际可用/实际消耗数量。
  // 采购批次的 base_unit_price 已经按实际入库数量摊过成本，
  // 这里如果再把数量反推回采购量，会把空差重复计算一次。
  return convertIssuedQtyToMaterialUnit(row, material)
}

function convertUnitPrice(price, fromUnit, toUnit, material = {}) {
  const unitPrice = Number(price || 0)
  if (!unitPrice) return 0

  const requiredSourceUnits = convertQuantity(1, toUnit, fromUnit, material)
  if (!requiredSourceUnits) return 0

  return round(unitPrice * requiredSourceUnits, 6)
}

function costPerInputUnit(unitCost, inputUnit, materialUnit, material) {
  const oneInputUnitInMaterialUnit = convertQuantity(1, inputUnit, materialUnit, material)
  return round(oneInputUnitInMaterialUnit * Number(unitCost || 0), 6)
}

function adjustMaterialUnitPrice(price, material = {}) {
  const rawPrice = Number(price || 0)
  if (!rawPrice) return 0
  const adjustmentType = String(material.adjustment_type || 'none').trim()
  if (adjustmentType === 'rate') {
    const rawGapRatio = Number(material.gap_ratio || 0)
    const gapRatio = rawGapRatio > 1 ? rawGapRatio / 100 : rawGapRatio
    if (gapRatio > 0) return round(rawPrice / gapRatio, 6)
  }
  if (adjustmentType === 'weight_gap') {
    const referenceQty = Number(material.gap_reference_qty || 0)
    const deduction = Math.max(Number(material.left_gap || 0), 0) + Math.max(Number(material.right_gap || 0), 0)
    const netQty = referenceQty - deduction
    if (referenceQty > 0 && netQty > 0) return round(rawPrice * (referenceQty / netQty), 6)
  }
  return round(rawPrice, 6)
}

function getPriceTypeLabel(type) {
  return PRICE_TYPE_LABELS[type] || PRICE_TYPE_LABELS.bulk
}

function defaultUsageModeFromRow(row = {}) {
  return cleanText(row.material_role) === 'A料' ? 'full_cut' : 'by_usage'
}

function normalizeUsageMode(value, row = {}) {
  const normalized = cleanText(value).toLowerCase()
  if (['full_cut', '尽裁'].includes(normalized)) return 'full_cut'
  if (['by_usage', '按量'].includes(normalized)) return 'by_usage'
  return defaultUsageModeFromRow(row)
}

function getUsageModeLabel(value, row = {}) {
  return USAGE_MODE_LABELS[normalizeUsageMode(value, row)] || USAGE_MODE_LABELS.by_usage
}

const BACKUP_TABLES = [
  'materials',
  'material_color_prices',
  'garments',
  'boms',
  'purchase_batches',
  'production_orders',
  'production_order_plan_items',
  'production_order_materials',
  'consumption_records',
  'option_values'
]

function buildBackupPayload() {
  const tables = {}
  BACKUP_TABLES.forEach((table) => {
    tables[table] = db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all()
  })

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    tables
  }
}

function encodeBackupText(payload) {
  const json = safeJsonStringify(payload, '{}')
  const compressed = zlib.gzipSync(Buffer.from(json, 'utf8')).toString('base64')
  return `GARMENT_EMS_BACKUP_V1:${compressed}`
}

function decodeBackupText(text) {
  const value = cleanText(text)
  if (!value.startsWith('GARMENT_EMS_BACKUP_V1:')) {
    throw new Error('备份文本格式不正确')
  }

  const compressed = Buffer.from(value.slice('GARMENT_EMS_BACKUP_V1:'.length), 'base64')
  const json = zlib.gunzipSync(compressed).toString('utf8')
  const payload = JSON.parse(json)
  if (!payload?.tables) throw new Error('备份内容缺少数据表')
  return payload
}

function getWorkspaceInfo() {
  const currentConfig = readWorkspaceConfig()
  const sharedInfo = readSharedWorkspaceInfo(workspacePath)
  const lanBridge = buildLanBridgeConfig({
    ...sharedInfo,
    ...currentConfig
  })
  const exists = fs.existsSync(dbPath)
  const stats = exists ? fs.statSync(dbPath) : null
  const localBackupPath = path.join(LOCAL_DATABASE_BACKUP_DIR, WORKSPACE_DB_NAME)
  const localBackupExists = fs.existsSync(localBackupPath)
  const localBackupStats = localBackupExists ? fs.statSync(localBackupPath) : null
  const dailyBackupPath = path.join(LOCAL_DATABASE_BACKUP_DIR, 'daily', `garment_ems-${localDateCode()}.db`)
  const dailyBackupExists = fs.existsSync(dailyBackupPath)
  const dailyBackupStats = dailyBackupExists ? fs.statSync(dailyBackupPath) : null
  return {
    workspace_path: workspacePath,
    database_path: dbPath,
    database_name: WORKSPACE_DB_NAME,
    exists,
    file_size: Number(stats?.size || 0),
    updated_at: stats?.mtime?.toISOString?.() || '',
    is_network_path: isNetworkWorkspacePath(workspacePath),
    is_read_only: workspaceReadOnly,
    access_mode_label: workspaceReadOnly ? '只读模式' : '普通模式',
    current_client_name: getClientName(),
    host_computer_name: cleanText(currentConfig?.hostComputerName || ''),
    host_workspace_path: cleanText(currentConfig?.hostWorkspacePath || ''),
    preferred_shared_workspace_path: cleanText(currentConfig?.preferredSharedWorkspacePath || ''),
    is_host: cleanText(currentConfig?.hostComputerName || '') === getClientName(),
    lan_service_enabled: lanBridge.enabled,
    lan_service_port: lanBridge.port,
    lan_service_host: lanBridge.host,
    prefer_lan_service: lanBridge.prefer_remote,
    offline_mode: Boolean(currentConfig?.offlineMode),
    offline_pending_sync: Boolean(currentConfig?.offlinePendingSync),
    offline_conflict: Boolean(currentConfig?.offlineConflict),
    local_backup_path: localBackupPath,
    local_backup_exists: localBackupExists,
    local_backup_updated_at: localBackupStats?.mtime?.toISOString?.() || '',
    daily_backup_path: dailyBackupPath,
    daily_backup_exists: dailyBackupExists,
    daily_backup_updated_at: dailyBackupStats?.mtime?.toISOString?.() || '',
    storage_optimization_running: Boolean(storageOptimizationState.running),
    storage_optimization_stage: storageOptimizationState.stage_label || '未开始',
    storage_optimization_progress_percent: Number(storageOptimizationState.progress_percent || 0),
    storage_optimization_started_at: storageOptimizationState.started_at || '',
    storage_optimization_finished_at: storageOptimizationState.finished_at || '',
    storage_optimization_message: storageOptimizationState.message || '',
    storage_optimization_estimated_saved_size: Number(storageOptimizationState.estimated_saved_size || 0),
    storage_optimization_vacuum_skipped: Boolean(storageOptimizationState.vacuum_skipped),
    sharing_tip: isNetworkWorkspacePath(workspacePath)
      ? workspaceReadOnly
        ? '当前是局域网共享目录的只读模式，适合其他电脑查看，不能修改数据。'
        : '当前是局域网共享目录，建议同一时间尽量只让一台电脑编辑，其他电脑查看或轮流录入。'
      : Boolean(currentConfig?.preferredSharedWorkspacePath)
        ? '当前主机不在线，软件已切到本地离线库。你的修改会先保存在本机，检测到主机恢复后会尝试自动安全回传。'
        : '当前是本机工作目录，可随时导出完整数据库文件到其他电脑。'
  }
}

async function optimizeImageFieldInBatches(options = {}) {
  const {
    table,
    field,
    emptyValue,
    compress,
    update,
    batchSize = 20,
    stage,
    stageLabel,
    summaryKey
  } = options

  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE COALESCE(${field}, ?) <> ?`).get(emptyValue, emptyValue)?.count || 0)
  const selectRows = db.prepare(`
    SELECT id, ${field} AS value
    FROM ${table}
    WHERE COALESCE(${field}, ?) <> ?
      AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `)
  const updateRows = db.prepare(`UPDATE ${table} SET ${field}=? WHERE id=?`)

  let processed = 0
  let lastId = 0
  while (true) {
    const rows = selectRows.all(emptyValue, emptyValue, lastId, batchSize)
    if (!rows.length) break
    db.transaction(() => {
      rows.forEach((row) => {
        const currentValue = cleanText(row.value)
        const nextValue = update(row)
        processed += 1
        if (nextValue !== currentValue) {
          updateRows.run(nextValue, row.id)
          storageOptimizationState[summaryKey] = Number(storageOptimizationState[summaryKey] || 0) + 1
          storageOptimizationState.estimated_saved_size = Number(storageOptimizationState.estimated_saved_size || 0) + Math.max(Buffer.byteLength(currentValue, 'utf8') - Buffer.byteLength(nextValue, 'utf8'), 0)
        }
      })
    })()
    lastId = Number(rows[rows.length - 1].id || lastId)
    updateStorageOptimizationState({
      stage,
      stage_label: stageLabel,
      processed_items: Number(storageOptimizationState.processed_items || 0) + rows.length
    })
    await waitForMainLoop()
  }
  return total
}

async function optimizeDatabaseStorageInBackground() {
  assertWritable('执行数据库瘦身')
  const beforeSize = fs.existsSync(dbPath) ? Number(fs.statSync(dbPath).size || 0) : 0
  const materialTotal = Number(db.prepare("SELECT COUNT(*) AS count FROM materials WHERE COALESCE(image_path, '') <> ''").get()?.count || 0)
  const garmentTotal = Number(db.prepare("SELECT COUNT(*) AS count FROM garments WHERE COALESCE(image_path, '') <> ''").get()?.count || 0)
  const purchaseTotal = Number(db.prepare("SELECT COUNT(*) AS count FROM purchase_batches WHERE COALESCE(review_images_json, '[]') <> '[]'").get()?.count || 0)
  const productionTotal = Number(db.prepare("SELECT COUNT(*) AS count FROM production_orders WHERE COALESCE(review_images_json, '[]') <> '[]'").get()?.count || 0)
  const totalItems = materialTotal + garmentTotal + purchaseTotal + productionTotal

  updateStorageOptimizationState({
    running: true,
    stage: 'prepare',
    stage_label: '正在整理图片数据',
    started_at: new Date().toISOString(),
    finished_at: '',
    total_items: totalItems,
    processed_items: 0,
    before_size: beforeSize,
    after_size: beforeSize,
    saved_size: 0,
    estimated_saved_size: 0,
    updated_material_images: 0,
    updated_garment_images: 0,
    updated_purchase_image_sets: 0,
    updated_production_image_sets: 0,
    vacuum_performed: false,
    vacuum_skipped: true,
    message: totalItems ? '数据库瘦身已转入后台，可继续使用软件。' : '当前没有需要压缩的历史图片。'
  })

  try {
    await optimizeImageFieldInBatches({
      table: 'materials',
      field: 'image_path',
      emptyValue: '',
      stage: 'materials',
      stageLabel: '正在压缩物料图片',
      summaryKey: 'updated_material_images',
      update: (row) => compressStoredImage(row.value, { maxEdge: 2400, quality: 92, minLength: 450 * 1024 })
    })
    await optimizeImageFieldInBatches({
      table: 'garments',
      field: 'image_path',
      emptyValue: '',
      stage: 'garments',
      stageLabel: '正在压缩成衣图片',
      summaryKey: 'updated_garment_images',
      update: (row) => compressStoredImage(row.value, { maxEdge: 2400, quality: 92, minLength: 450 * 1024 })
    })
    await optimizeImageFieldInBatches({
      table: 'purchase_batches',
      field: 'review_images_json',
      emptyValue: '[]',
      stage: 'purchase_reviews',
      stageLabel: '正在压缩采购单据图片',
      summaryKey: 'updated_purchase_image_sets',
      update: (row) => safeJsonStringify(
        compressStoredImageList(row.value, { maxEdge: 2400, quality: 90, minLength: 500 * 1024 }),
        '[]'
      )
    })
    await optimizeImageFieldInBatches({
      table: 'production_orders',
      field: 'review_images_json',
      emptyValue: '[]',
      stage: 'production_reviews',
      stageLabel: '正在压缩制单单据图片',
      summaryKey: 'updated_production_image_sets',
      update: (row) => safeJsonStringify(
        compressStoredImageList(row.value, { maxEdge: 2400, quality: 90, minLength: 500 * 1024 }),
        '[]'
      )
    })

    try {
      db.pragma('optimize')
    } catch {}

    const afterSize = fs.existsSync(dbPath) ? Number(fs.statSync(dbPath).size || 0) : beforeSize
    updateStorageOptimizationState({
      running: false,
      stage: 'completed',
      stage_label: '已完成',
      finished_at: new Date().toISOString(),
      after_size: afterSize,
      saved_size: Math.max(beforeSize - afterSize, 0),
      processed_items: totalItems,
      message: totalItems
        ? '图片已后台压缩完成。为避免卡顿，本次未执行阻塞式 VACUUM；后续维护时会继续回收物理空间。'
        : '当前没有需要压缩的历史图片。'
    })
  } catch (error) {
    updateStorageOptimizationState({
      running: false,
      stage: 'failed',
      stage_label: '失败',
      finished_at: new Date().toISOString(),
      message: cleanText(error?.message || '数据库瘦身失败')
    })
    throw error
  }
}

async function backupDatabaseFile(targetFilePath, sourceFilePath = dbPath, sourceDb = db) {
  ensureDirectory(path.dirname(targetFilePath))
  if (path.resolve(targetFilePath) === path.resolve(sourceFilePath)) return targetFilePath
  if (fs.existsSync(targetFilePath)) fs.unlinkSync(targetFilePath)

  if (isDatabaseOpen(sourceDb)) {
    if (typeof sourceDb.backup === 'function') {
      await sourceDb.backup(targetFilePath)
      return targetFilePath
    }

    const escapedPath = targetFilePath.replace(/'/g, "''")
    sourceDb.exec(`VACUUM INTO '${escapedPath}'`)
    return targetFilePath
  }

  if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
    throw new Error('数据库文件不存在，无法创建备份')
  }

  fs.copyFileSync(sourceFilePath, targetFilePath)
  validateDatabaseFile(targetFilePath)
  return targetFilePath
}

function validateDatabaseFile(targetFilePath) {
  const checkDb = new Database(targetFilePath, { readonly: true })
  try {
    checkDb.prepare('SELECT name FROM sqlite_master LIMIT 1').all()
  } finally {
    checkDb.close()
  }
}

function assertWritable(action = '执行该操作') {
  if (workspaceReadOnly) {
    throw new Error(`当前数据库以只读模式打开，不能${action}。请在首页切回普通模式后再试。`)
  }
}

function resolveSelectedWorkspacePath(rootPath) {
  const directWorkspacePath = rootPath
  const nestedWorkspacePath = path.join(rootPath, 'Garment EMS Shared')
  const directDbPath = resolveDatabasePath(directWorkspacePath)
  const nestedDbPath = resolveDatabasePath(nestedWorkspacePath)

  if (fs.existsSync(directDbPath)) return directWorkspacePath
  if (fs.existsSync(nestedDbPath)) return nestedWorkspacePath
  return nestedWorkspacePath
}

function applyWorkspaceSelection(nextWorkspacePath, readOnlyMode = false) {
  writeWorkspaceConfig({
    workspacePath: nextWorkspacePath,
    readOnlyMode: Boolean(readOnlyMode)
  })
  workspacePath = nextWorkspacePath
  workspaceReadOnly = Boolean(readOnlyMode)
  reopenDatabaseConnection(resolveDatabasePath(nextWorkspacePath), workspaceReadOnly)
}

function markOfflinePendingSync() {
  const preferredSharedWorkspacePath = getPreferredSharedWorkspacePath()
  if (!preferredSharedWorkspacePath || isNetworkWorkspacePath(workspacePath)) return
  const currentConfig = readWorkspaceConfig()
  writeWorkspaceConfig({
    preferredSharedWorkspacePath,
    offlineMode: true,
    offlinePendingSync: true,
    offlineConflict: false,
    offlineUpdatedAt: new Date().toISOString(),
    offlineBaseSharedSignature: currentConfig?.offlineBaseSharedSignature || currentConfig?.lastSharedSignature || null
  })
}

function refreshOnlineSharedSignature() {
  if (!isNetworkWorkspacePath(workspacePath)) return
  writeWorkspaceConfig({
    preferredSharedWorkspacePath: workspacePath,
    lastSharedSignature: getFileSignature(dbPath),
    offlineMode: false,
    offlinePendingSync: false,
    offlineConflict: false,
    offlineBaseSharedSignature: null,
    lastAutoSyncAt: new Date().toISOString()
  })
}

async function attemptOfflineAutoSync() {
  const currentConfig = readWorkspaceConfig()
  const preferredSharedWorkspacePath = cleanText(currentConfig?.preferredSharedWorkspacePath || '')
  if (!preferredSharedWorkspacePath || isNetworkWorkspacePath(workspacePath)) return { switched: false, reason: 'no_offline_context' }

  const targetDbPath = resolveDatabasePath(preferredSharedWorkspacePath)
  if (!fs.existsSync(targetDbPath)) return { switched: false, reason: 'host_offline' }

  validateDatabaseFile(targetDbPath)

  if (currentConfig?.offlinePendingSync) {
    const currentSharedSignature = getFileSignature(targetDbPath)
    const baseSignature = currentConfig?.offlineBaseSharedSignature || currentConfig?.lastSharedSignature || null
    if (baseSignature && !signaturesMatch(currentSharedSignature, baseSignature)) {
      writeWorkspaceConfig({
        offlineMode: true,
        offlinePendingSync: true,
        offlineConflict: true,
        detectedSharedSignature: currentSharedSignature
      })
      return { switched: false, reason: 'conflict' }
    }

    await backupDatabaseFile(targetDbPath)
  }

  applyWorkspaceSelection(preferredSharedWorkspacePath, false)
  writeWorkspaceConfig({
    preferredSharedWorkspacePath,
    hostWorkspacePath: cleanText(currentConfig?.hostWorkspacePath || preferredSharedWorkspacePath),
    hostComputerName: cleanText(currentConfig?.hostComputerName || ''),
    lastSharedSignature: getFileSignature(targetDbPath),
    offlineMode: false,
    offlinePendingSync: false,
    offlineConflict: false,
    offlineBaseSharedSignature: null,
    lastAutoSyncAt: new Date().toISOString()
  })
  await syncLocalDatabaseBackup().catch(() => {})
  scheduleAppRestart()
  return { switched: true, workspacePath: preferredSharedWorkspacePath }
}

let offlineSyncTimer = null
let offlineSyncBusy = false

function startOfflineSyncWatcher() {
  if (offlineSyncTimer) clearInterval(offlineSyncTimer)
  offlineSyncTimer = setInterval(async () => {
    if (offlineSyncBusy) return
    offlineSyncBusy = true
    try {
      await attemptOfflineAutoSync()
    } catch {
      // ignore watcher errors; UI will expose current state
    } finally {
      offlineSyncBusy = false
    }
  }, 15000)
}

function scheduleAppRestart() {
  setTimeout(() => {
    app.relaunch()
    app.exit(0)
  }, 180)
}

async function syncLocalDatabaseBackup() {
  ensureDirectory(LOCAL_DATABASE_BACKUP_DIR)
  const backupPath = path.join(LOCAL_DATABASE_BACKUP_DIR, WORKSPACE_DB_NAME)
  const sourceSignature = getFileSignature(dbPath)
  const backupSignature = getFileSignature(backupPath)
  if (!signaturesMatch(sourceSignature, backupSignature)) {
    await backupDatabaseFile(backupPath, dbPath, db)
  }
  writeSharedWorkspaceInfo(workspacePath, {
    workspacePath,
    databasePath: dbPath,
    hostComputerName: cleanText(readWorkspaceConfig()?.hostComputerName || ''),
    hostWorkspacePath: cleanText(readWorkspaceConfig()?.hostWorkspacePath || workspacePath),
    lanServiceEnabled: buildLanBridgeConfig().enabled,
    lanServicePort: buildLanBridgeConfig().port,
    lanServiceHost: buildLanBridgeConfig().host
  })
  fs.writeFileSync(
    path.join(LOCAL_DATABASE_BACKUP_DIR, 'workspace-info.json'),
    JSON.stringify(
      {
        workspacePath,
        databasePath: dbPath,
        localBackupPath: backupPath,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  )
  return backupPath
}

async function ensureDailyDatabaseBackup() {
  if (workspaceReadOnly) return null
  const dailyDir = path.join(LOCAL_DATABASE_BACKUP_DIR, 'daily')
  ensureDirectory(dailyDir)
  const backupPath = path.join(dailyDir, `garment_ems-${localDateCode()}.db`)
  if (!fs.existsSync(backupPath)) {
    await backupDatabaseFile(backupPath, dbPath, db)
  }
  try {
    const backupFiles = fs.readdirSync(dailyDir)
      .filter((name) => /^garment_ems-\d{8}\.db$/i.test(name))
      .map((name) => ({
        name,
        fullPath: path.join(dailyDir, name),
        time: Number(fs.statSync(path.join(dailyDir, name)).mtimeMs || 0)
      }))
      .sort((a, b) => b.time - a.time)

    backupFiles.slice(DAILY_BACKUP_RETENTION_DAYS).forEach((item) => {
      if (fs.existsSync(item.fullPath)) fs.unlinkSync(item.fullPath)
      const journalPath = `${item.fullPath}-journal`
      if (fs.existsSync(journalPath)) fs.unlinkSync(journalPath)
    })
  } catch {
    // ignore backup pruning errors so write flow is not blocked
  }
  return backupPath
}

let postWriteMaintenancePromise = Promise.resolve()
let postWriteMaintenanceRunning = false
let lastPostWriteMaintenanceAt = 0
let backgroundBackupTimer = null
let backgroundBackupRunning = false
let lastBackgroundBackupAt = 0

function scheduleBackgroundBackup(reason = 'general', delayMs = 45000) {
  if (workspaceReadOnly) return
  const delay = Math.max(5000, Number(delayMs || 0))
  if (backgroundBackupTimer) clearTimeout(backgroundBackupTimer)
  backgroundBackupTimer = setTimeout(() => {
    backgroundBackupTimer = null
    runBackgroundBackup(reason).catch(() => {})
  }, delay)
}

async function runBackgroundBackup(reason = 'general') {
  if (workspaceReadOnly || databaseSwitching || !isDatabaseOpen(db) || backgroundBackupRunning) return
  const now = Date.now()
  if (now - lastBackgroundBackupAt < 10 * 60 * 1000 && reason !== 'startup') return
  backgroundBackupRunning = true
  try {
    lastBackgroundBackupAt = now
    await syncLocalDatabaseBackup().catch(() => {})
    await ensureDailyDatabaseBackup().catch(() => {})
    refreshOnlineSharedSignature()
  } finally {
    backgroundBackupRunning = false
  }
}

async function performPostWriteMaintenance() {
  if (databaseSwitching || !isDatabaseOpen(db)) return
  try {
    db.pragma('optimize')
  } catch {}
  refreshOnlineSharedSignature()
  scheduleBackgroundBackup('post-write', 90000)
}

async function runPostWriteMaintenance() {
  bumpDataRevision()
  markProductionOrdersDirty()
  markOfflinePendingSync()
  const now = Date.now()
  if (postWriteMaintenanceRunning) return postWriteMaintenancePromise
  if (now - lastPostWriteMaintenanceAt < 5000) return postWriteMaintenancePromise

  postWriteMaintenanceRunning = true
  postWriteMaintenancePromise = Promise.resolve()
    .then(async () => {
      lastPostWriteMaintenanceAt = Date.now()
      await performPostWriteMaintenance()
    })
    .finally(() => {
      postWriteMaintenanceRunning = false
    })
  return postWriteMaintenancePromise
}

function getCurrentActor() {
  return {
    username: cleanText(currentActor.username) || 'system',
    display_name: cleanText(currentActor.display_name) || cleanText(currentActor.username) || '系统',
    role: cleanText(currentActor.role) || 'system',
    client_name: getClientName()
  }
}

function logAudit(module, action, entityType, entityId, entityLabel, beforeValue = null, afterValue = null, remark = '') {
  if (workspaceReadOnly) return
  const actor = getCurrentActor()
  db.prepare(`
    INSERT INTO audit_logs (
      module,
      action,
      entity_type,
      entity_id,
      entity_label,
      before_json,
      after_json,
      operator_username,
      operator_name,
      client_name,
      remark
    ) VALUES (
      @module,
      @action,
      @entity_type,
      @entity_id,
      @entity_label,
      @before_json,
      @after_json,
      @operator_username,
      @operator_name,
      @client_name,
      @remark
    )
  `).run({
    module: cleanText(module),
    action: cleanText(action),
    entity_type: cleanText(entityType),
    entity_id: Number(entityId || 0) || null,
    entity_label: cleanText(entityLabel),
    before_json: beforeValue === undefined ? '' : safeJsonStringify(beforeValue, ''),
    after_json: afterValue === undefined ? '' : safeJsonStringify(afterValue, ''),
    operator_username: actor.username,
    operator_name: actor.display_name,
    client_name: actor.client_name,
    remark: cleanText(remark)
  })
}

function logInventoryMovement(payload = {}) {
  if (workspaceReadOnly) return
  const actor = getCurrentActor()
  db.prepare(`
    INSERT INTO inventory_movements (
      movement_type,
      direction,
      material_id,
      batch_id,
      material_code,
      material_name,
      color,
      qty,
      unit,
      balance_after,
      source_table,
      source_id,
      source_no,
      document_status,
      operator_username,
      operator_name,
      client_name,
      remark
    ) VALUES (
      @movement_type,
      @direction,
      @material_id,
      @batch_id,
      @material_code,
      @material_name,
      @color,
      @qty,
      @unit,
      @balance_after,
      @source_table,
      @source_id,
      @source_no,
      @document_status,
      @operator_username,
      @operator_name,
      @client_name,
      @remark
    )
  `).run({
    movement_type: cleanText(payload.movement_type),
    direction: cleanText(payload.direction),
    material_id: Number(payload.material_id || 0) || null,
    batch_id: Number(payload.batch_id || 0) || null,
    material_code: cleanText(payload.material_code),
    material_name: cleanText(payload.material_name),
    color: cleanText(payload.color),
    qty: Number(payload.qty || 0),
    unit: normalizeUnit(payload.unit || '米'),
    balance_after: Number(payload.balance_after || 0),
    source_table: cleanText(payload.source_table),
    source_id: Number(payload.source_id || 0) || null,
    source_no: cleanText(payload.source_no),
    document_status: getDocumentStatusLabel(payload.document_status),
    operator_username: actor.username,
    operator_name: actor.display_name,
    client_name: actor.client_name,
    remark: cleanText(payload.remark)
  })
}

if (isNetworkWorkspacePath(workspacePath)) {
  refreshOnlineSharedSignature()
}
startOfflineSyncWatcher()

function resetSqliteSequence(table) {
  const hasSequenceTable = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type='table' AND name='sqlite_sequence'
  `).get()
  if (!hasSequenceTable) return

  const row = db.prepare(`SELECT COALESCE(MAX(id), 0) AS max_id FROM ${table}`).get()
  db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(table)
  if (Number(row?.max_id || 0) > 0) {
    db.prepare(`INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)`).run(table, Number(row.max_id))
  }
}

function importBackupPayload(payload) {
  const tables = payload?.tables || {}
  const tx = db.transaction(() => {
    ;[
      'production_order_materials',
      'production_order_plan_items',
      'production_orders',
      'purchase_batches',
      'boms',
      'material_color_prices',
      'consumption_records',
      'garments',
      'materials',
      'option_values'
    ].forEach((table) => {
      db.prepare(`DELETE FROM ${table}`).run()
    })

    BACKUP_TABLES.forEach((table) => {
      const rows = Array.isArray(tables[table]) ? tables[table] : []
      if (!rows.length) {
        resetSqliteSequence(table)
        return
      }

      const validColumns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name)
      const insertColumns = validColumns.filter((column) => Object.prototype.hasOwnProperty.call(rows[0], column))
      if (!insertColumns.length) return

      const placeholders = insertColumns.map((column) => `@${column}`).join(', ')
      const insert = db.prepare(`
        INSERT INTO ${table} (${insertColumns.join(', ')})
        VALUES (${placeholders})
      `)

      rows.forEach((row) => {
        const payloadRow = {}
        insertColumns.forEach((column) => {
          payloadRow[column] = row[column]
        })
        insert.run(payloadRow)
      })

      resetSqliteSequence(table)
    })
  })

  tx()
}

function normalizeFabricType(type) {
  const value = cleanText(type)
  if (value === '梭织') return '梭织'
  return '针织'
}

function getLossRatePreset(fabricType) {
  const normalized = normalizeFabricType(fabricType)
  if (normalized === '梭织') {
    return {
      type: normalized,
      min: 0.05,
      max: 0.08,
      recommended: 0.065
    }
  }

  return {
    type: normalized,
    min: 0.08,
    max: 0.12,
    recommended: 0.1
  }
}

function resolveLossRate(fabricType, value) {
  const preset = getLossRatePreset(fabricType)
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return preset.recommended
  return numericValue
}

function resolvePriceToMaterialUnit(payload = {}, material = {}) {
  const materialUnit = normalizeUnit(material.unit || payload.unit || '米')
  const priceUnit = normalizeUnit(payload.price_unit || materialUnit)
  const price = Number(payload.price || payload.unit_price || 0)
  if (!price) return 0
  return round(convertQuantity(1, materialUnit, priceUnit, material) * price, 6)
}

function resolvePurchaseGrossQty(payload = {}, material = {}) {
  const materialUnit = normalizeUnit(material.unit || payload.unit || '米')
  const inputUnit = normalizeUnit(payload.actual_input_unit || payload.purchase_input_unit || payload.unit || materialUnit)
  const inputQty = Number(
    payload.actual_input_qty ?? payload.purchase_input_qty ?? payload.gross_qty ?? payload.remaining_qty ?? 0
  )
  if (!inputQty) return 0

  const converted = convertQuantity(inputQty, inputUnit, materialUnit, material)
  if (!converted && inputUnit !== materialUnit) {
    throw new Error(`当前原料缺少换算条件，无法把${inputUnit}换算成${materialUnit}`)
  }
  return round(converted || inputQty, 6)
}

function resolvePurchaseActualInputQty(payload = {}, material = {}) {
  const inputQty = Number(
    payload.purchase_input_qty ?? payload.actual_input_qty ?? payload.gross_qty ?? payload.remaining_qty ?? 0
  )
  if (!inputQty) return 0

  if (String(payload.price_type || '') === 'sample') {
    return round(inputQty, 6)
  }

  const adjustmentPayload = buildAdjustmentPayloadFromMaterial(material, payload)
  const adjustmentType = adjustmentPayload.adjustment_type || 'none'

  if (adjustmentType === 'rate') {
    const rawGapRatio = Number(adjustmentPayload.gap_ratio || 0)
    const ratio = rawGapRatio > 1 ? rawGapRatio / 100 : rawGapRatio
    return round(Math.max(inputQty * (ratio > 0 ? ratio : 1), 0), 6)
  }

  if (adjustmentType === 'weight_gap') {
    const rollCount = Math.max(Number(payload.roll_count || 0), 0)
    const deductionPerRoll = Math.max(Number(adjustmentPayload.left_gap || 0), 0) + Math.max(Number(adjustmentPayload.right_gap || 0), 0)
    if (rollCount > 0 && deductionPerRoll > 0) {
      return round(Math.max(inputQty - rollCount * deductionPerRoll, 0), 6)
    }
  }

  return round(inputQty, 6)
}

function formatDisplayQtyByUnit(parts = []) {
  return parts
    .filter((item) => Number(item.qty || 0) > 0 && String(item.unit || '').trim())
    .map((item) => `${round(Number(item.qty || 0), 4).toFixed(4).replace(/\.?0+$/, '')} ${item.unit}`)
    .join(' / ')
}

function summarizeBatchQtyByUnit(batches = [], qtyResolver, unitResolver) {
  const bucket = new Map()
  batches.forEach((batch) => {
    const unit = normalizeUnit(unitResolver(batch) || '')
    const qty = Number(qtyResolver(batch) || 0)
    if (!unit || !Number.isFinite(qty) || qty <= 0) return
    bucket.set(unit, round(Number(bucket.get(unit) || 0) + qty, 4))
  })
  return [...bucket.entries()].map(([unit, qty]) => ({ unit, qty }))
}

function resolvePurchasePricedQty(payload = {}, material = {}) {
  const priceUnit = normalizeUnit(payload.price_unit || material.unit || payload.unit || '米')
  const inputUnit = normalizeUnit(payload.purchase_input_unit || payload.unit || priceUnit)
  const inputQty = Number(
    payload.purchase_input_qty ?? payload.gross_qty ?? payload.remaining_qty ?? 0
  )
  if (!inputQty) return 0

  const converted = convertQuantity(inputQty, inputUnit, priceUnit, material)
  if (!converted && inputUnit !== priceUnit) {
    throw new Error(`当前原料缺少换算条件，无法把${inputUnit}换算成${priceUnit}`)
  }
  return round(converted || inputQty, 6)
}

function buildPricingContext(data = {}) {
  const grossQty = Number(data.gross_qty || 0)
  const price = Number(data.price || data.unit_price || 0)
  const leftGap = Number(data.left_gap || 0)
  const rightGap = Number(data.right_gap || 0)
  const rawGapRatio = Number(data.gap_ratio || 0)
  const gapRatio = rawGapRatio > 1 ? rawGapRatio / 100 : rawGapRatio
  const extraQty = Number(data.extra_qty || 0)
  const netQtyByWeight = Math.max(grossQty - leftGap - rightGap, 0)
  const ratio = gapRatio > 0 ? gapRatio : 1
  const netQty = extraQty > 0 ? extraQty : (data.adjustment_type === 'rate' ? grossQty * ratio : netQtyByWeight || grossQty)

  return {
    price,
    grossQty,
    qty: grossQty,
    netQty,
    leftGap,
    rightGap,
    gapRatio: ratio,
    deduction: leftGap + rightGap
  }
}

function evaluateFormula(customFormula, context) {
  const keys = Object.keys(context)
  const values = Object.values(context)
  const fn = new Function(...keys, `return (${customFormula})`)
  const result = fn(...values)
  if (!Number.isFinite(Number(result))) {
    throw new Error('自定义公式没有返回有效数字')
  }
  return Number(result)
}

function calculateEffectivePrice(data = {}) {
  const price = Number(data.price || data.unit_price || 0)
  const adjustmentType = data.adjustment_type || 'none'
  const context = buildPricingContext(data)

  if (data.custom_formula && String(data.custom_formula).trim()) {
    return round(evaluateFormula(String(data.custom_formula).trim(), context), 6)
  }

  if (!price) return 0

  if (adjustmentType === 'weight_gap') {
    if (!context.netQty) return price
    return round(price / (context.netQty / Math.max(context.grossQty, 1)), 6)
  }

  if (adjustmentType === 'rate') {
    if (!context.gapRatio) return price
    return round(price / context.gapRatio, 6)
  }

  return round(price, 6)
}

function buildAdjustmentPayloadFromMaterial(material = {}, payload = {}) {
  return {
    ...payload,
    adjustment_type: material.adjustment_type || 'none',
    left_gap: Number(material.left_gap || 0),
    right_gap: Number(material.right_gap || 0),
    gap_ratio: Number(material.gap_ratio || 0),
    custom_formula: material.custom_formula || ''
  }
}

function buildAdjustmentSummary(record = {}) {
  const priceType = String(record.price_type || '').trim()
  if (priceType === 'sample') return '-'
  const adjustmentType = String(record.adjustment_type || record.material_adjustment_type || '').trim()
  if (adjustmentType === 'weight_gap') {
    const leftGap = Number(record.left_gap ?? record.material_left_gap ?? 0)
    const rightGap = Number(record.right_gap ?? record.material_right_gap ?? 0)
    return `空差 ${formatNumber(leftGap, 0)}+${formatNumber(rightGap, 0)}`
  }
  if (adjustmentType === 'rate') {
    const gapRatio = Number(record.gap_ratio ?? record.material_gap_ratio ?? 0)
    return `空 ${formatNumber(gapRatio, 0)}`
  }
  return '正常'
}

function getMaterialById(id) {
  const material = db.prepare(`SELECT ${MATERIAL_FIELDS} FROM materials WHERE id=?`).get(id)
  return material ? enrichMaterialRecord(material) : null
}

function findDuplicateMaterial(code, excludeId = null) {
  const cleanCode = cleanText(code)
  if (!cleanCode) return null
  const row = db.prepare(`
    SELECT id, code, name
    FROM materials
    WHERE LOWER(TRIM(code)) = LOWER(TRIM(?))
      ${excludeId ? 'AND id != ?' : ''}
    LIMIT 1
  `).get(...(excludeId ? [cleanCode, Number(excludeId)] : [cleanCode]))
  return row || null
}

function getMaterialColorProfiles(materialId) {
  return db.prepare(`
    SELECT
      id,
      material_id,
      color,
      default_price,
      default_price_unit,
      size_price_json,
      sample_price_meter,
      sample_price_kg,
      sample_price_yard,
      net_price_meter,
      bulk_price_kg,
      bulk_price_meter,
      bulk_price_yard,
      remark,
      sort_order,
      created_at
    FROM material_color_prices
    WHERE material_id=?
    ORDER BY sort_order ASC, id ASC
  `).all(materialId).map((row) => ({
    ...row,
    default_price: Number(row.default_price || 0),
    default_price_unit: normalizeUnit(row.default_price_unit || ''),
    sizePrices: normalizeSizePriceList(safeJsonParse(row.size_price_json, [])),
    size_price_json: safeJsonStringify(normalizeSizePriceList(safeJsonParse(row.size_price_json, [])), '[]')
  }))
}

function getMaterialBatchColors(materialId) {
  return uniqueNonEmpty(
    db.prepare(`
      SELECT DISTINCT color
      FROM purchase_batches
      WHERE material_id=?
        AND TRIM(COALESCE(color, '')) != ''
      ORDER BY color ASC
    `).all(materialId).map((row) => row.color)
  )
}

function getMaterialBatchSizes(materialId) {
  return uniqueNonEmpty(
    db.prepare(`
      SELECT DISTINCT size
      FROM purchase_batches
      WHERE material_id=?
        AND TRIM(COALESCE(size, '')) != ''
      ORDER BY size ASC
    `).all(materialId).map((row) => row.size)
  )
}

function normalizeColorProfiles(profiles = []) {
  return uniqueNonEmpty((profiles || []).map((item) => item?.color)).map((color) => {
    const source = (profiles || []).find((item) => normalizedText(item?.color) === normalizedText(color)) || {}
    return {
      color,
      default_price: Number(source.default_price || 0),
      default_price_unit: normalizeUnit(source.default_price_unit || ''),
      sizePrices: normalizeSizePriceList(source.sizePrices || source.size_price_json || []),
      sample_price_meter: Number(source.sample_price_meter || 0),
      sample_price_kg: Number(source.sample_price_kg || 0),
      sample_price_yard: Number(source.sample_price_yard || 0),
      net_price_meter: Number(source.net_price_meter || 0),
      bulk_price_kg: Number(source.bulk_price_kg || 0),
      bulk_price_meter: Number(source.bulk_price_meter || 0),
      bulk_price_yard: Number(source.bulk_price_yard || 0),
      remark: cleanText(source.remark),
      sort_order: Number(source.sort_order || 0)
    }
  })
}

function normalizeSizePriceList(list = []) {
  return uniqueNonEmpty((list || []).map((item) => item?.size)).map((size) => {
    const source = (list || []).find((item) => normalizedText(item?.size) === normalizedText(size)) || {}
    return {
      size,
      price: Number(source.price || 0),
      unit: normalizeUnit(source.unit || ''),
      sort_order: Number(source.sort_order || 0)
    }
  })
}

function normalizeSizeBreakdownList(list = []) {
  const source = Array.isArray(list) ? list : safeJsonParse(list, [])
  return uniqueNonEmpty((source || []).map((item) => item?.size)).map((size) => {
    const matched = (source || []).find((item) => normalizedText(item?.size) === normalizedText(size)) || {}
    return {
      size,
      qty: Number(matched.qty || 0)
    }
  })
}

function inventoryMaterialKey(materialId, color = '未分色', size = '') {
  return `${Number(materialId || 0)}__${String(color || '未分色').trim() || '未分色'}__${String(size || '').trim()}`
}

function replaceMaterialColorProfiles(materialId, profiles = []) {
  db.prepare('DELETE FROM material_color_prices WHERE material_id=?').run(materialId)
  const normalizedProfiles = normalizeColorProfiles(profiles)
  if (!normalizedProfiles.length) return []

  const insert = db.prepare(`
    INSERT INTO material_color_prices (
      material_id,
      color,
      default_price,
      default_price_unit,
      size_price_json,
      sample_price_meter,
      sample_price_kg,
      sample_price_yard,
      net_price_meter,
      bulk_price_kg,
      bulk_price_meter,
      bulk_price_yard,
      remark,
      sort_order
    ) VALUES (
      @material_id,
      @color,
      @default_price,
      @default_price_unit,
      @size_price_json,
      @sample_price_meter,
      @sample_price_kg,
      @sample_price_yard,
      @net_price_meter,
      @bulk_price_kg,
      @bulk_price_meter,
      @bulk_price_yard,
      @remark,
      @sort_order
    )
  `)

  normalizedProfiles.forEach((item, index) => {
    insert.run({
      material_id: materialId,
      ...item,
      size_price_json: safeJsonStringify(normalizeSizePriceList(item.sizePrices), '[]'),
      sort_order: Number(item.sort_order || 0) || index + 1
    })
  })

  return getMaterialColorProfiles(materialId)
}

function matchColorProfile(profiles = [], color = '') {
  const normalizedColor = normalizedText(color)
  if (normalizedColor) {
    const exact = (profiles || []).find((item) => normalizedText(item.color) === normalizedColor)
    if (exact) return exact
  }
  return (profiles || [])[0] || null
}

function resolveMaterialPriceByType(material = {}, color = '', priceType = 'bulk', targetUnit = '米', preferredUnit = targetUnit) {
  const profiles = material.colorProfiles || getMaterialColorProfiles(material.id)
  const profile = matchColorProfile(profiles, color)

  const normalizedTargetUnit = normalizeUnit(targetUnit || material.unit || '米')
  const normalizedPreferredUnit = normalizeUnit(preferredUnit || normalizedTargetUnit)
  const convertPriceSafely = (price, fromUnit) => {
    const numericPrice = Number(price || 0)
    if (!numericPrice) return 0
    const normalizedFromUnit = normalizeUnit(fromUnit || normalizedTargetUnit)
    const adjustedPrice = adjustMaterialUnitPrice(numericPrice, material)
    if (normalizedFromUnit === normalizedTargetUnit) return round(adjustedPrice, 6)
    if (!isConvertibleUnit(normalizedFromUnit) || !isConvertibleUnit(normalizedTargetUnit)) return 0
    return round(convertUnitPrice(adjustedPrice, normalizedFromUnit, normalizedTargetUnit, material), 6)
  }
  if (!profile) {
    const defaultPrice = Number(material.default_price || 0)
    const defaultPriceUnit = normalizeUnit(material.default_price_unit || material.unit || normalizedTargetUnit)
    return convertPriceSafely(defaultPrice, defaultPriceUnit)
  }
  const unitCandidates = priceType === 'sample'
    ? [
      { unit: normalizedPreferredUnit, price: normalizedPreferredUnit === '公斤' ? Number(profile.sample_price_kg || 0) : normalizedPreferredUnit === '码' ? Number(profile.sample_price_yard || 0) : Number(profile.sample_price_meter || 0) },
      { unit: '公斤', price: Number(profile.sample_price_kg || 0) },
      { unit: '米', price: Number(profile.sample_price_meter || 0) },
      { unit: '码', price: Number(profile.sample_price_yard || 0) }
    ]
    : priceType === 'net'
      ? [{ unit: '米', price: Number(profile.net_price_meter || 0) }]
      : [
        { unit: normalizedPreferredUnit, price: normalizedPreferredUnit === '公斤' ? Number(profile.bulk_price_kg || 0) : normalizedPreferredUnit === '米' ? Number(profile.bulk_price_meter || 0) : Number(profile.bulk_price_yard || 0) },
        { unit: '公斤', price: Number(profile.bulk_price_kg || 0) },
        { unit: '米', price: Number(profile.bulk_price_meter || 0) },
        { unit: '码', price: Number(profile.bulk_price_yard || 0) }
        ]

  const selected = unitCandidates.find((item) => Number(item.price || 0) > 0)
  if (!selected) {
    const fallbackPrice = Number(profile.default_price || material.default_price || 0)
    const fallbackUnit = normalizeUnit(profile.default_price_unit || material.default_price_unit || material.unit || normalizedTargetUnit)
    return convertPriceSafely(fallbackPrice, fallbackUnit)
  }
  return convertPriceSafely(selected.price, selected.unit)
}

function enrichMaterialRecord(row = {}) {
  const colorProfiles = getMaterialColorProfiles(row.id)
  const batchColors = getMaterialBatchColors(row.id)
  const batchSizes = getMaterialBatchSizes(row.id)
  const sizePrices = normalizeSizePriceList(safeJsonParse(row.size_price_json, []))
  const allColors = uniqueNonEmpty([
    ...colorProfiles.map((item) => item.color),
    ...batchColors
  ])
  const allSizes = uniqueNonEmpty([
    ...sizePrices.map((item) => item.size),
    ...colorProfiles.flatMap((item) => (item.sizePrices || []).map((entry) => entry.size)),
    ...batchSizes
  ])
  const majorCategory = cleanText(row.major_category)
  const category = cleanText(row.category)
  const subCategory = cleanText(row.sub_category)
  const leafCategory = cleanText(row.leaf_category)
  const categoryPath = [majorCategory, category, subCategory, leafCategory].filter(Boolean).join(' / ')
  return {
    ...row,
    major_category: majorCategory,
    category,
    sub_category: subCategory,
    leaf_category: leafCategory,
    category_path: categoryPath,
    is_fabric: majorCategory === '面料',
    colorProfiles,
    sizePrices,
    batchColors,
    batchSizes,
    allColors,
    allSizes,
    colors: allColors,
    primaryColor: colorProfiles[0]?.color || batchColors[0] || cleanText(row.color),
    sample_price_meter: Number(colorProfiles[0]?.sample_price_meter || 0),
    sample_price_kg: Number(colorProfiles[0]?.sample_price_kg || 0),
    sample_price_yard: Number(colorProfiles[0]?.sample_price_yard || 0),
    net_price_meter: Number(colorProfiles[0]?.net_price_meter || 0),
    bulk_price_kg: Number(colorProfiles[0]?.bulk_price_kg || 0),
    bulk_price_meter: Number(colorProfiles[0]?.bulk_price_meter || 0),
    bulk_price_yard: Number(colorProfiles[0]?.bulk_price_yard || 0),
    composition: cleanText(row.composition),
    custom_conversion_from_qty: Number(row.custom_conversion_from_qty || 0),
    custom_conversion_from_unit: normalizeUnit(row.custom_conversion_from_unit || ''),
    custom_conversion_to_qty: Number(row.custom_conversion_to_qty || 0),
    custom_conversion_to_unit: normalizeUnit(row.custom_conversion_to_unit || ''),
    default_price: Number(row.default_price || 0),
    default_price_unit: normalizeUnit(row.default_price_unit || row.unit),
    size_price_json: safeJsonStringify(sizePrices, '[]')
  }
}

function getMaterials() {
  return getCachedQueryResult('materials:list', () => {
    const rows = db.prepare(`
      SELECT ${MATERIAL_FIELDS}
      FROM materials
      ORDER BY datetime(created_at) DESC, id DESC
    `).all()
    return rows.map(enrichMaterialRecord)
  }, 10000)
}

function getGarments() {
  return getCachedQueryResult('garments:list', () => db.prepare(`
    SELECT
      g.*,
      (SELECT COUNT(*) FROM boms b WHERE b.garment_id = g.id) AS bom_count,
      COALESCE(po_cost.completed_weighted_qty, 0) AS completed_weighted_qty,
      COALESCE(po_cost.completed_material_cost_total, 0) AS completed_material_cost_total,
      COALESCE(po_cost.completed_process_cost_total, 0) AS completed_process_cost_total,
      COALESCE(po_cost.completed_total_cost, 0) AS completed_total_cost
    FROM garments g
    LEFT JOIN (
      SELECT
        garment_id,
        SUM(
          COALESCE(
            NULLIF(actual_output_qty, 0),
            NULLIF(cut_output_qty, 0),
            NULLIF(quantity, 0),
            0
          )
        ) AS completed_weighted_qty,
        SUM(COALESCE(material_cost, 0)) AS completed_material_cost_total,
        SUM(COALESCE(process_cost, 0)) AS completed_process_cost_total,
        SUM(COALESCE(total_cost, 0)) AS completed_total_cost
      FROM production_orders
      WHERE TRIM(COALESCE(status, '')) = '已完成'
      GROUP BY garment_id
    ) po_cost ON po_cost.garment_id = g.id
    ORDER BY datetime(g.created_at) DESC, g.id DESC
  `).all().map(enrichGarmentRecord), 10000)
}

function getGarmentById(id) {
  const row = db.prepare(`
    SELECT id, style_code, name, image_path, category, process_fee, factory_process_fee_json, markup_rate, remark, created_at
    FROM garments
    WHERE id=?
  `).get(id)
  return row ? enrichGarmentRecord(row) : null
}

function normalizeGarmentFactoryProcessFees(list) {
  const rows = Array.isArray(list) ? list : safeJsonParse(list, [])
  const seen = new Set()
  return rows
    .map((item) => ({
      factory_name: cleanText(item?.factory_name),
      process_fee: Number(item?.process_fee || 0)
    }))
    .filter((item) => item.factory_name)
    .filter((item) => {
      const key = normalizedText(item.factory_name)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function enrichGarmentRecord(row) {
  const factoryProcessFees = normalizeGarmentFactoryProcessFees(row?.factory_process_fee_json)
  const completedWeightedQty = Number(row?.completed_weighted_qty || 0)
  const completedMaterialCostTotal = Number(row?.completed_material_cost_total || 0)
  const completedProcessCostTotal = Number(row?.completed_process_cost_total || 0)
  const completedTotalCost = Number(row?.completed_total_cost || 0)
  const markupRate = Number(row?.markup_rate || 0)
  const hasCompletedWeightedCost = completedWeightedQty > 0
    && (completedMaterialCostTotal > 0 || completedProcessCostTotal > 0 || completedTotalCost > 0)

  const materialCostEstimate = hasCompletedWeightedCost
    ? Number((completedMaterialCostTotal / completedWeightedQty).toFixed(4))
    : Number(row?.material_cost_estimate || 0)
  const processCostEstimate = hasCompletedWeightedCost
    ? Number((completedProcessCostTotal / completedWeightedQty).toFixed(4))
    : Number(row?.process_cost_estimate || Number(row?.process_fee || 0))
  const garmentCostEstimate = hasCompletedWeightedCost
    ? Number((completedTotalCost / completedWeightedQty).toFixed(4))
    : Number(row?.garment_cost_estimate || 0)
  return {
    ...row,
    process_fee: Number(row?.process_fee || 0),
    markup_rate: markupRate,
    factory_process_fees: factoryProcessFees,
    factory_process_fee_json: safeJsonStringify(factoryProcessFees, '[]'),
    completed_weighted_qty: completedWeightedQty,
    completed_material_cost_total: completedMaterialCostTotal,
    completed_process_cost_total: completedProcessCostTotal,
    completed_total_cost: completedTotalCost,
    material_cost_estimate: materialCostEstimate,
    process_cost_estimate: processCostEstimate,
    garment_cost_estimate: garmentCostEstimate,
    markup_price: Number((garmentCostEstimate * (1 + markupRate)).toFixed(4)),
    cost_source: hasCompletedWeightedCost ? 'completed_production_weighted' : 'bom_estimate'
  }
}

function enrichBomRow(row) {
  const material = {
    id: row.material_id,
    code: row.material_code,
    name: row.material_name,
    composition: row.material_composition,
    width: row.material_width,
    weight: row.material_weight,
    meter_per_kg: row.material_meter_per_kg,
    unit: row.material_unit,
    default_price: row.material_default_price,
    default_price_unit: row.material_default_price_unit
  }
  const materialUnit = normalizeUnit(row.material_unit || '米')
  const usageUnit = normalizeUnit(row.usage_unit || materialUnit)
  const usageInMaterialUnit = Number(row.usage_in_material_unit || 0) > 0
    ? Number(row.usage_in_material_unit || 0)
    : tryConvertQuantity(row.usage, usageUnit, materialUnit, material, row.usage)
  const materialColor = cleanText(row.material_color || row.color)
  const costPriceType = cleanText(row.cost_price_type) || 'bulk'
  const usageMode = normalizeUsageMode(row.usage_mode, row)
  const actualIssuedUnit = normalizeUnit(row.actual_issued_unit || row.material_unit || materialUnit)
  const actualIssuedQtyRaw = Number(row.actual_issued_qty || 0)
  const actualRollCount = Number(row.actual_roll_count || 0)
  const actualTotalAmount = Number(row.actual_total_amount || 0)
  const materialSizeBreakdown = normalizeSizeBreakdownList(row.material_size_breakdown)
  const actualIssuedQty = convertIssuedQtyToMaterialUnit({
    ...row,
    actual_issued_qty: actualIssuedQtyRaw,
    actual_roll_count: actualRollCount,
    actual_issued_unit: actualIssuedUnit,
    material_unit: materialUnit
  }, material).qty
  const actualCostQty = convertIssuedCostQtyToMaterialUnit({
    ...row,
    actual_issued_qty: actualIssuedQtyRaw,
    actual_roll_count: actualRollCount,
    actual_issued_unit: actualIssuedUnit,
    material_unit: materialUnit
  }, material).qty
  const resolvedUnitCost = Number(row.current_unit_cost || 0) || resolveMaterialPriceByType(material, materialColor, costPriceType, materialUnit, usageUnit)
  const perPieceCost = usageInMaterialUnit * (1 + Number(row.loss_rate || 0)) * Number(resolvedUnitCost || 0)
  let perMeterCost = 0
  try {
    perMeterCost = costPerInputUnit(resolvedUnitCost || 0, '米', materialUnit, material)
  } catch {
    perMeterCost = 0
  }

  return {
    ...row,
    usage_unit: usageUnit,
    material_unit: materialUnit,
    material_role: cleanText(row.material_role) || '辅料',
    supply_mode: cleanText(row.supply_mode) || 'our_supply',
    processing_requirements: normalizeStringList(row.processing_requirements),
    material_color: materialColor,
    usage_mode: usageMode,
    usage_mode_label: getUsageModeLabel(usageMode, row),
    material_size_breakdown: materialSizeBreakdown,
    actual_issued_qty_raw: actualIssuedQtyRaw,
    actual_roll_count: actualRollCount,
    actual_issued_qty: actualIssuedQty,
    actual_cost_qty: actualCostQty,
    actual_issued_unit: actualIssuedUnit,
    actual_total_amount: actualTotalAmount,
    cost_price_type: costPriceType,
    price_type_label: getPriceTypeLabel(costPriceType),
    resolved_meters_per_kg: resolveMetersPerKg(material),
    auto_meters_per_kg: calculateAutoMetersPerKg(material),
    usage_in_material_unit: round(usageInMaterialUnit, 6),
    current_unit_cost: round(resolvedUnitCost, 6),
    current_unit_cost_per_meter: round(perMeterCost, 6),
    per_piece_cost: round(perPieceCost, 6)
  }
}

function getBomsByGarment(garmentId) {
  const safeGarmentId = Number(garmentId || 0)
  return getCachedQueryResult(`bom:garment:${safeGarmentId}`, () => {
    const rows = db.prepare(`
      SELECT
        b.id,
        b.garment_id,
        b.material_id,
        b.sort_order,
        b.usage,
        b.usage_unit,
        b.loss_rate,
        b.material_role,
        b.supply_mode,
        b.processing_requirements,
        b.material_color,
        b.usage_mode,
        b.cost_price_type,
        m.code AS material_code,
        m.name AS material_name,
        m.composition AS material_composition,
        m.width AS material_width,
        m.weight AS material_weight,
        m.meter_per_kg AS material_meter_per_kg,
        m.unit AS material_unit,
        m.default_price AS material_default_price,
        m.default_price_unit AS material_default_price_unit
      FROM boms b
      JOIN materials m ON m.id = b.material_id
      WHERE b.garment_id=?
      ORDER BY b.sort_order ASC, b.id ASC
    `).all(safeGarmentId)

    return rows.map((row) => {
      try {
        return enrichBomRow(row)
      } catch (error) {
        return {
          ...row,
          usage_unit: normalizeUnit(row.usage_unit || row.material_unit || '米'),
          material_unit: normalizeUnit(row.material_unit || '米'),
          material_role: cleanText(row.material_role) || '辅料',
          supply_mode: cleanText(row.supply_mode) || 'our_supply',
          processing_requirements: normalizeStringList(row.processing_requirements),
          material_color: cleanText(row.material_color || row.color),
          usage_mode: normalizeUsageMode(row.usage_mode, row),
          usage_mode_label: getUsageModeLabel(row.usage_mode, row),
          material_size_breakdown: normalizeSizeBreakdownList(row.material_size_breakdown),
          actual_issued_qty_raw: Number(row.actual_issued_qty || 0),
          actual_issued_qty: Number(row.actual_issued_qty || 0),
          actual_issued_unit: normalizeUnit(row.actual_issued_unit || row.material_unit || '米'),
          cost_price_type: cleanText(row.cost_price_type) || 'bulk',
          price_type_label: getPriceTypeLabel(cleanText(row.cost_price_type) || 'bulk'),
          resolved_meters_per_kg: resolveMetersPerKg({
            width: row.material_width,
            weight: row.material_weight,
            meter_per_kg: row.material_meter_per_kg
          }),
          auto_meters_per_kg: calculateAutoMetersPerKg({
            width: row.material_width,
            weight: row.material_weight
          }),
          usage_in_material_unit: Number(row.usage || 0),
          current_unit_cost: 0,
          current_unit_cost_per_meter: 0,
          per_piece_cost: 0,
          warning_message: error.message || '该 BOM 行存在单位或价格规则异常，已按原值兜底显示'
        }
      }
    })
  }, 8000)
}

function buildProductionPlanRows(items = []) {
  return (items || [])
    .filter((item) => item && item.material_id)
    .map((item) => ({
      material_id: Number(item.material_id),
      sort_order: Number(item.sort_order || 0),
      usage: Number(item.usage || 0),
      usage_unit: normalizeUnit(item.usage_unit || '米'),
      usage_in_material_unit: Number(item.usage_in_material_unit || 0),
      loss_rate: Number(item.loss_rate || 0),
      material_role: cleanText(item.material_role) || '辅料',
      supply_mode: cleanText(item.supply_mode) || 'our_supply',
      processing_requirements: safeJsonStringify(normalizeStringList(item.processing_requirements), '[]'),
      material_color: cleanText(item.material_color),
      usage_mode: normalizeUsageMode(item.usage_mode, item),
      material_size_breakdown: safeJsonStringify(normalizeSizeBreakdownList(item.material_size_breakdown || item.cup_size_rows), '[]'),
      actual_issued_qty: Number((item.actual_issued_qty_raw ?? item.actual_issued_qty) || 0),
      actual_roll_count: Number(item.actual_roll_count || 0),
      actual_issued_unit: normalizeUnit(item.actual_issued_unit || item.material_unit || '米'),
      actual_total_amount: Number(item.actual_total_amount || 0),
      cost_price_type: cleanText(item.cost_price_type) || 'bulk',
      current_unit_cost: Number(item.current_unit_cost || 0),
      current_unit_cost_per_meter: Number(item.current_unit_cost_per_meter || 0)
    }))
}

function getProductionPlanItems(orderId) {
  const rows = db.prepare(`
    SELECT
      p.id,
      p.order_id,
      p.material_id,
      p.sort_order,
      p.usage,
      p.usage_unit,
      p.usage_in_material_unit,
      p.loss_rate,
      p.material_role,
      p.supply_mode,
      p.processing_requirements,
      p.material_color,
      p.usage_mode,
      p.material_size_breakdown,
      p.actual_issued_qty,
      p.actual_roll_count,
      p.actual_issued_unit,
      p.actual_total_amount,
      p.cost_price_type,
      p.current_unit_cost,
      p.current_unit_cost_per_meter,
      m.code AS material_code,
      m.name AS material_name,
      m.image_path AS material_image_path,
      m.category AS material_category,
      m.composition AS material_composition,
      m.width AS material_width,
      m.weight AS material_weight,
      m.meter_per_kg AS material_meter_per_kg,
      m.unit AS material_unit,
      m.default_price AS material_default_price,
      m.default_price_unit AS material_default_price_unit
    FROM production_order_plan_items p
    JOIN materials m ON m.id = p.material_id
    WHERE p.order_id=?
    ORDER BY p.sort_order ASC, p.id ASC
  `).all(orderId)

  return rows.map(enrichBomRow)
}

function saveProductionPlanItems(orderId, items = []) {
  db.prepare('DELETE FROM production_order_plan_items WHERE order_id=?').run(orderId)

  const normalizedItems = buildProductionPlanRows(items)
  if (!normalizedItems.length) return normalizedItems

  const order = db.prepare('SELECT garment_id FROM production_orders WHERE id=?').get(orderId)
  const insert = db.prepare(`
    INSERT INTO production_order_plan_items (
      order_id,
      garment_id,
      material_id,
      sort_order,
      usage,
      usage_unit,
      usage_in_material_unit,
      loss_rate,
      material_role,
      supply_mode,
      processing_requirements,
      material_color,
      usage_mode,
      material_size_breakdown,
      actual_issued_qty,
      actual_roll_count,
      actual_issued_unit,
      actual_total_amount,
      cost_price_type,
      current_unit_cost,
      current_unit_cost_per_meter
    ) VALUES (
      @order_id,
      @garment_id,
      @material_id,
      @sort_order,
      @usage,
      @usage_unit,
      @usage_in_material_unit,
      @loss_rate,
      @material_role,
      @supply_mode,
      @processing_requirements,
      @material_color,
      @usage_mode,
      @material_size_breakdown,
      @actual_issued_qty,
      @actual_roll_count,
      @actual_issued_unit,
      @actual_total_amount,
      @cost_price_type,
      @current_unit_cost,
      @current_unit_cost_per_meter
    )
  `)

  normalizedItems.forEach((item, index) => {
    seedOptionValue('unit', item.usage_unit)
    insert.run({
      ...item,
      order_id: orderId,
      garment_id: Number(order?.garment_id || 0),
      sort_order: Number(item.sort_order || 0) || index + 1
    })
  })

  return normalizedItems
}

function getProductionOrderStatusSnapshot(orderId) {
  return db.prepare(`
    SELECT
      id,
      order_no,
      garment_id,
      document_status,
      status,
      quantity,
      pending_date,
      cut_date,
      completed_date,
      cut_output_qty,
      cut_size_breakdown,
      actual_output_qty,
      actual_size_breakdown,
      process_fee,
      material_cost,
      process_cost,
      total_cost,
      unit_cost,
      actual_unit_cost
    FROM production_orders
    WHERE id=?
  `).get(orderId) || null
}

function areProductionPlanItemsEquivalent(orderId, items = []) {
  const nextRows = buildProductionPlanRows(items)
  const currentRows = buildProductionPlanRows(getProductionPlanItems(orderId))
  if (currentRows.length !== nextRows.length) return false
  return JSON.stringify(currentRows) === JSON.stringify(nextRows)
}

function getMaterialStockSummary() {
  return getCachedQueryResult('inventory:materialStockSummary', () => {
    const clearedRows = db.prepare(`
      SELECT
        material_id,
        COALESCE(NULLIF(TRIM(color), ''), '未分色') AS color,
        COALESCE(NULLIF(TRIM(size), ''), '') AS size,
        COALESCE(NULLIF(TRIM(supplier), ''), '') AS supplier
      FROM inventory_cleared_rows
    `).all()
    const clearedKeySet = new Set(
      clearedRows.map((row) => buildInventoryRowKey(row.material_id, row.color, row.size, row.supplier))
    )
    const usedQtyMap = new Map()
    const usageRows = db.prepare(`
      SELECT
        pom.material_id,
        COALESCE(NULLIF(TRIM(pom.material_color), ''), '未分色') AS color,
        COALESCE(NULLIF(TRIM(pom.material_size), ''), '') AS size,
        pom.material_role,
        pom.usage_per_piece AS usage,
        pom.usage_input_unit AS usage_unit,
        pom.usage_mode,
        pom.supply_mode,
        pom.actual_issued_qty,
        pom.actual_issued_unit,
        pom.consumed_qty,
        pom.material_name,
        pom.material_code,
        m.unit AS material_unit,
        COALESCE(NULLIF(TRIM(pb.supplier), ''), TRIM(COALESCE(m.supplier, ''))) AS supplier_name,
        m.width AS material_width,
        m.weight AS material_weight,
        m.meter_per_kg AS material_meter_per_kg,
        po.actual_output_qty,
        po.quantity,
        po.status,
        po.document_status
      FROM production_order_materials pom
      JOIN production_orders po ON po.id = pom.order_id
      JOIN materials m ON m.id = pom.material_id
      LEFT JOIN purchase_batches pb ON pb.id = pom.batch_id
    `).all()

    usageRows.forEach((row) => {
      const actualOutputQty = Number(row.actual_output_qty || 0)
      const actualIssuedQtyRaw = Number(row.actual_issued_qty || 0)
      const consumedQtyRaw = Number(row.consumed_qty || 0)
      const status = String(row.status || '').trim()
      const isApprovedDocument = normalizeDocumentStatus(row.document_status) === 'approved'
      const outputQty = actualOutputQty > 0 ? actualOutputQty : Number(row.quantity || 0)
      const shouldCountFactoryUsed =
        isApprovedDocument && (
          ['生产中', '已完成'].includes(status) ||
          actualOutputQty > 0 ||
          actualIssuedQtyRaw > 0 ||
          consumedQtyRaw > 0
        )
      if (!shouldCountFactoryUsed) return

      const key = buildInventoryRowKey(row.material_id, row.color, row.size, row.supplier_name)
      const actualIssuedQty = convertIssuedQtyToMaterialUnit({
        ...row,
        material_name: row.material_name,
        material_code: row.material_code
      }, {
        width: row.material_width,
        weight: row.material_weight,
        meter_per_kg: row.material_meter_per_kg,
        unit: row.material_unit
      }).qty
      const usageMode = normalizeUsageMode(row.usage_mode, row)
      const materialUnit = normalizeUnit(row.material_unit || '米')
      const usageUnit = normalizeUnit(row.usage_unit || materialUnit)
      const usageInMaterialUnit = tryConvertQuantity(
        Number(row.usage || 0),
        usageUnit,
        materialUnit,
        {
          width: row.material_width,
          weight: row.material_weight,
          meter_per_kg: row.material_meter_per_kg,
          unit: row.material_unit
        },
        Number(row.usage || 0)
      )
      const hasExplicitConsumedQty = consumedQtyRaw > 0
      const hasExplicitActualUsage = actualIssuedQty > 0
      const usedQty = hasExplicitConsumedQty
        ? consumedQtyRaw
        : hasExplicitActualUsage
          ? actualIssuedQty
          : usageMode === 'full_cut'
            ? actualIssuedQty
            : round(outputQty * usageInMaterialUnit, 4)

      usedQtyMap.set(key, round(Number(usedQtyMap.get(key) || 0) + usedQty, 4))
    })

    return db.prepare(`
      SELECT
        MIN(pb.id) AS id,
        m.id AS material_id,
        m.code,
        m.name,
        m.image_path AS material_image_path,
        m.major_category,
        m.category,
        m.adjustment_type,
        m.left_gap,
        m.right_gap,
        m.gap_ratio,
        COALESCE(NULLIF(TRIM(pb.color), ''), '未分色') AS color,
        COALESCE(NULLIF(TRIM(pb.size), ''), '') AS size,
        COALESCE(NULLIF(TRIM(pb.supplier), ''), TRIM(COALESCE(m.supplier, ''))) AS supplier_name,
        m.supplier,
        m.unit,
        m.width,
        m.weight,
        m.meter_per_kg,
        ROUND(COALESCE(SUM(pb.roll_count), 0), 4) AS roll_count,
        ROUND(COALESCE(SUM(
          CASE
            WHEN COALESCE(NULLIF(TRIM(pb.purchase_input_unit), ''), m.unit) = m.unit THEN COALESCE(pb.purchase_input_qty, 0)
            ELSE 0
          END
        ), 0), 4) AS purchased_input_qty_same_unit,
        ROUND(COALESCE(SUM(pb.gross_qty), 0), 4) AS purchased_qty,
        ROUND(COALESCE(SUM(pb.gross_qty - pb.remaining_qty), 0), 4) AS issued_qty,
        ROUND(COALESCE(SUM(pb.remaining_qty), 0), 4) AS stock_qty,
        ROUND(COALESCE(SUM(pb.remaining_qty * pb.base_unit_price) / NULLIF(SUM(pb.remaining_qty), 0), 0), 6) AS avg_unit_cost,
        ROUND(COALESCE(SUM(pb.remaining_qty * pb.base_unit_price), 0), 2) AS stock_value,
        MAX(pb.received_at) AS latest_received_at
      FROM materials m
      LEFT JOIN purchase_batches pb ON pb.material_id = m.id AND LOWER(TRIM(COALESCE(pb.document_status, 'draft'))) = 'approved'
      GROUP BY
        m.id,
        COALESCE(NULLIF(TRIM(pb.color), ''), '未分色'),
        COALESCE(NULLIF(TRIM(pb.size), ''), ''),
        COALESCE(NULLIF(TRIM(pb.supplier), ''), TRIM(COALESCE(m.supplier, '')))
      ORDER BY m.sort_order ASC, m.created_at DESC, m.id DESC, color ASC, size ASC
    `).all().map((item) => {
      const normalizedColor = String(item.color || '未分色').trim() || '未分色'
      const normalizedSize = normalizeInventorySize(item.size)
      const supplierName = cleanText(item.supplier_name || item.supplier)
      const factoryUsedQty = Number(usedQtyMap.get(buildInventoryRowKey(item.material_id, normalizedColor, normalizedSize, supplierName)) || 0)
      return {
        ...item,
        color: normalizedColor,
        size: normalizedSize,
        supplier_name: supplierName,
        factory_used_qty: factoryUsedQty,
        purchased_input_qty: Number(item.purchased_input_qty_same_unit || 0),
        adjustment_summary: item.adjustment_type === 'weight_gap'
          ? `空差 ${Number(item.left_gap || 0)}+${Number(item.right_gap || 0)}`
          : item.adjustment_type === 'rate'
            ? `空 ${Number(item.gap_ratio || 0)}`
            : '正常'
      }
    }).filter((item) => {
      const purchasedInputQty = Math.abs(Number(item.purchased_input_qty || 0))
      const purchasedQty = Math.abs(Number(item.purchased_qty || 0))
      const issuedQty = Math.abs(Number(item.issued_qty || 0))
      const stockQty = Math.abs(Number(item.stock_qty || 0))
      const factoryUsedQty = Math.abs(Number(item.factory_used_qty || 0))
      const isCleared = clearedKeySet.has(buildInventoryRowKey(item.material_id, item.color, item.size, item.supplier_name || item.supplier))
      if (isCleared) return false
      return purchasedInputQty > 0.0001
        || purchasedQty > 0.0001
        || issuedQty > 0.0001
        || stockQty > 0.0001
        || factoryUsedQty > 0.0001
    })
  }, 5000)
}

function getInventoryMovements(params = {}) {
  const filterField = cleanText(params.filterField) || 'keyword'
  const keyword = cleanText(params.keyword).toLowerCase()
  const dateFrom = cleanText(params.dateFrom)
  const dateTo = cleanText(params.dateTo)
  const safeLimit = Math.max(50, Math.min(Number(params.limit || 500), 2000))
  const conditions = []
  const values = []

  conditions.push(`(im.source_table <> 'purchase_batches' OR LOWER(TRIM(COALESCE(im.document_status, 'draft'))) = 'approved')`)

  if (dateFrom) {
    conditions.push(`date(im.created_at) >= date(?)`)
    values.push(dateFrom)
  }
  if (dateTo) {
    conditions.push(`date(im.created_at) <= date(?)`)
    values.push(dateTo)
  }

  const applyLike = (expressions) => {
    if (!keyword) return
    const normalized = (Array.isArray(expressions) ? expressions : [expressions]).filter(Boolean)
    if (!normalized.length) return
    conditions.push(`(${normalized.map((expression) => `LOWER(COALESCE(${expression}, '')) LIKE ?`).join(' OR ')})`)
    normalized.forEach(() => values.push(`%${keyword}%`))
  }

  if (keyword) {
    const fieldMap = {
      keyword: [
        'im.material_code',
        'm.code',
        'im.material_name',
        'm.name',
        'im.source_no',
        'im.movement_type',
        'im.operator_name',
        'im.client_name'
      ],
      material_code: ['im.material_code', 'm.code'],
      material_name: ['im.material_name', 'm.name'],
      source_no: ['im.source_no'],
      movement_type: ['im.movement_type'],
      operator_name: ['im.operator_name']
    }
    applyLike(fieldMap[filterField] || fieldMap.keyword)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const cacheKey = JSON.stringify({
    scope: 'inventory:movements',
    filterField,
    keyword,
    dateFrom,
    dateTo,
    limit: safeLimit
  })

  return getCachedQueryResult(cacheKey, () => db.prepare(`
    SELECT
      im.*,
      COALESCE(im.material_code, m.code, '') AS resolved_material_code,
      COALESCE(im.material_name, m.name, '') AS resolved_material_name,
      COALESCE(m.image_path, '') AS resolved_material_image_path
    FROM inventory_movements im
    LEFT JOIN materials m ON m.id = im.material_id
    ${whereClause}
    ORDER BY datetime(im.created_at) DESC, im.id DESC
    LIMIT ?
  `).all(...values, safeLimit).map((row) => ({
    ...row,
    material_code: row.resolved_material_code || row.material_code,
    material_name: row.resolved_material_name || row.material_name,
    material_image_path: row.resolved_material_image_path || ''
  })), 5000)
}

function getBatchFactoryRemainingQty(batch, consumedQty = 0) {
  const remainingQty = Number(batch?.remaining_qty || 0)
  const allocatedQty = Math.max(Number(batch?.factory_allocated_qty || 0), 0)
  const usedQty = Math.max(Number(consumedQty || 0), 0)
  return round(Math.max(Math.min(allocatedQty, remainingQty + usedQty) - usedQty, 0), 4)
}

function getPurchaseBatchAllocations(batchId) {
  const rows = db.prepare(`
    SELECT
      id,
      purchase_batch_id,
      factory_name,
      allocated_qty,
      allocated_roll_count,
      created_at
    FROM purchase_batch_factory_allocations
    WHERE purchase_batch_id=?
    ORDER BY id ASC
  `).all(batchId).map((row) => ({
    ...row,
    allocated_qty: Number(row.allocated_qty || 0),
    allocated_roll_count: Number(row.allocated_roll_count || 0)
  }))
  return mergePurchaseBatchAllocationRows(rows)
}

function mergePurchaseBatchAllocationRows(allocations = []) {
  const grouped = new Map()
  ;(Array.isArray(allocations) ? allocations : []).forEach((item) => {
    const factoryName = cleanText(item?.factory_name)
    if (!factoryName) return
    const key = factoryName.toLowerCase()
    const current = grouped.get(key) || {
      ...item,
      id: Number(item?.id || 0) || null,
      factory_name: factoryName,
      allocated_qty: 0,
      allocated_roll_count: 0
    }
    current.id = current.id && item?.id ? Math.min(Number(current.id), Number(item.id)) : (current.id || Number(item?.id || 0) || null)
    current.purchase_batch_id = Number(current.purchase_batch_id || item?.purchase_batch_id || 0) || null
    current.allocated_qty = round(Number(current.allocated_qty || 0) + Number(item?.allocated_qty || 0), 6)
    current.allocated_roll_count = round(Number(current.allocated_roll_count || 0) + Number(item?.allocated_roll_count || 0), 4)
    if (!current.created_at && item?.created_at) current.created_at = item.created_at
    grouped.set(key, current)
  })
  return [...grouped.values()]
}

function replacePurchaseBatchAllocations(batchId, allocations = []) {
  db.prepare('DELETE FROM purchase_batch_factory_allocations WHERE purchase_batch_id=?').run(batchId)
  const normalized = mergePurchaseBatchAllocationRows((Array.isArray(allocations) ? allocations : [])
    .map((item) => ({
      factory_name: cleanText(item?.factory_name),
      allocated_qty: round(Number(item?.allocated_qty || 0), 6),
      allocated_roll_count: round(Number(item?.allocated_roll_count || 0), 4)
    }))
    .filter((item) => item.factory_name && (item.allocated_qty > 0 || item.allocated_roll_count > 0)))

  if (!normalized.length) return []

  const insert = db.prepare(`
    INSERT INTO purchase_batch_factory_allocations (
      purchase_batch_id,
      factory_name,
      allocated_qty,
      allocated_roll_count
    ) VALUES (?, ?, ?, ?)
  `)
  normalized.forEach((item) => insert.run(batchId, item.factory_name, item.allocated_qty, item.allocated_roll_count))
  return getPurchaseBatchAllocations(batchId)
}

function normalizePurchaseBatchFactoryAllocationStorage() {
  if (workspaceReadOnly) return 0
  const rows = db.prepare(`
    SELECT
      purchase_batch_id,
      factory_name,
      allocated_qty,
      allocated_roll_count,
      created_at
    FROM purchase_batch_factory_allocations
    ORDER BY purchase_batch_id ASC, id ASC
  `).all()
  if (!rows.length) return 0

  const rowsByBatch = new Map()
  rows.forEach((row) => {
    const batchId = Number(row.purchase_batch_id || 0)
    const factoryName = cleanText(row.factory_name)
    if (!batchId || !factoryName) return
    const batchRows = rowsByBatch.get(batchId) || []
    batchRows.push(row)
    rowsByBatch.set(batchId, batchRows)
  })

  const selectBatch = db.prepare('SELECT * FROM purchase_batches WHERE id=?')
  const updateBatch = db.prepare('UPDATE purchase_batches SET factory_name=?, factory_allocated_qty=? WHERE id=?')
  const tx = db.transaction(() => {
    let changed = 0
    rowsByBatch.forEach((batchRows, batchId) => {
      const merged = mergePurchaseBatchAllocationRows(batchRows)
      const hasDuplicate = merged.length !== batchRows.length
      if (hasDuplicate) {
        replacePurchaseBatchAllocations(batchId, merged)
        changed += 1
      }

      const batch = selectBatch.get(batchId)
      if (!batch) return
      const material = getMaterialById(batch.material_id)
      const effectiveAllocatedQty = round(merged.reduce((sum, allocation) => {
        return sum + Number(resolveFactoryAllocationQtyFromRollCount(batch, allocation, material) || 0)
      }, 0), 6)
      const factoryName = [...new Set(merged.map((item) => cleanText(item.factory_name)).filter(Boolean))].join('、')
      if (
        cleanText(batch.factory_name) !== factoryName
        || Math.abs(Number(batch.factory_allocated_qty || 0) - effectiveAllocatedQty) > 0.0001
      ) {
        updateBatch.run(factoryName, effectiveAllocatedQty, batchId)
        changed += 1
      }
    })
    return changed
  })
  return tx()
}

function compareBatchNoDesc(left = {}, right = {}) {
  const leftNo = cleanText(left.batch_no)
  const rightNo = cleanText(right.batch_no)
  if (leftNo || rightNo) {
    const byBatchNo = rightNo.localeCompare(leftNo, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    if (byBatchNo) return byBatchNo
  }
  return Number(right.id || 0) - Number(left.id || 0)
}

function resolveFactoryAllocationQtyFromRollCount(batch = {}, allocation = {}, material = {}) {
  const batchRollCount = Math.max(Number(batch.roll_count || 0), 0)
  const allocatedRollCount = Math.max(Number(allocation.allocated_roll_count || 0), 0)
  if (batchRollCount <= 0 || allocatedRollCount <= 0) {
    return round(Number(allocation.allocated_qty || 0), 6)
  }

  const actualInputQty = Number(batch.actual_input_qty || batch.purchase_input_qty || batch.gross_qty || 0)
  const actualInputUnit = normalizeUnit(batch.actual_input_unit || batch.purchase_input_unit || batch.unit || material.unit)
  const targetUnit = normalizeUnit(batch.unit || material.unit || actualInputUnit)
  if (actualInputQty <= 0) {
    return round(Number(allocation.allocated_qty || 0), 6)
  }

  const proportionalActualQty = round(actualInputQty * allocatedRollCount / batchRollCount, 6)
  const converted = convertQuantity(proportionalActualQty, actualInputUnit, targetUnit, material)
  if (!converted && actualInputUnit !== targetUnit) {
    return round(Number(allocation.allocated_qty || 0), 6)
  }
  return round(converted || proportionalActualQty, 6)
}

function resolveFactoryAllocationInputQty(batch = {}, allocation = {}) {
  const batchRollCount = Math.max(Number(batch.roll_count || 0), 0)
  const allocatedRollCount = Math.max(Number(allocation.allocated_roll_count || 0), 0)
  if (batchRollCount <= 0 || allocatedRollCount <= 0) {
    return round(Number(allocation.input_allocated_qty || 0), 6)
  }
  const actualInputQty = Number(batch.actual_input_qty || batch.purchase_input_qty || batch.gross_qty || 0)
  if (actualInputQty <= 0) {
    return round(Number(allocation.input_allocated_qty || 0), 6)
  }
  return round(actualInputQty * allocatedRollCount / batchRollCount, 6)
}

function formatServerQty(value, digits = 4) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount.toFixed(digits).replace(/\.?0+$/, '') || '0' : '0'
}

function formatServerQtyWithUnit(value, unit, digits = 4) {
  return `${formatServerQty(value, digits)} ${normalizeUnit(unit) || ''}`.trim()
}

function normalizeInventoryColor(value, fallback = '未分色') {
  return cleanText(value || fallback) || fallback
}

function buildInventoryDemandLabel(demand = {}) {
  const parts = []
  const code = cleanText(demand.material_code)
  const name = cleanText(demand.material_name)
  const color = cleanText(demand.color)
  const size = cleanText(demand.size)
  if (code) parts.push(code)
  if (name && name !== code) parts.push(name)
  if (color && color !== '未分色') parts.push(color)
  if (size) parts.push(size)
  return parts.join(' / ') || `ID:${Number(demand.material_id || 0)}`
}

function isInventoryBatchMatchDemand(batch = {}, demand = {}) {
  if (Number(batch.material_id || 0) !== Number(demand.material_id || 0)) return false
  const demandColor = cleanText(demand.color)
  const batchColor = normalizeInventoryColor(batch.color)
  if (demandColor && batchColor !== '未分色' && batchColor.toLowerCase() !== demandColor.toLowerCase()) return false
  const demandSize = normalizeInventorySize(demand.size)
  const batchSize = normalizeInventorySize(batch.size)
  if (demandSize && batchSize.toLowerCase() !== demandSize.toLowerCase()) return false
  return true
}

function compareInventoryBatchForDemand(left = {}, right = {}, demand = {}) {
  const demandColor = cleanText(demand.color).toLowerCase()
  const demandSize = normalizeInventorySize(demand.size).toLowerCase()
  const leftColor = normalizeInventoryColor(left.color).toLowerCase()
  const rightColor = normalizeInventoryColor(right.color).toLowerCase()
  const leftSize = normalizeInventorySize(left.size).toLowerCase()
  const rightSize = normalizeInventorySize(right.size).toLowerCase()
  const leftColorRank = demandColor ? (leftColor === demandColor ? 0 : leftColor === '未分色' ? 1 : 2) : (leftColor === '未分色' ? 0 : 1)
  const rightColorRank = demandColor ? (rightColor === demandColor ? 0 : rightColor === '未分色' ? 1 : 2) : (rightColor === '未分色' ? 0 : 1)
  if (leftColorRank !== rightColorRank) return leftColorRank - rightColorRank
  const leftSizeRank = demandSize ? (leftSize === demandSize ? 0 : 1) : (leftSize ? 1 : 0)
  const rightSizeRank = demandSize ? (rightSize === demandSize ? 0 : 1) : (rightSize ? 1 : 0)
  if (leftSizeRank !== rightSizeRank) return leftSizeRank - rightSizeRank
  const leftDate = String(left.received_at || '')
  const rightDate = String(right.received_at || '')
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate)
  return Number(left.id || 0) - Number(right.id || 0)
}

function listMatchingInventoryBatches(batches = [], demand = {}) {
  return [...(batches || [])]
    .filter((batch) => isInventoryBatchMatchDemand(batch, demand))
    .sort((left, right) => compareInventoryBatchForDemand(left, right, demand))
}

function getPendingProductionPreallocationRows(options = {}) {
  const excludeProductionOrderId = Number(
    options.exclude_production_order_id
    || options.excludeProductionOrderId
    || options.exclude_order_id
    || options.excludeOrderId
    || 0
  )
  const params = []
  let excludeSql = ''
  if (excludeProductionOrderId > 0) {
    excludeSql = 'AND po.id != ?'
    params.push(excludeProductionOrderId)
  }
  const rows = db.prepare(`
    SELECT
      pom.order_id,
      TRIM(COALESCE(po.order_no, '')) AS order_no,
      TRIM(COALESCE(po.factory_name, '')) AS factory_name,
      TRIM(COALESCE(po.status, '')) AS status,
      LOWER(TRIM(COALESCE(po.document_status, 'draft'))) AS document_status,
      pom.material_id,
      pom.material_name,
      pom.material_code,
      pom.material_unit,
      COALESCE(NULLIF(TRIM(pom.material_color), ''), '未分色') AS color,
      COALESCE(NULLIF(TRIM(pom.material_size), ''), '') AS size,
      TRIM(COALESCE(pom.supply_mode, 'our_supply')) AS supply_mode,
      COALESCE(pom.actual_issued_qty, 0) AS actual_issued_qty,
      COALESCE(pom.consumed_qty, 0) AS consumed_qty,
      COALESCE(pom.required_qty, 0) AS required_qty
    FROM production_order_materials pom
    JOIN production_orders po ON po.id = pom.order_id
    WHERE LOWER(TRIM(COALESCE(po.document_status, 'draft'))) = 'submitted'
      AND TRIM(COALESCE(pom.supply_mode, 'our_supply')) != 'factory_supply'
      ${excludeSql}
    ORDER BY po.id ASC, pom.id ASC
  `).all(...params)

  const bucket = new Map()
  rows.forEach((row) => {
    const reserveQty = round(Math.max(
      Number(row.actual_issued_qty || 0),
      Number(row.consumed_qty || 0),
      0
    ), 6)
    if (!row.material_id || reserveQty <= 0) return
    const key = [
      Number(row.order_id || 0),
      Number(row.material_id || 0),
      normalizeInventoryColor(row.color),
      normalizeInventorySize(row.size),
      cleanText(row.factory_name)
    ].join('__')
    const current = bucket.get(key) || {
      order_id: Number(row.order_id || 0),
      order_no: cleanText(row.order_no),
      factory_name: cleanText(row.factory_name),
      status: cleanText(row.status),
      document_status: normalizeDocumentStatus(row.document_status),
      material_id: Number(row.material_id || 0),
      material_name: cleanText(row.material_name),
      material_code: cleanText(row.material_code),
      material_unit: normalizeUnit(row.material_unit || '米'),
      color: normalizeInventoryColor(row.color),
      size: normalizeInventorySize(row.size),
      reserve_qty: 0
    }
    current.reserve_qty = round(Number(current.reserve_qty || 0) + reserveQty, 6)
    bucket.set(key, current)
  })
  return [...bucket.values()].filter((item) => Number(item.reserve_qty || 0) > 0)
}

function getProductionOrderInventoryDemands(orderId) {
  const order = db.prepare(`
    SELECT id, order_no, factory_name
    FROM production_orders
    WHERE id=?
  `).get(orderId)
  if (!order) return []
  const rows = db.prepare(`
    SELECT
      material_id,
      material_name,
      material_code,
      material_unit,
      COALESCE(NULLIF(TRIM(material_color), ''), '未分色') AS color,
      COALESCE(NULLIF(TRIM(material_size), ''), '') AS size,
      TRIM(COALESCE(supply_mode, 'our_supply')) AS supply_mode,
      COALESCE(actual_issued_qty, 0) AS actual_issued_qty,
      COALESCE(consumed_qty, 0) AS consumed_qty,
      COALESCE(required_qty, 0) AS required_qty
    FROM production_order_materials
    WHERE order_id=?
      AND TRIM(COALESCE(supply_mode, 'our_supply')) != 'factory_supply'
    ORDER BY id ASC
  `).all(orderId)
  const bucket = new Map()
  rows.forEach((row) => {
    const reserveQty = round(Math.max(
      Number(row.actual_issued_qty || 0),
      Number(row.consumed_qty || 0),
      0
    ), 6)
    if (!row.material_id || reserveQty <= 0) return
    const key = [
      Number(row.material_id || 0),
      normalizeInventoryColor(row.color),
      normalizeInventorySize(row.size)
    ].join('__')
    const current = bucket.get(key) || {
      order_id: Number(order.id || 0),
      order_no: cleanText(order.order_no),
      factory_name: cleanText(order.factory_name),
      material_id: Number(row.material_id || 0),
      material_name: cleanText(row.material_name),
      material_code: cleanText(row.material_code),
      material_unit: normalizeUnit(row.material_unit || '米'),
      color: normalizeInventoryColor(row.color),
      size: normalizeInventorySize(row.size),
      reserve_qty: 0
    }
    current.reserve_qty = round(Number(current.reserve_qty || 0) + reserveQty, 6)
    bucket.set(key, current)
  })
  return [...bucket.values()].filter((item) => Number(item.reserve_qty || 0) > 0)
}

function getApprovedBatchInventoryEntries(options = {}) {
  const excludeProductionOrderId = Number(
    options.exclude_production_order_id
    || options.excludeProductionOrderId
    || options.exclude_order_id
    || options.excludeOrderId
    || 0
  )
  const consumedParams = []
  let consumedExcludeSql = ''
  if (excludeProductionOrderId > 0) {
    consumedExcludeSql = 'AND pom.order_id != ?'
    consumedParams.push(excludeProductionOrderId)
  }
  const batchConsumedMap = new Map(
    db.prepare(`
      SELECT
        pom.batch_id,
        ROUND(COALESCE(SUM(pom.consumed_qty), 0), 6) AS consumed_qty
      FROM production_order_materials pom
      JOIN production_orders po ON po.id = pom.order_id
      WHERE pom.batch_id IS NOT NULL
        AND LOWER(TRIM(COALESCE(po.document_status, 'draft'))) = 'approved'
        ${consumedExcludeSql}
      GROUP BY pom.batch_id
    `).all(...consumedParams).map((item) => [Number(item.batch_id || 0), Number(item.consumed_qty || 0)])
  )
  const batchFactoryConsumedMap = new Map(
    db.prepare(`
      SELECT
        pom.batch_id,
        TRIM(COALESCE(po.factory_name, '')) AS factory_name,
        ROUND(COALESCE(SUM(pom.consumed_qty), 0), 6) AS consumed_qty
      FROM production_order_materials pom
      JOIN production_orders po ON po.id = pom.order_id
      WHERE pom.batch_id IS NOT NULL
        AND LOWER(TRIM(COALESCE(po.document_status, 'draft'))) = 'approved'
        ${consumedExcludeSql}
      GROUP BY pom.batch_id, TRIM(COALESCE(po.factory_name, ''))
    `).all(...consumedParams).map((item) => [`${Number(item.batch_id || 0)}__${cleanText(item.factory_name)}`, Number(item.consumed_qty || 0)])
  )

  return db.prepare(`
    SELECT
      pb.id,
      pb.batch_no,
      pb.material_id,
      pb.gross_qty,
      pb.remaining_qty,
      pb.unit,
      pb.purchase_order_no,
      pb.supplier,
      pb.warehouse_name,
      pb.color,
      pb.size,
      pb.color_remark,
      pb.price_type,
      pb.roll_count,
      pb.purchase_input_qty,
      pb.purchase_input_unit,
      pb.actual_input_qty,
      pb.actual_input_unit,
      pb.price,
      pb.price_unit,
      pb.raw_unit_price,
      pb.base_unit_price,
      pb.processing_cost,
      pb.processing_cost_per_unit,
      pb.processing_note,
      pb.factory_name,
      pb.factory_allocated_qty,
      pb.parent_batch_id,
      pb.source_batch_no,
      pb.effective_unit_price,
      pb.total_amount,
      pb.received_at,
      pb.remark,
      m.name AS material_name,
      m.code AS material_code,
      m.image_path AS material_image_path,
      m.unit AS material_base_unit,
      m.width AS material_width,
      m.weight AS material_weight,
      m.meter_per_kg AS material_meter_per_kg,
      m.supplier AS material_supplier
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE LOWER(TRIM(COALESCE(pb.document_status, 'draft'))) = 'approved'
      AND pb.remaining_qty > 0
    ORDER BY date(pb.received_at) ASC, pb.id ASC
  `).all().map((item) => {
    const material = {
      id: Number(item.material_id || 0),
      unit: normalizeUnit(item.unit || item.material_base_unit),
      width: Number(item.material_width || 0),
      weight: Number(item.material_weight || 0),
      meter_per_kg: Number(item.material_meter_per_kg || 0)
    }
    const consumedQty = Number(batchConsumedMap.get(Number(item.id || 0)) || 0)
    const actualInputUnit = normalizeUnit(item.actual_input_unit || item.purchase_input_unit || item.unit)
    const allocations = getPurchaseBatchAllocations(item.id)
    const allocationSummary = allocations.map((allocation) => {
      const effectiveAllocatedQty = resolveFactoryAllocationQtyFromRollCount(item, allocation, material)
      const inputAllocatedQty = resolveFactoryAllocationInputQty(item, {
        ...allocation,
        input_allocated_qty: tryConvertQuantity(
          Number(allocation.allocated_qty || 0),
          normalizeUnit(item.unit),
          actualInputUnit,
          material,
          0
        )
      })
      const allocationConsumedQty = Number(
        batchFactoryConsumedMap.get(`${Number(item.id || 0)}__${cleanText(allocation.factory_name)}`) || 0
      )
      const remainingQty = round(
        Math.max(Math.min(effectiveAllocatedQty, Number(item.remaining_qty || 0) + allocationConsumedQty) - allocationConsumedQty, 0),
        4
      )
      return {
        ...allocation,
        allocated_qty: effectiveAllocatedQty,
        input_allocated_qty: inputAllocatedQty,
        consumed_qty: allocationConsumedQty,
        remaining_qty: remainingQty,
        pre_allocated_qty: 0,
        available_after_prealloc_qty: remainingQty,
        remaining_meters: round(tryConvertQuantity(remainingQty, normalizeUnit(item.unit), '米', material, 0), 4)
      }
    })
    const factoryRemainingQty = round(
      allocationSummary.reduce((sum, allocation) => sum + Number(allocation.remaining_qty || 0), 0),
      4
    )
    const warehouseRemainingQty = round(Math.max(Number(item.remaining_qty || 0) - factoryRemainingQty, 0), 4)
    return {
      ...item,
      color: normalizeInventoryColor(item.color),
      size: normalizeInventorySize(item.size),
      supplier_name: cleanText(item.supplier || item.material_supplier),
      allocations: allocationSummary,
      factory_name: allocationSummary.map((allocation) => cleanText(allocation.factory_name)).filter(Boolean).join('、') || item.factory_name,
      consumed_qty: consumedQty,
      factory_remaining_qty: factoryRemainingQty,
      warehouse_remaining_qty: warehouseRemainingQty,
      pre_allocated_qty: 0,
      factory_pre_allocated_qty: 0,
      warehouse_pre_allocated_qty: 0,
      available_after_prealloc_qty: round(Number(item.remaining_qty || 0), 4),
      factory_available_after_prealloc_qty: factoryRemainingQty,
      warehouse_available_after_prealloc_qty: warehouseRemainingQty,
      resolved_meters_per_kg: resolveMetersPerKg(item),
      factory_remaining_meters: round(tryConvertQuantity(factoryRemainingQty, normalizeUnit(item.unit), '米', material, 0), 4),
      warehouse_remaining_meters: round(tryConvertQuantity(warehouseRemainingQty, normalizeUnit(item.unit), '米', material, 0), 4)
    }
  })
}

function applyPendingPreallocationsToInventoryBatches(batches = [], options = {}) {
  const pendingRows = getPendingProductionPreallocationRows(options)
  pendingRows.forEach((demand) => {
    let remainingNeed = Number(demand.reserve_qty || 0)
    if (remainingNeed <= 0) return
    const targetFactory = cleanText(demand.factory_name)
    const matches = listMatchingInventoryBatches(batches, demand)
    let factoryBucket = null
    for (const batch of matches) {
      if (remainingNeed <= 0) break
      if (targetFactory) {
        const factoryAllocation = (batch.allocations || []).find(
          (allocation) => cleanText(allocation.factory_name) === targetFactory
        )
        if (factoryAllocation && !factoryBucket) factoryBucket = { batch, allocation: factoryAllocation }
        const factoryAvailable = Number(factoryAllocation?.available_after_prealloc_qty || 0)
        if (factoryAvailable > 0) {
          const reserveFactoryQty = round(Math.min(factoryAvailable, remainingNeed), 4)
          factoryAllocation.pre_allocated_qty = round(Number(factoryAllocation.pre_allocated_qty || 0) + reserveFactoryQty, 4)
          factoryAllocation.available_after_prealloc_qty = round(factoryAvailable - reserveFactoryQty, 4)
          batch.pre_allocated_qty = round(Number(batch.pre_allocated_qty || 0) + reserveFactoryQty, 4)
          batch.factory_pre_allocated_qty = round(Number(batch.factory_pre_allocated_qty || 0) + reserveFactoryQty, 4)
          batch.available_after_prealloc_qty = round(Number(batch.available_after_prealloc_qty || 0) - reserveFactoryQty, 4)
          batch.factory_available_after_prealloc_qty = round(Number(batch.factory_available_after_prealloc_qty || 0) - reserveFactoryQty, 4)
          remainingNeed = round(remainingNeed - reserveFactoryQty, 4)
        }
      }

      if (remainingNeed <= 0) continue
      if (!targetFactory) {
        const warehouseAvailable = Number(batch.warehouse_available_after_prealloc_qty || 0)
        if (warehouseAvailable <= 0) continue
        const reserveWarehouseQty = round(Math.min(warehouseAvailable, remainingNeed), 4)
        batch.pre_allocated_qty = round(Number(batch.pre_allocated_qty || 0) + reserveWarehouseQty, 4)
        batch.warehouse_pre_allocated_qty = round(Number(batch.warehouse_pre_allocated_qty || 0) + reserveWarehouseQty, 4)
        batch.available_after_prealloc_qty = round(Number(batch.available_after_prealloc_qty || 0) - reserveWarehouseQty, 4)
        batch.warehouse_available_after_prealloc_qty = round(warehouseAvailable - reserveWarehouseQty, 4)
        remainingNeed = round(remainingNeed - reserveWarehouseQty, 4)
      }
    }

    if (remainingNeed > 0.0001 && targetFactory && !factoryBucket && matches[0]) {
      const batch = matches[0]
      const allocation = {
        factory_name: targetFactory,
        allocated_qty: 0,
        consumed_qty: 0,
        remaining_qty: 0,
        pre_allocated_qty: 0,
        available_after_prealloc_qty: 0
      }
      batch.allocations = [...(batch.allocations || []), allocation]
      factoryBucket = { batch, allocation }
    }

    if (remainingNeed > 0.0001 && targetFactory && factoryBucket) {
      const reserveDeficitQty = round(remainingNeed, 4)
      factoryBucket.allocation.pre_allocated_qty = round(Number(factoryBucket.allocation.pre_allocated_qty || 0) + reserveDeficitQty, 4)
      factoryBucket.allocation.available_after_prealloc_qty = round(Number(factoryBucket.allocation.available_after_prealloc_qty || 0) - reserveDeficitQty, 4)
      factoryBucket.batch.pre_allocated_qty = round(Number(factoryBucket.batch.pre_allocated_qty || 0) + reserveDeficitQty, 4)
      factoryBucket.batch.factory_pre_allocated_qty = round(Number(factoryBucket.batch.factory_pre_allocated_qty || 0) + reserveDeficitQty, 4)
      factoryBucket.batch.available_after_prealloc_qty = round(Number(factoryBucket.batch.available_after_prealloc_qty || 0) - reserveDeficitQty, 4)
      factoryBucket.batch.factory_available_after_prealloc_qty = round(Number(factoryBucket.batch.factory_available_after_prealloc_qty || 0) - reserveDeficitQty, 4)
    }
  })

  return batches.map((batch) => ({
    ...batch,
    pre_allocated_qty: round(Number(batch.pre_allocated_qty || 0), 4),
    factory_pre_allocated_qty: round(Number(batch.factory_pre_allocated_qty || 0), 4),
    warehouse_pre_allocated_qty: round(Number(batch.warehouse_pre_allocated_qty || 0), 4),
    available_after_prealloc_qty: round(Number(batch.available_after_prealloc_qty || 0), 4),
    factory_available_after_prealloc_qty: round(Number(batch.factory_available_after_prealloc_qty || 0), 4),
    warehouse_available_after_prealloc_qty: round(Number(batch.warehouse_available_after_prealloc_qty || 0), 4),
    allocations: (batch.allocations || []).map((allocation) => ({
      ...allocation,
      pre_allocated_qty: round(Number(allocation.pre_allocated_qty || 0), 4),
      available_after_prealloc_qty: round(Number(allocation.available_after_prealloc_qty || 0), 4)
    }))
  }))
}

function autoAllocateWarehouseToFactoryForProductionOrder(orderId) {
  const order = db.prepare(`
    SELECT id, order_no, factory_name
    FROM production_orders
    WHERE id=?
  `).get(orderId)
  if (!order) throw new Error('生产单不存在')
  const factoryName = cleanText(order.factory_name)
  if (!factoryName) return []

  const demands = getProductionOrderInventoryDemands(orderId)
  if (!demands.length) return []

  const batches = getApprovedBatchInventoryEntries()
  const touchedBatchPlans = new Map()
  const transferLogs = []

  const getPlannedAllocations = (batch) => {
    if (!touchedBatchPlans.has(batch.id)) {
      touchedBatchPlans.set(batch.id, (batch.allocations || []).map((allocation) => ({
        factory_name: cleanText(allocation.factory_name),
        allocated_qty: round(Number(allocation.allocated_qty || 0), 6),
        allocated_roll_count: round(Number(allocation.allocated_roll_count || 0), 4)
      })))
    }
    return touchedBatchPlans.get(batch.id)
  }

  const appendTransferAllocation = (plannedAllocations, transferQty) => {
    const candidate = plannedAllocations.find((item) =>
      cleanText(item.factory_name) === factoryName && Math.abs(Number(item.allocated_roll_count || 0)) <= 0.0001
    )
    if (candidate) {
      candidate.allocated_qty = round(Number(candidate.allocated_qty || 0) + transferQty, 6)
      return
    }
    plannedAllocations.push({
      factory_name: factoryName,
      allocated_qty: round(transferQty, 6),
      allocated_roll_count: 0
    })
  }

  demands.forEach((demand) => {
    let remainingNeed = Number(demand.reserve_qty || 0)
    if (remainingNeed <= 0) return
    const matches = listMatchingInventoryBatches(batches, demand)
    const totalFactoryAvailable = round(matches.reduce((sum, batch) => {
      const allocation = (batch.allocations || []).find((item) => cleanText(item.factory_name) === factoryName)
      return sum + Number(allocation?.available_after_prealloc_qty || allocation?.remaining_qty || 0)
    }, 0), 4)
    const totalWarehouseAvailable = round(matches.reduce((sum, batch) => {
      return sum + Number(batch.warehouse_available_after_prealloc_qty || batch.warehouse_remaining_qty || 0)
    }, 0), 4)

    for (const batch of matches) {
      if (remainingNeed <= 0) break
      const allocation = (batch.allocations || []).find((item) => cleanText(item.factory_name) === factoryName)
      const factoryAvailable = Number(allocation?.available_after_prealloc_qty || allocation?.remaining_qty || 0)
      if (factoryAvailable > 0) {
        const consumeFactoryQty = round(Math.min(factoryAvailable, remainingNeed), 4)
        if (allocation) {
          allocation.available_after_prealloc_qty = round(factoryAvailable - consumeFactoryQty, 4)
        }
        batch.factory_available_after_prealloc_qty = round(Number(batch.factory_available_after_prealloc_qty || batch.factory_remaining_qty || 0) - consumeFactoryQty, 4)
        batch.available_after_prealloc_qty = round(Number(batch.available_after_prealloc_qty || batch.remaining_qty || 0) - consumeFactoryQty, 4)
        remainingNeed = round(remainingNeed - consumeFactoryQty, 4)
      }
      if (remainingNeed <= 0) continue

      const warehouseAvailable = Number(batch.warehouse_available_after_prealloc_qty || batch.warehouse_remaining_qty || 0)
      if (warehouseAvailable <= 0) continue
      const transferQty = round(Math.min(warehouseAvailable, remainingNeed), 4)
      const plannedAllocations = getPlannedAllocations(batch)
      appendTransferAllocation(plannedAllocations, transferQty)
      batch.warehouse_available_after_prealloc_qty = round(warehouseAvailable - transferQty, 4)
      batch.available_after_prealloc_qty = round(Number(batch.available_after_prealloc_qty || batch.remaining_qty || 0) - transferQty, 4)
      remainingNeed = round(remainingNeed - transferQty, 4)
      transferLogs.push({
        batch_id: Number(batch.id || 0),
        batch_no: cleanText(batch.batch_no),
        factory_name: factoryName,
        qty: transferQty,
        unit: normalizeUnit(batch.unit || demand.material_unit),
        material_id: Number(demand.material_id || 0),
        material_code: cleanText(demand.material_code),
        material_name: cleanText(demand.material_name),
        color: cleanText(demand.color),
        size: cleanText(demand.size)
      })
    }

    if (remainingNeed > 0.0001) {
      const totalAvailable = round(totalFactoryAvailable + totalWarehouseAvailable, 4)
      const unit = normalizeUnit(demand.material_unit || '米')
      throw new Error(
        `物料【${buildInventoryDemandLabel(demand)}】库存不足，当前工厂剩余 ${formatServerQtyWithUnit(totalFactoryAvailable, unit)}，`
        + `仓库剩余 ${formatServerQtyWithUnit(totalWarehouseAvailable, unit)}，还差 ${formatServerQtyWithUnit(remainingNeed, unit)}`
      )
    }
  })

  touchedBatchPlans.forEach((plannedAllocations, batchId) => {
    const batch = batches.find((item) => Number(item.id || 0) === Number(batchId))
    if (!batch) return
    const savedAllocations = replacePurchaseBatchAllocations(batchId, plannedAllocations)
    const material = getMaterialById(batch.material_id)
    const effectiveAllocatedQty = round(savedAllocations.reduce((sum, allocation) => {
      return sum + Number(resolveFactoryAllocationQtyFromRollCount(batch, allocation, material) || 0)
    }, 0), 6)
    const joinedFactoryNames = [...new Set(savedAllocations.map((item) => cleanText(item.factory_name)).filter(Boolean))].join('、')
    db.prepare(`
      UPDATE purchase_batches
      SET factory_name=?, factory_allocated_qty=?
      WHERE id=?
    `).run(joinedFactoryNames, effectiveAllocatedQty, batchId)
    logAudit('生产制单', '审核自动调仓', 'purchase_batch', batchId, cleanText(batch.batch_no), null, {
      order_id: Number(order.id || 0),
      order_no: cleanText(order.order_no),
      factory_name: factoryName,
      allocations: savedAllocations
    })
  })

  return transferLogs
}

function approveSingleProductionOrder(orderId, options = {}) {
  const {
    reviewImages = [],
    skipReviewImages = false,
    auditAction = '审核生产单'
  } = options
  const before = getProductionOrderById(orderId)
  if (!before) return null
  if (normalizeDocumentStatus(before.document_status) === 'approved') {
    return getProductionOrderStatusSnapshot(orderId)
  }

  recalculateOrder(orderId, 'none')
  autoAllocateWarehouseToFactoryForProductionOrder(orderId)

  const existingImages = normalizeImageList(before.review_images_json)
  const finalImages = Array.isArray(reviewImages) && reviewImages.length ? reviewImages : existingImages
  if (!skipReviewImages && !finalImages.length) {
    throw new Error(`生产单【${cleanText(before.order_no)}】审核前请先上传单据图片`)
  }

  db.prepare(`
    UPDATE production_orders
    SET document_status=?, review_images_json=?
    WHERE id=?
  `).run('approved', safeJsonStringify(finalImages, '[]'), orderId)

  recalculateOrder(orderId, 'none')
  const after = getProductionOrderStatusSnapshot(orderId)
  logAudit('生产制单', auditAction, 'production_order', orderId, cleanText(after?.order_no), before, after)
  return after
}

function migrateLegacySubmittedProductionOrders() {
  const legacyIds = db.prepare(`
    SELECT id
    FROM production_orders
    WHERE LOWER(TRIM(COALESCE(document_status, 'draft'))) = 'submitted'
    ORDER BY date(created_at) ASC, id ASC
  `).all().map((row) => Number(row.id || 0)).filter((value) => value > 0)
  if (!legacyIds.length) return 0

  const approveLegacy = db.transaction((targetId) => {
    approveSingleProductionOrder(targetId, {
      skipReviewImages: true,
      auditAction: '兼容迁移已提交生产单'
    })
  })

  let migratedCount = 0
  legacyIds.forEach((id) => {
    try {
      approveLegacy(id)
      migratedCount += 1
    } catch (error) {
      logDeferredStartupIssue(`legacy-production-order-migration:${id}`, error)
    }
  })
  return migratedCount
}

function repairLegacyProductionOrderMaterialCosts() {
  const targetIds = db.prepare(`
    SELECT DISTINCT po.id AS order_id
    FROM production_orders po
    JOIN production_order_plan_items popi ON popi.order_id = po.id
    WHERE LOWER(TRIM(COALESCE(po.document_status, 'draft'))) != 'voided'
      AND (
        COALESCE(popi.actual_issued_qty, 0) > 0
        OR COALESCE(popi.actual_total_amount, 0) > 0
      )
    ORDER BY po.id ASC
  `).all().map((row) => Number(row.order_id || 0)).filter((value) => value > 0)
  if (!targetIds.length) return 0

  let repairedCount = 0
  targetIds.forEach((orderId) => {
    try {
      recalculateOrder(orderId, 'none')
      repairedCount += 1
    } catch (error) {
      logDeferredStartupIssue(`legacy-production-order-cost-repair:${orderId}`, error)
    }
  })
  return repairedCount
}

function summarizeAuditValue(value) {
  if (value === null || value === undefined || value === '') return '-'
  if (Array.isArray(value)) return `数组(${value.length})`
  if (typeof value === 'object') return '对象'
  return cleanText(String(value)).slice(0, 40) || '-'
}

function summarizeAuditPayload(text) {
  const source = cleanText(text)
  if (!source) return '-'
  try {
    const parsed = JSON.parse(source)
    if (parsed === null || parsed === undefined || parsed === '') return '-'
    if (typeof parsed === 'string') return cleanText(parsed).slice(0, 120) || '-'
    if (Array.isArray(parsed)) return `数组(${parsed.length})`
    if (typeof parsed === 'object') {
      const entries = Object.entries(parsed).slice(0, 3)
      if (!entries.length) return '对象'
      return entries.map(([key, value]) => `${key}:${summarizeAuditValue(value)}`).join(' / ')
    }
    return cleanText(String(parsed)).slice(0, 120) || '-'
  } catch {
    return source.slice(0, 120) || '-'
  }
}

function getAuditLogs(params = {}) {
  const filterField = cleanText(params.filterField) || 'keyword'
  const keyword = cleanText(params.keyword).toLowerCase()
  const safeLimit = Math.max(1, Math.min(Number(params.limit || 120), 300))
  const conditions = []
  const values = []

  const applyLike = (expressions) => {
    if (!keyword) return
    const normalized = (Array.isArray(expressions) ? expressions : [expressions]).filter(Boolean)
    if (!normalized.length) return
    conditions.push(`(${normalized.map((expression) => `LOWER(COALESCE(${expression}, '')) LIKE ?`).join(' OR ')})`)
    normalized.forEach(() => values.push(`%${keyword}%`))
  }

  if (keyword) {
    const fieldMap = {
      keyword: ['module', 'action', 'entity_label', 'operator_name', 'client_name', 'remark'],
      module: ['module'],
      action: ['action'],
      entity_label: ['entity_label'],
      operator_name: ['operator_name']
    }
    applyLike(fieldMap[filterField] || fieldMap.keyword)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const cacheKey = JSON.stringify({
    scope: 'audit:logs',
    filterField,
    keyword,
    limit: safeLimit
  })

  return getCachedQueryResult(cacheKey, () => db.prepare(`
    SELECT
      id,
      module,
      action,
      entity_type,
      entity_id,
      entity_label,
      operator_name,
      operator_username,
      client_name,
      remark,
      before_json,
      after_json,
      created_at
    FROM audit_logs
    ${whereClause}
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(...values, safeLimit).map((row) => ({
    ...row,
    before_preview: summarizeAuditPayload(row.before_json),
    after_preview: summarizeAuditPayload(row.after_json)
  })), 5000)
}

function repairPurchaseBatchQuantities() {
  if (workspaceReadOnly) return 0
  const rows = db.prepare(`
    SELECT
      pb.id,
      pb.purchase_input_qty,
      pb.purchase_input_unit,
      pb.actual_input_qty,
      pb.actual_input_unit,
      pb.roll_count,
      pb.gross_qty,
      pb.remaining_qty,
      pb.unit,
      pb.price,
      pb.price_unit,
      pb.processing_cost,
      pb.raw_unit_price,
      pb.base_unit_price,
      pb.processing_cost_per_unit,
      pb.effective_unit_price,
      pb.total_amount,
      m.unit AS material_unit,
      m.width AS material_width,
      m.weight AS material_weight,
      m.meter_per_kg AS material_meter_per_kg,
      m.custom_conversion_from_qty AS material_custom_conversion_from_qty,
      m.custom_conversion_from_unit AS material_custom_conversion_from_unit,
      m.custom_conversion_to_qty AS material_custom_conversion_to_qty,
      m.custom_conversion_to_unit AS material_custom_conversion_to_unit,
      m.adjustment_type AS material_adjustment_type,
      m.left_gap AS material_left_gap,
      m.right_gap AS material_right_gap,
      m.gap_ratio AS material_gap_ratio,
      m.custom_formula AS material_custom_formula
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
  `).all()
  if (!rows.length) return 0

  const allocatedStmt = db.prepare(`
    SELECT ROUND(COALESCE(SUM(allocated_qty), 0), 6) AS qty
    FROM production_order_materials
    WHERE batch_id=?
  `)
  const afterSaleOutStmt = db.prepare(`
    SELECT ROUND(COALESCE(SUM(qty), 0), 6) AS qty
    FROM purchase_batch_after_sales
    WHERE purchase_batch_id=?
      AND LOWER(TRIM(COALESCE(type, ''))) IN ('return', 'exchange')
  `)
  const updateStmt = db.prepare(`
    UPDATE purchase_batches
    SET
      actual_input_qty=@actual_input_qty,
      actual_input_unit=@actual_input_unit,
      gross_qty=@gross_qty,
      remaining_qty=@remaining_qty,
      unit=@unit,
      raw_unit_price=@raw_unit_price,
      base_unit_price=@base_unit_price,
      processing_cost_per_unit=@processing_cost_per_unit,
      effective_unit_price=@effective_unit_price,
      total_amount=@total_amount
    WHERE id=@id
  `)
  const tx = db.transaction((items) => {
    let changes = 0

    items.forEach((row) => {
      const material = {
        unit: row.material_unit,
        width: row.material_width,
        weight: row.material_weight,
        meter_per_kg: row.material_meter_per_kg,
        custom_conversion_from_qty: row.material_custom_conversion_from_qty,
        custom_conversion_from_unit: row.material_custom_conversion_from_unit,
        custom_conversion_to_qty: row.material_custom_conversion_to_qty,
        custom_conversion_to_unit: row.material_custom_conversion_to_unit,
        adjustment_type: row.material_adjustment_type,
        left_gap: row.material_left_gap,
        right_gap: row.material_right_gap,
        gap_ratio: row.material_gap_ratio,
        custom_formula: row.material_custom_formula
      }

      let actualInputQty = 0
      const actualInputUnit = normalizeUnit(row.actual_input_unit || row.purchase_input_unit || row.unit || material.unit)
      let grossQty = 0
      try {
        actualInputQty = resolvePurchaseActualInputQty({
          purchase_input_qty: row.purchase_input_qty,
          actual_input_qty: row.actual_input_qty,
          purchase_input_unit: row.purchase_input_unit,
          actual_input_unit: row.actual_input_unit,
          gross_qty: row.gross_qty,
          roll_count: row.roll_count
        }, material)
        grossQty = resolvePurchaseGrossQty({
          actual_input_qty: actualInputQty,
          actual_input_unit: actualInputUnit,
          purchase_input_qty: row.purchase_input_qty,
          purchase_input_unit: row.purchase_input_unit,
          gross_qty: row.gross_qty
        }, material)
      } catch {
        return
      }

      const allocatedQty = Number(allocatedStmt.get(row.id)?.qty || 0)
      const afterSaleOutQty = Number(afterSaleOutStmt.get(row.id)?.qty || 0)
      const remainingQty = round(Math.max(grossQty - allocatedQty - afterSaleOutQty, 0), 6)
      let settlementQty = 0
      try {
        settlementQty = resolvePurchasePricedQty({
          purchase_input_qty: row.purchase_input_qty,
          purchase_input_unit: row.purchase_input_unit,
          price_unit: row.price_unit || row.unit
        }, material)
      } catch {
        return
      }
      const settlementAmount = round(settlementQty * Number(row.price || 0), 4)
      let rawUnitPrice = grossQty > 0 ? round(settlementAmount / grossQty, 6) : 0
      try {
        resolvePriceToMaterialUnit({
          price: row.price,
          price_unit: row.price_unit || row.unit
        }, material)
      } catch {
        return
      }
      const processingCost = Number(row.processing_cost || 0)
      const processingCostPerUnit = grossQty > 0 ? round(processingCost / grossQty, 6) : 0
      const baseUnitPrice = grossQty > 0 ? round((settlementAmount + processingCost) / grossQty, 6) : 0
      const effectiveUnitPrice = calculateEffectivePrice(buildAdjustmentPayloadFromMaterial(material, {
        ...row,
        gross_qty: grossQty,
        price: baseUnitPrice
      }))
      const totalAmount = round(settlementAmount + processingCost, 4)
      const targetUnit = normalizeUnit(material.unit || row.unit)
      const hasDiff = (
        Math.abs(Number(row.actual_input_qty || 0) - actualInputQty) > 0.0001 ||
        normalizeUnit(row.actual_input_unit) !== actualInputUnit ||
        Math.abs(Number(row.gross_qty || 0) - grossQty) > 0.0001 ||
        Math.abs(Number(row.remaining_qty || 0) - remainingQty) > 0.0001 ||
        normalizeUnit(row.unit) !== targetUnit ||
        Math.abs(Number(row.base_unit_price || 0) - baseUnitPrice) > 0.0001 ||
        Math.abs(Number(row.raw_unit_price || 0) - rawUnitPrice) > 0.0001 ||
        Math.abs(Number(row.processing_cost_per_unit || 0) - processingCostPerUnit) > 0.0001 ||
        Math.abs(Number(row.effective_unit_price || 0) - effectiveUnitPrice) > 0.0001 ||
        Math.abs(Number(row.total_amount || 0) - totalAmount) > 0.0001
      )
      if (!hasDiff) return

      updateStmt.run({
        id: row.id,
        actual_input_qty: actualInputQty,
        actual_input_unit: actualInputUnit,
        gross_qty: grossQty,
        remaining_qty: remainingQty,
        unit: targetUnit,
        raw_unit_price: rawUnitPrice,
        base_unit_price: baseUnitPrice,
        processing_cost_per_unit: processingCostPerUnit,
        effective_unit_price: effectiveUnitPrice,
        total_amount: totalAmount
      })
      changes += 1
    })

    return changes
  })

  return tx(rows)
}

function seedOptionValue(type, value) {
  const cleanValue = cleanText(value)
  if (!cleanValue) return
  const exists = db.prepare(`
    SELECT id
    FROM option_values
    WHERE type=? AND value=?
  `).get(type, cleanValue)
  if (exists) return

  db.prepare(`
    INSERT INTO option_values (type, value, sort_order)
    VALUES (?, ?, ?)
  `).run(type, cleanValue, nextSortOrder('option_values', 'type=?', [type]))
}

function getOptionValues(type, extraValues = []) {
  const rows = db.prepare(`
    SELECT id, value, sort_order
    FROM option_values
    WHERE type=?
    ORDER BY sort_order ASC, id ASC
  `).all(type)

  const existing = new Set(rows.map((row) => normalizedText(row.value)))
  const appended = uniqueNonEmpty(extraValues)
    .filter((value) => !existing.has(normalizedText(value)))
    .map((value, index) => ({
      id: null,
      value,
      sort_order: rows.length + index + 1
    }))

  return [...rows, ...appended].map((row, index) => ({
    id: row.id,
    value: cleanText(row.value),
    sort_order: Number(row.sort_order || index + 1)
  }))
}

function getOptionLists() {
  return getCachedQueryResult('options:lists', () => {
    const materialMajorCategories = getOptionValues('material_major_category', db.prepare(`
      SELECT major_category AS value FROM materials WHERE TRIM(major_category) != ''
    `).all().map((row) => row.value))

    const materialCategories = getOptionValues('material_category', db.prepare(`
      SELECT category AS value FROM materials WHERE TRIM(category) != ''
    `).all().map((row) => row.value))

    const materialSubCategories = getOptionValues('material_sub_category', db.prepare(`
      SELECT sub_category AS value FROM materials WHERE TRIM(sub_category) != ''
    `).all().map((row) => row.value))

    const materialLeafCategories = getOptionValues('material_leaf_category', db.prepare(`
      SELECT leaf_category AS value FROM materials WHERE TRIM(leaf_category) != ''
    `).all().map((row) => row.value))

    const garmentCategories = getOptionValues('garment_category', db.prepare(`
      SELECT category AS value FROM garments WHERE TRIM(category) != ''
    `).all().map((row) => row.value))

    const suppliers = getOptionValues('supplier', [
      ...db.prepare(`SELECT supplier AS value FROM materials WHERE TRIM(supplier) != ''`).all().map((row) => row.value),
      ...db.prepare(`SELECT supplier AS value FROM purchase_batches WHERE TRIM(supplier) != ''`).all().map((row) => row.value)
    ])

    const warehouses = getOptionValues('warehouse', [
      '主仓库',
      ...db.prepare(`SELECT warehouse_name AS value FROM purchase_batches WHERE TRIM(warehouse_name) != ''`).all().map((row) => row.value)
    ])

    const factories = getOptionValues('factory', [
      ...db.prepare(`SELECT factory_name AS value FROM production_orders WHERE TRIM(factory_name) != ''`).all().map((row) => row.value),
      ...db.prepare(`SELECT factory_name AS value FROM consumption_records WHERE TRIM(factory_name) != ''`).all().map((row) => row.value)
    ])

    const units = getOptionValues('unit', [
      ...db.prepare(`SELECT unit AS value FROM materials WHERE TRIM(unit) != ''`).all().map((row) => row.value),
      ...db.prepare(`SELECT unit AS value FROM purchase_batches WHERE TRIM(unit) != ''`).all().map((row) => row.value),
      ...db.prepare(`SELECT usage_unit AS value FROM boms WHERE TRIM(usage_unit) != ''`).all().map((row) => row.value),
      ...db.prepare(`SELECT usage_unit AS value FROM production_order_plan_items WHERE TRIM(usage_unit) != ''`).all().map((row) => row.value)
    ])

    const materialRoles = getOptionValues('material_role', [
      ...db.prepare(`SELECT material_role AS value FROM boms WHERE TRIM(material_role) != ''`).all().map((row) => row.value),
      ...db.prepare(`SELECT material_role AS value FROM production_order_plan_items WHERE TRIM(material_role) != ''`).all().map((row) => row.value),
      ...db.prepare(`SELECT material_role AS value FROM production_order_materials WHERE TRIM(material_role) != ''`).all().map((row) => row.value)
    ])

    return { materialMajorCategories, materialCategories, materialSubCategories, materialLeafCategories, garmentCategories, suppliers, warehouses, factories, units, materialRoles }
  }, 10000)
}

function seedSuperAdmin() {
  const preferred = db.prepare(`
    SELECT id
    FROM users
    WHERE username=?
  `).get(DEFAULT_SUPER_ADMIN_USERNAME)
  if (preferred) {
    db.prepare(`
      UPDATE users
      SET
        display_name='超级管理员',
        role=?,
        permissions_json=?,
        enabled=1,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(AUTH_SUPER_ADMIN, JSON.stringify(['*']), preferred.id)
    return
  }

  const legacyAdmin = db.prepare(`
    SELECT id
    FROM users
    WHERE lower(username)='admin' OR username='XHFSHARRY'
    LIMIT 1
  `).get()
  if (legacyAdmin) {
    db.prepare(`
      UPDATE users
      SET
        username=?,
        display_name='超级管理员',
        password_hash=?,
        role=?,
        permissions_json=?,
        enabled=1,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      DEFAULT_SUPER_ADMIN_USERNAME,
      DEFAULT_SUPER_ADMIN_PASSWORD_HASH,
      AUTH_SUPER_ADMIN,
      JSON.stringify(['*']),
      legacyAdmin.id
    )
    return
  }

  db.prepare(`
    INSERT INTO users (
      username,
      display_name,
      password_hash,
      role,
      permissions_json,
      enabled
    ) VALUES (?, ?, ?, ?, ?, 1)
  `).run(
    DEFAULT_SUPER_ADMIN_USERNAME,
    '超级管理员',
    DEFAULT_SUPER_ADMIN_PASSWORD_HASH,
    AUTH_SUPER_ADMIN,
    JSON.stringify(['*'])
  )
}

function getUsers() {
  return db.prepare(`
    SELECT id, username, display_name, role, permissions_json, enabled, created_at, updated_at
    FROM users
    ORDER BY role DESC, created_at ASC, id ASC
  `).all().map(sanitizeUserRecord)
}

function loginUser(payload = {}) {
  const username = cleanText(payload.username)
  const password = String(payload.password || '')
  if (!username || !password) throw new Error('请输入账号和密码')

  const row = db.prepare(`
    SELECT *
    FROM users
    WHERE username=?
    LIMIT 1
  `).get(username)

  if (!row || !Number(row.enabled || 0)) {
    throw new Error('账号不存在或已停用')
  }

  if (!verifyPassword(password, row.password_hash)) {
    throw new Error('账号或密码错误')
  }

  const session = sanitizeUserRecord(row)
  currentActor = {
    username: session.username,
    display_name: session.display_name,
    role: session.role
  }
  logAudit('账号权限', '登录', 'user_session', session.id, session.username, null, {
    username: session.username,
    role: session.role
  }, '账号登录成功')
  return session
}

function saveUser(payload = {}) {
  const username = cleanText(payload.username)
  const displayName = cleanText(payload.display_name) || username
  const password = String(payload.password || '')
  const role = cleanText(payload.role) || 'user'
  const permissions = role === AUTH_SUPER_ADMIN ? ['*'] : normalizePermissions(payload.permissions || [])
  const enabled = Number(payload.enabled || 0) ? 1 : 0

  if (!username) throw new Error('请输入账号')
  if (!payload.id && !password) throw new Error('新账号必须设置密码')

  if (payload.id) {
    const existing = db.prepare('SELECT * FROM users WHERE id=?').get(payload.id)
    if (!existing) throw new Error('账号不存在')

    const duplicate = db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username, payload.id)
    if (duplicate) throw new Error('账号已存在')

    const nextHash = password ? hashPassword(password) : existing.password_hash
    db.prepare(`
      UPDATE users
      SET
        username=@username,
        display_name=@display_name,
        password_hash=@password_hash,
        role=@role,
        permissions_json=@permissions_json,
        enabled=@enabled,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=@id
    `).run({
      id: Number(payload.id),
      username,
      display_name: displayName,
      password_hash: nextHash,
      role,
      permissions_json: JSON.stringify(permissions),
      enabled
    })
    const saved = sanitizeUserRecord(db.prepare('SELECT * FROM users WHERE id=?').get(Number(payload.id)))
    logAudit('账号权限', '编辑账号', 'user', saved.id, saved.username, sanitizeUserRecord(existing), saved)
    return saved
  }

  const duplicate = db.prepare('SELECT id FROM users WHERE username=?').get(username)
  if (duplicate) throw new Error('账号已存在')

  const result = db.prepare(`
    INSERT INTO users (
      username,
      display_name,
      password_hash,
      role,
      permissions_json,
      enabled
    ) VALUES (
      @username,
      @display_name,
      @password_hash,
      @role,
      @permissions_json,
      @enabled
    )
  `).run({
    username,
    display_name: displayName,
    password_hash: hashPassword(password),
    role,
    permissions_json: JSON.stringify(permissions),
    enabled
  })

  const insertedId = normalizeInsertId(result.lastInsertRowid)
  const saved = sanitizeUserRecord(db.prepare('SELECT * FROM users WHERE id=?').get(insertedId))
  logAudit('账号权限', '新增账号', 'user', saved.id, saved.username, null, saved)
  return saved
}

function deleteUser(id) {
  const targetId = Number(id || 0)
  if (!targetId) throw new Error('账号不存在')
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(targetId)
  if (!row) throw new Error('账号不存在')
  if (cleanText(row.username) === DEFAULT_SUPER_ADMIN_USERNAME) {
    throw new Error('默认超级管理员不能删除')
  }

  if (cleanText(row.role) === AUTH_SUPER_ADMIN) {
    const superAdminCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM users
      WHERE role=? AND enabled=1
    `).get(AUTH_SUPER_ADMIN).count
    if (Number(superAdminCount || 0) <= 1) {
      throw new Error('至少保留一个启用中的超级管理员')
    }
  }

  const changes = db.prepare('DELETE FROM users WHERE id=?').run(targetId).changes
  if (changes) logAudit('账号权限', '删除账号', 'user', targetId, cleanText(row.username), sanitizeUserRecord(row), null)
  return changes
}

function saveOptionValue(type, value) {
  const cleanValue = cleanText(value)
  if (!cleanValue) throw new Error('选项值不能为空')
  seedOptionValue(type, cleanValue)
  bumpDataRevision()
  return getOptionLists()
}

function deleteOptionValue(type, value) {
  db.prepare('DELETE FROM option_values WHERE type=? AND value=?').run(type, cleanText(value))
  bumpDataRevision()
  return getOptionLists()
}

const OPTION_RENAME_TARGETS = {
  material_major_category: [{ table: 'materials', column: 'major_category' }],
  material_category: [{ table: 'materials', column: 'category' }],
  material_sub_category: [{ table: 'materials', column: 'sub_category' }],
  material_leaf_category: [{ table: 'materials', column: 'leaf_category' }],
  garment_category: [{ table: 'garments', column: 'category' }],
  supplier: [
    { table: 'materials', column: 'supplier' },
    { table: 'purchase_batches', column: 'supplier' }
  ],
  warehouse: [
    { table: 'purchase_batches', column: 'warehouse_name' },
    { table: 'purchase_batch_after_sales', column: 'warehouse_name' }
  ],
  factory: [
    { table: 'production_orders', column: 'factory_name' },
    { table: 'consumption_records', column: 'factory_name' },
    { table: 'purchase_batches', column: 'factory_name' },
    { table: 'purchase_batch_factory_allocations', column: 'factory_name' }
  ],
  unit: [
    { table: 'materials', column: 'unit' },
    { table: 'purchase_batches', column: 'unit' },
    { table: 'purchase_batches', column: 'price_unit' },
    { table: 'purchase_batches', column: 'purchase_input_unit' },
    { table: 'purchase_batches', column: 'actual_input_unit' },
    { table: 'purchase_batch_after_sales', column: 'unit' },
    { table: 'boms', column: 'usage_unit' },
    { table: 'production_order_plan_items', column: 'usage_unit' },
    { table: 'production_order_plan_items', column: 'actual_issued_unit' },
    { table: 'production_order_materials', column: 'material_unit' },
    { table: 'production_order_materials', column: 'usage_input_unit' },
    { table: 'production_order_materials', column: 'actual_issued_unit' }
  ],
  material_role: [
    { table: 'boms', column: 'material_role' },
    { table: 'production_order_plan_items', column: 'material_role' },
    { table: 'production_order_materials', column: 'material_role' }
  ]
}

function renameOptionValue(type, oldValue, newValue) {
  const cleanType = cleanText(type)
  const fromValue = cleanText(oldValue)
  const toValue = cleanText(newValue)
  if (!cleanType) throw new Error('请选择要修改的基础设置类型')
  if (!fromValue) throw new Error('请选择要修改的选项')
  if (!toValue) throw new Error('请输入新的选项名称')
  if (normalizedText(fromValue) === normalizedText(toValue)) return getOptionLists()

  const tx = db.transaction(() => {
    const duplicate = db.prepare(`
      SELECT id
      FROM option_values
      WHERE type=? AND LOWER(TRIM(value))=LOWER(TRIM(?))
      LIMIT 1
    `).get(cleanType, toValue)

    if (duplicate) {
      db.prepare(`
        DELETE FROM option_values
        WHERE type=? AND LOWER(TRIM(value))=LOWER(TRIM(?))
      `).run(cleanType, fromValue)
    } else {
      const existing = db.prepare(`
        SELECT id
        FROM option_values
        WHERE type=? AND LOWER(TRIM(value))=LOWER(TRIM(?))
        LIMIT 1
      `).get(cleanType, fromValue)
      if (existing) {
        db.prepare('UPDATE option_values SET value=? WHERE id=?').run(toValue, existing.id)
      } else {
        db.prepare(`
          INSERT INTO option_values (type, value, sort_order)
          VALUES (?, ?, ?)
        `).run(cleanType, toValue, nextSortOrder('option_values', 'type=?', [cleanType]))
      }
    }

    ;(OPTION_RENAME_TARGETS[cleanType] || []).forEach((target) => {
      if (!hasColumn(target.table, target.column)) return
      db.prepare(`
        UPDATE ${target.table}
        SET ${target.column}=?
        WHERE LOWER(TRIM(COALESCE(${target.column}, '')))=LOWER(TRIM(?))
      `).run(toValue, fromValue)
    })

    if (cleanType === 'factory' && hasColumn('garments', 'factory_process_fee_json')) {
      const rows = db.prepare(`
        SELECT id, factory_process_fee_json
        FROM garments
        WHERE COALESCE(factory_process_fee_json, '') != ''
      `).all()
      const update = db.prepare('UPDATE garments SET factory_process_fee_json=? WHERE id=?')
      rows.forEach((row) => {
        const parsedFees = safeJsonParse(row.factory_process_fee_json, [])
        const fees = Array.isArray(parsedFees) ? parsedFees : []
        let changed = false
        const nextFees = fees.map((item) => {
          if (normalizedText(item?.factory_name) !== normalizedText(fromValue)) return item
          changed = true
          return { ...item, factory_name: toValue }
        })
        if (changed) update.run(safeJsonStringify(nextFees, '[]'), row.id)
      })
    }
  })

  tx()
  bumpDataRevision()
  return getOptionLists()
}

function reorderOptionValues(type, values = []) {
  const orderedValues = uniqueNonEmpty(values)
  if (!orderedValues.length) return getOptionLists()

  const rows = db.prepare(`
    SELECT id, value
    FROM option_values
    WHERE type=?
  `).all(type)
  const rowMap = new Map(rows.map((row) => [cleanText(row.value), row.id]))
  const update = db.prepare(`
    UPDATE option_values
    SET sort_order=?
    WHERE id=?
  `)

  orderedValues.forEach((value, index) => {
    const rowId = rowMap.get(cleanText(value))
    if (rowId) update.run(index + 1, rowId)
  })

  bumpDataRevision()
  return getOptionLists()
}

function getDashboardStats() {
  return getCachedQueryResult('dashboard:stats', () => {
    const materialsCount = db.prepare('SELECT COUNT(*) AS c FROM materials').get().c
    const garmentsCount = db.prepare('SELECT COUNT(*) AS c FROM garments').get().c
    const batchesCount = db.prepare('SELECT COUNT(*) AS c FROM purchase_batches').get().c
    const productionCount = db.prepare('SELECT COUNT(*) AS c FROM production_orders').get().c
    const consumptionCount = db.prepare('SELECT COUNT(*) AS c FROM consumption_records').get().c
    const warningCount = db.prepare(`
      SELECT COUNT(*) AS c
      FROM consumption_records
      WHERE actual_output_qty > 0
        AND actual_material_qty > 0
        AND ((actual_material_qty / NULLIF(actual_output_qty, 0)) - (pattern_consumption * (1 + loss_rate)))
          / NULLIF((pattern_consumption * (1 + loss_rate)), 0) > 0.05
    `).get().c
    const stockValue = db.prepare(`
      SELECT ROUND(COALESCE(SUM(remaining_qty * base_unit_price), 0), 2) AS total
      FROM purchase_batches
    `).get().total
    return { materialsCount, garmentsCount, batchesCount, productionCount, consumptionCount, warningCount, stockValue }
  }, 5000)
}

function getConsumptionAverage(conditions = [], params = {}) {
  const where = ['actual_output_qty > 0', 'actual_material_qty > 0', ...conditions].join(' AND ')
  const row = db.prepare(`
    SELECT
      COUNT(*) AS count,
      ROUND(AVG(actual_material_qty / NULLIF(actual_output_qty, 0)), 6) AS avg
    FROM consumption_records
    WHERE ${where}
  `).get(params)

  return {
    count: Number(row?.count || 0),
    avg: Number(row?.avg || 0)
  }
}

function buildConsumptionSuggestion(record = {}) {
  const params = {
    id: Number(record.id || 0),
    style_code: cleanText(record.style_code),
    factory_name: cleanText(record.factory_name),
    fabric_type: normalizeFabricType(record.fabric_type),
    gram_weight: Number(record.gram_weight || 0),
    width: Number(record.width || 0)
  }
  const excludeSelf = params.id ? 'id != @id' : '1=1'
  const sameWeightAndWidth = [
    'ABS(COALESCE(gram_weight, 0) - @gram_weight) <= 0.01',
    'ABS(COALESCE(width, 0) - @width) <= 0.01'
  ]

  const styleFactoryFabric = getConsumptionAverage([
    excludeSelf,
    'LOWER(TRIM(style_code)) = LOWER(TRIM(@style_code))',
    'LOWER(TRIM(factory_name)) = LOWER(TRIM(@factory_name))',
    'fabric_type = @fabric_type',
    ...sameWeightAndWidth
  ], params)

  const style = getConsumptionAverage([
    excludeSelf,
    'LOWER(TRIM(style_code)) = LOWER(TRIM(@style_code))'
  ], params)

  const factory = getConsumptionAverage([
    excludeSelf,
    'LOWER(TRIM(factory_name)) = LOWER(TRIM(@factory_name))'
  ], params)

  const fabric = getConsumptionAverage([
    excludeSelf,
    'fabric_type = @fabric_type',
    ...sameWeightAndWidth
  ], params)

  const candidates = [
    { key: 'style_factory_fabric', label: '同款号+同工厂+同面料规格', ...styleFactoryFabric },
    { key: 'style', label: '同款号历史平均', ...style },
    { key: 'factory', label: '同工厂历史平均', ...factory },
    { key: 'fabric', label: '同面料规格历史平均', ...fabric }
  ]

  const selected = candidates.find((item) => item.count > 0) || { key: 'none', label: '暂无历史数据', avg: 0, count: 0 }

  return {
    selected,
    candidates
  }
}

function enrichConsumptionRecord(record = {}) {
  const preset = getLossRatePreset(record.fabric_type)
  const lossRate = resolveLossRate(record.fabric_type, record.loss_rate)
  const patternConsumption = Number(record.pattern_consumption || 0)
  const estimatedSingleConsumption = round(patternConsumption * (1 + lossRate), 6)
  const orderQty = Number(record.order_qty || 0)
  const orderMaterialQty = round(estimatedSingleConsumption * orderQty * 1.02, 4)
  const actualOutputQty = Number(record.actual_output_qty || 0)
  const actualMaterialQty = Number(record.actual_material_qty || 0)
  const actualSingleConsumption = actualOutputQty > 0 && actualMaterialQty > 0
    ? round(actualMaterialQty / actualOutputQty, 6)
    : 0
  const deviationRate = estimatedSingleConsumption > 0 && actualSingleConsumption > 0
    ? round((actualSingleConsumption - estimatedSingleConsumption) / estimatedSingleConsumption, 6)
    : 0
  const warningLevel = !actualSingleConsumption ? 'pending' : (deviationRate > 0.05 ? 'warning' : 'normal')
  const suggestion = buildConsumptionSuggestion(record)

  return {
    ...record,
    fabric_type: preset.type,
    loss_rate: lossRate,
    loss_rate_min: preset.min,
    loss_rate_max: preset.max,
    loss_rate_recommended: preset.recommended,
    estimated_single_consumption: estimatedSingleConsumption,
    order_material_qty: orderMaterialQty,
    actual_single_consumption: actualSingleConsumption,
    deviation_rate: deviationRate,
    warning_level: warningLevel,
    suggested_single_consumption: suggestion.selected.avg,
    suggestion_source: suggestion.selected.key,
    suggestion_source_label: suggestion.selected.label,
    suggestion_history_count: suggestion.selected.count,
    dimension_suggestions: suggestion.candidates
  }
}

function getConsumptionRecords() {
  const rows = db.prepare(`
    SELECT
      id,
      style_code,
      factory_name,
      fabric_type,
      gram_weight,
      width,
      pattern_consumption,
      loss_rate,
      order_qty,
      actual_output_qty,
      actual_material_qty,
      remark,
      created_at
    FROM consumption_records
    ORDER BY created_at DESC, id DESC
  `).all()

  return rows.map(enrichConsumptionRecord)
}

function saveConsumptionRecord(payload = {}) {
  const styleCode = cleanText(payload.style_code)
  if (!styleCode) throw new Error('请填写款号')

  const patternConsumption = Number(payload.pattern_consumption || 0)
  if (!patternConsumption) throw new Error('请填写版师单耗')

  const orderQty = Number(payload.order_qty || 0)
  if (!orderQty) throw new Error('请填写下单数量')

  const actualOutputQty = payload.actual_output_qty === '' || payload.actual_output_qty === null || payload.actual_output_qty === undefined
    ? null
    : Number(payload.actual_output_qty || 0)
  const actualMaterialQty = payload.actual_material_qty === '' || payload.actual_material_qty === null || payload.actual_material_qty === undefined
    ? null
    : Number(payload.actual_material_qty || 0)

  if (actualMaterialQty && !actualOutputQty) {
    throw new Error('填写实际用料时，请同时填写实际产出数量')
  }

  const data = {
    style_code: styleCode,
    factory_name: cleanText(payload.factory_name),
    fabric_type: normalizeFabricType(payload.fabric_type),
    gram_weight: Number(payload.gram_weight || 0) || null,
    width: Number(payload.width || 0) || null,
    pattern_consumption: patternConsumption,
    loss_rate: resolveLossRate(payload.fabric_type, payload.loss_rate),
    order_qty: orderQty,
    actual_output_qty: actualOutputQty,
    actual_material_qty: actualMaterialQty,
    remark: cleanText(payload.remark)
  }

  if (payload.id) {
    db.prepare(`
      UPDATE consumption_records
      SET
        style_code=@style_code,
        factory_name=@factory_name,
        fabric_type=@fabric_type,
        gram_weight=@gram_weight,
        width=@width,
        pattern_consumption=@pattern_consumption,
        loss_rate=@loss_rate,
        order_qty=@order_qty,
        actual_output_qty=@actual_output_qty,
        actual_material_qty=@actual_material_qty,
        remark=@remark
      WHERE id=@id
    `).run({ ...data, id: Number(payload.id) })
    return Number(payload.id)
  }

  return normalizeInsertId(db.prepare(`
    INSERT INTO consumption_records (
      style_code,
      factory_name,
      fabric_type,
      gram_weight,
      width,
      pattern_consumption,
      loss_rate,
      order_qty,
      actual_output_qty,
      actual_material_qty,
      remark
    ) VALUES (
      @style_code,
      @factory_name,
      @fabric_type,
      @gram_weight,
      @width,
      @pattern_consumption,
      @loss_rate,
      @order_qty,
      @actual_output_qty,
      @actual_material_qty,
      @remark
    )
  `).run(data).lastInsertRowid)
}

function normalizeProductionStatus(value) {
  const status = cleanText(value)
  if (['待生产', '生产中', '已完成'].includes(status)) return status
  return '待生产'
}

function getProductionStageBaseQty(order = {}) {
  const status = normalizeProductionStatus(order.status)
  const actualOutputQty = Number(order.actual_output_qty || 0)
  const cutOutputQty = Number(order.cut_output_qty || 0)
  if (status === '已完成' && actualOutputQty > 0) return actualOutputQty
  if (status === '生产中' && cutOutputQty > 0) return cutOutputQty
  if (actualOutputQty > 0) return actualOutputQty
  if (cutOutputQty > 0) return cutOutputQty
  return Number(order.quantity || 0)
}

function getProductionStageSizeBreakdown(order = {}) {
  const status = normalizeProductionStatus(order.status)
  const planned = normalizeSizeBreakdownList(order.size_breakdown)
  const cut = normalizeSizeBreakdownList(order.cut_size_breakdown)
  const actual = normalizeSizeBreakdownList(order.actual_size_breakdown)

  if (status === '已完成' && actual.length) return actual
  if (status === '已完成' && cut.length) return cut
  if (status === '生产中' && cut.length) return cut
  if (actual.length) return actual
  if (cut.length) return cut
  return planned
}

function getProductionCutLossRate(order = {}) {
  const cutOutputQty = Number(order.cut_output_qty || 0)
  const actualOutputQty = Number(order.actual_output_qty || 0)
  if (cutOutputQty <= 0 || actualOutputQty <= 0) return null
  return round((cutOutputQty - actualOutputQty) / cutOutputQty, 6)
}

function recalculateOrder(orderId, returnMode = 'detail') {
  const order = db.prepare(`
    SELECT id, order_no, document_status, garment_id, quantity, status, factory_name, cut_output_qty, cut_size_breakdown, actual_output_qty, actual_size_breakdown, process_fee
    FROM production_orders
    WHERE id=?
  `).get(orderId)
  if (!order) throw new Error('生产单不存在')

  const garment = getGarmentById(order.garment_id)
  const bomItems = getProductionPlanItems(orderId)
  if (!garment) throw new Error('成衣资料不存在')
  if (!bomItems.length) throw new Error('该成衣尚未维护原料 BOM')

  const previousAllocations = db.prepare(`
    SELECT batch_id, allocated_qty, material_id, material_code, material_name, material_color, material_unit
    FROM production_order_materials
    WHERE order_id=?
  `).all(orderId)

  const restoreBatch = db.prepare(`
    UPDATE purchase_batches
    SET remaining_qty = remaining_qty + @allocated_qty
    WHERE id = @batch_id
  `)
  previousAllocations.forEach((row) => restoreBatch.run(row))
  db.prepare('DELETE FROM production_order_materials WHERE order_id=?').run(orderId)

  const approvedBatchCatalog = getApprovedBatchInventoryEntries()
  const consumeBatch = db.prepare(`
    UPDATE purchase_batches
    SET remaining_qty = remaining_qty - @qty
    WHERE id = @batch_id
  `)
  const insertAllocation = db.prepare(`
    INSERT INTO production_order_materials (
      order_id,
      garment_id,
      material_id,
      batch_id,
      material_name,
      material_code,
      material_unit,
      material_role,
      material_color,
      material_size,
      usage_per_piece,
      usage_input_unit,
      usage_converted_per_piece,
      loss_rate,
      usage_mode,
      supply_mode,
      processing_requirements,
      required_qty,
      actual_issued_qty,
      actual_roll_count,
      actual_issued_unit,
      actual_total_amount,
      allocated_qty,
      consumed_qty,
      unit_cost,
      line_cost,
      cost_price_type,
      price_source_label
    ) VALUES (
      @order_id,
      @garment_id,
      @material_id,
      @batch_id,
      @material_name,
      @material_code,
      @material_unit,
      @material_role,
      @material_color,
      @material_size,
      @usage_per_piece,
      @usage_input_unit,
      @usage_converted_per_piece,
      @loss_rate,
      @usage_mode,
      @supply_mode,
      @processing_requirements,
      @required_qty,
      @actual_issued_qty,
      @actual_roll_count,
      @actual_issued_unit,
      @actual_total_amount,
      @allocated_qty,
      @consumed_qty,
      @unit_cost,
      @line_cost,
      @cost_price_type,
      @price_source_label
    )
  `)
  const newAllocatedRows = []

  const materialSummaries = []
  let totalMaterialCost = 0
  const actualOutputQty = Number(order.actual_output_qty || 0)
  const cutOutputQty = Number(order.cut_output_qty || 0)
  const stageBaseQty = getProductionStageBaseQty(order)
  const stageSizeBreakdown = getProductionStageSizeBreakdown(order)
  const currentFactoryName = cleanText(order.factory_name)
  const shouldEnforceInventory = ['approved'].includes(normalizeDocumentStatus(order.document_status))
    && ['生产中', '已完成'].includes(String(order.status || ''))

  for (const bom of bomItems) {
    const usageMode = normalizeUsageMode(bom.usage_mode, bom)
    const supplyMode = cleanText(bom.supply_mode) || 'our_supply'
    const actualIssuedQty = Number(bom.actual_issued_qty || 0)
    const actualTotalAmount = Number(bom.actual_total_amount || 0)
    const selectedUnitCost = Number(bom.current_unit_cost || 0)
    const bomSizeBreakdown = normalizeSizeBreakdownList(bom.material_size_breakdown).filter((item) => Number(item.qty || 0) > 0)
    const sizeBreakdown = bomSizeBreakdown.length
      ? bomSizeBreakdown
          .map((item) => ({
            size: cleanText(item.size),
            qty: Number(item.qty || 0)
          }))
          .filter((item) => Number(item.qty || 0) > 0)
      : []
    const breakdownTotalQty = sizeBreakdown.reduce((sum, item) => sum + Number(item.qty || 0), 0)
    const allocationSegments = sizeBreakdown.length
      ? sizeBreakdown.map((item) => ({
          size: cleanText(item.size),
          base_qty: Number(item.qty || 0),
          ratio: breakdownTotalQty > 0 ? Number(item.qty || 0) / breakdownTotalQty : 0
        }))
      : [{ size: '', base_qty: stageBaseQty, ratio: 1 }]
    const usesSizeActualUsage = sizeBreakdown.length > 0 && String(bom.material_category || '').includes('胸杯')

    let consumedQty = 0
    let lineCost = 0
    let totalRequiredQty = 0
    let displayIssuedQty = 0
    const totalActualCostQty = Number(bom.actual_cost_qty || 0)

    if (supplyMode === 'factory_supply') {
      for (const segment of allocationSegments) {
        const segmentRequiredQty = round(Number(segment.base_qty || 0) * Number(bom.usage_in_material_unit || 0) * (1 + Number(bom.loss_rate || 0)), 4)
        const segmentFallbackQty = round(Number(segment.base_qty || 0) * Number(bom.usage_in_material_unit || 0), 4)
        const hasActualUsage = usesSizeActualUsage || totalActualCostQty > 0 || actualIssuedQty > 0
        const segmentIssuedQty = hasActualUsage
          ? (usesSizeActualUsage
              ? round(Number(segment.base_qty || 0), 4)
              : round(actualIssuedQty * Number(segment.ratio || 0), 4))
          : segmentFallbackQty
        const segmentConsumedQty = hasActualUsage
          ? (usesSizeActualUsage
              ? round(Number(segment.base_qty || 0), 4)
              : totalActualCostQty > 0
                ? round(totalActualCostQty * Number(segment.ratio || 0), 4)
                : usageMode === 'full_cut'
                  ? segmentIssuedQty
                  : round(Number(segment.base_qty || 0) * Number(bom.usage_in_material_unit || 0), 4))
          : segmentFallbackQty
        const segmentCostQty = actualTotalAmount > 0
          ? 0
          : totalActualCostQty > 0
            ? round(totalActualCostQty * Number(segment.ratio || 0), 4)
            : usesSizeActualUsage
              ? round(Number(segment.base_qty || 0), 4)
              : segmentFallbackQty
        const segmentLineCost = actualTotalAmount > 0
          ? round(actualTotalAmount * Number(segment.ratio || 0), 4)
          : round(segmentCostQty * Number(selectedUnitCost || 0), 4)
        insertAllocation.run({
          order_id: orderId,
          garment_id: order.garment_id,
          material_id: bom.material_id,
          batch_id: null,
          material_name: bom.material_name,
          material_code: bom.material_code,
          material_unit: bom.material_unit,
          material_role: bom.material_role,
          material_color: cleanText(bom.material_color),
          material_size: cleanText(segment.size),
          usage_per_piece: bom.usage,
          usage_input_unit: bom.usage_unit,
          usage_converted_per_piece: bom.usage_in_material_unit,
          loss_rate: bom.loss_rate,
          usage_mode: usageMode,
          supply_mode: supplyMode,
          processing_requirements: safeJsonStringify(normalizeStringList(bom.processing_requirements), '[]'),
          required_qty: segmentRequiredQty,
          actual_issued_qty: segmentIssuedQty,
          actual_roll_count: Number(bom.actual_roll_count || 0),
          actual_issued_unit: bom.actual_issued_unit || bom.material_unit,
          actual_total_amount: segmentLineCost,
          allocated_qty: 0,
          consumed_qty: segmentConsumedQty,
          unit_cost: selectedUnitCost,
          line_cost: segmentLineCost,
          cost_price_type: bom.cost_price_type,
          price_source_label: getPriceTypeLabel(bom.cost_price_type)
        })
        totalRequiredQty = round(totalRequiredQty + segmentRequiredQty, 4)
        displayIssuedQty = round(displayIssuedQty + segmentIssuedQty, 4)
        consumedQty = round(consumedQty + segmentConsumedQty, 4)
        lineCost = round(lineCost + segmentLineCost, 4)
      }
    } else {
      for (const segment of allocationSegments) {
        const segmentRequiredQty = round(Number(segment.base_qty || 0) * Number(bom.usage_in_material_unit || 0) * (1 + Number(bom.loss_rate || 0)), 4)
        const segmentFallbackQty = round(Number(segment.base_qty || 0) * Number(bom.usage_in_material_unit || 0), 4)
        const hasActualUsage = usesSizeActualUsage || totalActualCostQty > 0 || actualIssuedQty > 0
        const segmentIssuedQty = hasActualUsage
          ? (usesSizeActualUsage
              ? round(Number(segment.base_qty || 0), 4)
              : round(actualIssuedQty * Number(segment.ratio || 0), 4))
          : segmentFallbackQty
        const segmentConsumedTargetQty = hasActualUsage
          ? (usesSizeActualUsage
              ? round(Number(segment.base_qty || 0), 4)
              : totalActualCostQty > 0
                ? round(totalActualCostQty * Number(segment.ratio || 0), 4)
                : usageMode === 'full_cut'
                  ? segmentIssuedQty
                  : round(Number(segment.base_qty || 0) * Number(bom.usage_in_material_unit || 0), 4))
          : segmentFallbackQty
        const segmentAllocationTargetQty = usesSizeActualUsage
          ? segmentIssuedQty
          : hasActualUsage
            ? (usageMode === 'full_cut' ? segmentIssuedQty : segmentConsumedTargetQty)
            : usageMode === 'full_cut'
              ? segmentIssuedQty
              : Math.max(segmentIssuedQty, segmentConsumedTargetQty, segmentFallbackQty)

        if (!shouldEnforceInventory) {
          const segmentCostQty = actualTotalAmount > 0
            ? 0
            : totalActualCostQty > 0
              ? round(totalActualCostQty * Number(segment.ratio || 0), 4)
              : usesSizeActualUsage
                ? round(Number(segment.base_qty || 0), 4)
                : segmentFallbackQty
          const draftLineCost = actualTotalAmount > 0
            ? round(actualTotalAmount * Number(segment.ratio || 0), 4)
            : round(segmentCostQty * Number(selectedUnitCost || 0), 4)
          insertAllocation.run({
            order_id: orderId,
            garment_id: order.garment_id,
            material_id: bom.material_id,
            batch_id: null,
            material_name: bom.material_name,
            material_code: bom.material_code,
            material_unit: bom.material_unit,
            material_role: bom.material_role,
            material_color: cleanText(bom.material_color),
            material_size: cleanText(segment.size),
            usage_per_piece: bom.usage,
            usage_input_unit: bom.usage_unit,
            usage_converted_per_piece: bom.usage_in_material_unit,
            loss_rate: bom.loss_rate,
            usage_mode: usageMode,
            supply_mode: supplyMode,
            processing_requirements: safeJsonStringify(normalizeStringList(bom.processing_requirements), '[]'),
            required_qty: segmentRequiredQty,
            actual_issued_qty: segmentIssuedQty,
            actual_roll_count: Number(bom.actual_roll_count || 0),
            actual_issued_unit: bom.actual_issued_unit || bom.material_unit,
            actual_total_amount: draftLineCost,
            allocated_qty: 0,
            consumed_qty: segmentConsumedTargetQty,
            unit_cost: selectedUnitCost,
            line_cost: draftLineCost,
            cost_price_type: bom.cost_price_type,
            price_source_label: getPriceTypeLabel(bom.cost_price_type)
          })
          totalRequiredQty = round(totalRequiredQty + segmentRequiredQty, 4)
          displayIssuedQty = round(displayIssuedQty + segmentIssuedQty, 4)
          consumedQty = round(consumedQty + segmentConsumedTargetQty, 4)
          lineCost = round(lineCost + draftLineCost, 4)
          continue
        }

        const formatBomInventoryLabel = () => {
          const code = cleanText(bom.material_code)
          const name = cleanText(bom.material_name)
          const color = cleanText(bom.material_color)
          const size = cleanText(segment.size)
          const parts = []
          if (code) parts.push(code)
          if (name && name !== code) parts.push(name)
          if (color) parts.push(color)
          if (size) parts.push(size)
          return parts.join(' / ') || `ID:${bom.material_id}`
        }

        let remainingNeed = segmentAllocationTargetQty
        let remainingConsumedNeed = segmentConsumedTargetQty
        const demand = {
          material_id: bom.material_id,
          material_code: bom.material_code,
          material_name: bom.material_name,
          material_unit: bom.material_unit,
          color: normalizeInventoryColor(bom.material_color),
          size: normalizeInventorySize(segment.size)
        }
        const batches = listMatchingInventoryBatches(approvedBatchCatalog, demand)
          .filter((batch) => Number(batch.remaining_qty || 0) > 0.0001)

        if (!batches.length) {
          const availableColors = uniqueNonEmpty(
            db.prepare(`
              SELECT DISTINCT COALESCE(NULLIF(TRIM(color), ''), '未分色') AS color
              FROM purchase_batches
              WHERE material_id=?
                AND LOWER(TRIM(COALESCE(document_status, 'draft'))) = 'approved'
                AND remaining_qty > 0
              ORDER BY color ASC
            `).all(bom.material_id).map((row) => row.color)
          )
          const availableSizes = uniqueNonEmpty(
            db.prepare(`
              SELECT DISTINCT COALESCE(NULLIF(TRIM(size), ''), '未分码') AS size
              FROM purchase_batches
              WHERE material_id=?
                AND LOWER(TRIM(COALESCE(document_status, 'draft'))) = 'approved'
                AND remaining_qty > 0
              ORDER BY size ASC
            `).all(bom.material_id).map((row) => row.size)
          )
          throw new Error(
            `物料【${formatBomInventoryLabel()}】没有可用采购批次，无法生成生产单`
            + (availableColors.length ? `。当前可用颜色：${availableColors.join(' / ')}` : '')
            + (availableSizes.length ? `。当前可用尺码：${availableSizes.join(' / ')}` : '')
          )
        }

        const totalFactoryAvailable = round(
          batches.reduce((sum, batch) => {
            if (currentFactoryName) {
              const allocation = (batch.allocations || []).find(
                (item) => cleanText(item.factory_name) === currentFactoryName
              )
              return sum + Number(allocation?.remaining_qty || 0)
            }
            return sum + (batch.allocations || []).reduce((innerSum, allocation) => {
              return innerSum + Number(allocation.remaining_qty || 0)
            }, 0)
          }, 0),
          4
        )
        const totalWarehouseAvailable = round(
          batches.reduce((sum, batch) => sum + Number(batch.warehouse_remaining_qty || 0), 0),
          4
        )

        for (const batch of batches) {
          if (remainingNeed <= 0) break
          const allocationSources = []
          const batchFactoryAllocations = currentFactoryName
            ? (batch.allocations || []).filter((item) => cleanText(item.factory_name) === currentFactoryName)
            : (batch.allocations || []).filter((item) => Number(item.remaining_qty || 0) > 0)
          batchFactoryAllocations.forEach((allocation) => {
            if (Number(allocation?.remaining_qty || 0) > 0) {
              allocationSources.push({
                type: 'factory',
                available_qty: Number(allocation.remaining_qty || 0),
                allocation
              })
            }
          })
          if (Number(batch.warehouse_remaining_qty || 0) > 0) {
            allocationSources.push({
              type: 'warehouse',
              available_qty: Number(batch.warehouse_remaining_qty || 0),
              allocation: null
            })
          }

          for (const source of allocationSources) {
            if (remainingNeed <= 0) break
            const qty = round(Math.min(Number(source.available_qty || 0), remainingNeed), 4)
            if (qty <= 0) continue

            const batchUnitCost = Number(batch.base_unit_price || 0)
            const costUnitPrice = Number(selectedUnitCost || 0) || batchUnitCost
            const consumedQtyForBatch = Math.min(qty, Math.max(remainingConsumedNeed, 0))
            const segmentActualAmountShare = actualTotalAmount > 0 ? round(actualTotalAmount * Number(segment.ratio || 0), 4) : 0
            const cost = actualTotalAmount > 0
              ? round(segmentActualAmountShare * (segmentAllocationTargetQty > 0 ? (qty / segmentAllocationTargetQty) : 0), 4)
              : round(consumedQtyForBatch * costUnitPrice, 4)

            consumeBatch.run({ qty, batch_id: batch.id })
            batch.remaining_qty = round(Math.max(Number(batch.remaining_qty || 0) - qty, 0), 4)
            if (source.type === 'factory' && source.allocation) {
              source.allocation.remaining_qty = round(Math.max(Number(source.allocation.remaining_qty || 0) - qty, 0), 4)
              batch.factory_remaining_qty = round(Math.max(Number(batch.factory_remaining_qty || 0) - qty, 0), 4)
            } else {
              batch.warehouse_remaining_qty = round(Math.max(Number(batch.warehouse_remaining_qty || 0) - qty, 0), 4)
            }

            insertAllocation.run({
              order_id: orderId,
              garment_id: order.garment_id,
              material_id: bom.material_id,
              batch_id: batch.id,
              material_name: bom.material_name,
              material_code: bom.material_code,
              material_unit: bom.material_unit,
              material_role: bom.material_role,
              material_color: cleanText(bom.material_color),
              material_size: cleanText(segment.size),
              usage_per_piece: bom.usage,
              usage_input_unit: bom.usage_unit,
              usage_converted_per_piece: bom.usage_in_material_unit,
              loss_rate: bom.loss_rate,
              usage_mode: usageMode,
              supply_mode: supplyMode,
              processing_requirements: safeJsonStringify(normalizeStringList(bom.processing_requirements), '[]'),
              required_qty: segmentRequiredQty,
              actual_issued_qty: segmentIssuedQty,
              actual_roll_count: Number(bom.actual_roll_count || 0),
              actual_issued_unit: bom.actual_issued_unit || bom.material_unit,
              actual_total_amount: cost,
              allocated_qty: qty,
              consumed_qty: consumedQtyForBatch,
              unit_cost: costUnitPrice,
              line_cost: cost,
              cost_price_type: bom.cost_price_type,
              price_source_label: getPriceTypeLabel(bom.cost_price_type)
            })
            newAllocatedRows.push({
              batch_id: batch.id,
              allocated_qty: qty,
              material_id: bom.material_id,
              material_code: bom.material_code,
              material_name: bom.material_name,
              material_color: cleanText(bom.material_color),
              material_size: cleanText(segment.size),
              material_unit: bom.material_unit
            })
            remainingNeed = round(remainingNeed - qty, 4)
            remainingConsumedNeed = round(remainingConsumedNeed - consumedQtyForBatch, 4)
            consumedQty = round(consumedQty + consumedQtyForBatch, 4)
            lineCost = round(lineCost + cost, 4)
          }
        }

        if (remainingNeed > 0) {
          throw new Error(
            `物料【${formatBomInventoryLabel()}】库存不足，当前工厂剩余 ${formatServerQtyWithUnit(totalFactoryAvailable, bom.material_unit)}，`
            + `仓库剩余 ${formatServerQtyWithUnit(totalWarehouseAvailable, bom.material_unit)}，还差 ${formatServerQtyWithUnit(remainingNeed, bom.material_unit)}`
          )
        }

        totalRequiredQty = round(totalRequiredQty + segmentRequiredQty, 4)
        displayIssuedQty = round(displayIssuedQty + segmentIssuedQty, 4)
      }
    }

    totalMaterialCost = round(totalMaterialCost + lineCost, 4)
    materialSummaries.push({
      materialId: bom.material_id,
      materialName: bom.material_name,
      materialCode: bom.material_code,
      materialRole: bom.material_role,
      supplyMode,
      processingRequirements: normalizeStringList(bom.processing_requirements),
      materialSizeBreakdown: normalizeSizeBreakdownList(bom.material_size_breakdown),
      materialColor: cleanText(bom.material_color),
      materialComposition: bom.material_composition || '',
      materialWidth: Number(bom.material_width || 0),
      materialWeight: Number(bom.material_weight || 0),
      materialUnit: bom.material_unit,
      usageMode,
      usageModeLabel: getUsageModeLabel(usageMode, bom),
      usagePerPiece: Number(bom.usage || 0),
      usageUnit: bom.usage_unit,
      usageConvertedPerPiece: Number(bom.usage_in_material_unit || 0),
      materialSizeBreakdown: sizeBreakdown,
      lossRate: Number(bom.loss_rate || 0),
      costPriceType: bom.cost_price_type,
      priceSourceLabel: getPriceTypeLabel(bom.cost_price_type),
      requiredQty: totalRequiredQty,
      actualIssuedQty: displayIssuedQty > 0 ? displayIssuedQty : round(Number(stageBaseQty || 0) * Number(bom.usage_in_material_unit || 0), 4),
      actualIssuedUnit: bom.actual_issued_unit || bom.material_unit,
      consumedQty,
      lineCost,
      actualTotalAmount,
      avgUnitCost: consumedQty > 0 ? round(lineCost / consumedQty, 6) : Number(selectedUnitCost || 0),
      actualUsagePerPiece: 0,
      actualLossRate: 0
    })
  }

  const processBaseQty = stageBaseQty > 0 ? stageBaseQty : Number(order.quantity || 0)
  const totalProcessCost = round(processBaseQty * Number(order.process_fee || 0), 4)
  const totalCost = round(totalMaterialCost + totalProcessCost, 4)
  const unitCost = order.quantity ? round(totalCost / order.quantity, 4) : 0
  const actualUnitCost = processBaseQty ? round(totalCost / processBaseQty, 4) : 0

  if (processBaseQty > 0) {
    materialSummaries.forEach((item) => {
      const actualUsageBaseQty = item.usageMode === 'full_cut'
        ? (Number(item.actualIssuedQty || 0) > 0 ? Number(item.actualIssuedQty || 0) : Number(item.consumedQty || 0))
        : Number(item.consumedQty || 0)
      item.actualUsagePerPiece = round(actualUsageBaseQty / processBaseQty, 6)
      item.actualLossRate = Number(item.usageConvertedPerPiece || 0) > 0
        ? round((item.actualUsagePerPiece - Number(item.usageConvertedPerPiece || 0)) / Number(item.usageConvertedPerPiece || 0), 6)
        : 0
    })
  }

  db.prepare(`
    UPDATE production_orders
    SET
      material_cost = @material_cost,
      process_cost = @process_cost,
      total_cost = @total_cost,
      unit_cost = @unit_cost,
      actual_unit_cost = @actual_unit_cost,
      cut_loss_rate = @cut_loss_rate,
      snapshot_json = @snapshot_json,
      factory_document_json = @factory_document_json
    WHERE id = @id
  `).run({
    id: orderId,
    material_cost: totalMaterialCost,
    process_cost: totalProcessCost,
    total_cost: totalCost,
    unit_cost: unitCost,
    actual_unit_cost: actualUnitCost,
    cut_loss_rate: getProductionCutLossRate(order),
    snapshot_json: JSON.stringify({
      garment,
      status: normalizeProductionStatus(order.status),
      quantity: order.quantity,
      sizeBreakdown: order.size_breakdown || '',
      cutOutputQty: cutOutputQty || null,
      cutSizeBreakdown: order.cut_size_breakdown || '',
      actualOutputQty: actualOutputQty || null,
      actualSizeBreakdown: order.actual_size_breakdown || '',
      stageBaseQty: processBaseQty,
      processFee: order.process_fee,
      materials: materialSummaries
    }),
    factory_document_json: JSON.stringify({
      garment,
      status: normalizeProductionStatus(order.status),
      quantity: order.quantity,
      sizeBreakdown: order.size_breakdown || '',
      cutOutputQty: cutOutputQty || null,
      cutSizeBreakdown: order.cut_size_breakdown || '',
      actualOutputQty: actualOutputQty || null,
      actualSizeBreakdown: order.actual_size_breakdown || '',
      materials: materialSummaries.map((item) => ({
        materialId: item.materialId,
        materialCode: item.materialCode,
        materialName: item.materialName,
        materialRole: item.materialRole,
        supplyMode: item.supplyMode,
        processingRequirements: item.processingRequirements,
        materialSizeBreakdown: item.materialSizeBreakdown,
        materialColor: item.materialColor,
        materialComposition: item.materialComposition,
        materialWidth: item.materialWidth,
        materialWeight: item.materialWeight,
        usageMode: item.usageMode,
        usageModeLabel: item.usageModeLabel,
        usagePerPiece: item.usagePerPiece,
        usageUnit: item.usageUnit,
        usageConvertedPerPiece: item.usageConvertedPerPiece,
        materialUnit: item.materialUnit,
        lossRate: item.lossRate,
        requiredQty: item.requiredQty,
        actualIssuedQty: item.actualIssuedQty,
        actualIssuedUnit: item.actualIssuedUnit,
        actualTotalAmount: item.actualTotalAmount,
        priceSourceLabel: item.priceSourceLabel
      }))
    })
  })

  const oldMap = new Map()
  previousAllocations
    .filter((item) => Number(item.batch_id || 0))
    .forEach((item) => {
      const key = Number(item.batch_id)
      const current = oldMap.get(key) || {
        batch_id: key,
        allocated_qty: 0,
        material_id: item.material_id,
        material_code: item.material_code,
        material_name: item.material_name,
        material_color: cleanText(item.material_color),
        material_unit: item.material_unit
      }
      current.allocated_qty = round(current.allocated_qty + Number(item.allocated_qty || 0), 6)
      oldMap.set(key, current)
    })

  const newMap = new Map()
  newAllocatedRows.forEach((item) => {
    const key = Number(item.batch_id)
    const current = newMap.get(key) || { ...item, allocated_qty: 0 }
    current.allocated_qty = round(current.allocated_qty + Number(item.allocated_qty || 0), 6)
    newMap.set(key, current)
  })

  const touchedBatchIds = [...new Set([...oldMap.keys(), ...newMap.keys()])]
  touchedBatchIds.forEach((batchId) => {
    const previous = oldMap.get(batchId)?.allocated_qty || 0
    const current = newMap.get(batchId)?.allocated_qty || 0
    const delta = round(current - previous, 6)
    if (Math.abs(delta) <= 0.0001) return

    const meta = newMap.get(batchId) || oldMap.get(batchId) || {}
    const batchRow = db.prepare(`
      SELECT batch_no, remaining_qty, unit, document_status
      FROM purchase_batches
      WHERE id=?
    `).get(batchId)
    logInventoryMovement({
      movement_type: delta > 0 ? '生产领用' : '生产回冲',
      direction: delta > 0 ? 'out' : 'in',
      material_id: meta.material_id,
      batch_id: batchId,
      material_code: meta.material_code,
      material_name: meta.material_name,
      color: meta.material_color,
      qty: Math.abs(delta),
      unit: meta.material_unit || batchRow?.unit,
      balance_after: Number(batchRow?.remaining_qty || 0),
      source_table: 'production_orders',
      source_id: order.id,
      source_no: order.order_no,
      document_status: order.document_status,
      remark: `生产单 ${order.order_no} 重算库存分配`
    })
  })

  if (returnMode === 'none') return null
  if (returnMode === 'snapshot') return getProductionOrderStatusSnapshot(orderId)
  return getProductionOrderById(orderId)
}

function getProductionOrderById(orderId) {
  const order = db.prepare(`
    SELECT
      po.*,
      g.style_code,
      g.name AS garment_name,
      g.image_path,
      g.category AS garment_category
    FROM production_orders po
    JOIN garments g ON g.id = po.garment_id
    WHERE po.id=?
  `).get(orderId)

  if (!order) return null

  const materials = db.prepare(`
    SELECT
      pom.*,
      pb.batch_no,
      pb.received_at
    FROM production_order_materials pom
    LEFT JOIN purchase_batches pb ON pb.id = pom.batch_id
    WHERE pom.order_id=?
    ORDER BY pom.id ASC
  `).all(orderId)

  const planItems = getProductionPlanItems(orderId)

  return {
    ...order,
    review_images: normalizeImageList(order.review_images_json),
    snapshot: safeJsonParse(order.snapshot_json, null),
    factoryDocument: safeJsonParse(order.factory_document_json, null),
    planItems,
    materials
  }
}

function refreshAllProductionOrderCosts() {
  const rows = db.prepare(`
    SELECT id
    FROM production_orders
    ORDER BY date(created_at) ASC, id ASC
  `).all()

  const safeRecalculate = db.transaction((id) => recalculateOrder(id, 'none'))
  const errors = []
  rows.forEach((row) => {
    try {
      safeRecalculate(row.id)
    } catch (error) {
      errors.push({
        id: row.id,
        message: error.message || '生产单重算失败'
      })
    }
  })
  return errors
}

let lastProductionOrderRefreshAt = 0
let productionOrdersNeedRefresh = true

function markProductionOrdersDirty() {
  productionOrdersNeedRefresh = true
}

function refreshProductionOrdersIfNeeded(force = false) {
  if (!force) return
  const now = Date.now()
  if (!productionOrdersNeedRefresh && now - lastProductionOrderRefreshAt <= 300000) return
  try {
    refreshAllProductionOrderCosts()
    lastProductionOrderRefreshAt = now
    productionOrdersNeedRefresh = false
  } catch {}
}

function getProductionOrders(params = {}) {
  refreshProductionOrdersIfNeeded(false)
  const keyword = cleanText(params.keyword).toLowerCase()
  const factoryName = cleanText(params.factory_name)
  const status = cleanText(params.status)
  const documentStatus = cleanText(params.document_status)
  const dateFrom = cleanText(params.date_from)
  const dateTo = cleanText(params.date_to)
  const onlyWarnings = Boolean(params.only_warnings)
  const lossThresholdPercent = Number(params.loss_threshold_percent || 0)
  const limit = Math.max(100, Math.min(Number(params.limit || 600), 2000))
  const whereClauses = []
  const queryParams = []

  if (keyword) {
    whereClauses.push(`(
      LOWER(COALESCE(po.order_no, '')) LIKE ?
      OR LOWER(COALESCE(g.style_code, '')) LIKE ?
      OR LOWER(COALESCE(g.name, '')) LIKE ?
      OR LOWER(COALESCE(po.factory_name, '')) LIKE ?
      OR LOWER(COALESCE(po.remark, '')) LIKE ?
    )`)
    const likeValue = `%${keyword}%`
    queryParams.push(likeValue, likeValue, likeValue, likeValue, likeValue)
  }
  if (factoryName) {
    whereClauses.push(`TRIM(COALESCE(po.factory_name, '')) = ?`)
    queryParams.push(factoryName)
  }
  if (status) {
    whereClauses.push(`TRIM(COALESCE(po.status, '')) = ?`)
    queryParams.push(status)
  }
  if (documentStatus) {
    whereClauses.push(`TRIM(COALESCE(po.document_status, '')) = ?`)
    queryParams.push(documentStatus)
  }
  if (dateFrom) {
    whereClauses.push(`date(COALESCE(NULLIF(po.delivery_date, ''), substr(po.created_at, 1, 10))) >= date(?)`)
    queryParams.push(dateFrom)
  }
  if (dateTo) {
    whereClauses.push(`date(COALESCE(NULLIF(po.delivery_date, ''), substr(po.created_at, 1, 10))) <= date(?)`)
    queryParams.push(dateTo)
  }
  if (onlyWarnings) {
    whereClauses.push(`COALESCE(po.cut_loss_rate, 0) > ?`)
    queryParams.push(lossThresholdPercent / 100)
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const cacheKey = `productionOrders:list:${JSON.stringify({ keyword, factoryName, status, documentStatus, dateFrom, dateTo, onlyWarnings, lossThresholdPercent, limit })}`

  return getCachedQueryResult(cacheKey, () => db.prepare(`
    SELECT
      po.id,
      po.order_no,
      po.garment_id,
      po.factory_name,
      po.quantity,
      po.cut_output_qty,
      po.cut_size_breakdown,
      po.actual_output_qty,
      po.actual_size_breakdown,
      po.cut_loss_rate,
      po.process_fee,
      po.material_cost,
      po.process_cost,
      po.total_cost,
      po.unit_cost,
      po.actual_unit_cost,
      po.status,
      po.pending_date,
      po.cut_date,
      po.completed_date,
      po.document_status,
      po.delivery_date,
      po.size_breakdown,
      po.created_at,
      g.style_code,
      g.name AS garment_name
    FROM production_orders po
    JOIN garments g ON g.id = po.garment_id
    ${whereSql}
    ORDER BY po.created_at DESC, po.id DESC
    LIMIT ${limit}
  `).all(...queryParams), 5000)
}

function getPurchaseOrderDocumentByBatchId(batchId) {
  const seedBatch = db.prepare(`
    SELECT
      pb.*,
      m.code AS material_code,
      m.name AS material_name,
      m.category AS material_category,
      m.image_path AS material_image_path,
      m.unit AS material_unit,
      m.width AS material_width,
      m.weight AS material_weight,
      m.meter_per_kg AS material_meter_per_kg,
      m.custom_conversion_from_qty AS material_custom_conversion_from_qty,
      m.custom_conversion_from_unit AS material_custom_conversion_from_unit,
      m.custom_conversion_to_qty AS material_custom_conversion_to_qty,
      m.custom_conversion_to_unit AS material_custom_conversion_to_unit
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE pb.id=?
  `).get(batchId)

  if (!seedBatch) return null

  const scope = buildPurchaseDocumentScope(seedBatch)
  const baseSelect = `
      SELECT
        pb.*,
        m.code AS material_code,
        m.name AS material_name,
        m.image_path AS material_image_path,
        m.category AS material_category,
        m.size_price_json AS material_size_price_json,
        m.unit AS material_unit,
        m.width AS material_width,
        m.weight AS material_weight,
        m.meter_per_kg AS material_meter_per_kg,
        m.custom_conversion_from_qty AS material_custom_conversion_from_qty,
        m.custom_conversion_from_unit AS material_custom_conversion_from_unit,
        m.custom_conversion_to_qty AS material_custom_conversion_to_qty,
        m.custom_conversion_to_unit AS material_custom_conversion_to_unit
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
  `
  const rows = scope.mergeGroupId
    ? db.prepare(`
        ${baseSelect}
        WHERE TRIM(COALESCE(pb.merge_group_id, '')) = ?
        ORDER BY pb.id ASC
      `).all(scope.mergeGroupId)
    : (scope.purchaseOrderNo
      ? db.prepare(`
          ${baseSelect}
          WHERE pb.purchase_order_no=?
            AND TRIM(COALESCE(pb.supplier, '')) = ?
          ORDER BY pb.id ASC
        `).all(scope.purchaseOrderNo, scope.supplier)
      : [seedBatch])

  const supplier = cleanText(rows.find((item) => cleanText(item.supplier))?.supplier || '')
  const receivedAt = cleanText(rows.find((item) => cleanText(item.received_at))?.received_at || '')
  const totalAmount = round(
    rows.reduce((sum, item) => sum + (resolvePurchasePricedQty(item, {
      unit: item.material_unit || item.unit,
      width: item.material_width,
      weight: item.material_weight,
      meter_per_kg: item.material_meter_per_kg,
      custom_conversion_from_qty: item.material_custom_conversion_from_qty,
      custom_conversion_from_unit: item.material_custom_conversion_from_unit,
      custom_conversion_to_qty: item.material_custom_conversion_to_qty,
      custom_conversion_to_unit: item.material_custom_conversion_to_unit,
      name: item.material_name,
      code: item.material_code
    }) * Number(item.price || 0) + Number(item.processing_cost || 0) + Number(item.rounding_adjustment || 0)), 0),
    2
  )

  const goodsAmount = round(
    rows.reduce((sum, item) => sum + (resolvePurchasePricedQty(item, {
      unit: item.material_unit || item.unit,
      width: item.material_width,
      weight: item.material_weight,
      meter_per_kg: item.material_meter_per_kg,
      custom_conversion_from_qty: item.material_custom_conversion_from_qty,
      custom_conversion_from_unit: item.material_custom_conversion_from_unit,
      custom_conversion_to_qty: item.material_custom_conversion_to_qty,
      custom_conversion_to_unit: item.material_custom_conversion_to_unit,
      name: item.material_name,
      code: item.material_code
    }) * Number(item.price || 0)), 0),
    2
  )
  const processingAmount = round(rows.reduce((sum, item) => sum + Number(item.processing_cost || 0), 0), 2)
  const roundingAdjustment = round(rows.reduce((sum, item) => sum + Number(item.rounding_adjustment || 0), 0), 2)

  return {
    purchaseOrderNo: scope.purchaseOrderNo || seedBatch.batch_no,
    supplier,
    receivedAt,
    remark: cleanText(rows.find((item) => cleanText(item.remark))?.remark || ''),
    items: rows.map((item, index) => ({
      ...item,
      seqNo: index + 1,
      display_qty: Number(item.purchase_input_qty || item.gross_qty || 0),
      display_unit: cleanText(item.purchase_input_unit || item.price_unit || item.unit || ''),
      display_size: cleanText(item.size),
      total_amount: round(resolvePurchasePricedQty(item, {
        unit: item.material_unit || item.unit,
        width: item.material_width,
        weight: item.material_weight,
        meter_per_kg: item.material_meter_per_kg,
        custom_conversion_from_qty: item.material_custom_conversion_from_qty,
        custom_conversion_from_unit: item.material_custom_conversion_from_unit,
        custom_conversion_to_qty: item.material_custom_conversion_to_qty,
        custom_conversion_to_unit: item.material_custom_conversion_to_unit,
        name: item.material_name,
        code: item.material_code
      }) * Number(item.price || 0) + Number(item.processing_cost || 0) + Number(item.rounding_adjustment || 0), 4),
      goods_amount: round(resolvePurchasePricedQty(item, {
        unit: item.material_unit || item.unit,
        width: item.material_width,
        weight: item.material_weight,
        meter_per_kg: item.material_meter_per_kg,
        custom_conversion_from_qty: item.material_custom_conversion_from_qty,
        custom_conversion_from_unit: item.material_custom_conversion_from_unit,
        custom_conversion_to_qty: item.material_custom_conversion_to_qty,
        custom_conversion_to_unit: item.material_custom_conversion_to_unit,
        name: item.material_name,
        code: item.material_code
      }) * Number(item.price || 0), 4),
      priceTypeLabel: getPriceTypeLabel(item.price_type)
    })),
    totalAmount,
    goodsAmount,
    processingAmount,
    roundingAdjustment
  }
}

function getPurchaseOrderDocumentsByBatchIds(batchIds = []) {
  const ids = [...new Set((batchIds || []).map((item) => Number(item)).filter(Boolean))]
  if (!ids.length) return []

  const seeds = ids
    .map((id) => db.prepare('SELECT id, batch_no, purchase_order_no, supplier, merge_group_id FROM purchase_batches WHERE id=?').get(id))
    .filter(Boolean)

  const seen = new Set()
  const documents = []
  for (const seed of seeds) {
    const scope = buildPurchaseDocumentScope(seed)
    const groupKey = scope.mergeGroupId
      ? `merge:${scope.mergeGroupId}`
      : (scope.purchaseOrderNo ? `${scope.supplier}::${scope.purchaseOrderNo}` : `batch:${seed.id}`)
    if (seen.has(groupKey)) continue
    seen.add(groupKey)
    const document = getPurchaseOrderDocumentByBatchId(seed.id)
    if (document) documents.push(document)
  }
  return documents
}

function createOrUpdateProductionOrder(payload) {
  const quantity = Number(payload.quantity || 0)
  if (!payload.garment_id) throw new Error('请选择成衣')
  if (!quantity) throw new Error('生产数量必须大于 0')

  const planItems = buildProductionPlanRows(payload.materials || [])
  if (!planItems.length) throw new Error('请至少填写一条生产用料')

  const data = {
    garment_id: Number(payload.garment_id),
    order_no: payload.order_no,
    document_status: normalizeDocumentStatus(payload.document_status),
    review_images_json: safeJsonStringify(
      compressStoredImageList(payload.review_images || payload.review_images_json, { maxEdge: 2400, quality: 90, minLength: 500 * 1024 }),
      '[]'
    ),
    factory_name: cleanText(payload.factory_name),
    quantity,
    size_breakdown: cleanText(payload.size_breakdown),
    cut_size_breakdown: cleanText(payload.cut_size_breakdown),
    actual_size_breakdown: cleanText(payload.actual_size_breakdown),
    cut_output_qty: payload.cut_output_qty === '' || payload.cut_output_qty === null || payload.cut_output_qty === undefined
      ? null
      : Number(payload.cut_output_qty || 0),
    actual_output_qty: payload.actual_output_qty === '' || payload.actual_output_qty === null || payload.actual_output_qty === undefined
      ? null
      : Number(payload.actual_output_qty || 0),
    process_fee: Number(payload.process_fee || 0),
    status: normalizeProductionStatus(payload.status),
    pending_date: cleanText(payload.pending_date),
    cut_date: cleanText(payload.cut_date),
    completed_date: cleanText(payload.completed_date),
    delivery_date: payload.delivery_date || '',
    remark: payload.remark || ''
  }

  seedOptionValue('factory', data.factory_name)

  const saveTx = db.transaction((targetPayload, targetData, targetPlanItems) => {
    if (targetPayload.id) {
      const before = getProductionOrderById(Number(targetPayload.id))
      if (normalizeDocumentStatus(before?.document_status) === 'approved') {
        throw new Error('已审核生产单据不能编辑')
      }
      if (targetData.review_images_json === '[]' && before?.review_images_json) {
        targetData.review_images_json = before.review_images_json
      }
      db.prepare(`
        UPDATE production_orders
        SET
          order_no=@order_no,
          document_status=@document_status,
          review_images_json=@review_images_json,
          garment_id=@garment_id,
          factory_name=@factory_name,
          quantity=@quantity,
          size_breakdown=@size_breakdown,
          cut_size_breakdown=@cut_size_breakdown,
          actual_size_breakdown=@actual_size_breakdown,
          cut_output_qty=@cut_output_qty,
          actual_output_qty=@actual_output_qty,
          process_fee=@process_fee,
          status=@status,
          pending_date=@pending_date,
          cut_date=@cut_date,
          completed_date=@completed_date,
          delivery_date=@delivery_date,
          remark=@remark
        WHERE id=@id
      `).run({ ...targetData, id: Number(targetPayload.id) })
      saveProductionPlanItems(Number(targetPayload.id), targetPlanItems)
      const saved = recalculateOrder(Number(targetPayload.id))
      logAudit('生产制单', '编辑生产单', 'production_order', Number(targetPayload.id), cleanText(saved?.order_no || targetData.order_no), before, saved)
      return saved
    }

    const result = db.prepare(`
      INSERT INTO production_orders (
        order_no,
        document_status,
        review_images_json,
        garment_id,
        factory_name,
        quantity,
        size_breakdown,
        cut_size_breakdown,
        actual_size_breakdown,
        cut_output_qty,
        actual_output_qty,
        process_fee,
        material_cost,
        process_cost,
        total_cost,
        unit_cost,
        actual_unit_cost,
        status,
        pending_date,
        cut_date,
        completed_date,
        delivery_date,
        remark,
        snapshot_json,
        factory_document_json
      ) VALUES (
        @order_no,
        @document_status,
        @review_images_json,
        @garment_id,
        @factory_name,
        @quantity,
        @size_breakdown,
        @cut_size_breakdown,
        @actual_size_breakdown,
        @cut_output_qty,
        @actual_output_qty,
        @process_fee,
        0,
        0,
        0,
        0,
        0,
        @status,
        @pending_date,
        @cut_date,
        @completed_date,
        @delivery_date,
        @remark,
        '',
        ''
      )
    `).run(targetData)
    const orderId = normalizeInsertId(result.lastInsertRowid)
    saveProductionPlanItems(orderId, targetPlanItems)
    const saved = recalculateOrder(orderId)
    logAudit('生产制单', '新增生产单', 'production_order', orderId, cleanText(saved?.order_no || targetData.order_no), null, saved)
    return saved
  })

  return saveTx(payload, data, planItems)
}
function deleteProductionOrder(orderId) {
  const before = getProductionOrderById(orderId)
  if (before && normalizeDocumentStatus(before.document_status) === 'approved') {
    throw new Error('已审核生产单据不能删除')
  }
  const allocations = db.prepare(`
    SELECT batch_id, allocated_qty
    FROM production_order_materials
    WHERE order_id=?
  `).all(orderId)

  const restoreBatch = db.prepare(`
    UPDATE purchase_batches
    SET remaining_qty = remaining_qty + @allocated_qty
    WHERE id = @batch_id
  `)
  allocations.forEach((row) => {
    restoreBatch.run(row)
    if (Number(row.batch_id || 0)) {
      const batchRow = db.prepare(`
        SELECT pb.batch_no, pb.remaining_qty, pb.unit, pb.color, m.code AS material_code, m.name AS material_name, pb.material_id
        FROM purchase_batches pb
        JOIN materials m ON m.id = pb.material_id
        WHERE pb.id=?
      `).get(row.batch_id)
      if (batchRow) {
        logInventoryMovement({
          movement_type: '删除生产单回冲',
          direction: 'in',
          material_id: batchRow.material_id,
          batch_id: row.batch_id,
          material_code: batchRow.material_code,
          material_name: batchRow.material_name,
          color: batchRow.color,
          qty: Number(row.allocated_qty || 0),
          unit: batchRow.unit,
          balance_after: batchRow.remaining_qty,
          source_table: 'production_orders',
          source_id: orderId,
          source_no: before?.order_no,
          document_status: before?.document_status,
          remark: '删除生产单后回冲库存'
        })
      }
    }
  })

  db.prepare('DELETE FROM production_order_plan_items WHERE order_id=?').run(orderId)
  db.prepare('DELETE FROM production_order_materials WHERE order_id=?').run(orderId)
  db.prepare('DELETE FROM production_orders WHERE id=?').run(orderId)
  logAudit('生产制单', '删除生产单', 'production_order', Number(orderId), cleanText(before?.order_no), before, null)
}

if (!workspaceReadOnly) {
db.exec(`
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  style_code TEXT DEFAULT '',
  name TEXT NOT NULL,
  image_path TEXT DEFAULT '',
  major_category TEXT DEFAULT '',
  category TEXT DEFAULT '',
  sub_category TEXT DEFAULT '',
  leaf_category TEXT DEFAULT '',
  composition TEXT DEFAULT '',
  color TEXT DEFAULT '',
  width REAL DEFAULT NULL,
  weight REAL DEFAULT NULL,
  meter_per_kg REAL DEFAULT NULL,
  adjustment_type TEXT DEFAULT 'none',
  left_gap REAL DEFAULT 0,
  right_gap REAL DEFAULT 0,
  gap_reference_qty REAL DEFAULT 0,
  gap_ratio REAL DEFAULT 1,
  custom_formula TEXT DEFAULT '',
  custom_conversion_from_qty REAL DEFAULT 0,
  custom_conversion_from_unit TEXT DEFAULT '',
  custom_conversion_to_qty REAL DEFAULT 0,
  custom_conversion_to_unit TEXT DEFAULT '',
  unit TEXT DEFAULT '米',
  default_price REAL DEFAULT 0,
  default_price_unit TEXT DEFAULT '',
  size_price_json TEXT DEFAULT '[]',
  supplier TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS garments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  style_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  image_path TEXT DEFAULT '',
  category TEXT DEFAULT '',
  process_fee REAL DEFAULT 0,
  factory_process_fee_json TEXT DEFAULT '[]',
  markup_rate REAL DEFAULT 0,
  remark TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS boms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  garment_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  usage REAL NOT NULL DEFAULT 0,
  usage_unit TEXT DEFAULT '米',
  loss_rate REAL DEFAULT 0,
  material_role TEXT DEFAULT '辅料',
  material_color TEXT DEFAULT '',
  usage_mode TEXT DEFAULT 'by_usage',
  supply_mode TEXT DEFAULT 'our_supply',
  processing_requirements TEXT DEFAULT '[]',
  cost_price_type TEXT DEFAULT 'bulk',
  FOREIGN KEY(garment_id) REFERENCES garments(id),
  FOREIGN KEY(material_id) REFERENCES materials(id)
);

CREATE TABLE IF NOT EXISTS material_color_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  color TEXT NOT NULL,
  default_price REAL DEFAULT 0,
  default_price_unit TEXT DEFAULT '',
  size_price_json TEXT DEFAULT '[]',
  sample_price_meter REAL DEFAULT 0,
  sample_price_kg REAL DEFAULT 0,
  sample_price_yard REAL DEFAULT 0,
  net_price_meter REAL DEFAULT 0,
  bulk_price_kg REAL DEFAULT 0,
  bulk_price_meter REAL DEFAULT 0,
  bulk_price_yard REAL DEFAULT 0,
  remark TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(material_id, color),
  FOREIGN KEY(material_id) REFERENCES materials(id)
);

CREATE TABLE IF NOT EXISTS purchase_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_no TEXT UNIQUE NOT NULL,
  document_status TEXT DEFAULT 'draft',
  review_images_json TEXT DEFAULT '[]',
  purchase_order_no TEXT DEFAULT '',
  material_id INTEGER NOT NULL,
  supplier TEXT DEFAULT '',
  warehouse_name TEXT DEFAULT '主仓库',
  color TEXT DEFAULT '',
  color_remark TEXT DEFAULT '',
  size TEXT DEFAULT '',
  parent_batch_id INTEGER DEFAULT NULL,
  source_batch_no TEXT DEFAULT '',
  roll_count REAL NOT NULL DEFAULT 0,
  purchase_input_qty REAL NOT NULL DEFAULT 0,
  purchase_input_unit TEXT DEFAULT '',
  actual_input_qty REAL NOT NULL DEFAULT 0,
  actual_input_unit TEXT DEFAULT '',
  gross_qty REAL NOT NULL DEFAULT 0,
  remaining_qty REAL NOT NULL DEFAULT 0,
  unit TEXT DEFAULT '米',
  price REAL NOT NULL DEFAULT 0,
  price_unit TEXT DEFAULT '',
  price_type TEXT DEFAULT 'bulk',
  raw_unit_price REAL NOT NULL DEFAULT 0,
  base_unit_price REAL NOT NULL DEFAULT 0,
  processing_cost REAL NOT NULL DEFAULT 0,
  processing_cost_per_unit REAL NOT NULL DEFAULT 0,
  processing_note TEXT DEFAULT '',
  factory_name TEXT DEFAULT '',
  factory_allocated_qty REAL NOT NULL DEFAULT 0,
  adjustment_type TEXT DEFAULT 'none',
  left_gap REAL DEFAULT 0,
  right_gap REAL DEFAULT 0,
  gap_ratio REAL DEFAULT 1,
  custom_formula TEXT DEFAULT '',
  effective_unit_price REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  rounding_adjustment REAL NOT NULL DEFAULT 0,
  received_at TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(material_id) REFERENCES materials(id)
);

CREATE TABLE IF NOT EXISTS purchase_batch_factory_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_batch_id INTEGER NOT NULL,
  factory_name TEXT DEFAULT '',
  allocated_qty REAL NOT NULL DEFAULT 0,
  allocated_roll_count REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(purchase_batch_id) REFERENCES purchase_batches(id)
);

CREATE TABLE IF NOT EXISTS purchase_batch_after_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_batch_id INTEGER NOT NULL,
  type TEXT DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  unit TEXT DEFAULT '',
  warehouse_name TEXT DEFAULT '主仓库',
  in_batch_id INTEGER DEFAULT NULL,
  in_batch_no TEXT DEFAULT '',
  in_qty REAL NOT NULL DEFAULT 0,
  in_unit TEXT DEFAULT '',
  in_warehouse_name TEXT DEFAULT '主仓库',
  in_color TEXT DEFAULT '',
  in_size TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(purchase_batch_id) REFERENCES purchase_batches(id)
);

CREATE TABLE IF NOT EXISTS production_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  document_status TEXT DEFAULT 'draft',
  review_images_json TEXT DEFAULT '[]',
  garment_id INTEGER NOT NULL,
  factory_name TEXT DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0,
  size_breakdown TEXT DEFAULT '',
  cut_size_breakdown TEXT DEFAULT '',
  actual_size_breakdown TEXT DEFAULT '',
  cut_output_qty REAL DEFAULT NULL,
  actual_output_qty REAL DEFAULT NULL,
  process_fee REAL DEFAULT 0,
  material_cost REAL DEFAULT 0,
  process_cost REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  actual_unit_cost REAL DEFAULT 0,
  cut_loss_rate REAL DEFAULT NULL,
  status TEXT DEFAULT '待生产',
  pending_date TEXT DEFAULT '',
  cut_date TEXT DEFAULT '',
  completed_date TEXT DEFAULT '',
  delivery_date TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  snapshot_json TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(garment_id) REFERENCES garments(id)
);

CREATE TABLE IF NOT EXISTS production_order_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  garment_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  usage REAL NOT NULL DEFAULT 0,
  usage_unit TEXT DEFAULT '米',
  usage_in_material_unit REAL DEFAULT 0,
  loss_rate REAL DEFAULT 0,
  material_role TEXT DEFAULT '辅料',
  material_color TEXT DEFAULT '',
  usage_mode TEXT DEFAULT 'by_usage',
  supply_mode TEXT DEFAULT 'our_supply',
  processing_requirements TEXT DEFAULT '[]',
  material_size_breakdown TEXT DEFAULT '[]',
  actual_issued_qty REAL DEFAULT 0,
  actual_roll_count REAL DEFAULT 0,
  actual_issued_unit TEXT DEFAULT '',
  actual_total_amount REAL DEFAULT 0,
  cost_price_type TEXT DEFAULT 'bulk',
  current_unit_cost REAL DEFAULT 0,
  current_unit_cost_per_meter REAL DEFAULT 0,
  FOREIGN KEY(order_id) REFERENCES production_orders(id),
  FOREIGN KEY(material_id) REFERENCES materials(id)
);

CREATE TABLE IF NOT EXISTS production_order_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  garment_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  batch_id INTEGER NOT NULL,
  material_name TEXT DEFAULT '',
  material_code TEXT DEFAULT '',
  material_unit TEXT DEFAULT '',
  material_role TEXT DEFAULT '辅料',
  material_color TEXT DEFAULT '',
  material_size TEXT DEFAULT '',
  usage_per_piece REAL DEFAULT 0,
  usage_input_unit TEXT DEFAULT '米',
  usage_converted_per_piece REAL DEFAULT 0,
  loss_rate REAL DEFAULT 0,
  usage_mode TEXT DEFAULT 'by_usage',
  supply_mode TEXT DEFAULT 'our_supply',
  processing_requirements TEXT DEFAULT '[]',
  required_qty REAL DEFAULT 0,
  actual_issued_qty REAL DEFAULT 0,
  actual_roll_count REAL DEFAULT 0,
  actual_issued_unit TEXT DEFAULT '',
  actual_total_amount REAL DEFAULT 0,
  allocated_qty REAL DEFAULT 0,
  consumed_qty REAL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  line_cost REAL DEFAULT 0,
  cost_price_type TEXT DEFAULT 'bulk',
  price_source_label TEXT DEFAULT '',
  FOREIGN KEY(order_id) REFERENCES production_orders(id),
  FOREIGN KEY(batch_id) REFERENCES purchase_batches(id)
);

CREATE TABLE IF NOT EXISTS consumption_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  style_code TEXT NOT NULL,
  factory_name TEXT DEFAULT '',
  fabric_type TEXT DEFAULT '针织',
  gram_weight REAL DEFAULT NULL,
  width REAL DEFAULT NULL,
  pattern_consumption REAL NOT NULL DEFAULT 0,
  loss_rate REAL NOT NULL DEFAULT 0,
  order_qty REAL NOT NULL DEFAULT 0,
  actual_output_qty REAL DEFAULT NULL,
  actual_material_qty REAL DEFAULT NULL,
  remark TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS option_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(type, value)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  permissions_json TEXT DEFAULT '[]',
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_type TEXT DEFAULT '',
  direction TEXT DEFAULT '',
  material_id INTEGER DEFAULT NULL,
  batch_id INTEGER DEFAULT NULL,
  material_code TEXT DEFAULT '',
  material_name TEXT DEFAULT '',
  color TEXT DEFAULT '',
  qty REAL DEFAULT 0,
  unit TEXT DEFAULT '米',
  balance_after REAL DEFAULT 0,
  source_table TEXT DEFAULT '',
  source_id INTEGER DEFAULT NULL,
  source_no TEXT DEFAULT '',
  document_status TEXT DEFAULT '草稿',
  operator_username TEXT DEFAULT '',
  operator_name TEXT DEFAULT '',
  client_name TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT DEFAULT '',
  action TEXT DEFAULT '',
  entity_type TEXT DEFAULT '',
  entity_id INTEGER DEFAULT NULL,
  entity_label TEXT DEFAULT '',
  before_json TEXT DEFAULT '',
  after_json TEXT DEFAULT '',
  operator_username TEXT DEFAULT '',
  operator_name TEXT DEFAULT '',
  client_name TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_cleared_rows (
  material_id INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (material_id, color, size, supplier)
);

CREATE TABLE IF NOT EXISTS inventory_cleared_batches (
  batch_id INTEGER PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`)

ensureColumn('materials', 'color', "TEXT DEFAULT ''")
ensureColumn('materials', 'style_code', "TEXT DEFAULT ''")
ensureColumn('materials', 'image_path', "TEXT DEFAULT ''")
ensureColumn('materials', 'major_category', "TEXT DEFAULT ''")
ensureColumn('materials', 'sub_category', "TEXT DEFAULT ''")
ensureColumn('materials', 'leaf_category', "TEXT DEFAULT ''")
ensureColumn('materials', 'composition', "TEXT DEFAULT ''")
ensureColumn('materials', 'width', 'REAL DEFAULT NULL')
ensureColumn('materials', 'weight', 'REAL DEFAULT NULL')
ensureColumn('materials', 'meter_per_kg', 'REAL DEFAULT NULL')
ensureColumn('materials', 'adjustment_type', "TEXT DEFAULT 'none'")
ensureColumn('materials', 'left_gap', 'REAL DEFAULT 0')
ensureColumn('materials', 'right_gap', 'REAL DEFAULT 0')
ensureColumn('materials', 'gap_reference_qty', 'REAL DEFAULT 0')
ensureColumn('materials', 'gap_ratio', 'REAL DEFAULT 1')
ensureColumn('materials', 'custom_formula', "TEXT DEFAULT ''")
ensureColumn('materials', 'custom_conversion_from_qty', 'REAL DEFAULT 0')
ensureColumn('materials', 'custom_conversion_from_unit', "TEXT DEFAULT ''")
ensureColumn('materials', 'custom_conversion_to_qty', 'REAL DEFAULT 0')
ensureColumn('materials', 'custom_conversion_to_unit', "TEXT DEFAULT ''")
ensureColumn('materials', 'default_price', 'REAL DEFAULT 0')
ensureColumn('materials', 'default_price_unit', "TEXT DEFAULT ''")
ensureColumn('materials', 'size_price_json', "TEXT DEFAULT '[]'")
ensureColumn('materials', 'sort_order', 'INTEGER DEFAULT 0')
ensureColumn('garments', 'process_fee', 'REAL DEFAULT 0')
ensureColumn('garments', 'factory_process_fee_json', "TEXT DEFAULT '[]'")
ensureColumn('garments', 'markup_rate', 'REAL DEFAULT 0')
ensureColumn('garments', 'sort_order', 'INTEGER DEFAULT 0')
ensureColumn('boms', 'sort_order', 'INTEGER DEFAULT 0')
ensureColumn('boms', 'usage_unit', "TEXT DEFAULT '米'")
ensureColumn('material_color_prices', 'sort_order', 'INTEGER DEFAULT 0')
ensureColumn('material_color_prices', 'default_price', 'REAL DEFAULT 0')
ensureColumn('material_color_prices', 'default_price_unit', "TEXT DEFAULT ''")
ensureColumn('material_color_prices', 'size_price_json', "TEXT DEFAULT '[]'")
ensureColumn('material_color_prices', 'sample_price_yard', 'REAL DEFAULT 0')
ensureColumn('material_color_prices', 'sample_price_kg', 'REAL DEFAULT 0')
ensureColumn('material_color_prices', 'net_price_meter', 'REAL DEFAULT 0')
ensureColumn('purchase_batches', 'price_unit', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'document_status', "TEXT DEFAULT 'draft'")
ensureColumn('purchase_batches', 'review_images_json', "TEXT DEFAULT '[]'")
ensureColumn('purchase_batches', 'price_type', "TEXT DEFAULT 'bulk'")
ensureColumn('purchase_batches', 'size', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'color_remark', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'raw_unit_price', 'REAL DEFAULT 0')
ensureColumn('purchase_batches', 'base_unit_price', 'REAL DEFAULT 0')
ensureColumn('purchase_batches', 'processing_cost', 'REAL DEFAULT 0')
ensureColumn('purchase_batches', 'processing_cost_per_unit', 'REAL DEFAULT 0')
ensureColumn('purchase_batches', 'processing_note', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'parent_batch_id', 'INTEGER DEFAULT NULL')
ensureColumn('purchase_batches', 'source_batch_no', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'roll_count', 'REAL NOT NULL DEFAULT 0')
ensureColumn('purchase_batches', 'purchase_order_no', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'purchase_input_qty', 'REAL NOT NULL DEFAULT 0')
ensureColumn('purchase_batches', 'purchase_input_unit', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'actual_input_qty', 'REAL NOT NULL DEFAULT 0')
ensureColumn('purchase_batches', 'actual_input_unit', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'warehouse_name', "TEXT DEFAULT '主仓库'")
ensureColumn('purchase_batches', 'factory_name', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'factory_allocated_qty', 'REAL NOT NULL DEFAULT 0')
ensureColumn('purchase_batches', 'rounding_adjustment', 'REAL NOT NULL DEFAULT 0')
ensureColumn('purchase_batches', 'merge_group_id', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'merge_snapshot_json', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP')
runStartupWriteStep('backfill:purchase_batches.updated_at', () => {
  if (hasColumn('purchase_batches', 'updated_at')) {
    db.prepare(`
      UPDATE purchase_batches
      SET updated_at=COALESCE(NULLIF(created_at, ''), CURRENT_TIMESTAMP)
      WHERE updated_at IS NULL OR updated_at=''
    `).run()
  }
})
ensureColumn('purchase_batch_factory_allocations', 'factory_name', "TEXT DEFAULT ''")
ensureColumn('purchase_batch_factory_allocations', 'allocated_qty', 'REAL NOT NULL DEFAULT 0')
ensureColumn('purchase_batch_factory_allocations', 'allocated_roll_count', 'REAL NOT NULL DEFAULT 0')
ensureColumn('purchase_batch_after_sales', 'in_batch_id', 'INTEGER DEFAULT NULL')
ensureColumn('purchase_batch_after_sales', 'in_batch_no', "TEXT DEFAULT ''")
ensureColumn('purchase_batch_after_sales', 'in_qty', 'REAL NOT NULL DEFAULT 0')
ensureColumn('purchase_batch_after_sales', 'in_unit', "TEXT DEFAULT ''")
ensureColumn('purchase_batch_after_sales', 'in_warehouse_name', "TEXT DEFAULT '主仓库'")
ensureColumn('purchase_batch_after_sales', 'in_color', "TEXT DEFAULT ''")
ensureColumn('purchase_batch_after_sales', 'in_size', "TEXT DEFAULT ''")
ensureColumn('production_orders', 'factory_name', "TEXT DEFAULT ''")
ensureColumn('production_orders', 'style_no', "TEXT DEFAULT ''")
ensureColumn('production_orders', 'product_name', "TEXT DEFAULT ''")
ensureColumn('inventory_movements', 'factory_name', "TEXT DEFAULT ''")
ensureColumn('consumption_records', 'factory_name', "TEXT DEFAULT ''")
ensureColumn('purchase_batches', 'left_gap', 'REAL DEFAULT 0')
ensureColumn('purchase_batches', 'right_gap', 'REAL DEFAULT 0')
ensureColumn('purchase_batches', 'gap_ratio', 'REAL DEFAULT 1')
ensureColumn('purchase_batches', 'custom_formula', "TEXT DEFAULT ''")
ensureColumn('boms', 'material_color', "TEXT DEFAULT ''")
ensureColumn('boms', 'usage_mode', "TEXT DEFAULT 'by_usage'")
ensureColumn('boms', 'supply_mode', "TEXT DEFAULT 'our_supply'")
ensureColumn('boms', 'processing_requirements', "TEXT DEFAULT '[]'")
ensureColumn('boms', 'cost_price_type', "TEXT DEFAULT 'bulk'")
ensureColumn('boms', 'material_role', "TEXT DEFAULT '辅料'")
ensureColumn('production_orders', 'document_status', "TEXT DEFAULT 'draft'")
ensureColumn('production_orders', 'review_images_json', "TEXT DEFAULT '[]'")
ensureColumn('production_orders', 'size_breakdown', "TEXT DEFAULT ''")
ensureColumn('production_orders', 'cut_size_breakdown', "TEXT DEFAULT ''")
ensureColumn('production_orders', 'actual_size_breakdown', "TEXT DEFAULT ''")
ensureColumn('production_orders', 'cut_output_qty', 'REAL DEFAULT NULL')
ensureColumn('production_orders', 'actual_output_qty', 'REAL DEFAULT NULL')
ensureColumn('production_orders', 'actual_unit_cost', 'REAL DEFAULT 0')
ensureColumn('production_orders', 'cut_loss_rate', 'REAL DEFAULT NULL')
ensureColumn('production_orders', 'pending_date', "TEXT DEFAULT ''")
ensureColumn('production_orders', 'cut_date', "TEXT DEFAULT ''")
ensureColumn('production_orders', 'completed_date', "TEXT DEFAULT ''")
ensureColumn('production_orders', 'snapshot_json', "TEXT DEFAULT ''")
ensureColumn('production_orders', 'factory_document_json', "TEXT DEFAULT ''")

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_purchase_batch_factory_allocations_batch
  ON purchase_batch_factory_allocations(purchase_batch_id)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_purchase_batch_factory_allocations_factory
  ON purchase_batch_factory_allocations(factory_name)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_purchase_batch_after_sales_batch
  ON purchase_batch_after_sales(purchase_batch_id)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_materials_code
  ON materials(code)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_materials_supplier
  ON materials(supplier)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_materials_major_category
  ON materials(major_category)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_materials_category
  ON materials(category)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_materials_sub_category
  ON materials(sub_category)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_garments_style_code
  ON garments(style_code)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_garments_category
  ON garments(category)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_purchase_batches_material_id
  ON purchase_batches(material_id)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_purchase_batches_supplier
  ON purchase_batches(supplier)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_purchase_batches_document_status
  ON purchase_batches(document_status)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_purchase_batches_received_at
  ON purchase_batches(received_at)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_purchase_batches_purchase_order_no
  ON purchase_batches(purchase_order_no)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_purchase_batches_batch_no
  ON purchase_batches(batch_no)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_production_orders_garment_id
  ON production_orders(garment_id)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_production_orders_factory_name
  ON production_orders(factory_name)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_production_orders_document_status
  ON production_orders(document_status)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_production_orders_status
  ON production_orders(status)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_production_orders_delivery_date
  ON production_orders(delivery_date)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_production_orders_created_at
  ON production_orders(created_at)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_inventory_movements_material_id
  ON inventory_movements(material_id)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at
  ON inventory_movements(created_at)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_inventory_movements_factory_name
  ON inventory_movements(factory_name)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs(created_at)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_audit_logs_module
  ON audit_logs(module)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_audit_logs_operator_username
  ON audit_logs(operator_username)
`).run()

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_inventory_cleared_batches_created_at
  ON inventory_cleared_batches(created_at)
`).run()

runStartupWriteStep('startup:compatibility-bootstrap', () => {
  db.transaction(() => {
    const legacyRows = db.prepare(`
      SELECT id, factory_name, factory_allocated_qty
      FROM purchase_batches
      WHERE TRIM(COALESCE(factory_name, '')) != ''
        AND COALESCE(factory_allocated_qty, 0) > 0
        AND id NOT IN (SELECT purchase_batch_id FROM purchase_batch_factory_allocations)
    `).all()
    const insertLegacy = db.prepare(`
      INSERT INTO purchase_batch_factory_allocations (purchase_batch_id, factory_name, allocated_qty)
      VALUES (?, ?, ?)
    `)
    legacyRows.forEach((row) => {
      insertLegacy.run(Number(row.id), cleanText(row.factory_name), round(Number(row.factory_allocated_qty || 0), 6))
    })
    normalizePurchaseBatchFactoryAllocationStorage()
  })()
  ensureColumn('production_order_plan_items', 'usage_unit', "TEXT DEFAULT '米'")
  ensureColumn('production_order_plan_items', 'usage_in_material_unit', 'REAL DEFAULT 0')
  ensureColumn('production_order_plan_items', 'sort_order', 'INTEGER DEFAULT 0')
  ensureColumn('production_order_plan_items', 'loss_rate', 'REAL DEFAULT 0')
  ensureColumn('production_order_plan_items', 'material_role', "TEXT DEFAULT '辅料'")
  ensureColumn('production_order_plan_items', 'material_color', "TEXT DEFAULT ''")
  ensureColumn('production_order_plan_items', 'usage_mode', "TEXT DEFAULT 'by_usage'")
  ensureColumn('production_order_plan_items', 'supply_mode', "TEXT DEFAULT 'our_supply'")
  ensureColumn('production_order_plan_items', 'processing_requirements', "TEXT DEFAULT '[]'")
  ensureColumn('production_order_plan_items', 'material_size_breakdown', "TEXT DEFAULT '[]'")
  ensureColumn('production_order_plan_items', 'actual_issued_qty', 'REAL DEFAULT 0')
  ensureColumn('production_order_plan_items', 'actual_roll_count', 'REAL DEFAULT 0')
  ensureColumn('production_order_plan_items', 'actual_issued_unit', "TEXT DEFAULT ''")
  ensureColumn('production_order_plan_items', 'actual_total_amount', 'REAL DEFAULT 0')
  ensureColumn('production_order_plan_items', 'cost_price_type', "TEXT DEFAULT 'bulk'")
  ensureColumn('production_order_plan_items', 'current_unit_cost', 'REAL DEFAULT 0')
  ensureColumn('production_order_plan_items', 'current_unit_cost_per_meter', 'REAL DEFAULT 0')
  ensureColumn('production_order_materials', 'usage_input_unit', "TEXT DEFAULT '米'")
  ensureColumn('production_order_materials', 'usage_converted_per_piece', 'REAL DEFAULT 0')
  ensureColumn('production_order_materials', 'material_role', "TEXT DEFAULT '辅料'")
  ensureColumn('production_order_materials', 'material_color', "TEXT DEFAULT ''")
  ensureColumn('production_order_materials', 'usage_mode', "TEXT DEFAULT 'by_usage'")
  ensureColumn('production_order_materials', 'supply_mode', "TEXT DEFAULT 'our_supply'")
  ensureColumn('production_order_materials', 'processing_requirements', "TEXT DEFAULT '[]'")
  ensureColumn('production_order_materials', 'actual_issued_qty', 'REAL DEFAULT 0')
  ensureColumn('production_order_materials', 'actual_roll_count', 'REAL DEFAULT 0')
  ensureColumn('production_order_materials', 'actual_issued_unit', "TEXT DEFAULT ''")
  ensureColumn('production_order_materials', 'actual_total_amount', 'REAL DEFAULT 0')
  ensureColumn('production_order_materials', 'material_size', "TEXT DEFAULT ''")
  ensureColumn('production_order_materials', 'consumed_qty', 'REAL DEFAULT 0')
  ensureColumn('production_order_materials', 'cost_price_type', "TEXT DEFAULT 'bulk'")
  ensureColumn('production_order_materials', 'price_source_label', "TEXT DEFAULT ''")
  ensureColumn('option_values', 'sort_order', 'INTEGER DEFAULT 0')
  ensureColumn('users', 'display_name', "TEXT DEFAULT ''")
  ensureColumn('users', 'role', "TEXT DEFAULT 'user'")
  ensureColumn('users', 'permissions_json', "TEXT DEFAULT '[]'")
  ensureColumn('users', 'enabled', 'INTEGER DEFAULT 1')
  ensureColumn('users', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP')
  runStartupWriteStep('backfill:users.updated_at', () => {
    if (hasColumn('users', 'updated_at')) {
      db.prepare(`
        UPDATE users
        SET updated_at=COALESCE(NULLIF(created_at, ''), CURRENT_TIMESTAMP)
        WHERE updated_at IS NULL OR updated_at=''
      `).run()
    }
  })
  ensureColumn('audit_logs', 'operator_id', 'INTEGER DEFAULT NULL')
  ensureColumn('audit_logs', 'operator_username', "TEXT DEFAULT ''")
  ensureColumn('audit_logs', 'operator_name', "TEXT DEFAULT ''")
  ensureColumn('audit_logs', 'client_name', "TEXT DEFAULT ''")
  ensureColumn('audit_logs', 'remark', "TEXT DEFAULT ''")
  ensureColumn('inventory_cleared_rows', 'size', "TEXT DEFAULT ''")
  ensureColumn('inventory_cleared_rows', 'supplier', "TEXT DEFAULT ''")

  rebuildInventoryClearedRowsTableIfNeeded()
  rebuildInventoryClearedBatchesTableIfNeeded()

  rebuildProductionOrderMaterialsTableIfNeeded()

  db.prepare(`
    UPDATE purchase_batches
    SET raw_unit_price = base_unit_price
    WHERE COALESCE(raw_unit_price, 0) <= 0
  `).run()

  db.prepare(`
    UPDATE purchase_batches
    SET source_batch_no = batch_no
    WHERE source_batch_no IS NULL OR TRIM(source_batch_no)=''
  `).run()

  db.prepare(`
    UPDATE purchase_batches
    SET total_amount = ROUND(gross_qty * base_unit_price, 4)
    WHERE ABS(COALESCE(total_amount, 0) - ROUND(gross_qty * base_unit_price, 4)) > 0.0001
  `).run()

  db.prepare(`
    UPDATE boms
    SET usage_unit=(
      SELECT COALESCE(NULLIF(TRIM(materials.unit), ''), '米')
      FROM materials
      WHERE materials.id=boms.material_id
    )
    WHERE usage_unit IS NULL OR TRIM(usage_unit)=''
  `).run()

  db.prepare(`
    UPDATE boms
    SET usage_unit=(
      SELECT COALESCE(NULLIF(TRIM(materials.unit), ''), boms.usage_unit)
      FROM materials
      WHERE materials.id=boms.material_id
    )
    WHERE TRIM(COALESCE(usage_unit, ''))='米'
      AND material_id IN (
        SELECT id FROM materials
        WHERE TRIM(COALESCE(unit, '')) NOT IN ('', '米', '码', '公斤', '厘米')
      )
  `).run()

  db.prepare(`
    UPDATE boms
    SET usage_mode = CASE
      WHEN material_role='A料' THEN 'full_cut'
      ELSE 'by_usage'
    END
    WHERE usage_mode IS NULL OR TRIM(usage_mode)=''
  `).run()

  db.prepare(`
    UPDATE purchase_batches
    SET price_unit=unit
    WHERE price_unit IS NULL OR TRIM(price_unit)=''
  `).run()

  db.prepare(`
    UPDATE materials
    SET default_price_unit=unit
    WHERE default_price > 0 AND (default_price_unit IS NULL OR TRIM(default_price_unit)='')
  `).run()

  db.prepare(`
    UPDATE purchase_batches
    SET purchase_input_qty = gross_qty
    WHERE COALESCE(purchase_input_qty, 0) = 0
  `).run()

  db.prepare(`
    UPDATE purchase_batches
    SET purchase_input_unit = COALESCE(NULLIF(TRIM(price_unit), ''), unit)
    WHERE purchase_input_unit IS NULL OR TRIM(purchase_input_unit)=''
  `).run()

  db.prepare(`
    UPDATE purchase_batches
    SET warehouse_name='主仓库'
    WHERE warehouse_name IS NULL OR TRIM(warehouse_name)=''
  `).run()

  db.prepare(`
    UPDATE purchase_batches
    SET document_status='draft'
    WHERE document_status IS NULL OR TRIM(document_status)=''
  `).run()

  db.prepare(`
    UPDATE production_orders
    SET document_status='draft'
    WHERE document_status IS NULL OR TRIM(document_status)=''
  `).run()

  db.prepare(`
    UPDATE production_order_plan_items
    SET usage_mode = CASE
      WHEN material_role='A料' THEN 'full_cut'
      ELSE 'by_usage'
    END
    WHERE usage_mode IS NULL OR TRIM(usage_mode)=''
  `).run()

  db.prepare(`
    UPDATE production_order_materials
    SET
      usage_mode = CASE
        WHEN material_role='A料' THEN 'full_cut'
        ELSE 'by_usage'
      END,
      consumed_qty = CASE
        WHEN COALESCE(consumed_qty, 0) > 0 THEN consumed_qty
        ELSE allocated_qty
      END
    WHERE usage_mode IS NULL OR TRIM(usage_mode)='' OR COALESCE(consumed_qty, 0) <= 0
  `).run()

  db.prepare(`UPDATE materials SET sort_order=id WHERE COALESCE(sort_order, 0)=0`).run()
  db.prepare(`UPDATE garments SET sort_order=id WHERE COALESCE(sort_order, 0)=0`).run()
  db.prepare(`UPDATE boms SET sort_order=id WHERE COALESCE(sort_order, 0)=0`).run()
  db.prepare(`UPDATE material_color_prices SET sort_order=id WHERE COALESCE(sort_order, 0)=0`).run()
  db.prepare(`UPDATE production_order_plan_items SET sort_order=id WHERE COALESCE(sort_order, 0)=0`).run()
  db.prepare(`UPDATE option_values SET sort_order=id WHERE COALESCE(sort_order, 0)=0`).run()

  ;['面料', '辅料', '包装', '其他'].forEach((value) => seedOptionValue('material_major_category', value))
  ;['胸杯'].forEach((value) => seedOptionValue('material_category', value))
  ;['米', '码', '公斤', '个', '条', '对'].forEach((value) => seedOptionValue('unit', value))
  ;['A料', 'B料', 'C料', 'D料', '里布', '辅料', '其他'].forEach((value) => seedOptionValue('material_role', value))
  // 已提交单据现在代表预领用状态，不再启动时自动迁移为已审核。
  repairLegacyProductionOrderMaterialCosts()
  seedSuperAdmin()
})
scheduleDeferredStartupMaintenance()
}
setTimeout(() => {
  scheduleBackgroundBackup('startup', 30000)
}, 1200)
setInterval(() => {
  runBackgroundBackup('interval').catch(() => {})
}, 30 * 60 * 1000)

function localDateCode() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function nextSerial(prefix, table, column) {
  const row = db.prepare(`
    SELECT ${column} AS value
    FROM ${table}
    WHERE ${column} LIKE ?
    ORDER BY id DESC
    LIMIT 1
  `).get(`${prefix}%`)
  const lastNumber = row?.value ? Number(String(row.value).slice(prefix.length)) : 0
  return `${prefix}${String(lastNumber + 1).padStart(3, '0')}`
}

function normalizeInsertId(value) {
  return Number(value)
}

const orderNoPrefix = () => `SC${localDateCode()}`
const batchNoPrefix = () => `PC${localDateCode()}`
const purchaseOrderNoPrefix = () => `PO${localDateCode()}`

runStartupWriteStep('repair:legacy-exchange-in-batches', () => {
  const repairedCount = repairLegacyExchangeInBatches()
  if (repairedCount > 0) bumpDataRevision()
})

ipcMain.handle('db:getDashboardStats', () => getDashboardStats())

ipcMain.handle('auth:login', (e, payload = {}) => loginUser(payload))
ipcMain.handle('auth:getUsers', () => getUsers())
ipcMain.handle('auth:saveUser', async (e, payload = {}) => {
  assertWritable('保存账号')
  const result = saveUser(payload)
  await runPostWriteMaintenance().catch(() => {})
  return JSON.parse(JSON.stringify(result))
})
ipcMain.handle('auth:deleteUser', async (e, id) => {
  assertWritable('删除账号')
  const result = deleteUser(id)
  await runPostWriteMaintenance().catch(() => {})
  return Number(result || 0)
})

ipcMain.handle('db:getMaterials', () => getMaterials())

ipcMain.handle('db:addMaterial', (e, payload) => {
  assertWritable('新增物料')
  const storagePayload = compressImagePayloadForStorage(payload, 'image_path', { maxEdge: 2400, quality: 92, minLength: 450 * 1024 })
  const duplicate = findDuplicateMaterial(storagePayload.code)
  if (duplicate) {
    throw new Error(`已存在该物料资料：${cleanText(duplicate.code)} / ${cleanText(duplicate.name)}`)
  }
  seedOptionValue('material_major_category', storagePayload.major_category)
  seedOptionValue('material_category', storagePayload.category)
  seedOptionValue('material_sub_category', storagePayload.sub_category)
  seedOptionValue('material_leaf_category', storagePayload.leaf_category)
  seedOptionValue('supplier', storagePayload.supplier)
  seedOptionValue('unit', storagePayload.unit)
  const result = db.prepare(`
    INSERT INTO materials (
      code, style_code, name, image_path, major_category, category, sub_category, leaf_category, composition, color, width, weight, meter_per_kg,
      adjustment_type, left_gap, right_gap, gap_reference_qty, gap_ratio, custom_formula, custom_conversion_from_qty, custom_conversion_from_unit, custom_conversion_to_qty, custom_conversion_to_unit,
      unit, default_price, default_price_unit, size_price_json, supplier, remark, sort_order
    )
    VALUES (
      @code, @style_code, @name, @image_path, @major_category, @category, @sub_category, @leaf_category, @composition, @color, @width, @weight, @meter_per_kg,
      @adjustment_type, @left_gap, @right_gap, @gap_reference_qty, @gap_ratio, @custom_formula, @custom_conversion_from_qty, @custom_conversion_from_unit, @custom_conversion_to_qty, @custom_conversion_to_unit,
      @unit, @default_price, @default_price_unit, @size_price_json, @supplier, @remark, @sort_order
    )
  `).run({
    ...storagePayload,
    sort_order: nextSortOrder('materials')
  })
  replaceMaterialColorProfiles(result.lastInsertRowid, storagePayload.color_profiles || [])
  const insertedId = normalizeInsertId(result.lastInsertRowid)
  const saved = getMaterialById(insertedId)
  logAudit('物料资料', '新增原料', 'material', insertedId, cleanText(saved?.code || storagePayload.code), null, saved)
  runPostWriteMaintenance().catch(() => {})
  return insertedId
})

ipcMain.handle('db:updateMaterial', (e, payload) => {
  assertWritable('编辑物料')
  const storagePayload = compressImagePayloadForStorage(payload, 'image_path', { maxEdge: 2400, quality: 92, minLength: 450 * 1024 })
  const duplicate = findDuplicateMaterial(storagePayload.code, storagePayload.id)
  if (duplicate) {
    throw new Error(`已存在该物料资料：${cleanText(duplicate.code)} / ${cleanText(duplicate.name)}`)
  }
  const before = getMaterialById(storagePayload.id)
  seedOptionValue('material_major_category', storagePayload.major_category)
  seedOptionValue('material_category', storagePayload.category)
  seedOptionValue('material_sub_category', storagePayload.sub_category)
  seedOptionValue('material_leaf_category', storagePayload.leaf_category)
  seedOptionValue('supplier', storagePayload.supplier)
  seedOptionValue('unit', storagePayload.unit)
  const changes = db.prepare(`
    UPDATE materials
    SET
      code=@code,
      style_code=@style_code,
      name=@name,
      image_path=@image_path,
      major_category=@major_category,
      category=@category,
      sub_category=@sub_category,
      leaf_category=@leaf_category,
      composition=@composition,
      color=@color,
      width=@width,
      weight=@weight,
      meter_per_kg=@meter_per_kg,
      adjustment_type=@adjustment_type,
      left_gap=@left_gap,
      right_gap=@right_gap,
      gap_reference_qty=@gap_reference_qty,
      gap_ratio=@gap_ratio,
      custom_formula=@custom_formula,
      custom_conversion_from_qty=@custom_conversion_from_qty,
      custom_conversion_from_unit=@custom_conversion_from_unit,
      custom_conversion_to_qty=@custom_conversion_to_qty,
      custom_conversion_to_unit=@custom_conversion_to_unit,
      unit=@unit,
      default_price=@default_price,
      default_price_unit=@default_price_unit,
      size_price_json=@size_price_json,
      supplier=@supplier,
      remark=@remark
    WHERE id=@id
  `).run(storagePayload).changes
  replaceMaterialColorProfiles(storagePayload.id, storagePayload.color_profiles || [])
  const after = getMaterialById(storagePayload.id)
  if (after) {
    db.prepare(`
      UPDATE production_order_materials
      SET material_code=?,
          material_name=?,
          material_unit=?
      WHERE material_id=?
    `).run(
      cleanText(after.code),
      cleanText(after.name),
      normalizeUnit(after.unit || ''),
      Number(storagePayload.id)
    )

    db.prepare(`
      UPDATE inventory_movements
      SET material_code=?,
          material_name=?
      WHERE material_id=?
    `).run(
      cleanText(after.code),
      cleanText(after.name),
      Number(storagePayload.id)
    )
  }
  logAudit('物料资料', '编辑原料', 'material', Number(storagePayload.id), cleanText(after?.code || storagePayload.code), before, after)
  runPostWriteMaintenance().catch(() => {})
  return changes
})

ipcMain.handle('db:deleteMaterial', (e, id) => {
  assertWritable('删除物料')
  const before = getMaterialById(id)
  const batches = db.prepare('SELECT COUNT(*) AS c FROM purchase_batches WHERE material_id=?').get(id).c
  const bomRefs = db.prepare('SELECT COUNT(*) AS c FROM boms WHERE material_id=?').get(id).c
  if (batches || bomRefs) throw new Error('该物料已有采购批次或 BOM 引用，暂不能删除')
  db.prepare('DELETE FROM material_color_prices WHERE material_id=?').run(id)
  const changes = db.prepare('DELETE FROM materials WHERE id=?').run(id).changes
  if (changes) {
    logAudit('物料资料', '删除原料', 'material', Number(id), cleanText(before?.code), before, null)
    runPostWriteMaintenance().catch(() => {})
  }
  return changes
})

ipcMain.handle('db:getGarments', () => getGarments())

ipcMain.handle('db:addGarment', (e, payload) => {
  assertWritable('新增成衣')
  const storagePayload = compressImagePayloadForStorage(payload, 'image_path', { maxEdge: 2400, quality: 92, minLength: 450 * 1024 })
  seedOptionValue('garment_category', storagePayload.category)
  storagePayload.factory_process_fee_json = safeJsonStringify(
    normalizeGarmentFactoryProcessFees(storagePayload.factory_process_fees),
    '[]'
  )
  const insertedId = normalizeInsertId(db.prepare(`
    INSERT INTO garments (style_code, name, image_path, category, process_fee, factory_process_fee_json, markup_rate, remark, sort_order)
    VALUES (@style_code, @name, @image_path, @category, @process_fee, @factory_process_fee_json, @markup_rate, @remark, @sort_order)
  `).run({
    ...storagePayload,
    sort_order: nextSortOrder('garments')
  }).lastInsertRowid)
  bumpDataRevision()
  return insertedId
})

ipcMain.handle('db:updateGarment', (e, payload) => {
  assertWritable('编辑成衣')
  const storagePayload = compressImagePayloadForStorage(payload, 'image_path', { maxEdge: 2400, quality: 92, minLength: 450 * 1024 })
  seedOptionValue('garment_category', storagePayload.category)
  storagePayload.factory_process_fee_json = safeJsonStringify(
    normalizeGarmentFactoryProcessFees(storagePayload.factory_process_fees),
    '[]'
  )
  const changes = db.prepare(`
    UPDATE garments
    SET
      style_code=@style_code,
      name=@name,
      image_path=@image_path,
      category=@category,
      process_fee=@process_fee,
      factory_process_fee_json=@factory_process_fee_json,
      markup_rate=@markup_rate,
      remark=@remark
    WHERE id=@id
  `).run(storagePayload).changes
  if (changes) bumpDataRevision()
  return changes
})

ipcMain.handle('db:deleteGarment', (e, id) => {
  assertWritable('删除成衣')
  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM production_orders WHERE garment_id=?').get(id).c
  if (orderCount) throw new Error('该成衣已有生产单，暂不能删除')
  db.prepare('DELETE FROM boms WHERE garment_id=?').run(id)
  return db.prepare('DELETE FROM garments WHERE id=?').run(id).changes
})

ipcMain.handle('db:batchUpdateGarmentMarkup', (e, payload = {}) => {
  assertWritable('批量同步成衣上浮')
  const ids = [...new Set((payload.ids || []).map((item) => Number(item)).filter(Boolean))]
  const markupRate = Math.max(Number(payload.markup_rate || 0), 0)
  if (!ids.length) return 0

  const update = db.prepare('UPDATE garments SET markup_rate=? WHERE id=?')
  const tx = db.transaction((targetIds) => {
    targetIds.forEach((id) => update.run(markupRate, id))
  })
  tx(ids)
  return ids.length
})

ipcMain.handle('db:batchUpdatePurchaseBatchDocumentStatus', (e, payload = {}) => {
  assertWritable('批量修改采购单据状态')
  const ids = [...new Set((payload.ids || []).map((item) => Number(item)).filter(Boolean))]
  const documentStatus = normalizeDocumentStatus(payload.document_status)
  if (!ids.length) return 0

  const update = db.prepare('UPDATE purchase_batches SET document_status=? WHERE id=?')
  const select = db.prepare(`
    SELECT pb.*, m.code AS material_code, m.name AS material_name
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE pb.id=?
  `)
  const tx = db.transaction((targetIds) => {
    targetIds.forEach((id) => {
      const before = select.get(id)
      if (!before) return
      if (normalizeDocumentStatus(before.document_status) === 'approved') {
        throw new Error(`采购批次【${cleanText(before.batch_no)}】已审核，不能再修改单据状态`)
      }
      update.run(documentStatus, id)
      const after = select.get(id)
      logAudit('采购批次', '批量修改单据状态', 'purchase_batch', id, cleanText(after?.batch_no), before, after)
    })
  })
  tx(ids)
  runPostWriteMaintenance().catch(() => {})
  return ids.length
})

ipcMain.handle('db:approvePurchaseBatches', (e, payload = {}) => {
  assertWritable('审核采购批次')
  const ids = [...new Set((payload.ids || []).map((item) => Number(item)).filter(Boolean))]
  const reviewImages = normalizeReviewImagesForStorage(payload.review_images || payload.review_images_json)
  const reviewImagesJson = safeJsonStringify(reviewImages, '[]')
  const allocationMap = new Map(
    (Array.isArray(payload.allocations) ? payload.allocations : [])
      .map((item) => ({
        id: Number(item?.id || 0),
        factory_name: cleanText(item?.factory_name),
        factory_allocated_qty: Number(item?.factory_allocated_qty || 0),
        factory_allocated_roll_count: Number(item?.factory_allocated_roll_count || 0),
        factory_allocated_unit: normalizeUnit(item?.factory_allocated_unit || ''),
        allocations: Array.isArray(item?.allocations) ? item.allocations : []
      }))
      .filter((item) => item.id)
      .map((item) => [item.id, item])
  )
  if (!ids.length) return 0
  if (!reviewImages.length) {
    throw new Error('审核采购单时请先上传采购单或收货单图片')
  }

  const update = db.prepare(`
    UPDATE purchase_batches
    SET document_status=?, review_images_json=?, factory_name=?, factory_allocated_qty=?, warehouse_name=?
    WHERE id=?
  `)
  const select = db.prepare(`
    SELECT pb.*, m.code AS material_code, m.name AS material_name
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE pb.id=?
  `)
  const tx = db.transaction((targetIds) => {
    targetIds.forEach((id) => {
      const before = select.get(id)
      if (!before) return
      if (normalizeDocumentStatus(before.document_status) === 'approved') return
      const material = getMaterialById(before.material_id)
      const allocation = allocationMap.get(id)
      let allocationRows = getPurchaseBatchAllocations(id)
      let factoryName = allocationRows.map((item) => cleanText(item.factory_name)).filter(Boolean).join('、') || cleanText(before.factory_name)
      let factoryAllocatedQty = allocationRows.reduce((sum, item) => sum + Number(item.allocated_qty || 0), 0) || Number(before.factory_allocated_qty || 0)
      const warehouseName = cleanText(allocation?.warehouse_name || before.warehouse_name) || '主仓库'

      if (allocation) {
        const targetUnit = normalizeUnit(before.unit || material?.unit)
        const actualInputQty = Number(before.actual_input_qty || before.purchase_input_qty || before.gross_qty || 0)
        const actualInputUnit = normalizeUnit(before.actual_input_unit || before.purchase_input_unit || targetUnit)
        const batchRollCount = Math.max(Number(before.roll_count || 0), 0)
        const normalizedAllocations = (Array.isArray(allocation.allocations) && allocation.allocations.length
          ? allocation.allocations
          : [{
              factory_name: allocation.factory_name,
              factory_allocated_qty: allocation.factory_allocated_qty,
              factory_allocated_roll_count: allocation.factory_allocated_roll_count,
              factory_allocated_unit: allocation.factory_allocated_unit
            }]
        ).map((item) => ({
          factory_name: cleanText(item?.factory_name),
          factory_allocated_qty: Number(item?.factory_allocated_qty || 0),
          factory_allocated_roll_count: Number(item?.factory_allocated_roll_count || 0),
          factory_allocated_unit: normalizeUnit(item?.factory_allocated_unit || actualInputUnit)
        })).filter((item) => item.factory_name || Number(item.factory_allocated_qty || 0) > 0 || Number(item.factory_allocated_roll_count || 0) > 0)

        let totalInputAllocatedQty = 0
        let totalAllocatedRollCount = 0
        const nextAllocations = normalizedAllocations.map((item) => {
          if (!item.factory_name && Number(item.factory_allocated_qty || 0) > 0) {
            throw new Error(`采购批次【${cleanText(before.batch_no)}】填写了发往工厂数量，请先选择工厂`)
          }
          if (!item.factory_name || (Number(item.factory_allocated_qty || 0) <= 0 && Number(item.factory_allocated_roll_count || 0) <= 0)) return null
          totalInputAllocatedQty += Number(item.factory_allocated_qty || 0)
          totalAllocatedRollCount += Number(item.factory_allocated_roll_count || 0)
          const manualAllocatedQty = round(Number(convertQuantity(item.factory_allocated_qty, item.factory_allocated_unit || actualInputUnit, targetUnit, material) || 0), 6)
          const allocationDraft = {
            allocated_qty: manualAllocatedQty,
            allocated_roll_count: round(Number(item.factory_allocated_roll_count || 0), 4)
          }
          return {
            factory_name: item.factory_name,
            allocated_qty: batchRollCount > 0 && allocationDraft.allocated_roll_count > 0
              ? resolveFactoryAllocationQtyFromRollCount({
                ...before,
                actual_input_qty: actualInputQty,
                actual_input_unit: actualInputUnit,
                unit: targetUnit
              }, allocationDraft, material)
              : manualAllocatedQty,
            allocated_roll_count: allocationDraft.allocated_roll_count
          }
        }).filter(Boolean)

        if (totalInputAllocatedQty > actualInputQty + 0.000001) {
          throw new Error(`采购批次【${cleanText(before.batch_no)}】发往工厂数量不能大于实际到厂数量`)
        }
        if (batchRollCount > 0 && totalAllocatedRollCount > batchRollCount + 0.000001) {
          throw new Error(`采购批次【${cleanText(before.batch_no)}】发往工厂条数不能大于采购条数`)
        }
        factoryAllocatedQty = round(nextAllocations.reduce((sum, item) => sum + Number(item.allocated_qty || 0), 0), 6)
        if (factoryAllocatedQty > Number(before.gross_qty || 0) + 0.000001) {
          throw new Error(`采购批次【${cleanText(before.batch_no)}】发往工厂数量不能大于实际入库数量`)
        }
        allocationRows = replacePurchaseBatchAllocations(id, nextAllocations)
        factoryName = allocationRows.map((item) => cleanText(item.factory_name)).filter(Boolean).join('、')
      }

      update.run('approved', reviewImagesJson, factoryName, factoryAllocatedQty, warehouseName, id)
      const after = select.get(id)
      logAudit('采购批次', '审核采购批次', 'purchase_batch', id, cleanText(after?.batch_no), before, after)
    })
  })
  tx(ids)
  runPostWriteMaintenance().catch(() => {})
  return ids.length
})

ipcMain.handle('db:updatePurchaseBatchFactoryAllocations', (_event, payload = {}) => {
  assertWritable('库存台账发往工厂')
  const id = Number(payload.id || 0)
  if (!id) throw new Error('请选择要发往工厂的库存批次')

  const select = db.prepare(`
    SELECT pb.*, m.code AS material_code, m.name AS material_name
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE pb.id=?
  `)

  const tx = db.transaction((targetId, rawAllocations, mode) => {
    const before = select.get(targetId)
    if (!before) throw new Error('未找到对应采购批次')
    if (normalizeDocumentStatus(before.document_status) !== 'approved') {
      throw new Error('只有已审核采购单入库后的批次，才能在库存台账里发往工厂')
    }

    const material = getMaterialById(before.material_id)
    const targetUnit = normalizeUnit(before.unit || material?.unit)
    const actualInputQty = Number(before.actual_input_qty || before.purchase_input_qty || before.gross_qty || 0)
    const actualInputUnit = normalizeUnit(before.actual_input_unit || before.purchase_input_unit || targetUnit)
    const batchRollCount = Math.max(Number(before.roll_count || 0), 0)
    const appendMode = cleanText(mode) === 'append'
    const existingAllocations = appendMode ? getPurchaseBatchAllocations(targetId) : []

    const normalizedAllocations = (Array.isArray(rawAllocations) ? rawAllocations : [])
      .map((item) => ({
        factory_name: cleanText(item?.factory_name),
        factory_allocated_qty: Number(item?.factory_allocated_qty || 0),
        factory_allocated_roll_count: Number(item?.factory_allocated_roll_count || 0),
        factory_allocated_unit: normalizeUnit(item?.factory_allocated_unit || actualInputUnit)
      }))
      .filter((item) => item.factory_name || Number(item.factory_allocated_qty || 0) > 0 || Number(item.factory_allocated_roll_count || 0) > 0)

    let totalInputAllocatedQty = 0
    let totalAllocatedRollCount = 0

    const nextAllocations = normalizedAllocations.map((item) => {
      if (!item.factory_name && Number(item.factory_allocated_qty || 0) > 0) {
        throw new Error(`采购批次【${cleanText(before.batch_no)}】填写了发往工厂数量，请先选择工厂`)
      }
      if (!item.factory_name || (Number(item.factory_allocated_qty || 0) <= 0 && Number(item.factory_allocated_roll_count || 0) <= 0)) {
        return null
      }

      totalInputAllocatedQty += Number(item.factory_allocated_qty || 0)
      totalAllocatedRollCount += Number(item.factory_allocated_roll_count || 0)

      const manualAllocatedQty = round(
        Number(convertQuantity(item.factory_allocated_qty, item.factory_allocated_unit || actualInputUnit, targetUnit, material) || 0),
        6
      )

      const allocationDraft = {
        allocated_qty: manualAllocatedQty,
        allocated_roll_count: round(Number(item.factory_allocated_roll_count || 0), 4)
      }

      return {
        factory_name: item.factory_name,
        allocated_qty: batchRollCount > 0 && allocationDraft.allocated_roll_count > 0
          ? resolveFactoryAllocationQtyFromRollCount({
            ...before,
            actual_input_qty: actualInputQty,
            actual_input_unit: actualInputUnit,
            unit: targetUnit
          }, allocationDraft, material)
          : manualAllocatedQty,
        allocated_roll_count: allocationDraft.allocated_roll_count
      }
    }).filter(Boolean)

    const candidateAllocations = appendMode
      ? [...existingAllocations, ...nextAllocations]
      : nextAllocations
    const candidateInputAllocatedQty = round(candidateAllocations.reduce((sum, item) => {
      return sum + Number(resolveFactoryAllocationInputQty(before, {
        ...item,
        input_allocated_qty: tryConvertQuantity(
          Number(item.allocated_qty || 0),
          targetUnit,
          actualInputUnit,
          material,
          0
        )
      }) || 0)
    }, 0), 6)
    const incomingInputAllocatedQty = round(nextAllocations.reduce((sum, item) => {
      return sum + Number(resolveFactoryAllocationInputQty(before, {
        ...item,
        input_allocated_qty: tryConvertQuantity(
          Number(item.allocated_qty || 0),
          targetUnit,
          actualInputUnit,
          material,
          0
        )
      }) || 0)
    }, 0), 6)
    const candidateRollCount = round(candidateAllocations.reduce((sum, item) => sum + Number(item.allocated_roll_count || 0), 0), 4)

    if (candidateInputAllocatedQty > actualInputQty + 0.000001) {
      const alreadyInputQty = Math.max(candidateInputAllocatedQty - incomingInputAllocatedQty, 0)
      const availableInputQty = Math.max(actualInputQty - alreadyInputQty, 0)
      throw new Error(`采购批次【${cleanText(before.batch_no)}】本次发往工厂数量超过可发库存，当前最多还可发 ${formatServerQtyWithUnit(availableInputQty, actualInputUnit)}`)
    }
    if (batchRollCount > 0 && candidateRollCount > batchRollCount + 0.000001) {
      throw new Error(`采购批次【${cleanText(before.batch_no)}】发往工厂条数不能大于采购条数，当前最多可发 ${formatServerQty(batchRollCount, 2)} 条`)
    }

    const consumedByFactory = new Map(
      db.prepare(`
        SELECT
          TRIM(COALESCE(po.factory_name, '')) AS factory_name,
          ROUND(COALESCE(SUM(pom.consumed_qty), 0), 6) AS consumed_qty
        FROM production_order_materials pom
        JOIN production_orders po ON po.id = pom.order_id
        WHERE pom.batch_id=?
        GROUP BY TRIM(COALESCE(po.factory_name, ''))
      `).all(targetId).map((item) => [cleanText(item.factory_name), Number(item.consumed_qty || 0)])
    )

    const candidateByFactory = new Map()
    candidateAllocations.forEach((item) => {
      const factoryName = cleanText(item.factory_name)
      if (!factoryName) return
      candidateByFactory.set(factoryName, round(Number(candidateByFactory.get(factoryName) || 0) + Number(item.allocated_qty || 0), 6))
    })
    candidateByFactory.forEach((allocatedQty, factoryName) => {
      const consumedQty = Number(consumedByFactory.get(factoryName) || 0)
      if (Number(allocatedQty || 0) + 0.000001 < consumedQty) {
        throw new Error(`工厂【${factoryName}】已有实际领用 ${formatServerQtyWithUnit(consumedQty, targetUnit)}，发往数量不能小于该已使用数量`)
      }
    })

    const nextAllocatedQty = round(candidateAllocations.reduce((sum, item) => sum + Number(item.allocated_qty || 0), 0), 6)
    if (nextAllocatedQty > Number(before.gross_qty || 0) + 0.000001) {
      throw new Error(`采购批次【${cleanText(before.batch_no)}】发往工厂数量不能大于实际入库数量`)
    }

    const allocationRows = replacePurchaseBatchAllocations(targetId, candidateAllocations)
    const factoryName = allocationRows.map((item) => cleanText(item.factory_name)).filter(Boolean).join('、')
    const warehouseName = cleanText(payload.warehouse_name) || cleanText(before.warehouse_name) || '主仓库'

    db.prepare(`
      UPDATE purchase_batches
      SET factory_name=?, factory_allocated_qty=?, warehouse_name=?
      WHERE id=?
    `).run(factoryName, nextAllocatedQty, warehouseName, targetId)

    const after = select.get(targetId)
    logAudit('库存台账', '发往工厂', 'purchase_batch', targetId, cleanText(after?.batch_no), before, {
      ...after,
      allocations: allocationRows
    })
  })

  tx(id, payload.allocations || [], payload.mode)
  bumpDataRevision()
  runPostWriteMaintenance().catch(() => {})
  return { success: true }
})

function buildExchangeInRemark(sourceBatch, sourceAfterSaleId, extraRemark = '') {
  const sourceText = cleanText(sourceBatch?.batch_no || sourceBatch?.purchase_order_no)
  const suffix = sourceAfterSaleId ? `，来源售后 #${sourceAfterSaleId}` : ''
  const detail = cleanText(extraRemark)
  return `供应商换货入库${sourceText ? `，来源批次 ${sourceText}` : ''}${suffix}${detail ? `；${detail}` : ''}`
}

function createExchangeInBatch(sourceBatch, payload = {}) {
  const inQty = round(Number(payload.in_qty || 0), 6)
  if (!sourceBatch || inQty <= 0) return null
  const stockUnit = normalizeUnit(payload.in_unit || sourceBatch.unit || '米')
  const warehouseName = cleanText(payload.in_warehouse_name || payload.warehouse_name || sourceBatch.warehouse_name) || '主仓库'
  const targetColor = cleanText(payload.in_color || sourceBatch.color)
  const targetSize = cleanText(payload.in_size || sourceBatch.size)
  const batchNo = cleanText(payload.batch_no) || nextSerial(batchNoPrefix(), 'purchase_batches', 'batch_no')
  const unitCost = round(
    Number(sourceBatch.effective_unit_price || sourceBatch.base_unit_price || sourceBatch.raw_unit_price || sourceBatch.price || 0),
    6
  )
  const totalAmount = round(unitCost * inQty, 4)
  const remark = buildExchangeInRemark(sourceBatch, payload.source_after_sale_id, payload.remark)
  const data = {
    batch_no: batchNo,
    document_status: 'approved',
    review_images_json: '[]',
    material_id: Number(sourceBatch.material_id || 0),
    purchase_order_no: cleanText(sourceBatch.purchase_order_no || sourceBatch.batch_no),
    merge_group_id: '',
    merge_snapshot_json: '',
    supplier: cleanText(sourceBatch.supplier),
    warehouse_name: warehouseName,
    color: targetColor,
    color_remark: normalizePurchaseColorRemarkText(sourceBatch.color_remark),
    size: targetSize,
    gross_qty: inQty,
    remaining_qty: inQty,
    unit: stockUnit,
    price: unitCost,
    price_unit: stockUnit,
    price_type: cleanText(sourceBatch.price_type) || 'bulk',
    raw_unit_price: unitCost,
    base_unit_price: unitCost,
    processing_cost: 0,
    processing_cost_per_unit: 0,
    processing_note: '',
    parent_batch_id: Number(sourceBatch.id || 0) || null,
    source_batch_no: cleanText(sourceBatch.batch_no),
    roll_count: 0,
    purchase_input_qty: inQty,
    purchase_input_unit: stockUnit,
    actual_input_qty: inQty,
    actual_input_unit: stockUnit,
    adjustment_type: 'none',
    left_gap: 0,
    right_gap: 0,
    gap_ratio: 1,
    custom_formula: '',
    effective_unit_price: unitCost,
    total_amount: totalAmount,
    rounding_adjustment: 0,
    received_at: cleanText(sourceBatch.received_at),
    remark
  }
  const insertedId = normalizeInsertId(db.prepare(`
    INSERT INTO purchase_batches (
      batch_no,
      document_status,
      review_images_json,
      material_id,
      purchase_order_no,
      merge_group_id,
      merge_snapshot_json,
      supplier,
      warehouse_name,
      color,
      color_remark,
      size,
      gross_qty,
      remaining_qty,
      unit,
      price,
      price_unit,
      price_type,
      raw_unit_price,
      base_unit_price,
      processing_cost,
      processing_cost_per_unit,
      processing_note,
      parent_batch_id,
      source_batch_no,
      roll_count,
      purchase_input_qty,
      purchase_input_unit,
      actual_input_qty,
      actual_input_unit,
      adjustment_type,
      left_gap,
      right_gap,
      gap_ratio,
      custom_formula,
      effective_unit_price,
      total_amount,
      rounding_adjustment,
      received_at,
      remark
    ) VALUES (
      @batch_no,
      @document_status,
      @review_images_json,
      @material_id,
      @purchase_order_no,
      @merge_group_id,
      @merge_snapshot_json,
      @supplier,
      @warehouse_name,
      @color,
      @color_remark,
      @size,
      @gross_qty,
      @remaining_qty,
      @unit,
      @price,
      @price_unit,
      @price_type,
      @raw_unit_price,
      @base_unit_price,
      @processing_cost,
      @processing_cost_per_unit,
      @processing_note,
      @parent_batch_id,
      @source_batch_no,
      @roll_count,
      @purchase_input_qty,
      @purchase_input_unit,
      @actual_input_qty,
      @actual_input_unit,
      @adjustment_type,
      @left_gap,
      @right_gap,
      @gap_ratio,
      @custom_formula,
      @effective_unit_price,
      @total_amount,
      @rounding_adjustment,
      @received_at,
      @remark
    )
  `).run(data).lastInsertRowid)
  const saved = db.prepare(`
    SELECT pb.*, m.code AS material_code, m.name AS material_name
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE pb.id=?
  `).get(insertedId)
  logInventoryMovement({
    movement_type: '采购换货-换入',
    direction: 'in',
    material_id: saved.material_id,
    batch_id: saved.id,
    material_code: saved.material_code,
    material_name: saved.material_name,
    color: saved.color,
    qty: saved.gross_qty,
    unit: saved.unit,
    balance_after: saved.remaining_qty,
    source_table: 'purchase_batches',
    source_id: saved.id,
    source_no: saved.batch_no,
    document_status: saved.document_status,
    remark
  })
  logAudit('采购批次', '供应商换货入库', 'purchase_batch', insertedId, cleanText(saved.batch_no), null, saved, remark)
  return saved
}

function repairLegacyExchangeInBatches() {
  if (workspaceReadOnly) return 0
  const hasExchangeInColumns = ['in_batch_id', 'in_batch_no', 'in_qty', 'in_unit', 'in_warehouse_name', 'in_color', 'in_size']
    .every((column) => hasColumn('purchase_batch_after_sales', column))
  if (!hasExchangeInColumns) return 0

  const rows = db.prepare(`
    SELECT
      s.id AS after_sale_id,
      s.qty AS after_sale_qty,
      s.unit AS after_sale_unit,
      s.warehouse_name AS after_sale_warehouse_name,
      s.in_batch_id AS after_sale_in_batch_id,
      s.in_qty AS after_sale_in_qty,
      s.in_unit AS after_sale_in_unit,
      s.in_warehouse_name AS after_sale_in_warehouse_name,
      s.in_color AS after_sale_in_color,
      s.in_size AS after_sale_in_size,
      s.remark AS after_sale_remark,
      linked.id AS linked_in_batch_id,
      LOWER(TRIM(COALESCE(linked.document_status, 'draft'))) AS linked_in_document_status,
      pb.*,
      m.code AS material_code,
      m.name AS material_name
    FROM purchase_batch_after_sales s
    JOIN purchase_batches pb ON pb.id = s.purchase_batch_id
    JOIN materials m ON m.id = pb.material_id
    LEFT JOIN purchase_batches linked ON linked.id = s.in_batch_id
    WHERE LOWER(TRIM(COALESCE(s.type, ''))) = 'exchange'
      AND COALESCE(s.qty, 0) > 0
      AND (
        COALESCE(s.in_qty, 0) <= 0
        OR COALESCE(s.in_batch_id, 0) <= 0
        OR linked.id IS NULL
        OR LOWER(TRIM(COALESCE(linked.document_status, 'draft'))) = 'voided'
      )
    ORDER BY s.id ASC
  `).all()
  if (!rows.length) return 0

  const findExisting = db.prepare(`
    SELECT id, batch_no, gross_qty, unit, warehouse_name, color, size
    FROM purchase_batches
    WHERE material_id=?
      AND TRIM(COALESCE(color, '')) = ?
      AND TRIM(COALESCE(size, '')) = ?
      AND LOWER(TRIM(COALESCE(document_status, 'draft'))) != 'voided'
      AND id != ?
      AND (
        remark LIKE ?
        OR remark LIKE '%换货%'
        OR source_batch_no LIKE ?
      )
    ORDER BY
      CASE WHEN remark LIKE '%换货%' THEN 0 ELSE 1 END,
      id DESC
    LIMIT 1
  `)
  const updateSourceRemaining = db.prepare(`
    UPDATE purchase_batches
    SET remaining_qty=?,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `)
  const updateAfterSale = db.prepare(`
    UPDATE purchase_batch_after_sales
    SET in_batch_id=?,
        in_batch_no=?,
        in_qty=?,
        in_unit=?,
        in_warehouse_name=?,
        in_color=?,
        in_size=?
    WHERE id=?
  `)

  const tx = db.transaction((items) => {
    let repaired = 0
    items.forEach((row) => {
      const sourceAfterSaleId = Number(row.after_sale_id || 0)
      const outQty = round(Number(row.after_sale_qty || 0), 6)
      const targetColor = cleanText(row.after_sale_in_color || row.color)
      const targetSize = cleanText(row.after_sale_in_size || row.size)
      const existing = findExisting.get(
        Number(row.material_id || 0),
        targetColor,
        targetSize,
        Number(row.id || 0),
        `%来源售后 #${sourceAfterSaleId}%`,
        `%${cleanText(row.batch_no)}%`
      )
      if (existing) {
        updateAfterSale.run(
          Number(existing.id || 0),
          cleanText(existing.batch_no),
          Number(row.after_sale_in_qty || row.after_sale_qty || 0),
          normalizeUnit(existing.unit || row.after_sale_unit || row.unit),
          cleanText(existing.warehouse_name || row.after_sale_warehouse_name) || '主仓库',
          cleanText(existing.color || row.after_sale_in_color || row.color),
          cleanText(existing.size || row.after_sale_in_size || row.size),
          sourceAfterSaleId
        )
        if (outQty > 0 && Number(row.remaining_qty || 0) >= outQty - 0.000001) {
          updateSourceRemaining.run(round(Number(row.remaining_qty || 0) - outQty, 6), Number(row.id || 0))
        }
        return
      }
      const saved = createExchangeInBatch(row, {
        in_qty: Number(row.after_sale_qty || 0),
        in_unit: normalizeUnit(row.after_sale_unit || row.unit),
        in_warehouse_name: cleanText(row.after_sale_in_warehouse_name || row.after_sale_warehouse_name || row.warehouse_name) || '主仓库',
        in_color: cleanText(row.after_sale_in_color || row.color),
        in_size: cleanText(row.after_sale_in_size || row.size),
        source_after_sale_id: sourceAfterSaleId,
        remark: cleanText(row.after_sale_remark)
      })
      if (!saved) return
      updateAfterSale.run(
        Number(saved.id || 0),
        cleanText(saved.batch_no),
        Number(saved.gross_qty || 0),
        normalizeUnit(saved.unit),
        cleanText(saved.warehouse_name) || '主仓库',
        cleanText(saved.color),
        cleanText(saved.size),
        sourceAfterSaleId
      )
      if (outQty > 0 && Number(row.remaining_qty || 0) >= outQty - 0.000001) {
        updateSourceRemaining.run(round(Number(row.remaining_qty || 0) - outQty, 6), Number(row.id || 0))
      }
      repaired += 1
    })
    return repaired
  })
  return tx(rows)
}

ipcMain.handle('db:processPurchaseBatchAfterSale', (_event, payload = {}) => {
  assertWritable('处理采购退回/换货')
  const normalizedType = cleanText(payload.type) === 'exchange' ? 'exchange' : 'return'
  const actionLabel = normalizedType === 'exchange' ? '供应商换货' : '退回供应商'
  const lines = (Array.isArray(payload.lines) ? payload.lines : [])
    .map((item) => ({
      id: Number(item?.id || 0),
      qty: Number(item?.qty || 0),
      out_qty: Number(item?.out_qty ?? item?.qty ?? 0),
      in_qty: Number(item?.in_qty || 0),
      warehouse_name: cleanText(item?.warehouse_name) || '主仓库',
      in_warehouse_name: cleanText(item?.in_warehouse_name || item?.warehouse_name) || '主仓库',
      in_color: cleanText(item?.in_color),
      in_size: cleanText(item?.in_size),
      reason: cleanText(item?.reason),
      remark: cleanText(item?.remark)
    }))
    .filter((item) => item.id && (normalizedType === 'exchange'
      ? (item.out_qty > 0 || item.in_qty > 0)
      : item.qty > 0))

  if (!lines.length) {
    throw new Error(`请至少填写一条${actionLabel}明细`)
  }

  const select = db.prepare(`
    SELECT pb.*, m.code AS material_code, m.name AS material_name
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE pb.id=?
  `)
  const update = db.prepare(`
    UPDATE purchase_batches
    SET remaining_qty=?,
        warehouse_name=?,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `)
  const insertAfterSale = db.prepare(`
    INSERT INTO purchase_batch_after_sales (
      purchase_batch_id,
      type,
      qty,
      unit,
      warehouse_name,
      reason,
      remark
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertAfterSaleWithExchangeIn = db.prepare(`
    INSERT INTO purchase_batch_after_sales (
      purchase_batch_id,
      type,
      qty,
      unit,
      warehouse_name,
      in_batch_id,
      in_batch_no,
      in_qty,
      in_unit,
      in_warehouse_name,
      in_color,
      in_size,
      reason,
      remark
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction((entries) => {
    const result = {
      count: 0,
      total_out_qty: 0,
      total_in_qty: 0,
      in_lines: []
    }
    entries.forEach((entry) => {
      const before = select.get(entry.id)
      if (!before) throw new Error('未找到对应采购批次')
      if (normalizeDocumentStatus(before.document_status) !== 'approved') {
        throw new Error(`采购批次【${cleanText(before.batch_no)}】未审核，不能执行${actionLabel}`)
      }

      const material = getMaterialById(before.material_id)
      const allocations = getPurchaseBatchAllocations(entry.id)
      const allocatedQty = round(allocations.reduce((sum, allocation) => {
        return sum + resolveFactoryAllocationQtyFromRollCount(before, allocation, material)
      }, 0), 6)
      const warehouseAvailableQty = round(Math.max(Number(before.remaining_qty || 0) - allocatedQty, 0), 6)

      const outQty = normalizedType === 'exchange'
        ? round(Math.max(Number(entry.out_qty || 0), 0), 6)
        : round(Math.max(Number(entry.qty || 0), 0), 6)
      const inQty = normalizedType === 'exchange'
        ? round(Math.max(Number(entry.in_qty || 0), 0), 6)
        : 0

      if (outQty <= 0 && inQty <= 0) return

      if (outQty > warehouseAvailableQty + 0.000001) {
        throw new Error(`采购批次【${cleanText(before.batch_no)}】当前仓库可操作数量仅剩 ${formatServerQtyWithUnit(warehouseAvailableQty, before.unit)}，不能继续${actionLabel}`)
      }

      const nextRemainingQty = round(Math.max(Number(before.remaining_qty || 0) - outQty, 0), 6)
      const nextWarehouseName = entry.warehouse_name || cleanText(before.warehouse_name) || '主仓库'
      let exchangeInBatch = null
      if (outQty > 0) {
        update.run(nextRemainingQty, nextWarehouseName, entry.id)
      }
      if (normalizedType === 'exchange' && inQty > 0) {
        exchangeInBatch = createExchangeInBatch(before, {
          in_qty: inQty,
          in_unit: normalizeUnit(before.unit),
          in_warehouse_name: entry.in_warehouse_name || nextWarehouseName,
          in_color: entry.in_color || before.color,
          in_size: entry.in_size || before.size,
          remark: [entry.reason, entry.remark].filter(Boolean).join('；')
        })
        if (exchangeInBatch) {
          result.in_lines.push({
            batch_no: cleanText(exchangeInBatch.batch_no),
            material_code: cleanText(exchangeInBatch.material_code),
            color: cleanText(exchangeInBatch.color),
            size: cleanText(exchangeInBatch.size),
            qty: Number(exchangeInBatch.gross_qty || 0),
            unit: normalizeUnit(exchangeInBatch.unit),
            warehouse_name: cleanText(exchangeInBatch.warehouse_name)
          })
        }
      }

      if (normalizedType === 'exchange') {
        const afterSaleInfo = insertAfterSaleWithExchangeIn.run(
          entry.id,
          normalizedType,
          outQty,
          normalizeUnit(before.unit),
          nextWarehouseName,
          exchangeInBatch ? Number(exchangeInBatch.id || 0) : null,
          exchangeInBatch ? cleanText(exchangeInBatch.batch_no) : '',
          inQty,
          normalizeUnit(exchangeInBatch?.unit || before.unit),
          cleanText(exchangeInBatch?.warehouse_name || entry.in_warehouse_name || nextWarehouseName) || '主仓库',
          cleanText(exchangeInBatch?.color || entry.in_color || before.color),
          cleanText(exchangeInBatch?.size || entry.in_size || before.size),
          entry.reason,
          entry.remark
        )
        if (exchangeInBatch && afterSaleInfo?.lastInsertRowid) {
          db.prepare(`
            UPDATE purchase_batches
            SET remark=?
            WHERE id=?
          `).run(
            buildExchangeInRemark(before, afterSaleInfo.lastInsertRowid, [entry.reason, entry.remark].filter(Boolean).join('；')),
            Number(exchangeInBatch.id || 0)
          )
        }
      } else {
        insertAfterSale.run(
          entry.id,
          normalizedType,
          outQty,
          normalizeUnit(before.unit),
          nextWarehouseName,
          entry.reason,
          entry.remark
        )
      }

      if (outQty > 0) {
        logInventoryMovement({
          movement_type: normalizedType === 'exchange' ? '采购换货-换出' : '采购退回',
          direction: 'out',
          material_id: before.material_id,
          batch_id: before.id,
          material_code: before.material_code,
          material_name: before.material_name,
          color: before.color,
          qty: outQty,
          unit: before.unit,
          balance_after: nextRemainingQty,
          source_table: 'purchase_batches',
          source_id: before.id,
          source_no: cleanText(before.purchase_order_no || before.batch_no),
          document_status: before.document_status,
          remark: `${actionLabel}${entry.reason ? `：${entry.reason}` : ''}${entry.remark ? `；${entry.remark}` : ''}`
        })
      }

      const after = select.get(entry.id)
      logAudit('采购批次', actionLabel, 'purchase_batch', entry.id, cleanText(after?.batch_no), before, {
        ...after,
        after_sale_qty: outQty,
        exchange_in_qty: inQty,
        exchange_in_batch_no: cleanText(exchangeInBatch?.batch_no),
        after_sale_type: normalizedType,
        after_sale_reason: entry.reason,
        after_sale_remark: entry.remark
      })
      result.count += 1
      result.total_out_qty = round(result.total_out_qty + outQty, 6)
      result.total_in_qty = round(result.total_in_qty + inQty, 6)
    })
    return result
  })

  const result = tx(lines)
  bumpDataRevision()
  runPostWriteMaintenance().catch(() => {})
  const inPreview = (result.in_lines || [])
    .map((item) => `${item.size ? `${item.size} ` : ''}${formatServerQtyWithUnit(item.qty, item.unit)}`)
    .join('、')
  const message = normalizedType === 'exchange'
    ? `换货完成：换出 ${formatServerQtyWithUnit(result.total_out_qty, lines.length === 1 ? select.get(lines[0].id)?.unit : '')}，换入 ${inPreview || formatServerQtyWithUnit(result.total_in_qty, '')}`
    : `${actionLabel}已登记：${formatServerQtyWithUnit(result.total_out_qty, lines.length === 1 ? select.get(lines[0].id)?.unit : '')}`
  return { success: true, ...result, message }
})

ipcMain.handle('db:voidPurchaseBatches', (e, payload = {}) => {
  assertWritable('作废采购批次')
  const ids = [...new Set((payload.ids || []).map((item) => Number(item)).filter(Boolean))]
  if (!ids.length) return 0

  const update = db.prepare('UPDATE purchase_batches SET document_status=? WHERE id=?')
  const select = db.prepare(`
    SELECT pb.*, m.code AS material_code, m.name AS material_name
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE pb.id=?
  `)
  const tx = db.transaction((targetIds) => {
    targetIds.forEach((id) => {
      const before = select.get(id)
      if (!before) return
      if (normalizeDocumentStatus(before.document_status) === 'approved') {
        throw new Error(`采购批次【${cleanText(before.batch_no)}】已审核，不能直接作废`)
      }
      update.run('voided', id)
      const after = select.get(id)
      logAudit('采购批次', '作废采购批次', 'purchase_batch', id, cleanText(after?.batch_no), before, after)
    })
  })
  tx(ids)
  runPostWriteMaintenance().catch(() => {})
  return ids.length
})

ipcMain.handle('db:returnPurchaseBatchesToDraft', (e, payload = {}) => {
  assertWritable('采购单据退回草稿')
  const ids = [...new Set((payload.ids || []).map((item) => Number(item)).filter(Boolean))]
  if (!ids.length) return 0

  const update = db.prepare('UPDATE purchase_batches SET document_status=? WHERE id=?')
  const select = db.prepare(`
    SELECT pb.*, m.code AS material_code, m.name AS material_name
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE pb.id=?
  `)
  const tx = db.transaction((targetIds) => {
    targetIds.forEach((id) => {
      const before = select.get(id)
      if (!before) return
      update.run('draft', id)
      const after = select.get(id)
      logAudit('采购批次', '退回草稿', 'purchase_batch', id, cleanText(after?.batch_no), before, after)
    })
  })
  tx(ids)
  runPostWriteMaintenance().catch(() => {})
  return ids.length
})

ipcMain.handle('db:batchUpdateProductionOrderDocumentStatus', (e, payload = {}) => {
  assertWritable('批量修改生产单据状态')
  const ids = [...new Set((payload.ids || []).map((item) => Number(item)).filter(Boolean))]
  const documentStatus = normalizeDocumentStatus(payload.document_status)
  if (!ids.length) return 0

  const update = db.prepare('UPDATE production_orders SET document_status=? WHERE id=?')
  const tx = db.transaction((targetIds) => {
    targetIds.forEach((id) => {
      const before = getProductionOrderById(id)
      if (!before) return
      if (normalizeDocumentStatus(before.document_status) === 'approved') {
        throw new Error(`生产单【${cleanText(before.order_no)}】已审核，不能再修改单据状态`)
      }
      update.run(documentStatus, id)
      recalculateOrder(id, 'none')
      const after = getProductionOrderStatusSnapshot(id)
      logAudit('生产制单', '批量修改单据状态', 'production_order', id, cleanText(after?.order_no), before, after)
    })
  })
  tx(ids)
  runPostWriteMaintenance().catch(() => {})
  return ids.length
})

ipcMain.handle('db:approveProductionOrders', (e, payload = {}) => {
  assertWritable('审核生产单')
  const ids = [...new Set((payload.ids || []).map((item) => Number(item)).filter(Boolean))]
  const reviewImages = normalizeReviewImagesForStorage(payload.review_images || payload.review_images_json)
  if (!ids.length) return 0

  const tx = db.transaction((targetIds) => {
    targetIds.forEach((id) => {
      approveSingleProductionOrder(id, {
        reviewImages,
        skipReviewImages: false,
        auditAction: '审核生产单'
      })
    })
  })
  tx(ids)
  runPostWriteMaintenance().catch(() => {})
  return ids.length
})

ipcMain.handle('db:voidProductionOrders', (e, payload = {}) => {
  assertWritable('作废生产单')
  const ids = [...new Set((payload.ids || []).map((item) => Number(item)).filter(Boolean))]
  if (!ids.length) return 0

  const update = db.prepare('UPDATE production_orders SET document_status=? WHERE id=?')
  const tx = db.transaction((targetIds) => {
    targetIds.forEach((id) => {
      const before = getProductionOrderById(id)
      if (!before) return
      if (normalizeDocumentStatus(before.document_status) === 'approved') {
        throw new Error(`生产单【${cleanText(before.order_no)}】已审核，不能直接作废`)
      }
      update.run('voided', id)
      const after = getProductionOrderStatusSnapshot(id)
      logAudit('生产制单', '作废生产单', 'production_order', id, cleanText(after?.order_no), before, after)
    })
  })
  tx(ids)
  runPostWriteMaintenance().catch(() => {})
  return ids.length
})

ipcMain.handle('db:returnProductionOrdersToDraft', (e, payload = {}) => {
  assertWritable('生产单退回草稿')
  const ids = [...new Set((payload.ids || []).map((item) => Number(item)).filter(Boolean))]
  if (!ids.length) return 0

  const update = db.prepare('UPDATE production_orders SET document_status=? WHERE id=?')
  const tx = db.transaction((targetIds) => {
    targetIds.forEach((id) => {
      const before = getProductionOrderById(id)
      if (!before) return
      update.run('draft', id)
      recalculateOrder(id, 'none')
      const after = getProductionOrderStatusSnapshot(id)
      logAudit('生产制单', '退回草稿', 'production_order', id, cleanText(after?.order_no), before, after)
    })
  })
  tx(ids)
  runPostWriteMaintenance().catch(() => {})
  return ids.length
})

ipcMain.handle('db:getBomsByGarment', (e, garmentId) => getBomsByGarment(garmentId))

ipcMain.handle('db:saveBomItem', (e, payload) => {
  assertWritable('保存 BOM')
  const data = {
    ...payload,
    sort_order: Number(payload.sort_order || 0),
    usage_unit: normalizeUnit(payload.usage_unit || '米'),
    material_role: cleanText(payload.material_role) || '辅料',
    supply_mode: cleanText(payload.supply_mode) || 'our_supply',
    processing_requirements: safeJsonStringify(normalizeStringList(payload.processing_requirements), '[]'),
    material_color: cleanText(payload.material_color),
    usage_mode: normalizeUsageMode(payload.usage_mode, payload),
    cost_price_type: cleanText(payload.cost_price_type) || 'bulk'
  }
  seedOptionValue('unit', data.usage_unit)
  if (payload.id) {
    const changes = db.prepare(`
      UPDATE boms
      SET material_id=@material_id, sort_order=@sort_order, usage=@usage, usage_unit=@usage_unit, loss_rate=@loss_rate, material_role=@material_role, supply_mode=@supply_mode, processing_requirements=@processing_requirements, material_color=@material_color, usage_mode=@usage_mode, cost_price_type=@cost_price_type
      WHERE id=@id
    `).run(data).changes
    if (changes) bumpDataRevision()
    return changes
  }

  const insertedId = normalizeInsertId(db.prepare(`
    INSERT INTO boms (garment_id, material_id, sort_order, usage, usage_unit, loss_rate, material_role, supply_mode, processing_requirements, material_color, usage_mode, cost_price_type)
    VALUES (@garment_id, @material_id, @sort_order, @usage, @usage_unit, @loss_rate, @material_role, @supply_mode, @processing_requirements, @material_color, @usage_mode, @cost_price_type)
  `).run(data).lastInsertRowid)
  bumpDataRevision()
  return insertedId
})

ipcMain.handle('db:replaceBomItemsByGarment', (e, garmentId, items) => {
  assertWritable('保存 BOM')
  const tx = db.transaction((targetGarmentId, bomItems) => {
    db.prepare('DELETE FROM boms WHERE garment_id=?').run(targetGarmentId)
    const insert = db.prepare(`
      INSERT INTO boms (garment_id, material_id, sort_order, usage, usage_unit, loss_rate, material_role, supply_mode, processing_requirements, material_color, usage_mode, cost_price_type)
      VALUES (@garment_id, @material_id, @sort_order, @usage, @usage_unit, @loss_rate, @material_role, @supply_mode, @processing_requirements, @material_color, @usage_mode, @cost_price_type)
    `)

    ;(bomItems || []).forEach((item, index) => {
      if (!item.material_id) return
      const usageUnit = normalizeUnit(item.usage_unit || '米')
      seedOptionValue('unit', usageUnit)
      insert.run({
        garment_id: targetGarmentId,
        material_id: Number(item.material_id),
        sort_order: Number(item.sort_order || 0) || index + 1,
        usage: Number(item.usage || 0),
        usage_unit: usageUnit,
        loss_rate: Number(item.loss_rate || 0),
        material_role: cleanText(item.material_role) || '辅料',
        supply_mode: cleanText(item.supply_mode) || 'our_supply',
        processing_requirements: safeJsonStringify(normalizeStringList(item.processing_requirements), '[]'),
        material_color: cleanText(item.material_color),
        usage_mode: normalizeUsageMode(item.usage_mode, item),
        cost_price_type: cleanText(item.cost_price_type) || 'bulk'
      })
    })
  })

  tx(Number(garmentId), items || [])
  bumpDataRevision()
  return getBomsByGarment(Number(garmentId))
})

ipcMain.handle('db:deleteBomItem', (e, id) => {
  assertWritable('删除 BOM')
  const changes = db.prepare('DELETE FROM boms WHERE id=?').run(id).changes
  if (changes) bumpDataRevision()
  return changes
})

function getPurchaseBatches(params = {}) {
  const filterField = cleanText(params.filterField || 'keyword')
  const keyword = cleanText(params.keyword).toLowerCase()
  const supplier = cleanText(params.supplier)
  const materialCategory = cleanText(params.material_category)
  const rawDocumentStatus = cleanText(params.document_status)
  const documentStatus = rawDocumentStatus ? normalizeDocumentStatus(rawDocumentStatus) : ''
  const dateFrom = cleanText(params.date_from)
  const dateTo = cleanText(params.date_to)
  const limit = Math.max(100, Math.min(Number(params.limit || 1000), 3000))
  const whereClauses = []
  const queryParams = []

  if (supplier) {
    whereClauses.push(`TRIM(COALESCE(pb.supplier, '')) = ?`)
    queryParams.push(supplier)
  }
  if (materialCategory) {
    whereClauses.push(`(
      TRIM(COALESCE(m.major_category, '')) = ?
      OR TRIM(COALESCE(m.category, '')) = ?
      OR TRIM(COALESCE(m.sub_category, '')) = ?
      OR TRIM(COALESCE(m.leaf_category, '')) = ?
    )`)
    queryParams.push(materialCategory, materialCategory, materialCategory, materialCategory)
  }
  if (documentStatus) {
    whereClauses.push(`LOWER(TRIM(COALESCE(pb.document_status, 'draft'))) = ?`)
    queryParams.push(documentStatus)
  }
  if (dateFrom) {
    whereClauses.push(`date(COALESCE(NULLIF(pb.received_at, ''), substr(pb.created_at, 1, 10))) >= date(?)`)
    queryParams.push(dateFrom)
  }
  if (dateTo) {
    whereClauses.push(`date(COALESCE(NULLIF(pb.received_at, ''), substr(pb.created_at, 1, 10))) <= date(?)`)
    queryParams.push(dateTo)
  }
  if (keyword) {
    const likeValue = `%${keyword}%`
    if (filterField === 'supplier') {
      whereClauses.push(`LOWER(COALESCE(pb.supplier, '')) LIKE ?`)
      queryParams.push(likeValue)
    } else if (filterField === 'purchase_order_no') {
      whereClauses.push(`LOWER(COALESCE(pb.purchase_order_no, '')) LIKE ?`)
      queryParams.push(likeValue)
    } else if (filterField === 'color') {
      whereClauses.push(`LOWER(COALESCE(pb.color, '')) LIKE ?`)
      queryParams.push(likeValue)
    } else if (filterField === 'remark') {
      whereClauses.push(`(
        LOWER(COALESCE(pb.remark, '')) LIKE ?
        OR LOWER(COALESCE(pb.color_remark, '')) LIKE ?
      )`)
      queryParams.push(likeValue, likeValue)
    } else {
      whereClauses.push(`(
        LOWER(COALESCE(pb.batch_no, '')) LIKE ?
        OR LOWER(COALESCE(pb.purchase_order_no, '')) LIKE ?
        OR LOWER(COALESCE(m.code, '')) LIKE ?
        OR LOWER(COALESCE(m.name, '')) LIKE ?
        OR LOWER(COALESCE(pb.remark, '')) LIKE ?
        OR LOWER(COALESCE(pb.color_remark, '')) LIKE ?
      )`)
      queryParams.push(likeValue, likeValue, likeValue, likeValue, likeValue, likeValue)
    }
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const cacheKey = `purchaseBatches:list:${JSON.stringify({ filterField, keyword, supplier, materialCategory, documentStatus, dateFrom, dateTo, limit })}`

  return getCachedQueryResult(cacheKey, () => {
    return db.prepare(`
    SELECT
      pb.*,
      COALESCE(after_sale_out.out_qty, 0) AS after_sale_out_qty,
      COALESCE(after_sale_in.ref_count, 0) AS after_sale_in_ref_count,
      parent.batch_no AS parent_batch_no,
      m.code AS material_code,
      m.name AS material_name,
      m.major_category AS material_major_category,
      m.category AS material_category,
      m.sub_category AS material_sub_category,
      m.leaf_category AS material_leaf_category,
      m.unit AS material_default_unit,
      m.width AS material_width,
      m.weight AS material_weight,
      m.meter_per_kg AS material_meter_per_kg,
      m.adjustment_type AS material_adjustment_type,
      m.left_gap AS material_left_gap,
      m.right_gap AS material_right_gap,
      m.gap_ratio AS material_gap_ratio,
      pb.factory_name,
      pb.factory_allocated_qty
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    LEFT JOIN purchase_batches parent ON parent.id = pb.parent_batch_id
    LEFT JOIN (
      SELECT purchase_batch_id, ROUND(COALESCE(SUM(qty), 0), 6) AS out_qty
      FROM purchase_batch_after_sales
      WHERE LOWER(TRIM(COALESCE(type, ''))) IN ('return', 'exchange')
      GROUP BY purchase_batch_id
    ) after_sale_out ON after_sale_out.purchase_batch_id = pb.id
    LEFT JOIN (
      SELECT in_batch_id, COUNT(*) AS ref_count
      FROM purchase_batch_after_sales
      WHERE COALESCE(in_batch_id, 0) > 0
      GROUP BY in_batch_id
    ) after_sale_in ON after_sale_in.in_batch_id = pb.id
    ${whereSql}
    ORDER BY datetime(pb.created_at) DESC, pb.id DESC
    LIMIT ${limit}
  `).all(...queryParams).map((row) => {
    const allocations = getPurchaseBatchAllocations(row.id)
    return {
      ...row,
      allocations,
      factory_name: allocations.map((item) => cleanText(item.factory_name)).filter(Boolean).join('、') || row.factory_name,
      factory_allocated_qty: allocations.reduce((sum, item) => sum + Number(resolveFactoryAllocationQtyFromRollCount(row, item, row) || 0), 0) || Number(row.factory_allocated_qty || 0)
    }
  })
  }, 5000)
}

ipcMain.handle('db:getPurchaseBatches', (_event, params) => getPurchaseBatches(params || {}))

function getInventorySummary(params = {}) {
  const excludeProductionOrderId = Number(
    params.exclude_production_order_id
    || params.excludeProductionOrderId
    || params.exclude_order_id
    || params.excludeOrderId
    || 0
  )
  const cacheKey = `inventory:summary:${excludeProductionOrderId || 0}`
  return getCachedQueryResult(cacheKey, () => {
    const clearedRows = db.prepare(`
      SELECT
        material_id,
        COALESCE(NULLIF(TRIM(color), ''), '未分色') AS color,
        COALESCE(NULLIF(TRIM(size), ''), '') AS size,
        COALESCE(NULLIF(TRIM(supplier), ''), '') AS supplier
      FROM inventory_cleared_rows
    `).all()
    const clearedKeySet = new Set(
      clearedRows.map((row) => buildInventoryRowKey(row.material_id, row.color, row.size, row.supplier))
    )
    const clearedBatchIdSet = new Set(
      db.prepare(`
        SELECT batch_id
        FROM inventory_cleared_batches
        WHERE COALESCE(batch_id, 0) > 0
      `).all().map((row) => Number(row.batch_id || 0)).filter((value) => value > 0)
    )
    const allPurchaseBatches = db.prepare(`
        SELECT
          pb.id,
          pb.material_id,
          pb.gross_qty,
          pb.remaining_qty,
          pb.unit,
          pb.color,
          pb.size,
          pb.price_type,
          pb.roll_count,
          pb.supplier,
          pb.purchase_input_qty,
          pb.purchase_input_unit,
          pb.actual_input_qty,
          pb.actual_input_unit,
          pb.received_at
        FROM purchase_batches pb
        WHERE LOWER(TRIM(COALESCE(pb.document_status, 'draft'))) = 'approved'
        ORDER BY date(pb.received_at) ASC, pb.id ASC
      `).all()

    const batches = applyPendingPreallocationsToInventoryBatches(
      getApprovedBatchInventoryEntries({
        exclude_production_order_id: excludeProductionOrderId
      }),
      {
        exclude_production_order_id: excludeProductionOrderId
      }
    )

    const inTransitBatches = db.prepare(`
      SELECT
        pb.id,
        pb.batch_no,
        pb.material_id,
        pb.gross_qty,
        pb.remaining_qty,
        pb.unit,
        pb.purchase_order_no,
        pb.supplier,
        pb.warehouse_name,
        pb.color,
        pb.size,
        pb.color_remark,
        pb.price_type,
        pb.roll_count,
        pb.purchase_input_qty,
        pb.purchase_input_unit,
        pb.actual_input_qty,
        pb.actual_input_unit,
        pb.price,
        pb.price_unit,
        pb.raw_unit_price,
        pb.base_unit_price,
        pb.processing_cost,
        pb.processing_cost_per_unit,
        pb.processing_note,
        pb.factory_name,
        pb.factory_allocated_qty,
        pb.parent_batch_id,
        pb.source_batch_no,
        pb.effective_unit_price,
        pb.total_amount,
        pb.received_at,
        pb.remark,
        pb.document_status,
        m.name AS material_name,
        m.code AS material_code,
        m.image_path AS material_image_path
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
      WHERE LOWER(TRIM(COALESCE(pb.document_status, 'draft'))) = 'submitted'
      ORDER BY date(pb.received_at) ASC, pb.id ASC
    `).all().map((item) => {
      const allocations = getPurchaseBatchAllocations(item.id)
      const actualInputUnit = normalizeUnit(item.actual_input_unit || item.purchase_input_unit || item.unit)
      const allocatedQty = round(
        allocations.reduce((sum, allocation) => sum + Number(resolveFactoryAllocationQtyFromRollCount(item, allocation, item) || 0), 0),
        4
      )
      const allocatedInputQty = round(
        allocations.reduce((sum, allocation) => {
          const fallbackInputQty = tryConvertQuantity(
            Number(allocation.allocated_qty || 0),
            normalizeUnit(item.unit),
            actualInputUnit,
            item,
            0
          )
          return sum + Number(resolveFactoryAllocationInputQty(item, {
            ...allocation,
            input_allocated_qty: fallbackInputQty
          }) || 0)
        }, 0),
        4
      )
      const allocatedRollCount = round(
        allocations.reduce((sum, allocation) => sum + Number(allocation.allocated_roll_count || 0), 0),
        4
      )
      const warehouseQty = round(Math.max(Number(item.actual_input_qty || item.purchase_input_qty || item.gross_qty || 0) - allocatedInputQty, 0), 4)
      return {
        ...item,
        allocations: allocations.map((allocation) => ({
          ...allocation,
          allocated_qty: resolveFactoryAllocationQtyFromRollCount(item, allocation, item),
          input_allocated_qty: resolveFactoryAllocationInputQty(item, {
            ...allocation,
            input_allocated_qty: tryConvertQuantity(
              Number(allocation.allocated_qty || 0),
              normalizeUnit(item.unit),
              actualInputUnit,
              item,
              0
            )
          })
        })),
        allocated_qty: allocatedQty,
        allocated_input_qty: allocatedInputQty,
        allocated_roll_count: allocatedRollCount,
        warehouse_qty: warehouseQty,
        adjustment_summary: buildAdjustmentSummary(item)
      }
    })

    const materialLocationMap = new Map()
    batches.forEach((item) => {
      const key = buildInventoryRowKey(item.material_id, item.color || '未分色', item.size || '', item.supplier_name || item.supplier || '')
      const current = materialLocationMap.get(key) || {
        factory_remaining_qty: 0,
        warehouse_remaining_qty: 0,
        pre_allocated_qty: 0,
        factory_pre_allocated_qty: 0,
        warehouse_pre_allocated_qty: 0,
        factory_available_after_prealloc_qty: 0,
        warehouse_available_after_prealloc_qty: 0,
        factory_names: []
      }
      current.factory_remaining_qty += Number(item.factory_remaining_qty || 0)
      current.warehouse_remaining_qty += Number(item.warehouse_remaining_qty || 0)
      current.pre_allocated_qty += Number(item.pre_allocated_qty || 0)
      current.factory_pre_allocated_qty += Number(item.factory_pre_allocated_qty || 0)
      current.warehouse_pre_allocated_qty += Number(item.warehouse_pre_allocated_qty || 0)
      current.factory_available_after_prealloc_qty += Number(item.factory_available_after_prealloc_qty || 0)
      current.warehouse_available_after_prealloc_qty += Number(item.warehouse_available_after_prealloc_qty || 0)
      ;(item.allocations || []).forEach((allocation) => {
        if (allocation.factory_name) current.factory_names.push(cleanText(allocation.factory_name))
      })
      materialLocationMap.set(key, current)
    })

    const materialRows = getMaterialStockSummary().map((item) => {
      const relatedBatches = allPurchaseBatches.filter((batch) =>
        Number(batch.material_id) === Number(item.material_id)
        && String(batch.color || '未分色') === String(item.color || '未分色')
        && normalizeInventorySize(batch.size) === normalizeInventorySize(item.size)
        && cleanText(batch.supplier) === cleanText(item.supplier_name || item.supplier)
      )
      const relatedVisibleBatches = batches.filter((batch) =>
        Number(batch.material_id) === Number(item.material_id)
        && String(batch.color || '未分色') === String(item.color || '未分色')
        && normalizeInventorySize(batch.size) === normalizeInventorySize(item.size)
        && cleanText(batch.supplier_name || batch.supplier) === cleanText(item.supplier_name || item.supplier)
      )
      const purchaseDisplayParts = summarizeBatchQtyByUnit(
        relatedBatches,
        (batch) => Number(batch.purchase_input_qty || batch.gross_qty || 0),
        (batch) => batch.purchase_input_unit || batch.unit || item.unit
      )
      const actualDisplayParts = summarizeBatchQtyByUnit(
        relatedBatches,
        (batch) => {
          if (String(batch.price_type || '') === 'sample') {
            return Number(batch.purchase_input_qty || batch.actual_input_qty || batch.gross_qty || 0)
          }
          return Number(batch.actual_input_qty || batch.purchase_input_qty || batch.gross_qty || 0)
        },
        (batch) => {
          if (String(batch.price_type || '') === 'sample') {
            return batch.purchase_input_unit || batch.actual_input_unit || batch.unit || item.unit
          }
          return batch.actual_input_unit || batch.purchase_input_unit || batch.unit || item.unit
        }
      )
      const purchasedInputQty = round(relatedBatches.reduce((sum, batch) => {
        const inputUnit = normalizeUnit(batch.purchase_input_unit || batch.unit || item.unit)
        return sum + tryConvertQuantity(Number(batch.purchase_input_qty || 0), inputUnit, normalizeUnit(item.unit), batch, 0)
      }, 0), 4)
      const actualInputQty = round(relatedBatches.reduce((sum, batch) => {
        const actualQty = String(batch.price_type || '') === 'sample'
          ? Number(batch.purchase_input_qty || batch.actual_input_qty || batch.gross_qty || 0)
          : Number(batch.actual_input_qty || batch.purchase_input_qty || batch.gross_qty || 0)
        const actualUnit = String(batch.price_type || '') === 'sample'
          ? normalizeUnit(batch.purchase_input_unit || batch.actual_input_unit || batch.unit || item.unit)
          : normalizeUnit(batch.actual_input_unit || batch.purchase_input_unit || batch.unit || item.unit)
        return sum + tryConvertQuantity(actualQty, actualUnit, normalizeUnit(item.unit), batch, 0)
      }, 0), 4)
      const latestRelatedBatch = [...relatedBatches].sort((a, b) => String(b.received_at || '').localeCompare(String(a.received_at || '')))[0]
      const supplierName = cleanText(item.supplier_name || latestRelatedBatch?.supplier || item.supplier)
      const location = materialLocationMap.get(buildInventoryRowKey(
        item.material_id,
        item.color,
        item.size,
        supplierName
      )) || {}
      const factoryRemainingQty = round(Number(location.factory_remaining_qty || 0), 4)
      const warehouseRemainingQty = round(Number(location.warehouse_remaining_qty || 0), 4)
      const preAllocatedQty = round(Number(location.pre_allocated_qty || 0), 4)
      const factoryPreAllocatedQty = round(Number(location.factory_pre_allocated_qty || 0), 4)
      const warehousePreAllocatedQty = round(Number(location.warehouse_pre_allocated_qty || 0), 4)
      const factoryAvailableAfterPreallocQty = round(Number(location.factory_available_after_prealloc_qty || 0), 4)
      const warehouseAvailableAfterPreallocQty = round(Number(location.warehouse_available_after_prealloc_qty || 0), 4)
      const availableAfterPreallocQty = round(factoryAvailableAfterPreallocQty + warehouseAvailableAfterPreallocQty, 4)
      const factoryUsedQty = round(relatedVisibleBatches.reduce((sum, batch) => sum + Number(batch.consumed_qty || 0), 0), 4)
      const sentToFactoryQty = round(factoryRemainingQty + factoryUsedQty, 4)
      const shouldHideAdjustment = relatedBatches.length > 0 && relatedBatches.every((batch) => String(batch.price_type || '') === 'sample')
      return {
        ...item,
        material_code: cleanText(item.material_code || item.code),
        material_name: cleanText(item.material_name || item.name),
        supplier_name: supplierName,
        image_path: cleanText(item.image_path || item.material_image_path || latestRelatedBatch?.material_image_path),
        material_image_path: cleanText(item.material_image_path || item.image_path || latestRelatedBatch?.material_image_path),
        base_unit: normalizeUnit(item.base_unit || item.unit),
        sent_to_factory_qty: sentToFactoryQty,
        current_stock_qty: round(Number(item.stock_qty || 0), 4),
        pre_allocated_qty: preAllocatedQty,
        factory_pre_allocated_qty: factoryPreAllocatedQty,
        warehouse_pre_allocated_qty: warehousePreAllocatedQty,
        factory_available_after_prealloc_qty: factoryAvailableAfterPreallocQty,
        warehouse_available_after_prealloc_qty: warehouseAvailableAfterPreallocQty,
        available_after_prealloc_qty: availableAfterPreallocQty,
        avg_cost_price: Number(item.avg_unit_cost || 0),
        purchased_input_qty: purchasedInputQty,
        historical_purchased_qty: purchasedInputQty,
        historical_actual_qty: actualInputQty,
        purchase_display_text: formatDisplayQtyByUnit(purchaseDisplayParts),
        actual_display_text: formatDisplayQtyByUnit(actualDisplayParts),
        hide_adjustment_summary: shouldHideAdjustment,
        factory_name: [...new Set((location.factory_names || []).filter(Boolean))].join('、'),
        factory_used_qty: factoryUsedQty,
        factory_remaining_qty: factoryRemainingQty,
        warehouse_remaining_qty: warehouseRemainingQty,
        resolved_meters_per_kg: resolveMetersPerKg(item),
        issued_meters: round(tryConvertQuantity(Number(item.issued_qty || 0), normalizeUnit(item.unit), '米', item, 0), 4),
        stock_meters: round(tryConvertQuantity(Number(item.stock_qty || 0), normalizeUnit(item.unit), '米', item, 0), 4),
        pre_allocated_meters: round(tryConvertQuantity(preAllocatedQty, normalizeUnit(item.unit), '米', item, 0), 4),
        available_after_prealloc_meters: round(tryConvertQuantity(availableAfterPreallocQty, normalizeUnit(item.unit), '米', item, 0), 4),
        factory_remaining_meters: round(tryConvertQuantity(factoryRemainingQty, normalizeUnit(item.unit), '米', item, 0), 4),
        warehouse_remaining_meters: round(tryConvertQuantity(warehouseRemainingQty, normalizeUnit(item.unit), '米', item, 0), 4)
      }
    })

    const summaryCards = [
      { label: '库存条目', value: String(materialRows.length), note: '当前库存汇总行数' },
      {
        label: '实际库存',
        value: formatServerQty(materialRows.reduce((sum, item) => sum + Number(item.current_stock_qty || 0), 0), 2),
        note: '已审核库存合计'
      },
      {
        label: '预领用',
        value: formatServerQty(materialRows.reduce((sum, item) => sum + Number(item.pre_allocated_qty || 0), 0), 2),
        note: '已提交生产单占用'
      },
      {
        label: '预领后可用',
        value: formatServerQty(materialRows.reduce((sum, item) => sum + Number(item.available_after_prealloc_qty || 0), 0), 2),
        note: '实际库存减去预领用'
      }
    ]

    return {
      summaryCards,
      materials: materialRows,
      batches: batches.filter((item) => {
        if (clearedBatchIdSet.has(Number(item.id || 0))) return false
        return !clearedKeySet.has(buildInventoryRowKey(
          item.material_id,
          item.color || '未分色',
          item.size || '',
          item.supplier_name || item.supplier || ''
        ))
      }).sort(compareBatchNoDesc),
      inTransit: inTransitBatches,
      inTransitBatches
    }
  }, 5000)
}

ipcMain.handle('db:getInventorySummary', (_event, payload = {}) => getInventorySummary(payload || {}))
ipcMain.handle('db:verifyInventoryStock', (_event, payload = {}) => {
  assertWritable('核实库存')
  const batchId = Number(payload.batch_id || payload.id || 0)
  const verifiedQty = round(Number(payload.verified_qty ?? payload.qty ?? 0), 6)
  if (!batchId) throw new Error('请选择要核实库存的批次')
  if (!Number.isFinite(verifiedQty) || verifiedQty < 0) throw new Error('核实库存数量不能小于 0')

  const select = db.prepare(`
    SELECT pb.*, m.code AS material_code, m.name AS material_name
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE pb.id=?
  `)
  const tx = db.transaction(() => {
    const before = select.get(batchId)
    if (!before) throw new Error('未找到对应采购批次')
    if (normalizeDocumentStatus(before.document_status) !== 'approved') {
      throw new Error('只有已审核入库的批次才能核实库存')
    }

    const currentRemaining = round(Number(before.remaining_qty || 0), 6)
    if (verifiedQty > currentRemaining + 0.000001) {
      throw new Error(
        `核实库存不能大于扣除生产成衣后的剩余量，当前最多可核实 ${formatServerQtyWithUnit(currentRemaining, before.unit)}`
      )
    }

    db.prepare('UPDATE purchase_batches SET remaining_qty=? WHERE id=?').run(verifiedQty, batchId)
    db.prepare('DELETE FROM inventory_cleared_batches WHERE batch_id=?').run(batchId)
    const after = select.get(batchId)
    const diffQty = round(verifiedQty - currentRemaining, 6)
    logInventoryMovement({
      movement_type: '核实库存',
      direction: diffQty >= 0 ? 'in' : 'out',
      material_id: before.material_id,
      batch_id: before.id,
      material_code: before.material_code,
      material_name: before.material_name,
      color: normalizeInventoryColor(before.color),
      qty: Math.abs(diffQty),
      unit: before.unit,
      balance_after: verifiedQty,
      source_table: 'purchase_batch',
      source_id: before.id,
      source_no: before.batch_no,
      document_status: before.document_status,
      remark: cleanText(payload.remark) || `库存核实：${formatServerQtyWithUnit(currentRemaining, before.unit)} -> ${formatServerQtyWithUnit(verifiedQty, before.unit)}`
    })
    logAudit('出仓入仓', '核实库存', 'purchase_batch', batchId, cleanText(after?.batch_no), before, after, cleanText(payload.remark))
  })
  tx()
  bumpDataRevision()
  runPostWriteMaintenance().catch(() => {})
  return { success: true }
})
ipcMain.handle('db:clearInventoryResidue', (_event, payload = {}) => {
  assertWritable('清空库存台账残余')
  const scope = cleanText(payload.scope || (payload.batch_id ? 'batch' : 'material'))
  if (scope === 'batch') {
    const batchId = Number(payload.batch_id || 0)
    if (!batchId) throw new Error('请选择要清空的批次')
    db.transaction(() => {
      db.prepare(`DELETE FROM inventory_cleared_batches WHERE batch_id=?`).run(batchId)
      db.prepare(`
        INSERT INTO inventory_cleared_batches (batch_id, created_at)
        VALUES (?, CURRENT_TIMESTAMP)
      `).run(batchId)
    })()
  } else {
    const materialId = Number(payload.material_id || 0)
    if (!materialId) throw new Error('请选择要清空的原料')
    const color = cleanText(payload.color) || '未分色'
    const size = cleanText(payload.size)
    const supplier = cleanText(payload.supplier)
    db.transaction(() => {
      db.prepare(`
        DELETE FROM inventory_cleared_rows
        WHERE material_id=?
          AND color=?
          AND size=?
          AND supplier=?
      `).run(materialId, color, size, supplier)
      db.prepare(`
        INSERT INTO inventory_cleared_rows (material_id, color, size, supplier, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(materialId, color, size, supplier)
    })()
  }
  bumpDataRevision()
  return { success: true }
})
ipcMain.handle('db:getInventoryMovements', (_event, params) => getInventoryMovements(params || {}))
ipcMain.handle('db:getAuditLogs', (_event, params) => getAuditLogs(params || {}))

ipcMain.handle('db:getNextBatchNo', () => nextSerial(batchNoPrefix(), 'purchase_batches', 'batch_no'))
ipcMain.handle('db:getNextPurchaseOrderNo', () => nextSerial(purchaseOrderNoPrefix(), 'purchase_batches', 'purchase_order_no'))
ipcMain.handle('db:getNextProductionOrderNo', () => nextSerial(orderNoPrefix(), 'production_orders', 'order_no'))
ipcMain.handle('db:previewEffectivePrice', (e, payload) => {
  const material = payload?.material_id ? getMaterialById(payload.material_id) : null
  const previewActualQty = material ? resolvePurchaseActualInputQty(payload, material) : Number(payload?.actual_input_qty || payload?.purchase_input_qty || payload?.gross_qty || 0)
  const grossQty = material ? resolvePurchaseGrossQty({
    ...payload,
    actual_input_qty: previewActualQty,
    actual_input_unit: normalizeUnit(payload?.actual_input_unit || payload?.purchase_input_unit || payload?.unit || material?.unit || '米')
  }, material) : Number(payload?.gross_qty || 0)
  const rawUnitPrice = material ? resolvePriceToMaterialUnit(payload, material) : Number(payload?.price || 0)
  const processingCost = Number(payload?.processing_cost || 0)
  const processingCostPerUnit = grossQty > 0 ? round(processingCost / grossQty, 6) : 0
  const effectivePayload = material
    ? buildAdjustmentPayloadFromMaterial(material, {
        ...payload,
        price: round(rawUnitPrice + processingCostPerUnit, 6)
      })
    : payload
  return calculateEffectivePrice(effectivePayload)
})

ipcMain.handle('db:savePurchaseBatch', (e, payload) => {
  assertWritable('保存采购批次')
  const material = getMaterialById(payload.material_id)
  if (!material) throw new Error('物料不存在')

  const rollCount = Math.max(Number(payload.roll_count || 0), 0)
  const priceUnit = normalizeUnit(payload.price_unit || material.unit || '米')
  const materialUnit = normalizeUnit(material.unit || payload.unit || '米')
  const purchaseInputUnit = normalizeUnit(payload.purchase_input_unit || priceUnit || materialUnit)
  const purchaseInputQty = Number(payload.purchase_input_qty ?? payload.gross_qty ?? 0)
  const actualInputUnit = purchaseInputUnit
  const actualInputQty = resolvePurchaseActualInputQty({
    ...payload,
    purchase_input_qty: purchaseInputQty,
    purchase_input_unit: purchaseInputUnit,
    actual_input_unit: actualInputUnit,
    roll_count: rollCount
  }, material)
  const grossQty = resolvePurchaseGrossQty({
    ...payload,
    actual_input_qty: actualInputQty,
    actual_input_unit: actualInputUnit,
    purchase_input_qty: purchaseInputQty,
    purchase_input_unit: purchaseInputUnit
  }, material)
  if (grossQty <= 0) throw new Error('采购数量必须大于 0')
  const pricedQty = resolvePurchasePricedQty({
    ...payload,
    purchase_input_qty: purchaseInputQty,
    purchase_input_unit: purchaseInputUnit,
    price_unit: priceUnit
  }, material)
  const settlementAmount = round(pricedQty * Number(payload.price || 0), 4)
  const rawUnitPrice = grossQty > 0 ? round(settlementAmount / grossQty, 6) : 0
  const processingCost = Number(payload.processing_cost || 0)
  const processingCostPerUnit = grossQty > 0 ? round(processingCost / grossQty, 6) : 0
  const baseUnitPrice = grossQty > 0 ? round((settlementAmount + processingCost) / grossQty, 6) : 0
  const pricingPayload = buildAdjustmentPayloadFromMaterial(material, {
    ...payload,
    price: baseUnitPrice
  })
  const effectiveUnitPrice = calculateEffectivePrice(pricingPayload)
  const totalAmount = round(settlementAmount + processingCost, 4)
  const roundingAdjustment = round(Number(payload.rounding_adjustment || 0), 2)
  const data = {
    ...payload,
    document_status: normalizeDocumentStatus(payload.document_status),
    purchase_order_no: cleanText(payload.purchase_order_no),
    merge_group_id: cleanText(payload.merge_group_id),
    merge_snapshot_json: cleanText(payload.merge_snapshot_json),
    supplier: payload.supplier || material.supplier || '',
    warehouse_name: cleanText(payload.warehouse_name) || '主仓库',
    color: cleanText(payload.color),
    color_remark: normalizePurchaseColorRemarkText(payload.color_remark),
    size: cleanText(payload.size),
    parent_batch_id: payload.parent_batch_id ? Number(payload.parent_batch_id) : null,
    source_batch_no: cleanText(payload.source_batch_no || payload.batch_no),
    roll_count: rollCount,
    purchase_input_qty: purchaseInputQty,
    purchase_input_unit: purchaseInputUnit,
    actual_input_qty: actualInputQty,
    actual_input_unit: actualInputUnit,
    price: Number(payload.price || 0),
    price_unit: priceUnit,
    price_type: cleanText(payload.price_type) || 'bulk',
    raw_unit_price: rawUnitPrice,
    base_unit_price: baseUnitPrice,
    processing_cost: processingCost,
    processing_cost_per_unit: processingCostPerUnit,
    processing_note: cleanText(payload.processing_note),
    gross_qty: grossQty,
    unit: materialUnit,
    adjustment_type: pricingPayload.adjustment_type,
    left_gap: pricingPayload.left_gap,
    right_gap: pricingPayload.right_gap,
    gap_ratio: pricingPayload.gap_ratio,
    custom_formula: pricingPayload.custom_formula,
    effective_unit_price: effectiveUnitPrice,
    total_amount: totalAmount,
    rounding_adjustment: roundingAdjustment,
    remaining_qty: grossQty,
    review_images_json: safeJsonStringify(
      compressStoredImageList(payload.review_images || payload.review_images_json, { maxEdge: 2400, quality: 90, minLength: 500 * 1024 }),
      '[]'
    )
  }

  seedOptionValue('supplier', data.supplier)

  if (payload.id) {
    const existing = db.prepare('SELECT * FROM purchase_batches WHERE id=?').get(payload.id)
    if (!existing) throw new Error('采购批次不存在')
    if (normalizeDocumentStatus(existing.document_status) === 'approved') {
      throw new Error('已审核采购单据不能编辑')
    }
    const consumedQty = round(Number(existing.gross_qty || 0) - Number(existing.remaining_qty || 0), 4)
    const nextRemaining = round(grossQty - consumedQty, 4)
    if (nextRemaining < 0) throw new Error('采购数量不能小于已被生产单占用的数量')
    data.remaining_qty = nextRemaining
    if (!cleanText(payload.warehouse_name)) {
      data.warehouse_name = cleanText(existing.warehouse_name) || '主仓库'
    }
    if (!data.merge_group_id) {
      data.merge_group_id = cleanText(existing.merge_group_id)
    }
    if (!data.merge_snapshot_json) {
      data.merge_snapshot_json = cleanText(existing.merge_snapshot_json)
    }
    if (data.review_images_json === '[]' && existing.review_images_json) {
      data.review_images_json = existing.review_images_json
    }
    db.prepare(`
      UPDATE purchase_batches
      SET
        batch_no=@batch_no,
        document_status=@document_status,
        review_images_json=@review_images_json,
        material_id=@material_id,
        purchase_order_no=@purchase_order_no,
        merge_group_id=@merge_group_id,
        merge_snapshot_json=@merge_snapshot_json,
        supplier=@supplier,
        warehouse_name=@warehouse_name,
        color=@color,
        color_remark=@color_remark,
        size=@size,
        gross_qty=@gross_qty,
        remaining_qty=@remaining_qty,
        unit=@unit,
        price=@price,
        price_unit=@price_unit,
        price_type=@price_type,
        raw_unit_price=@raw_unit_price,
        base_unit_price=@base_unit_price,
        processing_cost=@processing_cost,
        processing_cost_per_unit=@processing_cost_per_unit,
        processing_note=@processing_note,
        parent_batch_id=@parent_batch_id,
        source_batch_no=@source_batch_no,
        roll_count=@roll_count,
        purchase_input_qty=@purchase_input_qty,
        purchase_input_unit=@purchase_input_unit,
        actual_input_qty=@actual_input_qty,
        actual_input_unit=@actual_input_unit,
        adjustment_type=@adjustment_type,
        left_gap=@left_gap,
        right_gap=@right_gap,
        gap_ratio=@gap_ratio,
        custom_formula=@custom_formula,
        effective_unit_price=@effective_unit_price,
        total_amount=@total_amount,
        rounding_adjustment=@rounding_adjustment,
        received_at=@received_at,
        remark=@remark
      WHERE id=@id
    `).run(data)
    const saved = db.prepare(`
      SELECT pb.*, m.code AS material_code, m.name AS material_name
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
      WHERE pb.id=?
    `).get(payload.id)
    const stockDelta = round(Number(saved.remaining_qty || 0) - Number(existing.remaining_qty || 0), 6)
    if (normalizeDocumentStatus(saved.document_status) === 'approved' && Math.abs(stockDelta) > 0.0001) {
      logInventoryMovement({
        movement_type: '采购调整',
        direction: stockDelta >= 0 ? 'in' : 'out',
        material_id: saved.material_id,
        batch_id: saved.id,
        material_code: saved.material_code,
        material_name: saved.material_name,
        color: saved.color,
        qty: Math.abs(stockDelta),
        unit: saved.unit,
        balance_after: saved.remaining_qty,
        source_table: 'purchase_batches',
        source_id: saved.id,
        source_no: saved.batch_no,
        document_status: saved.document_status,
        remark: '编辑采购批次后自动校正库存'
      })
    }
    logAudit('采购批次', '编辑采购批次', 'purchase_batch', Number(saved.id), cleanText(saved.batch_no), existing, saved)
    runPostWriteMaintenance().catch(() => {})
    return payload.id
  }

  const insertedId = normalizeInsertId(db.prepare(`
    INSERT INTO purchase_batches (
      batch_no,
      document_status,
      review_images_json,
      material_id,
      purchase_order_no,
      merge_group_id,
      merge_snapshot_json,
      supplier,
      warehouse_name,
      color,
      color_remark,
      size,
      gross_qty,
      remaining_qty,
      unit,
      price,
      price_unit,
      price_type,
      raw_unit_price,
      base_unit_price,
      processing_cost,
      processing_cost_per_unit,
      processing_note,
      parent_batch_id,
      source_batch_no,
      roll_count,
      purchase_input_qty,
      purchase_input_unit,
      actual_input_qty,
      actual_input_unit,
      adjustment_type,
      left_gap,
      right_gap,
      gap_ratio,
      custom_formula,
      effective_unit_price,
      total_amount,
      rounding_adjustment,
      received_at,
      remark
    ) VALUES (
      @batch_no,
      @document_status,
      @review_images_json,
      @material_id,
      @purchase_order_no,
      @merge_group_id,
      @merge_snapshot_json,
      @supplier,
      @warehouse_name,
      @color,
      @color_remark,
      @size,
      @gross_qty,
      @remaining_qty,
      @unit,
      @price,
      @price_unit,
      @price_type,
      @raw_unit_price,
      @base_unit_price,
      @processing_cost,
      @processing_cost_per_unit,
      @processing_note,
      @parent_batch_id,
      @source_batch_no,
      @roll_count,
      @purchase_input_qty,
      @purchase_input_unit,
      @actual_input_qty,
      @actual_input_unit,
      @adjustment_type,
      @left_gap,
      @right_gap,
      @gap_ratio,
      @custom_formula,
      @effective_unit_price,
      @total_amount,
      @rounding_adjustment,
      @received_at,
      @remark
    )
  `).run(data).lastInsertRowid)
  const saved = db.prepare(`
    SELECT pb.*, m.code AS material_code, m.name AS material_name
    FROM purchase_batches pb
    JOIN materials m ON m.id = pb.material_id
    WHERE pb.id=?
  `).get(insertedId)
  if (normalizeDocumentStatus(saved.document_status) === 'approved') {
    logInventoryMovement({
      movement_type: '采购入库',
      direction: 'in',
      material_id: saved.material_id,
      batch_id: saved.id,
      material_code: saved.material_code,
      material_name: saved.material_name,
      color: saved.color,
      qty: saved.gross_qty,
      unit: saved.unit,
      balance_after: saved.remaining_qty,
      source_table: 'purchase_batches',
      source_id: saved.id,
      source_no: saved.batch_no,
      document_status: saved.document_status,
      remark: '新增采购批次入库'
    })
  }
  logAudit('采购批次', '新增采购批次', 'purchase_batch', insertedId, cleanText(saved.batch_no), null, saved)
  runPostWriteMaintenance().catch(() => {})
  return insertedId
})

ipcMain.handle('db:mergePurchaseBatches', (e, payload = {}) => {
  assertWritable('合并采购单')
  const result = db.transaction((input) => {
    const targetIds = [...new Set((input.target_ids || []).map((item) => Number(item)).filter(Boolean))]
    const sourceIds = [...new Set((input.source_ids || []).map((item) => Number(item)).filter(Boolean))]
    if (!targetIds.length || !sourceIds.length) throw new Error('请至少选择两张采购单进行合并')

    const allIds = [...new Set([...targetIds, ...sourceIds])]
    const rows = allIds.map((id) => db.prepare(`
      SELECT pb.*, m.code AS material_code, m.name AS material_name
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
      WHERE pb.id=?
    `).get(id)).filter(Boolean)
    if (rows.length !== allIds.length) throw new Error('部分采购批次不存在，无法合并')

    const suppliers = [...new Set(rows.map((item) => cleanText(item.supplier)).filter(Boolean))]
    if (suppliers.length !== 1) throw new Error('仅支持合并同一供应商的采购单')

    const invalidRow = rows.find((item) => {
      const status = normalizeDocumentStatus(item.document_status)
      return status === 'approved' || status === 'voided'
    })
    if (invalidRow) {
      throw new Error(`采购单【${cleanText(invalidRow.purchase_order_no || invalidRow.batch_no)}】已审核或已作废，不能合并`)
    }

    const targetRows = rows.filter((item) => targetIds.includes(Number(item.id)))
    const sourceRows = rows.filter((item) => sourceIds.includes(Number(item.id)))
    if (!targetRows.length || !sourceRows.length) throw new Error('请选择有效的目标采购单和来源采购单')

    const targetSeed = [...targetRows].sort((a, b) => Number(a.id || 0) - Number(b.id || 0))[0]
    const targetPurchaseOrderNo = cleanText(targetSeed.purchase_order_no || targetSeed.batch_no)
    if (!targetPurchaseOrderNo) throw new Error('目标采购单号为空，不能合并')

    const mergedRemark = [...new Set(rows.map((item) => cleanText(item.remark)).filter(Boolean))].join('\n')
    const targetReceivedAt = cleanText(targetSeed.received_at)
    const totalRounding = round(rows.reduce((sum, item) => sum + Number(item.rounding_adjustment || 0), 0), 2)
    const mergeGroupId = `merge_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

    const updateCore = db.prepare(`
      UPDATE purchase_batches
      SET purchase_order_no=?,
          supplier=?,
          received_at=?,
          remark=?,
          rounding_adjustment=?,
          merge_group_id=?,
          merge_snapshot_json=?
      WHERE id=?
    `)
    rows.forEach((row) => {
      const mergeSnapshot = JSON.stringify({
        purchase_order_no: cleanText(row.purchase_order_no),
        supplier: cleanText(row.supplier),
        received_at: cleanText(row.received_at),
        remark: cleanText(row.remark),
        rounding_adjustment: Number(row.rounding_adjustment || 0)
      })
      updateCore.run(
        targetPurchaseOrderNo,
        suppliers[0],
        targetReceivedAt,
        mergedRemark,
        Number(row.id) === Number(targetSeed.id) ? totalRounding : 0,
        mergeGroupId,
        mergeSnapshot,
        row.id
      )
      db.prepare(`UPDATE purchase_batches SET color_remark=? WHERE id=?`).run(
        normalizePurchaseColorRemarkText(row.color_remark),
        row.id
      )
    })

    const afterRows = allIds.map((id) => db.prepare(`
      SELECT pb.*, m.code AS material_code, m.name AS material_name
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
      WHERE pb.id=?
    `).get(id)).filter(Boolean)

    afterRows.forEach((after) => {
      const before = rows.find((item) => Number(item.id) === Number(after.id)) || null
      logAudit('采购批次', '合并采购单', 'purchase_batch', Number(after.id), cleanText(after.batch_no), before, after)
    })

    return {
      success: true,
      target_purchase_order_no: targetPurchaseOrderNo,
      merged_documents: [...new Set(rows.map((item) => cleanText(item.purchase_order_no || item.batch_no)).filter(Boolean))].length,
      merged_batches: rows.length,
      supplier: suppliers[0],
      merge_group_id: mergeGroupId
    }
  })(payload)
  runPostWriteMaintenance().catch(() => {})
  return result
})

ipcMain.handle('db:unmergePurchaseBatches', (e, payload = {}) => {
  assertWritable('取消合并采购单')
  const result = db.transaction((input) => {
    const ids = [...new Set((input.ids || []).map((item) => Number(item)).filter(Boolean))]
    if (!ids.length) throw new Error('请选择要取消合并的采购单')

    const rows = ids.map((id) => db.prepare(`
      SELECT pb.*, m.code AS material_code, m.name AS material_name
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
      WHERE pb.id=?
    `).get(id)).filter(Boolean)
    if (!rows.length) throw new Error('未找到可取消合并的采购批次')

    const mergeGroups = [...new Set(rows.map((item) => cleanText(item.merge_group_id)).filter(Boolean))]
    if (mergeGroups.length !== 1) throw new Error('请选择同一组合并后的采购单进行取消合并')
    const mergeGroupId = mergeGroups[0]
    const mergedRows = db.prepare(`
      SELECT pb.*, m.code AS material_code, m.name AS material_name
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
      WHERE TRIM(COALESCE(pb.merge_group_id, '')) = ?
      ORDER BY pb.id ASC
    `).all(mergeGroupId)
    if (!mergedRows.length) throw new Error('未找到对应的合并记录')

    const invalid = mergedRows.find((item) => {
      const status = normalizeDocumentStatus(item.document_status)
      return status === 'approved' || status === 'voided'
    })
    if (invalid) {
      throw new Error(`采购单【${cleanText(invalid.purchase_order_no || invalid.batch_no)}】已审核或已作废，不能取消合并`)
    }

    const restoreStmt = db.prepare(`
      UPDATE purchase_batches
      SET purchase_order_no=?,
          supplier=?,
          received_at=?,
          remark=?,
          rounding_adjustment=?,
          merge_group_id='',
          merge_snapshot_json=''
      WHERE id=?
    `)

    mergedRows.forEach((row) => {
      let snapshot = {}
      try {
        snapshot = JSON.parse(String(row.merge_snapshot_json || '{}')) || {}
      } catch {}
      restoreStmt.run(
        cleanText(snapshot.purchase_order_no),
        cleanText(snapshot.supplier),
        cleanText(snapshot.received_at),
        cleanText(snapshot.remark),
        Number(snapshot.rounding_adjustment || 0),
        row.id
      )
    })

    const restoredRows = mergedRows.map((row) => db.prepare(`
      SELECT pb.*, m.code AS material_code, m.name AS material_name
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
      WHERE pb.id=?
    `).get(row.id)).filter(Boolean)

    restoredRows.forEach((after, index) => {
      const before = mergedRows[index] || null
      logAudit('采购批次', '取消合并采购单', 'purchase_batch', Number(after.id), cleanText(after.batch_no), before, after)
    })

    return {
      success: true,
      restored_documents: [...new Set(restoredRows.map((item) => cleanText(item.purchase_order_no || item.batch_no)).filter(Boolean))].length,
      restored_batches: restoredRows.length
    }
  })(payload)
  runPostWriteMaintenance().catch(() => {})
  return result
})

ipcMain.handle('db:splitPurchaseBatch', (e, payload = {}) => {
  assertWritable('拆分采购批次')
  return db.transaction((input) => {
    const sourceId = Number(input.source_batch_id || 0)
    const splitQty = Number(input.split_qty || 0)
    if (!sourceId) throw new Error('请选择要拆分的采购批次')
    if (splitQty <= 0) throw new Error('拆分数量必须大于 0')

    const source = db.prepare(`
      SELECT *
      FROM purchase_batches
      WHERE id=?
    `).get(sourceId)
    if (!source) throw new Error('来源采购批次不存在')
    if (normalizeDocumentStatus(source.document_status) === 'approved') {
      throw new Error('已审核采购单据不能拆分')
    }
    if (splitQty > Number(source.remaining_qty || 0)) throw new Error('拆分数量不能大于该批次当前剩余库存')

    const childBatchNo = cleanText(input.batch_no) || nextSerial(batchNoPrefix(), 'purchase_batches', 'batch_no')
    const processingCost = Number(input.processing_cost || 0)
    const processingCostPerUnit = splitQty > 0 ? round(processingCost / splitQty, 6) : 0
    const rawUnitPrice = Number(source.raw_unit_price || source.base_unit_price || 0)
    const baseUnitPrice = round(rawUnitPrice + processingCostPerUnit, 6)
    const effectiveUnitPrice = calculateEffectivePrice({
      adjustment_type: source.adjustment_type,
      left_gap: Number(source.left_gap || 0),
      right_gap: Number(source.right_gap || 0),
      gap_ratio: Number(source.gap_ratio || 1),
      custom_formula: source.custom_formula,
      price: baseUnitPrice
    })

    const sourceOriginalGrossQty = Number(source.gross_qty || 0)
    const sourceOriginalInputQty = Number(source.purchase_input_qty || source.gross_qty || 0)
    const childInputQty = sourceOriginalGrossQty > 0
      ? round(sourceOriginalInputQty * (splitQty / sourceOriginalGrossQty), 4)
      : splitQty
    const sourceInputQty = round(Math.max(sourceOriginalInputQty - childInputQty, 0), 4)
    const sourceGrossQty = round(sourceOriginalGrossQty - splitQty, 4)
    const sourceRemainingQty = round(Number(source.remaining_qty || 0) - splitQty, 4)
    if (sourceGrossQty < 0 || sourceRemainingQty < 0) throw new Error('拆分后来源批次数量不能为负数')

    db.prepare(`
      UPDATE purchase_batches
      SET
        actual_input_qty=@actual_input_qty,
        actual_input_unit=@actual_input_unit,
        gross_qty=@gross_qty,
        remaining_qty=@remaining_qty,
        purchase_input_qty=@purchase_input_qty,
        total_amount=@total_amount
      WHERE id=@id
    `).run({
      id: sourceId,
      actual_input_qty: sourceGrossQty,
      actual_input_unit: normalizeUnit(source.actual_input_unit || source.purchase_input_unit || source.unit),
      gross_qty: sourceGrossQty,
      remaining_qty: sourceRemainingQty,
      purchase_input_qty: sourceInputQty,
      total_amount: round(sourceGrossQty * Number(source.base_unit_price || 0), 4)
    })

    const result = db.prepare(`
      INSERT INTO purchase_batches (
        batch_no,
        document_status,
        material_id,
        purchase_order_no,
        supplier,
        color,
        color_remark,
        parent_batch_id,
        source_batch_no,
        purchase_input_qty,
        purchase_input_unit,
        actual_input_qty,
        actual_input_unit,
        size,
        gross_qty,
        remaining_qty,
        unit,
        price,
        price_unit,
        price_type,
        raw_unit_price,
        base_unit_price,
        processing_cost,
        processing_cost_per_unit,
        processing_note,
        adjustment_type,
        left_gap,
        right_gap,
        gap_ratio,
        custom_formula,
        effective_unit_price,
        total_amount,
        received_at,
        remark
      ) VALUES (
        @batch_no,
        @document_status,
        @material_id,
        @purchase_order_no,
        @supplier,
        @color,
        @color_remark,
        @parent_batch_id,
        @source_batch_no,
        @purchase_input_qty,
        @purchase_input_unit,
        @actual_input_qty,
        @actual_input_unit,
        @gross_qty,
        @remaining_qty,
        @unit,
        @price,
        @price_unit,
        @price_type,
        @raw_unit_price,
        @base_unit_price,
        @processing_cost,
        @processing_cost_per_unit,
        @processing_note,
        @adjustment_type,
        @left_gap,
        @right_gap,
        @gap_ratio,
        @custom_formula,
        @effective_unit_price,
        @total_amount,
        @received_at,
        @remark
      )
    `).run({
      batch_no: childBatchNo,
      document_status: normalizeDocumentStatus(input.document_status || source.document_status),
      material_id: source.material_id,
      purchase_order_no: cleanText(input.purchase_order_no || source.purchase_order_no),
      supplier: cleanText(input.supplier || source.supplier),
      color: cleanText(input.color || source.color),
      color_remark: normalizePurchaseColorRemarkText(input.color_remark || source.color_remark),
      parent_batch_id: source.id,
      source_batch_no: cleanText(source.source_batch_no || source.batch_no),
      purchase_input_qty: childInputQty,
      purchase_input_unit: normalizeUnit(source.purchase_input_unit || source.price_unit || source.unit),
      actual_input_qty: splitQty,
      actual_input_unit: normalizeUnit(source.actual_input_unit || source.purchase_input_unit || source.unit),
      size: cleanText(input.size || source.size),
      gross_qty: splitQty,
      remaining_qty: splitQty,
      unit: source.unit,
      price: Number(source.price || 0),
      price_unit: normalizeUnit(source.price_unit || source.unit),
      price_type: cleanText(source.price_type) || 'bulk',
      raw_unit_price: rawUnitPrice,
      base_unit_price: baseUnitPrice,
      processing_cost: processingCost,
      processing_cost_per_unit: processingCostPerUnit,
      processing_note: cleanText(input.processing_note),
      adjustment_type: source.adjustment_type,
      left_gap: Number(source.left_gap || 0),
      right_gap: Number(source.right_gap || 0),
      gap_ratio: Number(source.gap_ratio || 1),
      custom_formula: source.custom_formula,
      effective_unit_price: effectiveUnitPrice,
      total_amount: round(splitQty * baseUnitPrice, 4),
      received_at: cleanText(input.received_at || source.received_at),
      remark: cleanText(input.remark)
    })
    const insertedId = normalizeInsertId(result.lastInsertRowid)
    const child = db.prepare(`
      SELECT pb.*, m.code AS material_code, m.name AS material_name
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
      WHERE pb.id=?
    `).get(insertedId)
    const refreshedSource = db.prepare(`
      SELECT pb.*, m.code AS material_code, m.name AS material_name
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
      WHERE pb.id=?
    `).get(sourceId)
    logInventoryMovement({
      movement_type: '拆批转出',
      direction: 'out',
      material_id: refreshedSource.material_id,
      batch_id: refreshedSource.id,
      material_code: refreshedSource.material_code,
      material_name: refreshedSource.material_name,
      color: refreshedSource.color,
      qty: splitQty,
      unit: refreshedSource.unit,
      balance_after: refreshedSource.remaining_qty,
      source_table: 'purchase_batches',
      source_id: refreshedSource.id,
      source_no: refreshedSource.batch_no,
      document_status: refreshedSource.document_status,
      remark: `拆分到批次 ${child.batch_no}`
    })
    logInventoryMovement({
      movement_type: '拆批转入',
      direction: 'in',
      material_id: child.material_id,
      batch_id: child.id,
      material_code: child.material_code,
      material_name: child.material_name,
      color: child.color,
      qty: child.gross_qty,
      unit: child.unit,
      balance_after: child.remaining_qty,
      source_table: 'purchase_batches',
      source_id: child.id,
      source_no: child.batch_no,
      document_status: child.document_status,
      remark: `来源批次 ${refreshedSource.batch_no}`
    })
    logAudit('采购批次', '拆分采购批次', 'purchase_batch', insertedId, cleanText(child.batch_no), source, child)
    runPostWriteMaintenance().catch(() => {})
    return insertedId
  })(payload)
})

ipcMain.handle('db:deletePurchaseBatch', (e, id) => {
  assertWritable('删除采购批次')
  const result = db.transaction((batchId) => {
    const before = db.prepare(`
      SELECT pb.*, m.code AS material_code, m.name AS material_name
      FROM purchase_batches pb
      JOIN materials m ON m.id = pb.material_id
      WHERE pb.id=?
    `).get(batchId)
    if (!before) return 0
    if (normalizeDocumentStatus(before.document_status) === 'approved') {
      throw new Error('已审核采购单据不能删除')
    }

    const productionRefs = db.prepare(`
      SELECT
        pom.id AS allocation_id,
        pom.order_id,
        COALESCE(NULLIF(TRIM(po.order_no), ''), '未编号生产单') AS order_no,
        COALESCE(NULLIF(TRIM(po.style_no), ''), '') AS style_no,
        COALESCE(NULLIF(TRIM(po.product_name), ''), '') AS product_name,
        LOWER(TRIM(COALESCE(po.document_status, 'draft'))) AS document_status
      FROM production_order_materials pom
      JOIN production_orders po ON po.id = pom.order_id
      WHERE pom.batch_id=?
      ORDER BY pom.order_id DESC, pom.id DESC
    `).all(batchId)

    const blockingRefs = productionRefs.filter((item) => item.document_status !== 'draft')
    if (blockingRefs.length) {
      const preview = blockingRefs.slice(0, 5).map((item) => {
        const suffix = cleanText(item.style_no || item.product_name)
        return suffix ? `${item.order_no}（${suffix}）` : item.order_no
      }).join('、')
      const extra = blockingRefs.length > 5 ? ` 等 ${blockingRefs.length} 张生产单` : ''
      throw new Error(`该采购批次已被生产单引用：${preview}${extra}，请先处理对应生产单后再删除`)
    }

    if (productionRefs.length) {
      db.prepare(`
        UPDATE production_order_materials
        SET batch_id=NULL,
            allocated_qty=0,
            unit_cost=0,
            line_cost=0,
            price_source_label='',
            cost_price_type=COALESCE(NULLIF(TRIM(cost_price_type), ''), 'bulk')
        WHERE batch_id=?
      `).run(batchId)
    }

    const afterSaleRefs = db.prepare(`
      SELECT COUNT(*) AS c
      FROM purchase_batch_after_sales
      WHERE purchase_batch_id=?
         OR in_batch_id=?
    `).get(batchId, batchId).c
    if (afterSaleRefs) {
      throw new Error('该采购批次已有供应商退回/换货记录，不能直接删除；如需调整请通过供应商换货、核实库存或新增修正批次处理')
    }

    const childRefs = db.prepare('SELECT COUNT(*) AS c FROM purchase_batches WHERE parent_batch_id=?').get(batchId).c
    if (childRefs) {
      const childRows = db.prepare(`
        SELECT COALESCE(NULLIF(TRIM(batch_no), ''), '未编号批次') AS batch_no
        FROM purchase_batches
        WHERE parent_batch_id=?
        ORDER BY id DESC
        LIMIT 5
      `).all(batchId)
      const preview = childRows.map((item) => item.batch_no).join('、')
      const extra = childRefs > 5 ? ` 等 ${childRefs} 个子批次` : ''
      throw new Error(`该采购批次已拆分出子批次：${preview}${extra}，请先处理子批次后再删除`)
    }

    db.prepare('DELETE FROM purchase_batch_factory_allocations WHERE purchase_batch_id=?').run(batchId)
    const changes = db.prepare('DELETE FROM purchase_batches WHERE id=?').run(batchId).changes
    if (changes) {
      logInventoryMovement({
        movement_type: '删除批次',
        direction: 'out',
        material_id: before.material_id,
        batch_id: before.id,
        material_code: before.material_code,
        material_name: before.material_name,
        color: before.color,
        qty: before.remaining_qty,
        unit: before.unit,
        balance_after: 0,
        source_table: 'purchase_batches',
        source_id: before.id,
        source_no: before.batch_no,
        document_status: before.document_status,
        remark: productionRefs.length ? '删除采购批次（已解除草稿生产单引用）' : '删除采购批次'
      })
      logAudit('采购批次', '删除采购批次', 'purchase_batch', Number(batchId), cleanText(before.batch_no), before, null)
    }
    return changes
  })(id)
  if (result) {
    runPostWriteMaintenance().catch(() => {})
  }
  return result
})

ipcMain.handle('db:getOptionLists', () => getOptionLists())
ipcMain.handle('db:saveOptionValue', (e, type, value) => {
  assertWritable('保存下拉选项')
  return saveOptionValue(type, value)
})
ipcMain.handle('db:renameOptionValue', (e, type, oldValue, newValue) => {
  assertWritable('修改下拉选项')
  return renameOptionValue(type, oldValue, newValue)
})
ipcMain.handle('db:deleteOptionValue', (e, type, value) => {
  assertWritable('删除下拉选项')
  return deleteOptionValue(type, value)
})
ipcMain.handle('db:reorderOptionValues', (e, type, values) => {
  assertWritable('调整下拉选项顺序')
  return reorderOptionValues(type, values)
})
ipcMain.handle('db:getWorkspaceInfo', () => getWorkspaceInfo())
ipcMain.handle('db:optimizeStorage', async () => {
  assertWritable('执行数据库瘦身')
  if (!storageOptimizationPromise) {
    storageOptimizationPromise = optimizeDatabaseStorageInBackground()
      .then(async () => {
        await performPostWriteMaintenance().catch(() => {})
      })
      .finally(() => {
        storageOptimizationPromise = null
      })
  }
  return {
    started: true,
    ...getStorageOptimizationState(),
    workspace_info: getWorkspaceInfo()
  }
})
ipcMain.handle('db:getOptimizeStorageStatus', () => ({
  ...getStorageOptimizationState(),
  workspace_info: getWorkspaceInfo()
}))
ipcMain.handle('db:syncLocalDatabaseBackup', async () => {
  const backupPath = await syncLocalDatabaseBackup()
  return {
    backup_path: backupPath,
    workspace_info: getWorkspaceInfo()
  }
})
ipcMain.handle('db:chooseWorkspaceDirectory', async () => {
  const currentInfo = getWorkspaceInfo()
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择本地或局域网共享工作目录',
    defaultPath: currentInfo.workspace_path,
    properties: ['openDirectory', 'createDirectory']
  })

  if (canceled || !filePaths?.[0]) return null

  const nextWorkspacePath = filePaths[0]
  const nextDbPath = resolveDatabasePath(nextWorkspacePath)
  const currentDbPath = dbPath
  const targetExists = fs.existsSync(nextDbPath)

  if (path.resolve(nextDbPath) !== path.resolve(currentDbPath) && !targetExists) {
    await backupDatabaseFile(nextDbPath)
  }

  applyWorkspaceSelection(nextWorkspacePath, false)
  writeWorkspaceConfig({
    preferredSharedWorkspacePath: isNetworkWorkspacePath(nextWorkspacePath) ? nextWorkspacePath : '',
    offlineMode: false,
    offlinePendingSync: false,
    offlineConflict: false,
    offlineBaseSharedSignature: null
  })
  await syncLocalDatabaseBackup()
  scheduleAppRestart()

  return {
    ...getWorkspaceInfo(),
    switched: true,
    copied_current_database: !targetExists
  }
})
ipcMain.handle('db:setupSimpleLanShare', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择局域网共享文件夹',
    defaultPath: app.getPath('desktop'),
    properties: ['openDirectory', 'createDirectory']
  })

  if (canceled || !filePaths?.[0]) return null

  const rootPath = filePaths[0]
  const sharedWorkspacePath = resolveSelectedWorkspacePath(rootPath)
  ensureDirectory(sharedWorkspacePath)

  const nextDbPath = resolveDatabasePath(sharedWorkspacePath)
  const targetExists = fs.existsSync(nextDbPath)
  if (path.resolve(nextDbPath) !== path.resolve(dbPath) && !targetExists) {
    await backupDatabaseFile(nextDbPath)
  }

  applyWorkspaceSelection(sharedWorkspacePath, false)
  const lanServicePort = LAN_BRIDGE_DEFAULT_PORT
  const lanServiceHost = normalizeLanHost(getClientName(), lanServicePort)
  writeWorkspaceConfig({
    preferredSharedWorkspacePath: sharedWorkspacePath,
    hostComputerName: getClientName(),
    hostWorkspacePath: sharedWorkspacePath,
    lanServiceEnabled: true,
    lanServicePort,
    lanServiceHost,
    preferLanService: false,
    offlineMode: false,
    offlinePendingSync: false,
    offlineConflict: false
  })
  writeSharedWorkspaceInfo(sharedWorkspacePath, {
    workspacePath: sharedWorkspacePath,
    databasePath: nextDbPath,
    hostComputerName: getClientName(),
    hostWorkspacePath: sharedWorkspacePath,
    lanServiceEnabled: true,
    lanServicePort,
    lanServiceHost
  })
  const backupPath = await syncLocalDatabaseBackup()
  scheduleAppRestart()

  return {
    workspace_path: sharedWorkspacePath,
    database_path: nextDbPath,
    local_backup_path: backupPath,
    copied_current_database: !targetExists,
    instruction: '其他电脑只需要打开软件后点击“局域网共享一键设置”，选择同一个共享文件夹即可。'
  }
})
ipcMain.handle('db:openWorkspaceReadOnly', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择共享数据库文件夹（只读模式）',
    defaultPath: app.getPath('desktop'),
    properties: ['openDirectory']
  })

  if (canceled || !filePaths?.[0]) return null

  const targetWorkspacePath = resolveSelectedWorkspacePath(filePaths[0])
  const nextDbPath = resolveDatabasePath(targetWorkspacePath)
  if (!fs.existsSync(nextDbPath)) {
    throw new Error('所选共享目录中没有找到数据库，请先在主电脑执行“局域网共享一键设置”')
  }

  validateDatabaseFile(nextDbPath)
  const sharedInfo = readSharedWorkspaceInfo(targetWorkspacePath)
  const resolvedHostComputerName = cleanText(sharedInfo?.hostComputerName || readWorkspaceConfig()?.hostComputerName || '')
  const resolvedLanPort = normalizeLanPort(sharedInfo?.lanServicePort)
  const resolvedLanHost = normalizeLanHost(sharedInfo?.lanServiceHost || resolvedHostComputerName, resolvedLanPort)
  applyWorkspaceSelection(targetWorkspacePath, true)
  writeWorkspaceConfig({
    preferredSharedWorkspacePath: targetWorkspacePath,
    hostComputerName: resolvedHostComputerName,
    hostWorkspacePath: cleanText(sharedInfo?.hostWorkspacePath || targetWorkspacePath),
    lanServiceEnabled: Boolean(sharedInfo?.lanServiceEnabled),
    lanServicePort: resolvedLanPort,
    lanServiceHost: resolvedLanHost,
    preferLanService: Boolean(resolvedLanHost),
    offlineMode: false,
    offlinePendingSync: false,
    offlineConflict: false
  })
  await syncLocalDatabaseBackup()
  scheduleAppRestart()

  return {
    ...getWorkspaceInfo(),
    switched: true,
    instruction: '当前电脑将以只读模式打开共享数据库，只能查看，不能修改。'
  }
})
ipcMain.handle('db:setCurrentComputerAsHost', async () => {
  const currentConfig = readWorkspaceConfig()
  const sharedWorkspacePath = cleanText(
    isNetworkWorkspacePath(workspacePath)
      ? workspacePath
      : currentConfig?.preferredSharedWorkspacePath || currentConfig?.hostWorkspacePath || ''
  )
  const lanServicePort = normalizeLanPort(currentConfig?.lanServicePort)
  const lanServiceHost = normalizeLanHost(getClientName(), lanServicePort)
  writeWorkspaceConfig({
    hostComputerName: getClientName(),
    hostWorkspacePath: sharedWorkspacePath,
    preferredSharedWorkspacePath: sharedWorkspacePath || cleanText(currentConfig?.preferredSharedWorkspacePath || ''),
    lanServiceEnabled: true,
    lanServicePort,
    lanServiceHost,
    preferLanService: false,
    offlineConflict: false
  })
  if (sharedWorkspacePath) {
    writeSharedWorkspaceInfo(sharedWorkspacePath, {
      workspacePath: sharedWorkspacePath,
      databasePath: resolveDatabasePath(sharedWorkspacePath),
      hostComputerName: getClientName(),
      hostWorkspacePath: sharedWorkspacePath,
      lanServiceEnabled: true,
      lanServicePort,
      lanServiceHost
    })
  }
  await syncLocalDatabaseBackup().catch(() => {})
  return {
    ...getWorkspaceInfo(),
    message: '当前电脑已设为主机。其他电脑连接同一共享目录时，会把这里识别为主机。'
  }
})
ipcMain.handle('db:tryOfflineAutoSync', async () => attemptOfflineAutoSync())
ipcMain.handle('db:exportDatabaseFile', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出完整数据库文件',
    defaultPath: path.join(app.getPath('documents'), `garment-ems-${localDateCode()}.gemsdb`),
    filters: [
      { name: 'Garment EMS 数据库', extensions: ['gemsdb', 'db', 'sqlite'] }
    ]
  })

  if (canceled || !filePath) return null
  await backupDatabaseFile(filePath)
  return filePath
})
ipcMain.handle('db:importDatabaseFile', async () => {
  assertWritable('恢复数据库')
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择完整数据库文件',
    properties: ['openFile'],
    filters: [
      { name: 'Garment EMS 数据库', extensions: ['gemsdb', 'db', 'sqlite'] }
    ]
  })

  if (canceled || !filePaths?.[0]) return null

  const sourceFilePath = filePaths[0]
  validateDatabaseFile(sourceFilePath)

  const importFilePath = `${dbPath}.importing`
  if (fs.existsSync(importFilePath)) fs.unlinkSync(importFilePath)
  fs.copyFileSync(sourceFilePath, importFilePath)
  validateDatabaseFile(importFilePath)

  databaseSwitching = true
  try {
    safelyCloseDatabase(db)
    db = null
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    fs.renameSync(importFilePath, dbPath)
    db = openDatabase(dbPath, workspaceReadOnly)
    bumpDataRevision()
    await syncLocalDatabaseBackup()
  } finally {
    databaseSwitching = false
  }
  scheduleAppRestart()

  return {
    file_path: sourceFilePath,
    restored_to: dbPath,
    restarted: true
  }
})
ipcMain.handle('db:copyBackupText', () => {
  const text = encodeBackupText(buildBackupPayload())
  clipboard.writeText(text)
  return true
})
ipcMain.handle('db:exportBackupText', () => encodeBackupText(buildBackupPayload()))
ipcMain.handle('db:exportBackupFile', async () => {
  const text = encodeBackupText(buildBackupPayload())
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出数据备份文件',
    defaultPath: path.join(app.getPath('documents'), `garment-ems-backup-${localDateCode()}.gemsbak.txt`),
    filters: [
      { name: 'Garment EMS 备份', extensions: ['txt', 'gemsbak'] }
    ]
  })

  if (canceled || !filePath) return null
  fs.writeFileSync(filePath, text, 'utf8')
  return filePath
})
ipcMain.handle('db:importBackupText', (e, text) => {
  assertWritable('恢复备份文本')
  const payload = decodeBackupText(text)
  importBackupPayload(payload)
  refreshProductionOrdersIfNeeded(true)
  return true
})
ipcMain.handle('db:importBackupFile', async () => {
  assertWritable('恢复备份文件')
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择数据备份文件',
    properties: ['openFile'],
    filters: [
      { name: 'Garment EMS 备份', extensions: ['txt', 'gemsbak'] }
    ]
  })

  if (canceled || !filePaths?.[0]) return null
  const text = fs.readFileSync(filePaths[0], 'utf8')
  const payload = decodeBackupText(text)
  importBackupPayload(payload)
  refreshProductionOrdersIfNeeded(true)
  return filePaths[0]
})

ipcMain.handle('db:getConsumptionRecords', () => getConsumptionRecords())
ipcMain.handle('db:saveConsumptionRecord', (e, payload) => {
  assertWritable('保存单耗记录')
  return saveConsumptionRecord(payload)
})
ipcMain.handle('db:deleteConsumptionRecord', (e, id) => {
  assertWritable('删除单耗记录')
  return db.prepare('DELETE FROM consumption_records WHERE id=?').run(id).changes
})

ipcMain.handle('db:getProductionOrders', (_event, params) => getProductionOrders(params || {}))
ipcMain.handle('db:getProductionOrderDetail', (e, orderId) => getProductionOrderById(orderId))
ipcMain.handle('db:updateProductionOrderStatus', (e, payload = {}) => {
  assertWritable('修改生产单状态')
  const orderId = Number(payload.id || 0)
  if (!orderId) throw new Error('生产单不存在')
  const before = getProductionOrderStatusSnapshot(orderId)
  if (!before) throw new Error('生产单不存在')

  const nextStatus = normalizeProductionStatus(payload.status)
  const nextDocumentStatus = Object.prototype.hasOwnProperty.call(payload, 'document_status')
    ? normalizeDocumentStatus(payload.document_status)
    : null
  const hasPendingDate = Object.prototype.hasOwnProperty.call(payload, 'pending_date')
  const hasCutDate = Object.prototype.hasOwnProperty.call(payload, 'cut_date')
  const hasCompletedDate = Object.prototype.hasOwnProperty.call(payload, 'completed_date')
  const hasActualOutput = Object.prototype.hasOwnProperty.call(payload, 'actual_output_qty')
  const hasCutOutput = Object.prototype.hasOwnProperty.call(payload, 'cut_output_qty')
  const hasCutSizeBreakdown = Object.prototype.hasOwnProperty.call(payload, 'cut_size_breakdown')
  const hasActualSizeBreakdown = Object.prototype.hasOwnProperty.call(payload, 'actual_size_breakdown')

  if (hasActualOutput || hasCutOutput || hasCutSizeBreakdown || hasActualSizeBreakdown || hasPendingDate || hasCutDate || hasCompletedDate) {
    db.prepare(`
      UPDATE production_orders
      SET
        status=@status,
        document_status=@document_status,
        pending_date=@pending_date,
        cut_date=@cut_date,
        completed_date=@completed_date,
        cut_output_qty=@cut_output_qty,
        cut_size_breakdown=@cut_size_breakdown,
        actual_size_breakdown=@actual_size_breakdown,
        actual_output_qty=@actual_output_qty
      WHERE id=@id
    `).run({
      id: orderId,
        status: nextStatus,
        document_status: nextDocumentStatus || before?.document_status || 'draft',
      pending_date: hasPendingDate
        ? cleanText(payload.pending_date)
        : cleanText(before?.pending_date || ''),
      cut_date: hasCutDate
        ? cleanText(payload.cut_date)
        : cleanText(before?.cut_date || ''),
      completed_date: hasCompletedDate
        ? cleanText(payload.completed_date)
        : cleanText(before?.completed_date || ''),
      cut_output_qty: hasCutOutput
        ? (payload.cut_output_qty === null || payload.cut_output_qty === '' ? null : Number(payload.cut_output_qty || 0))
        : before?.cut_output_qty ?? null,
      cut_size_breakdown: hasCutSizeBreakdown
        ? cleanText(payload.cut_size_breakdown)
        : before?.cut_size_breakdown ?? '',
      actual_size_breakdown: hasActualSizeBreakdown
        ? cleanText(payload.actual_size_breakdown)
        : before?.actual_size_breakdown ?? '',
      actual_output_qty: payload.actual_output_qty === null || payload.actual_output_qty === ''
        ? (hasActualOutput ? null : before?.actual_output_qty ?? null)
        : Number(payload.actual_output_qty || 0)
    })
  } else {
    db.prepare(`
      UPDATE production_orders
      SET status=@status, document_status=@document_status
      WHERE id=@id
    `).run({
      id: orderId,
      status: nextStatus,
      document_status: nextDocumentStatus || before?.document_status || 'draft'
    })
  }

  const inputMaterials = Array.isArray(payload.materials) ? payload.materials : null
  const shouldRewritePlanItems = Array.isArray(inputMaterials) && inputMaterials.length
    ? !areProductionPlanItemsEquivalent(orderId, inputMaterials)
    : false

  const saved = db.transaction((id, materials, shouldRewrite) => {
    if (shouldRewrite && Array.isArray(materials) && materials.length) {
      saveProductionPlanItems(id, materials)
    }
    recalculateOrder(id, 'none')
    return getProductionOrderStatusSnapshot(id)
  })(orderId, inputMaterials, shouldRewritePlanItems)
  logAudit('生产制单', '更新生产状态', 'production_order', orderId, cleanText(saved?.order_no), before, saved)
  runPostWriteMaintenance().catch(() => {})
  return saved
})

ipcMain.handle('db:saveProductionOrder', (e, payload) => {
  assertWritable('保存生产制单')
  const result = db.transaction((input) => createOrUpdateProductionOrder(input))(payload)
  runPostWriteMaintenance().catch(() => {})
  return result
})

ipcMain.handle('db:deleteProductionOrder', (e, orderId) => {
  assertWritable('删除生产制单')
  const result = db.transaction((id) => deleteProductionOrder(id))(orderId)
  runPostWriteMaintenance().catch(() => {})
  return result
})

function getLanBridgeConfig() {
  return buildLanBridgeConfig({
    ...readSharedWorkspaceInfo(workspacePath),
    ...readWorkspaceConfig()
  })
}

function updateLanBridgeConfig(payload = {}) {
  const currentConfig = readWorkspaceConfig()
  const shouldPreferRemote = Object.prototype.hasOwnProperty.call(payload, 'prefer_remote')
    ? Boolean(payload.prefer_remote)
    : Boolean(currentConfig?.preferLanService)
  const nextConfig = {
    hostComputerName: Object.prototype.hasOwnProperty.call(payload, 'host_computer_name')
      ? cleanText(payload.host_computer_name)
      : shouldPreferRemote
        ? ''
        : cleanText(currentConfig?.hostComputerName || ''),
    hostWorkspacePath: cleanText(currentConfig?.hostWorkspacePath || ''),
    preferredSharedWorkspacePath: cleanText(currentConfig?.preferredSharedWorkspacePath || ''),
    lanServiceEnabled: Object.prototype.hasOwnProperty.call(payload, 'enabled')
      ? Boolean(payload.enabled)
      : Boolean(currentConfig?.lanServiceEnabled),
    lanServicePort: normalizeLanPort(
      Object.prototype.hasOwnProperty.call(payload, 'port')
        ? payload.port
        : currentConfig?.lanServicePort
    ),
    lanServiceHost: normalizeLanHost(
      Object.prototype.hasOwnProperty.call(payload, 'host')
        ? payload.host
        : currentConfig?.lanServiceHost || currentConfig?.hostComputerName || '',
      Object.prototype.hasOwnProperty.call(payload, 'port')
        ? payload.port
        : currentConfig?.lanServicePort
    ),
    preferLanService: shouldPreferRemote
  }
  writeWorkspaceConfig(nextConfig)
  if (cleanText(nextConfig.hostComputerName || currentConfig?.hostComputerName || '') === getClientName()) {
    writeSharedWorkspaceInfo(workspacePath, {
      hostComputerName: cleanText(nextConfig.hostComputerName || currentConfig?.hostComputerName || ''),
      hostWorkspacePath: cleanText(nextConfig.hostWorkspacePath || currentConfig?.hostWorkspacePath || workspacePath),
      lanServiceEnabled: nextConfig.lanServiceEnabled,
      lanServicePort: nextConfig.lanServicePort,
      lanServiceHost: nextConfig.lanServiceHost
    })
  }
  return getLanBridgeConfig()
}

const LAN_CHANNEL_HANDLERS = {
  'auth:login': (payload = {}) => loginUser(payload),
  'auth:getUsers': () => getUsers(),
  'auth:saveUser': (payload = {}) => {
    assertWritable('保存账号')
    return saveUser(payload)
  },
  'auth:deleteUser': (id) => {
    assertWritable('删除账号')
    return deleteUser(id)
  },
  'db:getDashboardStats': () => getDashboardStats(),
  'db:getMaterials': () => getMaterials(),
  'db:getGarments': () => getGarments(),
  'db:getBomsByGarment': (garmentId) => getBomsByGarment(garmentId),
  'db:getPurchaseBatches': (params = {}) => getPurchaseBatches(params || {}),
  'db:getInventorySummary': (params = {}) => getInventorySummary(params || {}),
  'db:getInventoryMovements': (params = {}) => getInventoryMovements(params || {}),
  'db:getAuditLogs': (params = {}) => getAuditLogs(params || {}),
  'db:getOptionLists': () => getOptionLists(),
  'db:saveOptionValue': (type, value) => {
    assertWritable('保存下拉选项')
    return saveOptionValue(type, value)
  },
  'db:renameOptionValue': (type, oldValue, newValue) => {
    assertWritable('修改下拉选项')
    return renameOptionValue(type, oldValue, newValue)
  },
  'db:deleteOptionValue': (type, value) => {
    assertWritable('删除下拉选项')
    return deleteOptionValue(type, value)
  },
  'db:reorderOptionValues': (type, values) => {
    assertWritable('调整下拉选项顺序')
    return reorderOptionValues(type, values)
  },
  'db:getConsumptionRecords': () => getConsumptionRecords(),
  'db:getProductionOrders': (params = {}) => getProductionOrders(params || {}),
  'db:getProductionOrderDetail': (orderId) => getProductionOrderById(orderId),
  'db:updateProductionOrderStatus': (payload = {}) => {
    assertWritable('修改生产单状态')
    const orderId = Number(payload.id || 0)
    if (!orderId) throw new Error('生产单不存在')
    const before = getProductionOrderById(orderId)
    const nextStatus = normalizeProductionStatus(payload.status)
    const nextDocumentStatus = Object.prototype.hasOwnProperty.call(payload, 'document_status')
      ? normalizeDocumentStatus(payload.document_status)
      : null
    const hasPendingDate = Object.prototype.hasOwnProperty.call(payload, 'pending_date')
    const hasCutDate = Object.prototype.hasOwnProperty.call(payload, 'cut_date')
    const hasCompletedDate = Object.prototype.hasOwnProperty.call(payload, 'completed_date')
    const hasActualOutput = Object.prototype.hasOwnProperty.call(payload, 'actual_output_qty')
    const hasCutOutput = Object.prototype.hasOwnProperty.call(payload, 'cut_output_qty')
    const hasCutSizeBreakdown = Object.prototype.hasOwnProperty.call(payload, 'cut_size_breakdown')
    const hasActualSizeBreakdown = Object.prototype.hasOwnProperty.call(payload, 'actual_size_breakdown')
    if (hasActualOutput || hasCutOutput || hasCutSizeBreakdown || hasActualSizeBreakdown || hasPendingDate || hasCutDate || hasCompletedDate) {
      db.prepare(`
        UPDATE production_orders
        SET
          status=@status,
          document_status=@document_status,
          pending_date=@pending_date,
          cut_date=@cut_date,
          completed_date=@completed_date,
          cut_output_qty=@cut_output_qty,
          cut_size_breakdown=@cut_size_breakdown,
          actual_size_breakdown=@actual_size_breakdown,
          actual_output_qty=@actual_output_qty
        WHERE id=@id
      `).run({
        id: orderId,
        status: nextStatus,
        document_status: nextDocumentStatus || before?.document_status || 'draft',
        pending_date: hasPendingDate ? cleanText(payload.pending_date) : cleanText(before?.pending_date || ''),
        cut_date: hasCutDate ? cleanText(payload.cut_date) : cleanText(before?.cut_date || ''),
        completed_date: hasCompletedDate ? cleanText(payload.completed_date) : cleanText(before?.completed_date || ''),
        cut_output_qty: hasCutOutput
          ? (payload.cut_output_qty === null || payload.cut_output_qty === '' ? null : Number(payload.cut_output_qty || 0))
          : db.prepare('SELECT cut_output_qty FROM production_orders WHERE id=?').get(orderId)?.cut_output_qty ?? null,
        cut_size_breakdown: hasCutSizeBreakdown
          ? cleanText(payload.cut_size_breakdown)
          : db.prepare('SELECT cut_size_breakdown FROM production_orders WHERE id=?').get(orderId)?.cut_size_breakdown ?? '',
        actual_size_breakdown: hasActualSizeBreakdown
          ? cleanText(payload.actual_size_breakdown)
          : db.prepare('SELECT actual_size_breakdown FROM production_orders WHERE id=?').get(orderId)?.actual_size_breakdown ?? '',
        actual_output_qty: payload.actual_output_qty === null || payload.actual_output_qty === ''
          ? (hasActualOutput ? null : db.prepare('SELECT actual_output_qty FROM production_orders WHERE id=?').get(orderId)?.actual_output_qty ?? null)
          : Number(payload.actual_output_qty || 0)
      })
    } else {
      db.prepare(`
        UPDATE production_orders
        SET status=@status, document_status=@document_status
        WHERE id=@id
      `).run({
        id: orderId,
        status: nextStatus,
        document_status: nextDocumentStatus || before?.document_status || 'draft'
      })
    }
    const saved = db.transaction((id, materials) => {
      if (Array.isArray(materials) && materials.length) {
        saveProductionPlanItems(id, materials)
      }
      recalculateOrder(id, 'none')
      return getProductionOrderStatusSnapshot(id)
    })(orderId, Array.isArray(payload.materials) ? payload.materials : null)
    logAudit('生产制单', '更新生产状态', 'production_order', orderId, cleanText(saved?.order_no), before, saved)
    runPostWriteMaintenance().catch(() => {})
    return saved
  },
  'db:saveProductionOrder': (payload) => {
    assertWritable('保存生产制单')
    const result = db.transaction((input) => createOrUpdateProductionOrder(input))(payload)
    runPostWriteMaintenance().catch(() => {})
    return result
  },
  'db:deleteProductionOrder': (orderId) => {
    assertWritable('删除生产制单')
    const result = db.transaction((id) => deleteProductionOrder(id))(orderId)
    runPostWriteMaintenance().catch(() => {})
    return result
  }
}

function invokeLanChannel(channel, args = []) {
  const handler = LAN_CHANNEL_HANDLERS[channel]
  if (!handler) throw new Error(`暂不支持局域网桥接通道：${channel}`)
  return handler(...(Array.isArray(args) ? args : []))
}

module.exports = {
  db,
  getWorkspaceInfo,
  getLanBridgeConfig,
  updateLanBridgeConfig,
  invokeLanChannel,
  backupDatabaseFile,
  getProductionOrderById,
  getPurchaseOrderDocumentByBatchId,
  getPurchaseOrderDocumentsByBatchIds,
  getDashboardStats
}

