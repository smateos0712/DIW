// comprobar.mjs — El comprobador de la práctica 2 (RAÍZ). Se lanza con:
//     docker compose run --rm web npm run comprobar          (todo)
//     docker compose run --rm web npm run comprobar -- b     (solo el bloque B)
// Compila tu SCSS, lee el CSS que sale y tus páginas HTML, y te dice qué está bien y qué falta. NO te da la solución.
// Las comprobaciones 👀 son de lo que ya está hecho: no cuentan para la nota, pero si salen en rojo, has roto algo.
// Al final, la calidad: Stylelint y Prettier (cuentan aparte en la nota de cada bloque).
//
//   node comprobador/comprobar.mjs [a|b|c] [--json] [--sin-calidad]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes("--json");
const SIN_CALIDAD = ARGS.includes("--sin-calidad");
const SOLO = ARGS.find((a) => /^[abc]$/i.test(a))?.toUpperCase();
const color = process.stdout.isTTY && !JSON_OUT;
const c = (n, t) => (color ? `\x1b[${n}m${t}\x1b[0m` : t);
const leer = (f) => (existsSync(join(RAIZ, f)) ? readFileSync(join(RAIZ, f), "utf8") : "");

// ───────────── un parser de CSS mínimo (para el CSS «expanded» que genera Sass) ─────────────
function parsear(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  const decl = (t) => {
    const k = t.indexOf(":");
    return { tipo: "decl", prop: t.slice(0, k).trim().toLowerCase(), valor: t.slice(k + 1).trim() };
  };
  function bloque() {
    const nodos = [];
    let buf = "";
    while (i < css.length) {
      const ch = css[i++];
      if (ch === "{") {
        const cabeza = buf.trim();
        buf = "";
        if (cabeza.startsWith("@")) {
          const [, nombre, params] = cabeza.match(/^@([\w-]+)\s*(.*)$/s);
          nodos.push({ tipo: "at", nombre, params: params.trim(), hijos: bloque() });
        } else {
          const hijos = bloque();
          nodos.push({
            tipo: "regla",
            selectores: cabeza.split(",").map((s) => s.trim().replace(/\s+/g, " ")),
            decls: hijos.filter((h) => h.tipo === "decl"),
            hijos,
          });
        }
      } else if (ch === "}") {
        if (buf.trim()) nodos.push(decl(buf));
        return nodos;
      } else if (ch === ";") {
        if (buf.trim() && !buf.trim().startsWith("@")) nodos.push(decl(buf));
        buf = "";
      } else buf += ch;
    }
    return nodos;
  }
  return bloque();
}
function aplanar(nodos, ctx = [], salida = []) {
  for (const n of nodos) {
    if (n.tipo === "at") aplanar(n.hijos, [...ctx, n], salida);
    else if (n.tipo === "regla") salida.push({ ...n, ctx });
  }
  return salida;
}

// ───────────── compilar el SCSS (un CSS por fichero, para saber qué selector sale de dónde) ─────────────
let sass = null;
let errorCompilar = null;
let reglas = [];
let css = "";
const porFichero = {};
try {
  sass = await import("sass");
  css = sass.compile(join(RAIZ, "scss/main.scss"), { style: "expanded" }).css;
  reglas = aplanar(parsear(css));
  for (const f of readdirSync(join(RAIZ, "scss/components"))) {
    if (!f.endsWith(".scss")) continue;
    try {
      const uno = sass.compile(join(RAIZ, "scss/components", f), {
        style: "expanded",
        loadPaths: [join(RAIZ, "scss")],
      });
      porFichero[f] = { css: uno.css, reglas: aplanar(parsear(uno.css)) };
    } catch {
      porFichero[f] = { css: "", reglas: [] };
    }
  }
} catch (e) {
  errorCompilar = (e.message ?? String(e)).split("\n").slice(0, 6).join("\n");
}
const fuente = (f) =>
  leer(`scss/components/${f}`)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

// ───────────── utilidades CSS ─────────────
const esMedia = (r) => r.ctx.some((a) => a.nombre === "media");
const esContainer = (r) => r.ctx.some((a) => a.nombre === "container");
const minWidth = (a) => a.params.match(/min-width:\s*([\d.]+)(px|rem|em)/);
const enPx = (m) => (m ? Number(m[1]) * (m[2] === "px" ? 1 : 16) : null);
const sinContexto = (r) => !esMedia(r) && !esContainer(r);
const desde = (px) => (r) => r.ctx.some((a) => a.nombre === "media" && enPx(minWidth(a)) === px);
function valor(sel, prop, filtro = sinContexto, lista = reglas) {
  let v = null;
  for (const r of lista) {
    if (!r.selectores.includes(sel) || !filtro(r)) continue;
    for (const d of r.decls) if (d.prop === prop) v = d.valor;
  }
  return v;
}
const areas = (v) => (v ? [...v.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim().split(/\s+/)) : null);
const tokens = {};
for (const m of leer("scss/_tokens.scss").matchAll(/^\$([\w-]+):\s*([^;]+);/gm)) tokens[m[1]] = m[2].trim();
const resolver = (v) => (v?.startsWith("$") ? resolver(tokens[v.slice(1)]) : v);
const colorNorm = (v) => {
  let h = (v ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) h = "#" + [...h.slice(1)].map((x) => x + x).join("");
  return h;
};
const BP_MD = 600;
const BP_LG = 1000;

// ───────────── utilidades HTML (happy-dom: un navegador sin ventana) ─────────────
let Window = null;
try {
  ({ Window } = await import("happy-dom"));
} catch {
  /* sin node_modules: lo avisa más abajo */
}
const doms = {};
function dom(pagina) {
  if (!doms[pagina]) {
    const w = new Window();
    doms[pagina] = new w.DOMParser().parseFromString(leer(pagina), "text/html");
  }
  return doms[pagina];
}
const $ = (pagina, sel) => dom(pagina).querySelector(sel);
const $$ = (pagina, sel) => [...dom(pagina).querySelectorAll(sel)];
const clases = (el) => [...(el?.classList ?? [])];
const srcsetW = (s) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim().split(/\s+/)[1])
    .filter(Boolean);

