// LIFF のエントリーページ(/)の振り分け(純粋関数)。docs/milestone-6-plan.md
// 「LIFF のエントリーページ」。
//
// LIFF のエンドポイントURLはサイトのルート(/)。https://liff.line.me/{LIFF ID}/my を開くと
// まず /?liff.state=%2Fmy が開かれ、liff.init() が /my へ2次リダイレクトする。
// @line/liff 2.29.1 の実装(@liff/init の liff.state 処理)では、遷移先が現在のURLと違えば
// location.replace() を呼んだうえで「解決しない Promise」を待つので、その場合
// liff.init() の Promise は解決しない。つまり init 後の処理が動くのは SDK が遷移しなかった
// ときだけで、こちらから router.replace しても SDK のリダイレクトと競合しない。

export type LiffEntryDecision =
  /** SDK の2次リダイレクトに任せる(自分では遷移しない) */
  | { kind: "wait_for_sdk" }
  /** 指定のパスへ遷移する */
  | { kind: "redirect"; path: "/booking" };

const LIFF_STATE_PARAM = "liff.state";

/**
 * エントリーページでどこへ遷移するかを決める。
 * @param search location.search(先頭の ? は有っても無くてもよい)または URLSearchParams
 * @param options.stubMode NEXT_PUBLIC_LIFF_STUB=1(SDK を使わないので常に /booking)
 * @param options.initFailed liff.init() が失敗した・LIFF ID が無い(SDK は遷移させない)
 */
export function decideLiffEntry(
  search: string | URLSearchParams,
  options: { stubMode: boolean; initFailed?: boolean },
): LiffEntryDecision {
  if (options.stubMode || options.initFailed === true) {
    return { kind: "redirect", path: "/booking" };
  }
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  if (params.has(LIFF_STATE_PARAM)) {
    return { kind: "wait_for_sdk" };
  }
  return { kind: "redirect", path: "/booking" };
}
