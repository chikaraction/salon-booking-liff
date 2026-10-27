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
