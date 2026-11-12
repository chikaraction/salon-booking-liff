// 管理画面のアクセス制御(ADR-005 / ADR-008 範囲2)。verify-booking の「認証・アクセス制御」の自動化。
// - 未ログインはログイン画面へ。ログイン済みでログイン画面を開くと /admin へ
// - 開いたままの画面でログインが切れていたら、保存などを押したときにログイン画面へ
// - 設定はオーナーのみ(スタッフは設定のリンクが出ず、直URLでも権限の案内になる)
// - スタッフに紐付いていないユーザー・無効にしたスタッフは、ログインはできるが案内だけが出る
// - スタッフに紐付いていないユーザー・無効にしたスタッフは、予約まわりも設定も読めない(RLS)。
//   anon キーも予約まわりのデータを読めない
// - 代行登録の空き状況(service_role で読む Server Action)は、画面を通さずに呼んでも
//   有効なスタッフにしか返らない
// - 管理画面にだけ埋め込み禁止のヘッダーが付く

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  ADMIN_ACCOUNTS,
  INACTIVE_STAFF_ACCOUNT,
  UNLINKED_ACCOUNT,
  logoutAccount,
} from "../support/accounts";
import { loginAsAdmin, waitForHydration } from "../support/admin";
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

/**
 * 管理画面を使えないユーザー(未紐付け・無効にしたスタッフ)で開いてみる画面。
 * 保護配下の全ページ。予約の変更は、存在しない予約のIDで開く(ページが実行されて
 * いれば「見つかりません」の404になるので、ページが何も取得していないことも分かる)
 */
const ALL_PROTECTED_PATHS = [
  "/admin",
  "/admin/reservations/new",
  "/admin/reservations/00000000-0000-4000-8000-000000000000/edit",
  "/admin/dashboard",
  ...SETTINGS_PATHS,
];

/** 予約まわりのテーブル(スタッフに紐付いた人だけが読める) */
const BOOKING_TABLES = [
  "customers",
  "reservations",
  "reservation_menus",
  "push_messages",
] as const;

/** 設定のテーブル(有効なスタッフに紐付いた人だけが読める) */
const SETTINGS_TABLES = [
  "salon_settings",
  "business_hours",
  "staff",
  "staff_working_hours",
  "menus",
  "menu_categories",
  "nth_weekday_closures",
  "date_overrides",
] as const;

/** 設定のテーブルのうち、seed.sql に必ず行があるもの(有効なスタッフには読めることの確認用) */
const SEEDED_SETTINGS_TABLES = [
  "salon_settings",
  "business_hours",
  "staff",
  "staff_working_hours",
  "menus",
  "menu_categories",
] as const;

/** スタッフとして登録されていないときの案内(src/lib/admin-permissions.ts) */
const NOT_REGISTERED_HEADING =
  "このアカウントは管理画面を使えるスタッフとして登録されていません";