// ───────────── las pruebas ─────────────
// [bloque, apartado, texto, función]: la función devuelve true (bien) o un texto con lo que falla.
// Apartado «👀»: lo que ya está hecho (no cuenta).
const PRUEBAS = [];
const p = (bloque, ap, texto, fn) => PRUEBAS.push({ bloque, ap, texto, fn });

// ====================== 👀 lo que ya está hecho ======================
p("0", "👀", "👀 El SCSS compila sin errores", () => (errorCompilar ? `Sass dice:\n${errorCompilar}` : true));
p(
  "0",
  "👀",
  "👀 La cabecera: columna en móvil y fila desde $bp-md (el ejemplo de Flexbox)",
  () =>
    (valor(".cabecera", "flex-direction") === "column" &&
      valor(".cabecera", "flex-direction", desde(BP_MD)) === "row") ||
    "Has tocado el ejemplo de _cabecera.scss",
);
p(
  "0",
  "👀",
  "👀 El botón en BEM: .boton, .boton--grande y .boton--secundario (el ejemplo de BEM)",
  () =>
    [".boton", ".boton--grande", ".boton--secundario"].every((s) => reglas.some((r) => r.selectores.includes(s))) ||
    "Has tocado el ejemplo de _boton.scss",
);
p("0", "👀", "👀 Las imágenes están generadas en public/img/ (docker compose run --rm web npm run imagenes)", () => {
  const hay = existsSync(join(RAIZ, "public/img")) ? readdirSync(join(RAIZ, "public/img")).length : 0;
  return hay >= 45 || `Hay ${hay} de 45: ejecuta docker compose run --rm web npm run imagenes`;
});

