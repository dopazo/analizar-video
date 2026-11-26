import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo, `npm run dev` y en otra terminal `uv run scripts/visor.py <video> --no-open`:
// Vite reenvía /api y /media al servidor Python.
const PY = process.env.VISOR_PY ?? "http://127.0.0.1:4810";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    // La UI compilada viaja dentro de la skill: el usuario no necesita Node.
    outDir: "../.claude/skills/analizar-video/visor",
    emptyOutDir: true,
    target: "es2022",
    // Un solo bundle a propósito: se sirve desde el disco local, no por red, y
    // dividirlo no acelera nada. React DOM y Media Chrome ya pasan los 500 kB.
    chunkSizeWarningLimit: 800,
  },
  server: {
    proxy: { "/api": PY, "/media": PY },
  },
});