/** 手元のSupabaseに、メールとパスワードでログインしたクライアント(RLS の確認用) */
async function signedInClient(
  local: { url: string; anonKey: string },
  account: { email: string; password: string },
) {
  const client = createClient(local.url, local.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  expect(error).toBeNull();
  return client;
}

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

  test("ログアウトすると管理画面を開けなくなる", async ({ page }, testInfo) => {
    const account = logoutAccount(testInfo.project.name);
    await loginAsAdmin(page, account.email, account.password);
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("別の端末で先にログアウトしていても、ログアウトするとログイン画面に移る", async ({
    browser,
  }, testInfo) => {
    // ログアウトは同じアカウントの全セッションを無効にする。スマホとPCの両方で
    // ログインしていて、片方でログアウトしたあと、もう片方でもログアウトを押す場面
    const account = logoutAccount(testInfo.project.name);
    const [phone, pc] = await Promise.all([
      browser.newContext(),
      browser.newContext(),
    ]);
    const [phonePage, pcPage] = await Promise.all([
      phone.newPage(),
      pc.newPage(),
    ]);
    for (const page of [phonePage, pcPage]) {
      await loginAsAdmin(page, account.email, account.password);
      await expect(page).toHaveURL(/\/admin$/);
    }

    await phonePage.getByRole("button", { name: "ログアウト" }).click();
    await expect(phonePage).toHaveURL(/\/admin\/login$/);

    await pcPage.getByRole("button", { name: "ログアウト" }).click();
    await expect(pcPage).toHaveURL(/\/admin\/login$/);
    await expect(
      pcPage.getByRole("heading", { name: "管理画面ログイン" }),
    ).toBeVisible();

    await Promise.all([phone.close(), pc.close()]);
  });
});

test.describe("オーナー", () => {
  test.use({ storageState: ADMIN_ACCOUNTS.owner.storageState });

  test("ログイン済みでログイン画面を開くと /admin に移る", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("ログインが切れた画面で保存を押すと、ログイン画面に移る", async ({
    page,
    context,
  }) => {
    // 別の端末でログアウトしたあとなど、開いたままの画面のログインが切れている場面。
    // cookie を消して作る(全セッションを無効にするログアウトだと、並行するテストの
    // オーナーのログインまで消える)。保存の Server Action はミドルウェアで止まり、動かない
    await page.goto("/admin/settings/salon");
    await waitForHydration(page, "salon-name");
    await context.clearCookies();
    await page.getByLabel("店名").fill("ログイン切れの確認");
    await page.getByRole("button", { name: "保存する" }).first().click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(
      page.getByRole("heading", { name: "管理画面ログイン" }),
    ).toBeVisible();
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

test.describe("スタッフに紐付いていないユーザー", () => {
  test("ログインすると、登録されていない旨の案内が出て、ログアウトできる", async ({
    page,
  }, testInfo) => {
    // ログアウトするので、ブラウザごとのアカウントを使う(logoutAccount のコメント)
    const account = logoutAccount(testInfo.project.name);
    await loginAsAdmin(page, account.email, account.password);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: NOT_REGISTERED_HEADING }),
    ).toBeVisible();
    // 画面の中身(ナビ・予約カレンダー)は出ない
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "代行登録" })).toHaveCount(0);

    // どの画面を直接開いても同じ案内になる(配下のページは描かれず、エラー画面にならない)
    for (const path of ALL_PROTECTED_PATHS) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(
        page.getByRole("heading", { name: NOT_REGISTERED_HEADING }),
        path,
      ).toBeVisible();
    }

    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(
      page.getByRole("heading", { name: "管理画面ログイン" }),
    ).toBeVisible();
  });
});

test.describe("無効にしたスタッフ", () => {
  test("ログインすると、登録されていない旨の案内が出る", async ({ page }) => {
    // このアカウントは3つのブラウザで共有するので、ログアウトはしない
    // (ログアウトは同じアカウントの全セッションを無効にする)
    await loginAsAdmin(
      page,
      INACTIVE_STAFF_ACCOUNT.email,
      INACTIVE_STAFF_ACCOUNT.password,
    );
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: NOT_REGISTERED_HEADING }),
    ).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "ログアウト" }),
    ).toBeVisible();

    for (const path of ALL_PROTECTED_PATHS) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(
        page.getByRole("heading", { name: NOT_REGISTERED_HEADING }),
        path,
      ).toBeVisible();
    }
  });
});

