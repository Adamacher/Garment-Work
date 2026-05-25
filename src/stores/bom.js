import { defineStore } from 'pinia'

export const useBomStore = defineStore('bom', {
  state: () => ({
    list: [
      {
        id: 1,
        style: '夏季T恤',
        items: [
          { type: '面料', name: '棉布', unit: '米', qty: 1.2, lossRate: 0.05 },
          { type: '辅料', name: '纽扣', unit: '个', qty: 6, lossRate: 0.02 }
        ]
      }
    ]
  }),
  actions: {
    add(item) {
      item.id = Date.now()
      this.list.unshift(item)
    },
    update(id, data) {
      const idx = this.list.findIndex(i => i.id === id)
      if (idx > -1) this.list[idx] = { ...this.list[idx], ...data }
    },
    remove(id) {
      this.list = this.list.filter(i => i.id !== id)
    }
  }
})