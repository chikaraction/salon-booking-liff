// 管理画面で変えた設定が、客側の予約画面に反映されること(ADR-008 範囲3)。
// verify-booking の「直前締切・受付期間が salon_settings の値で、変更したら反映される」などの自動化。
// 店の設定を変えるので、playwright.config.ts の settings プロジェクトで、他の全テストのあとに順に流す。
// テストの順番に意味がある(営業時間 → 定休日の順に水曜日を変える)ので、1つのファイルに書く。

import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_ACCOUNTS } from "../support/accounts";
import {
  addDays,
  customerId,
  newCustomerContext,
  pickDate,
  selectableDates,
  selectableTimes,
  startBooking,
  timeButton,
  todayJst,
  weekdayOf,
} from "../support/customer";

test.use({ storageState: ADMIN_ACCOUNTS.owner.storageState });
test.describe.configure({ mode: "serial" });

const WEDNESDAY = 3;

/** 設定画面で、変えた節の「保存する」を押して保存の完了を待つ */
async function save(page: Page) {
  await page.getByRole("button", { name: "保存する", disabled: false }).click();
  await expect(page.getByText("保存しました")).toBeVisible();
}

/** 客として「カット・オーナー」の日時選択まで進んだページを開く */
async function openCustomerCalendar(browser: Browser, userId: string) {
  const context = await newCustomerContext(browser, userId);
  const page = await context.newPage();
  await startBooking(page, "カット", "オーナー");
  return { context, page };
}

test("水曜日の閉店時刻を早めると、客側の水曜日の時刻がその前で終わる", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/admin/settings/business");
  await page.getByRole("textbox", { name: "水曜日の閉店時刻" }).fill("15:00");
  await save(page);

  const customer = await openCustomerCalendar(browser, customerId(testInfo));
  // 他のテストが予約を入れた日と重ならないよう、受付期間の最後の水曜日を見る
  const wednesday = (await selectableDates(customer.page))
    .filter((date) => weekdayOf(date) === WEDNESDAY)
    .at(-1);
  expect(wednesday, "選べる水曜日があること").toBeDefined();
  await pickDate(customer.page, wednesday!);

  // 所要60分なので、閉店15:00なら最後の開始は14:00
  await expect(timeButton(customer.page, "14:00")).toBeVisible();
  for (const time of ["14:30", "15:00", "17:00"]) {
    await expect(customer.page.getByText(time, { exact: true })).toHaveCount(0);
  }
  await customer.context.close();
});

test("水曜日を定休にすると、客側のカレンダーで水曜日が選べなくなる", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/admin/settings/business");
  await page.getByRole("button", { name: "水曜日(営業)" }).click();
  await expect(
    page.getByRole("button", { name: "水曜日(定休)" }),
  ).toBeVisible();
  await save(page);

  const customer = await openCustomerCalendar(browser, customerId(testInfo));
  const dates = await selectableDates(customer.page);
  expect(dates.length).toBeGreaterThan(0);
  expect(dates.filter((date) => weekdayOf(date) === WEDNESDAY)).toEqual([]);
  await customer.context.close();
});

test("受付期間を7日にすると、客側のカレンダーで8日後より先が選べなくなる", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/admin/settings/salon");
  await page.getByRole("spinbutton", { name: "受付期間" }).fill("7");
  await save(page);

  const customer = await openCustomerCalendar(browser, customerId(testInfo));
  const dates = await selectableDates(customer.page);
  expect(dates.length).toBeGreaterThan(0);
  const lastDay = addDays(todayJst(), 7);
  expect(dates.filter((date) => date > lastDay)).toEqual([]);
  await customer.context.close();
});

test("直前締切を2日にすると、今日と明日の時刻が客側に出なくなる", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/admin/settings/salon");
  await page.getByRole("spinbutton", { name: "直前締切" }).fill("2880");
  await save(page);

  const customer = await openCustomerCalendar(browser, customerId(testInfo));
  // 直前締切は日付ではなく時刻に効く(日付は選べるが、時刻が出ない)
  const today = todayJst();
  const soon = (await selectableDates(customer.page)).filter(
    (date) => date <= addDays(today, 1),
  );
  for (const date of soon) {
    await pickDate(customer.page, date);
    await expect(selectableTimes(customer.page), date).toHaveCount(0);
  }
  // 3日後以降の営業日には時刻が出る(締切が効きすぎていない)
  const later = (await selectableDates(customer.page)).find(
    (date) => date >= addDays(today, 3),
  );
  expect(later, "3日後以降に選べる日があること").toBeDefined();
  await pickDate(customer.page, later!);
  await expect(selectableTimes(customer.page).first()).toBeVisible();
  await customer.context.close();
});

test("メニューを追加すると客側に出て、「表示する」をオフにすると消える", async ({
  page,
  browser,
}, testInfo) => {
  const name = "E2E限定メニュー";
  await page.goto("/admin/settings/menus");
  await page.getByRole("button", { name: "新規メニュー" }).click();
  const dialog = page.getByRole("dialog", { name: "新規メニュー" });
  await dialog.getByRole("textbox", { name: "メニュー名" }).fill(name);
  await dialog
    .getByRole("combobox", { name: "カテゴリ" })
    .selectOption("カラー");
  await dialog.getByRole("spinbutton", { name: "料金(税込)" }).fill("5500");
  await dialog.getByRole("spinbutton", { name: "所要時間(分)" }).fill("45");
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "カラー" })
      .getByText(name, { exact: true }),
  ).toBeVisible();

  const customer = await newCustomerContext(browser, customerId(testInfo));
  const customerPage = await customer.newPage();
  await customerPage.goto("/booking");
  const menuButton = customerPage.getByRole("button", {
    name: `${name} 約45分 ¥5,500`,
  });
  await expect(menuButton).toBeVisible();

  await page.getByRole("button", { name: `編集 (${name})` }).click();
  const edit = page.getByRole("dialog");
  await edit
    .getByRole("switch", { name: "このメニューをお客様の予約画面に表示する" })
    .click();
  await edit.getByRole("button", { name: "保存する" }).click();
  await expect(edit).toHaveCount(0);

  await customerPage.reload();
  await expect(
    customerPage.getByRole("button", { name: /^カット 約60分/ }),
  ).toBeVisible();
  await expect(menuButton).toHaveCount(0);
  await customer.close();
});
