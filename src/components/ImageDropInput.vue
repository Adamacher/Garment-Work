<template>
  <div class="image-drop-input">
    <div
      class="image-drop-input__box"
      :class="{ 'image-drop-input__box--dragging': dragging }"
      tabindex="0"
      @click="openFilePicker"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
      @paste="onPaste"
    >
      <a-popover v-if="modelValue" placement="rightTop" trigger="hover" overlay-class-name="inventory-image-popover">
        <template #content>
          <img :src="modelValue" class="inventory-image-preview inventory-image-preview--full" alt="preview-large" />
        </template>
        <img :src="modelValue" class="image-drop-input__preview" alt="preview" @click.stop />
      </a-popover>
      <div v-else class="image-drop-input__placeholder">
        <div class="image-drop-input__title">{{ title }}</div>
        <div class="image-drop-input__hint">点击选择图片，或直接拖入 / 粘贴图片</div>
      </div>
    </div>

    <div class="image-drop-input__actions">
      <a-button size="small" @click="openFilePicker">选择图片</a-button>
      <a-button v-if="modelValue" size="small" @click="flipCurrentImage('x')">左右翻转</a-button>
      <a-button v-if="modelValue" size="small" @click="flipCurrentImage('y')">上下翻转</a-button>
      <a-button v-if="modelValue" size="small" danger @click="emit('update:modelValue', '')">清空</a-button>
      <span class="image-drop-input__tip">支持外部文件拖入和截图粘贴，保存前会自动压缩；可在粘贴框内翻转图片。</span>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      style="display: none"
      @change="onFileChange"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import { compressImageToDataUrl, transformImageDataUrl } from '@/utils/imageCompression'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: '上传图片'
  }
})

const emit = defineEmits(['update:modelValue'])

const dragging = ref(false)
const fileInput = ref(null)

function openFilePicker() {
  fileInput.value?.click()
}

async function readFile(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    message.error('请选择图片文件')
    return
  }

  try {
    const dataUrl = await compressImageToDataUrl(file, {
      maxWidth: 2400,
      maxHeight: 2400,
      quality: 0.9,
      minBytes: 400 * 1024
    })
    emit('update:modelValue', String(dataUrl || ''))
  } catch (error) {
    message.error(error.message || '图片处理失败')
  }
}

async function onFileChange(event) {
  const file = event.target?.files?.[0]
  await readFile(file)
  event.target.value = ''
}

function onDragOver() {
  dragging.value = true
}

function onDragLeave() {
  dragging.value = false
}

async function onDrop(event) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  await readFile(file)
}

async function onPaste(event) {
  const items = Array.from(event.clipboardData?.items || [])
  const imageItem = items.find((item) => String(item.type || '').startsWith('image/'))
  if (!imageItem) return
  const file = imageItem.getAsFile()
  await readFile(file)
}

async function flipCurrentImage(axis = 'x') {
  if (!props.modelValue) return
  try {
    const next = await transformImageDataUrl(props.modelValue, {
      flipX: axis === 'x',
      flipY: axis === 'y'
    })
    emit('update:modelValue', next)
  } catch (error) {
    message.error(error.message || '图片翻转失败')
  }
}
</script>
