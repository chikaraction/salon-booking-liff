// テストの前に、手元のSupabaseを毎回同じ状態に作り直す(ADR-008)。
// 1. マイグレーションと supabase/seed.sql を当て直す
// 2. 管理画面のアカウント(オーナー・スタッフ)を作り、seed のスタッフに紐付ける。
//    紐付けないアカウント(UNLINKED_ACCOUNT と、ブラウザごとのログアウト用)も作る
// 3. 主な画面を一度開いて、開発サーバーのコンパイルを済ませておく

import { execSync } from "node:child_process";
import type { FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  ADMIN_ACCOUNTS,
  UNLINKED_ACCOUNT,
  logoutAccount,
} from "./support/accounts";
import { readLocalSupabase } from "./support/local-supabase";

// 管理画面は未ログインだとログイン画面へのリダイレクトになるが、ミドルウェアと
// ログイン画面のコンパイルは済む
const WARM_UP_PATHS = ["/booking", "/my", "/admin/login", "/admin"];

export default async function globalSetup(config: FullConfig) {
  const local = readLocalSupabase();

  // --local を明示する(リンク済みのリモートのDBは決して作り直さない)
  execSync("npx supabase db reset --local", { stdio: "inherit" });

  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // スタッフに紐付けないアカウント(RLS の確認用と、ブラウザごとのログアウト用)
  const unlinkedAccounts = [
    UNLINKED_ACCOUNT,
    ...config.projects.map((project) => logoutAccount(project.name)),
  ];
  for (const account of unlinkedAccounts) {
    const { error } = await admin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
    });
    if (error) {
      throw new Error(
        `テスト用アカウントを作れませんでした(${account.email}): ${error.message}`,
      );
    }
  }

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

  // 主な画面を一度開いて、開発サーバーに先にコンパイルさせておく
  // (並列のテストが最初の1回のコンパイルを同時に待って、タイムアウトするのを防ぐ)
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL) {
    for (const path of WARM_UP_PATHS) {
      await fetch(new URL(path, baseURL));
    }
  }
}
