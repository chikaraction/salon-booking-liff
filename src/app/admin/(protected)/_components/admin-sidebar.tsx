"use client";

// 管理画面サイドバー(モック02の左側)。
// - 上部: 「{店名} 管理」
// - ナビ: 予約カレンダー(/admin)・代行登録(/admin/reservations/new)。
//   設定系の項目はM4bで画面と同時に追加する
// - 下部: ミニ集計スロット(miniSummary。後続タスクが埋める)+ログアウト
// - スマホ幅(md未満)はヘッダーバー+ハンバーガーで折りたたみ(ADR-005)

import { CalendarDays, LogOut, Menu, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { logout } from "@/app/admin/actions";
import { isAdminNavActive } from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin", label: "予約カレンダー", icon: CalendarDays },
  { href: "/admin/reservations/new", label: "代行登録", icon: Plus },
] as const;

type Props = {
  salonName: string;
  /** 下部のミニ集計(今日の予約件数・LINEプッシュバー)。後続タスクが埋める */
  miniSummary?: React.ReactNode;
};

export function AdminSidebar({ salonName, miniSummary }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await logout();
      if (result.ok) {
        router.replace("/admin/login");
        router.refresh();
        return;
      }
      setErrorMessage(result.message);
    });
  };

  const navigation = (
    <nav aria-label="管理画面ナビゲーション" className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isAdminNavActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            onClick={() => setIsOpen(false)}
            className={cn(
              "flex h-11 items-center gap-3 rounded-xl px-4 text-base font-medium transition-colors",
              active
                ? "bg-primary font-bold text-primary-foreground"
                : "text-foreground hover:bg-muted",
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="flex flex-col gap-3">
      {/* ミニ集計スロット(今日の予約件数・LINEプッシュ n/200 バー)。
          後続タスク(カレンダー)がここを埋める */}
      {miniSummary !== undefined && miniSummary !== null && (
        <div className="rounded-xl bg-card p-4">{miniSummary}</div>
      )}
      {errorMessage !== null && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
      <button
        type="button"
        onClick={handleLogout}
        disabled={isPending}
        className="flex h-11 items-center gap-3 rounded-xl px-4 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <LogOut aria-hidden="true" className="size-4 shrink-0" />
        {isPending ? "ログアウト中…" : "ログアウト"}
      </button>
    </div>
  );

  return (
    <>
      {/* スマホ幅: ヘッダーバー+ハンバーガー */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <p className="text-sm font-bold tracking-widest text-primary">
          {salonName} 管理
        </p>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls="admin-mobile-menu"
          aria-label={isOpen ? "メニューを閉じる" : "メニューを開く"}
          onClick={() => setIsOpen((open) => !open)}
          className="flex size-10 items-center justify-center rounded-xl hover:bg-muted"
        >
          {isOpen ? (
            <X aria-hidden="true" className="size-5" />
          ) : (
            <Menu aria-hidden="true" className="size-5" />
          )}
        </button>
      </header>
      {isOpen && (
        <div
          id="admin-mobile-menu"
          className="flex flex-col gap-4 border-b border-border bg-card p-4 md:hidden"
        >
          {navigation}
          {footer}
        </div>
      )}

      {/* PC/タブレット幅: 常時表示のサイドバー */}
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-border bg-card p-4 md:flex">
        <div className="flex flex-col gap-6">
          <p className="px-4 pt-2 text-sm font-bold tracking-widest text-primary">
            {salonName} 管理
          </p>
          {navigation}
        </div>
        {footer}
      </aside>
    </>
  );
}
