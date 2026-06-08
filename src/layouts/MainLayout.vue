<template>
  <a-layout :class="['ems-shell', { 'ems-shell--mobile': isMobileLayout }]" :has-sider="!isMobileLayout">
    <template v-if="!isMobileLayout">
      <a-layout-sider class="ems-sidebar" :style="sidebarStyle">
        <div v-show="!navCollapsed" class="ems-sidebar__inner">
          <BrandBlock />

          <div class="ems-menu-wrap">
            <div v-for="group in visibleNavGroups" :key="group.key" class="ems-menu-group">
              <div class="ems-menu-group__title">{{ group.label }}</div>
              <a-menu theme="light" mode="inline" :selected-keys="[selectedPath]" @click="handleNavigate">
                <a-menu-item v-for="item in group.items" :key="item.path">
                  <AppIcon :name="item.icon" class="ems-menu-icon" />
                  <span class="ems-menu-label">{{ item.label }}</span>
                </a-menu-item>
              </a-menu>
            </div>
          </div>
        </div>
      </a-layout-sider>

      <button
        type="button"
        class="ems-sidebar-float-toggle"
        :class="{ 'ems-sidebar-float-toggle--collapsed': navCollapsed }"
        :style="sidebarToggleStyle"
        :aria-label="navCollapsed ? '展开菜单' : '收起菜单'"
        @click="toggleCollapsed"
      >
        <span>{{ navCollapsed ? '›' : '‹' }}</span>
      </button>
    </template>

    <a-drawer
      v-else
      class="ems-mobile-drawer"
      placement="left"
      :width="300"
      :open="drawerOpen"
      :closable="false"
      @close="drawerOpen = false"
    >
      <div class="ems-sidebar__inner ems-sidebar__inner--drawer">
        <BrandBlock remote />

        <div v-for="group in visibleNavGroups" :key="group.key" class="ems-menu-group">
          <div class="ems-menu-group__title">{{ group.label }}</div>
          <a-menu theme="light" mode="inline" :selected-keys="[selectedPath]" @click="handleNavigate">
            <a-menu-item v-for="item in group.items" :key="item.path">
              <AppIcon :name="item.icon" class="ems-menu-icon" />
              <span>{{ item.label }}</span>
            </a-menu-item>
          </a-menu>
        </div>
      </div>
    </a-drawer>

    <a-layout class="ems-main">
      <a-layout-header class="ems-topbar">
        <div class="ems-topbar__left">
          <a-button v-if="isMobileLayout" class="ems-topbar__toggle" @click="drawerOpen = true">
            菜单
          </a-button>

          <div class="ems-topbar__title">
            <div class="ems-page-title">{{ currentNavItem.title }}</div>
            <div class="ems-page-subtitle">{{ currentNavItem.subtitle }}</div>
          </div>
        </div>

        <div class="ems-topbar__right">
          <button type="button" class="ems-command-button" @click="openCommandPalette">
            <AppIcon name="dashboard" class="ems-command-button__icon" />
            <span>全局搜索</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div class="ems-version">v{{ appVersion }}</div>
          <div class="ems-user-pill">
            <span class="ems-user-pill__icon">人</span>
            <span>{{ session?.display_name || session?.username || '-' }}</span>
          </div>
          <a-button class="ems-logout" @click="handleLogout">
            退出登录
          </a-button>
        </div>
      </a-layout-header>

      <a-layout-content class="ems-content">
        <router-view v-slot="{ Component, route: currentRoute }">
          <keep-alive>
            <component
              :is="Component"
              v-if="currentRoute.meta?.keepAlive"
              :key="currentRoute.path"
            />
          </keep-alive>
          <component
            :is="Component"
            v-if="!currentRoute.meta?.keepAlive"
            :key="currentRoute.fullPath"
          />
        </router-view>
      </a-layout-content>

      <nav v-if="isMobileLayout" class="ems-mobile-tabs" aria-label="移动端常用导航">
        <button
          v-for="item in mobileNavItems"
          :key="item.path"
          type="button"
          :class="['ems-mobile-tabs__item', { 'ems-mobile-tabs__item--active': selectedPath === item.path }]"
          @click="handleNavigate({ key: item.path })"
        >
          <AppIcon :name="item.icon" class="ems-mobile-tabs__icon" />
          <span>{{ item.mobileLabel || item.label }}</span>
        </button>
      </nav>
    </a-layout>

    <a-modal
      v-model:open="commandVisible"
      title="全局搜索与快捷指令"
      width="760px"
      :footer="null"
      class="ems-command-modal"
    >
      <div class="ems-command-panel">
        <a-input
          ref="commandInputRef"
          v-model:value="commandQuery"
          size="large"
          allow-clear
          placeholder="搜索批次号、采购单号、生产单号、款号、原料编码，或输入要打开的页面"
          @pressEnter="openFirstCommandResult"
        />
        <div class="ems-command-hint">
          常用：新增采购、生产制单、库存台账、供应商换货、工厂退换、Tailscale
        </div>
        <div class="ems-command-list">
          <button
            v-for="item in commandResults"
            :key="`${item.type}-${item.key}`"
            type="button"
            class="ems-command-item"
            @click="openCommandResult(item)"
          >
            <AppIcon :name="item.icon" class="ems-command-item__icon" />
            <span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.subtitle }}</small>
            </span>
            <a-tag :color="item.color">{{ item.typeLabel }}</a-tag>
          </button>
        </div>
        <div v-if="commandLoading" class="ems-command-empty">正在搜索...</div>
        <div v-else-if="!commandResults.length" class="ems-command-empty">没有匹配结果，可以换批次号、款号或原料编码试试。</div>
      </div>
    </a-modal>
  </a-layout>
