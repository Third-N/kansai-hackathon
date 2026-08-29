"use client";
/* この端末を表す ID。ログインを入れていないので、これが唯一の身元。
   「せーの」で票を出すのも、自分の道中を引くのも、このIDで行う。
   app/trip/[id]/decide/[roundId] が使っていたものをここに集約した。 */
import { storage } from "./storage";
const MEMBER_KEY = "dochu:me";
export function myMemberId() {
    const kv = storage();
    let id = kv.getItem(MEMBER_KEY);
    if (!id) {
        id = crypto.randomUUID();
        kv.setItem(MEMBER_KEY, id);
    }
    return id;
}
/** テストと、端末を作り直したいときに使う */
export function setMyMemberId(id) {
    storage().setItem(MEMBER_KEY, id);
}
