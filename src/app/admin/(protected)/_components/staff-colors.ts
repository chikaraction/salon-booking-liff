// スタッフの色分け(日表示の予約カード・週表示の凡例: モックB/B-2)。
// 色はデザイントークン(globals.css)のみを使い、スタッフの並び順
// (display_order)に応じて循環させる。店舗固有値は持たない(ADR-007)。

export type StaffColor = {
  /** 凡例の色見本(■) */
  legend: string;
  /** 予約カード(左ボーダー+淡色背景) */
  card: string;
};

const STAFF_COLORS: StaffColor[] = [
  {
    legend: "bg-primary",
    card: "border-l-primary bg-accent text-accent-foreground",
  },
  {
    legend: "bg-chart-2",
    card: "border-l-chart-2 bg-muted text-foreground",
  },
  {
    legend: "bg-chart-3",
    card: "border-l-chart-3 bg-secondary text-secondary-foreground",
  },
];

/** スタッフの表示順(index)から色分けを決める(スタッフ数分を循環) */
export function staffColor(index: number): StaffColor {
  return STAFF_COLORS[index % STAFF_COLORS.length];
}
