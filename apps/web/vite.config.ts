import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@chronicleai/schemas": path.resolve(__dirname, "../../packages/schemas/src"),
      "@chronicleai/config": path.resolve(__dirname, "../../packages/config/src"),
      "@chronicleai/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  server: {
    port: 5173,
  },
});
