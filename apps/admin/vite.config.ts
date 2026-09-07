import { defineConfig } from 'vite'
export default defineConfig({ server: { port: 4173, proxy: { '/v1': { target: 'http://127.0.0.1:3000' } } } })
