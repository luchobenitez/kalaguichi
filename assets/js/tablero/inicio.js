// Entrada de las secciones de resultados (TREP y oficiales): el tablero en una pantalla por omisión y la «Vista
// informe» (la página vertical anterior, solo del TREP) con #modo=informe. Cada vista vive en su <template> de la página;
// se copia una sola y se carga solo su módulo, así el tablero no descarga el código del informe (ni Chart.js) y
// viceversa. Con la fuente aún no publicada no se carga ninguna de las dos: solo el aviso (pendiente.js).
import { manifiesto, elegir } from '../datos.js';

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
// La vista informe existe solo donde la página tiene su plantilla (la sección del TREP).
const modo = modoDe(location.hash) === 'informe' && document.getElementById('plantillaInforme') ? 'informe' : 'tablero';
// Pasar de una vista a la otra (un enlace o el hash editado a mano) recarga la página: cada vista arma su propio DOM.
// Va antes de cargar la vista para que su propio aviso de cambio de hash no llegue a ejecutarse.
addEventListener('hashchange', (evento) => {
    if (modoDe(location.hash) === modo || !document.getElementById('plantillaInforme')) return;
    evento.stopImmediatePropagation();
    location.reload();
});

const fuente = visor.dataset.fuente || 'trep';
const contexto = await manifiesto().then((m) => elegir(m, { eleccion: pedido.get('eleccion'), anio: pedido.get('anio') })).catch(() => null);
if (contexto && (contexto.anio.fuentes?.[fuente]?.estado ?? 'pendiente') !== 'publicado') {
    const { mostrarPendiente } = await import('./pendiente.js');
    await mostrarPendiente({ fuente, ...contexto });
} else {
    visor.classList.add(...(modo === 'informe' ? ['portal', 'resultados'] : ['tablero']));
    visor.dataset.modo = modo;
    document.documentElement.classList.toggle('es-tablero', modo === 'tablero');
    visor.append(document.getElementById(modo === 'informe' ? 'plantillaInforme' : 'plantillaTablero').content.cloneNode(true));
    const { iniciar } = await import(modo === 'informe' ? './resultados.js' : './tablero.js');
    iniciar({ fuente });
}
