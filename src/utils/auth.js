export const SESSION_KEY = 'garment_ems_session'
export const REMEMBER_LOGIN_KEY = 'garment_ems_remember_login'
export const SUPER_ADMIN_ROLE = 'super_admin'

export const FEATURE_OPTIONS = [
  { key: 'dashboard', label: '经营总览' },
  { key: 'material', label: '物料资料' },
  { key: 'purchase', label: '采购批次' },
  { key: 'inventory', label: '库存台账' },
  { key: 'inventory_flow', label: '库存流水' },
  { key: 'style', label: '成衣管理' },
  { key: 'bom', label: 'BOM 配置' },
  { key: 'production', label: '生产制单' },
  { key: 'consumption', label: '单耗分析' },
  { key: 'options', label: '基础设置' },
  { key: 'users', label: '账号权限' },
  { key: 'audit', label: '操作审计' }
]

export function getStoredSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY)
    return JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

export function setStoredSession(session) {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session || null))
}

export function clearStoredSession() {
  window.sessionStorage.removeItem(SESSION_KEY)
}

export function getRememberedLogin() {
  try {
    return JSON.parse(window.localStorage.getItem(REMEMBER_LOGIN_KEY) || 'null')
  } catch {
    return null
  }
}

export function setRememberedLogin(payload) {
  window.localStorage.setItem(
    REMEMBER_LOGIN_KEY,
    JSON.stringify({
      username: String(payload?.username || '').trim(),
      password: String(payload?.password || ''),
      remember: Boolean(payload?.remember)
    })
  )
}

export function clearRememberedLogin() {
  window.localStorage.removeItem(REMEMBER_LOGIN_KEY)
}

export function isSuperAdmin(session) {
  return String(session?.role || '') === SUPER_ADMIN_ROLE
}

export function hasFeatureAccess(session, featureKey) {
  if (!featureKey) return true
  if (isSuperAdmin(session)) return true
  const permissions = Array.isArray(session?.permissions) ? session.permissions : []
  return permissions.includes('*') || permissions.includes(featureKey)
}

export function firstAccessiblePath(session) {
  const matched = FEATURE_OPTIONS.find((item) => hasFeatureAccess(session, item.key))
  return matched ? `/${matched.key}` : '/dashboard'
}
