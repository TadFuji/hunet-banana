import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests',use:{channel:'chrome',baseURL:'http://127.0.0.1:4173',viewport:{width:1440,height:1000}},webServer:{command:'npm start',url:'http://127.0.0.1:4173',reuseExistingServer:true},workers:1});
