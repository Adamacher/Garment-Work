function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('加载图片失败'))
    image.src = dataUrl
  })
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(Number(value || 0), min), max)
}

export async function compressImageToDataUrl(file, options = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('请选择图片文件')
  }

  const minBytes = Math.max(Number(options.minBytes || 0), 0)
  if (Number(file.size || 0) > 0 && Number(file.size || 0) <= minBytes) {
    return fileToDataUrl(file)
  }

  const originalDataUrl = await fileToDataUrl(file)
  const fileType = String(file.type || '').toLowerCase()

  if (fileType.includes('svg') || fileType.includes('gif')) {
    return originalDataUrl
  }

  const image = await loadImage(originalDataUrl)
  const maxWidth = Math.max(Number(options.maxWidth || 2400), 1)
  const maxHeight = Math.max(Number(options.maxHeight || 2400), 1)
  const quality = clampNumber(options.quality ?? 0.9, 0.75, 0.98)

  const scale = Math.min(
    1,
    maxWidth / Math.max(Number(image.width || 1), 1),
    maxHeight / Math.max(Number(image.height || 1), 1)
  )

  const targetWidth = Math.max(1, Math.round(Number(image.width || 1) * scale))
  const targetHeight = Math.max(1, Math.round(Number(image.height || 1) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return originalDataUrl

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(image, 0, 0, targetWidth, targetHeight)

  const compressedDataUrl = canvas.toDataURL('image/jpeg', quality)
  return compressedDataUrl.length && compressedDataUrl.length < originalDataUrl.length
    ? compressedDataUrl
    : originalDataUrl
}

export async function transformImageDataUrl(dataUrl, options = {}) {
  const source = String(dataUrl || '')
  if (!source) return ''

  const image = await loadImage(source)
  const width = Math.max(1, Number(image.width || 1))
  const height = Math.max(1, Number(image.height || 1))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return source

  const flipX = Boolean(options.flipX)
  const flipY = Boolean(options.flipY)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.translate(flipX ? width : 0, flipY ? height : 0)
  context.scale(flipX ? -1 : 1, flipY ? -1 : 1)
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', clampNumber(options.quality ?? 0.92, 0.75, 0.98))
}
