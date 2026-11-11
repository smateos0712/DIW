# Guía de estilo de RAÍZ

## Tokens

Están en `scss/_tokens.scss` (SASS) y, para la página de contacto, en el `@theme` de `src/tailwind.css` (los mismos
valores).

| Token | Valor | Para qué |
|---|---|---|
| `$color-brand-primary` | `#2e7d32` | Botones y enlaces |
| `$color-brand-strong` | `#1b4d20` | Cabecera, pie y fondo del texto de la portada |
| `$color-accent` | `#b5643c` | Ofertas y foco del teclado |
| `$color-surface-alt` | `#f6f4ef` | Fondo de la página |
| `$space-sm` … `$space-xl` | 0.5rem … 2.5rem | Márgenes y rellenos |

En el CSS los colores se usan con las custom properties de `_temas.scss` (`var(--color-marca)`…), que cambian en el
tema oscuro.

## Componentes

| Bloque | Elementos | Modificadores |
|---|---|---|
| `boton` | — | `boton--grande`, `boton--secundario` |
| `tarjeta-planta` | `__imagen`, `__etiqueta`, `__nombre`, `__descripcion`, `__precio`, `__boton` | `tarjeta-planta--oferta`, `tarjeta-planta--agotada` |
| `boletin` | `__titulo`, `__formulario`, `__etiqueta`, `__campo`, `__boton`, `__nota` | — |
| `ficha` | `__imagen`, `__cuerpo`, `__nombre`, `__texto`, `__precio` | — (se adapta a su hueco con `@container`) |

## Convenciones

- Clases en BEM: `bloque__elemento--modificador`, en minúsculas y con guiones.
- Un selector = una clase. Solo se combina `.bloque--modificador .bloque__elemento`.
- Nada de `#id` ni `!important` en el CSS. Los colores, solo en `_tokens.scss`.
- Mobile-first con `$bp-md` y `$bp-lg`. Animaciones solo de `transform` y `opacity`.
- Antes de subir: `docker compose run --rm web npm run lint` y `docker compose run --rm web npm run formato`.
