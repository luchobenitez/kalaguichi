# Datos del sitio

Todos los datos que usan las secciones TREP, Resultados oficiales y Análisis viven aquí, como JSON estáticos que el
navegador pide al mismo origen. No hay servidor ni base de datos: agregar una elección o publicar resultados
oficiales es agregar archivos con este esquema y actualizar `elecciones.json`.

## `elecciones.json` (manifiesto)

```json
{ "version": 1, "elecciones": [ { "id": "municipales", "nombre": "Municipales", "anios": [
    { "anio": 2026, "ambito": "Asunción", "cargos": ["intendencia", "junta"],
      "nombres_cargo": { "intendencia": "Intendencia", "junta": "Junta Municipal" },
      "claves_cargo": { "intendencia": "1", "junta": "2" },
      "fuentes": { "trep": { "estado": "publicado", "nombre": "TREP preliminar", "corte": "2026-10-04T23:48:02" },
                   "oficial": { "estado": "pendiente", "nombre": "Cómputo oficial" } } } ] } ] }
```

- `id` de la elección y `anio` forman la carpeta `datos/<id>/<anio>/` y van en el hash (`#eleccion=municipales&anio=2026`).
- `cargos`: los valores del hash (`cargo=intendencia|junta`). `claves_cargo` los relaciona con las claves de los JSON
  (`"1"` y `"2"`, como en las actas del TREP). `nombres_cargo`: el nombre completo; `etiquetas_cargo`: el texto corto
  del control segmentado de la barra de contexto (Intendencia | Junta).
- `fuentes.<fuente>.estado`: `publicado` (hay datos en su carpeta) o `pendiente` (la sección muestra que aún no se
  publicaron). `corte` (TREP) o `fecha` (oficial): fecha y hora en ISO, sin zona (hora de Paraguay).
- Con una sola elección o un solo año, el selector se muestra como texto fijo.

## Carpetas

```text
datos/<eleccion>/<anio>/
├── comun/                    lo que no depende de la fuente
│   ├── geo.json              proyección, viewBox, distrito, barrios (INE), zonas municipales y río, en metros (vista informe)
│   ├── geo/                  lo mismo en GeoJSON WGS84 (EPSG:4326) para el mapa de MapLibre: distrito, barrios (con
│   │                         clave, nombre y población), zonas_municipales, rio, etiquetas (un punto por barrio y por zona)
│   │                         y, como capas opcionales, manzanas y cauces (Municipalidad); procedencia.json con las fuentes
│   ├── locales.json          locales de votación: códigos, nombre, dirección, coordenadas, barrio, zona municipal
│   ├── candidaturas.json     listas por cargo (sigla, nombre, color, foto), bancas de la Junta según el TREP
│   ├── indicadores_barrios.json   indicadores por barrio (IPM del INE), unidos por la clave del barrio
│   └── assets/candidaturas/  fotos; las rutas de candidaturas.json son relativas a comun/
├── trep/                     resultados preliminares (TREP)
│   ├── resumen.json
│   ├── mesas.json
│   └── procedencia.json
└── oficial/                  cómputo oficial: los MISMOS tres archivos y el MISMO esquema que trep/

datos/mapa_base/              mapa base de OpenStreetMap (extracto PMTiles de Protomaps), común a todas las elecciones:
├── asuncion.pmtiles          ver mapa_base/LEEME.md (comando, versiones y licencias)
└── procedencia.json

datos/maquina_votacion/       la sección «Máquina de votación» (ver maquina_votacion/LEEME.md):
├── inventario.json           todo el software que menciona la documentación técnica, con su origen y texto literal
├── cpe_map.json              CPE propuestos y revisados por una persona (confirmado, corregido o sin CPE)
├── cves.json                 CVE de los CPE revisados (NVD, OSV.dev y CISA KEV), un registro por línea
└── cves_resumen.json         cuentas por software y severidad, para la carga inicial de la página
```

## Esquema de cada fuente (`trep/` y `oficial/`)

**`mesas.json`**: una fila por mesa con acta. Todos los vectores siguen el orden de `mesas`.
- `campos`: `["zona", "local", "mesa"]`; `mesas`: `[[zona, local, mesa], …]` (enteros, códigos del TSJE).
- `electores`: electores habilitados por mesa (recuento agregado del padrón; sin datos de personas).
- `cargos.<clave>`: `listas` (números de lista como texto, en el orden del TREP), `votos` (por mesa, un vector con
  un valor por lista), `blancos`, `nulos`, `nocomputados` y `emitidos` (por mesa). Emitidos = votos a listas +
  blancos + nulos + no computados.

**`resumen.json`**: totales y contexto.
- `eleccion`: `codEleccion`, `nombre`, `etapa` (`TREP` u `OFICIAL`), `corte`, `corte_base`, `territorio`, `fuente`,
  `aviso` (texto que la página muestra), `generado_utc`.
- `cobertura`: `mesas_esperadas`, `mesas_con_acta` y `faltantes` (`zona`, `local`, `mesa`, `estado`).
- `cargos.<clave>`: `nombre`, `listas`, `votos` (por número de lista), `votos_listas`, `blancos`, `nulos`,
  `nocomputados`, `emitidos`, `mesas`.
- `zonas` y `zonas_municipales`: código → nombre. `electores`: `padron_total`, `en_mesas_con_acta`,
  `participacion` (0 a 1), `fuente`, `nota`. `no_disponible`: vistas que se declaran no disponibles y por qué.

**`procedencia.json`**: SHA-256 de cada acta (`actas.campos`: zona, local, mesa, `sha256_intendente`,
`sha256_junta`), de las demás fuentes y del generador.

## Reglas
- Ningún archivo lleva datos de personas (cédulas, nombres de electores, fechas de nacimiento, edades).
- Los porcentajes de lista son sobre votos a listas del cargo; los cargos no se suman entre sí.
- Una mesa que está en una fuente y no en la otra se indica en la tabla del tablero; no se completa ni se estima.
- Las bancas de `comun/candidaturas.json` corresponden al TREP. Con la fuente oficial, el tablero reparte las bancas
  por D'Hondt sobre los votos oficiales por lista (el mismo cálculo reproduce el reparto del TREP); los nombres de las
  personas electas solo se muestran si la fuente los trae, en `oficial/resumen.json` →
  `bancas.electos: [{ "banca", "numLista", "nombre", "votos_preferenciales" }]` (opcional).
- Con las dos fuentes publicadas, el tablero compara sus `cobertura.faltantes` y marca en la tabla las mesas con acta en
  una sola de ellas (sin pedir el `mesas.json` de la otra).

## Cargar los resultados oficiales
1. Generar `oficial/resumen.json`, `oficial/mesas.json` y `oficial/procedencia.json` con el esquema de arriba
   (`eleccion.etapa`: `OFICIAL`).
2. En `elecciones.json`: `"oficial": { "estado": "publicado", "nombre": "Cómputo oficial", "fecha": "AAAA-MM-DDTHH:MM:SS" }`.
   La sección `/oficiales/` pasa sola del aviso «aún no publicados» al tablero; no hay que tocar HTML ni JavaScript.
3. Correr `python tools/validar_sitio.py` y las pruebas; publicar solo con aprobación.

## Agregar una elección o un año
1. Crear `datos/<eleccion>/<anio>/comun/` y la carpeta de cada fuente con estos archivos.
2. Agregar la elección (o el año) en `elecciones.json` con sus cargos y el estado de cada fuente.
3. Si los cargos son otros, agregarlos en `cargos`, `nombres_cargo` y `claves_cargo`.
