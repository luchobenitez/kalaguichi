# Mapas base (OpenStreetMap, PMTiles)

Dos archivos: `asuncion.pmtiles`, con todas las capas de Asunción y alrededores (calles, edificios, lugares, usos del
suelo), y `pais.pmtiles`, liviano, con solo las rutas, los ríos, los arroyos, los espejos de agua y los nombres de lugares
de todo Paraguay (ADR 0024 del módulo).

## Asunción

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

## Paraguay

`pais.pmtiles` (12,5 MB) sale del build `20261008` de Protomaps (datos de OpenStreetMap al 2026-10-08 04:00 UTC):

1. `pmtiles extract` lee del build mundial las teselas de Paraguay hasta z13 (los arroyos están solo en ese zoom), con la
   región de los departamentos del INE unidos y unos 9 km de margen (los ríos de frontera quedan enteros).
2. `scripts/mapa_base/pais.mjs` se queda con tres capas y vuelve a cortarlas en z4 a z12 con geojson-vt, que simplifica
   cada zoom; cada clase tiene su zoom mínimo, con poco detalle al alejar (el país) y algo más al acercar (un distrito):
   - `roads`: autopistas y troncales desde z4, primarias z6, secundarias z8, terciarias z9, caminos locales y calles z11;
     con `clase`, `ref` (el número de ruta) y `nombre`. Sin caminos de tierra, senderos, servicios ni pistas de aviación.
   - `water`: espejos de agua de 1 km² o más desde z4, de 5 ha z9, de media hectárea z11 (los tajamares más chicos no
     van); ríos con nombre z5, sin nombre z9; arroyos con nombre z10, sin nombre z11; canales z11. Con `clase` y `nombre`.
   - `places`: ciudades z7, pueblos z9, localidades z10, caseríos z11 y barrios z12, con `clase` y `nombre`.
3. `pmtiles convert` lo pasa a PMTiles. Desde z13, MapLibre agranda las teselas de z12.

Lo que pide una vista típica: el país, de 14 a 77 KB (z4 a z6); un departamento (Central, z9), 89 KB; un distrito urbano
(Luque, z11 o z12), unos 280 KB; uno grande del Chaco (z8), 12 KB. Cifras por zoom y por vista: `procedencia.json`.

```
python scripts/mapa_base.py pais --pmtiles RUTA_AL_EJECUTABLE_DE_PMTILES --build 20261008
```

## Licencias y atribución

- Datos: © colaboradores de OpenStreetMap, [ODbL 1.0](https://www.openstreetmap.org/copyright). Atribución visible en el
  mapa: «© colaboradores de OpenStreetMap (ODbL) · Protomaps», más las fuentes de la cartografía propia (INE y
  Municipalidad de Asunción). `pais.pmtiles` es una base de datos derivada: tiene la misma licencia.
- Esquema, build y estilos: Protomaps (código BSD-3-Clause; diseño visual CC0; `assets/mapa/LICENSE-protomaps-basemaps.md`).
  El estilo no usa la capa de cobertura del suelo (ESA WorldCover).
- Tipografías Noto Sans: SIL Open Font License 1.1 (`assets/vendor/mapa/fonts/OFL.txt`). Íconos: MIT, derivados de
  tangrams/icons (`assets/vendor/mapa/sprites/LICENSE.md`).
- MapLibre GL JS 6.13.0 y pmtiles 4.5.0: BSD-3-Clause (`assets/vendor/maplibre/LICENSE.txt`,
  `assets/vendor/pmtiles/LICENSE.txt`).
