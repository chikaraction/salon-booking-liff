// ダブルブッキングの防止(ADR-004 / ADR-008 範囲2)。verify-booking の「ダブルブッキング防止」と
// 「変更の競合ロールバック」の自動化。2人の客を別々のブラウザのコンテキストで動かす。
// 最後の砦はDBのEXCLUDE制約なので、アプリ側の事前チェックをすり抜ける「同時の確定」で確かめる。

import { expect, test } from "@playwright/test";
import {
  book,
  customerId,
  goToConfirm,
  newCustomerContext,
  pickOpenDate,
  reservationCard,
  slotTimes,
  startBooking,
} from "../support/customer";

// 日付の割り当て(pickOpenDate の index)。booking.spec.ts の 0・1 と重ねない
const DATE_INDEX = {
  simultaneous: 2,
  changeConflict: 3,
} as const;

const SLOT_TAKEN_MESSAGE = "その枠は埋まりました。別の時間をお選びください";

test.describe("ダブルブッキングの防止", () => {
  test("2人が同じスタッフ・同じ時刻をほぼ同時に確定すると、片方だけ予約でき、もう片方には埋まった案内が出る", async ({
    browser,
  }, testInfo) => {
    const [time] = slotTimes(testInfo);
    const contexts = await Promise.all([
      newCustomerContext(browser, customerId(testInfo, "a")),
      newCustomerContext(browser, customerId(testInfo, "b")),
    ]);
    const pages = await Promise.all(
      contexts.map((context) => context.newPage()),
    );

    // 2人とも確認画面まで進める(この時点ではどちらにも空きに見えている)
    for (const page of pages) {
      await startBooking(page, "カット", "オーナー");
      await pickOpenDate(page, DATE_INDEX.simultaneous);
      await goToConfirm(page, time);
    }

    await Promise.all(
      pages.map((page) =>
        page.getByRole("button", { name: "予約を確定する" }).click(),
      ),
    );

    const outcomes = await Promise.all(
      pages.map(async (page) => {
        const completed = page.getByRole("heading", {
          name: "ご予約が完了しました",
        });
        const taken = page.getByText(SLOT_TAKEN_MESSAGE);
        await completed.or(taken).waitFor();
        return (await completed.isVisible()) ? "予約できた" : "埋まった";
      }),
    );
    expect(outcomes.toSorted()).toEqual(["予約できた", "埋まった"]);

    // 埋まった側は日時選択に戻される
    const loser = pages[outcomes.indexOf("埋まった")];
    await expect(
      loser.getByRole("heading", { name: "日時を選ぶ" }),
    ).toBeVisible();

    await Promise.all(contexts.map((context) => context.close()));
  });

  test("変更の確認中に変更先の枠を別の客に取られると、変更は埋まった案内になり、元の予約はそのまま残る", async ({
    browser,
  }, testInfo) => {
    const [from, to] = slotTimes(testInfo);
    const customer = await newCustomerContext(
      browser,
      customerId(testInfo, "a"),
    );
    const other = await newCustomerContext(browser, customerId(testInfo, "b"));
    const page = await customer.newPage();
    const otherPage = await other.newPage();

    const date = await book(page, {
      dateIndex: DATE_INDEX.changeConflict,
      time: from,
    });

    // 客Aが変更の確認画面まで進む
    await page.goto("/my");
    await reservationCard(page, `${date}${from}〜`)
      .getByRole("link", { name: "変更" })
      .click();
    await page.getByRole("button", { name: /^次へ/ }).click();
    await page.getByRole("button", { name: /^次へ/ }).click();
    await pickOpenDate(page, DATE_INDEX.changeConflict);
    await goToConfirm(page, to);

    // その間に客Bが変更先と同じ枠を予約する
    await book(otherPage, { dateIndex: DATE_INDEX.changeConflict, time: to });

    // 客Aの変更の確定は埋まった案内になる
    await page.getByRole("button", { name: "予約を変更する" }).click();
    await expect(page.getByText(SLOT_TAKEN_MESSAGE)).toBeVisible();

    // 客Aの元の予約は確定のまま残っている
    await page.goto("/my");
    const original = reservationCard(page, `${date}${from}〜`);
    await expect(original).toBeVisible();
    await expect(original).toContainText("確定");
    await expect(reservationCard(page, `${date}${to}〜`)).toHaveCount(0);

    await customer.close();
    await other.close();
  });
});
