import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "PoE2 Item Search",
        short_name: "PoE2 Search",
        description: "Item photo or text to stash regex and weighted-sum trade search.",
        theme_color: "#14161a",
        background_color: "#14161a",
        display: "standalone",
        start_url: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Shell + mod data + OCR worker/core/model, so Input -> Review -> Regex works offline.
        globPatterns: ["**/*.{js,css,html,json,png,svg,gz}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "index.html",
        // Never cache or intercept calls to the user's proxy / trade API.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
