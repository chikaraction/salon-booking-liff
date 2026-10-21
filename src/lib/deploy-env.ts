// 本番ビルド前の環境変数チェック(純粋関数)。docs/milestone-6-plan.md「デプロイ前チェック」。
// NEXT_PUBLIC_* は next build 時にバンドルへ文字列として埋め込まれるので、
// ビルドの前段で「スタブが入っていない・必須の値が空でない」ことを確かめる。
// 配線は scripts/check-deploy-env.mjs(process.env を渡し、エラーなら終了コード1)。
//
// 注意: このファイルは scripts から Node のネイティブ型除去で直接読み込む。
// 型注釈以外の TypeScript 専用構文(enum・namespace・パラメータプロパティ等)と
// import を使わないこと(型除去で動かない・拡張子の解決が変わるため)。

export type DeployEnvIssue = {
  /** error はビルドを止める。warning は表示だけ */
  level: "error" | "warning";
  /** 対象の環境変数名 */
  name: string;
  /** 利用者向けの説明(日本語) */
  message: string;
};

/** ビルド時に必須の値(Workers Builds の Build variables に置く) */
const REQUIRED_AT_BUILD = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

/** 未設定・空文字・空白だけを「空」とみなす */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * 本番ビルドに使う環境変数を検査し、問題の一覧を返す(エラー → 警告の順)。
 * 問題がなければ空の配列。
 * SUPABASE_SERVICE_ROLE_KEY などの秘密は実行時の値で、ビルド時に無いのが正しいので見ない。
 */
export function checkDeployEnv(
  env: Record<string, string | undefined>,
): DeployEnvIssue[] {
  const errors: DeployEnvIssue[] = [];
  const warnings: DeployEnvIssue[] = [];

  if (!isBlank(env.NEXT_PUBLIC_LIFF_STUB)) {
    errors.push({
      level: "error",
      name: "NEXT_PUBLIC_LIFF_STUB",
      message:
        "NEXT_PUBLIC_LIFF_STUB が設定されています。本番ビルドでスタブを有効にしてはいけません(Build variables から削除してください)",
    });
  }

  for (const name of REQUIRED_AT_BUILD) {
    if (isBlank(env[name])) {
      errors.push({
        level: "error",
        name,
        message: `${name} が空です。ビルド時に埋め込まれる値なので、Build variables に設定してください`,
      });
    }
  }

  if (isBlank(env.NEXT_PUBLIC_LIFF_ID)) {
    warnings.push({
      level: "warning",
      name: "NEXT_PUBLIC_LIFF_ID",
      message:
        "NEXT_PUBLIC_LIFF_ID が空です。客側の画面は LINE から開いても本人確認できません(LIFF を作成したら Build variables に設定して再ビルドしてください)",
    });
  }

  return [...errors, ...warnings];
}
