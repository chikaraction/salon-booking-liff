// 客側の予約の流れ(ADR-008 範囲2)。verify-booking の「客側予約フロー」「マイ予約・キャンセル・変更」の自動化。
// 予約 → マイ予約 → 変更 → キャンセルを、別の客から見た空き枠と合わせて確かめる。

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
  takenTime,
  timeButton,
} from "../support/customer";

// 日付の割り当て(pickOpenDate の index)。テストごとに別の日にして枠をぶつけない
const DATE_INDEX = {
  bookAndCancel: 0,
  change: 1,
} as const;

test.describe("予約の流れ", () => {
  test("予約するとマイ予約に出て、別の客からはその時刻が埋まって見え、キャンセルすると空く", async ({
    browser,
  }, testInfo) => {
    const [time] = slotTimes(testInfo);
    const customer = await newCustomerContext(
      browser,
      customerId(testInfo, "a"),
    );
    const other = await newCustomerContext(browser, customerId(testInfo, "b"));
    const page = await customer.newPage();
    const otherPage = await other.newPage();

    // 初回の客なので、お客様情報の入力を経て予約が完了する
    const date = await book(page, {
      dateIndex: DATE_INDEX.bookAndCancel,
      time,
    });
    await expect(page.getByText(`${date}${time}〜`)).toBeVisible();
    await expect(page.getByText("カット ／ オーナー")).toBeVisible();

    await page.getByRole("link", { name: "マイ予約を見る" }).click();
    const card = reservationCard(page, `${date}${time}〜`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("確定");
    await expect(card).toContainText("カット / オーナー");

    // 別の客の日時選択では、その時刻が埋まっていて押せない
    await startBooking(otherPage, "カット", "オーナー");
    await pickOpenDate(otherPage, DATE_INDEX.bookAndCancel);
    await expect(takenTime(otherPage, time)).toBeVisible();
    await expect(timeButton(otherPage, time)).toHaveCount(0);

    // キャンセルすると、マイ予約から消え、別の客から選べるようになる
    await card.getByRole("button", { name: "キャンセル" }).click();
    const sheet = page.getByRole("dialog", {
      name: "予約をキャンセルしますか？",
    });
    await expect(sheet).toContainText(`${date}${time}〜`);
    await sheet.getByRole("button", { name: "キャンセルする" }).click();
    await expect(page.getByText("予約をキャンセルしました")).toBeVisible();
    await expect(reservationCard(page, `${date}${time}〜`)).toHaveCount(0);

    await startBooking(otherPage, "カット", "オーナー");
    await pickOpenDate(otherPage, DATE_INDEX.bookAndCancel);
    await expect(timeButton(otherPage, time)).toBeEnabled();

    await customer.close();
    await other.close();
  });

  test("予約を別の時刻に変更すると、マイ予約が新しい時刻になり、元の時刻は空く", async ({
    browser,
  }, testInfo) => {
    const [from, to] = slotTimes(testInfo);
    const customer = await newCustomerContext(
      browser,
      customerId(testInfo, "a"),
    );
    const page = await customer.newPage();

    const date = await book(page, { dateIndex: DATE_INDEX.change, time: from });
    await page.goto("/my");
    await reservationCard(page, `${date}${from}〜`)
      .getByRole("link", { name: "変更" })
      .click();

    // 変更はメニュー・スタッフが選ばれた状態で始まる
    await expect(
      page.getByText(`予約の変更(変更前: ${date}${from}〜)`),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^カット 約60分/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^次へ/ }).click();
    await page.getByRole("button", { name: /^次へ/ }).click();
    await pickOpenDate(page, DATE_INDEX.change);
    await goToConfirm(page, to);
    await page.getByRole("button", { name: "予約を変更する" }).click();
    await expect(
      page.getByRole("heading", { name: "予約を変更しました" }),
    ).toBeVisible();

    await page.goto("/my");
    await expect(reservationCard(page, `${date}${to}〜`)).toBeVisible();
    await expect(reservationCard(page, `${date}${from}〜`)).toHaveCount(0);

    // 元の時刻は空く(同じ客でも日時選択に出る)
    await startBooking(page, "カット", "オーナー");
    await pickOpenDate(page, DATE_INDEX.change);
    await expect(timeButton(page, from)).toBeEnabled();

    await customer.close();
  });
});
