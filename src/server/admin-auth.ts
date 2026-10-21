import "server-only";

// 管理画面(店側)の認証まわり(ADR-005)。
// - Supabase Auth のメール+パスワードでログインした店側スタッフのセッションを
//   cookieで保持する(@supabase/ssr の createServerClient)
// - このクライアントは anon キー + セッションの authenticated ロールで動作し、
//   RLSが適用される。管理画面のDBアクセスは必ずこちらを使い、service_role は使わない
// - 認可判定は getSession ではなく getUser を使う(Auth サーバーでJWTを検証した
//   ユーザーだけを信頼する。cookie由来のセッションは改ざんされうるため)

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  SETTINGS_PERMISSION_DENIED_MESSAGE,
  canManageSettings,
  isStaffRole,
  type StaffRole,
} from "@/lib/admin-permissions";

/** Supabase の URL / anon キーを環境変数から取得する(未設定なら例外) */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません",
    );
  }
  return { url, anonKey };
}

/**
 * cookieベースのサーバー用Supabaseクライアントを作る。
 * リクエストごとに必ず新しく作る(@supabase/ssr の型定義コメントの指示。
 * リクエスト間でクライアントを共有してはいけない)。
 */
export async function createAdminAuthClient(): Promise<SupabaseClient> {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Component からは cookie を書けない(Next.jsの制約)。
          // トークン更新の書き戻しは src/middleware.ts が行うため、ここでは無視してよい
        }
      },
    },
  });
}

/**
 * ログイン中の店側スタッフ(Supabase Authユーザー)を返す。未ログインなら null。
 * Auth サーバーで検証済みの getUser を使う(保護レイアウトの二重チェック用)。
 */
export async function getAdminUser(): Promise<User | null> {
  const supabase = await createAdminAuthClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null) {
    return null;
  }
  return data.user;
}

/** ログイン中のスタッフ(staff 行)。ロール判定に必要な最小限だけ持つ */
export type CurrentStaff = {
  id: string;
  name: string;
  role: StaffRole;
};

/**
 * ログイン中の Auth ユーザーに対応する staff 行を返す。
 * 未ログイン、または staff.auth_user_id が未紐付けなら null(ADR-005)。
 *
 * - 起点は getSession ではなく検証済みの getUser(getAdminUser と同じ方針)
 * - 取得は authenticated クライアント(RLS適用)。service_role は使わない。
 *   staff の SELECT は全スタッフに許可されているので普通に引ける
 * - null は「ロール不明」であり、DBの current_staff_role() が NULL を返す状態と
 *   一致する。設定変更はアプリ層でもRLSでも拒否される
 *   (紐付け手順は README の「店側スタッフ(管理画面ユーザー)の登録」を参照)
 * - 紐付け漏れ(Authユーザーはあるが staff 行が無い)は console.warn に
 *   auth ユーザーIDだけを残す。画面側は原因を出さないため、運用時の切り分けは
 *   このログで行う
 */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createAdminAuthClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError !== null || userData.user === null) {
    return null;
  }

  // 未紐付けなら0件。maybeSingle は0件をエラーにせず null を返す
  const { data, error } = await supabase
    .from("staff")
    .select("id, name, role")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (error !== null) {
    console.error("getCurrentStaff failed", error);
    return null;
  }
  if (data === null) {
    // Authユーザーはあるのに staff 行が無い = 紐付け漏れ。障害ではなく運用上の
    // 設定漏れなので error ではなく warn にする(取得エラーは上の console.error、
    // role の想定外値は下の console.error が担当。役割が重複しないようにしている)。
    //
    // 権限不足カード(settings/layout.tsx)は読み手が対処できないため原因を
    // 出さない。そのぶんの診断性をこのログで補う。
    // 出すのは auth ユーザーIDだけ(READMEの紐付けSQLに必要なのもこのIDで、
    // メールアドレスなどの個人情報はログに入れない)。
    console.warn(
      "管理画面ユーザーに紐付く staff 行がありません(auth_user_id の紐付け漏れ)。auth user id:",
      userData.user.id,
    );
    return null;
  }

  const staff = data as { id: string; name: string; role: string };
  if (!isStaffRole(staff.role)) {
    // check 制約があるので通常は起きない。想定外の値は権限なし扱いにする
    console.error("staff.role が想定外の値です", staff.role);
    return null;
  }
  return { id: staff.id, name: staff.name, role: staff.role };
}

export type OwnerGuardResult =
  { ok: true; staff: CurrentStaff } | { ok: false; message: string };

/**
 * 設定系のServer Actionの先頭で通すオーナー判定(ADR-005)。
 * 未ログイン・staff.auth_user_id 未紐付け・スタッフロールはいずれも拒否する
 * (メッセージは同一。ロールを断定しない文言にしてある)。
 *
 * ここ(server-only モジュール)に置くのは意図的。設定系アクションのファイルは
 * "use server" なので、そこから export するとガード自体がクライアントから呼べる
 * Server Action エンドポイントとして生えてしまう。ガードは呼び出し口を持つ必要が
 * ないため、import 専用のこちらに置く。
 *
 * なぜアプリ層でも判定するか(RLSだけでは足りない理由):
 * RLSのUPDATE/DELETEは、ポリシーに合致しない行を「存在しない行」として扱う。
 * そのためスタッフが設定系テーブルをUPDATE/DELETEしてもエラーにはならず、
 * 「0行更新」で静かに成功してしまう(INSERTだけは 42501 で失敗する)。
 * アプリ層で先に弾かないと「保存できたように見えるのに何も変わっていない」
 * というバグになる。RLSは迂回されたときの最後の砦、アプリ層はUXの防波堤。
 *
 * 使い方:
 * ```ts
 * const guard = await requireOwner();
 * if (!guard.ok) return { ok: false, message: guard.message };
 * ```
 */
export async function requireOwner(): Promise<OwnerGuardResult> {
  const staff = await getCurrentStaff();
  if (staff === null || !canManageSettings(staff.role)) {
    return { ok: false, message: SETTINGS_PERMISSION_DENIED_MESSAGE };
  }
  return { ok: true, staff };
}
