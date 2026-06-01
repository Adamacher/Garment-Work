<template>
  <div class="login-shell">
    <div class="login-orb login-orb--blue"></div>
    <div class="login-orb login-orb--cyan"></div>

    <div class="login-panel">
      <section class="login-hero">
        <div class="login-brand">
          <div class="login-brand__mark">□</div>
          <div>
            <h1>服装采购生产管理系统</h1>
            <p>采购 · 生产 · 库存一体化管理</p>
          </div>
        </div>

        <div class="login-hero-card">
          <div class="login-badge">{{ isBrowserRemoteMode ? '安卓远程版' : 'Windows 桌面版' }}</div>
          <h2>欢迎回来</h2>
          <p>
            {{
              isBrowserRemoteMode
                ? '请先填写主机地址，再使用主机电脑上的账号密码登录。'
                : '勾选记住账号密码后，下次启动会自动登录，无需重复输入。'
            }}
          </p>
        </div>
      </section>

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
              {{ isBrowserRemoteMode ? '主机地址和账号密码仅保存在当前设备。' : '账号密码仅保存在当前电脑本地。' }}
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  overflow: hidden;
  background:
    radial-gradient(circle at 12% 12%, rgba(0, 122, 255, 0.16), transparent 30%),
    radial-gradient(circle at 86% 18%, rgba(90, 200, 250, 0.22), transparent 28%),
    linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%);
}

.login-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(4px);
  opacity: 0.55;
}

.login-orb--blue {
  width: 320px;
  height: 320px;
  left: -120px;
  top: -110px;
  background: rgba(0, 122, 255, 0.16);
}

.login-orb--cyan {
  width: 360px;
  height: 360px;
  right: -140px;
  bottom: -120px;
  background: rgba(90, 200, 250, 0.18);
}

.login-panel {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr);
  gap: 28px;
  width: min(1080px, 100%);
  align-items: stretch;
}

.login-hero,
.login-card {
  border: 1px solid rgba(112, 135, 168, 0.16);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 28px 80px rgba(34, 74, 122, 0.12);
}

.login-hero {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 460px;
  padding: 34px;
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 16px;
}

.login-brand__mark {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 18px;
  background: linear-gradient(135deg, #2f7dff, #1664f5);
  color: #fff;
  font-size: 26px;
  font-weight: 900;
  box-shadow: 0 18px 34px rgba(0, 122, 255, 0.24);
}

.login-brand h1 {
  margin: 0;
  color: #0f2341;
  font-size: 26px;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.login-brand p,
.login-hero-card p {
  margin: 6px 0 0;
  color: #71819a;
}

.login-hero-card h2 {
  margin: 18px 0 8px;
  color: #0f2341;
  font-size: 38px;
  line-height: 1.1;
  font-weight: 900;
  letter-spacing: -0.05em;
}

.login-badge {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 13px;
  border-radius: 999px;
  background: rgba(0, 122, 255, 0.1);
  color: #0067d8;
  font-size: 13px;
  font-weight: 800;
}

.login-card {
  padding: 18px;
}

.login-card :deep(.ant-card-body) {
  padding: 18px;
}

.login-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.login-helper {
  color: #7e8aa6;
  font-size: 12px;
  text-align: right;
}

@media (max-width: 760px) {
  .login-shell {
    padding: 16px;
  }

  .login-panel {
    display: block;
  }

  .login-hero {
    min-height: 0;
    margin-bottom: 16px;
    padding: 24px;
  }

  .login-hero-card {
    margin-top: 32px;
  }

  .login-hero-card h2 {
    font-size: 30px;
  }

  .login-brand h1 {
    font-size: 22px;
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
