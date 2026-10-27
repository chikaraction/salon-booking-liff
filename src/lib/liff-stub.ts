// 開発用スタブIDトークンの判定(純粋関数)。
// NEXT_PUBLIC_LIFF_STUB=1 のとき、LIFF SDKを使わず "stub:<userId>" 形式の
// ダミーIDトークンで予約フローをスモークテストできるようにする(milestone-2-plan)。
// スタブの受理条件と、クライアントが使うスタブIDトークンの組み立てはここに集約し、
// I/O層(src/server/line.ts・src/liff/client.ts)は配線に徹する。

export const STUB_TOKEN_PREFIX = "stub:";

/** 上書きが無いときのスタブの客(LINE userId) */
export const DEFAULT_STUB_USER_ID = "U-dev-user-1";

/**
 * スタブの客を切り替える localStorage のキー。値があればそれを userId にする
 * (E2E で別々の客として予約するため。Playwright の context.addInitScript で入れる)
 */
export const STUB_USER_ID_STORAGE_KEY = "liff-stub-user-id";

/**
 * スタブモードのクライアントが使うダミーIDトークン "stub:<userId>" を作る。
 * 上書きの値(localStorage の STUB_USER_ID_STORAGE_KEY)は前後の空白を除いて使い、
 * 無い・空(空白だけを含む)なら DEFAULT_STUB_USER_ID にする。
 */
export function stubIdTokenFor(
  overrideUserId: string | null | undefined,
): string {
  const userId = overrideUserId?.trim() || DEFAULT_STUB_USER_ID;
  return `${STUB_TOKEN_PREFIX}${userId}`;
}

export type StubTokenDecision =
  | { kind: "not_stub" } // スタブではない。通常のIDトークンとして検証する
  | { kind: "stub_accepted"; userId: string } // スタブとして受理(開発時のみ)
  | { kind: "stub_rejected" }; // スタブ形式だが条件を満たさない。必ず認証エラーにする

/**
 * IDトークンがスタブかどうかを判定する。
 * スタブ("stub:" で始まる)は、スタブモード有効かつ非本番のときだけ受理し、
 * それ以外は必ず拒否する(通常検証へフォールバックさせない)。
 */
export function decideStubToken(
  idToken: string,
  env: { stubEnabled: boolean; isProduction: boolean },
): StubTokenDecision {
  if (!idToken.startsWith(STUB_TOKEN_PREFIX)) {
    return { kind: "not_stub" };
  }
  const userId = idToken.slice(STUB_TOKEN_PREFIX.length);
  if (!env.stubEnabled || env.isProduction || userId === "") {
    return { kind: "stub_rejected" };
  }
  return { kind: "stub_accepted", userId };
}
