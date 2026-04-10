import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
 server: {
  proxy: {
    '/yahoo': {
      target: 'https://query1.finance.yahoo.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/yahoo/, ''),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    },
    '/polymarket': {
      target: 'https://gamma-api.polymarket.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/polymarket/, '')
    }
  }
}
})