import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // モックの<button>はすべて font-weight:700・枠1.5pxなので、ベースをそれに合わせる(個別の font-bold 指定は不要)
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border-[1.5px] border-transparent bg-clip-padding text-sm font-bold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        // モックのアウトラインはどれも地が白(#fff)で、色は3系統ある。
        // outline はニュートラル(戻る・変更・キャンセルなど): 枠 #d5d2ca・文字 #5b6270。
        // 枠は入力欄と同じ --input、文字は --muted-foreground(白地で 5.54:1)で近似する
        outline:
          "border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        // テーマ色のアウトライン(カテゴリを編集・マイ予約を見る・＋ 追加など):
        // 枠=テーマ色、文字=テーマ色の濃い側(--primary そのままだと白地で 4.38:1 で
        // AA に届かないため)。hover しても文字色は保つ
        "outline-accent":
          "border-primary bg-card text-primary-strong hover:bg-muted hover:text-primary-strong aria-expanded:bg-muted aria-expanded:text-primary-strong",
        // 破壊的なアウトライン(予約のキャンセルなど): 枠=--destructive の淡い側、
        // 文字=--destructive(白地で 4.71:1)。hover はうっすら色がつく程度にとどめる
        // (地の濃さ 3% で 4.53:1。5% にすると 4.41:1 で AA を割る)
        "outline-destructive":
          "border-destructive-soft bg-card text-destructive hover:bg-destructive/3 aria-expanded:bg-destructive/3",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        // 破壊的な操作の確定(「キャンセルする」など): モックどおり --destructive(#c0503f)の
        // 塗りに白文字(4.71:1)。hover は薄めると白文字が AA を割る(/90 で 3.99:1)ので、
        // 黒へ10%寄せて濃くする(5.96:1)
        destructive:
          "bg-destructive text-white hover:bg-[color-mix(in_oklab,var(--destructive),black_10%)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
