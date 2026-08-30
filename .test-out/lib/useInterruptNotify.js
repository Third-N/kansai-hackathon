"use client";
import { useEffect, useRef } from "react";
/* ============================================================
   企画書の「iOS で Push が鳴らない」対策の3つ目。
   画面内の割り込み（保険2）・ホスト大画面（保険1）に続くもの。

   本物のPush通知ではない。サーバーから起こすものではなく、
   この端末でこのタブが動いている間だけ、条件が来たときに
   端末のNotification（と振動）を鳴らす。画面をずっと見ていない
   （でもタブは開いたまま）ときの気づきにはなる。

   通知の許可は、実際に割り込みが出るタイミングで一度だけ聞く。
   ホーム画面に開いた瞬間に聞かない（唐突な許可ダイアログは
   離脱を招く）。拒否・非対応ブラウザでは、今まで通り画面内の
   割り込みだけで動く（何も壊れない）。
   ============================================================ */
/** 実際に鳴らす部分。フックからも、デモ操作卓の「試す」ボタンからも呼ぶ */
export function fireInterruptNotification(title, body) {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }
    if (typeof Notification === "undefined")
        return;
    const notify = () => {
        try {
            new Notification(title, { body, tag: "dochu-interrupt" });
        }
        catch {
            // 非対応・非HTTPS等。振動とバナーだけで済ませる
        }
    };
    if (Notification.permission === "granted") {
        notify();
    }
    else if (Notification.permission === "default") {
        void Notification.requestPermission().then((perm) => {
            if (perm === "granted")
                notify();
        });
    }
}
export function useInterruptNotify(active, title, body) {
    const firedFor = useRef(null);
    useEffect(() => {
        if (!active) {
            firedFor.current = null;
            return;
        }
        const key = `${title}|${body}`;
        if (firedFor.current === key)
            return;
        firedFor.current = key;
        fireInterruptNotification(title, body);
    }, [active, title, body]);
}
