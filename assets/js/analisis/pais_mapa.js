// Mapa de Paraguay por distrito para los análisis del país (ADR-025, tarea M29): el mismo mapa del TREP
// (tablero/mapa_pais.js: MapLibre, sin mapa base de calles, límites del INE), en la caja del análisis, con la leyenda y el
// dato del distrito debajo. El globo sigue al puntero; un toque muestra el dato en la línea de abajo (también para
// lectores de pantalla). El departamento del filtro se encuadra y los distritos de afuera se atenúan. Sin HTML desde datos.
import { geoNacional } from '../datos.js';
import { crearMapaPais } from '../tablero/mapa_pais.js';
import { el } from '../tablero/util.js';

let geoEnCurso = null;
// La geometría del país, una sola vez para los análisis que la usan.
function geoPais(eleccion, anio) {
    geoEnCurso ??= Promise.all([geoNacional(eleccion, anio, 'distritos'), geoNacional(eleccion, anio, 'departamentos')])
        .then(([distritos, departamentos]) => ({ distritos, departamentos }));
    return geoEnCurso;
}

// La caja del país: la unión de las de sus departamentos.
const cajaPais = (departamentos) => departamentos.reduce((c, d) => [Math.min(c[0], d.caja[0]), Math.min(c[1], d.caja[1]),
    Math.max(c[2], d.caja[2]), Math.max(c[3], d.caja[3])], [Infinity, Infinity, -Infinity, -Infinity]);

// ctx: el del análisis (datos, cuerpo, filtro); opciones: etiqueta (texto accesible del mapa), atribucion (texto y título
// de la atribución), texto(clave) (el globo y el dato al tocar) y alCambiarTema().
export function crearMapaAnalisis(ctx, { etiqueta, atribucion, texto, alCambiarTema }) {
    const { datos } = ctx;
    const caja = el('div', 'mapa analisis__mapa');
    const pie = el('p', 'mapa__atribucion');
    caja.append(pie);
    const leyenda = el('ul', 'leyenda analisis__leyenda');
    const dato = el('p', 'nota analisis__dato');
    dato.setAttribute('aria-live', 'polite');
    dato.textContent = matchMedia('(hover: hover)').matches ? 'Pasá el puntero por un distrito o tocalo para ver su dato.' : 'Tocá un distrito para ver su dato.';
    ctx.cuerpo.append(caja, leyenda, dato);
    let mapa = null;
    let encuadre;   // la caja pedida: undefined, ninguna todavía; null, el país

    const { eleccion, anio } = datos.contexto;
    const listo = geoPais(eleccion.id, anio.anio).then((geo) => {
        mapa = crearMapaPais(geo, { distritos: datos.distritos.map((d) => ({ clave: d.clave, nombre: d.nombre, centro: d.centro })), departamentos: datos.departamentos },
            caja, { etiqueta, atribucion: pie, pais: cajaPais(datos.departamentos), texto, leyendas: () => [leyenda], alCambiarTema,
                    alTocar: (clave) => {
                        mapa.elegir(clave);
                        dato.textContent = texto(clave) ?? '';
                    } });
        // La atribución es la del análisis (crearMapaPais pone la del TREP).
        pie.textContent = atribucion.texto;
        pie.title = atribucion.titulo;
        return mapa.listo;
    }).then(() => true, (error) => {
        caja.append(el('p', 'mapa__sin-mapa', 'No se pudo mostrar el mapa en este navegador (necesita WebGL). La tabla sigue disponible.'));
        console.warn(error);
        return false;
    });

    return {
        listo,
        leyenda,
        // fn(d) → { color, atenuado } para cada distrito del cargo; el departamento del filtro, encuadrado.
        async pintar(distritos, fn) {
            if (!(await listo)) return;
            // La caja pudo estar oculta (otro análisis a la vista) mientras cambiaba el tamaño de la ventana.
            mapa.map.resize();
            const por = new Map(distritos.map((d) => [d.clave, d]));
            mapa.pintar([...por.keys()], (clave) => fn(por.get(clave)));
            const dep = ctx.filtro() ? datos.porDep.get(Number(ctx.filtro().slice(1))) : null;
            const pedida = dep?.caja ?? null;
            if (pedida !== encuadre) {
                encuadre = pedida;
                await mapa.encuadrar(pedida);
            }
        },
        // Una copia del lienzo del mapa tal como se ve (para el PNG) y su escala; null sin mapa.
        async imagen() {
            if (!(await listo)) return null;
            const lienzo = mapa.map.getCanvas();
            return new Promise((resolver) => {
                // En el evento «render» el cuadro recién dibujado sigue en el lienzo de WebGL.
                mapa.map.once('render', () => {
                    const copia = el('canvas');
                    copia.width = lienzo.width;
                    copia.height = lienzo.height;
                    copia.getContext('2d').drawImage(lienzo, 0, 0);
                    resolver({ lienzo: copia, escala: lienzo.width / (lienzo.clientWidth || lienzo.width) });
                });
                mapa.map.triggerRepaint();
            });
        },
    };
}
