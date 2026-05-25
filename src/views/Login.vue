<template>
  <div class="login-shell">
    <div class="login-panel">
      <div class="login-copy">
        <div class="login-badge">{{ isBrowserRemoteMode ? 'Garment EMS Mobile' : 'Garment EMS' }}</div>
        <h1 class="login-title">服装采购生产管理系统</h1>
        <p class="login-subtitle">
          {{
            isBrowserRemoteMode
              ? '当前为浏览器远程模式，请先填写主机地址，再使用主机上的账号密码登录。'
              : '勾选记住账号密码后，程序下次启动会自动登录，无需每次重新手动输入。'
          }}
        </p>
      </div>

      <a-card class="login-card" :bordered="false">
        <a-form layout="vertical" @finish="login">
          <a-form-item v-if="isBrowserRemoteMode" label="主机地址">
            <a-input
              v-model:value="form.host"
              size="large"
              placeholder="例如：http://100.x.x.x:18680"
              @pressEnter="login"
            />
          </a-form-item>

          <a-form-item label="账号">
            <a-input
              v-model:value="form.username"
              size="large"
              placeholder="请输入账号"
              @pressEnter="login"
            />
          </a-form-item>

          <a-form-item label="密码">
            <a-input-password
              v-model:value="form.password"
              size="large"
              placeholder="请输入密码"
              @pressEnter="login"
            />
          </a-form-item>

          <div class="login-options">
            <a-checkbox v-model:checked="form.remember">记住账号密码</a-checkbox>
            <span class="login-helper">
              {{
                isBrowserRemoteMode
                  ? '主机地址和账号密码只保存在当前浏览器本地。'
                  : '账号密码只保存在当前电脑本地。'
              }}
            </span>
          </div>

          <a-button type="primary" size="large" block :loading="submitting" @click="login()">
            登录系统
          </a-button>
        </a-form>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  api,
  checkRemoteHostHealth,
  getStoredRemoteHost,
  isBrowserRemoteMode,
  setStoredRemoteHost
} from '@/utils/api'
import {
  clearRememberedLogin,
  firstAccessiblePath,
  getRememberedLogin,
  setRememberedLogin,
  setStoredSession
} from '@/utils/auth'

const router = useRouter()
const submitting = ref(false)
const form = reactive({
  host: '',
  username: '',
  password: '',
  remember: true
})

onMounted(async () => {
  const remembered = getRememberedLogin()
  if (remembered?.remember) {
    form.username = String(remembered.username || '')
    form.password = String(remembered.password || '')
    form.remember = true
  }

  if (isBrowserRemoteMode) {
    form.host = getStoredRemoteHost()
  }

  if (remembered?.remember && form.username && form.password && !isBrowserRemoteMode) {
    await login(true)
  }
})

async function login(silent = false) {
  if (submitting.value) return

  if (isBrowserRemoteMode) {
    const host = setStoredRemoteHost(form.host)
    form.host = host
    if (!host) {
      if (!silent) message.error('请先填写主机地址，例如：http://100.x.x.x:18680')
      return
    }
    await checkRemoteHostHealth(host)
  }

  if (!form.username.trim() || !form.password) {
    if (!silent) message.error('请输入账号和密码')
    return
  }

  submitting.value = true
  try {
    const session = await api.auth.login({
      username: form.username.trim(),
      password: form.password
    })

    setStoredSession(session)

    if (form.remember) {
      setRememberedLogin({
        username: form.username.trim(),
        password: form.password,
        remember: true
      })
    } else {
      clearRememberedLogin()
    }

    if (!silent) {
      message.success(`欢迎回来，${session.display_name || session.username}`)
    }

    router.replace(firstAccessiblePath(session))
  } catch (error) {
    if (!silent) {
      message.error(error?.message || '登录失败')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.login-shell {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
}

.login-panel {
  width: min(960px, 100%);
}

.login-copy {
  margin-bottom: 20px;
}

.login-badge {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(47, 113, 255, 0.12);
  color: #1d58de;
  font-size: 12px;
  font-weight: 700;
}

.login-title {
  margin: 14px 0 8px;
  color: #13253a;
  font-size: 34px;
  line-height: 1.15;
}

.login-subtitle {
  margin: 0;
  color: #667589;
  font-size: 15px;
  line-height: 1.7;
}

.login-card {
  border-radius: 24px;
  box-shadow: 0 24px 60px rgba(17, 37, 61, 0.12);
}

.login-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.login-helper {
  color: #7e8aa6;
  font-size: 12px;
  text-align: right;
}

@media (max-width: 640px) {
  .login-shell {
    padding: 16px;
  }

  .login-title {
    font-size: 28px;
  }

  .login-options {
    flex-direction: column;
    align-items: flex-start;
  }

  .login-helper {
    text-align: left;
  }
}
</style>
