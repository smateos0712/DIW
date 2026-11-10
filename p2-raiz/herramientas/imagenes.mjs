// imagenes.mjs — 👀 YA HECHO. Genera las imágenes de la web a partir de las fotos originales de fuentes/.
//   docker compose run --rm web npm run imagenes
//
// Para cada foto, tres anchos (480, 960 y 1440 px) en tres formatos: AVIF (el más ligero), WebP y JPG (el que
// entienden todos los navegadores). Salen en public/img/: nombre-480.avif, nombre-480.webp, nombre-480.jpg…
// Lee la UD6 (apartados 3 y 4): por qué cada formato y por qué varios anchos.
import sharp from "sharp";
import { mkdirSync, readdirSync, statSync } from "node:fs";

const ANCHOS = [480, 960, 1440];
const FORMATOS = {
  avif: (img) => img.avif({ quality: 50 }),
  webp: (img) => img.webp({ quality: 75 }),
  jpg: (img) => img.jpeg({ quality: 78, mozjpeg: true }),
};

mkdirSync("public/img", { recursive: true });
let total = 0;
for (const fichero of readdirSync("fuentes").filter((f) => f.endsWith(".jpg"))) {
  const nombre = fichero.replace(/\.jpg$/, "");
  const linea = [];
  for (const ancho of ANCHOS) {
    for (const [ext, convertir] of Object.entries(FORMATOS)) {
      const salida = `public/img/${nombre}-${ancho}.${ext}`;
      await convertir(sharp(`fuentes/${fichero}`).resize({ width: ancho })).toFile(salida);
      const kb = Math.round(statSync(salida).size / 1024);
      if (ancho === 960) linea.push(`${ext} ${kb} KB`);
      total++;
    }
  }
  const { width, height } = await sharp(`fuentes/${fichero}`).metadata();
  console.log(`✔ ${nombre.padEnd(11)} ${width}×${height} → a 960 px: ${linea.join(" · ")}`);
}
console.log(`\n${total} imágenes en public/img/. Proporción de cada foto: la de arriba (ancho×alto), para width y height.`);
