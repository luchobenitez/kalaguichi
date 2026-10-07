# Mapa base de Asunción (OpenStreetMap, PMTiles)

`asuncion.pmtiles` es un extracto de Asunción y alrededores del build diario de [Protomaps](https://protomaps.com)
(mosaicos vectoriales de OpenStreetMap). El tablero y los análisis lo leen con MapLibre GL JS y la biblioteca `pmtiles`,
por partes (pedidos HTTP con rango): el navegador baja solo los mosaicos que están a la vista. El sitio no pide nada a
otros dominios: el extracto, los estilos, las tipografías y los íconos están en el repositorio.

## Cómo se generó

```
pmtiles extract https://build.protomaps.com/20261006.pmtiles sitio/datos/mapa_base/asuncion.pmtiles \
    --bbox=-57.76,-25.42,-57.44,-25.16 --maxzoom=15
```

- Herramienta: [go-pmtiles](https://github.com/protomaps/go-pmtiles/releases) 1.31.2 (`pmtiles extract`, que lee del
  build mundial solo las partes del recuadro).
- Build: `20261006` (datos de OpenStreetMap al 2026-10-06 04:00 UTC; esquema de Protomaps 4.15.2).
- Recuadro: algo más amplio que el aproximado de la especificación (-57,70 −25,38 a −57,50 −25,20) para que, con el
  distrito entero a la vista en una pantalla ancha, no queden bordes vacíos. El mapa no deja salir de este recuadro.
- Zoom: 0 a 15, que es el máximo del build de Protomaps; desde el zoom 16, MapLibre agranda los mosaicos del 15 (son
  vectoriales: calles y nombres se siguen viendo nítidos).
- Versiones, tamaño y SHA-256 de cada archivo: `procedencia.json`.

Para regenerarlo todo (desde la raíz del proyecto):

```
npm ci --ignore-scripts
python scripts/mapa_base.py todo --pmtiles RUTA_AL_EJECUTABLE_DE_PMTILES [--build AAAAMMDD]
```

`scripts/mapa_base.py` copia MapLibre GL JS y pmtiles a `assets/vendor/`, genera los estilos claro y oscuro
(`assets/mapa/`, con `scripts/mapa_base/estilo.mjs`), baja las tipografías y los íconos de Protomaps de un commit fijo
(`assets/vendor/mapa/`, con la huella del contenido verificada) y hace el extracto. Cada paso actualiza `procedencia.json`.

## Licencias y atribución

- Datos: © colaboradores de OpenStreetMap, [ODbL 1.0](https://www.openstreetmap.org/copyright). Atribución visible en el
  mapa: «© colaboradores de OpenStreetMap (ODbL) · Protomaps», más las fuentes de la cartografía propia (INE y
  Municipalidad de Asunción).
- Esquema, build y estilos: Protomaps (código BSD-3-Clause; diseño visual CC0; `assets/mapa/LICENSE-protomaps-basemaps.md`).
  El estilo no usa la capa de cobertura del suelo (ESA WorldCover).
- Tipografías Noto Sans: SIL Open Font License 1.1 (`assets/vendor/mapa/fonts/OFL.txt`). Íconos: MIT, derivados de
  tangrams/icons (`assets/vendor/mapa/sprites/LICENSE.md`).
- MapLibre GL JS 6.13.0 y pmtiles 4.5.0: BSD-3-Clause (`assets/vendor/maplibre/LICENSE.txt`,
  `assets/vendor/pmtiles/LICENSE.txt`).
