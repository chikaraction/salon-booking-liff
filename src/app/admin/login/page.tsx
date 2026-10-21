import { fetchSalonNameForLogin } from "@/server/admin-data";

import { LoginForm } from "./_components/login-form";

// 店名はDBの内容を毎回取得する(ビルド時の静的生成はしない)
export const dynamic = "force-dynamic";

// 管理画面ログイン(モックA: 店名+「管理画面ログイン」+1カード)。
// ログイン済みユーザーのリダイレクトは src/middleware.ts が行う。
export default async function AdminLoginPage() {
  const salonName = await fetchSalonNameForLogin();

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-sm sm:p-10">
        <p className="text-center text-sm font-bold tracking-[0.2em] text-primary uppercase">
          {salonName}
        </p>
        <h1 className="mt-3 text-center text-2xl font-bold">
          管理画面ログイン
        </h1>
        <LoginForm />
      </div>
    </main>
  );
}
