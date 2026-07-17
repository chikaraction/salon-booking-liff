// STEP 2: スタッフ選択。スタッフ2名+「どちらでも」の3択。表示のみ。

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { BookingStaff } from "@/server/booking-data";

export const STAFF_ROLE_LABELS = { owner: "オーナー", staff: "スタッフ" };

/** 「どちらでも」を表す選択値(actions.ts の StaffSelection と対応) */
export const ANY_STAFF = "any";

type Props = {
  staff: BookingStaff[];
  selection: string | null;
  onSelect: (selection: string) => void;
};

export function StepStaff({ staff, selection, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {staff.map((member) => (
        <StaffOption
          key={member.id}
          selected={selection === member.id}
          onSelect={() => onSelect(member.id)}
          title={`${member.name}(${STAFF_ROLE_LABELS[member.role]})`}
          description={member.bio ?? ""}
          avatar={
            member.photoUrl !== null ? (
              // 外部URLの写真のためnext/imageは使わない(ドメインが店舗運用で変わる)
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={member.photoUrl}
                alt=""
                className="size-14 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary text-xl font-bold text-secondary-foreground">
                {member.name.charAt(0)}
              </span>
            )
          }
        />
      ))}
      <StaffOption
        selected={selection === ANY_STAFF}
        onSelect={() => onSelect(ANY_STAFF)}
        title="どちらでも"
        description="空いているスタッフにお任せ"
        avatar={
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary">
            {/* ◎(二重サークル) */}
            <span className="flex size-6 items-center justify-center rounded-full border-2 border-muted-foreground/70">
              <span className="size-2.5 rounded-full border-2 border-muted-foreground/70" />
            </span>
          </span>
        }
      />
    </div>
  );
}

function StaffOption({
  selected,
  onSelect,
  title,
  description,
  avatar,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  avatar: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-24 w-full items-center gap-4 rounded-xl border bg-card p-4 text-left transition-colors",
        selected ? "border-primary" : "border-border",
      )}
    >
      {avatar}
      <span className="flex-1">
        <span className="block text-base font-bold">{title}</span>
        {description !== "" && (
          <span className="mt-1 block text-sm text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card",
        )}
      >
        {selected && <Check className="size-4" strokeWidth={3} />}
      </span>
    </button>
  );
}