// ====================== A · Layout (UD4) ======================
const HIJOS = {
  ".cabecera": "cabecera",
  ".heroe": "heroe",
  ".principal": "principal",
  ".consejos": "consejos",
  ".pie": "pie",
};
p(
  "A",
  "A1",
  ".pagina es un grid con grid-template-areas (móvil, sin media query)",
  () =>
    (valor(".pagina", "display") === "grid" && areas(valor(".pagina", "grid-template-areas"))?.length > 0) ||
    "A .pagina le falta display: grid o grid-template-areas fuera de la media query",
);
p("A", "A1", "Móvil: una columna, en el orden cabecera / heroe / principal / consejos / pie", () => {
  const a = areas(valor(".pagina", "grid-template-areas"));
  if (!a) return "No encuentro grid-template-areas en la versión móvil";
  if (a.some((f) => f.length !== 1)) return "En móvil cada fila del mapa tiene UNA sola palabra";
  const orden = a.map((f) => f[0]).join(" / ");
  return orden === "cabecera / heroe / principal / consejos / pie" || `El orden es «${orden}»`;
});
p("A", "A1", "Desde $bp-md: dos columnas; «principal consejos» en la misma fila y el resto ocupa las dos", () => {
  const a = areas(valor(".pagina", "grid-template-areas", desde(BP_MD)));
  if (!a) return "No hay grid-template-areas dentro de @include desde($bp-md)";
  if (a.some((f) => f.length !== 2)) return "Cada fila del mapa de tablet tiene 2 palabras";
  const fila = a.find((f) => f.includes("principal"));
  if (!fila || fila.join(" ") !== "principal consejos") return "Falta la fila «principal consejos»";
  for (const n of ["cabecera", "heroe", "pie"])
    if (!a.some((f) => f[0] === n && f[1] === n)) return `«${n}» tiene que ocupar las dos columnas`;
  return true;
});
p("A", "A1", "Desde $bp-md: el principal se estira (fr) y los consejos miden un ancho fijo en rem", () => {
  const v = valor(".pagina", "grid-template-columns", desde(BP_MD)) ?? "";
  return /^\S*fr\s+[\d.]+rem$/.test(v) || `grid-template-columns es «${v || "nada"}»: algo como 1fr 16rem`;
});
p("A", "A1", "Cada hijo de .pagina tiene su grid-area con un nombre del mapa", () => {
  const nombres = new Set((areas(valor(".pagina", "grid-template-areas")) ?? []).flat());
  const mal = Object.keys(HIJOS).filter((sel) => !nombres.has(valor(sel, "grid-area", () => true)));
  return mal.length === 0 || `Sin grid-area válida: ${mal.join(", ")}`;
});
p("A", "A1", "Desde $bp-lg: la página no pasa de un máximo y se centra", () => {
  const max = valor(".pagina", "max-width", desde(BP_LG));
  const centro = valor(".pagina", "margin-inline", desde(BP_LG)) === "auto";
  return (
    (max && /rem$/.test(max) && centro) || "Dentro de @include desde($bp-lg): max-width (en rem) y margin-inline: auto"
  );
});
p(
  "A",
  "A2",
  ".destacados es un grid con columnas automáticas: repeat(auto-fit o auto-fill, minmax(…))",
  () =>
    (valor(".destacados", "display") === "grid" &&
      /repeat\(\s*auto-(fit|fill)\s*,\s*minmax\(/.test(valor(".destacados", "grid-template-columns") ?? "")) ||
    "A .destacados le falta display: grid o grid-template-columns: repeat(auto-fit, minmax(…, 1fr))",
);
p(
  "A",
  "A2",
  "El mínimo de cada columna no desborda un móvil estrecho: minmax(min(…, 100%), 1fr)",
  () =>
    /minmax\(\s*min\(\s*[\d.]+rem\s*,\s*100%\s*\)\s*,\s*1fr\s*\)/.test(
      valor(".destacados", "grid-template-columns") ?? "",
    ) || "¿Qué pasa en un móvil de 320 px si la columna mínima es más ancha que la pantalla?",
);
p("A", "A2", "Hueco entre tarjetas con gap", () => {
  if (valor(".destacados", "display") !== "grid") return "Primero haz la rejilla";
  return !!valor(".destacados", "gap") || "Falta gap en .destacados";
});
p("A", "A2", "_destacados.scss no usa media queries", () => {
  if (valor(".destacados", "display") !== "grid") return "Primero haz la rejilla";
  return (
    !/@media|@include\s+desde/.test(fuente("_destacados.scss")) ||
    "Quita la media query: auto-fit ya decide cuántas columnas caben"
  );
});
p("A", "A3", ".hueco-ficha es el contenedor (container-type: inline-size), y no la propia .ficha", () => {
  if (valor(".ficha", "container-type", () => true))
    return "El contenedor no puede ser la propia .ficha: es su padre, .hueco-ficha";
  return (
    valor(".hueco-ficha", "container-type", () => true) === "inline-size" ||
    "Falta container-type: inline-size en .hueco-ficha"
  );
});
p("A", "A3", "Fuera de la @container, la .ficha va en una columna", () => {
  const cols = valor(".ficha", "grid-template-columns");
  const dir = valor(".ficha", "flex-direction");
  const disp = valor(".ficha", "display");
  if (!["grid", "flex"].includes(disp)) return "La .ficha tiene que ser grid (o flex en columna)";
  return (
    (disp === "grid" ? !cols || cols.trim().split(/\s+/).length === 1 : dir === "column") ||
    "Sin @container, una sola columna"
  );
});
p("A", "A3", "Con @container (min-width: …rem), la .ficha pasa a dos columnas", () => {
  const r = reglas.filter((x) => esContainer(x) && x.selectores.includes(".ficha"));
  if (!r.length) return "No hay ninguna @container con .ficha dentro";
  if (!r.some((x) => x.ctx.some((a) => a.nombre === "container" && /min-width:\s*[\d.]+rem/.test(a.params))))
    return "La container query mide en rem: @container (min-width: 36rem)";
  return (
    r.some((x) =>
      x.decls.some(
        (d) =>
          (d.prop === "grid-template-columns" && d.valor.trim().split(/\s+/).length === 2) ||
          (d.prop === "flex-direction" && d.valor === "row"),
      ),
    ) || "Dentro de la @container, .ficha necesita dos columnas (grid-template-columns) o flex-direction: row"
  );
});
p("A", "A4", "El título de la portada es fluido: clamp(mín en rem, rem + vw, máx en rem)", () => {
  const v = (valor(".heroe__titulo", "font-size") ?? "").replace(/\s+/g, " ");
  const m = v.match(/^clamp\(([\d.]+)rem, ?[\d.]+rem \+ [\d.]+vw, ?([\d.]+)rem\)$/);
  if (!m) return `El font-size de .heroe__titulo es «${v || "nada"}»: clamp(MÍN, ?rem + ?vw, MÁX)`;
  return Number(m[1]) < Number(m[2]) || "El mínimo tiene que ser menor que el máximo";
});
p(
  "A",
  "A4",
  "El relleno del principal y de los consejos también es fluido (clamp)",
  () =>
    [".principal", ".consejos"].every((s) =>
      /^clamp\(/.test(valor(s, "padding") ?? valor(s, "padding-inline") ?? ""),
    ) || "padding de .principal y .consejos con clamp(…)",
);
const PROPS = [
  "--color-fondo",
  "--color-superficie",
  "--color-texto",
  "--color-marca",
  "--color-marca-fuerte",
  "--color-sobre-marca",
  "--color-acento",
];
const raiz = (filtro) => {
  const v = {};
  for (const r of reglas) if (r.selectores.includes(":root") && filtro(r)) for (const d of r.decls) v[d.prop] = d.valor;
  return v;
};
const oscuro = (r) => r.ctx.some((a) => a.nombre === "media" && /prefers-color-scheme:\s*dark/.test(a.params));
const impresion = (r) => r.ctx.some((a) => a.nombre === "media" && /^print/.test(a.params));
p("A", "A5", "El tema claro: :root define las 7 custom properties de color con los tokens", () => {
  const v = raiz(sinContexto);
  const faltan = PROPS.filter((x) => !v[x]);
  if (faltan.length) return `Faltan en :root: ${faltan.join(", ")}`;
  const esperado = {
    "--color-fondo": "color-surface-alt",
    "--color-superficie": "color-surface",
    "--color-texto": "color-text",
    "--color-marca": "color-brand-primary",
    "--color-marca-fuerte": "color-brand-strong",
    "--color-sobre-marca": "color-on-brand",
    "--color-acento": "color-accent",
  };
  const mal = PROPS.filter((x) => colorNorm(v[x]) !== colorNorm(resolver(tokens[esperado[x]])));
  return mal.length === 0 || `No valen lo que su token: ${mal.join(", ")} (usa #{$token})`;
});
p(
  "A",
  "A5",
  "color-scheme: light dark en :root",
  () => raiz(sinContexto)["color-scheme"] === "light dark" || "Falta color-scheme: light dark en :root",
);
p("A", "A5", "El tema oscuro: @media (prefers-color-scheme: dark) redefine las 7 con los tokens oscuros", () => {
  const v = raiz(oscuro);
  const faltan = PROPS.filter((x) => !v[x]);
  if (faltan.length === PROPS.length) return "No hay ningún :root dentro de @media (prefers-color-scheme: dark)";
  if (faltan.length) return `Faltan en el tema oscuro: ${faltan.join(", ")}`;
  const claro = raiz(sinContexto);
  const iguales = PROPS.filter((x) => colorNorm(v[x]) === colorNorm(claro[x]));
  return iguales.length === 0 || `Valen lo mismo que en el claro: ${iguales.join(", ")}`;
});
p("A", "A5", "Al imprimir: fuera la navegación y los botones", () => {
  const ocultos = reglas
    .filter((r) => impresion(r) && r.decls.some((d) => d.prop === "display" && d.valor === "none"))
    .flatMap((r) => r.selectores);
  return (
    (ocultos.includes(".cabecera__nav") && ocultos.includes(".boton")) ||
    "Dentro de @media print: .cabecera__nav y .boton con display: none"
  );
});
p("A", "A", "Mobile-first: ninguna media query con max-width, y los breakpoints salen de $bp-md y $bp-lg", () => {
  if (/@media[^{]*max-width/.test(css)) return "Hay una @media con max-width";
  const bps = new Set(
    reglas.flatMap((r) => r.ctx.filter((a) => a.nombre === "media" && minWidth(a)).map((a) => enPx(minWidth(a)))),
  );
  const raros = [...bps].filter((b) => b !== BP_MD && b !== BP_LG);
  return raros.length === 0 || `Breakpoints escritos a mano: ${raros.join(", ")} px. Usa $bp-md y $bp-lg`;
});

// ====================== B · Arquitectura CSS (UD5) ======================
const TARJETAS = () => $$("index.html", ".destacados > article");
p("B", "B1", "Las 6 tarjetas de .destacados son bloques .tarjeta-planta", () => {
  const t = TARJETAS();
  if (t.length !== 6) return `En .destacados hay ${t.length} <article> (tienen que seguir siendo 6)`;
  const mal = t.filter((a) => !a.classList.contains("tarjeta-planta"));
  return mal.length === 0 || `${mal.length} sin la clase tarjeta-planta`;
});
p("B", "B1", "Sus elementos: __imagen, __nombre, __descripcion, __precio y __boton en las 6", () => {
  const faltas = [];
  TARJETAS().forEach((a, i) => {
    for (const [sel, el] of [
      ["img", "imagen"],
      ["h3", "nombre"],
      ["button", "boton"],
    ])
      if (!a.querySelector(sel)?.classList.contains(`tarjeta-planta__${el}`))
        faltas.push(`${i + 1}ª: <${sel}> sin tarjeta-planta__${el}`);
    const ps = [...a.querySelectorAll("p")];
    const precio = ps.find((x) => /€/.test(x.textContent));
    if (!precio?.classList.contains("tarjeta-planta__precio"))
      faltas.push(`${i + 1}ª: el precio sin tarjeta-planta__precio`);
    const desc = ps.find((x) => !/€|Oferta|Agotada/.test(x.textContent));
    if (!desc?.classList.contains("tarjeta-planta__descripcion"))
      faltas.push(`${i + 1}ª: la descripción sin tarjeta-planta__descripcion`);
  });
  return faltas.length === 0 || faltas.slice(0, 3).join("\n");
});
p("B", "B1", "La etiqueta («Oferta…» o «Agotada») es tarjeta-planta__etiqueta", () => {
  const ps = TARJETAS()
    .flatMap((a) => [...a.querySelectorAll("p")])
    .filter((x) => /Oferta|Agotada/.test(x.textContent));
  if (ps.length !== 3) return `Hay ${ps.length} etiquetas (tienen que ser 3: dos ofertas y una agotada)`;
  return (
    ps.every((x) => x.classList.contains("tarjeta-planta__etiqueta")) || "Alguna etiqueta sin tarjeta-planta__etiqueta"
  );
});
p("B", "B1", "Los modificadores: --oferta en las 2 de oferta, --agotada en la agotada, y en las demás ninguno", () => {
  const mal = TARJETAS().filter((a) => {
    const txt = a.textContent;
    return (
      a.classList.contains("tarjeta-planta--oferta") !== /Oferta/.test(txt) ||
      a.classList.contains("tarjeta-planta--agotada") !== /Agotada/.test(txt)
    );
  });
  return mal.length === 0 || `Revisa: ${mal.map((a) => a.querySelector("h3")?.textContent.trim()).join(", ")}`;
});
p("B", "B1", 'El modificador va JUNTO al bloque (class="tarjeta-planta tarjeta-planta--oferta")', () => {
  const mods = $$("index.html", "[class*='tarjeta-planta--']");
  if (!mods.length) return "Aún no hay ningún modificador tarjeta-planta--…";
  return (
    mods.every((e) => e.classList.contains("tarjeta-planta")) ||
    "Un modificador no va solo: el elemento lleva el bloque Y el modificador"
  );
});
p(
  "B",
  "B1",
  "Los botones son un «mix»: boton + tarjeta-planta__boton",
  () =>
    TARJETAS().every((a) => a.querySelector("button")?.classList.contains("boton")) ||
    "El botón de cada tarjeta lleva las dos clases: boton tarjeta-planta__boton",
);
const selsDe = (f) => (porFichero[f]?.reglas ?? []).flatMap((r) => r.selectores);
p("B", "B1", "_tarjeta-planta.scss da estilo al bloque, a 4 elementos o más y a los dos modificadores", () => {
  const s = new Set(selsDe("_tarjeta-planta.scss").flatMap((x) => x.match(/\.tarjeta-planta[\w-]*/g) ?? []));
  const elems = [...s].filter((x) => x.includes("__")).length;
  const faltan = [".tarjeta-planta", ".tarjeta-planta--oferta", ".tarjeta-planta--agotada"].filter((x) => !s.has(x));
  if (faltan.length) return `Faltan reglas para: ${faltan.join(", ")}`;
  return elems >= 4 || `Solo das estilo a ${elems} elementos`;
});
p("B", "B1", "--agotada se nota: la imagen en gris (filter) y el botón desactivado no se puede pulsar", () => {
  const r = porFichero["_tarjeta-planta.scss"]?.reglas ?? [];
  const gris = r.some(
    (x) =>
      x.selectores.some((s) => /tarjeta-planta--agotada/.test(s)) &&
      x.decls.some((d) => d.prop === "filter" && /grayscale/.test(d.valor)),
  );
  const dis = $$("index.html", ".tarjeta-planta--agotada button[disabled]").length === 1;
  return (
    (gris && dis) ||
    (!gris ? "Con --agotada, la imagen con filter: grayscale(…)" : "El botón de la agotada, con el atributo disabled")
  );
});
const especificidadPlana = (f, bloque) => {
  const malos = selsDe(f).filter((s) => {
    const sinPseudo = s.replace(/:{1,2}[\w-]+(\([^)]*\))?/g, "");
    const partes = sinPseudo.trim().split(/\s+/);
    if (/#|\[/.test(s)) return true;
    if (partes.length === 1) return !new RegExp(`^\\.${bloque}(__[a-z-]+|--[a-z-]+)?$`).test(partes[0]);
    if (partes.length === 2)
      return !(
        new RegExp(`^\\.${bloque}--[a-z-]+$`).test(partes[0]) && new RegExp(`^\\.${bloque}__[a-z-]+$`).test(partes[1])
      );
    return true;
  });
  return malos;
};
p(
  "B",
  "B1",
  "Especificidad plana en la tarjeta: una clase (o .bloque--mod .bloque__elem), sin etiquetas ni ids",
  () => {
    if (!selsDe("_tarjeta-planta.scss").length) return "_tarjeta-planta.scss aún no tiene reglas";
    const m = especificidadPlana("_tarjeta-planta.scss", "tarjeta-planta");
    return m.length === 0 || `Selectores que no son BEM plano: ${m.slice(0, 3).join(" · ")}`;
  },
);
p("B", "B2", "El boletín ya no tiene ids ni !important en su CSS", () => {
  const f = fuente("_boletin.scss");
  if (/!important/.test(f)) return "Queda un !important";
  return !selsDe("_boletin.scss").some((s) => s.includes("#")) || "Queda un selector con #id";
});
p("B", "B2", "Cada selector de _boletin.scss es una clase del bloque boletin (sin anidar etiquetas)", () => {
  const m = especificidadPlana("_boletin.scss", "boletin");
  return (
    (selsDe("_boletin.scss").length > 0 && m.length === 0) ||
    `Selectores que no son BEM: ${m.slice(0, 3).join(" · ") || "no hay ninguno"}`
  );
});
p("B", "B2", "El HTML del boletín: .boletin con __titulo, __formulario, __etiqueta, __campo y __nota", () => {
  const s = $("index.html", "section.boletin");
  if (!s) return "La <section> del boletín tiene que tener la clase boletin";
  const falta = [
    ["h2", "titulo"],
    ["form", "formulario"],
    ["label", "etiqueta"],
    ["input", "campo"],
    ["p", "nota"],
  ].filter(([t, e]) => !s.querySelector(t)?.classList.contains(`boletin__${e}`));
  return falta.length === 0 || `Sin su clase: ${falta.map(([t, e]) => `<${t}> → boletin__${e}`).join(", ")}`;
});
p("B", "B2", "En el HTML del boletín no quedan ids usados para dar estilo (#boletin, #enviar…)", () => {
  const s = $("index.html", "section.boletin");
  const ids = [...(s?.querySelectorAll("[id]") ?? [])]
    .map((e) => e.id)
    .filter((id) => !$("index.html", `[for="${id}"], [aria-labelledby="${id}"]`));
  return (
    (s && !s.id && ids.length === 0) || "Quita los id que solo servían al CSS (los de for/aria-labelledby sí se quedan)"
  );
});
p(
  "B",
  "B2",
  "El botón del boletín es un mix: boton boletin__boton",
  () =>
    ($("index.html", ".boletin button")?.classList.contains("boton") &&
      $("index.html", ".boletin button")?.classList.contains("boletin__boton")) ||
    'El botón: class="boton boletin__boton"',
);
const THEME = {
  "--color-marca": "color-brand-primary",
  "--color-marca-oscuro": "color-brand-strong",
  "--color-marca-suave": "color-brand-soft",
  "--color-tierra": "color-accent",
  "--color-texto": "color-text",
  "--color-fondo": "color-surface-alt",
};
const theme = () => {
  const m = leer("src/tailwind.css").match(/@theme\s*\{([^}]*)\}/);
  return m
    ? Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]))
    : null;
};
p("B", "B3", "@theme define los 6 colores de RAÍZ con los MISMOS valores que _tokens.scss", () => {
  const t = theme();
  if (!t) return "No hay @theme { … } en src/tailwind.css";
  const mal = Object.entries(THEME).filter(([k, tok]) => colorNorm(t[k]) !== colorNorm(resolver(tokens[tok])));
  return mal.length === 0 || `Faltan o no coinciden: ${mal.map(([k]) => k).join(", ")}`;
});
const clasesContacto = () => $$("contacto.html", "[class]").flatMap((e) => [...e.classList]);
p(
  "B",
  "B3",
  "contacto.html usa los colores del tema (bg-marca, text-marca-oscuro, border-marca…), 5 distintos o más",
  () => {
    const usados = new Set(
      clasesContacto()
        .map((k) => k.replace(/^[\w-]+:/, ""))
        .filter((k) => /^(bg|text|border|outline|ring)-(marca|marca-oscuro|marca-suave|tierra|texto|fondo)$/.test(k)),
    );
    return usados.size >= 5 || `Usas ${usados.size}: ${[...usados].join(", ") || "ninguno"}`;
  },
);
p("B", "B3", 'Sin valores sueltos: ni corchetes (bg-[#…], p-[13px]) ni style="" ni <style>', () => {
  if (!clasesContacto().length) return "contacto.html aún no tiene clases";
  const sueltas = clasesContacto().filter((k) => k.includes("["));
  if (sueltas.length) return `Valores sueltos: ${sueltas.slice(0, 3).join(" ")} (usa el tema o la escala)`;
  return $$("contacto.html", "[style], style").length === 0 || 'Hay un style="" o un <style>';
});
p(
  "B",
  "B3",
  "Mobile-first: desde md, el contenido pasa a dos columnas (md:grid-cols-2)",
  () =>
    clasesContacto().includes("md:grid-cols-2") || "Falta md:grid-cols-2 en el contenedor del vivero y el formulario",
);
p("B", "B3", "El botón de enviar tiene hover: y focus-visible:", () => {
  const b = $("contacto.html", "form button, form [type=submit]");
  const k = clases(b);
  return (
    (k.some((x) => x.startsWith("hover:")) && k.some((x) => x.startsWith("focus-visible:"))) ||
    "Al botón le faltan clases hover:… y focus-visible:…"
  );
});
p("B", "B3", "Tailwind compila y genera las clases del tema", () => {
  const bin = join(RAIZ, "node_modules/.bin/tailwindcss");
  if (!existsSync(bin)) return "Falta node_modules: docker compose run --rm web npm install";
  const tmp = mkdtempSync(join(tmpdir(), "tw-"));
  try {
    execFileSync(bin, ["-i", "src/tailwind.css", "-o", join(tmp, "out.css")], { cwd: RAIZ, stdio: "pipe" });
    const out = readFileSync(join(tmp, "out.css"), "utf8");
    return /\.bg-marca\s*\{/.test(out) || "Compila, pero no sale .bg-marca: ¿usas bg-marca en contacto.html?";
  } catch (e) {
    return `Tailwind no compila:\n${String(e.stderr ?? e.message)
      .split("\n")
      .slice(0, 4)
      .join("\n")}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
p("B", "B4", "GUIA-ESTILO.md tiene sus tres apartados: Tokens, Componentes y Convenciones", () => {
  const g = leer("GUIA-ESTILO.md");
  if (!g) return "Falta GUIA-ESTILO.md en la raíz del proyecto";
  const faltan = ["Tokens", "Componentes", "Convenciones"].filter((t) => !new RegExp(`^#+\\s*${t}`, "mi").test(g));
  return faltan.length === 0 || `Faltan los apartados: ${faltan.join(", ")}`;
});
p("B", "B4", "La guía documenta los 4 bloques (boton, tarjeta-planta, boletin, ficha) con sus modificadores", () => {
  const g = leer("GUIA-ESTILO.md");
  const faltan = [
    "boton",
    "tarjeta-planta",
    "boletin",
    "ficha",
    "tarjeta-planta--oferta",
    "tarjeta-planta--agotada",
    "boton--grande",
  ].filter((b) => !g.includes(b));
  return faltan.length === 0 || `No aparecen: ${faltan.join(", ")}`;
});

// ====================== C · Multimedia (UD6) ======================
const LIC = leer("fuentes/LICENCIAS.md")
  .split("\n")
  .filter((l) => /^\| `/.test(l))
  .map((l) => {
    const [, fichero, titulo, autor, fuenteUrl, licencia] = l.split("|").map((x) => x.trim());
    return {
      fichero: fichero.replace(/`/g, ""),
      titulo,
      autor,
      fuente: fuenteUrl,
      licencia: licencia.split("—")[0].trim(),
      url: licencia.split("—")[1]?.trim(),
    };
  });
