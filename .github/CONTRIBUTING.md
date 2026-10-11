# Cómo contribuir a Kalaguichi.com

Gracias por querer mejorar el proyecto. Kalaguichi.com busca que cualquier persona pueda pasar de una afirmación a la
evidencia que la sustenta, así que avisar un error o un dato mal tomado vale tanto como aportar código.

## Antes de empezar

- Leé el [código de conducta](CODE_OF_CONDUCT.md): rige en todos los espacios del proyecto.
- **Los issues y los pull requests son públicos.** No incluyas cédulas, fechas de nacimiento, nombres de electores,
  direcciones ni otros datos personales, tuyos o ajenos, ni en el texto ni en las capturas de pantalla.
- Una falla de seguridad no va en un issue: seguí la [política de seguridad](SECURITY.md).
- Para saber dónde votás o si figurás en el padrón, consultá a la Justicia Electoral (https://www.tsje.gov.py/): la
  consulta de este sitio es una demostración con datos sintéticos.

## Formas de ayudar

Cada una tiene su formulario al [abrir un issue](https://github.com/luchobenitez/kalaguichi/issues/new/choose):

- **Error en el sitio**: algo no funciona o se ve mal en una página.
- **Dato observado**: un número, un nombre o una ubicación no coincide con su fuente oficial. Poné el enlace a la fuente y
  la dirección completa de la página, que guarda la selección después de `#`.
- **Propuesta**: un análisis, una fuente de datos o una mejora.
- **Consulta**: una pregunta sobre los datos, los métodos o el proyecto.

También podés proponer un cambio de código o de texto con un pull request (ver más abajo).

## Cómo está organizado el repositorio

La rama `gh-pages`, la única, es el sitio publicado, junto con los archivos del proyecto (el README, las licencias y
esta carpeta `.github/`). El sitio se arma en el espacio de trabajo del responsable, donde están los programas que
preparan los datos, las pruebas y el registro de decisiones, que no se publican. Cada publicación reemplaza el contenido
de la rama por el del sitio ya probado. De ahí salen dos consecuencias:

- **Un pull request no se fusiona en GitHub.** La publicación siguiente lo pisaría, y además se saltearía las pruebas. El
  responsable reproduce el cambio en el origen, lo prueba y lo publica, y después cierra el pull request con el enlace a
  esa publicación y la mención de tu aporte.
- **Muchos archivos se generan**: los datos de `datos/`, la página de Acerca de, las páginas «Historia de la
  adquisición» y «La máquina» y el tablero de Resultados oficiales, que es una copia del tablero del TREP. Si tu cambio toca uno de esos archivos,
  contá qué querés lograr y el responsable lo hace en su origen. Para una corrección que necesita volver a procesar
  datos, alcanza con el issue.

## Reglas del proyecto

Las decidió el proyecto y valen para todo aporte:

1. **Datos públicos y verificables.** Cada dato lleva su fuente, su fecha o su corte, el método y los límites, y, cuando
   se puede, la huella SHA-256 del archivo de origen.
2. **Ningún dato de personas del padrón en el sitio.** Solo agregados (país, departamento y distrito, nunca local ni
   mesa), con reserva de las celdas chicas.
3. **Nada de inferencias sobre personas.** No se infiere voto, fallecimiento ni pertenencia a un grupo a partir de la
   edad, los nombres o los datos que faltan. `null` es desconocido, nunca cero; «N/D» es un dato que falta en la fuente y
   «—», un cálculo que no corresponde.
4. **Cada cosa con su nombre.** El TREP preliminar no es el cómputo oficial; los electores habilitados no son los
   habitantes; un indicador calculado no es una calificación oficial; una CVE de un componente no prueba que la máquina
   sea vulnerable.
5. **Todo lo que el sitio carga está dentro del sitio.** Ni CDN ni servicios de terceros. Cada página tiene una CSP de
   mismo origen: sin scripts, estilos ni eventos en línea y sin `eval`. Una biblioteca nueva se copia en
   `assets/vendor/`, con su licencia y su huella, y la decide el responsable.
6. **El mismo menú en todas las páginas.** Una sección nueva lleva su carpeta, una página con la misma cabecera y la
   misma CSP que las demás, su entrada en el menú de todas las páginas y su tarjeta en la portada.
7. **Imágenes de terceros solo con procedencia y derechos verificados.**
8. **Un cambio en el esquema de los datos necesita una decisión registrada.**
9. **Independencia.** El sitio no favorece a ningún partido, movimiento ni candidatura. Los textos van en castellano,
   con el tono del sitio, y describen sin calificar.

## Pull requests

- Un cambio por pull request, con el porqué.
- Probalo en computadora y en celular, con el tema claro y con el oscuro (y, si podés, en más de un navegador), y contá
  dónde lo probaste en la plantilla.
- Si cambia un dato o un texto con cifras, poné la fuente.
- Usá módulos JavaScript sin dependencias nuevas.
- El responsable corre después las pruebas del espacio de trabajo: las unitarias, las de navegador (que comparan lo que
  muestra la página con un cálculo independiente), la revisión en cuatro tamaños y dos temas y, al publicar, la
  verificación en vivo.

## Licencia de los aportes

Al contribuir, aceptás que tu aporte se publique con las licencias del proyecto: AGPL-3.0 para el código y CC BY-SA 4.0
para los textos, los datos elaborados y las imágenes (ver el [README](../README.md#licencias)). No aportes material de
terceros sin indicar su origen y su licencia.

## Tiempos

Kalaguichi.com es una iniciativa independiente: los aportes se revisan a medida que se puede.
