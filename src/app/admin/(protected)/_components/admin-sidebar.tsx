"use client";

// 管理画面サイドバー(モック02の左側)。
// - 上部: 「{店名} 管理」
// - ナビ: 予約カレンダー(/admin)・代行登録(/admin/reservations/new)・
//   ダッシュボード(/admin/dashboard)+ 設定グループ(オーナーのみ。ADR-005。
//   営業日・営業時間 / スタッフ / メニュー / 店舗・予約設定 / 表示設定)
// - 下部: ミニ集計スロット(miniSummary。後続タスクが埋める)+ログアウト
// - スマホ幅(md未満)はヘッダーバー+ハンバーガーで折りたたみ(ADR-005)
//
// ロールは props で受け取る(サーバー側の layout.tsx が getCurrentStaff で解決する)。
// クライアントコンポーネントからロールを取りに行かない。

import {
  CalendarDays,
  Clock,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  Plus,
  Store,
  UtensilsCrossed,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { unstable_rethrow, usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { logout, type LogoutResult } from "@/app/admin/actions";
import { isAdminNavActive } from "@/lib/admin-nav";
import {
  visibleAdminNavItems,
  type AdminNavItem,
  type StaffRole,
} from "@/lib/admin-permissions";
import { cn } from "@/lib/utils";

type SidebarNavItem = AdminNavItem & { icon: LucideIcon };

const NAV_ITEMS: readonly SidebarNavItem[] = [
  {
    href: "/admin",
    label: "予約カレンダー",
    icon: CalendarDays,
    ownerOnly: false,
    implemented: true,
  },
  {
    href: "/admin/reservations/new",
    label: "代行登録",
    icon: Plus,
    ownerOnly: false,
    implemented: true,
  },
  {
    href: "/admin/dashboard",
    label: "ダッシュボード",
    icon: LayoutDashboard,
    ownerOnly: false,
    implemented: true,
  },
];

// 設定グループ(オーナーのみ)。ADR-005「オーナー: スタッフ管理・営業時間/メニュー設定」。
//
// implemented は「その画面が実装済みか」。M4bの設定ページは実施順序5〜8で
// 順に追加されるため、未実装のうちはリンクを描画せずオーナーに404を踏ませない。
// 後続タスクは対応するページを追加したときに、このフラグを true にするだけでよい。
// (すべて false のあいだは設定グループごと描画されない)
const SETTINGS_NAV_ITEMS: readonly SidebarNavItem[] = [
  {
    href: "/admin/settings/business",
    label: "営業日・営業時間",
    icon: Clock,
    ownerOnly: true,
    implemented: true,
  },
  {
    href: "/admin/settings/staff",
    label: "スタッフ",
    icon: Users,
    ownerOnly: true,
    implemented: true,
  },
  {
    href: "/admin/settings/menus",
    label: "メニュー",
    icon: UtensilsCrossed,
    ownerOnly: true,
    implemented: true,
  },
  {
    href: "/admin/settings/salon",
    label: "店舗・予約設定",
    icon: Store,
    ownerOnly: true,
    implemented: true,
  },
  {
    href: "/admin/settings/display",
    label: "表示設定",
    icon: Palette,
    ownerOnly: true,
    implemented: true,
  },
];

type Props = {
  salonName: string;
  /** ログイン中スタッフのロール。未紐付け・不明なら null(設定グループを出さない) */
  role: StaffRole | null;
  /** 下部のミニ集計(今日の予約件数・LINEプッシュバー)。後続タスクが埋める */
  miniSummary?: React.ReactNode;
};

export function AdminSidebar({ salonName, role, miniSummary }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
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
        // Next のリダイレクトのエラーで reject されるので、Next に投げ返す
        unstable_rethrow(error);
        // 応答が壊れたとき。別の端末で先にログアウトしていてセッションが既に無効だと、
        // Server Action の POST を middleware.ts がログイン画面へリダイレクトし、
        // Server Action は実行されない。ログインは切れているのでログイン画面が正しい
        // 行き先。まだログイン中なら middleware.ts が /admin に戻すので害はない
        router.replace("/admin/login");
        router.refresh();
        return;
      }
      setErrorMessage(result.message);
    });
  };

  const renderLink = ({ href, label, icon: Icon }: SidebarNavItem) => {
    const active = isAdminNavActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        onClick={() => setIsOpen(false)}
        className={cn(
          "flex h-11 items-center gap-3 rounded-xl px-4 text-base font-medium transition-colors",
          // hover はサイドバーの地(--sidebar #f4f2ec)を少し濃くする。--muted(#f7f6f3)は
          // サイドバーの地より明るく、濃さの変化が逆になるため使わない。
          // スマホの展開メニュー(白地)でも同じ色で、白より濃くなる
          active
            ? "bg-primary font-bold text-primary-foreground"
            : "text-foreground hover:bg-[color-mix(in_oklch,var(--sidebar),var(--foreground)_5%)]",
        )}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {label}
      </Link>
    );
  };

  const mainItems = visibleAdminNavItems(NAV_ITEMS, role);
  const settingsItems = visibleAdminNavItems(SETTINGS_NAV_ITEMS, role);

  const navigation = (
    <nav aria-label="管理画面ナビゲーション" className="flex flex-col gap-1">
      {mainItems.map(renderLink)}
      {/* 設定グループ。オーナー以外、および実装済みの項目が無いあいだは描画しない */}
      {settingsItems.length > 0 && (
        <div className="mt-4 flex flex-col gap-1">
          <p className="px-4 pb-1 text-xs font-bold tracking-widest text-muted-foreground">
            設定
          </p>
          {settingsItems.map(renderLink)}
        </div>
      )}
    </nav>
  );

  const footer = (
    <div className="flex flex-col gap-3">
      {/* ミニ集計スロット(今日の予約件数・LINEプッシュ n/200 バー)。
          後続タスク(カレンダー)がここを埋める。モックB どおり、サイドバーの
          地(--sidebar)の上に白いカード+細い枠で置く(スマホの展開メニューでも
          同じカードを使う。白地の上でも枠で区切りが分かる) */}
      {miniSummary !== undefined && miniSummary !== null && (
        <div className="rounded-xl border border-sidebar-border bg-card p-4">
          {miniSummary}
        </div>
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
        // hover はナビの項目と同じ(サイドバーの地を少し濃くする)
        className="flex h-11 items-center gap-3 rounded-xl px-4 text-base text-muted-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--sidebar),var(--foreground)_5%)] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
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

      {/* PC/タブレット幅: 常時表示のサイドバー。地と右の境界線はモックB の
          ニュートラル(--sidebar / --sidebar-border。globals.css)。スマホ幅の
          ヘッダーバー・展開メニューは白(bg-card)のまま */}
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-4 md:flex">
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
