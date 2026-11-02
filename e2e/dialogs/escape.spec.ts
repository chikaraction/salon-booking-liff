// ダイアログは Escape で閉じる(背景クリック・「閉じる」と同じ)。
// 管理画面の予約詳細・メニューの追加と編集・カテゴリの編集、客側のキャンセル確認シート。
// 予約の変更ダイアログは前から Escape で閉じる。

import { expect, test, type Locator } from "@playwright/test";
import { ADMIN_ACCOUNTS } from "../support/accounts";
import {
  book,
  customerId,
  headingToDate,
  newCustomerContext,
  reservationCard,
  slotTimes,
} from "../support/customer";

// 日付の割り当て(pickOpenDate の index)。customer/ の 0〜3 と重ねない
const DATE_INDEX = 4;

/**
 * ボタンを押してダイアログが開くのを待つ。
 * 画面の準備(hydration)の前に押すと何も起きないので、開くまで押し直す
 */
async function openDialog(button: Locator, dialog: Locator) {
  await expect(async () => {
    await button.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

test.describe("Escape で閉じる", () => {
  test.use({ storageState: ADMIN_ACCOUNTS.owner.storageState });

  test("メニューの追加・編集のダイアログ", async ({ page }) => {
    await page.goto("/admin/settings/menus");
    const dialog = page.getByRole("dialog");
    await openDialog(
      page.getByRole("button", { name: "編集 (カット)" }),
      dialog,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await openDialog(
      page.getByRole("button", { name: "新規メニュー" }),
      dialog,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("カテゴリの編集のダイアログ", async ({ page }) => {
    await page.goto("/admin/settings/menus");
    const dialog = page.getByRole("dialog");
    await openDialog(
      page.getByRole("button", { name: "カテゴリを編集" }),
      dialog,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("管理画面の予約詳細と、客側のキャンセル確認シート", async ({
    page,
    browser,
  }, testInfo) => {
    // カレンダーで見分けられるよう、客の名前をブラウザごとに変える
    const name = `E2E 詳細 ${testInfo.project.name}`;
    const [time] = slotTimes(testInfo);
    const customer = await newCustomerContext(browser, customerId(testInfo));
    const customerPage = await customer.newPage();
    const date = await book(customerPage, {
      dateIndex: DATE_INDEX,
      time,
      name,
    });

    // 管理画面: その日のカレンダーで予約を開き、Escape で閉じる
    await page.goto(`/admin?date=${headingToDate(date)}`);
    const detail = page.getByRole("dialog");
    await openDialog(
      page.getByRole("button").filter({ hasText: `${name}様` }),
      detail,
    );
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);

    // 客側: キャンセル確認シートを Escape で閉じても、予約はそのまま
    await customerPage.getByRole("link", { name: "マイ予約を見る" }).click();
    const card = reservationCard(customerPage, `${date}${time}〜`);
    const sheet = customerPage.getByRole("dialog", {
      name: "予約をキャンセルしますか？",
    });
    await openDialog(card.getByRole("button", { name: "キャンセル" }), sheet);
    await customerPage.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(card).toContainText("確定");

    await customer.close();
  });
});
