// LINE Webhook の受け口(M5 予約確認の応答メッセージ)。配線に徹する。
// 署名検証 → 定型文のメッセージイベントだけ選ぶ → userId で DB から直近の予約を引く
// → 応答メッセージ(無料)で予約内容を返す。判断は src/lib/line-webhook.ts・line-messages.ts。
//
// - 署名が合わなければ 401 で何もしない。それ以外は LINE に常に 200 を返す
//   (処理中のエラーは console.error して 200。疎通確認の events: [] も 200)
//   Messaging API リファレンス「Webhook」: 受信したらステータスコード 200 を返す
// - 応答内容は DB の値だけで作る(定型文は「応答してよい合図」にすぎない)
// - 対象の予約が無ければ何もしない(店とのふだんのチャットに任せる)

import {
  buildBookingConfirmationText,
  isConfirmationTrigger,
  myPageUrl,
} from "@/lib/line-messages";
import {
  pickConfirmationEvents,
  pickRecentReservation,
  verifyLineSignature,
  type ConfirmationEvent,
} from "@/lib/line-webhook";
import { replyMessage } from "@/server/line-messaging";
import {
  getRecentReservationsForLineUser,
  getSalonName,
} from "@/server/line-webhook-data";

export async function POST(request: Request): Promise<Response> {
  // 環境変数の欠落はサーバー設定ミスなので例外にする(line.ts と同じ扱い)
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    throw new Error("環境変数 LINE_CHANNEL_SECRET が設定されていません");
  }

  // 署名は受け取った本文の文字列そのものに対して計算されている(パースし直さない)
  const body = await request.text();
  const signature = request.headers.get("x-line-signature") ?? "";
  if (!(await verifyLineSignature(body, signature, channelSecret))) {
    return new Response(null, { status: 401 });
  }

  try {
    const events = pickConfirmationEvents(
      JSON.parse(body),
      isConfirmationTrigger,
    );
    if (events.length > 0) {
      await replyToConfirmations(events);
    }
  } catch (error) {
    console.error("LINE Webhook の処理に失敗しました", error);
  }
  return new Response(null, { status: 200 });
}

/** 定型文イベントごとに応答する。1件の失敗が他のイベントの応答を止めないようにする */
async function replyToConfirmations(
  events: ConfirmationEvent[],
): Promise<void> {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    throw new Error("環境変数 NEXT_PUBLIC_LIFF_ID が設定されていません");
  }
  const salonName = await getSalonName();
  const now = new Date();

  await Promise.all(
    events.map(async (event) => {
      try {
        const reservation = pickRecentReservation(
          await getRecentReservationsForLineUser(event.userId, now),
          now,
        );
        if (reservation === null) return;

        const result = await replyMessage(
          event.replyToken,
          buildBookingConfirmationText({
            kind: event.kind,
            start: reservation.start,
            staffName: reservation.staffName,
            menus: reservation.menus,
            salonName,
            myPageUrl: myPageUrl(liffId),
          }),
        );
        if (!result.ok) {
          console.error(
            `予約確認の応答に失敗しました(HTTP ${result.status ?? "応答なし"}): ${result.message}`,
          );
        }
      } catch (error) {
        console.error("予約確認の応答の処理に失敗しました", error);
      }
    }),
  );
}
