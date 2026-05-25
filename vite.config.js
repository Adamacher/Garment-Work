import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@ant-design/icons-vue')) return 'vendor-antd-icons'
          if (id.includes('ant-design-vue')) return 'vendor-antd'
          if (id.includes('vue-router')) return 'vendor-router'
          if (id.includes('better-sqlite3')) return 'vendor-db'
          return 'vendor'
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173
  }
})
