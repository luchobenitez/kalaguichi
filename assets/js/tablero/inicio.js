// Entrada de las secciones de resultados (TREP y oficiales): el mapa del país (ADR-022: el TREP abre en Paraguay, por
// distrito), el tablero de un distrito en una pantalla y la «Vista informe» de Asunción (la página vertical anterior, solo
// del TREP) con #modo=informe. Cada vista vive en su <template> de la página; se copia una sola y se carga solo su
// módulo, así ninguna descarga el código de las otras (ni Chart.js). Con la fuente aún no publicada no se carga ninguna:
// solo el aviso (pendiente.js).
import { manifiesto, elegir, listaDistritos } from '../datos.js';
import { ambitoDe, ASUNCION, TABLERO_DE_DISTRITO } from '../ambito.js';

const modoDe = (hash) => {
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    return p.get('modo') === 'informe' || p.get('analisis') === 'voto-cruzado' || p.get('cargo') === 'c' ? 'informe' : 'tablero';
};

const visor = document.getElementById('visor');
// El voto cruzado vive en Análisis (ADR-019): un enlace al TREP con el voto cruzado y sin modo=informe va allí.
const pedido = new URLSearchParams(location.hash.slice(1));
if ((pedido.get('analisis') === 'voto-cruzado' || pedido.get('cargo') === 'c') && pedido.get('modo') !== 'informe') {
    if (pedido.get('cargo') === 'c') pedido.set('cargo', 'intendencia');
    pedido.set('analisis', 'voto-cruzado');
    location.replace(new URL(`../analisis/#${pedido}`, location.href));
    await new Promise(() => {});
}

const fuente = visor.dataset.fuente || 'trep';
const contexto = await manifiesto().then((m) => elegir(m, { eleccion: pedido.get('eleccion'), anio: pedido.get('anio') })).catch(() => null);
// El país existe donde el año declara datos nacionales de la fuente y la página tiene su plantilla (la sección del TREP).
const conPais = Boolean(contexto?.anio.nacional?.fuentes?.includes(fuente)) && Boolean(document.getElementById('plantillaPais'));
const lista = conPais ? await listaDistritos(contexto.eleccion.id, contexto.anio.anio).catch((error) => { console.warn(error); return null; }) : null;
const claves = new Set(lista?.distritos.map(([clave]) => clave) ?? []);

// La vista que corresponde a un hash: 'informe' (solo Asunción), 'tablero' (Asunción u otro distrito, con su clave) o
// 'pais'.
function vistaDe(hash) {
    const { distrito } = ambitoDe(hash);
    const deAsuncion = !lista || distrito === null || distrito === ASUNCION || !claves.has(distrito);
    if (modoDe(hash) === 'informe' && document.getElementById('plantillaInforme') && deAsuncion) return 'informe';
    if (!lista) return 'tablero';
    if (distrito === ASUNCION) return 'tablero';
    if (distrito && claves.has(distrito) && TABLERO_DE_DISTRITO) return `tablero:${distrito}`;
    return 'pais';
}
const vista = vistaDe(location.hash);
// Pasar de una vista a otra (un enlace, el selector de distrito o el hash editado a mano) recarga la página: cada vista
// arma su propio DOM. Va antes de cargar la vista para que su propio aviso de cambio de hash no llegue a ejecutarse.
addEventListener('hashchange', (evento) => {
    if (vistaDe(location.hash) === vista) return;
    evento.stopImmediatePropagation();
    location.reload();
});

if (contexto && (contexto.anio.fuentes?.[fuente]?.estado ?? 'pendiente') !== 'publicado') {
    const { mostrarPendiente } = await import('./pendiente.js');
    await mostrarPendiente({ fuente, ...contexto });
} else if (vista === 'pais') {
    visor.classList.add('tablero', 'tablero--pais');
    visor.dataset.modo = 'pais';
    document.documentElement.classList.add('es-tablero');
    visor.append(document.getElementById('plantillaPais').content.cloneNode(true));
    const { iniciar } = await import('./pais.js');
    iniciar({ fuente, contexto, lista });
} else {
    const modo = vista === 'informe' ? 'informe' : 'tablero';
    visor.classList.add(...(modo === 'informe' ? ['portal', 'resultados'] : ['tablero']));
    visor.dataset.modo = modo;
    document.documentElement.classList.toggle('es-tablero', modo === 'tablero');
    visor.append(document.getElementById(modo === 'informe' ? 'plantillaInforme' : 'plantillaTablero').content.cloneNode(true));
    const { iniciar } = await import(modo === 'informe' ? './resultados.js' : './tablero.js');
    iniciar({ fuente });
}
