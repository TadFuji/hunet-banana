import { defineConfig } from '@playwright/test';
const remoteURL = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({testDir:'tests',use:{channel:'chrome',baseURL:remoteURL || 'http://127.0.0.1:4173',viewport:{width:1440,height:1000}},webServer:remoteURL ? undefined : {command:'npm start',url:'http://127.0.0.1:4173',reuseExistingServer:true},workers:1});
