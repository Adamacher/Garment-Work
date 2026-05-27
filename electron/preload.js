const { contextBridge, ipcRenderer } = require('electron')

function toPlainPayload(payload) {
  if (payload === undefined) return undefined
  return JSON.parse(JSON.stringify(payload))
}

function invokeBridge(channel, ...args) {
  if (channel.startsWith('db:') || channel.startsWith('auth:')) {
    return ipcRenderer.invoke('lan:invoke', {
      channel,
      args: toPlainPayload(args)
    })
  }
  return ipcRenderer.invoke(channel, ...args)
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  db: {
    getDashboardStats: () => invokeBridge('db:getDashboardStats'),
    getMaterials: () => invokeBridge('db:getMaterials'),
    addMaterial: (payload) => invokeBridge('db:addMaterial', payload),
    updateMaterial: (payload) => invokeBridge('db:updateMaterial', payload),
    deleteMaterial: (id) => invokeBridge('db:deleteMaterial', id),
    getGarments: () => invokeBridge('db:getGarments'),
    addGarment: (payload) => invokeBridge('db:addGarment', payload),
    updateGarment: (payload) => invokeBridge('db:updateGarment', payload),
    batchUpdateGarmentMarkup: (payload) => invokeBridge('db:batchUpdateGarmentMarkup', toPlainPayload(payload)),
    batchUpdatePurchaseBatchDocumentStatus: (payload) => invokeBridge('db:batchUpdatePurchaseBatchDocumentStatus', toPlainPayload(payload)),
    approvePurchaseBatches: (payload) => invokeBridge('db:approvePurchaseBatches', toPlainPayload(payload)),
    voidPurchaseBatches: (payload) => invokeBridge('db:voidPurchaseBatches', toPlainPayload(payload)),
    returnPurchaseBatchesToDraft: (payload) => invokeBridge('db:returnPurchaseBatchesToDraft', toPlainPayload(payload)),
    batchUpdateProductionOrderDocumentStatus: (payload) => invokeBridge('db:batchUpdateProductionOrderDocumentStatus', toPlainPayload(payload)),
    approveProductionOrders: (payload) => invokeBridge('db:approveProductionOrders', toPlainPayload(payload)),
    voidProductionOrders: (payload) => invokeBridge('db:voidProductionOrders', toPlainPayload(payload)),
    returnProductionOrdersToDraft: (payload) => invokeBridge('db:returnProductionOrdersToDraft', toPlainPayload(payload)),
    deleteGarment: (id) => invokeBridge('db:deleteGarment', id),
    getBomsByGarment: (garmentId) => invokeBridge('db:getBomsByGarment', garmentId),
    saveBomItem: (payload) => invokeBridge('db:saveBomItem', payload),
    replaceBomItemsByGarment: (garmentId, items) => invokeBridge('db:replaceBomItemsByGarment', garmentId, items),
    deleteBomItem: (id) => invokeBridge('db:deleteBomItem', id),
    getPurchaseBatches: (payload) => invokeBridge('db:getPurchaseBatches', toPlainPayload(payload)),
    getInventorySummary: (payload) => invokeBridge('db:getInventorySummary', toPlainPayload(payload)),
    verifyInventoryStock: (payload) => invokeBridge('db:verifyInventoryStock', toPlainPayload(payload)),
    clearInventoryResidue: (payload) => invokeBridge('db:clearInventoryResidue', toPlainPayload(payload)),
    updatePurchaseBatchFactoryAllocations: (payload) => invokeBridge('db:updatePurchaseBatchFactoryAllocations', toPlainPayload(payload)),
    processPurchaseBatchAfterSale: (payload) => invokeBridge('db:processPurchaseBatchAfterSale', toPlainPayload(payload)),
    getInventoryMovements: (payload) => invokeBridge('db:getInventoryMovements', toPlainPayload(payload)),
    getAuditLogs: (payload) => invokeBridge('db:getAuditLogs', toPlainPayload(payload)),
    getNextBatchNo: () => invokeBridge('db:getNextBatchNo'),
    getNextPurchaseOrderNo: () => invokeBridge('db:getNextPurchaseOrderNo'),
    getOptionLists: () => invokeBridge('db:getOptionLists'),
    saveOptionValue: (type, value) => invokeBridge('db:saveOptionValue', type, value),
    renameOptionValue: (type, oldValue, newValue) => invokeBridge('db:renameOptionValue', type, oldValue, newValue),
    deleteOptionValue: (type, value) => invokeBridge('db:deleteOptionValue', type, value),
    reorderOptionValues: (type, values) => invokeBridge('db:reorderOptionValues', type, values),
    getWorkspaceInfo: () => invokeBridge('db:getWorkspaceInfo'),
    syncLocalDatabaseBackup: () => invokeBridge('db:syncLocalDatabaseBackup'),
    chooseWorkspaceDirectory: () => invokeBridge('db:chooseWorkspaceDirectory'),
    setupSimpleLanShare: () => invokeBridge('db:setupSimpleLanShare'),
    openWorkspaceReadOnly: () => invokeBridge('db:openWorkspaceReadOnly'),
    setCurrentComputerAsHost: () => invokeBridge('db:setCurrentComputerAsHost'),
    tryOfflineAutoSync: () => invokeBridge('db:tryOfflineAutoSync'),
    exportDatabaseFile: () => invokeBridge('db:exportDatabaseFile'),
    importDatabaseFile: () => invokeBridge('db:importDatabaseFile'),
    copyBackupText: () => invokeBridge('db:copyBackupText'),
    exportBackupText: () => invokeBridge('db:exportBackupText'),
    exportBackupFile: () => invokeBridge('db:exportBackupFile'),
    importBackupText: (text) => invokeBridge('db:importBackupText', text),
    importBackupFile: () => invokeBridge('db:importBackupFile'),
    optimizeStorage: () => invokeBridge('db:optimizeStorage'),
    getOptimizeStorageStatus: () => invokeBridge('db:getOptimizeStorageStatus'),
    previewEffectivePrice: (payload) => invokeBridge('db:previewEffectivePrice', payload),
    savePurchaseBatch: (payload) => invokeBridge('db:savePurchaseBatch', toPlainPayload(payload)),
    splitPurchaseBatch: (payload) => invokeBridge('db:splitPurchaseBatch', payload),
    mergePurchaseBatches: (payload) => invokeBridge('db:mergePurchaseBatches', toPlainPayload(payload)),
    unmergePurchaseBatches: (payload) => invokeBridge('db:unmergePurchaseBatches', toPlainPayload(payload)),
    deletePurchaseBatch: (id) => invokeBridge('db:deletePurchaseBatch', id),
    getConsumptionRecords: () => invokeBridge('db:getConsumptionRecords'),
    saveConsumptionRecord: (payload) => invokeBridge('db:saveConsumptionRecord', payload),
    deleteConsumptionRecord: (id) => invokeBridge('db:deleteConsumptionRecord', id),
    getProductionOrders: (payload) => invokeBridge('db:getProductionOrders', toPlainPayload(payload)),
    getProductionOrderDetail: (id) => invokeBridge('db:getProductionOrderDetail', id),
    updateProductionOrderStatus: (payload) => invokeBridge('db:updateProductionOrderStatus', toPlainPayload(payload)),
    getNextProductionOrderNo: () => invokeBridge('db:getNextProductionOrderNo'),
    saveProductionOrder: (payload) => invokeBridge('db:saveProductionOrder', toPlainPayload(payload)),
    deleteProductionOrder: (id) => invokeBridge('db:deleteProductionOrder', id)
  },
  auth: {
    login: (payload) => invokeBridge('auth:login', toPlainPayload(payload)),
    getUsers: () => invokeBridge('auth:getUsers'),
    saveUser: (payload) => invokeBridge('auth:saveUser', toPlainPayload(payload)),
    deleteUser: (id) => invokeBridge('auth:deleteUser', id)
  },
  order: {
    exportPdf: (payload) => ipcRenderer.invoke('order:exportPdf', toPlainPayload(payload)),
    exportExcel: (payload) => ipcRenderer.invoke('order:exportExcel', toPlainPayload(payload)),
    exportImage: (payload) => ipcRenderer.invoke('order:exportImage', toPlainPayload(payload)),
    exportPurchasePdf: (batchId) => ipcRenderer.invoke('order:exportPurchasePdf', batchId),
    exportPurchaseExcel: (batchId) => ipcRenderer.invoke('order:exportPurchaseExcel', batchId),
    exportPurchaseImage: (batchId) => ipcRenderer.invoke('order:exportPurchaseImage', batchId),
    batchExportPurchaseDocuments: (payload) => ipcRenderer.invoke('order:batchExportPurchaseDocuments', toPlainPayload(payload)),
    batchExportProductionOrders: (payload) => ipcRenderer.invoke('order:batchExportProductionOrders', toPlainPayload(payload)),
    exportMergedPurchasePdf: (batchIds) => ipcRenderer.invoke('order:exportMergedPurchasePdf', toPlainPayload(batchIds)),
    exportMergedPurchaseExcel: (batchIds) => ipcRenderer.invoke('order:exportMergedPurchaseExcel', toPlainPayload(batchIds)),
    exportMergedPurchaseImage: (batchIds) => ipcRenderer.invoke('order:exportMergedPurchaseImage', toPlainPayload(batchIds))
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getAutoLaunchSettings: () => ipcRenderer.invoke('app:getAutoLaunchSettings'),
    setAutoLaunchEnabled: (enabled) => ipcRenderer.invoke('app:setAutoLaunchEnabled', Boolean(enabled)),
    applyPatchPackage: () => ipcRenderer.invoke('app:applyPatchPackage')
  },
  lan: {
    getConfig: () => ipcRenderer.invoke('lan:getConfig'),
    updateConfig: (payload) => ipcRenderer.invoke('lan:updateConfig', toPlainPayload(payload))
  },
  misc: {
    exportHtmlExcel: (payload) => ipcRenderer.invoke('misc:exportHtmlExcel', toPlainPayload(payload))
  }
})
