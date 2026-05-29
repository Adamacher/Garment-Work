<template>
  <a-layout :class="['ems-shell', { 'ems-shell--mobile': isMobileLayout }]" :has-sider="!isMobileLayout">
    <template v-if="!isMobileLayout">
      <a-layout-sider class="ems-sidebar" :style="sidebarStyle">
        <div v-show="!navCollapsed" class="ems-sidebar__inner">
          <div class="ems-brand">
            <div class="ems-brand__mark">GM</div>
            <div class="ems-brand__copy">
              <div class="ems-brand__title">服装采购生产管理系统</div>
              <div class="ems-brand__subtitle">采购 生产 库存 一体化</div>
            </div>
          </div>

          <div class="ems-menu-wrap">
            <a-menu
              theme="light"
              mode="inline"
              :selected-keys="[selectedPath]"
              @click="handleNavigate"
            >
              <a-menu-item v-for="item in visibleNavItems" :key="item.path">
                <span>{{ item.label }}</span>
              </a-menu-item>
            </a-menu>
          </div>
        </div>
      </a-layout-sider>

      <button
        type="button"
        class="ems-sidebar-toggle"
        :class="{ 'ems-sidebar-toggle--collapsed': navCollapsed }"
        @click="toggleCollapsed"
      >
        <span class="ems-sidebar-toggle__icon">{{ navCollapsed ? '◨' : '◧' }}</span>
        <span class="ems-sidebar-toggle__text">{{ navCollapsed ? '打开边栏' : '关闭边栏' }}</span>
      </button>
    </template>

    <a-drawer
      v-else
      class="ems-mobile-drawer"
      placement="left"
      :width="236"
      :open="drawerOpen"
      :closable="false"
      @close="drawerOpen = false"
    >
      <div class="ems-sidebar__inner ems-sidebar__inner--drawer">
        <div class="ems-brand">
          <div class="ems-brand__mark">GM</div>
          <div class="ems-brand__copy">
            <div class="ems-brand__title">服装采购生产管理系统</div>
            <div class="ems-brand__subtitle">采购 生产 库存 一体化</div>
          </div>
        </div>

        <a-menu
          theme="light"
          mode="inline"
          :selected-keys="[selectedPath]"
          @click="handleNavigate"
        >
          <a-menu-item v-for="item in visibleNavItems" :key="item.path">
            <span>{{ item.label }}</span>
          </a-menu-item>
        </a-menu>
      </div>
    </a-drawer>

    <a-layout class="ems-main">
      <a-layout-header class="ems-topbar">
        <div class="ems-topbar__left">
          <a-button
            v-if="isMobileLayout"
            class="ems-topbar__toggle"
            @click="drawerOpen = true"
          >
            菜单
          </a-button>

          <div class="ems-topbar__title">
            <div class="ems-page-title">{{ currentNavItem.title }}</div>
            <div class="ems-page-subtitle">{{ currentNavItem.subtitle }}</div>
          </div>
        </div>

        <div class="ems-topbar__right">
          <div class="ems-version">v{{ appVersion }}</div>
          <div class="ems-user">
            <div class="ems-user__name">{{ session?.display_name || session?.username || '-' }}</div>
            <div class="ems-user__role">{{ session?.role === SUPER_ADMIN_ROLE ? '超级管理员' : '普通账号' }}</div>
          </div>
          <a-button class="ems-logout" @click="handleLogout">退出登录</a-button>
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
          <span class="ems-mobile-tabs__dot"></span>
          <span>{{ item.mobileLabel || item.label }}</span>
        </button>
      </nav>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/utils/api'
import { clearStoredSession, getStoredSession, hasFeatureAccess, SUPER_ADMIN_ROLE } from '@/utils/auth'

const MOBILE_BREAKPOINT = 900
const COLLAPSE_STORAGE_KEY = 'garment_ems_nav_collapsed'
const SIDEBAR_WIDTH = 176

const route = useRoute()
const router = useRouter()

