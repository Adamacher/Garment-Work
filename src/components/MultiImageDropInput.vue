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
      <div v-if="modelValue.length" class="multi-image-grid">
        <div
          v-for="(item, index) in modelValue"
          :key="`${index}-${String(item).slice(0, 20)}`"
          class="multi-image-grid__item"
        >
          <a-popover placement="rightTop" trigger="hover" overlay-class-name="inventory-image-popover">
            <template #content>
              <img :src="item" class="inventory-image-preview inventory-image-preview--full" alt="preview-large" />
            </template>
            <img
              :src="item"
              class="multi-image-grid__preview"
              alt="preview"
              @click.stop="openPreview(item)"
            />
          </a-popover>
          <div class="multi-image-grid__tools">
            <a-button size="small" @click.stop="flipImage(index, 'x')">左右翻转</a-button>
            <a-button size="small" @click.stop="flipImage(index, 'y')">上下翻转</a-button>
          </div>
          <a-button size="small" danger class="multi-image-grid__remove" @click.stop="removeImage(index)">删除</a-button>
        </div>
      </div>
      <div v-else class="image-drop-input__placeholder">
        <div class="image-drop-input__title">{{ title }}</div>
        <div class="image-drop-input__hint">点击选择图片，或直接拖入 / 粘贴图片</div>
      </div>
    </div>

    <div class="image-drop-input__actions">
      <a-button size="small" @click="openFilePicker">选择图片</a-button>
      <a-button v-if="modelValue.length" size="small" danger @click="emit('update:modelValue', [])">清空</a-button>
      <span class="image-drop-input__tip">支持单张或多张图片，保存前会自动压缩；悬停缩略图自动查看完整图，点击可固定放大。</span>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      style="display: none"
      @change="onFileChange"
    />

    <a-modal v-model:open="previewVisible" title="图片预览" :footer="null" width="960px" centered>
      <div class="image-preview-modal">
        <img v-if="previewImage" :src="previewImage" class="image-preview-modal__img" alt="preview-full" />
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import { compressImageToDataUrl, transformImageDataUrl } from '@/utils/imageCompression'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => []
  },
  title: {
    type: String,
    default: '上传图片'
  }
})

const emit = defineEmits(['update:modelValue'])

const dragging = ref(false)
const fileInput = ref(null)
const previewVisible = ref(false)
const previewImage = ref('')

function openFilePicker() {
  fileInput.value?.click()
}

function getImages() {
  return Array.isArray(props.modelValue) ? props.modelValue : []
}

async function readFiles(files = []) {
  const validFiles = Array.from(files).filter((file) => String(file?.type || '').startsWith('image/'))
  if (!validFiles.length) {
    message.error('请选择图片文件')
    return
  }

  try {
    const results = await Promise.all(validFiles.map((file) => compressImageToDataUrl(file, {
      maxWidth: 2400,
      maxHeight: 2400,
      quality: 0.9,
      minBytes: 500 * 1024
    })))
    emit('update:modelValue', [...getImages(), ...results.filter(Boolean)])
  } catch (error) {
    message.error(error.message || '图片处理失败')
  }
}

async function onFileChange(event) {
  await readFiles(event.target?.files || [])
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
  await readFiles(event.dataTransfer?.files || [])
}

async function onPaste(event) {
  const files = Array.from(event.clipboardData?.items || [])
    .filter((item) => String(item.type || '').startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  if (!files.length) return
  await readFiles(files)
}

function removeImage(index) {
  const next = [...getImages()]
  next.splice(index, 1)
  emit('update:modelValue', next)
}

async function flipImage(index, axis = 'x') {
  const next = [...getImages()]
  const source = next[index]
  if (!source) return
  try {
    next[index] = await transformImageDataUrl(source, {
      flipX: axis === 'x',
      flipY: axis === 'y'
    })
    emit('update:modelValue', next)
  } catch (error) {
    message.error(error.message || '图片翻转失败')
  }
}

function openPreview(image) {
  previewImage.value = String(image || '')
  previewVisible.value = Boolean(previewImage.value)
}
</script>
