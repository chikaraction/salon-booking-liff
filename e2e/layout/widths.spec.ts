// 画面幅のチェック(ADR-008 範囲1)。
// 客側・管理画面の各画面をスマホ〜PCの幅で開き、横スクロールやはみ出しが無いことを確かめる。
// 幅ごとのスクリーンショットはHTMLレポート(npx playwright show-report)に添付する。

import { expect, test, type Page } from "@playwright/test";
import { ADMIN_ACCOUNTS } from "../support/accounts";
import { findOverflowIssues } from "../support/overflow";

const WIDTHS = [
  { name: "320px", width: 320, height: 640 },
  { name: "360px", width: 360, height: 780 },
  { name: "375px", width: 375, height: 812 },
  { name: "393px", width: 393, height: 852 },
  { name: "430px", width: 430, height: 932 },
  { name: "440px", width: 440, height: 956 },
  { name: "タブレット", width: 768, height: 1024 },
  { name: "PC", width: 1366, height: 900 },
] as const;

type Screen = { name: string; path: string };

const CUSTOMER_SCREENS: Screen[] = [
  { name: "予約(メニュー選択)", path: "/booking" },
  { name: "マイ予約", path: "/my" },
];

const ADMIN_SCREENS: Screen[] = [
  { name: "予約カレンダー(日)", path: "/admin" },
  { name: "予約カレンダー(週)", path: "/admin?view=week" },
  { name: "代行登録", path: "/admin/reservations/new" },
  { name: "ダッシュボード", path: "/admin/dashboard" },
  { name: "営業日・営業時間", path: "/admin/settings/business" },
  { name: "スタッフ", path: "/admin/settings/staff" },
  { name: "メニュー", path: "/admin/settings/menus" },
  { name: "店舗・予約設定", path: "/admin/settings/salon" },
  { name: "表示設定", path: "/admin/settings/display" },
];

async function checkAllWidths(page: Page, screen: Screen) {
  for (const size of WIDTHS) {
    await test.step(size.name, async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(screen.path);
      await page.waitForLoadState("networkidle");

      await test.info().attach(`${screen.name} ${size.name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });

      const issues = await findOverflowIssues(page);
      expect
        .soft(
          issues.map(
            (issue) => `${issue.kind}: ${issue.element} — ${issue.detail}`,
          ),
          `${screen.name} を ${size.name} で開いたときのはみ出し`,
        )
        .toEqual([]);
    });
  }
}

test.describe("客側の画面幅", () => {
  for (const screen of CUSTOMER_SCREENS) {
    test(`${screen.name} が各幅ではみ出さない`, async ({ page }) => {
      await checkAllWidths(page, screen);
    });
  }
});

test.describe("管理画面の画面幅", () => {
  test("ログイン が各幅ではみ出さない", async ({ page }) => {
    await checkAllWidths(page, { name: "ログイン", path: "/admin/login" });
  });

  test.describe("オーナーでログイン済み", () => {
    test.use({ storageState: ADMIN_ACCOUNTS.owner.storageState });

    for (const screen of ADMIN_SCREENS) {
      test(`${screen.name} が各幅ではみ出さない`, async ({ page }) => {
        await checkAllWidths(page, screen);
      });
    }
  });
});
