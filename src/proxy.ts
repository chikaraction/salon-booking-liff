// /admin 配下のアクセス制御(ADR-005)。
// Next.js 16 では middleware.ts が非推奨になり proxy.ts に改名された
// (node_modules/next/dist/build/index.js の警告文と
//  dist/build/templates/middleware.js の `mod.proxy` 解決で確認)。
// エクスポート名は `proxy` または default。matcher の書式は middleware と同じ。
//
// ここでの役割:
// 1. Supabaseセッションのトークン更新(@supabase/ssr はミドルウェアでの
//    セッション更新を必須としている。型定義コメントで確認)
// 2. 未ログインで /admin 配下(ログイン画面を除く)→ /admin/login へリダイレクト
// 3. ログイン済みで /admin/login → /admin へリダイレクト
// レイアウト側でも getAdminUser で再確認する(二重チェック)。

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const LOGIN_PATH = "/admin/login";

export async function proxy(request: NextRequest): Promise<NextResponse> {
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
  });

  // 認可判定は getSession ではなく検証済みの getUser(cookieは改ざんされうる)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === LOGIN_PATH;

  const redirectTo = (path: string): NextResponse => {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = path;
    redirectUrl.search = "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    // トークン更新で発行されたSet-Cookieをリダイレクト応答にも引き継ぐ
    response.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  };

  if (user === null && !isLoginPage) {
    return redirectTo(LOGIN_PATH);
  }
  if (user !== null && isLoginPage) {
    return redirectTo("/admin");
  }

  return response;
}

export const config = {
  // /admin と /admin/ 配下のみ(客側のLIFF・予約フローには関与しない)
  matcher: ["/admin/:path*"],
};
