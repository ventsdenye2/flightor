import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@tarojs/components': path.resolve(here, 'src/taro-components.tsx'),
    },
  },
  publicDir: path.resolve(here, '../../src/assets'),
  server: { host: '127.0.0.1', port: 4178 },
})
