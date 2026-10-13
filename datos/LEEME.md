# Datos del sitio

Todos los datos que usan las secciones TREP, Resultados oficiales y Análisis viven aquí, como JSON estáticos que el
navegador pide al mismo origen. No hay servidor ni base de datos: agregar una elección o publicar resultados
oficiales es agregar archivos con este esquema y actualizar `elecciones.json`.

Todos los archivos de esta carpeta están descritos en el catálogo DCAT `catalog.json`, con su tamaño y su SHA-256
(ADR-039); cómo usarlo, en [README.md](README.md). Después de cambiar o agregar datos hay que regenerarlo con
`python tools/catalogo_datos.py`: el validador del sitio rechaza un catálogo que no coincide con los archivos.

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
- Versión 2 (ADR-042): el manifiesto lo escribe `analisis_resultados/historico/procesamiento/manifiesto.py`, que conserva
  municipales 2026 y agrega el histórico del TSJE (municipales 1996-2021, generales 1998-2023, complementarias 1996-2025
  y el Consejo de la Magistratura 2023). Cada año declara además `fecha` (o `fechas`, en las complementarias),
  `nacional.nivel` (`mesa` o `distrito`: los años sin resultados por mesa no tienen tablero de distrito),
  `nacional.indices` (con dos fuentes en el país, el índice de cada una), `geometria` (`{eleccion, anio}`: la carpeta de la
  geometría y del IPM, la de municipales 2026), `tipos_cargo` (`uninominal` o `plurinominal`) y `bancas_cargo` (dónde
  reparte bancas cada cargo plurinominal: `distrito`, `departamento` o `nacional`). `fuentes` lleva solo las que existen:
  el TREP no ofrece los años sin TREP y Resultados oficiales no ofrece los años sin cómputo oficial.

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

## Datos nacionales (`nacional/`, ADR-022)

Con `"nacional": { "nombre": "Paraguay", "cargos": ["junta"], "fuentes": ["trep"], "nota": … }` en el año del
manifiesto, el TREP abre en el mapa del país y cada distrito tiene su carpeta. Los genera
`analisis_resultados/procesamiento/nacional_datos.py` desde las planillas del TREP del TSJE, el catálogo del TREP, el
padrón (solo columnas del local y el recuento de electores por mesa) y la cartografía del INE.

```text
datos/<eleccion>/<anio>/nacional/
├── distritos.json            índice: un registro por distrito (clave «<dep>-<dis>», códigos TSJE e INE, nombre del INE
│                             con tildes y el del TSJE, departamento, centro y caja, mesas, locales, electores, votos
│                             por lista, blancos, nulos, no computados, emitidos, ganadora, segunda, pct_ganadora,
│                             ventaja, participación, bancas oficiales y, por sigla, numLista, nombre, color, tipo y
│                             forma) y los departamentos (código, nombre, centro, caja y cantidad de distritos)
├── lista.json                clave, nombre y departamento de cada distrito (el selector de la barra de contexto)
├── colores.json              la regla de colores: partidos, verdes de las alianzas y movimientos locales, formas
├── geo/distritos.geojson     límites de los distritos (INE CNPV 2022, simplificados) con clave, nombre y departamento
├── geo/departamentos.geojson límites de los departamentos
├── procedencia.json          SHA-256 de las planillas, del catálogo del TREP y de la cartografía del INE
├── indicadores_distritos.json IPM del INE (Censo 2022) por distrito: H, A e IPM en total, urbana y rural (ADR-023)
└── distritos/<dep>-<dis>/    comun/ (locales.json, candidaturas.json con las bancas, geo/distrito.geojson) y trep/
                              (resumen.json, mesas.json, procedencia.json): el esquema de Asunción, solo la Junta ("2")
```

- La clave de Asunción es `0-0`; sus datos completos siguen en `comun/`, `trep/` (y `oficial/`), y su registro del
  índice tiene `carpeta: ""`. Los demás tienen `carpeta: "nacional/distritos/<clave>/"`.
- «A computar» de las planillas es `nocomputados`. Las bancas son la integración oficial del TREP (el D'Hondt sobre los
  votos por lista da el mismo reparto en todos los distritos).
