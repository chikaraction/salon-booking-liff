import "server-only";

// LINE IDトークンのサーバー側検証(ADR-003)。
// LIFFクライアントから渡されたIDトークンをLINEの検証APIで検証し、
// LINEのuserId(subクレーム)を得る。客の特定はこの結果だけを信頼する。
//
// 検証APIの仕様(LINE公式ドキュメントで確認済み):
//   POST https://api.line.me/oauth2/v2.1/verify
//   Content-Type: application/x-www-form-urlencoded
//   パラメータ: id_token(必須)/ client_id(必須。期待されるチャネルID)
//   成功(200): IDトークンのペイロードJSON。sub = 対象ユーザーID
//   失敗: { error, error_description } 形式のJSON
//   https://developers.line.biz/ja/reference/line-login/#verify-id-token

import { decideStubToken } from "@/lib/liff-stub";

const VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";

/** 呼び出し元(Server Action)が「認証エラー」と判別するためのResult型 */
export type VerifyLineIdTokenResult =
  { ok: true; userId: string } | { ok: false; message: string };

/** 検証APIの成功レスポンス(必要なフィールドのみ) */
type VerifySuccessResponse = {
  sub?: string;
};

/** 検証APIのエラーレスポンス */
type VerifyErrorResponse = {
  error?: string;
  error_description?: string;
};

/**
 * IDトークンをLINEの検証APIで検証し、userId(sub)を返す。
 *
 * 開発用スタブ: idTokenが "stub:" で始まり、かつ NEXT_PUBLIC_LIFF_STUB=1 かつ
 * 非本番のときだけ、LINE APIを呼ばず "stub:" 以降をuserIdとして返す。
 * 条件を満たさないスタブトークンは必ず認証エラーにする(判定は src/lib/liff-stub.ts)。
 */
export async function verifyLineIdToken(
  idToken: string,
): Promise<VerifyLineIdTokenResult> {
  const stub = decideStubToken(idToken, {
    stubEnabled: process.env.NEXT_PUBLIC_LIFF_STUB === "1",
    isProduction: process.env.NODE_ENV === "production",
  });
  if (stub.kind === "stub_accepted") {
    return { ok: true, userId: stub.userId };
  }
  if (stub.kind === "stub_rejected") {
    return { ok: false, message: "無効なIDトークンです" };
  }

  // 環境変数の欠落は認証エラーではなくサーバー設定ミスなので例外にする
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) {
    throw new Error("環境変数 LINE_LOGIN_CHANNEL_ID が設定されていません");
  }

  const response = await fetch(VERIFY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    // IDトークンの検証結果をキャッシュしてはいけない
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as VerifyErrorResponse;
      detail = body.error_description ?? body.error ?? "";
    } catch {
      // JSONでないエラーレスポンスは詳細なしで扱う
    }
    return {
      ok: false,
      message: `IDトークンの検証に失敗しました${detail ? `(${detail})` : ""}`,
    };
  }

  const payload = (await response.json()) as VerifySuccessResponse;
  if (!payload.sub) {
    return {
      ok: false,
      message: "IDトークンの検証結果にユーザーIDが含まれていません",
    };
  }
  return { ok: true, userId: payload.sub };
}
