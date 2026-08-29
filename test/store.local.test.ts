import { runStoreContract } from "./store.contract";
import { localStore } from "../lib/store.local";
import { clearMemoryStorage } from "../lib/storage";

runStoreContract({
  label: "TripStore / localStorage 実装",
  async setup() {
    return localStore;
  },
  async reset() {
    clearMemoryStorage(); // 端末IDごと白紙に戻す
  },
});
