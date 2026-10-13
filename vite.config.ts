import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],worker:{format:'es',rollupOptions:{output:{entryFileNames:'assets/security.worker-[hash].js'}}},build:{sourcemap:false},server:{host:'127.0.0.1'}});
