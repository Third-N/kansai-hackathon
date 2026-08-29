import type { MetadataRoute } from "next";

/* iOS はホーム画面に追加しないと Push が飛ばない。
   通知を使うなら、この manifest とアイコンが前提になる。 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "道中",
    short_name: "道中",
    description: "1日に5回しか呼ばない、旅のあいだのアプリ",
    start_url: "/",
    display: "standalone",
    background_color: "#e4e8eb",
    theme_color: "#e4e8eb",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
