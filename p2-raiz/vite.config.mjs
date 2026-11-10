// vite.config.mjs — 👀 ya está hecho. Cuatro páginas; SASS para tres de ellas y Tailwind para la de contacto.
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  css: { devSourcemap: true }, // F12 muestra el .scss y la línea de cada regla
  build: {
    rollupOptions: {
      input: {
        inicio: "index.html",
        producto: "producto.html",
        contacto: "contacto.html",
        creditos: "creditos.html",
      },
    },
  },
  // server: { watch: { usePolling: true } },  // solo si al guardar no se actualiza (Docker Desktop en Windows)
});
