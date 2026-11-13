import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const api = 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // allow access through Cloudflare tunnels (quick *.trycloudflare.com URLs or your own domain)
    allowedHosts: ['.trycloudflare.com', '.ot-technologies.com'],
    proxy: {
      '/api': api,
      '/uploads': api,
      '/socket.io': { target: api, ws: true },
    },
  },
})
