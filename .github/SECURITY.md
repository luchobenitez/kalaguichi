# Política de seguridad

## Versión con soporte

Solo la versión publicada: la que GitHub Pages sirve en https://kalaguichi.com/ desde la rama `gh-pages`. Las versiones
anteriores no tienen soporte.

## Cómo avisar una falla

**No la publiques en un issue.** Usá el reporte privado de GitHub:

1. Entrá a la pestaña **Security** del repositorio.
2. Elegí **Report a vulnerability**. También podés ir directo a
   https://github.com/luchobenitez/kalaguichi/security/advisories/new.
3. Contá la falla: la página o el archivo, los pasos para reproducirla, el impacto y el navegador y el dispositivo en
   los que la viste.

Si la falla expone datos de personas, **no copies esos datos en el reporte**: decí dónde están (la dirección o el
archivo) y cómo se llega a ellos.

El reporte lo ve solo el responsable del proyecto, que te contesta por ese mismo reporte para coordinar la corrección y
el aviso público. Te pedimos que no divulgues la falla hasta que esté corregida o hasta acordar una fecha.

## Lo que más nos importa

- Datos de personas del padrón (cédulas, nombres de electores, fechas de nacimiento) en cualquier archivo publicado, o
  una manera de deducirlos de los conteos publicados.
- Ejecución de código en el navegador (XSS) a partir de la dirección (lo que va después de `#`), de un archivo de datos o
  de un texto, o una manera de saltear la política de seguridad de contenido (CSP).
- Que una página cargue algo de otro dominio o mande datos a terceros.
- Archivos publicados que no coinciden con la procedencia que declaran (las huellas SHA-256 de `procedencia.json` y de
  los manifiestos de los datos).
- Vulnerabilidades conocidas de las bibliotecas copiadas en el sitio que lo afecten: Chart.js 4.5.1, MapLibre GL JS
  6.13.0 y pmtiles 4.5.0.
- Problemas de la configuración del dominio o de GitHub Pages que permitan servir otro contenido en kalaguichi.com.

## Lo que no es una falla

Son decisiones documentadas del proyecto:

- **La consulta del padrón es una demostración con datos sintéticos.** Su clave es pública a propósito
  (`padron/config/clave-demo.txt`): con ella se puede descifrar todo el conjunto sintético. El cifrado prueba el
  mecanismo, pero no da confidencialidad ni identifica a quien consulta. La cédula y la fecha de nacimiento son criterios
  de búsqueda, no una autenticación. El padrón real no se publica.
- **GitHub Pages no deja configurar cabeceras HTTP**, así que la CSP va en una etiqueta `meta` de cada página (y por eso
  no tiene `frame-ancestors`).
- **Un dato que no coincide con su fuente** es un «Dato observado» (hay un formulario de issue para eso), no una falla de
  seguridad.
- La denegación de servicio, la ingeniería social, la infraestructura de GitHub y los informes automáticos sin un impacto
  demostrado.

## Investigación de buena fe

Agradecemos la investigación de buena fe. Probá solo con tus propios datos o con los sintéticos de la demostración, no
intentes acceder a datos de otras personas ni degradar el servicio, y danos un tiempo razonable para corregir antes de
divulgar.

## Cómo está construido

- Es un sitio estático: no tiene servidor propio, cuentas, base de datos ni formularios que manden datos.
- Cada página declara la CSP `default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src
  'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`, y las páginas con mapa agregan
  `worker-src 'self'`.
- El navegador guarda solo el tema (`localStorage`) y la selección que comparten las páginas durante la sesión
  (`sessionStorage`).
- Cada publicación se verifica en vivo: cada archivo publicado tiene que ser idéntico al local y las secciones se
  recorren en un navegador sin errores ni pedidos a terceros.
