import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useMobileLayout(breakpoint = 900) {
  const isMobileLayout = ref(false)

  const sync = () => {
    if (typeof window === 'undefined') return
    isMobileLayout.value = window.innerWidth <= breakpoint
  }

  onMounted(() => {
    sync()
    window.addEventListener('resize', sync)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', sync)
  })

  return {
    isMobileLayout
  }
}
