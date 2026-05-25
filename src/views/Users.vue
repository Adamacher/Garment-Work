<template>
  <a-card class="content-card" :bordered="false">
    <PageSummaryStrip :items="summaryItems" />
    <template #title>账号权限</template>

    <div class="toolbar">
      <div class="toolbar-left">
        <a-input v-model:value="keyword" placeholder="搜索账号 / 姓名" style="width: 320px" allow-clear />
      </div>
      <div class="toolbar-right">
        <a-button class="toolbar-refresh-btn" @click="loadUsers">刷新</a-button>
        <a-button type="primary" @click="openCreate">新增账号</a-button>
      </div>
    </div>

    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px;"
      message="账号资料、密码哈希和权限保存在当前数据库里。如果正在使用局域网共享数据库，新建账号后，同一共享库下的其他电脑也可以登录；“记住账号密码”只保存在本机，不会写入共享数据库。"
    />

    <div class="erp-table-caption">
      账号资料、密码哈希与权限保存在当前数据库中；记住账号密码仅保存在本机，不会写入共享数据库。
    </div>

    <a-table class="erp-dense-table" :data-source="filteredList" :columns="columns" :row-key="(row) => row.id" :pagination="{ pageSize: 12, showSizeChanger: true, pageSizeOptions: ['12', '24', '50'] }" size="small">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'role'">
          <a-tag :color="record.role === SUPER_ADMIN_ROLE ? 'gold' : 'blue'">
            {{ record.role === SUPER_ADMIN_ROLE ? '超级管理员' : '普通账号' }}
          </a-tag>
        </template>

        <template v-else-if="column.key === 'permissions'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ record.role === SUPER_ADMIN_ROLE ? '全部功能' : formatPermissions(record.permissions) }}</div>
            <div class="table-secondary">状态：{{ record.enabled ? '启用' : '停用' }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button size="small" @click="openEdit(record)">编辑</a-button>
            <a-popconfirm title="确认删除这个账号？" @confirm="removeUser(record)">
              <a-button size="small" danger :disabled="record.role === SUPER_ADMIN_ROLE">删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="visible" :title="form.id ? '编辑账号' : '新增账号'" width="760px" @ok="saveUser">
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="12"><a-form-item label="账号" required><a-input v-model:value="form.username" /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="姓名 / 备注"><a-input v-model:value="form.display_name" /></a-form-item></a-col>
        </a-row>

        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item :label="form.id ? '重置密码（留空则不修改）' : '密码'" :required="!form.id">
              <a-input-password v-model:value="form.password" />
            </a-form-item>
          </a-col>
          <a-col :span="12"><a-form-item label="账号类型"><a-select v-model:value="form.role" :options="roleOptions" /></a-form-item></a-col>
        </a-row>

        <a-form-item label="状态">
          <a-switch v-model:checked="form.enabled" checked-children="启用" un-checked-children="停用" />
        </a-form-item>

        <a-form-item v-if="form.role !== SUPER_ADMIN_ROLE" label="可使用功能">
          <a-checkbox-group
            v-model:value="form.permissions"
            style="display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 10px 12px;"
          >
            <a-checkbox v-for="item in FEATURE_OPTIONS.filter((entry) => entry.key !== 'users')" :key="item.key" :value="item.key">
              {{ item.label }}
            </a-checkbox>
          </a-checkbox-group>
        </a-form-item>

        <a-alert
          v-else
          type="info"
          show-icon
          message="超级管理员拥有全部功能，无需单独勾选权限。"
        />
      </a-form>
    </a-modal>
  </a-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import PageSummaryStrip from '@/components/PageSummaryStrip.vue'
import { api } from '@/utils/api'
import { FEATURE_OPTIONS, SUPER_ADMIN_ROLE } from '@/utils/auth'

const keyword = ref('')
const visible = ref(false)
const list = ref([])

const columns = [
  { title: '账号', dataIndex: 'username', key: 'username', width: 180 },
  { title: '姓名', dataIndex: 'display_name', key: 'display_name', width: 180 },
  { title: '类型', key: 'role', width: 120 },
  { title: '权限', key: 'permissions' },
  { title: '操作', key: 'action', width: 160 }
]

const roleOptions = [
  { label: '普通账号', value: 'user' },
  { label: '超级管理员', value: SUPER_ADMIN_ROLE }
]

const form = reactive({
  id: null,
  username: '',
  display_name: '',
  password: '',
  role: 'user',
  permissions: [],
  enabled: true
})

const filteredList = computed(() => {
  const value = keyword.value.trim().toLowerCase()
  if (!value) return list.value
  return list.value.filter((item) =>
    [item.username, item.display_name].some((field) => String(field || '').toLowerCase().includes(value))
  )
})

const summaryItems = computed(() => [
  { label: '账号总数', value: `${list.value.length} 个`, note: '软件每次打开都需要先登录' },
  { label: '启用账号', value: `${list.value.filter((item) => item.enabled).length} 个`, note: '停用账号无法登录' },
  { label: '超级管理员', value: `${list.value.filter((item) => item.role === SUPER_ADMIN_ROLE).length} 个`, note: '拥有全部菜单和功能权限' },
  { label: '授权方式', value: '按功能勾选', note: '普通账号按页面功能分配权限' }
])

function resetForm() {
  Object.assign(form, {
    id: null,
    username: '',
    display_name: '',
    password: '',
    role: 'user',
    permissions: [],
    enabled: true
  })
}

function formatPermissions(permissions = []) {
  const labels = FEATURE_OPTIONS.filter((item) => permissions.includes(item.key)).map((item) => item.label)
  return labels.length ? labels.join('、') : '未授权'
}

async function loadUsers() {
  try {
    list.value = await api.auth.getUsers()
  } catch (error) {
    message.error(error.message || '加载账号失败')
  }
}

function openCreate() {
  resetForm()
  visible.value = true
}

function openEdit(record) {
  resetForm()
  Object.assign(form, {
    ...record,
    password: '',
    enabled: Boolean(record.enabled),
    permissions: [...(record.permissions || [])]
  })
  visible.value = true
}

async function saveUser() {
  if (!form.username.trim()) {
    message.error('请输入账号')
    return
  }
  if (!form.id && !form.password) {
    message.error('请输入密码')
    return
  }

  try {
    await api.auth.saveUser(JSON.parse(JSON.stringify({
      id: form.id,
      username: form.username.trim(),
      display_name: form.display_name?.trim?.() || '',
      password: form.password,
      role: form.role,
      permissions: form.role === SUPER_ADMIN_ROLE ? ['*'] : [...(form.permissions || [])],
      enabled: form.enabled ? 1 : 0
    })))
    message.success('账号已保存')
    visible.value = false
    await loadUsers()
  } catch (error) {
    message.error(error.message || '保存账号失败')
  }
}

async function removeUser(record) {
  try {
    await api.auth.deleteUser(record.id)
    message.success('账号已删除')
    await loadUsers()
  } catch (error) {
    message.error(error.message || '删除账号失败')
  }
}

onMounted(loadUsers)
</script>
