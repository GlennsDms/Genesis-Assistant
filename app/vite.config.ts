import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process es una variable global de Node.js
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  // Plugin de React: le dice a Vite cómo compilar archivos .tsx (JSX)
  plugins: [react()],

  // Opciones específicas de Tauri:
  clearScreen: false, // no borra la consola para que se vean los errores de Rust
  server: {
    port: 1420,       // Tauri espera exactamente este puerto
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"], // ignora cambios en el código Rust
    },
  },
}));
