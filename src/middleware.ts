// /admin 配下のアクセス制御(ADR-005)。
//
// あえて非推奨の middleware.ts(Edge ランタイム)を使っている(M6 で proxy.ts から戻した):
// - Next 16 の proxy.ts は Node.js ランタイム固定。「Edge ランタイムを使い続けたいなら
//   middleware を使い続けること」と移行ガイドにある
//   (node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md「middleware to proxy」)
// - Cloudflare Workers に載せる OpenNext は、Node.js ミドルウェアを
//   「experimental … not officially maintained by OpenNext maintainers. Use at your own risk.」
//   と警告する(@opennextjs/cloudflare の dist/cli/build/build.js)。ログイン判定を
//   保守対象外の経路に乗せないため Edge で動かす
// - middleware.ts は runtime を書かなければ Edge になる
//   (next/dist/build/entries.js の runDependingOnPageType: middleware は
//    runtime が 'nodejs' のときだけ Node、それ以外は Edge)
// → OpenNext が Node.js ミドルウェアを正式対応したら proxy.ts に戻す
//   (ファイル名を proxy.ts、関数名を proxy にするだけ。中身は変えなくてよい)
//
// ここでの役割:
// 1. Supabaseセッションのトークン更新(@supabase/ssr はミドルウェアでの
//    セッション更新を必須としている。型定義コメントで確認)
// 2. 未ログインで /admin 配下(ログイン画面を除く)→ /admin/login へリダイレクト
// 3. ログイン済みで /admin/login → /admin へリダイレクト
//    (2・3 の判定は src/lib/admin-access.ts の decideAdminAccess)
// 4. fetch で送る Server Action の要求(POST + next-action ヘッダー)は、307 ではなく
//    「200 + x-action-redirect ヘッダー・本文なし」で移す。307 だと fetch が自動で
//    追いかけてログイン画面の HTML を受け取り、Next のクライアントが
//    "An unexpected response was received from the server." を投げて英語のエラー画面になる
//    (別の端末でログアウトしたあと、開いたままの画面で保存したときなど)。
//    200 + x-action-redirect は Next 本体が Server Action の redirect() で返す形
//    (next/dist/server/app-render/action-handler.js)。クライアントはこのヘッダーがあれば
//    RSC でない応答もエラーにせず、本文が無ければ action の Promise をリダイレクトの
//    エラーで reject してその URL へページ遷移する
//    (next/dist/client/components/router-reducer/reducers/server-action-reducer.js)
// 5. すべての応答にクリックジャッキング対策のヘッダーを付ける
//    (matcher が /admin だけなので客側のLIFFには影響しない)
// レイアウト側でも getAdminUser で再確認する(二重チェック)。

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { decideAdminAccess } from "@/lib/admin-access";
import { ADMIN_SECURITY_HEADERS } from "@/lib/admin-security-headers";

/** Server Action のリダイレクトを伝えるヘッダー(Next 本体と同じ名前) */
const ACTION_REDIRECT_HEADER = "x-action-redirect";
/** Server Action を見分けるヘッダー(next/dist/client/components/app-router-headers.js の ACTION_HEADER) */
const ACTION_HEADER = "next-action";

/** 管理画面のセキュリティヘッダーを応答に付けて返す */
function withSecurityHeaders(response: NextResponse): NextResponse {
  Object.entries(ADMIN_SECURITY_HEADERS).forEach(([key, value]) =>
    response.headers.set(key, value),
  );
  return response;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません",
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // トークン更新時に呼ばれる。後続処理(レイアウト等)が新しいトークンを
      // 読めるようリクエスト側にも書き、レスポンスにSet-Cookieを載せる。
      // headers はキャッシュ抑止ヘッダー(@supabase/ssr の型定義で確認)
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
    // 本番は https だけなので Secure を付ける(npm run dev の http://localhost では付けない)
    cookieOptions: { secure: process.env.NODE_ENV === "production" },
  });

  // 認可判定は getSession ではなく検証済みの getUser(cookieは改ざんされうる)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // トークン更新で発行されたSet-Cookieをリダイレクト応答にも引き継ぐ
  const withRefreshedCookies = (
    redirectResponse: NextResponse,
  ): NextResponse => {
    response.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  };

  const redirectTo = (path: string): NextResponse => {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = path;
    redirectUrl.search = "";
    return withRefreshedCookies(NextResponse.redirect(redirectUrl));
  };

  // Server Action 向けのリダイレクト(冒頭コメントの 4)。履歴は置き換える
  const actionRedirectTo = (path: string): NextResponse =>
    withRefreshedCookies(
      new NextResponse(null, {
        status: 200,
        headers: { [ACTION_REDIRECT_HEADER]: `${path};replace` },
      }),
    );

  const decision = decideAdminAccess({
    pathname: request.nextUrl.pathname,
    isLoggedIn: user !== null,
    method: request.method,
    hasActionHeader: request.headers.has(ACTION_HEADER),
  });

  // response は setAll で作り直されるので、ヘッダーは return の直前に付ける
  switch (decision.kind) {
    case "redirect":
      return withSecurityHeaders(redirectTo(decision.path));
    case "action_redirect":
      return withSecurityHeaders(actionRedirectTo(decision.path));
    case "pass":
      return withSecurityHeaders(response);
  }
}

export const config = {
  // /admin と /admin/ 配下のみ(客側のLIFF・予約フローには関与しない)
  matcher: ["/admin/:path*"],
};
