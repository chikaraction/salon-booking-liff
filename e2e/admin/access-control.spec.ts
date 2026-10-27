// 管理画面のアクセス制御(ADR-005 / ADR-008 範囲2)。verify-booking の「認証・アクセス制御」の自動化。
// - 未ログインはログイン画面へ。ログイン済みでログイン画面を開くと /admin へ
// - 設定はオーナーのみ(スタッフは設定のリンクが出ず、直URLでも権限の案内になる)
// - スタッフに紐付いていないユーザー・anon キーは予約まわりのデータを読めない(RLS)
// - 管理画面にだけ埋め込み禁止のヘッダーが付く

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { ADMIN_ACCOUNTS, UNLINKED_ACCOUNT } from "../support/accounts";
import { loginAsAdmin } from "../support/admin";
import { readLocalSupabase } from "../support/local-supabase";

const PROTECTED_PATHS = [
  "/admin",
  "/admin/reservations/new",
  "/admin/dashboard",
  "/admin/settings/staff",
];

const SETTINGS_PATHS = [
  "/admin/settings/business",
  "/admin/settings/staff",
  "/admin/settings/menus",
  "/admin/settings/salon",
  "/admin/settings/display",
];

/** 予約まわりのテーブル(スタッフに紐付いた人だけが読める) */
const BOOKING_TABLES = [
  "customers",
  "reservations",
  "reservation_menus",
  "push_messages",
] as const;

test.describe("未ログイン", () => {
  for (const path of PROTECTED_PATHS) {
    test(`${path} を開くとログイン画面に飛ばされる`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/login$/);
    });
  }

  test("誤ったパスワードではログインできず、案内が出る", async ({ page }) => {
    await loginAsAdmin(page, ADMIN_ACCOUNTS.owner.email, "wrong-password");
    // alert は Next のページ遷移の読み上げ用にもう1つあるので、文言で探す
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "メールアドレスまたはパスワードが違います" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("ログアウトすると管理画面を開けなくなる", async ({ page }) => {
    await loginAsAdmin(page, UNLINKED_ACCOUNT.email, UNLINKED_ACCOUNT.password);
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});

test.describe("オーナー", () => {
  test.use({ storageState: ADMIN_ACCOUNTS.owner.storageState });

  test("ログイン済みでログイン画面を開くと /admin に移る", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("サイドバーに設定のリンクが出て、設定画面を開ける", async ({ page }) => {
    await page.goto("/admin");
    await expect(
      page.getByRole("link", { name: "営業日・営業時間" }).first(),
    ).toBeVisible();
    for (const path of SETTINGS_PATHS) {
      await page.goto(path);
      await expect(
        page.getByText("この操作にはオーナー権限が必要です"),
      ).toHaveCount(0);
    }
  });
});

test.describe("スタッフ", () => {
  test.use({ storageState: ADMIN_ACCOUNTS.staff.storageState });

  test("予約カレンダーは開けるが、設定のリンクは出ない", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("link", { name: "営業日・営業時間" }),
    ).toHaveCount(0);
  });

  for (const path of SETTINGS_PATHS) {
    test(`${path} を直接開くと権限の案内が出る`, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", {
          name: "この操作にはオーナー権限が必要です",
        }),
      ).toBeVisible();
    });
  }
});

test.describe("データベースの行レベルの制御(RLS)", () => {
  const local = readLocalSupabase();

  test("スタッフに紐付いていないユーザーには予約まわりのデータが0件に見える", async () => {
    const client = createClient(local.url, local.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: loginError } = await client.auth.signInWithPassword({
      email: UNLINKED_ACCOUNT.email,
      password: UNLINKED_ACCOUNT.password,
    });
    expect(loginError).toBeNull();
    for (const table of BOOKING_TABLES) {
      const { data, error } = await client.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  test("anon キーでは予約まわりのテーブルを読めない", async () => {
    const client = createClient(local.url, local.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const table of BOOKING_TABLES) {
      const { data, error } = await client.from(table).select("*");
      // 権限が無ければエラー、RLS で弾かれれば0件。どちらでも中身は見えない
      expect(error !== null || data?.length === 0, table).toBe(true);
    }
  });
});

test.describe("埋め込み禁止のヘッダー", () => {
  test("管理画面には付き、客側には付かない", async ({ request }) => {
    const admin = await request.get("/admin/login");
    expect(admin.headers()["x-frame-options"]).toBe("DENY");
    expect(admin.headers()["content-security-policy"]).toBe(
      "frame-ancestors 'none'",
    );

    const booking = await request.get("/booking");
    expect(booking.headers()["x-frame-options"]).toBeUndefined();
  });
});
