<template>
  <div class="mobile-filter-shell" :class="{ 'mobile-filter-shell--mobile': isMobile }">
    <div v-if="!isMobile" class="mobile-filter-shell__desktop">
      <div class="mobile-filter-shell__filters">
        <slot name="filters" />
      </div>
      <div class="mobile-filter-shell__actions">
        <slot name="actions" />
      </div>
    </div>

    <template v-else>
      <div class="mobile-filter-shell__mobile-actions">
        <slot name="actions" />
      </div>

      <a-button
        class="mobile-filter-fab"
        :class="{ 'mobile-filter-fab--dragging': dragging }"
        type="primary"
        :style="fabStyle"
        @touchstart.passive="handleTouchStart"
        @touchmove.prevent="handleTouchMove"
        @touchend="handleTouchEnd"
        @mousedown="handleMouseDown"
        @click="handleFabClick"
      >
        筛选
      </a-button>

      <a-drawer
        class="mobile-filter-drawer"
        placement="bottom"
        :height="'78vh'"
        :open="open"
        title="搜索与筛选"
        @close="open = false"
      >
        <div class="mobile-filter-drawer__inner">
          <slot name="filters" />
        </div>
        <template #footer>
          <div class="mobile-filter-drawer__footer">
            <a-button @click="open = false">关闭</a-button>
          </div>
        </template>
      </a-drawer>
    </template>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const MOBILE_BREAKPOINT = 900
const STORAGE_KEY = 'garment_mobile_filter_fab_position'
const FAB_WIDTH = 88
const FAB_HEIGHT = 44
const FAB_GAP = 16

const open = ref(false)
const isMobile = ref(false)
const dragging = ref(false)
const hasMoved = ref(false)
const fabX = ref(0)
const fabY = ref(0)

const dragState = {
  pointerId: null,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0
}

const fabStyle = computed(() => {
  if (!isMobile.value) return {}
  return {
    left: `${fabX.value}px`,
    top: `${fabY.value}px`,
    right: 'auto',
    bottom: 'auto'
  }
})

function getViewportBounds() {
  if (typeof window === 'undefined') {
    return { maxX: 0, maxY: 0 }
  }
  return {
    maxX: Math.max(FAB_GAP, window.innerWidth - FAB_WIDTH - FAB_GAP),
    maxY: Math.max(FAB_GAP, window.innerHeight - FAB_HEIGHT - FAB_GAP)
  }
}

function clampFabPosition(x, y) {
  const { maxX, maxY } = getViewportBounds()
  return {
    x: Math.min(Math.max(FAB_GAP, x), maxX),
    y: Math.min(Math.max(FAB_GAP, y), maxY)
  }
}

function saveFabPosition() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: fabX.value, y: fabY.value }))
  } catch {
    // ignore
  }
}

function setDefaultFabPosition() {
  const { maxX, maxY } = getViewportBounds()
  fabX.value = maxX
  fabY.value = maxY
}

function restoreFabPosition() {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      setDefaultFabPosition()
      return
    }
    const parsed = JSON.parse(raw)
    const next = clampFabPosition(Number(parsed?.x || 0), Number(parsed?.y || 0))
    fabX.value = next.x
    fabY.value = next.y
  } catch {
    setDefaultFabPosition()
  }
}

function ensureFabPosition() {
  if (!isMobile.value) return
  if (!fabX.value && !fabY.value) {
    restoreFabPosition()
    return
  }
  const next = clampFabPosition(fabX.value, fabY.value)
  fabX.value = next.x
  fabY.value = next.y
}

function syncViewport() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT
  if (!isMobile.value) open.value = false
  if (isMobile.value) ensureFabPosition()
}

function startDrag(clientX, clientY) {
  dragging.value = true
  hasMoved.value = false
  dragState.startX = clientX
  dragState.startY = clientY
  dragState.originX = fabX.value
  dragState.originY = fabY.value
}

function moveDrag(clientX, clientY) {
  if (!dragging.value) return
  const deltaX = clientX - dragState.startX
  const deltaY = clientY - dragState.startY
  if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
    hasMoved.value = true
  }
  const next = clampFabPosition(dragState.originX + deltaX, dragState.originY + deltaY)
  fabX.value = next.x
  fabY.value = next.y
}

function endDrag() {
  if (!dragging.value) return
  dragging.value = false
  saveFabPosition()
}

function handleFabClick(event) {
  if (hasMoved.value) {
    event.preventDefault()
    event.stopPropagation()
    hasMoved.value = false
    return
  }
  open.value = true
}

function handleTouchStart(event) {
  const touch = event.touches?.[0]
  if (!touch) return
  dragState.pointerId = touch.identifier
  startDrag(touch.clientX, touch.clientY)
}

function handleTouchMove(event) {
  const touch =
    [...(event.touches || [])].find((item) => item.identifier === dragState.pointerId) ||
    event.touches?.[0]
  if (!touch) return
  moveDrag(touch.clientX, touch.clientY)
}

function handleTouchEnd() {
  endDrag()
  dragState.pointerId = null
}

function handleMouseMove(event) {
  moveDrag(event.clientX, event.clientY)
}

function handleMouseUp() {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  endDrag()
}

function handleMouseDown(event) {
  startDrag(event.clientX, event.clientY)
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

onMounted(() => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport)
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
})
</script>

<style scoped>
.mobile-filter-shell {
  width: 100%;
}

.mobile-filter-shell__desktop {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
}

.mobile-filter-shell__filters {
  flex: 1;
  min-width: 0;
}

.mobile-filter-shell__actions {
  flex-shrink: 0;
}

.mobile-filter-shell__mobile-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.mobile-filter-fab {
  position: fixed;
  z-index: 1200;
  width: 88px;
  height: 44px;
  border-radius: 999px;
  box-shadow: 0 12px 30px rgba(24, 104, 255, 0.28);
  touch-action: none;
  user-select: none;
}

.mobile-filter-fab--dragging {
  opacity: 0.92;
  box-shadow: 0 18px 34px rgba(24, 104, 255, 0.36);
}

.mobile-filter-drawer :deep(.ant-drawer-content) {
  border-top-left-radius: 24px;
  border-top-right-radius: 24px;
}

.mobile-filter-drawer :deep(.ant-drawer-header) {
  padding: 16px 18px 8px;
}

.mobile-filter-drawer :deep(.ant-drawer-title) {
  font-weight: 800;
}

.mobile-filter-drawer :deep(.ant-drawer-body) {
  padding: 12px 16px 20px;
}

.mobile-filter-drawer__inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mobile-filter-drawer__footer {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 900px) {
  .mobile-filter-shell__desktop {
    display: block;
  }
}
</style>