- Intendencia (ADR-024): cada distrito trae el cargo `"1"` en `trep/mesas.json`, `trep/resumen.json` y
  `comun/candidaturas.json` (con el nombre de cada candidatura), desde las planillas uninominales del TREP (la sigla y el
  nombre de cada lista, de la planilla del TSJE con los resultados de Intendencia por distrito); el índice
  suma el bloque `intendencia`. Una mesa sin acta de un cargo lleva `null` en ese cargo (y cuenta como sin acta para él);
  `cobertura.por_cargo` cuenta las mesas con acta de cada uno. El manifiesto declara en `nacional.cargos` los cargos que
  el sitio muestra fuera de Asunción. El IPM por barrio existe solo para Asunción.
- `indicadores_distritos.json` (ADR-023) lo genera `analisis_resultados/procesamiento/ipm_distritos_datos.py` desde los
  cuadros 1 a 3 del Anexo del IPM del INE: `distritos[<clave>]` es `{ "H" | "A" | "IPM": { "total", "urbana", "rural" } }`
  con `null` para un área sin población (14 distritos sin rural, en `sin_poblacion_rural`); Asunción (`0-0`) es `null`
  porque el INE publica su IPM por barrio. Trae los indicadores de `comun/indicadores_barrios.json`, la fuente y el
  SHA-256 del anexo. El mapa del país lo lee al elegir su capa del IPM, y Análisis en «Paraguay, por distrito».

## Histórico electoral (ADR-042)

Los resultados oficiales del TSJE de 1996 a 2025 (datos abiertos en datos.gov.py; las fuentes, su SHA-256 y su papel,
en `datos_reales/resultadosTSJE/procedencia.json`, fuera de Git). Los genera
`analisis_resultados/historico/procesamiento/preparar.py` (y `consejo.py` el Consejo de la Magistratura 2023) con la
estructura de municipales 2026; `geometria.py` dibuja cada elección con sus distritos de entonces (ADR-043) y `verificar.py`
compara cada fuente superpuesta con la principal.

```text
datos/<eleccion>/<anio>/            eleccion: municipales, generales, complementarias o consejo-magistratura
├── oficial/, comun/                Asunción (0-0) mesa por mesa, en los años con resultados por mesa (2003-2023)
└── nacional/
    ├── distritos.json              índice, versión 2: por distrito, cargos.<clave> con votos por sigla, votos_listas,
    │                               blancos, nulos, emitidos, ganadora, segunda, pct_ganadora, ventaja, listas (numLista,
    │                               nombre, color, tipo, forma y, en los cargos uninominales, candidato) y, en la Junta
    │                               Municipal, bancas; electores (padrón del TSJE) y participación; las bancas del país y
    │                               de cada departamento (generales); fuera_del_mapa (exterior, unidades sin distrito actual
    │                               y gobernaciones complementarias)
    ├── lista.json, colores.json, procedencia.json
    ├── geo/distritos.geojson       los distritos de esa elección (ADR-043): los del INE 2022, unidos donde uno abarcaba lo
    │                               que hoy son varios (propiedad «abarca»); solo en los años cuyo manifiesto lo dice
    ├── electos.json                personas electas (titulares y suplentes) con nombre, cargo, ámbito, lista, orden y votos
    │                               preferentes (desde 2021); el sexo y la edad, solo sumados (totales)
    ├── distritos_trep.json         solo el Consejo de la Magistratura 2023: el índice del TREP (nacional.indices)
    └── distritos/<clave>/          con resultados por mesa: oficial/ (resumen.json, mesas.json; el Consejo, también trep/)
                                    y comun/ (locales.json, candidaturas.json): el esquema de trep/ de 2026
datos/historico/correspondencia_distritos.json   cada distrito de cada elección con su clave actual y el método
datos/historico/distritos_creacion.json         los 43 distritos creados desde 1996: ley, fecha, distritos de origen, el
                                                principal, la fuente y en qué elecciones van dentro de otro (unido_en)
datos/historico/limites/<clave>-<huella>/geo/distrito.geojson   el límite de un distrito que abarcaba varios de hoy (en su
                                                tablero), una sola vez aunque se repita en varias elecciones
```

- Cada elección se dibuja con sus distritos de entonces (ADR-043). Los departamentos y el IPM son los de municipales 2026
  (`geometria` del manifiesto). Un distrito creado después va dentro del distrito del que se separó (su ley de creación; si
  salió de varios, el que más electores perdió): `geometria.distritos` dice de qué elección es el mapa del país (otro año
  con los mismos distritos o el suyo), `geometria.propios` da el límite de cada distrito que abarcaba varios de hoy, y en
  `distritos.json` esos distritos llevan `abarca` (las claves y los nombres de hoy) con su centro y su caja. Sin
  `geometria.distritos`, los distritos de esa elección son los de hoy.
