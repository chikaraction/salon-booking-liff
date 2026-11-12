// E2E用の管理画面アカウント。手元のSupabaseにだけ作る(e2e/global-setup.ts)。
// スタッフのIDは supabase/seed.sql の staff に合わせる。

export const ADMIN_ACCOUNTS = {
  owner: {
    staffId: "11111111-1111-1111-1111-111111111111",
    email: "owner@e2e.test",
    password: "e2e-owner-password",
    storageState: "e2e/.auth/owner.json",
  },
  staff: {
    staffId: "22222222-2222-2222-2222-222222222222",
    email: "staff@e2e.test",
    password: "e2e-staff-password",
    storageState: "e2e/.auth/staff.json",
  },
} as const;

export type AdminRole = keyof typeof ADMIN_ACCOUNTS;

/**
 * スタッフに紐付けないアカウント(招待漏れ・紐付け漏れの再現)。
 * ログアウトは全セッションを無効にするので、ログアウトのテストもこのアカウントで行う
 * (オーナー・スタッフでログアウトすると、並行するテストのログイン状態まで消える)
 */
export const UNLINKED_ACCOUNT = {
  email: "unlinked@e2e.test",
  password: "e2e-unlinked-password",
} as const;

/**
 * 無効にしたスタッフ(is_active = false)のアカウント(やめたスタッフの再現)。
 * オーナー・スタッフの共有アカウントを無効にすると並行するテストが壊れるので、
 * 専用の staff 行を e2e/global-setup.ts で作る(seed.sql には無い)。
 * このアカウントではログアウトしない(3つのブラウザで共有するため)
 */
export const INACTIVE_STAFF_ACCOUNT = {
  staffName: "E2E無効スタッフ",
  email: "inactive@e2e.test",
  password: "e2e-inactive-password",
} as const;

/**
 * ログアウトのテスト用のアカウント(スタッフに紐付けない)。ブラウザごとに分ける。
 * ログアウトは同じアカウントの全セッションを無効にするので、3つのブラウザで1つを
 * 共有すると、並行するテストどうしでログイン状態を消し合う
 */
export function logoutAccount(projectName: string) {
  return {
    email: `logout-${projectName}@e2e.test`,
    password: "e2e-logout-password",
  } as const;
}
