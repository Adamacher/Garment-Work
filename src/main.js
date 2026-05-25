import { createApp } from 'vue'
import { createPinia } from 'pinia'
import {
  App as AntApp,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  ConfigProvider,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Grid,
  Input,
  InputNumber,
  List,
  Menu,
  Modal,
  Pagination,
  Popconfirm,
  Progress,
  Radio,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import App from './App.vue'
import router from './router'
import './style.css'

function extractErrorText(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (typeof error.message === 'string') return error.message
  if (error.reason) return extractErrorText(error.reason)
  return String(error)
}

function simplifyRemoteError(text) {
  return text
    .replace(/^Error invoking remote method '.*?':\s*/i, '')
    .replace(/^Unhandled error during execution of .*? handler:\s*/i, '')
    .trim()
}

function isIgnorableUiError(text) {
  if (!text) return true
  return /ResizeObserver loop completed with undelivered notifications/i.test(text)
}

function translateError(rawText) {
  const text = simplifyRemoteError(rawText || '').trim()
  if (!text) return { message: '操作失败', detail: '' }
  if (/UNIQUE constraint failed: materials\.code/i.test(text)) {
    return { message: '已存在该物料资料，请勿重复新增。', detail: text }
  }
  if (/UNIQUE constraint failed: users\.username/i.test(text)) {
    return { message: '该账号已存在，请更换账号后再试。', detail: text }
  }
  if (/An object could not be cloned/i.test(text)) {
    return { message: '数据格式异常，请关闭当前窗口后重试。', detail: text }
  }
  if (/UNIQUE constraint failed/i.test(text)) {
    return { message: '数据已存在，请勿重复新增。', detail: text }
  }
  if (/FOREIGN KEY constraint failed/i.test(text)) {
    return { message: '当前数据已被其他单据引用，暂时不能这样操作。', detail: text }
  }
  if (/database is locked|SQLITE_BUSY/i.test(text)) {
    return { message: '数据库正在处理其他操作，请稍后重试。', detail: text }
  }
  if (/Missing named parameter/i.test(text)) {
    return { message: '保存数据时缺少必要字段，请检查当前表单是否完整。', detail: text }
  }
  if (/no such column/i.test(text)) {
    return { message: '当前数据库结构与程序版本不一致，请升级到最新版本后再试。', detail: text }
  }
  if (/Unexpected token|SyntaxError/i.test(text)) {
    return { message: '程序执行时遇到语法异常，请联系管理员处理。', detail: text }
  }
  if (/No handler registered for/i.test(text)) {
    return { message: '程序初始化未完成，请关闭软件后重新打开。', detail: text }
  }
  return { message: text, detail: '' }
}

function showErrorModal(errorLike) {
  const rawText = extractErrorText(errorLike)
  if (isIgnorableUiError(rawText)) return
  const { message: translatedMessage, detail } = translateError(rawText)
  Modal.error({
    title: '错误',
    content: detail
      ? [
          translatedMessage,
          h('div', { style: 'margin-top: 12px; color: #8c8c8c; font-size: 12px; line-height: 1.6;' }, detail),
        ]
      : translatedMessage,
    okText: '关闭',
    centered: true,
    width: 520,
  })
}

const originalMessageError = message.error.bind(message)
message.error = (content, duration, onClose) => {
  const rawText = extractErrorText(content)
  if (isIgnorableUiError(rawText)) return
  const { message: translatedMessage, detail } = translateError(rawText || content)
  return originalMessageError(detail ? `${translatedMessage}\n${detail}` : translatedMessage, duration, onClose)
}

import { h } from 'vue'

const app = createApp(App)
app.use(createPinia())
app.use(router)

app.use(ConfigProvider)
app.use(AntApp)
app.use(Grid)
app.use(Row)
app.use(Col)
app.use(Card)
app.use(Space)
app.use(Statistic)
app.use(Input)
app.use(InputNumber)
app.use(Form)
app.use(Select)
app.use(DatePicker)
app.use(Button)
app.use(Table)
app.use(Tabs)
app.use(Tag)
app.use(Divider)
app.use(Empty)
app.use(Upload)
app.use(Modal)
app.use(Drawer)
app.use(Switch)
app.use(Checkbox)
app.use(Descriptions)
app.use(Tooltip)
app.use(Popconfirm)
app.use(Dropdown)
app.use(Menu)
app.use(Pagination)
app.use(Result)
app.use(List)
app.use(Badge)
app.use(Radio)
app.use(Progress)
app.use(Spin)

app.config.errorHandler = (err) => {
  showErrorModal(err)
  console.error(err)
}

window.addEventListener('error', (event) => {
  showErrorModal(event.error || event.message || '页面运行异常')
})

window.addEventListener('unhandledrejection', (event) => {
  showErrorModal(event.reason || '页面运行异常')
})

app.mount('#app')
