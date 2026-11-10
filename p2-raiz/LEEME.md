# DIW · Práctica 2 · RAÍZ, vivero online

En tu ordenador no se instala nada: todo va en Docker.

```bash
cd p2-raiz
docker compose run --rm web npm install            # 1 vez, con internet
docker compose run --rm web npm run imagenes       # 1 vez: genera public/img/ desde fuentes/ (👀)
docker compose up                                  # la web en http://localhost:5173 (Ctrl+C para parar)
docker compose run --rm web npm run comprobar      # el comprobador: todo
docker compose run --rm web npm run comprobar -- a # solo el bloque A (o b, o c)
docker compose run --rm web npm run lint           # Stylelint
docker compose run --rm web npm run formato        # Prettier: lo deja todo formateado
```

El orden y lo que hay que hacer en cada bloque está en el enunciado. Resumen:

| Bloque | Ficheros | Rama |
|---|---|---|
| **A · UD4 · Layout** | lee `_cabecera.scss` (👀 Flexbox) → `scss/components/`: `_layout`, `_destacados`, `_ficha`, `_heroe` (el título) y `_temas` | `feature/p2-a` |
| **B · UD5 · Arquitectura CSS** | lee `_boton.scss` (👀 BEM) → las tarjetas en `index.html` y `_tarjeta-planta.scss`, el boletín (`index.html` y `_boletin.scss`), `contacto.html` con Tailwind (`src/tailwind.css`) y `GUIA-ESTILO.md` | `feature/p2-b` |
| **C · UD6 · Multimedia** | lee `herramientas/imagenes.mjs` (👀) → la portada y los SVG de `index.html`, la galería de `producto.html`, `_animaciones.scss` y `creditos.html` | `feature/p2-c` |

Los huecos están marcados con ✍️ en los propios ficheros.

Cada rama **sale de `develop` y vuelve a `develop`** al acabar el bloque. Al terminar la práctica, `develop` se
fusiona en `main` (la versión estable): lo que se corrige es `main`.

**Los avances puntúan:** lo que tengas subido a GitHub de cada bloque el **05/11** (A), el **12/11** (B) y el
**19/11** (C), a las 23:59, cuenta en la nota. Haz commit y `git push` cada vez que termines un apartado.
**No modifiques `comprobador/` ni `fuentes/`**: el profesor corrige con sus propias copias.

`public/img/` no se sube a GitHub (está en `.gitignore`): se genera con `docker compose run --rm web npm run imagenes`.