- Desde 2001, un distrito que existía (figura en el padrón del TSJE de esa elección) y no tiene resultados no se une: queda
  en gris, con el motivo en `sin_resultados` de `distritos.json` (Nueva Esperanza y José Falcón eligieron sus autoridades
  en complementarias). Los códigos del TSJE de cada año se unen a los de hoy por el código y el nombre (en 2001 el 17-0 era
  Mariscal Estigarribia); las excepciones, revisadas a mano, están en
  `analisis_resultados/historico/correspondencia_manual.json`. Las unidades electorales de 1996-1998 que no son un distrito
  actual y el voto del exterior (generales 2013-2023) van en `fuera_del_mapa`.
- El IPM del INE (Censo 2022) es por distrito de hoy: un distrito de entonces que abarcaba varios no tiene IPM en el mapa
  ni en Análisis (lo dice el motivo).
- Las claves de los cargos son las candidaturas del TSJE de ese año (en las generales, Diputados es 3 o 4 según haya
  Parlasur): el manifiesto las relaciona con el hash (`claves_cargo`).
- Bancas: las de la integración oficial (archivo de electos D'Hondt del TSJE). El tablero recalcula el D'Hondt de la Junta
  y avisa si no da lo mismo (pasa en dos distritos). En las generales, las bancas son del país (Senado, Parlasur) o del
  departamento (Diputados, Junta departamental): están en `distritos.json` (`bancas` y `departamentos[].bancas`).
- Locales: el nombre del TSJE; la ubicación es la del mismo local en 2026 cuando se lo reconoce (`coordenadas` dice cómo;
  en un distrito que abarcaba varios, también entre los locales de los otros distritos de hoy); sin ella, el local está en
  la tabla y no en el mapa.
- Participación: votos emitidos sobre el padrón del TSJE por mesa (cantidades, sin datos de personas).

## Finanzas municipales: histórico (ADR-044)

El balance general y el estado de resultados de cada municipalidad de los Informes Financieros anuales del MEF, de 2004 a
2025 (2025, de la página de 2025, sin recalcular). Los genera `analisis_resultados/finanzas/historico/` (`inventario.py`,
`extraer.py`, `unir.py`, `ipc.py` y `preparar.py`) desde los PDF de `datos_reales/mef/municipalidad/<año>/` y la serie del
IPC de `datos_reales/bcp/ipc/` (fuera de Git; cada carpeta con su `procedencia*.json`).

```text
datos/finanzas/municipalidad/historico/
├── manifiesto.json   los años de 1997 a 2025: con datos (tomo, municipios, distritos del mapa, nota del MEF, geometría) o
│                     sin datos (el motivo); formatos, campos (cuenta, tipo saldo o flujo, desde qué formato es comparable),
│                     estados, notas, textos de los motivos e IPC (índice de diciembre y promedio de cada año y sus factores
│                     a guaraníes de 2025); las huellas de los archivos
└── anios/<año>.json  formato, fuente (tomo, archivo, SHA-256, enlace oficial o copia del Wayback Machine, escala), geometria
                      (la elección cuyo mapa se usa: la última hasta el 31 de diciembre del año), unidos (los distritos de
                      entonces que abarcaban otros: nombre, abarca, centro), campos (14 cuentas y 8 indicadores), municipios
                      (por clave: nombre_mef, codigo_mef, union, valores en guaraníes de ese año, estados de las cuentas,
                      paginas [balance, resultados], notas y motivos de los indicadores vacíos) y sin_informe
```

- Formatos: 2004 y 2005 («totales»: el plan de cuentas de cada municipalidad; 2005 en millones) solo comparan el activo,
  el pasivo, el patrimonio, el disponible, los ingresos, los egresos y el resultado; 2008 a 2011 («rotulos»: el plan
  común sin códigos) suman el activo y el pasivo corrientes; desde 2012 («codigos»), todas las cuentas.
- Estados de las cuentas: `p` publicado, `s` calculado con los subtotales del propio estado (con su nota), `n` no expuesto
  en el informe, `f` no comparable en el formato del año, `r` sin estado de resultados en el tomo.
- Cada balance cuadra contra los subtotales que publica (activo = pasivo + patrimonio + resultado) y cada estado de
  resultados también (ingresos − egresos = resultado); la cantidad de municipalidades coincide con la nota del MEF salvo
  en 2017 y 2019, donde la nota repite la del año anterior.
- Guaraníes de 2025: los saldos del balance, por el IPC de diciembre de 2025 sobre el de diciembre del año; ingresos,
  egresos y resultado, por el promedio de 2025 sobre el del año (`ipc.anios.<año>.factor_diciembre` y `factor_promedio`).
- Los años sin balances municipales (1997-2003, 2006 y 2007) dicen por qué en el manifiesto; 2011 y 2017 salen del sitio
  anterior del MEF (copia del Wayback Machine) porque el sitio actual enlaza otro archivo, y 2015, del tomo que el MEF rotula
  «situación presupuestaria» y trae la patrimonial.

## Visualización financiera: los años del histórico (ADR-045)

Lo que dibuja la Visualización financiera en los ejercicios de 2004 a 2024 con balances municipales (los cuatro gráficos del
balance y del estado de resultados: 05, 07, 08 y 14) y la evolución histórica de cada municipalidad, de 2004 a 2025. Los
genera `analisis_resultados/visualizacion_financiera/procesamiento/preparar_historico.py` desde la extracción de los tomos
(con el rótulo impreso de cada cuenta) y los datos de Finanzas › histórico; no lee ningún PDF.

```text
datos/visualizacion_financiera/municipalidad/historico/
├── manifest.json            los años de 2004 a 2025 (con datos: tomo, archivo, SHA-256, enlace, escala, formato, cómo se
│                            leyeron sus cuentas y la cobertura de cada vista; sin datos: el motivo), los años anteriores
│                            sin balances, los campos de la serie, estados, notas, el IPC del BCP (factores a guaraníes de
│                            2025), la procedencia, la versión y las huellas
├── huellas.json             tamaño y SHA-256 de cada archivo
├── municipios.json          el índice: cada distrito de hoy con algún balance (clave, nombre, departamento, los años con
│                            cuentas y, por año, las claves de los distritos creados después que abarcaba)
└── municipios/<clave>.json  rotulos (los rótulos impresos), anios (por año: nombre_mef, codigo_mef, paginas, lectura,
                             cuentas [estado b/r, código, rótulo, importe, s|c], indicadores [valor, motivo], ficha, notas,
                             omitidas y abarca) y serie (de 2004 a 2025: valor con los 10 campos y sus estados, parte_de o
                             sin_informe)
```

- Las cuentas van hasta el tercer nivel del plan de cuentas, con los mismos importes y correcciones que Finanzas › histórico
  (`s`: calculada con los subtotales del propio estado; `c`: el pasivo como suma de sus partes).
- Lectura: con los códigos del plan (2004 y desde 2012) se publican todas las cuentas impresas; sin ellos (2005 y de 2008 a
  2011) solo las principales, leídas por su rótulo, y no se publica una que el tomo imprime dentro de otra leída (`omitidas`:
  sumarla aparte la contaría dos veces). La página rotula lo que falta para un total como detalle no leído.
- La serie usa los valores publicados de cada año en guaraníes de ese año; la página los lleva a guaraníes de 2025 con los
  factores del manifiesto (diciembre para los saldos, el promedio del año para los flujos).

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
- Ningún archivo lleva datos de personas (cédulas, nombres de electores, fechas de nacimiento, edades), salvo el nombre de
  cada candidatura: el de la boleta en Asunción y, en los demás distritos, el del padrón, buscado por la cédula que trae la
  planilla uninominal del TREP (ADR-024; la cédula no se guarda ni se publica). En el histórico (ADR-042), el nombre de las
  personas electas y de quien encabeza cada candidatura uninominal, según el TSJE; su sexo y su edad, solo sumados.
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
1. Crear `datos/<eleccion>/<anio>/comun/` y la carpeta de cada fuente con estos archivos (o, con datos del TSJE en el
   formato de datos.gov.py, sumarlos a `datos_reales/resultadosTSJE/` con su SHA-256 en `procedencia.json` y correr
   `preparar.py`).
2. Agregar la elección (o el año) en `elecciones.json` con sus cargos y el estado de cada fuente (`manifiesto.py`).
3. Si los cargos son otros, agregarlos en `cargos`, `nombres_cargo`, `claves_cargo`, `tipos_cargo` y `bancas_cargo`: el
   sitio los toma del manifiesto (`assets/js/cargos.js`), sin cambiar el código.
4. Correr `python tools/catalogo_datos.py` y `python tools/indexacion.py`.