const heroeImg = () => $("index.html", ".heroe picture img");
p(
  "C",
  "C1",
  "La portada usa <picture> dentro de .heroe, con la img.heroe__imagen dentro",
  () =>
    heroeImg()?.classList.contains("heroe__imagen") ||
    'En .heroe: <picture> … <img class="heroe__imagen" …> </picture>',
);
p(
  "C",
  "C1",
  'Primero <source type="image/avif"> y después <source type="image/webp"> (el navegador elige el primero que entiende)',
  () => {
    const t = $$("index.html", ".heroe picture source").map((s) => s.getAttribute("type"));
    return t.join(",") === "image/avif,image/webp" || `Los <source> son: ${t.join(", ") || "ninguno"}`;
  },
);
p("C", "C1", "Cada <source> y la <img> ofrecen los 3 anchos (480w, 960w, 1440w) de su formato, con sizes", () => {
  const els = [...$$("index.html", ".heroe picture source"), heroeImg()].filter(Boolean);
  if (els.length < 3) return "Faltan los <source> o la <img>";
  for (const e of els) {
    const s = e.getAttribute("srcset") ?? "";
    const ext = e.tagName === "IMG" ? "jpg" : (e.getAttribute("type") ?? "").split("/")[1];
    if (srcsetW(s).join(",") !== "480w,960w,1440w")
      return `«${s || "sin srcset"}»: tres candidatos con 480w, 960w y 1440w`;
    if (
      !s.split(",").every((x) =>
        x
          .trim()
          .split(/\s+/)[0]
          .endsWith("." + ext),
      )
    )
      return `En el srcset de ${ext} hay ficheros de otro formato`;
    if (!e.getAttribute("sizes")) return "Falta sizes (la portada ocupa todo el ancho: 100vw)";
  }
  return true;
});
p(
  "C",
  "C1",
  "La <img> de la portada: src de reserva en JPG, width y height con la proporción de la foto (16:9)",
  () => {
    const i = heroeImg();
    if (!i) return "Primero el <picture> con la img.heroe__imagen dentro";
    const w = Number(i?.getAttribute("width"));
    const h = Number(i?.getAttribute("height"));
    if (!/\.jpg$/.test(i?.getAttribute("src") ?? "")) return "El src (para los navegadores antiguos) es un .jpg";
    if (!w || !h) return "Faltan width y height: sin ellos, la página «salta» al cargar la foto (CLS)";
    return Math.abs(w / h - 2400 / 1350) < 0.02 || `width/height = ${w}×${h}, pero la foto es 2400×1350`;
  },
);
p("C", "C1", 'La portada NO es lazy (es lo primero que se ve) y lleva fetchpriority="high"', () => {
  const i = heroeImg();
  if (!i) return "Primero el <picture> con la img.heroe__imagen dentro";
  if (i?.getAttribute("loading") === "lazy")
    return 'loading="lazy" en la portada retrasa lo más importante de la página (LCP)';
  return i?.getAttribute("fetchpriority") === "high" || 'Falta fetchpriority="high"';
});
p("C", "C1", "El alt de la portada describe la foto (no vale vacío, ni «imagen», ni el nombre del fichero)", () => {
  if (!heroeImg()) return "Primero el <picture> con la img.heroe__imagen dentro";
  const a = (heroeImg()?.getAttribute("alt") ?? "").trim();
  return (a.length >= 15 && !/imagen|foto|\.jpg|heroe/i.test(a)) || `alt=«${a}»: describe lo que se ve`;
});
const galeria = () => $$("producto.html", ".galeria img");
p("C", "C2", "La galería tiene las 4 fotos de la monstera, con la clase galeria__foto", () => {
  const g = galeria();
  return (
    (g.length === 4 && g.every((i) => i.classList.contains("galeria__foto"))) ||
    `Hay ${g.length} <img> en .galeria (4, con class="galeria__foto")`
  );
});
p("C", "C2", 'La primera foto se carga ya; las otras tres, loading="lazy"', () => {
  const g = galeria();
  if (g.length !== 4) return "Primero las 4 fotos";
  if (g[0].getAttribute("loading") === "lazy") return "La primera se ve nada más entrar: sin lazy";
  return g.slice(1).every((i) => i.getAttribute("loading") === "lazy") || 'La 2.ª, la 3.ª y la 4.ª, con loading="lazy"';
});
p("C", "C2", "Cada foto ofrece 2 anchos o más en WebP (srcset con w) y su sizes", () => {
  const mal = galeria().filter(
    (i) =>
      srcsetW(i.getAttribute("srcset")).length < 2 ||
      !/\.webp/.test(i.getAttribute("srcset") ?? "") ||
      !i.getAttribute("sizes"),
  );
  return (
    (galeria().length === 4 && mal.length === 0) || 'Cada <img>: srcset="…-480.webp 480w, …-960.webp 960w" y sizes'
  );
});
p(
  "C",
  "C2",
  "El sizes de la galería cuenta que desde $bp-md ocupa media pantalla",
  () =>
    galeria().every((i) => /\(min-width:\s*600px\)\s*50vw/.test(i.getAttribute("sizes") ?? "")) ||
    'sizes="(min-width: 600px) 50vw, 100vw": en tablet hay dos columnas',
);
p("C", "C2", "Cada foto: width y height (4:3) y un alt distinto que la describe", () => {
  const g = galeria();
  if (g.some((i) => Math.abs(Number(i.getAttribute("width")) / Number(i.getAttribute("height")) - 4 / 3) > 0.02))
    return "width y height con la proporción de la foto (1600×1200)";
  const alts = g.map((i) => (i.getAttribute("alt") ?? "").trim());
  if (alts.some((a) => a.length < 10)) return "Algún alt vacío o demasiado corto";
  return new Set(alts).size === 4 || "Los cuatro alt son distintos: cada foto enseña algo distinto";
});
p("C", "C3", 'El logo es un SVG con significado: role="img" y un <title>', () => {
  const s = $("index.html", ".cabecera__logo svg");
  return (
    (s?.getAttribute("role") === "img" && !!s.querySelector("title")?.textContent.trim()) ||
    'En .cabecera__logo: <svg role="img" …><title>RAÍZ</title>…'
  );
});
p("C", "C3", 'El icono del carrito es decorativo: aria-hidden="true", y el enlace tiene texto visible', () => {
  const s = $("index.html", ".cabecera__carrito svg");
  if (!s) return "Falta el <svg> dentro de .cabecera__carrito";
  if (s.getAttribute("aria-hidden") !== "true")
    return 'Si el texto ya dice «Carrito», el icono lleva aria-hidden="true"';
  return $("index.html", ".cabecera__carrito").textContent.trim().length > 0 || "El enlace necesita su texto";
});
p("C", "C3", "Los SVG toman el color del texto: currentColor, sin colores escritos a mano", () => {
  const svgs = $$("index.html", ".cabecera svg");
  if (svgs.length < 2) return "Faltan los SVG de la cabecera";
  const html = svgs.map((s) => s.outerHTML).join("");
  if (/(fill|stroke)="#[0-9a-f]{3,8}"/i.test(html)) return "Hay un fill o stroke con un color fijo: usa currentColor";
  return /currentColor/.test(html) || 'Usa fill="currentColor" o stroke="currentColor"';
});
const anim = () => porFichero["_animaciones.scss"]?.reglas ?? [];
const transiciones = () =>
  anim().flatMap((r) =>
    r.decls.filter((d) => /^transition(-property)?$/.test(d.prop) && d.valor !== "none").map((d) => ({ r, d })),
  );
