import { defineStore } from 'pinia'

export const usePurchaseStore = defineStore('purchase', {
  state: () => ({
    list: [
      { id: 1, no: 'CG2024001', supplier: 'A供应商', item: '棉布', qty: 500, status: '待入库' }
    ]
  })
})