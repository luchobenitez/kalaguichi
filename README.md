# Kalaguichi.com

Plataforma ciudadana para comprender y analizar el sistema electoral paraguayo con datos, documentos y fuentes
verificables. Se publica en **https://kalaguichi.com/**.

> Kalaguichi.com es una iniciativa independiente: no está vinculada al Tribunal Superior de Justicia Electoral (TSJE) ni a
> ningún partido, movimiento o candidatura. Los datos electorales provienen de publicaciones de la Justicia Electoral; el
> sitio los ordena, los cruza con otras fuentes públicas y los analiza, pero no los produce ni los certifica.

La pregunta que guía el proyecto es: ¿podemos reconstruir, verificar y explicar con evidencia cómo funciona una
elección en Paraguay? Por eso cada sección muestra su fuente, su método y sus límites, y quien la lee puede pasar de una
afirmación a la evidencia que la sustenta.

## Qué hay en este repositorio

El repositorio tiene una sola rama, `gh-pages`, que es **el sitio tal como se publica**: las páginas HTML, los estilos,
los módulos JavaScript, los datos ya preparados, los mapas base y las bibliotecas que usa el sitio, copiadas adentro.
GitHub Pages sirve el sitio desde esa rama.

Además están estos archivos del proyecto: este README, las licencias (`LICENSE` y `LICENSE-CC-BY-SA-4.0`) y, en
`.github/`, el [código de conducta](.github/CODE_OF_CONDUCT.md), la [guía para contribuir](.github/CONTRIBUTING.md), la
[política de seguridad](.github/SECURITY.md) y las plantillas de issues y de pull requests. Ninguna página del sitio los
usa ni los enlaza.

