// Dev server with a fake sign-in and in-memory API. For UI testing where Google
// sign-in and the deployed backend are unreachable (e.g. cloud sessions).
//   npm run dev:mock
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mockApi } from './dev-mock/server.js'

const mock = (file) => path.resolve(import.meta.dirname, 'dev-mock', file)

export default defineConfig({
  plugins: [react(), mockApi()],
  resolve: {
    alias: [
      { find: /^\.\/firebase$/, replacement: mock('firebase.js') },
      { find: /^firebase\/auth$/, replacement: mock('firebase-auth.js') },
    ],
  },
  server: { port: 5174, host: '127.0.0.1' },
})
