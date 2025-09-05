import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    base: process.env.NODE_ENV === 'production' ? '/kosovo_customs_data/' : '/',
    resolve: {
        alias: {
            "@/data": path.resolve(__dirname, "./data"),
            "@": path.resolve(__dirname, "./src"),
        },
    },
    // Inject ISO build time as a constant we can read in the app
    define: {
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
})
