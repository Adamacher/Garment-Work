<template>
  <a-layout :class="['ems-shell', { 'ems-shell--mobile': isMobileLayout }]" :has-sider="!isMobileLayout">
    <template v-if="!isMobileLayout">
      <a-layout-sider class="ems-sidebar" :style="sidebarStyle">
        <div v-show="!navCollapsed" class="ems-sidebar__inner">
          <BrandBlock />

          <div class="ems-menu-wrap">
            <a-menu theme="light" mode="inline" :selected-keys="[selectedPath]" @click="handleNavigate">
              <a-menu-item v-for="item in visibleNavItems" :key="item.path">
                <FeatureIcon :name="item.icon" class="ems-menu-icon" />
                <span class="ems-menu-label">{{ item.label }}</span>
              </a-menu-item>
            </a-menu>
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

        <a-menu theme="light" mode="inline" :selected-keys="[selectedPath]" @click="handleNavigate">
          <a-menu-item v-for="item in visibleNavItems" :key="item.path">
            <FeatureIcon :name="item.icon" class="ems-menu-icon" />
            <span>{{ item.label }}</span>
          </a-menu-item>
        </a-menu>
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
          <FeatureIcon :name="item.icon" class="ems-mobile-tabs__icon" />
          <span>{{ item.mobileLabel || item.label }}</span>
        </button>
      </nav>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/utils/api'
import { clearStoredSession, getStoredSession, hasFeatureAccess } from '@/utils/auth'

const MOBILE_BREAKPOINT = 900
const COLLAPSE_STORAGE_KEY = 'garment_ems_nav_collapsed'
const SIDEBAR_WIDTH = 188

const route = useRoute()
const router = useRouter()

const iconMap = {
  dashboard: ['M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8.5Z'],
  material: ['M6 4h8l4 4v12H6V4Z', 'M14 4v5h5', 'M9 13h6M9 17h7'],
  purchase: ['M5 6h2l1.5 9h8.5l2-6H8', 'M10 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z'],
  inventory: ['M4 8 12 4l8 4-8 4-8-4Z', 'M4 12l8 4 8-4', 'M4 16l8 4 8-4'],
  dispatch: ['M5 7h9v10H5z', 'M14 10h3l2 3v4h-5', 'M8 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm8 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'],
  flow: ['M7 7h8l-2-2', 'M15 17H7l2 2', 'M17 9a5 5 0 0 1-1 6M7 15a5 5 0 0 1 1-6'],
  style: ['M8 5l4 3 4-3 3 3-2 3v9H7v-9L5 8l3-3Z', 'M10 7c.5 1 1.2 1.5 2 1.5S13.5 8 14 7'],
  bom: ['M6 5h12v4H6z', 'M6 15h12v4H6z', 'M9 9v6m6-6v6'],
  production: ['M6 7h12v10H6z', 'M9 4v3m6-3v3M9 17v3m6-3v3', 'M10 11h4'],
  consumption: ['M5 19V9', 'M10 19V5', 'M15 19v-7', 'M20 19V8'],
  options: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 3v2m0 14v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M3 12h2m14 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  users: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M3.5 20a5.5 5.5 0 0 1 11 0', 'M16 9a2.5 2.5 0 1 0 0-5', 'M15 14c2.8.2 5 2.4 5 5'],
  audit: ['M7 4h10v16H7z', 'M9 8h6M9 12h6M9 16h4', 'M6 7H5v14h11v-1']
}

const FeatureIcon = defineComponent({
  name: 'FeatureIcon',
  props: {
    name: {
      type: String,
      default: 'dashboard'
    }
  },
  setup(props, { attrs }) {
    return () => h('span', { ...attrs }, [
      h('svg', {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.9,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true'
      }, (iconMap[props.name] || iconMap.dashboard).map((d) => h('path', { d })))
    ])
  }
})

const navItems = [
  { path: '/dashboard', feature: 'dashboard', icon: 'dashboard', label: '经营总览', title: '智能工作台', subtitle: '今天先处理最重要的事' },
  { path: '/material', feature: 'material', icon: 'material', label: '物料资料', title: '物料资料', subtitle: '维护原料、颜色、尺码、价格规则与单位换算' },
  { path: '/purchase', feature: 'purchase', icon: 'purchase', label: '采购批次', title: '采购批次', subtitle: '录入采购单、审核、拆批、合并、退回与供应商换货' },
  { path: '/inventory', feature: 'inventory', icon: 'inventory', label: '库存台账', title: '库存台账', subtitle: '查看采购累计、仓库结存、工厂结存与库存货值' },
  { path: '/factory-dispatch', feature: 'inventory', icon: 'dispatch', label: '出仓入仓', title: '出仓入仓', subtitle: '维护原料出库到工厂、回收入仓与核实库存' },
  { path: '/inventory-flow', feature: 'inventory_flow', icon: 'flow', label: '库存流水', title: '库存流水', subtitle: '追踪每一笔入库、出库、回收、拆批与库存调整' },
  { path: '/style', feature: 'style', icon: 'style', label: '成衣管理', title: '成衣管理', subtitle: '维护款号、图片、分类、工厂加工费与加权成本' },
  { path: '/bom', feature: 'bom', icon: 'bom', label: 'BOM 配置', title: 'BOM 配置', subtitle: '配置成衣原料、颜色、供料方式、计料方式和单件用量' },
  { path: '/production', feature: 'production', icon: 'production', label: '生产制单', title: '生产制单', subtitle: '创建生产单并维护尺码数量、用料、库存校验与成本' },
  { path: '/consumption', feature: 'consumption', icon: 'consumption', label: '单耗分析', title: '单耗分析', subtitle: '按面料、款式、工厂分析单耗偏差与成本表现' },
  { path: '/options', feature: 'options', icon: 'options', label: '基础设置', title: '基础设置', subtitle: '维护系统选项、仓库、工厂、供应商与远程共享设置' },
  { path: '/users', feature: 'users', icon: 'users', label: '账号权限', title: '账号权限', subtitle: '维护登录账号、可用功能范围与启停状态' },
  { path: '/audit', feature: 'audit', icon: 'audit', label: '操作审计', title: '操作审计', subtitle: '记录是谁、何时、改了什么，便于追踪问题和核查历史' }
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
      h('div', { class: 'ems-brand__mark' }, 'GM'),
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

watch(
  () => route.fullPath,
  () => {
    drawerOpen.value = false
  }
)

onMounted(() => {
  navCollapsed.value = readCollapsedState()
  syncMobileLayout()
  loadVersion()
  window.addEventListener('resize', syncMobileLayout)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncMobileLayout)
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
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  border-radius: 13px;
  background: linear-gradient(135deg, #2f7dff 0%, #1664f5 100%);
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  box-shadow: 0 14px 26px rgba(0, 122, 255, 0.22);
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
  padding: 14px 10px 18px;
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
.ems-user-pill {
  height: 44px;
  border-radius: 999px !important;
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
  .ems-logout {
    display: none;
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
