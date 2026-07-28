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
      "@chronicleai/config": path.resolve(__dirname, "../../packages/config/src"),
      "@chronicleai/config/chains": path.resolve(
        __dirname,
        "../../packages/config/src/chains.ts",
      ),
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
            id.includes("@rainbow-me/rainbowkit") ||
            id.includes("node_modules/wagmi/") ||
            id.includes("node_modules/@wagmi/") ||
            id.includes("node_modules/viem/") ||
            id.includes("node_modules/@walletconnect/") ||
            id.includes("node_modules/@reown/") ||
            id.includes("node_modules/@metamask/") ||
            id.includes("node_modules/@coinbase/") ||
            id.includes("node_modules/ox/")
          ) {
            return "web3-vendor";
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
