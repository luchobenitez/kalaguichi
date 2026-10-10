// «Intendente vs Junta» (voto cruzado por local) dentro de la sección Análisis: el módulo intendente_junta.js con su
// misma estructura (plantillas de la página), el filtro de zona o barrio de la sección y el nombre de la fuente.
import { crearIntendenteJunta } from './intendente_junta.js';
import { mezclar, cuantiles, opacidadPaso } from '../tablero/mapa.js';
import { crearMapaGL } from '../tablero/mapa_gl.js';
import { $, el, movimiento } from '../tablero/util.js';

const ANGOSTO = matchMedia('(max-width: 899px)');

export function crear(ctx) {
    const copiar = (id) => document.getElementById(id).content.cloneNode(true);
    ctx.controles.append(copiar('plantillaIvjControles'));
    ctx.cuerpo.append(copiar('plantillaIvjCuerpo'));
    ctx.tabla.append(copiar('plantillaIvjTabla'));
    ctx.cuerpo.id = 'panelIvj';
    const lectura = el('div');
    lectura.append(copiar('plantillaIvjLectura'));
    ctx.lectura.append(lectura);
    const ivj = crearIntendenteJunta(ctx.datos, {
        // Mapa de MapLibre con el mapa base; la página se desplaza: el mapa se mueve con dos dedos (o Ctrl + rueda).
        crearMapa: (id, etiqueta, alElegir) => crearMapaGL(ctx.datos, document.getElementById(id), { etiqueta, gestosCooperativos: true,
                                                                                                  alTocarLocal: alElegir }),
        // ADR-032: el mapa sigue al grupo elegido y tiene el deslizador de votos emitidos por mesa.
        mapaPorGrupo: true,
        deslizadorEmitidos: true,
        mezclar, cuantiles, opacidadPaso, movimiento,
        ficha: ctx.ficha,
        usarFicha: () => ANGOSTO.matches || Boolean(document.querySelector('.mapa--pantalla')),
        alCambiar: () => ctx.alCambiar(),
        idFiltro: 'filtroGeo',
        fuente: { nombre: ctx.nombreFuente, momento: ctx.momentoFuente },
    });
    let enlace = {};
    return {
        titulo: 'Intendente vs Junta',
        meta: () => $('metaIvj')?.textContent ?? '',
        render: () => {
            ivj.aplicarEnlace({ ...ivj.estadoEnlace(), ...enlace, filtro: ctx.filtro() });
            enlace = {};
            return ivj.render();
        },
        csv: () => $('csvIvj').click(),
        png: () => $('pngIvj').click(),
        estadoEnlace: () => {
            const e = ivj.estadoEnlace();
            return { grupo: e.grupo === 'L1' ? null : e.grupo, metrica: e.metrica === 'votos' ? null : e.metrica,
                     grafico: e.grafico === 'divergentes' ? null : e.grafico, local: e.local, emitidos: e.emitidos || null,
                     grupo_mapa: e.grupo === 'ambos' && e.grupoMapa === 'AL' ? 'AL' : null };
        },
        // El hash se aplica en el próximo render (junto con el filtro de la sección).
        aplicarEnlace(p) {
            enlace = { grupo: p.get('grupo'), metrica: p.get('metrica'), grafico: p.get('grafico'), local: p.get('local'),
                       emitidos: p.get('emitidos'), grupoMapa: p.get('grupo_mapa') };
        },
    };
}
