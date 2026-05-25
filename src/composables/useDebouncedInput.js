import { ref, watch } from 'vue'

export function useDebouncedInput(initialValue = '', delay = 240) {
  const inputValue = ref(initialValue)
  const debouncedValue = ref(initialValue)
  let timer = null

  watch(inputValue, (value) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      debouncedValue.value = value
    }, delay)
  }, { immediate: true })

  return {
    inputValue,
    debouncedValue
  }
}
