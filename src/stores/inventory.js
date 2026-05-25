import { defineStore } from 'pinia'

export const useInventoryStore = defineStore('inventory', {
  state: () => ({
    list: [
      { id: 1, name: '棉布', type: '面料', stock: 1200, warning: 300, unit: '米' },
      { id: 2, name: '纽扣', type: '辅料', stock: 3000, warning: 500, unit: '个' },
      { id: 3, name: '拉链', type: '辅料', stock: 200, warning: 100, unit: '条' }
    ]
  }),
  actions: {
    updateStock(name, changeQty) {
      const idx = this.list.findIndex(i => i.name === name)
      if (idx > -1) this.list[idx].stock += changeQty
    },
    setStock(name, qty) {
      const idx = this.list.findIndex(i => i.name === name)
      if (idx > -1) this.list[idx].stock = qty
    }
  }
})