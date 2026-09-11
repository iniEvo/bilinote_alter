import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readAppVersion() {
  const fallbackVersion = '0.0.0'

  try {
    const tauriConfigPath = path.resolve(__dirname, 'src-tauri/tauri.conf.json')
    const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf-8')) as { version?: string }
    return tauriConfig.version || fallbackVersion
  }
  catch {
    return fallbackVersion
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 在 Docker 环境中，父目录可能没有 .env 文件，使用当前目录
  const envDir = process.env.DOCKER_BUILD ? __dirname : path.resolve(__dirname, '../')
  const env = loadEnv(mode, envDir)

  const apiBaseUrl = env.VITE_API_BASE_URL || 'http://127.0.0.1:8483'
  const port = parseInt(env.VITE_FRONTEND_PORT || '3015', 10)
  const appVersion = env.VITE_APP_VERSION || process.env.VITE_APP_VERSION || readAppVersion()

  return {
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    // 预构建 react-syntax-highlighter 的 prism 语言子路径：MarkdownViewer 按需注册
    // 了 12 个语言模块，若不在 optimizeDeps 中声明，Vite dev 运行时才按需预构建，
    // 会触发 "Outdated Optimize Dep" 504 中止请求，导致懒加载的 Home 页崩溃。
    optimizeDeps: {
      include: [
        'react-syntax-highlighter',
        'react-syntax-highlighter/dist/esm/languages/prism/javascript',
        'react-syntax-highlighter/dist/esm/languages/prism/typescript',
        'react-syntax-highlighter/dist/esm/languages/prism/python',
        'react-syntax-highlighter/dist/esm/languages/prism/bash',
        'react-syntax-highlighter/dist/esm/languages/prism/json',
        'react-syntax-highlighter/dist/esm/languages/prism/markdown',
        'react-syntax-highlighter/dist/esm/languages/prism/diff',
        'react-syntax-highlighter/dist/esm/languages/prism/java',
        'react-syntax-highlighter/dist/esm/languages/prism/cpp',
        'react-syntax-highlighter/dist/esm/languages/prism/sql',
        'react-syntax-highlighter/dist/esm/languages/prism/yaml',
        'react-syntax-highlighter/dist/esm/languages/prism/markup',
      ],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            markdown: ['react-markdown', 'react-syntax-highlighter', 'remark-gfm', 'remark-math', 'rehype-katex'],
            markmap: ['markmap-lib', 'markmap-view', 'markmap-toolbar', 'markmap-common'],
            vendor: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: port,
      allowedHosts: true, // 允许任意域名访问
      proxy: {
        '/api': {
          target: apiBaseUrl,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api/, '/api'),
        },
        '/static': {
          target: apiBaseUrl,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/static/, '/static'),
        },
      },
    },
  }
})
