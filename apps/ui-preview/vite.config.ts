import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { parseEnv } from 'node:util'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode, command }) => {
  const live = mode === 'live'
  const config = live ? parseEnv(fs.readFileSync(path.resolve(here, '../../backend/.env.demo'), 'utf8')) : {}
  if (live && (command !== 'serve' || config.HOST !== '127.0.0.1' || config.LOCAL_LOGIN_ENABLED !== 'true')) throw new Error('Live validation requires a loopback development backend and cannot be exported')
  return {
  plugins: live ? [{
    name: 'flightor-existing-connectivity', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:flightor-connectivity') return '\0flightor-connectivity' },
    load(id) { if (id === '\0flightor-connectivity') return `const module = { exports: {} };\n${fs.readFileSync(path.resolve(here, '../../cloud/searchProxy/connectivity.js'), 'utf8')}\nexport default module.exports;` },
    transform(code, id) { if (id.replace(/\\/g, '/').endsWith('/src/services/flightService.ts')) return `import __connectivity from 'virtual:flightor-connectivity';\n${code.replace("require('../../cloud/searchProxy/connectivity')", '__connectivity')}` },
  }] : [],
  css: live ? { postcss: { plugins: [{ postcssPlugin: 'flightor-preview-rpx', Declaration(decl) { decl.value = decl.value.replace(/(-?[\d.]+)rpx\b/g, (_match, value) => `${Number(value) / 2}px`) } }] } } : {},
  define: live ? { FLIGHTOR_API_BASE_URL: JSON.stringify(`http://127.0.0.1:${config.PORT}`), FLIGHTOR_USE_MOCK: 'false', FLIGHTOR_LOCAL_LOGIN_KEY: JSON.stringify(config.LOCAL_LOGIN_KEY || '') } : {},
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@tarojs/components': path.resolve(here, 'src/taro-components.tsx'),
      ...(live ? { '@tarojs/taro': path.resolve(here, 'src/taro-live.ts') } : {}),
    },
  },
  publicDir: path.resolve(here, '../../src/assets'),
  server: { host: '127.0.0.1', port: live ? 4179 : 4178, strictPort: true, fs: { allow: [here, path.resolve(here, '../../src'), path.resolve(here, '../../cloud'), fs.realpathSync(path.resolve(here, '../../node_modules')), fs.realpathSync(path.resolve(here, 'node_modules'))] } },
  }
})