</template>

<script setup>
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { api } from '@/utils/api'
import { clearStoredSession, getStoredSession, hasFeatureAccess } from '@/utils/auth'

const MOBILE_BREAKPOINT = 900
const COLLAPSE_STORAGE_KEY = 'garment_ems_nav_collapsed'
const SIDEBAR_WIDTH = 188

const route = useRoute()
const router = useRouter()

const navItems = [
  { group: 'workbench', path: '/dashboard', feature: 'dashboard', icon: 'dashboard', label: '经营总览', title: '管理者作战台', subtitle: '集中处理采购、库存、生产和成本异常' },
  { group: 'purchase', path: '/purchase', feature: 'purchase', icon: 'purchase', label: '采购批次', title: '采购批次', subtitle: '录入采购单、审核、拆批、合并、退回与供应商换货' },
  { group: 'purchase', path: '/material', feature: 'material', icon: 'material', label: '物料资料', title: '物料资料', subtitle: '维护原料、颜色、尺码、价格规则与单位换算' },
  { group: 'inventory', path: '/inventory', feature: 'inventory', icon: 'inventory', label: '库存台账', title: '库存台账', subtitle: '查看采购累计、仓库结存、工厂结存与库存货值' },
  { group: 'inventory', path: '/factory-dispatch', feature: 'inventory', icon: 'dispatch', label: '出仓入仓', title: '出仓入仓', subtitle: '维护原料出库到工厂、回收入仓、工厂退换与核实库存' },
  { group: 'inventory', path: '/inventory-flow', feature: 'inventory_flow', icon: 'flow', label: '库存流水', title: '库存流水', subtitle: '追踪每一笔入库、出库、回收、拆批与库存调整' },
  { group: 'production', path: '/production', feature: 'production', icon: 'production', label: '生产制单', title: '生产制单', subtitle: '创建生产单并维护尺码数量、用料、库存校验与成本' },
  { group: 'production', path: '/style', feature: 'style', icon: 'style', label: '成衣管理', title: '成衣管理', subtitle: '维护款号、图片、分类、工厂加工费与加权成本' },
  { group: 'production', path: '/bom', feature: 'bom', icon: 'bom', label: 'BOM 配置', title: 'BOM 配置', subtitle: '配置成衣原料、颜色、供料方式、计料方式和单件用量' },
  { group: 'cost', path: '/consumption', feature: 'consumption', icon: 'consumption', label: '单耗分析', title: '单耗分析', subtitle: '按面料、款式、工厂分析单耗偏差与成本表现' },
  { group: 'system', path: '/options', feature: 'options', icon: 'options', label: '基础设置', title: '基础设置', subtitle: '维护系统选项、仓库、工厂、供应商与远程共享设置' },
  { group: 'system', path: '/users', feature: 'users', icon: 'users', label: '账号权限', title: '账号权限', subtitle: '维护登录账号、可用功能范围与启停状态' },
  { group: 'system', path: '/audit', feature: 'audit', icon: 'audit', label: '操作审计', title: '操作审计', subtitle: '记录是谁、何时、改了什么，便于追踪问题和核查历史' }
]