const navItems = [
  { path: '/dashboard', feature: 'dashboard', label: '经营总览', title: '经营总览', subtitle: '查看经营数据、共享状态、数据库状态与系统说明。' },
  { path: '/material', feature: 'material', label: '物料资料', title: '物料资料', subtitle: '维护面料、辅料、颜色、价格规则与单位换算。' },
  { path: '/purchase', feature: 'purchase', label: '采购批次', title: '采购批次', subtitle: '录入采购单、拆批、合并、审核、退回与供应商换货。' },
  { path: '/inventory', feature: 'inventory', label: '库存台账', title: '库存台账', subtitle: '查看采购累计、仓库结存、工厂结存与库存货值。' },
  { path: '/factory-dispatch', feature: 'inventory', label: '出仓入仓', title: '出仓入仓', subtitle: '维护原料出库到工厂、回收入仓与仓库流转。' },
  { path: '/inventory-flow', feature: 'inventory_flow', label: '库存流水', title: '库存流水', subtitle: '追踪每一笔入库、出库、回收、拆批与库存调整。' },
  { path: '/style', feature: 'style', label: '成衣管理', title: '成衣管理', subtitle: '维护款号、图片、分类、工厂加工费与加权成本。' },
  { path: '/bom', feature: 'bom', label: 'BOM 配置', title: 'BOM 配置', subtitle: '配置原料颜色、供料方式、计料方式、单件用量与采购参考。' },
  { path: '/production', feature: 'production', label: '生产制单', title: '生产制单', subtitle: '生成制单、更新状态并核算阶段成本。' },
  { path: '/consumption', feature: 'consumption', label: '单耗分析', title: '单耗分析', subtitle: '按面料、款式、工厂分析单耗偏差与成本表现。' },
  { path: '/options', feature: 'options', label: '基础设置', title: '基础设置', subtitle: '维护系统选项、仓库、工厂、供应商与远程共享设置。' },
  { path: '/users', feature: 'users', label: '账号权限', title: '账号权限', subtitle: '维护登录账号、可用功能范围与启停状态。' },
  { path: '/audit', feature: 'audit', label: '操作审计', title: '操作审计', subtitle: '记录是谁、何时、改了什么，便于追踪问题与核查历史。' }
]

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
    // ignore
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
  flex-direction: row !important;
  align-items: stretch;
  background: #edf2f8;
}

.ems-shell :deep(.ant-layout) {
  min-width: 0;
}

.ems-shell :deep(.ant-layout-has-sider) {
  flex-direction: row !important;
}

.ems-sidebar {
  overflow: hidden;
  background: #071d31 !important;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 8px 0 24px rgba(4, 18, 32, 0.12);
  transition:
    width 0.22s ease,
    min-width 0.22s ease,
    max-width 0.22s ease,
    flex-basis 0.22s ease !important;
}

.ems-sidebar__inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 160px;
}

.ems-sidebar__inner--drawer {
  margin: -24px;
  height: calc(100% + 48px);
  width: auto;
}

.ems-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 64px;
  padding: 12px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ems-brand__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: linear-gradient(135deg, #3f8cff 0%, #1b5fe4 100%);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.ems-brand__copy {
  min-width: 0;
}

.ems-brand__title {
  color: #f7fbff;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
}

.ems-brand__subtitle {
  margin-top: 2px;
  color: rgba(214, 228, 244, 0.7);
  font-size: 11px;
  line-height: 1.25;
}

.ems-menu-wrap {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 6px 12px;
}

.ems-menu-wrap :deep(.ant-menu) {
  border-inline-end: 0 !important;
  background: transparent !important;
  padding: 0 !important;
}

.ems-menu-wrap :deep(.ant-menu-item) {
  height: 36px;
  line-height: 36px;
  margin: 4px 0;
  border-radius: 9px;
  color: rgba(231, 239, 248, 0.88);
  font-size: 13px;
  padding-inline: 12px !important;
}

.ems-menu-wrap :deep(.ant-menu-item:hover) {
  color: #fff !important;
  background: rgba(63, 140, 255, 0.18) !important;
}

.ems-menu-wrap :deep(.ant-menu-item-selected) {
  color: #fff !important;
  background: linear-gradient(135deg, #2f71ff 0%, #1d58de 100%) !important;
  box-shadow: 0 8px 20px rgba(30, 88, 222, 0.24);
}

.ems-sidebar-toggle {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 76px;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 999px;
  background: #0d0d0f;
  color: #fff;
  box-shadow: 0 8px 18px rgba(12, 12, 13, 0.24);
  cursor: pointer;
  transition: box-shadow 0.22s ease, background 0.22s ease, transform 0.22s ease;
}

.ems-sidebar-toggle:hover {
  background: #1a1a1c;
  box-shadow: 0 10px 22px rgba(12, 12, 13, 0.28);
  transform: translateY(-1px);
}

.ems-sidebar-toggle__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 12px;
  line-height: 1;
}

.ems-sidebar-toggle__text {
  font-size: 11px;
  line-height: 1;
  font-weight: 700;
  white-space: nowrap;
}

