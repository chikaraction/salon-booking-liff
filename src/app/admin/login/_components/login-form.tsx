"use client";

// ログインフォーム(配線に徹する)。入力検証・エラー文言の判断は
// Server Action 側(src/lib/admin-login.ts)に集約されている。

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { login } from "@/app/admin/actions";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    startTransition(async () => {
      const result = await login(email, password);
      if (result.ok) {
        // セッションcookieが設定済みなので保護配下へ。refreshで
        // サーバーコンポーネントに新しいセッションを反映する
        router.replace("/admin");
        router.refresh();
        return;
      }
      setErrorMessage(result.message);
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-8 flex flex-col gap-5"
      noValidate
    >
      <div>
        <label htmlFor="admin-email" className="text-base font-bold">
          メールアドレス
        </label>
        <input
          id="admin-email"
          type="email"
          value={email}
          autoComplete="email"
          required
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
      <div>
        <label htmlFor="admin-password" className="text-base font-bold">
          パスワード
        </label>
        <input
          id="admin-password"
          type="password"
          value={password}
          autoComplete="current-password"
          required
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
      {errorMessage !== null && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        disabled={isPending}
        className="h-12 w-full rounded-xl text-base font-bold"
      >
        {isPending ? "ログイン中…" : "ログイン"}
      </Button>
    </form>
  );
}
