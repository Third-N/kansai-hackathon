"use client";

/* ============================================================
   道中記の「写真はここに入ります」の中身。README「まだ無いもの」。

   サーバーへのアップロード基盤（Storageバケット等）を新たに
   用意する代わりに、端末側で十分小さく縮小してから trips.photos
   （jsonbの1列）にそのまま持たせる方式にした。localStorage実装・
   Supabase実装のどちらでも同じ形で動く（customSpotsと同じ発想）。

   縮小するのは、原寸のままだと数MBになり得て、jsonb列にもlocalStorageの
   容量にも厳しいため。長辺480pxのJPEGなら、たいてい数十KBに収まる。
   ============================================================ */

const MAX_DIMENSION = 480;
const JPEG_QUALITY = 0.55;

export function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像を読み込めませんでした"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("画像として開けませんでした"));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("この端末では画像を縮小できません"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
