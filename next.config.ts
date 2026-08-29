import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/* このリポジトリの外（~/Downloads など）に package-lock.json があると、
   Turbopack がそちらを親だと思って警告を出す。ここを明示して黙らせる。 */
const nextConfig: NextConfig = {
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
