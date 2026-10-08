import {defineConfig} from '@playwright/test';
const env=(globalThis as unknown as {process:{env:Record<string,string|undefined>}}).process.env;
export default defineConfig({
  testDir:'./tests/browser',testMatch:'**/*.pw.ts',workers:1,timeout:60000,
  use:{viewport:{width:375,height:667},launchOptions:{executablePath:env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}},
  webServer:{command:'pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort',url:'http://127.0.0.1:4175',reuseExistingServer:false},
});
