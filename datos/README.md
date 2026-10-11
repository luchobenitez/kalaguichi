# Datos abiertos de Kalaguichi.com

Kalaguichi.com publica todos los datos que usan sus páginas como archivos estáticos, descritos en un catálogo DCAT:
**<https://kalaguichi.com/datos/catalog.json>**. Esta guía explica cómo usarlo, para personas, programas y asistentes de
inteligencia artificial.

Kalaguichi.com es una iniciativa ciudadana e independiente: no está vinculada al Tribunal Superior de Justicia Electoral
(TSJE) ni a ningún partido, movimiento o candidatura. Los datos electorales vienen de publicaciones de la Justicia
Electoral; este sitio los ordena, los cruza con otras fuentes públicas y los analiza, pero no los produce ni los certifica.

## En dos pasos

1. **Leé el catálogo.** Cada conjunto (`dcat:Dataset`) dice qué tiene, de cuándo y de dónde es, y cada archivo
   (`dcat:Distribution`) trae su URL absoluta, su tipo, su tamaño, su SHA-256 y sus campos (`kg:campos`).
2. **Bajá solo el archivo que necesitás**, por su `dcat:downloadURL`. Si el conjunto está partido por distrito o por
   municipalidad, armá la URL con su plantilla (`kg:plantillaURL`) y la clave que está en su índice (`kg:indice`).

Con `curl` y `jq`, los conjuntos y sus títulos:

```sh
curl -s https://kalaguichi.com/datos/catalog.json | jq '.["dcat:dataset"][] | {id: .["dct:identifier"], titulo: .["dct:title"]}'
```

En Python, sin bibliotecas externas: el índice de los distritos, con su huella comprobada, y después los votos por mesa de
uno solo (Luque, clave `11-17`):

```python
import hashlib, json, urllib.request

leer = lambda url: urllib.request.urlopen(url).read()
catalogo = json.loads(leer("https://kalaguichi.com/datos/catalog.json"))
pais = next(d for d in catalogo["dcat:dataset"] if d["dct:identifier"] == "trep-2026-pais")
lista = next(x for x in pais["dcat:distribution"] if x["@id"].endswith("#trep-2026-pais-lista"))
datos = leer(lista["dcat:downloadURL"])
assert hashlib.sha256(datos).hexdigest() == lista["spdx:checksum"]["spdx:checksumValue"]

serie = next(d for d in catalogo["dcat:dataset"] if d["dct:identifier"] == "trep-2026-distritos")
mesas = next(x for x in serie["dcat:distribution"] if x["@id"].endswith("#trep-2026-distritos-mesas"))
luque = json.loads(leer(mesas["kg:plantillaURL"].replace("{clave}", "11-17")))
```

En el navegador o en Node, con `fetch` (CORS abierto):

```js
const catalogo = await (await fetch('https://kalaguichi.com/datos/catalog.json')).json();
const conjuntos = catalogo['dcat:dataset'].map((d) => d['dct:identifier']);
```

## El catálogo

