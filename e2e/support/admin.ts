// 管理画面の操作をまとめた部品。

import type { Page } from "@playwright/test";

/**
 * ログイン画面からログインする(結果は呼び出し側で確かめる)。
 * 画面の準備(hydration)が終わる前に入力すると、React の初期値で上書きされて
 * 欄が空のまま送信されることがある(開発サーバーが重いときの WebKit で起きた)ので、
 * 通信が落ち着いてから入力する
 */
export async function loginAsAdmin(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
}
