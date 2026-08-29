import { runStoreContract } from "./store.contract";
import { localStore } from "../lib/store.local";
import { clearMemoryStorage, storage } from "../lib/storage";
import type { Trip } from "../lib/types";

runStoreContract({
  label: "TripStore / localStorage 実装",
  async setup() {
    return localStore;
  },
  async reset() {
    clearMemoryStorage(); // 端末IDごと白紙に戻す
  },
  async join(trip, label = "テスト") {
    const id = crypto.randomUUID();
    const kv = storage();
    const trips = JSON.parse(kv.getItem("dochu:trips") ?? "[]") as Trip[];
    const t = trips.find((x) => x.id === trip.id);
    if (!t) throw new Error("trip not found");
    t.members.push({ id, label, isHost: false, staminaFactor: 1 });
    kv.setItem("dochu:trips", JSON.stringify(trips));
    return { id, vote: (roundId, opts) => localStore.castVetoes(roundId, id, opts) };
  },
});
