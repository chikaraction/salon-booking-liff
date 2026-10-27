// 客側(LIFFスタブ)の操作をまとめた部品。
// 3つのブラウザが同じDBに並行して書き込むので、枠がぶつからないように
// - 客はテストごとに別にする(客1人あたりの予約上限にも当たらない)
// - 時刻はブラウザごとに分ける(SLOT_TIMES)。日付はテストごとに分ける(pickOpenDate の index)

import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { STUB_USER_ID_STORAGE_KEY } from "../../src/lib/liff-stub";

/** ブラウザごとの時刻。どれも所要60分で重ならず、オーナーの勤務時間内(休憩 12:00〜13:00 を避ける) */
const SLOT_TIMES: Record<string, readonly [string, string]> = {
  chromium: ["9:00", "10:00"],
  webkit: ["11:00", "13:00"],
  firefox: ["14:00", "15:00"],
};

export function slotTimes(testInfo: TestInfo): readonly [string, string] {
  const times = SLOT_TIMES[testInfo.project.name];
  if (!times)
    throw new Error(
      `時刻が決まっていないブラウザです: ${testInfo.project.name}`,
    );
  return times;
}

/** テストごとに別の客(LINE userId)にする。1つのテストで2人使うときは suffix で分ける */
export function customerId(testInfo: TestInfo, suffix = "a"): string {
  return `U-e2e-${testInfo.project.name}-${testInfo.testId}-${suffix}`;
}

/** スタブの客を userId にしたブラウザのコンテキストを作る */
export async function newCustomerContext(
  browser: Browser,
  userId: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [STUB_USER_ID_STORAGE_KEY, userId] as const,
  );
  return context;
}

/** メニュー → スタッフを選んで日時選択まで進む */
export async function startBooking(page: Page, menu: string, staff: string) {
  await page.goto("/booking");
  await page.getByRole("button", { name: new RegExp(`^${menu} 約`) }).click();
  await page.getByRole("button", { name: /^次へ/ }).click();
  await page.getByRole("button", { name: new RegExp(staff) }).click();
  await page.getByRole("button", { name: /^次へ/ }).click();
}

/**
 * 日時選択で、選べる日のうち index 番目の日を選ぶ(index 0 = 2つ目に選べる日。
 * 1つ目は今日か明日で、直前締切で時刻が欠けることがあるので使わない)。
 * 選んだ日の見出し(例: 「10月30日(金)」)を返す
 */
export async function pickOpenDate(page: Page, index: number): Promise<string> {
  let skip = index + 1;
  for (let month = 0; month < 3; month++) {
    const days = page.getByRole("button", { name: /^\d{1,2}$/ });
    await days.first().waitFor();
    const count = await days.count();
    for (let i = 0; i < count; i++) {
      const day = days.nth(i);
      if (!(await day.isEnabled())) continue;
      if (skip > 0) {
        skip--;
        continue;
      }
      await day.click();
      const heading = page.getByRole("heading", {
        level: 2,
        name: /の空き時間$/,
      });
      return (await heading.innerText()).replace(/の空き時間$/, "");
    }
    await page.getByRole("button", { name: "次の月へ" }).click();
  }
  throw new Error(`選べる日が足りません(index ${index})`);
}

/** 時刻のボタン(選べる時刻だけがボタンになる) */
export function timeButton(page: Page, time: string) {
  return page.getByRole("button", { name: time, exact: true });
}

/** 埋まっている時刻(ボタンではなく、取り消し線の押せない表示になる) */
export function takenTime(page: Page, time: string) {
  return page
    .locator('[aria-disabled="true"]')
    .getByText(time, { exact: true });
}

/** 時刻を選んで確認画面まで進む(初回の客はお客様情報を入れる) */
export async function goToConfirm(page: Page, time: string) {
  await timeButton(page, time).click();
  await page.getByRole("button", { name: "確認へ進む" }).click();
  const info = page.getByRole("heading", { name: "お客様情報の入力" });
  const confirm = page.getByRole("heading", { name: "内容の確認" });
  await info.or(confirm).waitFor();
  if (await info.isVisible()) {
    await page.getByRole("textbox", { name: "お名前" }).fill("E2E テスト");
    await page.getByRole("textbox", { name: "電話番号" }).fill("09012345678");
    await page.getByRole("button", { name: "確認画面へ" }).click();
    await confirm.waitFor();
  }
}

/** 予約を1件作り、日付の見出しを返す */
export async function book(
  page: Page,
  options: { menu?: string; staff?: string; dateIndex: number; time: string },
): Promise<string> {
  await startBooking(
    page,
    options.menu ?? "カット",
    options.staff ?? "オーナー",
  );
  const date = await pickOpenDate(page, options.dateIndex);
  await goToConfirm(page, options.time);
  await page.getByRole("button", { name: "予約を確定する" }).click();
  await page.getByRole("heading", { name: "ご予約が完了しました" }).waitFor();
  return date;
}

/** マイ予約のカード(日時の文言で探す) */
export function reservationCard(page: Page, dateTime: string) {
  return page.getByRole("article").filter({ hasText: dateTime });
}