`catalog.json` sigue [W3C DCAT 3](https://www.w3.org/TR/vocab-dcat-3/) y es compatible con
[DCAT-AP 3](https://semiceu.github.io/DCAT-AP/releases/3.0.0/). Es un documento JSON-LD con su `@context` adentro (no hace
falta bajar nada más para leerlo como RDF) y con propiedades de prefijo corto (`dct:title`, `dcat:downloadURL`), así que
también se lee como JSON común. La raíz es el `dcat:Catalog`; adentro están el servicio (`dcat:service`) y los conjuntos
(`dcat:dataset`), cada uno con sus distribuciones (`dcat:distribution`). Lo genera `tools/catalogo_datos.py` desde los
archivos publicados: los tamaños, las huellas, los campos, las fechas y las cajas no se escriben a mano, y el validador del
sitio no deja publicar un catálogo que no coincida con los datos.

| Clase | Propiedades principales |
|---|---|
| `dcat:Catalog` | `dct:title`, `dct:description`, `dct:publisher`, `dcat:contactPoint` (los issues del repositorio, sin correo), `foaf:homepage`, `dct:language`, `dct:license` (la del catálogo), `dcat:version`, `dct:modified`, `dct:spatial`, `dcat:themeTaxonomy`, `kg:huellas`, `dcat:service`, `dcat:dataset` |
| `dcat:DataService` | La API estática: `dcat:endpointURL`, `dcat:endpointDescription` (esta guía), `dct:accessRights` (pública), `dcat:servesDataset` |
| `dcat:Dataset` | `dct:identifier`, `dct:title`, `dct:description`, `dcat:keyword`, `dcat:theme` (temas de la UE y dominios del sitio), `dct:spatial`, `dct:temporal`, `dcat:version`, `dct:modified`, `dct:license` o `dct:rights`, `dct:provenance`, `dct:source`, `dcat:landingPage` (la página que lo muestra), `foaf:page` (su documentación), `dcat:distribution` |
| `dcat:Distribution` | `dct:title`, `dcat:downloadURL`, `dcat:accessURL`, `dcat:accessService`, `dcat:mediaType`, `dct:format`, `dct:conformsTo`, `dcat:byteSize`, `spdx:checksum` (SHA-256), `kg:campos` |

Los dominios del sitio (`dcat:theme`, del esquema `#dominios` del catálogo) son electoral, financiero, geoespacial, social
y tecnología; cada conjunto lleva además los temas de la [lista de la UE](http://publications.europa.eu/resource/authority/data-theme)
(GOVE, ECON, REGI, SOCI, TECH).

### Plantillas

Los conjuntos grandes están partidos en un archivo por distrito, por municipalidad o por foto. Su distribución no es un
archivo sino una **plantilla**: `kg:plantillaURL` (una plantilla de URL de la RFC 6570, como
`https://kalaguichi.com/datos/municipales/2026/nacional/distritos/{clave}/trep/mesas.json`), `kg:clave` (qué va entre
llaves), `kg:indice` (la distribución donde están todas las claves), `kg:partes` (cuántos archivos hay), `kg:bytesTotales`
(cuánto pesan juntos) y `kg:campos` (los de cada parte). Sus `dcat:accessURL` apuntan a esta sección; el tamaño y el SHA-256
de cada parte están en `huellas.json`.

### Vocabulario propio (`kg:`)

DCAT no tiene dónde decir qué campos trae un archivo ni cómo se arma la URL de una serie. Para eso el catálogo usa seis
propiedades con el espacio de nombres `kg:` (`https://kalaguichi.com/datos/README.md#`, es decir, esta guía):

- `kg:campos`: los campos del archivo, como rutas de claves (`distritos[].votos.{clave}`): `[]` es una lista, `{clave}`
  un código (de distrito, de cargo o la sigla de una lista) y `campos: a, b, c` los nombres de las columnas cuando el
  archivo trae los valores en filas.
- `kg:plantillaURL`, `kg:clave`, `kg:indice`, `kg:partes` y `kg:bytesTotales`: las de las plantillas.
- `kg:huellas` (en el catálogo): `huellas.json`, con el tamaño y el SHA-256 de cada archivo de `datos/` (salvo
  `catalog.json`, `huellas.json` y esta guía).

### Conjuntos

<!-- generado:conjuntos (tools/catalogo_datos.py) -->
| Conjunto (`dct:identifier`) | Dominio | Archivos | Versión |
|---|---|---:|---|
| `elecciones`: Elecciones publicadas y sus fuentes | electoral | 1 | 2026-10-04T23:48:02 |
| `trep-2026-asuncion`: TREP 2026 · Asunción: votos por mesa de la Intendencia y la Junta Municipal | electoral | 33 | 2026-10-04T23:48:02 |
| `trep-2026-pais`: TREP 2026 · Paraguay: resultados de la Intendencia y la Junta por distrito | electoral | 4 | 2026-10-04T23:48:02 |
| `trep-2026-distritos`: TREP 2026 · cada distrito, mesa por mesa | electoral | 1310 | 2026-10-04T23:48:02 |
| `padron-2026-demografia`: Padrón 2026: electores por sexo y edad (conteos) | electoral | 3 | padron-2026 |
| `ipm-2022`: Pobreza multidimensional (IPM) 2022 por distrito y por barrio de Asunción (INE) | social | 2 | CNPV 2022 |
| `limites-2022`: Límites de los departamentos y los distritos de Paraguay (INE, CNPV 2022) | geoespacial | 264 | CNPV 2022 |
| `cartografia-asuncion`: Cartografía de Asunción: distrito, barrios, zonas municipales, río, manzanas y cauces | geoespacial | 9 | 2026-10-07 |
| `mapa-base`: Mapa base de OpenStreetMap para Paraguay y Asunción (PMTiles) | geoespacial | 3 | OpenStreetMap 2026-10-08 (país) y 2026-10-06 (Asunción) |
| `finanzas-municipales-2025`: Finanzas municipales 2025 (MEF): presupuesto, ejecución, balance e indicadores | financiero | 10 | ejercicio 2025, corte 2025-12-31 |
| `visualizacion-financiera-2025`: Visualización financiera 2025: los datos de los 14 gráficos de cada municipalidad | financiero | 499 | dffced972296 |
| `maquina-votacion`: Máquina de votación: software declarado, CPE y vulnerabilidades conocidas (CVE) | tecnologia | 4 | consulta 2026-10-07 |
<!-- /generado:conjuntos -->

### Ejemplo

Un extracto del catálogo real, válido como JSON-LD: la cabecera y un conjunto de cada dominio (el TREP de Asunción, las
finanzas municipales y los límites en GeoJSON), con un archivo cada uno y la plantilla de los límites por distrito.

<!-- generado:ejemplo (tools/catalogo_datos.py) -->
```json
{
 "@context": {
  "dcat": "http://www.w3.org/ns/dcat#",
  "dct": "http://purl.org/dc/terms/",
  "foaf": "http://xmlns.com/foaf/0.1/",
  "vcard": "http://www.w3.org/2006/vcard/ns#",
  "skos": "http://www.w3.org/2004/02/skos/core#",
  "spdx": "http://spdx.org/rdf/terms#",
  "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
  "xsd": "http://www.w3.org/2001/XMLSchema#",
  "gsp": "http://www.opengis.net/ont/geosparql#",
  "kg": "https://kalaguichi.com/datos/README.md#",
  "@base": "https://kalaguichi.com/datos/catalog.json",
  "dct:title": {
   "@language": "es"
  },
  "dct:description": {
   "@language": "es"
  },
  "dcat:keyword": {
   "@language": "es"
  },
  "skos:prefLabel": {
   "@language": "es"
  },
  "rdfs:label": {
   "@language": "es"
  },
  "dcat:accessURL": {
   "@type": "@id"
  },
  "dcat:downloadURL": {
   "@type": "@id"
  },
  "dcat:landingPage": {
   "@type": "@id"
  },
  "dcat:mediaType": {
   "@type": "@id"
  },
  "dct:format": {
   "@type": "@id"
  },
  "dct:license": {
   "@type": "@id"
  },
  "dct:conformsTo": {
   "@type": "@id"
  },
  "dcat:theme": {
   "@type": "@id"
  },
  "dcat:themeTaxonomy": {
   "@type": "@id"
  },
  "dct:language": {
   "@type": "@id"
  },
  "dct:accessRights": {
   "@type": "@id"
  },
  "foaf:homepage": {
   "@type": "@id"
  },
  "foaf:page": {
   "@type": "@id"
  },
  "vcard:hasURL": {
   "@type": "@id"
  },
  "dcat:endpointURL": {
   "@type": "@id"
  },
  "dcat:endpointDescription": {
   "@type": "@id"
  },
  "dcat:servesDataset": {
   "@type": "@id"
  },
  "dcat:accessService": {
   "@type": "@id"
  },
  "dct:source": {
   "@type": "@id"
  },
  "spdx:algorithm": {
   "@type": "@id"
  },
  "skos:inScheme": {
   "@type": "@id"
  },
  "kg:indice": {
   "@type": "@id"
  },
  "kg:huellas": {
   "@type": "@id"
  },
  "dcat:startDate": {
   "@type": "xsd:date"
  },
  "dcat:endDate": {
   "@type": "xsd:date"
  },
  "dct:modified": {
   "@type": "xsd:dateTime"
  },
  "dcat:byteSize": {
   "@type": "xsd:nonNegativeInteger"
  },
  "kg:partes": {
   "@type": "xsd:nonNegativeInteger"
  },
  "kg:bytesTotales": {
   "@type": "xsd:nonNegativeInteger"
  },
  "spdx:checksumValue": {
   "@type": "xsd:hexBinary"
  },
  "dcat:bbox": {
   "@type": "gsp:wktLiteral"
  }
 },
 "@id": "https://kalaguichi.com/datos/catalog.json",
 "@type": "dcat:Catalog",
 "dct:title": "Catálogo de datos de Kalaguichi.com",
 "dct:publisher": {
  "@id": "#kalaguichi",
  "@type": "foaf:Agent",
  "foaf:name": "Kalaguichi.com",
  "foaf:homepage": "https://kalaguichi.com/"
 },
 "dcat:contactPoint": {
  "@id": "#contacto",
  "@type": "vcard:Kind",
  "vcard:fn": "Issues del repositorio de Kalaguichi.com en GitHub",
  "vcard:hasURL": "https://github.com/luchobenitez/kalaguichi/issues"
 },
 "dct:license": "https://creativecommons.org/licenses/by-sa/4.0/",
 "dcat:version": "e372a8153249",
 "dcat:dataset": [
  {
   "@id": "#trep-2026-asuncion",
   "@type": "dcat:Dataset",
   "dct:identifier": "trep-2026-asuncion",
   "dct:title": "TREP 2026 · Asunción: votos por mesa de la Intendencia y la Junta Municipal",
   "dct:description": "Resultados preliminares del TREP de las municipales del 04/10/2026 en Asunción, mesa por mesa (corte del 04/10/2026 23:48; 1324 de 1325 mesas con acta): votos por lista, blancos, nulos, emitidos y electores; con los locales de votación (nombre, dirección, coordenadas, barrio y zona municipal), las candidaturas por cargo con sus fotos y la procedencia.",
   "dcat:keyword": [
    "TREP",
    "resultados",
    "mesas",
    "votos",
    "Intendencia",
    "Junta Municipal",
    "Asunción",
    "locales de votación",
    "candidaturas"
   ],
   "dcat:theme": [
    "http://publications.europa.eu/resource/authority/data-theme/GOVE",
    "#dominio-electoral"
   ],
   "dct:publisher": {
    "@id": "#kalaguichi"
   },
   "dcat:contactPoint": {
    "@id": "#contacto"
   },
   "dct:spatial": {
    "@id": "#asuncion"
   },
   "dct:temporal": {
    "@type": "dct:PeriodOfTime",
    "dcat:startDate": "2026-10-04",
    "dcat:endDate": "2026-10-04"
   },
   "dcat:version": "2026-10-04T23:48:02",
   "dct:modified": "2026-10-06T19:12:44+00:00",
   "dct:rights": {
    "@type": "dct:RightsStatement",
    "rdfs:label": "Cifras de la Justicia Electoral (TSJE), con las condiciones de su fuente; la organización, las uniones y los campos calculados por este sitio, CC BY-SA 4.0. Resultados preliminares: no reemplazan al cómputo oficial."
   },
   "dct:provenance": {
    "@type": "dct:ProvenanceStatement",
    "rdfs:label": "Actas por mesa del TREP (Justicia Electoral), en JSON. Electores: Padrón: recuento agregado de electores por mesa (sin datos de personas)."
   },
   "dcat:landingPage": "https://kalaguichi.com/trep/#eleccion=municipales&anio=2026&distrito=0-0",
   "foaf:page": [
    "https://kalaguichi.com/datos/LEEME.md"
   ],
   "dcat:distribution": [
    {
     "@id": "#trep-2026-asuncion-mesas",
     "@type": "dcat:Distribution",
     "dct:title": "Votos por mesa (mesas.json)",
     "dct:description": "Columnas zona, local y mesa; por cargo (1 Intendencia, 2 Junta), los votos de cada lista por mesa.",
     "dcat:downloadURL": "https://kalaguichi.com/datos/municipales/2026/trep/mesas.json",
     "dcat:accessURL": "https://kalaguichi.com/datos/municipales/2026/trep/mesas.json",
     "dcat:mediaType": "https://www.iana.org/assignments/media-types/application/json",
     "dcat:byteSize": 92811,
     "spdx:checksum": {
      "@type": "spdx:Checksum",
      "spdx:algorithm": "spdx:checksumAlgorithm_sha256",
      "spdx:checksumValue": "487165e229e2cad2197aef2d9c18ecd13510b1be98c35ee1127fb6f8b5eedb0d"
     },
     "kg:campos": [
      "campos(zona, local, mesa), mesas[][], electores[]",
      "cargos: {clave}.listas[], {clave}.votos[][], {clave}.blancos[], {clave}.nulos[], {clave}.nocomputados[], {clave}.emitidos[]"
     ]
    }
   ]
  },
  {
   "@id": "#finanzas-municipales-2025",
   "@type": "dcat:Dataset",
   "dct:identifier": "finanzas-municipales-2025",
   "dct:title": "Finanzas municipales 2025 (MEF): presupuesto, ejecución, balance e indicadores",
   "dct:description": "Cifras del Informe Financiero Ejercicio 2025 del Ministerio de Economía y Finanzas de Paraguay (MEF) (Tomo V-A — Municipalidades: Situación Financiera y Tomo V-B — Municipalidades: Situación Presupuestaria; corte del 31/12/2025) para las 263 municipalidades, 247 con informe y 16 sin informe: 52 variables de presupuesto y ejecución, 23 de balance y 27 indicadores calculados por este sitio (no son calificaciones oficiales del MEF), por la clave del distrito; con el filtro electoral y las observaciones de calidad. Montos en guaraníes.",
   "dcat:keyword": [
    "finanzas municipales",
    "presupuesto",
    "ejecución presupuestaria",
    "balance",
    "indicadores",
    "MEF",
    "municipalidades",
    "2025"
   ],
   "dcat:theme": [
    "http://publications.europa.eu/resource/authority/data-theme/ECON",
    "http://publications.europa.eu/resource/authority/data-theme/GOVE",
    "#dominio-financiero"
   ],
   "dct:publisher": {
    "@id": "#kalaguichi"
   },
   "dcat:contactPoint": {
    "@id": "#contacto"
   },
   "dct:spatial": {
    "@id": "#paraguay"
   },
   "dct:temporal": {
    "@type": "dct:PeriodOfTime",
    "dcat:startDate": "2025-01-01",
    "dcat:endDate": "2025-12-31"
   },
   "dcat:version": "ejercicio 2025, corte 2025-12-31",
   "dct:rights": {
    "@type": "dct:RightsStatement",
    "rdfs:label": "Cifras del MEF, con las condiciones de su fuente; la compilación, la unión con los distritos y los indicadores calculados, de este sitio (CC BY-SA 4.0). Usar la información publicada no implica que el MEF lo avale."
   },
   "dct:provenance": {
    "@type": "dct:ProvenanceStatement",
    "rdfs:label": "Ministerio de Economía y Finanzas de Paraguay (MEF), Informes Financieros Anuales: Informe Financiero Ejercicio 2025."
   },
   "dct:source": [
    "https://www.mef.gov.py/es/dependencias/viceministerio-de-administracion-financiera/gerencia-de-gestion-financiera-del-estado/direccion-general-del-tesoro-publico/direccion-general-contabilid/direccion-general-contabilidad-publica-informes-financieros-anuales"
   ],
   "dcat:landingPage": "https://kalaguichi.com/analisis/financiero/2025/",
   "dcat:distribution": [
    {
     "@id": "#finanzas-2025-indicadores",
     "@type": "dcat:Distribution",
     "dct:title": "Indicadores calculados (indicadores.json)",
     "dcat:downloadURL": "https://kalaguichi.com/datos/finanzas/municipalidad/2025/indicadores.json",
     "dcat:accessURL": "https://kalaguichi.com/datos/finanzas/municipalidad/2025/indicadores.json",
     "dcat:mediaType": "https://www.iana.org/assignments/media-types/application/json",
     "dcat:byteSize": 124924,
     "spdx:checksum": {
      "@type": "spdx:Checksum",
      "spdx:algorithm": "spdx:checksumAlgorithm_sha256",
      "spdx:checksumValue": "922f0d4645e039c901806f48098bba6fd8c21007a8b082bfd6dbcfce693081f9"
     },
     "kg:campos": [
      "version, campos(ingresos_no_financieros_gs, transferencias_recibidas_gs, ingresos_propios_identificados_gs, gasto_operativo_basico_gs, deuda_financiera_identificada_gs, saldo_bonos_identificados_gs, resultado_contable_gs, patrimonio_con_resultado_gs, capital_trabajo_gs, brecha_recursos_obligaciones_gs, brecha_recursos_pagos_gs, ejecucion_ingresos_pct, ejecucion_gastos_pct, pagado_sobre_obligado_pct, pendientes_sobre_obligado_pct, dependencia_transferencias_pct, autonomia_identificada_pct, personal_sobre_corrientes_pct, contratados_sobre_personal_pct, inversion_sobre_gasto_pct, ejecucion_inversion_pct, servicio_deuda_sobre_corrientes_pct, pasivo_sobre_ingresos_pct, pasivo_sobre_activo_pct, razon_corriente, prueba_acida, cobertura_disponible), textos_motivo[]",
      "valores: {clave}[]",
      "motivos: {clave}.deuda_financiera_identificada_gs, {clave}.saldo_bonos_identificados_gs"
     ]
    }
   ]
  },
  {
   "@id": "#limites-2022",
   "@type": "dcat:Dataset",
   "dct:identifier": "limites-2022",
   "dct:title": "Límites de los departamentos y los distritos de Paraguay (INE, CNPV 2022)",
   "dct:description": "Polígonos simplificados de los 18 departamentos (con la Capital) y los 263 distritos en GeoJSON (WGS84, RFC 7946), con la clave del TSJE y el código del INE, y el límite de cada distrito con más detalle en un archivo por distrito. Son límites referenciales.",
   "dcat:keyword": [
    "límites",
    "departamentos",
    "distritos",
    "GeoJSON",
    "INE",
    "cartografía"
   ],
   "dcat:theme": [
    "http://publications.europa.eu/resource/authority/data-theme/REGI",
    "#dominio-geoespacial"
   ],
   "dct:publisher": {
    "@id": "#kalaguichi"
   },
   "dcat:contactPoint": {
    "@id": "#contacto"
   },
   "dct:spatial": {
    "@id": "#paraguay"
   },
   "dct:temporal": {
    "@type": "dct:PeriodOfTime",
    "dcat:startDate": "2022-01-01",
    "dcat:endDate": "2022-12-31"
   },
   "dcat:version": "CNPV 2022",
   "dct:modified": "2026-10-08T19:18:59+00:00",
   "dct:rights": {
    "@type": "dct:RightsStatement",
    "rdfs:label": "INE, Cartografía digital CNPV 2022 (límites referenciales), Licencia de Uso de Información Pública. La unión con las claves del TSJE, de este sitio."
   },
   "dct:provenance": {
    "@type": "dct:ProvenanceStatement",
    "rdfs:label": "Cartografía digital del CNPV 2022 (INE), simplificada a 300 m (país), 500 m (departamentos) y 20 m (cada distrito)."
   },
   "dcat:landingPage": "https://kalaguichi.com/trep/",
   "dcat:distribution": [
    {
     "@id": "#limites-2022-departamentos",
     "@type": "dcat:Distribution",
     "dct:title": "Departamentos (departamentos.geojson)",
     "dcat:downloadURL": "https://kalaguichi.com/datos/municipales/2026/nacional/geo/departamentos.geojson",
     "dcat:accessURL": "https://kalaguichi.com/datos/municipales/2026/nacional/geo/departamentos.geojson",
     "dcat:mediaType": "https://www.iana.org/assignments/media-types/application/geo+json",
     "dct:conformsTo": "https://www.rfc-editor.org/rfc/rfc7946",
     "dcat:byteSize": 86773,
     "spdx:checksum": {
      "@type": "spdx:Checksum",
      "spdx:algorithm": "spdx:checksumAlgorithm_sha256",
      "spdx:checksumValue": "619d705721e99edf53703dfa5d5d92b24c84e47a06e0c5beb352f2b9fb524c0e"
     },
     "kg:campos": [
      "features[]: properties(departamento, nombre)"
     ]
    },
    {
     "@id": "#limites-2022-distrito",
     "@type": "dcat:Distribution",
     "dct:title": "Límite de un distrito, con más detalle",
     "dcat:accessURL": "https://kalaguichi.com/datos/README.md#plantillas",
     "dcat:mediaType": "https://www.iana.org/assignments/media-types/application/geo+json",
     "dct:conformsTo": "https://www.rfc-editor.org/rfc/rfc7946",
     "kg:plantillaURL": "https://kalaguichi.com/datos/municipales/2026/nacional/distritos/{clave}/comun/geo/distrito.geojson",
     "kg:clave": "la clave del distrito («departamento-distrito» del TSJE, como 11-17 para Luque), del campo clave de distritos en lista.json; Asunción (0-0) está en su propio conjunto",
     "kg:indice": "#trep-2026-pais-lista",
     "kg:partes": 262,
     "kg:bytesTotales": 4266838,
     "kg:campos": [
      "features[]: properties(clave, nombre)"
     ]
    }
   ]
  }
 ]
}
```
<!-- /generado:ejemplo -->

## Cómo se accede

- **URL absolutas.** Todo está en `https://kalaguichi.com/datos/…`, la misma ruta que tiene en esta carpeta. Las URL del
  catálogo son absolutas y no cambian (ver [Inmutabilidad](#inmutabilidad)).
- **Solo HTTP GET**, sin registro, claves ni límites propios: GitHub Pages sirve los archivos tal como están. No hay
  consultas ni filtros del lado del servidor: cada archivo es una respuesta completa, y los grandes se parten por distrito o
  por municipalidad.
- **CORS abierto.** GitHub Pages responde con `Access-Control-Allow-Origin: *`: una página de cualquier dominio puede leer
  los datos con `fetch`. No hace falta (ni sirve) una política «no-CORS».
- **Formatos.** JSON en UTF-8 (`application/json`, RFC 8259); GeoJSON en WGS84, longitud y latitud (`application/geo+json`,
  RFC 7946); fotos WebP (`image/webp`); mosaicos PMTiles v3 (`application/octet-stream`), que se leen por partes con
  HTTP Range; y la documentación en Markdown (`text/markdown`).
- **Caché.** GitHub Pages manda `Cache-Control: max-age=600` (10 minutos), `ETag` y `Last-Modified`: con
  `If-None-Match` un archivo sin cambios responde 304.
- **Claves para unir.** El distrito es `«departamento-distrito»` con los códigos del TSJE (Luque es `11-17`; Asunción,
  `0-0`; los nombres y las claves de los 263 están en `municipales/2026/nacional/lista.json`); une el TREP, las finanzas,
  el IPM y los límites. Los cargos son `1` (Intendencia) y `2` (Junta Municipal), y las listas van por su sigla. En la
  visualización financiera, cada municipalidad tiene un `id` (como `30-002`) y, en `municipios.json`, la clave de su
  distrito.
- **Integridad.** El SHA-256 de cada archivo está en su distribución (`spdx:checksum`) y en `huellas.json`:
  `sha256sum archivo.json` tiene que dar lo mismo.

## Carpetas, nombres y versiones

```text
datos/
├── catalog.json        el catálogo DCAT (lo genera tools/catalogo_datos.py)
├── huellas.json        tamaño y SHA-256 de cada archivo de datos/
├── README.md           esta guía
├── LEEME.md            el formato de los datos de cada elección
├── elecciones.json     las elecciones publicadas y el estado de cada fuente
├── <elección>/<año>/   electoral: comun/, trep/, oficial/ y nacional/ (con distritos/<clave>/)
├── <tema>/<institución>/<ejercicio>/   por ejemplo finanzas/municipalidad/2025/
├── <análisis>/<evento>/<corte>/        por ejemplo padron_analisis/municipales-2026/padron-2026/
├── mapa_base/          mapas base PMTiles con su procedencia
└── maquina_votacion/   inventario de software y vulnerabilidades
```

Las carpetas publicadas hoy:

<!-- generado:carpetas (tools/catalogo_datos.py) -->
| Carpeta | Archivos | Peso |
|---|---:|---:|
| `(raíz de datos/)` | 2 | 12 KB |
| `finanzas/municipalidad/2025/` | 10 | 834 KB |
| `mapa_base/` | 4 | 28,5 MB |
| `maquina_votacion/` | 5 | 4,3 MB |
| `municipales/2026/comun/` | 4 | 110 KB |
| `municipales/2026/comun/assets/` | 28 | 110 KB |
| `municipales/2026/comun/geo/` | 8 | 2,8 MB |
| `municipales/2026/nacional/` | 5 | 499 KB |
| `municipales/2026/nacional/distritos/` | 1572 | 6,0 MB |
| `municipales/2026/nacional/geo/` | 2 | 533 KB |
| `municipales/2026/trep/` | 3 | 279 KB |
| `padron_analisis/municipales-2026/padron-2026/` | 3 | 128 KB |
| `visualizacion_financiera/municipalidad/2025/` | 5 | 146 KB |
| `visualizacion_financiera/municipalidad/2025/detalle/` | 247 | 3,4 MB |
| `visualizacion_financiera/municipalidad/2025/municipios/` | 247 | 4,1 MB |
| **Total** (sin `catalog.json`, `huellas.json` ni `README.md`) | 2145 | 51,7 MB |
<!-- /generado:carpetas -->

### Nombres

- Carpetas y archivos en minúsculas, sin espacios ni acentos; las palabras con guion bajo (`indicadores_barrios.json`) y
  las claves y los códigos con guion (`11-17`, `30-002`, `municipales-2026`).
- El año va en cuatro cifras y las fechas en ISO 8601 (`2026-10-04`, `2026-10-04T23:48:02`).
- `.json` para JSON y `.geojson` para GeoJSON. Cada carpeta lleva su procedencia (`procedencia.json` o un manifiesto) con
  las fuentes, las huellas de los originales y el programa que la generó.

### Versionado

- **El esquema** va con un número entero en el campo `version` de cada archivo (o de su manifiesto). Sube solo con un
  cambio incompatible, que además necesita una decisión registrada del proyecto; un campo nuevo no lo cambia.
- **Los datos** se versionan por fecha o por corte de su fuente, en `dcat:version`: el corte del TREP, el ejercicio y el
  corte del MEF, el build de OpenStreetMap o la fecha de consulta de NVD. `dct:modified` es cuándo se generaron.
- **El catálogo** tiene en `dcat:version` los primeros 12 caracteres del SHA-256 de `huellas.json`: cambia con cualquier
  archivo de datos.

### Inmutabilidad

- Un archivo publicado no cambia de contenido sin que cambie su versión en el catálogo, y su ruta no se mueve ni se borra.
- Un corte nuevo de una fuente va a su propia carpeta y no pisa el anterior: el cómputo oficial va a `oficial/`, junto al
  TREP (`trep/`), y otro corte del TREP iría a una carpeta con su fecha.
- Cada publicación es un commit de la rama `gh-pages` del
  [repositorio](https://github.com/luchobenitez/kalaguichi): una versión anterior de cualquier archivo se puede bajar
  por su commit desde `https://raw.githubusercontent.com/luchobenitez/kalaguichi/<commit>/datos/…`.

## Licencias y cómo citar

- **El catálogo, esta guía y los datos que elabora el sitio** (uniones, conteos, indicadores calculados): CC BY-SA 4.0.
- **Los datos oficiales** (TSJE, INE, MEF y Municipalidad de Asunción) siguen con las condiciones de su fuente: cada
  conjunto lo dice en `dct:rights`.
- **El mapa base**: ODbL 1.0, © colaboradores de OpenStreetMap.
- **Las vulnerabilidades**: NVD (NIST), el catálogo KEV de CISA y OSV.dev, con la licencia de cada base.

Para citar un conjunto: «Kalaguichi.com, *título del conjunto*, versión *dcat:version*, *URL del archivo*».

## Privacidad

Ningún archivo trae cédulas, nombres de electores ni fechas de nacimiento. El padrón está solo en conteos (por sexo y por
edad), con las celdas muy chicas reservadas; los nombres de las candidaturas son públicos. La consulta del padrón del sitio
es una demostración con datos sintéticos y no está en el catálogo.

## Con ChatGPT u otros asistentes de IA

El catálogo está pensado para que un asistente lea primero la descripción de todo y baje después solo el archivo que hace
falta, sin llenar su memoria de trabajo. Copiá estas instrucciones al empezar una conversación o en las instrucciones de un
GPT personalizado. Para que funcione, el asistente tiene que poder abrir enlaces (la búsqueda o la navegación web); si no
puede, bajá el archivo desde la URL que te indique y subilo a la conversación.

<!-- prompt:inicio -->
```text
Actuá como analista de datos de Kalaguichi.com, una plataforma ciudadana e independiente con datos abiertos sobre el sistema electoral paraguayo (no está vinculada al TSJE ni a ningún partido). Respondé en español.

Tu fuente es el catálogo https://kalaguichi.com/datos/catalog.json (W3C DCAT 3 en JSON-LD). Usá solo las URL que figuran en él: no inventes rutas ni uses copias de otros sitios.

Trabajá siempre en dos pasos.

Paso 1. Descubrir. Antes de cualquier análisis, leé el catálogo. En "dcat:dataset", buscá el conjunto que tenga lo que pide la pregunta: mirá "dct:title", "dct:description", "dcat:keyword", "dct:temporal", "dct:spatial" y, en cada "dcat:distribution", "kg:campos" (los campos del archivo). Elegí la distribución más chica que alcance ("dcat:byteSize"). Si la distribución es una plantilla ("kg:plantillaURL"), buscá la clave en su índice ("kg:indice"; por ejemplo, la clave 11-17 de Luque está en lista.json) y armá la URL reemplazando {clave} o {id}.

Paso 2. Bajar solo eso. Descargá únicamente ese archivo, por su "dcat:downloadURL" o por la URL que armaste, y hacé con él el análisis o el gráfico. No bajes carpetas enteras ni archivos que no hacen falta, y no vuelvas a leer el catálogo si ya lo tenés. Si podés ejecutar código con acceso a internet, bajalo con código y comprobá su SHA-256 ("spdx:checksum"); si solo podés navegar, abrí la URL; si no podés abrirla o el contenido llega cortado, pedime que lo descargue y lo suba, y decime la URL exacta.

Al responder:
- Nombrá el conjunto ("dct:title") y la URL del archivo que usaste, con su versión o su corte ("dcat:version").
- Los resultados del TREP son preliminares: no reemplazan al cómputo oficial. Decilo cuando los uses.
- Las finanzas son cifras del MEF; los indicadores que calcula el sitio no son calificaciones oficiales.
- Los archivos no tienen datos de personas: no intentes identificar electores ni deducir el voto de nadie. El padrón está solo en conteos.
- Para cruzar dominios, usá la clave del distrito («departamento-distrito» del TSJE; Asunción es 0-0).
- Si el catálogo no tiene lo que hace falta, decilo; no completes con suposiciones ni con datos de otra fuente sin avisarme.
- Al reutilizar los datos, respetá la licencia o las condiciones de cada conjunto ("dct:license" o "dct:rights").
```
<!-- prompt:fin -->

## Contacto

Para consultas, correcciones o sugerencias, abrí un [issue en el repositorio](https://github.com/luchobenitez/kalaguichi/issues).
Los issues son públicos: no incluyas cédulas, fechas de nacimiento ni otros datos personales.
