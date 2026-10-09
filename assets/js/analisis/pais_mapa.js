// Mapa de Paraguay por distrito para los análisis del país (ADR-025, tarea M29): el mismo mapa del TREP
// (tablero/mapa_pais.js: MapLibre, límites del INE y el mapa base del país de ADR-026), en la caja del análisis, con la leyenda y el
// dato del distrito debajo. El globo sigue al puntero; un toque muestra el dato en la línea de abajo (también para
// lectores de pantalla). El departamento del filtro se encuadra y los distritos de afuera se atenúan. Sin HTML desde datos.
import { geoNacional } from '../datos.js';
import { crearMapaPais } from '../tablero/mapa_pais.js';
import { enlaceOsm } from '../tablero/base_pais.js';
import { PASO_ELECTORES } from './pais_datos.js';
import { el, fmt, cantidad, porcentaje } from '../tablero/util.js';

// El gris de los distritos que no superan el mínimo de electores, en cada tema: neutro y distinto del fondo del mapa
// (ninguna lista ganadora usa gris).
const GRIS = { claro: '#9ca3af', oscuro: '#4b5563' };
export const grisMinimo = () => GRIS[document.documentElement.dataset.theme === 'dark' ? 'oscuro' : 'claro'];

// El mínimo de electores (ADR-025; también en ADR-027): deslizador de 0 al tope, de a PASO_ELECTORES, con el valor, los
// extremos y la cuenta a la vista. id: el del <input>, único en la página; alMover(minimo) mientras se arrastra y
// alSoltar(minimo) al soltar. mostrar(minimo, texto) refleja el estado.
export function crearDeslizador(contenedor, { id, maximo, alMover, alSoltar }) {
    const control = el('div', 'deslizador');
    const etiqueta = el('label', 'deslizador__etiqueta');
    const rango = el('input', 'deslizador__rango');
    rango.type = 'range';
    rango.id = id;
    rango.min = '0';
    rango.max = String(maximo);
    rango.step = String(PASO_ELECTORES);
    etiqueta.htmlFor = rango.id;
    const valor = el('output', 'deslizador__valor');
    valor.setAttribute('for', rango.id);
    etiqueta.append('Electores habilitados (padrón): más de ', valor);
    const extremos = el('p', 'deslizador__extremos');
    extremos.append(el('span', null, '0'), el('span', null, fmt.format(maximo)));
    const cuenta = el('p', 'deslizador__cuenta');
    cuenta.setAttribute('aria-live', 'polite');
    control.append(etiqueta, rango, extremos, cuenta);
    contenedor.append(control);
    rango.addEventListener('input', () => alMover(Number(rango.value)));
    rango.addEventListener('change', () => alSoltar(Number(rango.value)));
    return {
        rango,
        mostrar(minimo, texto) {
            rango.value = String(minimo);
            valor.value = fmt.format(minimo);
            rango.setAttribute('aria-valuetext', `más de ${fmt.format(minimo)} electores`);
            cuenta.textContent = texto;
        },
    };
}

// La cuenta del deslizador: cuántos de los distritos del filtro superan el mínimo y qué parte de los electores reúnen.
export function textoCuenta(ctx, dentro, visibles, electoresDe) {
    const total = dentro.reduce((a, d) => a + electoresDe(d), 0);
    const suyos = visibles.reduce((a, d) => a + electoresDe(d), 0);
    return `${visibles.length} de ${cantidad(dentro.length, 'distrito', 'distritos')} · ${porcentaje(suyos, total)} % de los electores` +
        (ctx.filtro() ? ` de ${ctx.textoFiltro()}` : ' del país');
}

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
        // La atribución es la del análisis (crearMapaPais pone la del TREP), con la del mapa base.
        pie.replaceChildren(enlaceOsm(), ' (ODbL) · Protomaps · ', atribucion.texto);
        pie.title = `Mapa base: rutas, ríos y arroyos de OpenStreetMap (ODbL), del build de Protomaps. ${atribucion.titulo}`;
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
