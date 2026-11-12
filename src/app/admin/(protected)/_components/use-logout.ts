"use client";

// ログアウトの配線(サイドバーと、スタッフとして登録されていないときの案内カードで共用)。
// ボタンの見た目は呼び出し側が持ち、ここは Server Action の呼び出しと結果の扱いだけを持つ。

import { unstable_rethrow, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { logout, type LogoutResult } from "@/app/admin/actions";

type UseLogout = {
  /** ログアウトのボタンの onClick に渡す */
  handleLogout: () => void;
  /** ログアウトの処理中か(ボタンを押せなくする・文言を変える) */
  isPending: boolean;
  /** ログアウトに失敗したときの文言。失敗していなければ null */
  errorMessage: string | null;
};

export function useLogout(): UseLogout {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    setErrorMessage(null);
    startTransition(async () => {
      let result: LogoutResult;
      try {
        result = await logout();
      } catch (error) {
        // 成功時は Server Action の redirect でログイン画面へ移る。そのとき await は
        // Next のリダイレクトのエラーで reject されるので、Next に投げ返す。
        // 別の端末で先にログアウトしていてセッションが既に無効なときは、Server Action は
        // 実行されず、middleware.ts が Server Action 向けのリダイレクト(x-action-redirect)
        // でログイン画面へ移す。このときも await は同じリダイレクトのエラーで reject される
        unstable_rethrow(error);
        // ほかの理由で応答が壊れたとき(通信エラーなど)の保険。ログイン画面へ移しておけば、
        // ログインが切れていればそのまま、まだログイン中なら middleware.ts が /admin に
        // 戻すので害はない
        router.replace("/admin/login");
        router.refresh();
        return;
      }
      setErrorMessage(result.message);
    });
  };

  return { handleLogout, isPending, errorMessage };
}
