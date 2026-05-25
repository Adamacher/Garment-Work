import { createRouter, createWebHashHistory } from 'vue-router'
import { clearStoredSession, firstAccessiblePath, getStoredSession, hasFeatureAccess } from '@/utils/auth'

const Login = () => import('@/views/Login.vue')
const Dashboard = () => import('@/views/Dashboard.vue')
const Style = () => import('@/views/Style.vue')
const Material = () => import('@/views/Material.vue')
const Inventory = () => import('@/views/Inventory.vue')
const InventoryFlow = () => import('@/views/InventoryFlow.vue')
const FactoryDispatch = () => import('@/views/FactoryDispatch.vue')
const Bom = () => import('@/views/Bom.vue')
const Purchase = () => import('@/views/Purchase.vue')
const Production = () => import('@/views/Production.vue')
const Consumption = () => import('@/views/Consumption.vue')
const Options = () => import('@/views/Options.vue')
const Users = () => import('@/views/Users.vue')
const Audit = () => import('@/views/Audit.vue')
const MainLayout = () => import('@/layouts/MainLayout.vue')

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/login', component: Login, meta: { public: true } },
  {
    path: '/',
    component: MainLayout,
    children: [
      { path: 'dashboard', component: Dashboard, meta: { feature: 'dashboard', keepAlive: true } },
      { path: 'material', component: Material, meta: { feature: 'material', keepAlive: true } },
      { path: 'purchase', component: Purchase, meta: { feature: 'purchase', keepAlive: true } },
      { path: 'inventory', component: Inventory, meta: { feature: 'inventory', keepAlive: true } },
      { path: 'inventory-flow', component: InventoryFlow, meta: { feature: 'inventory_flow', keepAlive: true } },
      { path: 'factory-dispatch', component: FactoryDispatch, meta: { feature: 'inventory', keepAlive: true } },
      { path: 'style', component: Style, meta: { feature: 'style', keepAlive: true } },
      { path: 'bom', component: Bom, meta: { feature: 'bom', keepAlive: true } },
      { path: 'production', component: Production, meta: { feature: 'production', keepAlive: true } },
      { path: 'consumption', component: Consumption, meta: { feature: 'consumption', keepAlive: true } },
      { path: 'options', component: Options, meta: { feature: 'options', keepAlive: true } },
      { path: 'users', component: Users, meta: { feature: 'users', keepAlive: true } },
      { path: 'audit', component: Audit, meta: { feature: 'audit', keepAlive: true } }
    ]
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

const ROUTER_DYNAMIC_IMPORT_RELOAD_KEY = 'garment-ems:route-dynamic-import-reloaded'

function isDynamicImportRouteError(error) {
  const text = String(error?.message || error || '').toLowerCase()
  return (
    text.includes('failed to fetch dynamically imported module') ||
    text.includes('importing a module script failed') ||
    text.includes('dynamically imported module')
  )
}

router.beforeEach((to) => {
  const session = getStoredSession()

  if (to.meta?.public) {
    if (session && to.path === '/login') {
      return firstAccessiblePath(session)
    }
    return true
  }

  if (!session) {
    return '/login'
  }

  if (!Number(session.enabled ?? 1)) {
    clearStoredSession()
    return '/login'
  }

  if (!hasFeatureAccess(session, to.meta?.feature)) {
    return firstAccessiblePath(session)
  }

  return true
})

router.afterEach(() => {
  try {
    window.sessionStorage.removeItem(ROUTER_DYNAMIC_IMPORT_RELOAD_KEY)
  } catch {}
})

router.onError((error, to) => {
  if (!isDynamicImportRouteError(error)) return
  try {
    const hasReloaded = window.sessionStorage.getItem(ROUTER_DYNAMIC_IMPORT_RELOAD_KEY) === '1'
    if (hasReloaded) return
    window.sessionStorage.setItem(ROUTER_DYNAMIC_IMPORT_RELOAD_KEY, '1')
    const hashPath = typeof to?.fullPath === 'string' && to.fullPath
      ? `#${to.fullPath}`
      : window.location.hash || '#/dashboard'
    window.location.replace(`${window.location.pathname}${window.location.search}${hashPath}`)
    window.location.reload()
  } catch {}
})

export default router
