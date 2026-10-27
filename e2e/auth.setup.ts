// 管理画面にログインし、ログイン状態(cookie)を保存する。
// 各ブラウザのテストは保存した状態で始まる(test.use({ storageState }))

import { expect, test as setup } from "@playwright/test";
import { ADMIN_ACCOUNTS } from "./support/accounts";

for (const [role, account] of Object.entries(ADMIN_ACCOUNTS)) {
  setup(`${role} でログインする`, async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("メールアドレス").fill(account.email);
    await page.getByLabel("パスワード").fill(account.password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.context().storageState({ path: account.storageState });
  });
}
