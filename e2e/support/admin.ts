// 管理画面の操作をまとめた部品。

import type { Page } from "@playwright/test";

/**
 * 画面の準備(hydration)が終わるまで待つ。
 * 終わる前に入力すると、React の初期値で上書きされて欄が空のまま送信されることがある
 * (開発サーバーが重いときの WebKit で起きた)。通信が落ち着くのを待つだけでは
 * 足りなかったので、hydration のときに React が要素に付ける印
 * (__reactProps$…。react-dom の internalPropsKey)が id の要素に付くのを待つ
 */
export async function waitForHydration(page: Page, elementId: string) {
  await page.waitForFunction((id) => {
    const element = document.getElementById(id);
    return (
      element !== null &&
      Object.keys(element).some((key) => key.startsWith("__reactProps$"))
    );
  }, elementId);
}

/** ログイン画面からログインする(結果は呼び出し側で確かめる) */
export async function loginAsAdmin(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto("/admin/login");
  await waitForHydration(page, "admin-email");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
}