.ems-main {
  min-width: 0;
  flex: 1 1 auto;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3f8 100%);
}

.ems-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 82px;
  line-height: normal;
  padding: 14px 24px 14px 96px;
  background: rgba(255, 255, 255, 0.94);
  border-bottom: 1px solid rgba(14, 30, 48, 0.08);
}

.ems-topbar__left,
.ems-topbar__right {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.ems-topbar__title {
  min-width: 0;
}

.ems-page-title {
  color: #13253a;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.ems-page-subtitle {
  margin-top: 4px;
  color: #6c7b8d;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ems-topbar__toggle,
.ems-logout {
  border-radius: 999px !important;
  height: 34px;
  padding: 0 14px;
}

.ems-topbar__toggle {
  border: 1px solid rgba(47, 113, 255, 0.18) !important;
  background: rgba(47, 113, 255, 0.08) !important;
  color: #2154c6 !important;
}

.ems-version {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 74px;
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: #0f2640;
  color: #dceaff;
  font-size: 12px;
  font-weight: 700;
}

.ems-user {
  min-width: 0;
  text-align: right;
}

.ems-user__name {
  color: #15263a;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}

.ems-user__role {
  margin-top: 2px;
  color: #738196;
  font-size: 11px;
  line-height: 1.2;
}

.ems-logout {
  border: 1px solid rgba(21, 38, 58, 0.1) !important;
  background: #fff !important;
  color: #17324a !important;
}

.ems-content {
  min-height: calc(100vh - 82px);
  padding: 28px 32px 32px 40px;
  overflow: auto;
}

.ems-mobile-drawer :deep(.ant-drawer-body) {
  padding: 0;
  background: #071d31;
}

@media (max-width: 900px) {
  .ems-shell--mobile {
    background:
      radial-gradient(circle at 88% 0%, rgba(90, 200, 250, 0.24), transparent 30%),
      linear-gradient(180deg, #f7fbff 0%, #eef7ff 100%);
  }

  .ems-topbar {
    position: sticky;
    top: 0;
    z-index: 50;
    height: auto;
    min-height: 72px;
    padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 10px;
    flex-direction: row;
    align-items: center;
    border-bottom: 1px solid rgba(0, 122, 255, 0.08);
    background: rgba(255, 255, 255, 0.88);
    backdrop-filter: blur(18px);
  }

  .ems-topbar__left,
  .ems-topbar__right {
    justify-content: flex-start;
  }

  .ems-topbar__right {
    margin-left: auto;
    gap: 8px;
    flex-wrap: nowrap;
  }

  .ems-topbar__title {
    flex: 1;
  }

  .ems-topbar__toggle {
    min-width: 46px;
    width: 46px;
    height: 40px;
    padding: 0 !important;
    border-radius: 16px !important;
    font-size: 0;
  }

  .ems-topbar__toggle::before {
    content: '≡';
    font-size: 22px;
    line-height: 1;
  }

  .ems-page-title {
    font-size: 17px;
    letter-spacing: -0.02em;
  }

  .ems-page-subtitle {
    max-width: 48vw;
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
  }

  .ems-version {
    min-width: 58px;
    height: 30px;
    padding: 0 9px;
    background: #e9f3ff;
    color: #0067d8;
  }

  .ems-user,
  .ems-logout {
    display: none;
  }

  .ems-content {
    min-height: calc(100vh - 72px);
    padding: 12px 10px calc(86px + env(safe-area-inset-bottom, 0px));
    overflow-x: hidden;
  }

  .ems-mobile-tabs {
    position: fixed;
    left: 10px;
    right: 10px;
    bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    z-index: 70;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
    padding: 8px;
    border: 1px solid rgba(174, 205, 244, 0.72);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 18px 42px rgba(30, 83, 142, 0.18);
    backdrop-filter: blur(22px);
  }

  .ems-mobile-tabs__item {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    min-height: 46px;
    border: 0;
    border-radius: 18px;
    background: transparent;
    color: #60728d;
    font-size: 11px;
    font-weight: 700;
  }

  .ems-mobile-tabs__dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: #c9d8ea;
  }

  .ems-mobile-tabs__item--active {
    background: linear-gradient(180deg, #eaf5ff 0%, #dcebff 100%);
    color: #0067d8;
  }

  .ems-mobile-tabs__item--active .ems-mobile-tabs__dot {
    background: #007aff;
    box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.12);
  }

  .ems-mobile-drawer :deep(.ant-drawer-content) {
    border-top-right-radius: 26px;
    border-bottom-right-radius: 26px;
    overflow: hidden;
  }

  .ems-mobile-drawer :deep(.ant-menu-item) {
    height: 42px;
    line-height: 42px;
    margin: 6px 10px;
    border-radius: 15px;
  }
}

@media (max-width: 640px) {
  .ems-topbar__left,
  .ems-topbar__right {
    flex-direction: column;
    align-items: flex-start;
  }

  .ems-user {
    text-align: left;
  }
}

.ems-shell {
  background:
    radial-gradient(circle at 92% 4%, rgba(0, 122, 255, 0.12), transparent 28%),
    linear-gradient(180deg, #f5faff 0%, #eef6ff 100%);
}

.ems-sidebar {
  background: rgba(255, 255, 255, 0.82) !important;
  border-right: 1px solid rgba(0, 122, 255, 0.1);
  box-shadow: 10px 0 30px rgba(36, 75, 125, 0.07);
  backdrop-filter: blur(22px);
}

.ems-sidebar__inner {
  width: 176px;
}

.ems-brand {
  min-height: 74px;
  padding: 16px 14px;
  border-bottom: 1px solid rgba(0, 122, 255, 0.08);
}

.ems-brand__mark {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: linear-gradient(135deg, #5ac8fa 0%, #007aff 100%);
  box-shadow: 0 12px 22px rgba(0, 122, 255, 0.2);
}

.ems-brand__title {
  color: #1d1d1f;
  font-size: 13px;
  letter-spacing: -0.01em;
}

.ems-brand__subtitle {
  color: #6b7b90;
}

.ems-menu-wrap {
  padding: 10px 10px 16px;
}

.ems-menu-wrap :deep(.ant-menu-item) {
  height: 38px;
  line-height: 38px;
  margin: 5px 0;
  border-radius: 13px;
  color: #4b5f78 !important;
  font-size: 13px;
  font-weight: 600;
  padding-inline: 13px !important;
}

.ems-menu-wrap :deep(.ant-menu-item:hover) {
  color: #007aff !important;
  background: rgba(0, 122, 255, 0.08) !important;
}

.ems-menu-wrap :deep(.ant-menu-item-selected) {
  color: #005fc7 !important;
  background: linear-gradient(135deg, rgba(0, 122, 255, 0.16), rgba(90, 200, 250, 0.16)) !important;
  box-shadow: inset 0 0 0 1px rgba(0, 122, 255, 0.12), 0 10px 22px rgba(0, 122, 255, 0.1);
}

.ems-sidebar-toggle {
  top: 14px;
  left: 14px;
  height: 32px;
  min-width: 88px;
  border: 1px solid rgba(0, 122, 255, 0.14);
  background: rgba(255, 255, 255, 0.88);
  color: #1d1d1f;
  box-shadow: 0 12px 26px rgba(31, 63, 103, 0.12);
  backdrop-filter: blur(18px);
}

.ems-sidebar-toggle:hover {
  background: #ffffff;
  color: #007aff;
  box-shadow: 0 14px 28px rgba(31, 63, 103, 0.16);
}

.ems-main {
  background:
    radial-gradient(circle at 100% 0%, rgba(90, 200, 250, 0.16), transparent 25%),
    linear-gradient(180deg, #f5faff 0%, #edf6ff 100%);
}

.ems-topbar {
  height: 78px;
  padding: 14px 26px 14px 118px;
  background: rgba(255, 255, 255, 0.76);
  border-bottom: 1px solid rgba(0, 122, 255, 0.1);
  box-shadow: 0 10px 30px rgba(31, 63, 103, 0.06);
  backdrop-filter: blur(22px);
}

.ems-page-title {
  color: #1d1d1f;
  font-size: 22px;
  letter-spacing: -0.03em;
}

.ems-page-subtitle {
  color: #66788f;
}

.ems-version {
  background: rgba(0, 122, 255, 0.1);
  color: #0066d6;
  border: 1px solid rgba(0, 122, 255, 0.12);
}

.ems-user__name {
  color: #1d1d1f;
}

.ems-user__role {
  color: #7b8794;
}

.ems-logout {
  border-color: rgba(0, 122, 255, 0.16) !important;
  background: rgba(255, 255, 255, 0.82) !important;
  color: #0066d6 !important;
}

.ems-content {
  min-height: calc(100vh - 78px);
  padding: 26px 32px 34px;
}
</style>
