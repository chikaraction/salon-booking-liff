// コードが使う Supabase のDB型(Database / DbClient)。
//
// 生成ファイル(./database.types.ts)は Supabase CLI の出力そのままで、
// 手では直さない。再生成は `npm run db:types` で行う(リンク済みのリモートDBを
// 読み取って上書きする)。コードからは生成ファイルを直接 import せず、
// 必ずこのファイルの Database / DbClient を使うこと。
//
// なぜ上書きが必要か:
// Postgres の関数の引数は「null を許すか」の情報を持たないため、生成器は RPC の
// 引数を一律に非null の型にする。実際の SQL 側では null を受け付ける(省略可能な
// 備考など)引数があり、呼び出し側は null を渡している。そこで、SQL側で null を
// 受け付ける引数だけを下の NullableRpcArgs に並べ、`| null` に上書きする。
// それ以外の引数(p_staff_id など)は非null のまま残す。
//
// null 可の引数を持つ RPC を新しく足したとき(または既存の RPC に足したとき)は、
// マイグレーションの定義を確かめたうえで NullableRpcArgs にも足すこと。

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database as GeneratedDatabase } from "./database.types";

type GeneratedFunctions = GeneratedDatabase["public"]["Functions"];

/**
 * 関数名と引数名が生成された型に実在するかを確かめる(綴り間違いを型エラーにする)。
 * 存在しない関数名・引数名を書くと、制約違反でコンパイルが通らない。
 */
type CheckedNullableRpcArgs<
  T extends {
    [F in keyof T]: F extends keyof GeneratedFunctions
      ? keyof GeneratedFunctions[F]["Args"]
      : never;
  },
> = T;

/** RPC 名 → SQL側で null を受け付ける引数名 */
type NullableRpcArgs = CheckedNullableRpcArgs<{
  create_reservation: "p_customer_name" | "p_customer_phone" | "p_note";
  change_reservation: "p_note";
  admin_create_reservation:
    "p_customer_id" | "p_customer_name" | "p_customer_phone" | "p_note";
  admin_update_reservation: "p_note";
}>;

/** Args のうち K に挙げた引数だけを `| null` にする(省略可能かどうかは保つ) */
type WithNullableArgs<Args, K extends PropertyKey> = {
  [P in keyof Args]: P extends K ? Args[P] | null : Args[P];
};

/** NullableRpcArgs に挙げた RPC の Args だけを差し替えた Functions */
type Functions = {
  [F in keyof GeneratedFunctions]: F extends keyof NullableRpcArgs
    ? Omit<GeneratedFunctions[F], "Args"> & {
        Args: WithNullableArgs<
          GeneratedFunctions[F]["Args"],
          NullableRpcArgs[F]
        >;
      }
    : GeneratedFunctions[F];
};

/** コードが使う Database 型(生成された型の RPC 引数の null 可だけを上書きしたもの) */
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Functions"> & {
    Functions: Functions;
  };
};

/** Database 型付きの Supabase クライアント */
export type DbClient = SupabaseClient<Database>;
