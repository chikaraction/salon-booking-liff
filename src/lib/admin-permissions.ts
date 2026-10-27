// 管理画面のロール判定(純粋関数)。ADR-005 の「オーナー / スタッフ」の2ロール。
// - オーナー: スタッフ管理・営業時間/メニュー設定・全予約の操作
// - スタッフ: 予約の閲覧・代行登録・代行キャンセル
//
// 権限差は「アプリ層 + RLS」の二重で担保する(docs/milestone-4b-plan.md)。
// ここはアプリ層の判断ロジックだけを持ち、DBアクセスは行わない。

/** スタッフのロール(staff.role の check 制約と同じ2値) */
export type StaffRole = "owner" | "staff";

/**
 * 設定系(店舗設定・営業日・スタッフ・メニュー)を変更できるか。
 *
 * null は「未ログイン」または「staff.auth_user_id が未紐付け」を表す。
 * 未紐付けのユーザーは DB の current_staff_role() も NULL を返し、
 * RLSでも変更できないため、アプリ層でも同じく false にして表示を揃える。
 */
export function canManageSettings(role: StaffRole | null): boolean {
  return role === "owner";
}

/**
 * 権限が足りないときのUI文字列。
 * ロールを断定しない文言にしてある(スタッフの場合と、
 * staff.auth_user_id 未紐付けでロールが判定できない場合の両方で使うため)。
 */
export const SETTINGS_PERMISSION_DENIED_MESSAGE =
  "この操作にはオーナー権限が必要です";

/** DBから読んだ role 文字列を StaffRole に絞り込む型ガード */
export function isStaffRole(value: unknown): value is StaffRole {
  return value === "owner" || value === "staff";
}

/**
 * DBから読んだ role 文字列を StaffRole に詰め替える(一覧表示などのデータ用)。
 * 想定外の値は権限の小さい "staff" に倒す。staff.role には check 制約が
 * あるので、通常は起きない。
 *
 * 認証・認可の判定(admin-auth.ts の getCurrentStaff)には使わないこと。
 * あちらは想定外のロールを「権限なし(null)」として拒否するのが正しく、
 * "staff" に倒すとスタッフ権限を与えてしまう。
 */
export function toStaffRole(value: string): StaffRole {
  return isStaffRole(value) ? value : "staff";
}

/** サイドバーのナビ項目のうち、表示可否の判断に使う属性 */
export type AdminNavVisibility = {
  /** オーナーだけに見せる項目か(設定グループはすべて true) */
  ownerOnly: boolean;
  /**
   * リンク先の画面が実装済みか。
   * M4bの設定ページは実施順序5〜8で順に追加されるため、
   * 未実装のうちはリンクを出さずオーナーに404を踏ませない。
   * 後続タスクはページを追加したら、このフラグを true にするだけでよい。
   */
  implemented: boolean;
};

/** サイドバーのナビ項目(アイコンなどの描画用の属性は呼び出し側が足す) */
export type AdminNavItem = AdminNavVisibility & {
  href: string;
  label: string;
};

/**
 * ナビ項目をロールと実装状況で絞り込む。
 * 呼び出し側がアイコン等を足した型でも、そのままの型で返す(ジェネリック)。
 */
export function visibleAdminNavItems<T extends AdminNavVisibility>(
  items: readonly T[],
  role: StaffRole | null,
): T[] {
  return items.filter(
    (item) => item.implemented && (!item.ownerOnly || canManageSettings(role)),
  );
}
