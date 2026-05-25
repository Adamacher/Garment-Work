export function calcBomNeed(items, orderQty = 1) {
  return items.map(item => {
    const need = item.qty * orderQty
    const withLoss = need * (1 + (item.lossRate || 0))
    return {
      ...item,
      need: Number(withLoss.toFixed(2))
    }
  })
}

export function calcPurchaseSuggestions(bomItems, inventoryList, orderQty = 1) {
  const needList = calcBomNeed(bomItems, orderQty)

  return needList.map(needItem => {
    const inv = inventoryList.find(i => i.name === needItem.name)
    const stock = inv ? inv.stock : 0
    const shortage = needItem.need - stock

    return {
      name: needItem.name,
      type: needItem.type,
      unit: needItem.unit,
      need: needItem.need,
      stock,
      shortage: shortage > 0 ? Number(shortage.toFixed(2)) : 0
    }
  })
}