# Datos de la máquina de votación

Datos de la página «Vulnerabilidades documentadas» (`/maquina-votacion/vulnerabilidades/`; ADR-021, etapa 5). Se
generan con los scripts de `scripts/`, desde la raíz del proyecto; el sitio solo los lee. Las otras dos páginas de la
sección se generan directamente en `sitio/maquina-votacion/`: «La máquina» con `python scripts/mv_documento.py` (el
documento técnico, con sus figuras en `maquina/figuras/`) e «Historia de la adquisición» con
`python scripts/mv_historia.py` (del texto que aportó el responsable del proyecto,
`datos_reales/mv/Máquinas De Votación TSJE Paraguay.md`, con sus 58 fuentes; `--citas` lista las llamadas a las fuentes).

| Archivo | Qué tiene | Cómo se genera |
| --- | --- | --- |
| `inventario.json` | Todo el software que menciona la documentación técnica de las máquinas (P6-7k, P6-8k y VP6D): sistema operativo, núcleo, firmware, bootloader, BIOS, aplicación, bibliotecas, controladores, herramientas criptográficas, servicios y hardware con firmware. Por elemento: `id`, `componente`, `nombre`, `fabricante` (solo si el documento lo nombra), `version` («versión no especificada» si no la tiene), `version_exacta`, `categoria`, `origen` (`seccion`, `parrafo` con la tabla y fila o el párrafo, `referencia_documental` y `texto_literal`) y todas sus `menciones`. Versiones distintas del mismo software son elementos distintos. En `revisados_no_incluidos`, lo que se revisó y no es software. | `python scripts/mv_inventario.py` (lee `datos_reales/mv/Maquinas_de_votacion_Paraguay_arquitectura_hardware_software_insumos.docx`, al que la especificación llama `mv.docx`; imprime un resumen por categoría, los elementos sin versión y los candidatos que no hayan quedado en el inventario) |
| `cpe_map.json` | Para cada elemento con versión exacta, el CPE 2.3 propuesto con la API de productos CPE 2.0 de NVD y su revisión humana: `confirmado`, `corregido` (con el CPE correcto) o `sin CPE`; `cpe_final` es el que se consulta. Los sin versión, los propios del fabricante, el firmware del equipo y el hardware quedan `no verificable`. | `python scripts/mv_cpe.py` propone; las marcas de la revisión se aplican con `python scripts/mv_cpe.py --revision marcas.json --revisor "…"` |
| `cves.json` | Para los CPE confirmados o corregidos: las CVE de NVD (API 2.0, por `cpeName`, solo configuraciones vulnerables y sin rechazadas), las de OSV.dev para los paquetes de PyPI y la marca del catálogo KEV de CISA. Por CVE: `id`, `publicado`, `modificado`, `estado_nvd`, `descripcion` (de NVD, en inglés, abreviada), `cvss` (`version`, `puntaje`, `severidad`, `vector`, `fuente`), `severidad`, `kev`, `url` (nvd.nist.gov), `fuentes` y `afecta` (los `id` del inventario). Además, la fecha de cada consulta en `fuentes`. | `python scripts/mv_cve.py` (también lo corre cada lunes la GitHub Action `.github/workflows/mv-cve.yml`, que guarda los cambios en `main` sin publicar el sitio) |
| `cves_resumen.json` | Cuentas por software y por severidad, las CVE exclusivas de cada software y los avisos de OSV.dev sin CVE: lo que la página necesita al abrir. | Lo escribe `mv_cve.py` junto con `cves.json` (`--reescribir cves.json` lo rehace sin consultar) |

Límites y claves: NVD admite 5 pedidos cada 30 segundos sin clave y 50 con la clave gratuita, que se lee de la variable
de entorno `NVD_API_KEY` (en GitHub, un secreto con ese nombre). La clave nunca va en el código ni en estos archivos.

Alcance: una CVE asociada a una versión indica una vulnerabilidad conocida de ese software, no que sea explotable en la
configuración de la máquina de votación; eso depende de cómo está instalado y protegido. El núcleo `6.8.0-49-generic` es
una compilación de Ubuntu: el CPE de Linux 6.8 trae miles de CVE que Ubuntu puede haber corregido sin cambiar el número.

Fuentes y licencias: el documento técnico lo aportó el responsable del proyecto (se publica el texto literal de cada
dato, como pidió). NVD (NIST) y el catálogo KEV de CISA son información pública del gobierno de los EE. UU.; este sitio
usa la API de NVD, pero NVD no lo avala ni lo certifica («This product uses the NVD API but is not endorsed or certified
by the NVD»). Los avisos de OSV.dev conservan la licencia de su base de origen.
