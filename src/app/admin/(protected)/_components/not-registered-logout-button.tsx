"use client";

// スタッフとして登録されていないときの案内カード(保護レイアウト)に置くログアウトのボタン。
// 挙動はサイドバーのログアウトと同じ(use-logout.ts)。見た目だけがカード用。

import { LogOut } from "lucide-react";

import { useLogout } from "./use-logout";

export function NotRegisteredLogoutButton() {
  const { handleLogout, isPending, errorMessage } = useLogout();

  return (
    <div className="mt-6">
      {errorMessage !== null && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {errorMessage}
        </p>
      )}
      <button
        type="button"
        onClick={handleLogout}
        disabled={isPending}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-base font-bold text-primary-foreground transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
      >
        <LogOut aria-hidden="true" className="size-4 shrink-0" />
        {isPending ? "ログアウト中…" : "ログアウト"}
      </button>
    </div>
  );
}