const navGroups = [
  { key: 'workbench', label: '工作台' },
  { key: 'purchase', label: '采购管理' },
  { key: 'inventory', label: '库存与出入仓' },
  { key: 'production', label: '生产管理' },
  { key: 'cost', label: '成本与分析' },
  { key: 'system', label: '系统设置' }
]

const BrandBlock = defineComponent({
  name: 'BrandBlock',
  props: {
    remote: {
      type: Boolean,
      default: false
    }
  },
  setup(props) {
    return () => h('div', { class: 'ems-brand' }, [
      h('div', { class: 'ems-brand__mark' }, [
        h(AppIcon, { name: 'app', class: 'ems-brand__mark-icon' }),
        h('span', { class: 'ems-brand__mark-text' }, 'GM')
      ]),
      h('div', { class: 'ems-brand__copy' }, [
        h('div', { class: 'ems-brand__title' }, '服装采购生产管理系统'),
        h('div', { class: 'ems-brand__subtitle' }, '采购 · 生产 · 库存一体化管理')
      ]),
      props.remote ? h('div', { class: 'ems-brand__remote-pill' }, '安卓远程版') : null
    ])
  }
})

const session = computed(() => getStoredSession())
const selectedPath = computed(() => route.path)
const visibleNavItems = computed(() => navItems.filter((item) => hasFeatureAccess(session.value, item.feature)))
const visibleNavGroups = computed(() => navGroups
  .map((group) => ({
    ...group,
    items: visibleNavItems.value.filter((item) => item.group === group.key)
  }))
  .filter((group) => group.items.length))
const currentNavItem = computed(() => navItems.find((item) => item.path === route.path) || visibleNavItems.value[0] || navItems[0])
const mobileNavItems = computed(() => {
  const preferred = ['/dashboard', '/purchase', '/inventory', '/factory-dispatch', '/production']
  return preferred
    .map((path) => visibleNavItems.value.find((item) => item.path === path))
    .filter(Boolean)
    .map((item) => ({
      ...item,
      mobileLabel: ({
        '/dashboard': '首页',
        '/purchase': '采购',
        '/inventory': '库存',
        '/factory-dispatch': '出入仓',
        '/production': '生产'
      })[item.path]
    }))
})
const sidebarStyle = computed(() => ({
  width: `${navCollapsed.value ? 0 : SIDEBAR_WIDTH}px`,
  minWidth: `${navCollapsed.value ? 0 : SIDEBAR_WIDTH}px`,
  maxWidth: `${navCollapsed.value ? 0 : SIDEBAR_WIDTH}px`,
  flex: `0 0 ${navCollapsed.value ? 0 : SIDEBAR_WIDTH}px`
}))
const sidebarToggleStyle = computed(() => ({
  left: `${navCollapsed.value ? 0 : SIDEBAR_WIDTH}px`
}))

const isMobileLayout = ref(false)
const drawerOpen = ref(false)
const navCollapsed = ref(false)
const appVersion = ref('-')
const commandVisible = ref(false)
const commandQuery = ref('')
const commandLoading = ref(false)
const commandInputRef = ref(null)
const commandRemoteResults = ref([])
let commandSearchTimer = null

