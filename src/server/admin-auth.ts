import "server-only";

// 管理画面(店側)の認証まわり(ADR-005)。
// - Supabase Auth のメール+パスワードでログインした店側スタッフのセッションを
//   cookieで保持する(@supabase/ssr の createServerClient)
// - このクライアントは anon キー + セッションの authenticated ロールで動作し、
//   RLSが適用される。管理画面のDBアクセスは必ずこちらを使い、service_role は使わない
// - 認可判定は getSession ではなく getUser を使う(Auth サーバーでJWTを検証した
//   ユーザーだけを信頼する。cookie由来のセッションは改ざんされうるため)

import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";

import {
  ADMIN_NOT_REGISTERED_MESSAGE,
  SETTINGS_PERMISSION_DENIED_MESSAGE,
  canManageSettings,
  canUseAdmin,
  isStaffRole,
  type StaffRole,
} from "@/lib/admin-permissions";
import type { Database, DbClient } from "@/types/database";

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
export async function createAdminAuthClient(): Promise<DbClient> {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
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
    // 本番は https だけなので Secure を付ける(npm run dev の http://localhost では付けない)
    cookieOptions: { secure: process.env.NODE_ENV === "production" },
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
 * 未ログイン、staff.auth_user_id が未紐付け、または無効にされたスタッフ
 * (is_active = false)なら null(ADR-005)。
 *
 * - 起点は getSession ではなく検証済みの getUser(getAdminUser と同じ方針)
 * - 取得は authenticated クライアント(RLS適用)。service_role は使わない。
 *   staff を読めるのは有効なスタッフだけ(閲覧ポリシーが current_staff_role() で
 *   判定する)。有効なスタッフは自分の行を読める。無効・未紐付けのユーザーは
 *   RLS で 0 件になり、null を返す
 * - null は「ロール不明」であり、DBの current_staff_role() が NULL を返す状態と
 *   一致する。予約系・設定系の閲覧も変更も、アプリ層でもRLSでも拒否される
 *   (紐付け手順は README の「店側スタッフ(管理画面ユーザー)の登録」を参照)
 * - 0 件のとき(紐付け漏れか、無効にされたスタッフ。RLS で行が見えないので
 *   ここからは区別できない)は console.warn に auth ユーザーIDだけを残す。
 *   画面側は原因を出さないため、運用時の切り分けはこのログで行う
 */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createAdminAuthClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError !== null || userData.user === null) {
    return null;
  }

  // 未紐付け・無効にされたスタッフなら0件(RLS)。maybeSingle は0件をエラーにせず null を返す
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
    // Authユーザーはあるのに、読める staff 行が無い = 紐付け漏れか、無効にされた
    // スタッフ(無効のスタッフは RLS で自分の行も読めないので、ここからは区別
    // できない)。障害ではなく運用上の状態なので error ではなく warn にする
    // (取得エラーは上の console.error、role の想定外値は下の console.error が担当。
    // 役割が重複しないようにしている)。無効にしたスタッフがログインするたびに
    // 出るが、意図どおり弾けている記録でもある。
    //
    // 案内カード(保護レイアウトと settings/layout.tsx)は読み手が対処できないため
    // 原因を出さない。そのぶんの診断性をこのログで補う。
    // 出すのは auth ユーザーIDだけ(READMEの紐付けSQLに必要なのもこのIDで、
    // メールアドレスなどの個人情報はログに入れない)。
    console.warn(
      "管理画面ユーザーに紐付く有効な staff 行がありません(auth_user_id の紐付け漏れ、または無効にされたスタッフ)。auth user id:",
      userData.user.id,
    );
    return null;
  }

  const staff = data;
  if (!isStaffRole(staff.role)) {
    // check 制約があるので通常は起きない。想定外の値は権限なし扱いにする
    console.error("staff.role が想定外の値です", staff.role);
    return null;
  }
  return { id: staff.id, name: staff.name, role: staff.role };
}

/**
 * 描画(レイアウト・ページ)用の getCurrentStaff。同じリクエストの描画の中では
 * 1回だけ問い合わせ、レイアウトとページで結果を共有する(React の cache)。
 *
 * Server Action からは getCurrentStaff / requireOwner を使う。cache は描画の外では
 * 効かず毎回問い合わせるので(react の cache 実装: dispatcher が無ければ素通し)、
 * こちらを呼んでも害はないが、意図が伝わるよう使い分ける。
 */
export const getCurrentStaffForRender = cache(getCurrentStaff);

/**
 * 保護配下のページの先頭で通すガード。管理画面を使えないユーザー(未紐付け・
 * 無効にされたスタッフ)なら false。ページは何も取得せず null を返すこと。
 *
 * 保護レイアウトはこのユーザーに案内カードだけを出して children を描かないが、
 * Next はレイアウトが children を描かなくても配下のページを実行する(E2Eで確認:
 * ページの店舗設定の取得が0件で例外になり、サーバーのログにエラーが残った)。
 * そのためページ側でも先に止める。判断は canUseAdmin(src/lib/admin-permissions.ts)。
 *
 * 使い方:
 * ```ts
 * if (!(await canUseAdminInRender())) return null;
 * ```
 */
export async function canUseAdminInRender(): Promise<boolean> {
  const staff = await getCurrentStaffForRender();
  return canUseAdmin(staff?.role ?? null);
}

export type StaffGuardResult =
  { ok: true; staff: CurrentStaff } | { ok: false; message: string };

/**
 * service_role で読む処理を呼ぶ店側のServer Actionの先頭で通すガード(ADR-005)。
 * 有効なスタッフ(オーナー・スタッフのどちらでも可)だけを通す。未ログイン・
 * staff.auth_user_id 未紐付け・無効にされたスタッフはいずれも拒否する
 * (メッセージは同一。原因を断定しない文言にしてある)。
 * 判断は canUseAdmin(src/lib/admin-permissions.ts)。
 *
 * なぜ要るか: 店側のServer Actionはふつう authenticated クライアント(RLS適用)で
 * 読み書きするので、有効なスタッフ以外には 0件 / 42501 になり、ガードが無くても
 * 中身は返らない。しかし service_role で読む関数(booking-data.ts の
 * getDayAvailability など)は RLS を通らないので、呼ぶ前にアプリ層で確かめないと
 * 誰にでも結果が返る。Server Action は画面を描かなくても直接呼べる
 * (保護レイアウトの案内カードでは止まらない)。
 *
 * requireOwner と同じ理由で、"use server" のファイルではなくここに置く。
 * 描画の外なので getCurrentStaff を直接使う(getCurrentStaffForRender のコメント)。
 *
 * 使い方:
 * ```ts
 * const guard = await requireStaff();
 * if (!guard.ok) return { ok: false, message: guard.message };
 * ```
 */
export async function requireStaff(): Promise<StaffGuardResult> {
  const staff = await getCurrentStaff();
  if (staff === null || !canUseAdmin(staff.role)) {
    return { ok: false, message: ADMIN_NOT_REGISTERED_MESSAGE };
  }
  return { ok: true, staff };
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
