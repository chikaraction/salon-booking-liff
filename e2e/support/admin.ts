// 管理画面の操作をまとめた部品。

import type { Page } from "@playwright/test";

/**
 * ログイン画面からログインする(結果は呼び出し側で確かめる)。
 * 画面の準備(hydration)が終わる前に入力すると、React の初期値で上書きされて
 * 欄が空のまま送信されることがある(開発サーバーが重いときの WebKit で起きた)。
 * 通信が落ち着くのを待つだけでは足りなかったので、hydration のときに React が
 * 要素に付ける印(__reactProps$…。react-dom の internalPropsKey)を待ってから入力する
 */
export async function loginAsAdmin(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto("/admin/login");
  await page.waitForFunction(() => {
    const input = document.getElementById("admin-email");
    return (
      input !== null &&
      Object.keys(input).some((key) => key.startsWith("__reactProps$"))
    );
  });
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
}
