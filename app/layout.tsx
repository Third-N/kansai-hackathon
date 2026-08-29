import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DemoBar } from "@/components/DemoBar";

export const metadata: Metadata = {
  title: "道中",
  description: "1日に5回しか呼ばない、旅のあいだのアプリ",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e4e8eb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="shell">{children}</div>
        <DemoBar />
      </body>
    </html>
  );
}
