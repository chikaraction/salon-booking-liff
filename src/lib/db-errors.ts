// DBエラーコード(PostgreSQLの SQLSTATE)の判定(純粋関数)。
// DOM・Supabaseクライアントはimportしない。
// supabase-js の PostgrestError は SQLSTATE を code(文字列)に持つ。

/**
 * EXCLUDE制約違反(exclusion_violation)。
 * reservations_no_overlap(ダブルブッキング防止の本体。ADR-004。initial_schema)と
 * date_overrides_no_overlap(臨時休業・臨時営業の期間の重なり。m4b_closures_and_owner_rls)で返る。
 */
export const EXCLUSION_VIOLATION = "23P01";

/**
 * 一意制約違反(unique_violation)。
 * 前日リマインドの push_messages_one_reminder_per_reservation(1予約1通。m5_notifications)などで返る。
 */
export const UNIQUE_VIOLATION = "23505";

/**
 * RPCの raise exception(raise_exception)。
 * create_reservation / admin_create_reservation / admin_update_reservation などが
 * 無効なメニュー・顧客名未指定・無効な顧客IDといった業務エラーを返すときに使う。
 */
export const RAISE_EXCEPTION = "P0001";

/**
 * 1人あたりの、これからの予約の上限超過(独自に定義した SQLSTATE)。
 * create_reservation が返す(マイグレーション 20261026110000_reservation_limit_per_customer.sql)。
 */
export const RESERVATION_LIMIT_EXCEEDED = "R0001";

/** error が code(文字列)を持つ object で、その値が指定の SQLSTATE と一致するか */
export function hasSqlState(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === code
  );
}

/**
 * 予約INSERTの失敗が「枠が埋まっていた」ことによるものか判定する。
 * ダブルブッキング防止の本体はDBのEXCLUDE制約で、違反時は
 * SQLSTATE 23P01 (exclusion_violation) が返る(ADR-004)。
 */
export function isSlotTakenError(error: unknown): boolean {
  return hasSqlState(error, EXCLUSION_VIOLATION);
}

/**
 * 客側の新規予約の失敗が「1人あたりの、これからの予約の上限」によるものか判定する。
 * 上限超過時、create_reservation は独自に定義した SQLSTATE R0001 を返す
 * (マイグレーション 20261026110000_reservation_limit_per_customer.sql)。
 */
export function isReservationLimitError(error: unknown): boolean {
  return hasSqlState(error, RESERVATION_LIMIT_EXCEEDED);
}

/**
 * RPCの失敗が、RPC自身が raise した業務エラー(SQLSTATE P0001)か判定する。
 * 管理画面の代行登録・予約変更では、無効メニュー・顧客名未指定・無効な顧客IDがこれに当たる。
 */
export function isRpcRaisedError(error: unknown): boolean {
  return hasSqlState(error, RAISE_EXCEPTION);
}
