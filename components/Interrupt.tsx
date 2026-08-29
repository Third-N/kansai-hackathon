"use client";
import type { InterruptCopy } from "@/lib/copy";

export function Interrupt({
  copy, onPrimary, onSecondary,
}: {
  copy: InterruptCopy;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <div className="interrupt" role="alert">
      <div className="interrupt__eyebrow">呼び出し</div>
      <p className="interrupt__title">{copy.title}</p>
      <p className="interrupt__body">{copy.body}</p>
      <div className="interrupt__actions">
        <button className="btn btn--primary" onClick={onPrimary}>{copy.primary}</button>
        <button className="btn btn--ghost" onClick={onSecondary}>{copy.secondary}</button>
      </div>
    </div>
  );
}