p("C", "C4", "Hay transiciones (en la tarjeta o el botón) y solo de transform u opacity", () => {
  const t = transiciones();
  if (!t.length) return "No hay ninguna transition en _animaciones.scss";
  const malas = t.filter(({ d }) => d.valor.split(",").some((x) => !/^(transform|opacity)\b/.test(x.trim())));
  return (
    malas.length === 0 ||
    `«${malas[0].d.valor}»: anima solo transform u opacity (lo demás obliga a recalcular el layout)`
  );
});
p(
  "C",
  "C4",
  "La microinteracción: :hover o :active cambian transform",
  () =>
    anim().some(
      (r) =>
        r.selectores.some((s) => /:(hover|active|focus-visible)/.test(s)) &&
        r.decls.some((d) => d.prop === "transform"),
    ) || "Un &:hover o &:active con transform (translateY, scale…)",
);
p("C", "C4", "Una animación de entrada con @keyframes que solo toca opacity y transform", () => {
  const kf = (porFichero["_animaciones.scss"]?.css ?? "").match(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/);
  if (!kf) return "No hay @keyframes en _animaciones.scss";
  const props = [...kf[1].matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
  if (!anim().some((r) => r.decls.some((d) => d.prop === "animation" && d.valor !== "none")))
    return "El @keyframes no se usa: falta animation en algún selector";
  return (
    props.every((x) => x === "opacity" || x === "transform") ||
    `El @keyframes anima ${[...new Set(props)].join(", ")}: solo opacity y transform`
  );
});
p("C", "C4", "@media (prefers-reduced-motion: reduce) quita las transiciones y la animación", () => {
  const red = anim().filter((r) => r.ctx.some((a) => /prefers-reduced-motion:\s*reduce/.test(a.params)));
  if (!red.length) return "Falta @media (prefers-reduced-motion: reduce) { … }";
  const quitados = new Set(
    red
      .filter((r) => r.decls.some((d) => /^(transition|animation)$/.test(d.prop) && d.valor === "none"))
      .flatMap((r) => r.selectores),
  );
  const animados = new Set(
    anim()
      .filter(
        (r) =>
          !red.includes(r) &&
          r.decls.some((d) => (/^transition$/.test(d.prop) || d.prop === "animation") && d.valor !== "none"),
      )
      .flatMap((r) => r.selectores),
  );
  const faltan = [...animados].filter((s) => !quitados.has(s));
  return (
    faltan.length === 0 || `Siguen moviéndose con reduce: ${faltan.join(", ")} (transition: none / animation: none)`
  );
});
const filas = () => $$("creditos.html", "table tbody tr");
p("C", "C5", 'creditos.html: una tabla con <caption>, cabeceras (th scope="col") y una fila por imagen', () => {
  if (!$("creditos.html", "table caption")) return "La tabla necesita su <caption>";
  if ($$("creditos.html", "table thead th[scope=col]").length < 4)
    return 'Cuatro cabeceras: <th scope="col"> Título, Autor, Fuente, Licencia';
  return (
    filas().length === LIC.length ||
    `Hay ${filas().length} filas: tienen que ser ${LIC.length}, una por imagen de fuentes/`
  );
});
p("C", "C5", "Cada imagen con su título y su autor (TALF)", () => {
  const txt = filas().map((f) => f.textContent.replace(/\s+/g, " "));
  const faltan = LIC.filter((l) => !txt.some((t) => t.includes(l.titulo) && t.includes(l.autor)));
  return (
    (LIC.length && faltan.length === 0) ||
    `Faltan (título y autor en la misma fila): ${faltan.map((l) => l.fichero).join(", ")}`
  );
});
p("C", "C5", "Cada imagen enlaza su fuente y su licencia (la URL exacta de Creative Commons)", () => {
  const faltan = LIC.filter(
    (l) =>
      !filas().some((f) => {
        const hrefs = [...f.querySelectorAll("a")].map((a) => a.getAttribute("href"));
        return f.textContent.includes(l.titulo) && hrefs.includes(l.fuente) && hrefs.includes(l.url);
      }),
  );
  return (LIC.length && faltan.length === 0) || `Revisa los enlaces de: ${faltan.map((l) => l.fichero).join(", ")}`;
});
p(
  "C",
  "C5",
  "El pie de inicio avisa de la licencia y enlaza los créditos",
  () =>
    ($("index.html", ".pie a[href$='creditos.html']") &&
      /Creative Commons|licencia/i.test($("index.html", ".pie")?.textContent ?? "")) ||
    "En el .pie de index.html: un enlace a /creditos.html y la palabra licencia o Creative Commons",
);

// ── Recorte de la P2 a ≈ 5 h (27/10): A4, A5, B4, C2 y C4 pasan a 👀 (ya resueltos en el kit: no cuentan,
//    pero si los rompes, salen en rojo). B2 (boletín) y C5 (créditos) se retiran: vienen hechos.
const _RESUELTOS = new Set(["A4", "A5", "B4", "C2", "C4"]);
const _FUERA = new Set(["B2", "C5"]);
for (let i = PRUEBAS.length - 1; i >= 0; i--) {
  const pr = PRUEBAS[i];
  if (_FUERA.has(pr.ap)) {
    PRUEBAS.splice(i, 1);
    continue;
  }
  if (_RESUELTOS.has(pr.ap)) {
    pr.bloque = "0";
    pr.ap = "👀";
    if (!pr.texto.startsWith("👀")) pr.texto = "👀 " + pr.texto;
  }
}
const _ORD = { "0": 0, A: 1, B: 2, C: 3 };
PRUEBAS.sort((x, y) => _ORD[x.bloque] - _ORD[y.bloque]); // Node ordena de forma estable: mantiene el orden dentro de cada bloque

// ───────────── ejecutar ─────────────
const NOMBRES = {
  0: "👀 Lo que ya está hecho (no cuenta; si sale en rojo, has roto algo)",
  A: "Bloque A · Layout (UD4)",
  B: "Bloque B · Arquitectura CSS: BEM y Tailwind (UD5)",
  C: "Bloque C · Multimedia (UD6)",
};
if (!Window) {
  console.log(c(31, "✘ Falta node_modules.") + " Ejecuta antes: docker compose run --rm web npm install");
  process.exit(1);
}
const resultados = PRUEBAS.map(({ bloque, ap, texto, fn }) => {
  let r;
  try {
    r = errorCompilar && bloque !== "0" && bloque !== "C" ? "No se puede comprobar: el SCSS no compila" : fn();
  } catch (e) {
    r = `Error del comprobador: ${e.message}`;
  }
  return { bloque, ap, texto, ok: r === true, detalle: r === true ? "" : String(r || "No") };
});

function calidad() {
  const correr = (bin, args) => {
    const b = join(RAIZ, "node_modules/.bin", bin);
    if (!existsSync(b)) return { ok: false, salida: "Falta node_modules" };
    try {
      execFileSync(b, args, { cwd: RAIZ, stdio: "pipe" });
      return { ok: true, salida: "" };
    } catch (e) {
      return { ok: false, salida: String(e.stdout ?? "") + String(e.stderr ?? "") };
    }
  };
  return {
    stylelint: correr("stylelint", ["scss/**/*.scss"]),
    prettier: correr("prettier", ["--check", "scss/**/*.scss", "*.html", "src/**/*.css"]),
  };
}
const q = SIN_CALIDAD ? null : calidad();

const resumen = {};
for (const b of ["A", "B", "C"]) {
  const t = resultados.filter((r) => r.bloque === b);
  resumen[b] = { verdes: t.filter((r) => r.ok).length, total: t.length };
}
if (JSON_OUT) {
  console.log(
    JSON.stringify(
      { resumen, calidad: q && { stylelint: q.stylelint.ok, prettier: q.prettier.ok }, resultados },
      null,
      1,
    ),
  );
  process.exit(0);
}
if (errorCompilar) {
  console.log(`\n${c(31, "✘ Tu SCSS no compila.")} Arregla esto primero (Sass te dice el fichero y la línea):\n`);
  console.log(c(33, errorCompilar));
  console.log("\nPista: suele ser un ; o una } que falta justo antes de la línea que dice.\n");
}
let actual = null;
for (const r of resultados.filter((x) => !SOLO || x.bloque === SOLO || x.bloque === "0")) {
  if (r.bloque !== actual) {
    actual = r.bloque;
    console.log(`\n${c(1, NOMBRES[actual])}`);
  }
  const ap = r.ap === "👀" ? "" : c(2, `${r.ap.padEnd(3)} `);
  console.log(`  ${r.ok ? c(32, "✔") : c(31, "✘")} ${ap}${r.texto}`);
  if (!r.ok) console.log(`        ${c(33, r.detalle.replace(/\n/g, "\n        "))}`);
}
if (q) {
  console.log(`\n${c(1, "Calidad (cuenta en cada bloque: 0,5 Stylelint + 0,5 Prettier)")}`);
  console.log(
    `  ${q.stylelint.ok ? c(32, "✔") : c(31, "✘")} Stylelint sin errores ${q.stylelint.ok ? "" : c(33, "→ docker compose run --rm web npm run lint")}`,
  );
  console.log(
    `  ${q.prettier.ok ? c(32, "✔") : c(31, "✘")} Prettier: todo formateado ${q.prettier.ok ? "" : c(33, "→ docker compose run --rm web npm run formato")}`,
  );
}
console.log("");
for (const b of ["A", "B", "C"].filter((x) => !SOLO || x === SOLO)) {
  const { verdes, total } = resumen[b];
  console.log(`  ${c(1, `Bloque ${b}`)}: ${verdes} de ${total} en verde${verdes === total ? c(32, " ✔") : ""}`);
}
console.log("\nY la prueba del acordeón: de 1440 a 320 px, despacio, sin scroll horizontal (en las cuatro páginas).\n");