Por decisión del proyecto, en el repositorio **no** están los programas que preparan los datos, los datos en crudo ni
los documentos originales, las pruebas ni los documentos de trabajo. Quedan en el espacio de trabajo del responsable, y
cada publicación se genera desde ahí (ver [Cómo se trabaja y se publica](#cómo-se-trabaja-y-se-publica)).

## Qué tiene el sitio

| Sección | Dirección | Qué muestra |
|---|---|---|
| Padrón electoral → Consulta | [/padron/](https://kalaguichi.com/padron/) | Una **demostración con datos sintéticos** de la consulta por cédula y fecha de nacimiento: no informa sobre electores reales. Su página de privacidad explica qué hace y qué no hace con lo que se ingresa. |
| Padrón electoral → Análisis del padrón | [/padron/analisis/](https://kalaguichi.com/padron/analisis/) | Conteos del padrón 2026 por sexo y por edad (cumplida al 4 de octubre de 2026), para el país, cada departamento y cada distrito, en quince segmentos inspirados en los «Números relevantes» de la Justicia Electoral, sin copiar sus cifras. |
| TREP | [/trep/](https://kalaguichi.com/trep/) | Los resultados preliminares de las elecciones municipales 2026 (corte del 4 de octubre de 2026 a las 23:48): el mapa de Paraguay con la lista más votada de la Intendencia o de la Junta Municipal en cada uno de los 263 distritos y el tablero de cada distrito, mesa por mesa, con mapa base, capas, tabla, ranking, el reparto D'Hondt de las bancas, fuente y método. Asunción suma barrios, zonas, pobreza por barrio y la «Vista informe». |
| Resultados oficiales | [/oficiales/](https://kalaguichi.com/oficiales/) | El mismo tablero, con el cómputo oficial. Mientras ese cómputo no se publique, la sección lo dice y lleva al TREP. |
| Análisis → TREP | [/analisis/](https://kalaguichi.com/analisis/) | Cada análisis con su gráfico, su tabla, CSV, PNG y cómo leerlo. En el país, por distrito: participación y pobreza, ganador y pobreza, votos de un partido y pobreza, «Distritos», «Electores por distrito» y «Votos de una lista». En Asunción: Intendente vs Junta (el voto cruzado, con un mínimo de votos por mesa), distribución del margen, participación y pobreza por barrio, ganador por mesa y pobreza, ranking por lista y TREP vs oficial (cuando haya cómputo). En los demás distritos: el margen entre las dos listas más votadas y el ranking. |
| Análisis → Financiero | [/analisis/financiero/2025/](https://kalaguichi.com/analisis/financiero/2025/) | Las finanzas municipales del ejercicio 2025 (MEF): un mapa de las municipalidades con clases fijas de verde a rojo y un deslizador desde–hasta, el presupuesto anual, filtros electorales, la tabla de presupuesto y balance y la descarga CSV. |
| Análisis → Visualización financiera | [/analisis/visualizacion-financiera/2025/](https://kalaguichi.com/analisis/visualizacion-financiera/2025/) | Los catorce gráficos de cada municipalidad (origen y asignación del presupuesto, ejecución, apertura del gasto, formación del presupuesto y del resultado, ingresos, liquidez, inversión física, servicios personales, transferencias, balance…), dibujados en el navegador desde los datos, con descargas PNG, SVG y CSV y la ficha municipal. |
| Máquina de votación | [/maquina-votacion/](https://kalaguichi.com/maquina-votacion/) | La historia de la adquisición, el documento técnico de la máquina y las vulnerabilidades públicas (CVE) de los componentes que declara ese documento, consultadas en NVD, el catálogo KEV de CISA y OSV.dev. |
| Acerca de | [/acerca/](https://kalaguichi.com/acerca/) | Qué queremos hacer, independencia, fuentes y licencias, privacidad y contacto. |

La dirección guarda la selección después de `#` (por ejemplo, `/trep/#eleccion=municipales&anio=2026&distrito=11-17`
abre el tablero de Luque), así que se puede copiar y compartir.

## Cómo funciona

- **Sitio estático.** HTML, CSS y módulos JavaScript, sin framework, sin servidor propio y sin base de datos. Todo se
  calcula en el navegador a partir de archivos JSON (y, en la consulta de demostración, de archivos cifrados).
- **Nada de otros dominios.** Las bibliotecas (Chart.js, MapLibre GL JS y pmtiles), las tipografías, los íconos y los
  mapas base están copiados en el sitio. Cada página declara una política de seguridad de contenido (CSP) que solo admite
  el mismo origen y no admite scripts ni estilos en línea, `eval` ni objetos incrustados. Un enlace a otro sitio se abre
  solo si quien lee lo pulsa.
- **Sin cookies, analítica ni rastreadores.** El navegador guarda solo el tema claro u oscuro (`localStorage`) y, durante
  la sesión, la selección que comparten las páginas (`sessionStorage`). Nunca guarda lo que se ingresa en la consulta del
  padrón, y la consulta no lo pone en la dirección.
- **Mapas.** MapLibre GL JS con mosaicos vectoriales de OpenStreetMap en archivos PMTiles, que se leen por partes (pedidos
  con rango): una vista baja de decenas a cientos de kilobytes, no el archivo entero. Asunción tiene su mapa de calles; el
  país y los demás distritos, un mapa base liviano con rutas, ríos, arroyos, espejos de agua y nombres de lugares.
- **Gráficos.** Chart.js en los análisis del TREP y SVG propio en el resto. El PNG se arma en un lienzo, porque la CSP
  no admite imágenes `data:` ni `blob:`.
- **Procedencia.** Cada conjunto de datos lleva su fuente, su fecha o su corte y las huellas SHA-256 de los archivos de
  origen.

## Fuentes de datos

- **Justicia Electoral (TSJE).** Las actas por mesa del TREP en JSON (Asunción); las planillas del TREP de la Junta
  Municipal y las uninominales de la Intendencia de los 263 distritos, mesa por mesa; la planilla de Intendencia y Junta
  por distrito, local y mesa, de la que salen la sigla y el nombre de cada lista. Del padrón electoral, solo conteos
  (electores por mesa, sexo y edad), el catálogo de locales y los nombres de las 630 candidaturas a Intendencia.
- **Instituto Nacional de Estadística (INE).** La cartografía digital del Censo Nacional de Población y Viviendas 2022
  (límites referenciales de barrios, distritos y departamentos) y la pobreza multidimensional (IPM) del mismo censo, por
  barrio en Asunción y por distrito en el resto del país.
- **Municipalidad de Asunción.** Las zonas municipales y el río.
- **Ministerio de Economía y Finanzas (MEF).** El Informe Financiero Ejercicio 2025, tomos V-A (situación financiera) y
  V-B (situación presupuestaria) de las municipalidades: 247 con informe y 16 sin informe al 31/12/2025.
- **OpenStreetMap**, por los builds de Protomaps: los mapas base.
- **NVD (NIST), catálogo KEV (CISA) y OSV.dev.** Las vulnerabilidades conocidas de los componentes de la máquina de
  votación. Este sitio usa la API de NVD, pero NVD no lo avala ni lo certifica.
- **Documentos aportados por el responsable del proyecto.** El documento técnico «Máquinas de votación. Arquitectura,
  hardware, software e insumos» (octubre de 2026) y el texto sobre la historia de la adquisición, con sus fuentes.
- **Fotos de candidaturas** (Asunción): la referencia pública de las municipales 2026, según el TREP del TSJE, con su
  huella en el catálogo de candidaturas.

Las fechas, los cortes y las condiciones de cada fuente están en [Acerca de](https://kalaguichi.com/acerca/) y en el
diálogo «Fuente» de cada sección.

## Privacidad y datos de personas

- **Ningún archivo publicado tiene datos de personas del padrón** (cédulas, nombres de electores ni fechas de
  nacimiento). La excepción son los nombres de las candidaturas a Intendencia, que son públicos: se buscaron en el padrón
  por la cédula que trae la planilla del TREP, y la cédula no se guarda ni se publica.
- **El análisis del padrón publica conteos**: en el espacio de trabajo, un programa lee del padrón solo el sexo, la fecha
  de nacimiento y el lugar de votación, y guarda conteos por país, departamento y distrito, nunca por local ni por mesa.
  Los registros de 100 años o más se reservan donde son menos de cinco, con supresión complementaria para que no se
  deduzcan de los totales. No se cruzan con resultados ni con registros de defunciones.
- **No se infiere voto, fallecimiento ni pertenencia a un grupo** a partir de la edad, los nombres o los datos que
  faltan. Las edades muy altas se muestran como una característica del registro, no como personas fallecidas. Un dato
  desconocido queda como desconocido, nunca como cero.
- **La consulta del padrón es una demostración con datos sintéticos.** Su clave de cifrado es pública a propósito: el
  cifrado prueba el mecanismo, pero no protege datos ni identifica a quien consulta. La cédula y la fecha de nacimiento
  sirven para buscar, no para autenticar. El padrón real no se publica.
- Los issues de este repositorio son públicos: no incluyas cédulas, fechas de nacimiento ni otros datos personales.

## Cómo leer los datos

- **El TREP es preliminar** y no reemplaza al cómputo oficial.
- **«Electores» son los electores habilitados del padrón**, no los habitantes.
- **Pobreza y votos** (el IPM del Censo 2022 frente a los votos de 2026) se comparan entre agregados (barrios o
  distritos): no dicen cómo votaron las personas en situación de pobreza ni prueban causas.
- **Finanzas.** Los indicadores calculados no son calificaciones oficiales del MEF y los colores del mapa son una escala
  de magnitud, no una calificación. El filtro electoral elige municipios: no atribuye la gestión de 2025 a quienes ganaron
  en 2026. «Sin informe» y «N/D» (un dato que falta en la fuente) van en rojo; «—» indica un cálculo que no corresponde,
  como un porcentaje sobre un previsto de cero.
- **Vulnerabilidades.** Una CVE de un componente declarado no prueba que la máquina sea vulnerable: depende de la versión
  exacta, de la configuración y de los parches. El núcleo Linux declarado es una compilación de Ubuntu que puede tener
  muchas de esas fallas ya corregidas.

## Cómo se trabaja y se publica

- Cada cambio es un pedido del responsable del proyecto, que se registra como una tarea con sus criterios de aceptación y
  sus decisiones (ADR numerados) en el espacio de trabajo.
- Las pruebas son unitarias (Node y Python) y de navegador (Chromium), y estas comparan lo que muestra cada página con
  cálculos independientes. Mientras se trabaja corren las que tocan los archivos cambiados; antes de publicar un cambio
  del sitio, la regresión completa y una revisión visual en cuatro tamaños de pantalla y dos temas.
- Publicar es siempre una decisión expresa del responsable. La herramienta de publicación valida el sitio (el mismo menú
  en todas las páginas, los enlaces internos, la CSP, nada de otros dominios, fotos con procedencia) y revisa que no
  vayan archivos de trabajo, claves ni datos personales. Recién entonces sube el sitio a `gh-pages`. Cuando GitHub Pages
  termina, verifica en vivo que cada archivo publicado sea idéntico al local y recorre las secciones en un navegador, sin
  errores ni pedidos a terceros.
- Cada publicación es un commit de `gh-pages`.

## Decisiones principales

| Tema | Qué se decidió | Registro |
|---|---|---|
| Qué se publica | Solo el sitio, en `gh-pages`, y estos archivos del proyecto. Nunca los programas de procesamiento, los datos en crudo, los originales, las pruebas, los documentos de trabajo ni los archivos de los agentes de desarrollo. | ADR-012, ADR-037 |
| Arquitectura | Sitio estático, sin framework ni servidor de pago; todo lo que carga está dentro del sitio. | ADR-001, ADR-012, ADR-015, ADR-021 |
| Padrón | La consulta es solo una demostración y el padrón real no se publica. El análisis del padrón publica conteos, sin cruces con resultados ni con defunciones. | ADR-004, ADR-008, ADR-028 |
| Resultados | El TREP y el cómputo oficial usan el mismo tablero; nunca hay resultados oficiales de prueba en el sitio. | ADR-016, ADR-017, ADR-018 |
| Todo el país | El TREP abre en el mapa de Paraguay; cada distrito tiene su tablero y su análisis; la Intendencia está en todo el país, con el nombre de cada candidatura. | ADR-022, ADR-024 |
| Pobreza | El IPM del INE por barrio y por distrito, como comparación entre agregados. | ADR-023 |
| Electores | Los mapas por cantidad usan los electores habilitados del padrón, y así se rotulan. | ADR-025, ADR-027 |
| Mapas | OpenStreetMap copiado en el sitio: Asunción con todas sus capas y un mapa liviano para el país. | ADR-021, ADR-026 |
| Finanzas | Los datos del MEF tal como se publicaron, con clases fijas y un filtro electoral que no atribuye la gestión. | ADR-029, ADR-030, ADR-033, ADR-034 |
| Visualización financiera | Gráficos dibujados en el navegador, sin imágenes pregeneradas; «N/D» distinto de «—». | ADR-035, ADR-036 |
| Fotos | Solo con procedencia (SHA-256) y derechos verificados. | ADR-013 |
| Forma de trabajo | Un pedido, una tarea y un ADR; publicación verificada en vivo y registrada. | ADR-014, ADR-031 |
| Licencias | AGPL-3.0 para el código y CC BY-SA 4.0 para el contenido propio. | ADR-037 |

El registro completo de las decisiones se lleva en el espacio de trabajo y no se publica. Acá se resume lo que importa
para usar o reutilizar el sitio.

## Licencias

- **Código** (el HTML, el CSS y el JavaScript propios del sitio): [GNU Affero General Public License, versión
  3](LICENSE) (AGPL-3.0-only). Podés usarlo, estudiarlo, modificarlo y redistribuirlo con esa misma licencia; si ofrecés
  una versión modificada en la red, tenés que ofrecerles a quienes la usan su código fuente. Se ofrece sin ninguna
  garantía.
- **Contenido propio** (los textos, los análisis, los gráficos, los datos que elaboró el proyecto —agregados, uniones y
  cálculos— y las imágenes propias): [Creative Commons Atribución-CompartirIgual 4.0
  Internacional](LICENSE-CC-BY-SA-4.0) (CC BY-SA 4.0). Al reutilizarlo, citá «Kalaguichi.com
  (https://kalaguichi.com/)», indicá si hiciste cambios, nombrá la fuente original de los datos y compartí lo que derives
  con la misma licencia.

No los cubren esas licencias; conservan las suyas o sus condiciones:

| Qué | Dónde | Licencia o condiciones |
|---|---|---|
| Chart.js 4.5.1 | `assets/vendor/chartjs/` | MIT |
| MapLibre GL JS 6.13.0 | `assets/vendor/maplibre/` | BSD-3-Clause |
| pmtiles 4.5.0 | `assets/vendor/pmtiles/` | BSD-3-Clause |
| Estilos de Protomaps (`@protomaps/basemaps` 5.7.2), adaptados | `assets/mapa/` | BSD-3-Clause (código) y CC0 (diseño) |
| Tipografías Noto Sans | `assets/vendor/mapa/fonts/` | SIL Open Font License 1.1 |
| Íconos del mapa | `assets/vendor/mapa/sprites/` | MIT |
| Mapas base de OpenStreetMap (builds de Protomaps) | `datos/mapa_base/` | ODbL 1.0, © colaboradores de OpenStreetMap |
| Datos del TSJE, el INE, el MEF y la Municipalidad de Asunción | `datos/` | Las condiciones de cada fuente (la del INE, su Licencia de Uso de Información Pública) |
| Vulnerabilidades de NVD, CISA KEV y OSV.dev | `datos/maquina_votacion/` | Las de cada base de origen |
| Fotos de candidaturas | `datos/municipales/2026/comun/assets/candidaturas/` | Las de su fuente, según su catálogo |
| Figuras del documento técnico de la máquina, y citas y extractos de terceros en los textos | `maquina-votacion/` y los textos que los citan | Los derechos de sus autores |
| El nombre Kalaguichi.com y sus logos | `assets/img/kalaguichi-*.svg` | No se licencian |

La licencia de cada biblioteca va en su carpeta.

## Participar

- Errores, datos que no coinciden con su fuente, propuestas y consultas: [abrí un
  issue](https://github.com/luchobenitez/kalaguichi/issues/new/choose) con el formulario que corresponda.
- Para proponer cambios, leé la [guía para contribuir](.github/CONTRIBUTING.md).
- Una falla de seguridad o datos personales expuestos se avisan en privado, como dice la [política de
  seguridad](.github/SECURITY.md).
- Todos los espacios del proyecto se rigen por el [código de conducta](.github/CODE_OF_CONDUCT.md).
