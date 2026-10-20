import "server-only";

// 表示設定(テーマカラーのプリセット・フォント)の取得。ルートレイアウトが使う。
// 客側(LIFF)は匿名なので service_role で読む。RLSをバイパスするクライアントなので、
// select は表示用の2列だけに限定する(docs/milestone-4c-plan.md「アクセス制御」)。
// 値の解釈(未知の値・取得失敗を既定値に倒す)は純粋関数 resolveDisplaySettings。

import { connection } from "next/server";
import { cache } from "react";

import {
  resolveDisplaySettings,
  type DisplaySettings,
} from "@/lib/display-settings";
import { getServiceRoleClient } from "@/server/supabase";

/**
 * 現在の表示設定を返す。React の cache で1リクエスト1回に抑える。
 *
 * 取得に失敗しても例外にせず既定値で描画する(配色のせいで予約画面ごと
 * 落ちるのは割に合わない)。失敗はサーバーログに残す。
 */
export const getDisplaySettings = cache(async (): Promise<DisplaySettings> => {
  // ルートレイアウトから呼ぶので、静的プリレンダリングされたページに
  // ビルド時の値が焼き付かないよう、ここでリクエスト時の描画に切り替える
  // (next/server の connection())。表示設定の変更をリビルドなしで全ページに
  // 反映するため。プリレンダリング中はここで中断の例外が投げられるので、
  // 下の try/catch に入れてはいけない(握りつぶすと既定値が焼き付く)
  await connection();

  try {
    const { data, error } = await getServiceRoleClient()
      .from("salon_settings")
      .select("theme_preset, font_family")
      .single();
    if (error !== null) {
      console.error("getDisplaySettings failed", error);
      return resolveDisplaySettings(null);
    }
    return resolveDisplaySettings(data);
  } catch (error) {
    console.error("getDisplaySettings failed", error);
    return resolveDisplaySettings(null);
  }
});