const quickCommands = [
  {
    key: 'new-purchase',
    type: 'quick',
    typeLabel: '快捷',
    icon: 'purchase',
    color: 'blue',
    title: '新增采购批次',
    subtitle: '打开采购页面并创建新的采购单',
    route: { path: '/purchase', query: { action: 'create' } }
  },
  {
    key: 'new-production',
    type: 'quick',
    typeLabel: '快捷',
    icon: 'production',
    color: 'cyan',
    title: '新增生产制单',
    subtitle: '进入生产制单页面创建生产单',
    route: { path: '/production', query: { action: 'create' } }
  },
  {
    key: 'warehouse-stock',
    type: 'quick',
    typeLabel: '快捷',
    icon: 'inventory',
    color: 'green',
    title: '查看仓库库存',
    subtitle: '只查看当前仍在仓库中的原料库存',
    route: { path: '/inventory', query: { stock_scope: 'warehouse' } }
  },
  {
    key: 'factory-exchange',
    type: 'quick',
    typeLabel: '流程',
    icon: 'dispatch',
    color: 'orange',
    title: '工厂质量退换',
    subtitle: '处理已发工厂原料的质量问题退供应商换货',
    route: { path: '/factory-dispatch', query: { stock_scope: 'factory' } }
  },
  {
    key: 'supplier-exchange',
    type: 'quick',
    typeLabel: '流程',
    icon: 'purchase',
    color: 'purple',
    title: '供应商退换记录',
    subtitle: '查看采购批次中的退货、换货和补回记录',
    route: { path: '/purchase', query: { document_status: 'approved', q: '换货' } }
  },
  {
    key: 'remote-share',
    type: 'quick',
    typeLabel: '远程',
    icon: 'link',
    color: 'geekblue',
    title: 'Tailscale 远程共享数据库',
    subtitle: '打开首页远程共享区，连接或共享数据库',
    route: { path: '/dashboard', query: { section: 'tailscale' } }
  }
]

const commandResults = computed(() => {
  const query = String(commandQuery.value || '').trim().toLowerCase()
  const localResults = quickCommands.filter((item) => {
    if (!query) return true
    return [item.title, item.subtitle, item.typeLabel].join(' ').toLowerCase().includes(query)
  })
  return [...localResults, ...commandRemoteResults.value].slice(0, 18)
})

function readCollapsedState() {
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsedState(value) {
  try {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, value ? '1' : '0')
  } catch {
    // ignore storage failures
  }
}

function syncMobileLayout() {
  if (typeof window === 'undefined') return
  isMobileLayout.value = window.innerWidth <= MOBILE_BREAKPOINT
  if (isMobileLayout.value) {
    drawerOpen.value = false
  } else {
    navCollapsed.value = readCollapsedState()
  }
}

function toggleCollapsed() {
  navCollapsed.value = !navCollapsed.value
  writeCollapsedState(navCollapsed.value)
}

function handleNavigate({ key }) {
  if (!key || key === route.path) {
    drawerOpen.value = false
    return
  }
  drawerOpen.value = false
  router.push(key)
}

function handleLogout() {
  clearStoredSession()
  router.replace('/login')
}

async function loadVersion() {
  try {
    const result = await api.app.getVersion()
    appVersion.value = result?.version || '-'
  } catch {
    appVersion.value = '-'
  }
}

function normalizeCommandText(value) {
  return String(value || '').trim()
}

function makeCommandResult({ key, icon, color, title, subtitle, route, typeLabel = '结果' }) {
  return {
    key,
    type: 'remote',
    typeLabel,
    icon,
    color,
    title: normalizeCommandText(title) || '-',
    subtitle: normalizeCommandText(subtitle) || '点击跳转到相关页面',
    route
  }
}

function compactRecords(records, mapper, limit = 8) {
  return (Array.isArray(records) ? records : [])
    .map(mapper)
    .filter(Boolean)
    .slice(0, limit)
}

function includesCommandKeyword(record, fields, query) {
  const haystack = fields.map((field) => record?.[field]).filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(query)
}

