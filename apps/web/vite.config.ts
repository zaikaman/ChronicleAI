import path from "node:path";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@chronicleai/schemas": path.resolve(__dirname, "../../packages/schemas/src"),
      "@chronicleai/config/chains": path.resolve(
        __dirname,
        "../../packages/config/src/chains.ts",
      ),
      "@chronicleai/config/client": path.resolve(
        __dirname,
        "../../packages/config/src/client-env.ts",
      ),
      "@chronicleai/config": path.resolve(__dirname, "../../packages/config/src"),
    },
  },
  build: {
    // es2022 is widely supported and skips older transform work
    target: "es2022",
    // reportCompressedSize is pure overhead on CI; size budgets checked via chunkSizeWarningLimit
    reportCompressedSize: false,
    sourcemap: false,
    cssCodeSplit: true,
    // Honest budget: warn when a chunk exceeds ~500 kB (was 1000, which hid bloat)
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        /**
         * P1-6: Stable vendor chunks for long-term caching and parallel download.
         * Keep route chunks free of heavy framework/web3 deps.
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          // React core — shared by every route
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react-vendor";
          }

          // Data layer
          if (id.includes("@tanstack/react-query") || id.includes("@tanstack/query-core")) {
            return "query-vendor";
          }

          // Motion / animation (home-heavy)
          if (id.includes("node_modules/motion/") || id.includes("node_modules/framer-motion/")) {
            return "motion-vendor";
          }

          // Smooth scroll (home-only path)
          if (id.includes("node_modules/lenis/")) {
            return "lenis-vendor";
          }

          // Wallet / web3 stack — large, only needed when wallet is loaded
          if (
            id.includes("node_modules/wagmi/") ||
            id.includes("node_modules/@wagmi/")
          ) {
            return "wallet-wagmi";
          }

          // Keep WalletConnect/Reown packages separate so a single package update
          // does not invalidate the whole wallet stack or recreate a mega-chunk.
          const normalizedId = id.replaceAll("\\", "/");
          const walletPackage = normalizedId.match(
            /node_modules\/(\@walletconnect|\@reown)\/([^/]+)/,
          );
          if (walletPackage?.[1] && walletPackage[2]) {
            return `wallet-${walletPackage[1].slice(1)}-${walletPackage[2]}`;
          }

          const viemCjsModule = normalizedId.match(
            /node_modules\/viem\/_cjs\/([^/]+)/,
          );
          if (viemCjsModule?.[1]) {
            if (
              viemCjsModule[1] === "actions" ||
              viemCjsModule[1] === "utils" ||
              viemCjsModule[1] === "errors" ||
              viemCjsModule[1] === "accounts"
            ) {
              return "wallet-viem-cjs-core";
            }
            return `wallet-viem-cjs-${viemCjsModule[1]}`;
          }

          if (normalizedId.includes("node_modules/@metamask/sdk/")) {
            return "wallet-metamask-sdk";
          }

          if (
            normalizedId.includes("node_modules/socket.io-client/") ||
            normalizedId.includes("node_modules/socket.io-parser/") ||
            normalizedId.includes("node_modules/engine.io-client/") ||
            normalizedId.includes("node_modules/engine.io-parser/") ||
            normalizedId.includes("node_modules/@socket.io/")
          ) {
            return "wallet-metamask-realtime";
          }

          if (
            normalizedId.includes("node_modules/cross-fetch/") ||
            normalizedId.includes("node_modules/openapi-fetch/") ||
            normalizedId.includes("node_modules/eventemitter2/") ||
            normalizedId.includes("node_modules/uuid/")
          ) {
            return "wallet-metamask-runtime";
          }

          if (normalizedId.includes("node_modules/@safe-global/")) {
            return "wallet-safe";
          }

          // Icons
          if (id.includes("node_modules/lucide-react/")) {
            return "icons-vendor";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
