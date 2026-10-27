// テストの前に、手元のSupabaseを毎回同じ状態に作り直す(ADR-008)。
// 1. マイグレーションと supabase/seed.sql を当て直す
// 2. 管理画面のアカウント(オーナー・スタッフ)を作り、seed のスタッフに紐付ける

import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_ACCOUNTS } from "./support/accounts";
import { readLocalSupabase } from "./support/local-supabase";

export default async function globalSetup() {
  const local = readLocalSupabase();

  // --local を明示する(リンク済みのリモートのDBは決して作り直さない)
  execSync("npx supabase db reset --local", { stdio: "inherit" });

  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const account of Object.values(ADMIN_ACCOUNTS)) {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
    });
    if (error) {
      throw new Error(
        `テスト用アカウントを作れませんでした(${account.email}): ${error.message}`,
      );
    }
    const { error: linkError } = await admin
      .from("staff")
      .update({ auth_user_id: data.user.id })
      .eq("id", account.staffId);
    if (linkError) {
      throw new Error(
        `スタッフに紐付けられませんでした(${account.email}): ${linkError.message}`,
      );
    }
  }
}