test.describe("データベースの行レベルの制御(RLS)", () => {
  const local = readLocalSupabase();

  test("スタッフに紐付いていないユーザーには予約まわりのデータも設定も0件に見える", async () => {
    const client = await signedInClient(local, UNLINKED_ACCOUNT);
    for (const table of [...BOOKING_TABLES, ...SETTINGS_TABLES]) {
      const { data, error } = await client.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  test("無効にしたスタッフには予約まわりのデータも設定も0件に見える", async () => {
    const client = await signedInClient(local, INACTIVE_STAFF_ACCOUNT);
    for (const table of [...BOOKING_TABLES, ...SETTINGS_TABLES]) {
      const { data, error } = await client.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  test("有効なスタッフは設定を読める", async () => {
    // 上の2つの「0件」が、誰にも読めないせいではないことを確かめる
    const client = await signedInClient(local, ADMIN_ACCOUNTS.staff);
    for (const table of SEEDED_SETTINGS_TABLES) {
      const { data, error } = await client.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data?.length, table).toBeGreaterThan(0);
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

test.describe("代行登録の空き状況(Server Action を画面を通さずに呼ぶ)", () => {
  // 空き状況は service_role で読むので RLS では止まらず、アプリ層のガード
  // (src/server/admin-auth.ts の requireStaff)だけが守っている。管理画面を使えない
  // ユーザーには代行登録の画面が出ないので、有効なスタッフの画面が送った要求を
  // 控えておき、同じ要求を別のログインの cookie で送り直して確かめる

  /** 控えておく Server Action の要求(送り直すのに要る分だけ) */
  type CapturedAction = { url: string; actionId: string; body: string };

  /** 空き時間の一覧(getProxyDaySlots)が返っているか */
  const hasDaySlots = (body: string) => body.includes('"slots"');
  /** 空き判定(checkProxySlot)が返っているか(断りの文言だけなら返っていない) */
  const hasSlotCheck = (body: string) =>
    body.includes('"canRegister"') && !body.includes(NOT_REGISTERED_HEADING);

  test("有効なスタッフには返り、管理画面を使えないユーザー・未ログインには返らない", async ({
    browser,
    baseURL,
  }) => {
    // --- 有効なスタッフの画面で、2つの Server Action の要求を控える ---
    const staffContext = await browser.newContext({
      storageState: ADMIN_ACCOUNTS.staff.storageState,
    });
    const staffPage = await staffContext.newPage();
    const captured: { daySlots?: CapturedAction; slotCheck?: CapturedAction } =
      {};
    staffPage.on("request", (request) => {
      const actionId = request.headers()["next-action"];
      const body = request.postData();
      if (request.method() !== "POST" || !actionId || body === null) return;
      let input: unknown;
      try {
        input = (JSON.parse(body) as unknown[])[0];
      } catch {
        return;
      }
      // 引数が staffId を持つオブジェクトなら空き状況の2つのどちらか。
      // time があれば空き判定(checkProxySlot)、無ければ空き時間の一覧(getProxyDaySlots)
      if (typeof input !== "object" || input === null) return;
      if (!("staffId" in input)) return;
      const action = { url: request.url(), actionId, body };
      if ("time" in input) captured.slotCheck = action;
      else captured.daySlots = action;
    });

    await staffPage.goto("/admin/reservations/new");
    await waitForHydration(staffPage, "proxy-staff");
    await staffPage.getByRole("checkbox").first().check();
    await staffPage
      .locator("#proxy-staff")
      .selectOption(ADMIN_ACCOUNTS.staff.staffId);
    await staffPage.locator("#proxy-time").fill("10:00");
    await expect
      .poll(
        () =>
          captured.daySlots !== undefined && captured.slotCheck !== undefined,
      )
      .toBe(true);
    const daySlots = captured.daySlots!;
    const slotCheck = captured.slotCheck!;

    /** 控えた要求を、その context のログイン(cookie)で送り直して本文を返す */
    const replay = async (
      context: { request: typeof staffContext.request },
      action: CapturedAction,
      url = action.url,
    ) => {
      const response = await context.request.post(url, {
        headers: {
          "next-action": action.actionId,
          accept: "text/x-component",
          "content-type": "text/plain;charset=UTF-8",
          origin: new URL(baseURL!).origin,
        },
        data: action.body,
      });
      return response.text();
    };

    // 送り直しても有効なスタッフには返る(下の「返らない」が、送り直し方の
    // 誤りのせいではないことを確かめる)
    expect(hasDaySlots(await replay(staffContext, daySlots))).toBe(true);
    expect(hasSlotCheck(await replay(staffContext, slotCheck))).toBe(true);

    // --- 管理画面を使えないユーザー(未紐付け・無効にしたスタッフ)には返らない ---
    // どちらのアカウントもほかのテストと共有するので、ログアウトはしない
    for (const account of [UNLINKED_ACCOUNT, INACTIVE_STAFF_ACCOUNT]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginAsAdmin(page, account.email, account.password);
      await expect(
        page.getByRole("heading", { name: NOT_REGISTERED_HEADING }),
        account.email,
      ).toBeVisible();

      const daySlotsBody = await replay(context, daySlots);
      expect(hasDaySlots(daySlotsBody), account.email).toBe(false);
      expect(daySlotsBody, account.email).toContain(NOT_REGISTERED_HEADING);

      const slotCheckBody = await replay(context, slotCheck);
      expect(hasSlotCheck(slotCheckBody), account.email).toBe(false);
      expect(slotCheckBody, account.email).toContain(NOT_REGISTERED_HEADING);

      await context.close();
    }

    // --- 未ログインには返らない ---
    // /admin 配下はミドルウェアがログイン画面へ移す。ミドルウェアが見ない客側の
    // 画面(/booking)に向けて送っても返らない
    const anonymous = await browser.newContext();
    for (const url of [daySlots.url, new URL("/booking", baseURL).href]) {
      expect(hasDaySlots(await replay(anonymous, daySlots, url)), url).toBe(
        false,
      );
      expect(hasSlotCheck(await replay(anonymous, slotCheck, url)), url).toBe(
        false,
      );
    }

    await Promise.all([staffContext.close(), anonymous.close()]);
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