async function runCommandSearch(query) {
  const keyword = normalizeCommandText(query)
  if (keyword.length < 2) {
    commandRemoteResults.value = []
    commandLoading.value = false
    return
  }
  commandLoading.value = true
  try {
    const [purchaseResult, productionResult, materialResult, garmentResult] = await Promise.allSettled([
      api.db.getPurchaseBatches({ keyword, q: keyword }),
      api.db.getProductionOrders({ keyword, q: keyword }),
      api.db.getMaterials(),
      api.db.getGarments()
    ])
    const lowerKeyword = keyword.toLowerCase()
    const purchases = compactRecords(purchaseResult.value, (item) => makeCommandResult({
      key: `purchase-${item.id}`,
      icon: 'purchase',
      color: 'blue',
      typeLabel: '采购',
      title: item.purchase_order_no || item.batch_no,
      subtitle: `${item.supplier || '-'} · ${item.material_code || item.material_name || '-'} · ${item.color || '-'}`,
      route: { path: '/purchase', query: { q: item.purchase_order_no || item.batch_no || keyword } }
    }))
    const productions = compactRecords(productionResult.value, (item) => makeCommandResult({
      key: `production-${item.id}`,
      icon: 'production',
      color: 'cyan',
      typeLabel: '生产',
      title: item.order_no || item.production_no || item.style_code,
      subtitle: `${item.style_code || '-'} · ${item.factory_name || '-'} · ${item.production_status || '-'}`,
      route: { path: '/production', query: { q: item.order_no || item.production_no || item.style_code || keyword } }
    }))
    const materials = compactRecords(
      (Array.isArray(materialResult.value) ? materialResult.value : []).filter((item) =>
        includesCommandKeyword(item, ['code', 'name', 'material_code', 'material_name', 'supplier_name', 'category'], lowerKeyword)
      ),
      (item) => makeCommandResult({
        key: `material-${item.id || item.code || item.material_code}`,
        icon: 'material',
        color: 'green',
        typeLabel: '原料',
        title: item.code || item.material_code || item.name || item.material_name,
        subtitle: `${item.name || item.material_name || '-'} · ${item.category || '-'} · ${item.supplier_name || item.supplier || '-'}`,
        route: { path: '/material', query: { q: item.code || item.material_code || item.name || keyword } }
      })
    )
    const garments = compactRecords(
      (Array.isArray(garmentResult.value) ? garmentResult.value : []).filter((item) =>
        includesCommandKeyword(item, ['style_code', 'name', 'category', 'remark'], lowerKeyword)
      ),
      (item) => makeCommandResult({
        key: `style-${item.id || item.style_code}`,
        icon: 'style',
        color: 'purple',
        typeLabel: '成衣',
        title: item.style_code || item.name,
        subtitle: `${item.name || '-'} · ${item.category || '-'} · BOM ${item.bom_count || 0} 项`,
        route: { path: '/style', query: { q: item.style_code || item.name || keyword } }
      })
    )
    commandRemoteResults.value = [...purchases, ...productions, ...materials, ...garments]
  } catch {
    commandRemoteResults.value = []
  } finally {
    commandLoading.value = false
  }
}

function scheduleCommandSearch() {
  if (commandSearchTimer) clearTimeout(commandSearchTimer)
  commandSearchTimer = setTimeout(() => runCommandSearch(commandQuery.value), 220)
}

function openCommandPalette() {
  commandVisible.value = true
  setTimeout(() => {
    const input = commandInputRef.value?.input
    if (input && typeof input.focus === 'function') input.focus()
  }, 80)
}

function openCommandResult(item) {
  if (!item?.route?.path) return
  commandVisible.value = false
  commandQuery.value = ''
  commandRemoteResults.value = []
  router.push(item.route)
}

function openFirstCommandResult() {
  const first = commandResults.value[0]
  if (first) openCommandResult(first)
}

function handleGlobalKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'k') {
    event.preventDefault()
    openCommandPalette()
  }
}

watch(
  () => route.fullPath,
  () => {
    drawerOpen.value = false
  }
)

watch(commandQuery, scheduleCommandSearch)

onMounted(() => {
  navCollapsed.value = readCollapsedState()
  syncMobileLayout()
  loadVersion()
  window.addEventListener('resize', syncMobileLayout)
  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncMobileLayout)
  window.removeEventListener('keydown', handleGlobalKeydown)
  if (commandSearchTimer) clearTimeout(commandSearchTimer)
})
</script>

<style scoped>
.ems-shell {
  position: relative;
  min-height: 100vh;
  display: flex !important;
  background:
    radial-gradient(circle at 88% 0%, rgba(0, 122, 255, 0.12), transparent 28%),
    linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%);
}

.ems-sidebar {
  overflow: visible;
  background: rgba(255, 255, 255, 0.94) !important;
  border-right: 1px solid rgba(112, 135, 168, 0.16);
  box-shadow: 8px 0 28px rgba(34, 74, 122, 0.06);
  transition:
    width 0.22s ease,
    min-width 0.22s ease,
    max-width 0.22s ease,
    flex-basis 0.22s ease !important;
}

