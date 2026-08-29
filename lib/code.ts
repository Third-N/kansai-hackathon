/* あいことば。語だけだと8通りしかなく、同じ会場で2組が同時に立てると必ずぶつかる。
   語＋2桁で800通り。声に出して伝えられる長さは保つ。
   増やしたくなったら WORDS を足すだけでよい。 */
export const CODE_WORDS = ["ひがし", "にし", "みなみ", "きた", "かも", "あらし", "きよ", "いなり"];

export function makeCode(): string {
  const w = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)];
  return `${w}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
}
