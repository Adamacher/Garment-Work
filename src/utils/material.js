function round(value, digits = 6) {
  return Number(Number(value || 0).toFixed(digits))
}

export function normalizeUnit(unit) {
  const raw = String(unit || '').trim()
  const value = raw.toLowerCase()

  if (['m', 'meter', 'meters', '米'].includes(value) || raw === '米') return '米'
  if (['yd', 'yard', 'yards', '码'].includes(value) || raw === '码') return '码'
  if (['kg', '公斤', '千克'].includes(value) || raw === '公斤' || raw === '千克') return '公斤'
  if (['cm', '厘米'].includes(value) || raw === '厘米') return '厘米'
  if (['个'].includes(value) || raw === '个') return '个'
  if (['条'].includes(value) || raw === '条') return '条'
  if (['对'].includes(value) || raw === '对') return '对'
  if (['卷'].includes(value) || raw === '卷') return '卷'

  return raw || '米'
}

export function calculateAutoMetersPerKg(material = {}) {
  const width = Number(material.width || 0)
  const weight = Number(material.weight || 0)
  if (!width || !weight) return 0
  return round(100000 / (width * weight), 6)
}

export function resolveMetersPerKg(material = {}) {
  const manual = Number(material.meter_per_kg || 0)
  if (manual > 0) return manual
  return calculateAutoMetersPerKg(material)
}

function getCustomConversion(material = {}) {
  const fromQty = Number(material.custom_conversion_from_qty || 0)
  const toQty = Number(material.custom_conversion_to_qty || 0)
  const fromUnit = normalizeUnit(material.custom_conversion_from_unit || '')
  const toUnit = normalizeUnit(material.custom_conversion_to_unit || '')
  if (fromQty <= 0 || toQty <= 0 || !fromUnit || !toUnit || fromUnit === toUnit) return null
  return { fromQty, toQty, fromUnit, toUnit }
}

function buildConversionGraph(material = {}) {
  const graph = new Map()

  const addEdge = (from, to, factor) => {
    const safeFactor = Number(factor || 0)
    if (!from || !to || !safeFactor) return
    if (!graph.has(from)) graph.set(from, [])
    graph.get(from).push({ to, factor: safeFactor })
  }

  addEdge('米', '厘米', 100)
  addEdge('厘米', '米', 0.01)
  addEdge('米', '码', 1 / 0.9144)
  addEdge('码', '米', 0.9144)

  const metersPerKg = resolveMetersPerKg(material)
  if (metersPerKg > 0) {
    addEdge('公斤', '米', metersPerKg)
    addEdge('米', '公斤', 1 / metersPerKg)
  }

  const custom = getCustomConversion(material)
  if (custom) {
    addEdge(custom.fromUnit, custom.toUnit, custom.toQty / custom.fromQty)
    addEdge(custom.toUnit, custom.fromUnit, custom.fromQty / custom.toQty)
  }

  return graph
}

function resolveConversionFactor(fromUnit, toUnit, material = {}) {
  const sourceUnit = normalizeUnit(fromUnit)
  const targetUnit = normalizeUnit(toUnit)
  if (!sourceUnit || !targetUnit) return 0
  if (sourceUnit === targetUnit) return 1

  const graph = buildConversionGraph(material)
  const queue = [{ unit: sourceUnit, factor: 1 }]
  const visited = new Set([sourceUnit])

  while (queue.length) {
    const current = queue.shift()
    const edges = graph.get(current.unit) || []
    for (const edge of edges) {
      const nextFactor = current.factor * edge.factor
      if (edge.to === targetUnit) return nextFactor
      if (!visited.has(edge.to)) {
        visited.add(edge.to)
        queue.push({ unit: edge.to, factor: nextFactor })
      }
    }
  }

  return 0
}

export function convertQuantity(value, fromUnit, toUnit, material = {}) {
  const amount = Number(value || 0)
  const sourceUnit = normalizeUnit(fromUnit)
  const targetUnit = normalizeUnit(toUnit)

  if (!amount || sourceUnit === targetUnit) return amount

  const factor = resolveConversionFactor(sourceUnit, targetUnit, material)
  if (!factor) return 0

  return round(amount * factor, 6)
}

export function convertUnitPrice(price, fromUnit, toUnit, material = {}) {
  const unitPrice = Number(price || 0)
  if (!unitPrice) return 0

  const requiredSourceUnits = convertQuantity(1, toUnit, fromUnit, material)
  if (!requiredSourceUnits) return 0

  return round(unitPrice * requiredSourceUnits, 6)
}