.ems-sidebar__inner {
  display: flex;
  flex-direction: column;
  width: 188px;
  height: 100%;
  overflow: hidden;
}

.ems-brand {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 86px;
  padding: 16px 12px 14px;
  border-bottom: 1px solid rgba(112, 135, 168, 0.14);
}

.ems-brand__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 1px;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  border-radius: 13px;
  background: linear-gradient(135deg, #2f7dff 0%, #1664f5 100%);
  color: #fff;
  font-size: 10px;
  font-weight: 900;
  box-shadow: 0 14px 26px rgba(0, 122, 255, 0.22);
}

.ems-brand__mark-icon {
  width: 20px;
  height: 17px;
  color: rgba(255, 255, 255, 0.92);
}

.ems-brand__mark-text {
  display: block;
  line-height: 1;
  letter-spacing: -0.08em;
}

.ems-brand__copy {
  min-width: 0;
}

.ems-brand__title {
  color: #0f2341;
  font-size: 15px;
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: -0.03em;
}

.ems-brand__subtitle {
  margin-top: 4px;
  color: #71819a;
  font-size: 11px;
  line-height: 1.35;
}

.ems-brand__remote-pill {
  margin-left: auto;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.1);
  color: #0067d8;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
  text-align: center;
}

.ems-menu-wrap {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 10px 18px;
}

.ems-menu-group {
  margin-bottom: 12px;
}

.ems-menu-group__title {
  padding: 5px 10px 3px;
  color: #8a9bb2;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
}

.ems-menu-group :deep(.ant-menu) {
  margin-top: 2px;
}

.ems-menu-wrap :deep(.ant-menu),
.ems-sidebar__inner--drawer :deep(.ant-menu) {
  border-inline-end: 0 !important;
  background: transparent !important;
}

.ems-menu-wrap :deep(.ant-menu-item),
.ems-sidebar__inner--drawer :deep(.ant-menu-item) {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 42px;
  line-height: 42px;
  margin: 4px 0;
  padding-inline: 10px !important;
  border-radius: 15px;
  color: #243955 !important;
  font-size: 14px;
  font-weight: 780;
}

.ems-menu-wrap :deep(.ant-menu-title-content) {
  min-width: 0;
}

.ems-menu-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ems-menu-wrap :deep(.ant-menu-item:hover),
.ems-sidebar__inner--drawer :deep(.ant-menu-item:hover) {
  color: #0067d8 !important;
  background: rgba(0, 122, 255, 0.08) !important;
}

.ems-menu-wrap :deep(.ant-menu-item-selected),
.ems-sidebar__inner--drawer :deep(.ant-menu-item-selected) {
  color: #0067d8 !important;
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.14), rgba(90, 200, 250, 0.12)) !important;
  box-shadow: inset 0 0 0 1px rgba(0, 122, 255, 0.1);
}

.ems-menu-icon,
.ems-mobile-tabs__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  border-radius: 8px;
  color: #4f6b91;
  font-size: 12px;
  font-weight: 900;
}

.ems-menu-icon :deep(svg),
.ems-mobile-tabs__icon :deep(svg),
.ems-brand__mark-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ems-menu-wrap :deep(.ant-menu-item-selected) .ems-menu-icon,
.ems-sidebar__inner--drawer :deep(.ant-menu-item-selected) .ems-menu-icon {
  color: #fff;
  background: #2f7dff;
}

.ems-sidebar-float-toggle {
  position: fixed;
  top: 104px;
  z-index: 120;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 58px;
  padding: 0;
  border: 1px solid rgba(31, 115, 255, 0.18);
  border-left: 0;
  border-radius: 0 16px 16px 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(235, 246, 255, 0.94));
  color: #1769e8;
  font-size: 26px;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 10px 12px 28px rgba(34, 74, 122, 0.14);
  transform: translateX(-1px);
  transition: left 0.22s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.ems-sidebar-float-toggle:hover {
  background: linear-gradient(180deg, #ffffff, #e5f3ff);
  box-shadow: 12px 16px 34px rgba(34, 74, 122, 0.18);
}

.ems-sidebar-float-toggle--collapsed {
  border-left: 1px solid rgba(31, 115, 255, 0.18);
  transform: translateX(0);
}

.ems-main {
  min-width: 0;
  flex: 1 1 auto;
  background: transparent;
}

.ems-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  height: 88px;
  line-height: normal;
  padding: 16px 28px;
  background: rgba(255, 255, 255, 0.82);
  border-bottom: 1px solid rgba(112, 135, 168, 0.16);
  box-shadow: 0 12px 34px rgba(34, 74, 122, 0.06);
}

