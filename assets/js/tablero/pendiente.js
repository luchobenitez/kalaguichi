// Fuente aún no publicada (por ejemplo, el cómputo oficial antes de su publicación): en lugar del tablero, el aviso y
// un enlace a la otra fuente con el mismo contexto (hash). inicio.js lo carga en lugar del tablero, que no se descarga.
import { estado as compartido, listo as shellListo } from '../shell.js';
import { el } from './util.js';

const SECCION_DE = { trep: 'trep', oficial: 'oficiales' };

export async function mostrarPendiente({ fuente, eleccion, anio }) {
    const visor = document.getElementById('visor');
    const otra = fuente === 'trep' ? 'oficial' : 'trep';
    document.documentElement.classList.remove('es-tablero');
    visor.className = 'portal';
    visor.dataset.estado = 'pendiente';
    const nombre = anio.fuentes?.[fuente]?.nombre ?? fuente;
    const seccion = el('section', 'info-card estado-vacio');
    seccion.setAttribute('aria-labelledby', 'tituloPendiente');
    const titulo = el('h1', null, fuente === 'oficial' ? 'Los resultados oficiales de esta elección aún no fueron publicados'
        : 'Los resultados del TREP de esta elección aún no fueron publicados');
    titulo.id = 'tituloPendiente';
    const otraPublicada = anio.fuentes?.[otra]?.estado === 'publicado';
    const texto = fuente === 'oficial'
        ? 'Cuando se publique el cómputo oficial, esta sección lo mostrará con el mismo tablero que el TREP.' +
          (otraPublicada ? ' Mientras tanto, podés ver los resultados preliminares del TREP con el mismo contexto.' : '')
        : (otraPublicada ? 'Podés ver los resultados oficiales con el mismo contexto.' : '');
    seccion.append(el('p', 'panel__eyebrow', `${nombre} · ${eleccion.nombre} ${anio.anio}${anio.ambito ? ` · ${anio.ambito}` : ''}`), titulo);
    if (texto) seccion.append(el('p', null, texto));
    if (otraPublicada) {
        const enlace = el('a', 'boton-secundario', fuente === 'oficial' ? 'Ver el TREP' : 'Ver los resultados oficiales');
        enlace.id = 'verOtraFuente';
        // El enlace lleva el contexto actual, también si cambia el cargo en la barra de contexto.
        const destino = () => enlace.setAttribute('href', `../${SECCION_DE[otra]}/${location.hash}`);
        destino();
        compartido.suscribir(destino);
        const parrafo = el('p');
        parrafo.append(enlace);
        seccion.append(parrafo);
    }
    visor.replaceChildren(seccion);
    visor.setAttribute('aria-busy', 'false');
    await shellListo;
    visor.dataset.listo = 'true';
}
