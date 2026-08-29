"use client";
import type { InterruptCopy } from "@/lib/copy";

/* variant:
 *   card   … 画面の中のカード。既定
 *   lock   … ロック画面風のバナー。iOS で Push が鳴らない当日の代わり（企画書の保険2）
 * 見た目だけの違いで、中身も操作も同じ。 */
export type InterruptVariant = "card" | "lock";

export function Interrupt({
  copy, onPrimary, onSecondary, variant = "card", at,
}: {
  copy: InterruptCopy;
  onPrimary: () => void;
  onSecondary: () => void;
  variant?: InterruptVariant;
  /** ロック画面風のときに右上へ出す時刻 */
  at?: string;
}) {
  return (
    <div className={`interrupt interrupt--${variant}`} role="alert">
      <div className="interrupt__eyebrow">
        <span>呼び出し</span>
        {variant === "lock" && at && <span className="interrupt__at">{at}</span>}
      </div>
      <p className="interrupt__title">{copy.title}</p>
      <p className="interrupt__body">{copy.body}</p>
      <div className="interrupt__actions">
        <button className="btn btn--primary" onClick={onPrimary}>{copy.primary}</button>
        <button className="btn btn--ghost" onClick={onSecondary}>{copy.secondary}</button>
      </div>
    </div>
  );
}