.ems-topbar__left,
.ems-topbar__right {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.ems-topbar__right {
  margin-left: auto;
}

.ems-page-title {
  color: #0f2341;
  font-size: 25px;
  font-weight: 900;
  line-height: 1.18;
  letter-spacing: -0.04em;
}

.ems-page-subtitle {
  margin-top: 6px;
  color: #71819a;
  font-size: 13px;
}

.ems-topbar__toggle,
.ems-logout,
.ems-version,
.ems-user-pill,
.ems-command-button {
  height: 44px;
  border-radius: 999px !important;
}

.ems-command-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid rgba(112, 135, 168, 0.16);
  background: rgba(255, 255, 255, 0.76);
  color: #314968;
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
  box-shadow: 0 10px 26px rgba(34, 74, 122, 0.06);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.ems-command-button:hover {
  border-color: rgba(0, 122, 255, 0.3);
  color: #0067d8;
  box-shadow: 0 14px 30px rgba(0, 122, 255, 0.1);
  transform: translateY(-1px);
}

.ems-command-button__icon {
  width: 18px;
  height: 18px;
  color: #007aff;
}

.ems-command-button__icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
}

.ems-command-button kbd {
  padding: 3px 7px;
  border: 1px solid rgba(112, 135, 168, 0.18);
  border-radius: 9px;
  background: #f6f9ff;
  color: #71819a;
  font-size: 11px;
  font-family: inherit;
}

.ems-version,
.ems-user-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  border: 1px solid rgba(112, 135, 168, 0.16);
  background: rgba(255, 255, 255, 0.76);
  color: #0f2341;
  font-size: 14px;
  font-weight: 800;
  box-shadow: 0 10px 26px rgba(34, 74, 122, 0.06);
}

.ems-user-pill {
  gap: 8px;
}

.ems-user-pill__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.1);
  color: #007aff;
  font-size: 12px;
}

.ems-logout,
.ems-topbar__toggle {
  border: 1px solid rgba(0, 122, 255, 0.16) !important;
  background: rgba(255, 255, 255, 0.82) !important;
  color: #0f2341 !important;
  font-weight: 800;
}

.ems-content {
  min-height: calc(100vh - 88px);
  padding: 28px 30px 38px;
  overflow: auto;
}

.ems-command-modal :deep(.ant-modal-content) {
  border-radius: 28px;
  overflow: hidden;
  background:
    radial-gradient(circle at 90% 0%, rgba(0, 122, 255, 0.12), transparent 34%),
    linear-gradient(180deg, #ffffff 0%, #f7fbff 100%);
  box-shadow: 0 30px 90px rgba(14, 43, 86, 0.22);
}

.ems-command-modal :deep(.ant-modal-header) {
  background: transparent;
  border-bottom: 1px solid rgba(191, 219, 254, 0.7);
}

.ems-command-modal :deep(.ant-modal-title) {
  color: #102a4c;
  font-size: 20px;
  font-weight: 900;
}

.ems-command-panel {
  display: grid;
  gap: 12px;
}

.ems-command-panel :deep(.ant-input-affix-wrapper) {
  height: 48px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.94);
}

.ems-command-hint {
  color: #70839d;
  font-size: 12px;
}

.ems-command-list {
  display: grid;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
  padding-right: 4px;
}

.ems-command-item {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border: 1px solid rgba(191, 219, 254, 0.72);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.88);
  color: #102a4c;
  text-align: left;
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.ems-command-item:hover {
  transform: translateY(-1px);
  border-color: rgba(0, 122, 255, 0.4);
  box-shadow: 0 12px 28px rgba(0, 122, 255, 0.1);
}

.ems-command-item__icon {
  width: 38px;
  height: 38px;
  padding: 9px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(47, 125, 255, 0.14), rgba(90, 200, 250, 0.12));
  color: #1677ff;
}

.ems-command-item__icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  stroke: currentColor;
}

