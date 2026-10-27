// E2Eテスト(ADR-008)。実行: npm run test:e2e(先に npx supabase start)
// - 接続先は手元のSupabaseだけ。.env.local(リモートのDB・本物のLINEの値)は使わない
// - 客側はLIFFスタブ(NEXT_PUBLIC_LIFF_STUB=1)で、通常のブラウザから開く

import { defineConfig, devices } from "@playwright/test";
import { readLocalSupabase } from "./e2e/support/local-supabase";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

const local = readLocalSupabase();

// 店の設定を変えるテスト(e2e/settings/)。並行する他のテストの前提(営業時間・受付期間・
// メニュー)を崩すので、ブラウザごとのプロジェクトからは外し、全部が終わってから流す
const SETTINGS_TESTS = /e2e[\\/]settings[\\/]/;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  globalSetup: "./e2e/global-setup.ts",
  // テストはデータを作り直してから始まる。並列で書き込むテストはファイル内で順に流す
  fullyParallel: false,
  // 開発サーバー1台を全ブラウザで共有するので、並列を絞る(12並列では最初のコンパイルが詰まり、
  // 30秒のタイムアウトが続いた)。待ち時間も開発サーバーの遅さに合わせて長めにする
  workers: 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: true,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: BASE_URL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testIgnore: SETTINGS_TESTS,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      name: "webkit",
      testIgnore: SETTINGS_TESTS,
      use: { ...devices["Desktop Safari"] },
      dependencies: ["setup"],
    },
    {
      name: "firefox",
      testIgnore: SETTINGS_TESTS,
      use: {
        ...devices["Desktop Firefox"],
        // locale だけでは時刻入力が「09:00 AM」の12時間表記になる(intl.locale.requested でも変わらない)。
        // ふだんの Firefox と同じく、OS(日本語の地域設定)の書式を使って24時間表記にする
        launchOptions: {
          firefoxUserPrefs: { "intl.regional_prefs.use_os_locales": true },
        },
      },
      dependencies: ["setup"],
    },
    {
      // 他のプロジェクトが1件でも失敗すると流れない(Playwright の dependencies の仕様)
      name: "settings",
      testMatch: SETTINGS_TESTS,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["chromium", "webkit", "firefox"],
    },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `${BASE_URL}/admin/login`,
    // ふだんの開発サーバー(リモートのDBにつながっている)を使い回さない
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      // ふだんの npm run dev と同時に動かせるよう、ビルドの置き場を分ける(next.config.ts)
      NEXT_DIST_DIR: ".next/e2e",
      NEXT_PUBLIC_SUPABASE_URL: local.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey,
      NEXT_PUBLIC_LIFF_STUB: "1",
      // .env.local の本物の値が入らないよう、空で上書きする(LINEには何も送らない)
      NEXT_PUBLIC_LIFF_ID: "",
      LINE_LOGIN_CHANNEL_ID: "",
      LINE_CHANNEL_SECRET: "",
      LINE_CHANNEL_ACCESS_TOKEN: "",
      CRON_SECRET: "",
    },
  },
});