.ems-command-item strong,
.ems-command-item small {
  display: block;
}

.ems-command-item strong {
  font-size: 14px;
  font-weight: 900;
}

.ems-command-item small {
  margin-top: 3px;
  color: #71819a;
  font-size: 12px;
  line-height: 1.45;
}

.ems-command-empty {
  padding: 18px;
  border: 1px dashed rgba(148, 163, 184, 0.4);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  color: #71819a;
  text-align: center;
}

@media (max-width: 900px) {
  .ems-topbar {
    position: sticky;
    top: 0;
    z-index: 50;
    height: auto;
    min-height: 74px;
    padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 10px;
  }

  .ems-topbar__right {
    gap: 8px;
  }

  .ems-topbar__toggle {
    width: 46px;
    min-width: 46px;
    padding: 0 !important;
    font-size: 0;
  }

  .ems-topbar__toggle::before {
    content: '☰';
    font-size: 21px;
  }

  .ems-page-title {
    font-size: 18px;
  }

  .ems-page-subtitle,
  .ems-user-pill,
  .ems-logout,
  .ems-command-button span,
  .ems-command-button kbd {
    display: none;
  }

  .ems-command-button {
    width: 38px;
    height: 34px;
    padding: 0;
    justify-content: center;
  }

  .ems-version {
    height: 34px;
    padding: 0 10px;
    color: #0067d8;
    background: rgba(0, 122, 255, 0.08);
  }

  .ems-content {
    min-height: calc(100vh - 74px);
    padding: 14px 10px calc(92px + env(safe-area-inset-bottom, 0px));
    overflow-x: hidden;
  }

  .ems-mobile-drawer :deep(.ant-drawer-mask) {
    background: rgba(15, 23, 42, 0.58) !important;
  }

  .ems-mobile-drawer :deep(.ant-drawer-content) {
    border-top-right-radius: 36px;
    border-bottom-right-radius: 36px;
    overflow: hidden;
    background:
      radial-gradient(circle at 82% 4%, rgba(0, 122, 255, 0.12), transparent 28%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(244, 250, 255, 0.96)) !important;
    box-shadow: 26px 0 80px rgba(15, 23, 42, 0.22);
  }

  .ems-mobile-drawer :deep(.ant-drawer-body) {
    padding: 0;
    background: transparent !important;
  }

  .ems-sidebar__inner--drawer {
    width: auto;
    padding: max(18px, env(safe-area-inset-top, 0px)) 16px 18px;
  }

  .ems-sidebar__inner--drawer .ems-brand {
    min-height: 120px;
    padding: 18px 4px 20px;
    align-items: flex-start;
  }

  .ems-sidebar__inner--drawer .ems-brand__mark {
    width: 56px;
    height: 56px;
    border-radius: 22px;
  }

  .ems-sidebar__inner--drawer .ems-brand__title {
    max-width: 142px;
    font-size: 22px;
  }

  .ems-sidebar__inner--drawer .ems-brand__subtitle {
    font-size: 16px;
  }

  .ems-sidebar__inner--drawer .ems-brand__remote-pill {
    position: absolute;
    top: 24px;
    right: 0;
    max-width: 96px;
  }

  .ems-sidebar__inner--drawer :deep(.ant-menu-item) {
    height: 56px;
    line-height: 56px;
    margin: 5px 0;
    font-size: 19px;
    font-weight: 600;
  }

  .ems-sidebar__inner--drawer .ems-menu-group__title {
    padding-left: 10px;
    font-size: 12px;
  }

  .ems-mobile-tabs {
    position: fixed;
    left: 10px;
    right: 10px;
    bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    z-index: 70;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 5px;
    padding: 8px;
    border: 1px solid rgba(174, 205, 244, 0.72);
    border-radius: 25px;
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 18px 42px rgba(30, 83, 142, 0.18);
  }

  .ems-mobile-tabs__item {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    min-height: 48px;
    border: 0;
    border-radius: 18px;
    background: transparent;
    color: #60728d;
    font-size: 11px;
    font-weight: 800;
  }

  .ems-mobile-tabs__item--active {
    background: linear-gradient(180deg, #eaf5ff 0%, #dcebff 100%);
    color: #0067d8;
  }
}
</style>
