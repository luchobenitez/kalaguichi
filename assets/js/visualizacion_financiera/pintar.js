// Visualización financiera (ADR-035; tarea M46): una escena de geometria.js en tres destinos.
// - En la página, un SVG cuyos colores vienen de la hoja de estilos por rol (.kvf-rol-pagado…): cambiar el tema no recalcula
//   ni redibuja nada.
// - Para descargar, un SVG autónomo con los colores del tema elegido escritos en cada elemento y su propio <style> (abre fuera
//   del sitio; sin fuentes incrustadas: usa las del sistema).
// - En un lienzo, para el PNG: la política de seguridad del sitio no admite imágenes data: ni blob:, así que el PNG no sale
//   de convertir el SVG sino de pintar la misma escena con la API del lienzo (como los análisis con Chart.js).
import { FUENTE } from './geometria.js';

const SVG = 'http://www.w3.org/2000/svg';
const PATRONES = ['rayado', 'nd', 'negativo', 'pendiente'];
let serie = 0;

function nodoSvg(tag, atributos = {}) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(atributos)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
    return n;
}

function definiciones(prefijo) {
    const defs = nodoSvg('defs');
    for (const p of PATRONES) {
        const pat = nodoSvg('pattern', { id: `${prefijo}-${p}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: p === 'negativo' ? 'rotate(-45)' : 'rotate(45)' });
        pat.append(nodoSvg('rect', { width: 6, height: 6, class: 'kvf-patron-fondo' }), nodoSvg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: `kvf-patron-linea kvf-patron-${p}` }));
        defs.append(pat);
    }
    return defs;
}

// Pinta la escena en un SVG de la página. focos: los elementos con foco reciben tabindex y su etiqueta; al activarlos
// (clic, Enter o Espacio) se llama a alActivar(elemento); al enfocarlos o pasar el puntero, a alMostrar(elemento, nodo).
export function svgEnPagina(escena, { titulo, descripcion, alActivar, alMostrar, alOcultar, miniatura = false } = {}) {
    const prefijo = `kvf${++serie}`;
    const svg = nodoSvg('svg', { viewBox: `0 0 ${escena.ancho} ${escena.alto}`, width: escena.ancho, height: escena.alto, class: `kvf-svg kvf-svg--${escena.tipo}`,
                                 role: miniatura ? null : 'group', 'aria-hidden': miniatura ? 'true' : null, focusable: 'false' });
    if (!miniatura) {
        const t = nodoSvg('title', { id: `${prefijo}-titulo` });
        t.textContent = titulo ?? '';
        const d = nodoSvg('desc', { id: `${prefijo}-desc` });
        d.textContent = descripcion ?? '';
        svg.append(t, d);
        svg.setAttribute('aria-labelledby', `${prefijo}-titulo`);
        svg.setAttribute('aria-describedby', `${prefijo}-desc`);
    }
    svg.append(definiciones(prefijo));
    agregar(svg, escena.elementos, { prefijo, alActivar, alMostrar, alOcultar, miniatura });
    return svg;
}

function agregar(padre, elementos, ctx) {
    for (const e of elementos) {
        let nodo;
        if (e.t === 'rect' || e.t === 'trayecto') {
            const forma = e.t === 'rect'
                ? nodoSvg('rect', { x: r2(e.x), y: r2(e.y), width: r2(Math.max(e.w, 0)), height: r2(Math.max(e.h, 0)), rx: e.rx ?? (e.celda ? 0 : 1.5) })
                : nodoSvg('path', { d: e.d });
            forma.setAttribute('class', ['kvf-forma', `kvf-rol-${e.rol}`, e.banda && 'kvf-banda', e.celda && 'kvf-celda', e.separado && 'kvf-separado', e.marcador && 'kvf-marcador']
                .filter(Boolean).join(' '));
            const capas = [forma];
            if (e.patron) {
                const sobre = forma.cloneNode();
                sobre.setAttribute('class', 'kvf-sobre');
                sobre.setAttribute('fill', `url(#${ctx.prefijo}-${e.patron})`);
                capas.push(sobre);
            }
            if (e.foco && !ctx.miniatura) {
                nodo = nodoSvg('g', { class: `kvf-foco${e.foco.accion ? ' kvf-foco--abre' : ''}`, tabindex: 0, role: e.foco.accion ? 'button' : 'img', 'aria-label': e.foco.etiqueta,
                                      'data-id': e.id });
                nodo.append(...capas);
                conectar(nodo, e, ctx);
            } else {
                const g = nodoSvg('g', e.info && !ctx.miniatura ? { 'data-id': e.id } : {});
                g.append(...capas);
                if (e.info && !ctx.miniatura) conectar(g, e, ctx, false);
                nodo = g;
            }
        } else if (e.t === 'linea') {
            nodo = nodoSvg('line', { x1: r2(e.x1), y1: r2(e.y1), x2: r2(e.x2), y2: r2(e.y2), class: `kvf-linea kvf-linea-${e.rol}${e.punteado ? ' kvf-punteada' : ''}` });
        } else if (e.t === 'texto') {
            nodo = nodoSvg('text', { x: r2(e.x), y: r2(e.y), 'text-anchor': e.ancla, 'dominant-baseline': e.base === 'middle' ? 'central' : e.base,
                                     'font-size': e.tam, 'font-weight': e.peso, class: `kvf-texto kvf-texto-${e.rol}`, 'aria-hidden': 'true' });
            nodo.textContent = e.texto;
        } else if (e.t === 'grupo') {
            nodo = nodoSvg('g', { transform: `translate(${e.x} ${e.y}) scale(${e.escala})` });
            agregar(nodo, e.elementos, ctx);
        }
        if (nodo) padre.append(nodo);
    }
}

function conectar(nodo, e, ctx, enfocable = true) {
    const mostrar = () => ctx.alMostrar?.(e, nodo);
    nodo.addEventListener('pointerenter', mostrar);
    nodo.addEventListener('pointerleave', () => ctx.alOcultar?.(e, nodo));
    if (!enfocable) return;
    nodo.addEventListener('focus', mostrar);
    nodo.addEventListener('blur', () => ctx.alOcultar?.(e, nodo));
    nodo.addEventListener('click', () => {
        mostrar();
        if (e.foco.accion) ctx.alActivar?.(e);
    });
    nodo.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Enter' || ev.key === ' ') && e.foco.accion) {
            ev.preventDefault();
            ctx.alActivar?.(e);
        }
        if (ev.key === 'Escape') ctx.alOcultar?.(e, nodo);
    });
}

const r2 = (x) => Math.round(x * 100) / 100;

// --- Paleta del tema (para las descargas) --------------------------------------------------------------------------------
export const ROLES = ['presupuesto', 'inicial', 'aumento', 'reduccion', 'obligado', 'pagado', 'pendiente', 'saldo', 'diferencia', 'nd', 'vigente_fondo',
                      'ingreso_gestion', 'egreso_gestion', 'resultado_pos', 'resultado_neg', 'activo', 'pasivo', 'patrimonio', 'propio', 'transferencia', 'otro_ingreso',
                      'recaudado', 'liquidez', 'ing100', 'ing200', 'ing300', 'gas100', 'gas200', 'gas300', 'gas400', 'gas500', 'gas600', 'gas700', 'gas800', 'gas900',
                      'ej0', 'ej1', 'ej2', 'ej3', 'ej4', 'ej5', 'ejnd'];
const OTROS = ['fondo', 'texto', 'suave', 'claro', 'aviso', 'guia', 'cero', 'eje', 'referencia', 'conector', 'llave', 'total', 'borde', 'patron', 'banda'];

export function paletaDe(raiz) {
    const css = getComputedStyle(raiz);
    const leer = (n) => css.getPropertyValue(`--kvf-${n}`).trim();
    return Object.fromEntries([...ROLES, ...OTROS].map((n) => [n, leer(n) || '#888888']));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// SVG autónomo (cadena) de una escena compuesta para descargar.
// prefijo: los id del título, la descripción y los patrones, únicos si varios SVG van en un mismo documento (la ficha).
export function svgTexto(escena, paleta, { titulo = '', descripcion = '', prefijo = 'kvf' } = {}) {
    const partes = [];
    const defs = PATRONES.map((p) => `<pattern id="${prefijo}-${p}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(${p === 'negativo' ? -45 : 45})">` +
        `<rect width="6" height="6" fill="none"/><line x1="0" y1="0" x2="0" y2="6" stroke="${paleta.patron}" stroke-width="${p === 'nd' ? 1 : 1.6}"/></pattern>`).join('');
    const escribir = (elementos) => {
        for (const e of elementos) {
            if (e.t === 'rect' || e.t === 'trayecto') {
                const color = paleta[e.rol] ?? '#888888';
                const forma = e.t === 'rect'
                    ? `x="${r2(e.x)}" y="${r2(e.y)}" width="${r2(Math.max(e.w, 0))}" height="${r2(Math.max(e.h, 0))}" rx="${e.rx ?? (e.celda ? 0 : 1.5)}"`
                    : `d="${e.d}"`;
                const tag = e.t === 'rect' ? 'rect' : 'path';
                const op = e.banda ? ` fill-opacity="${paleta.banda || 0.38}"` : '';
                const borde = e.celda ? ` stroke="${paleta.fondo}" stroke-width="1.5"` : e.separado ? ` stroke="${paleta.texto}" stroke-width="1" stroke-dasharray="3 2"` : '';
                partes.push(`<${tag} ${forma} fill="${color}"${op}${borde}/>`);
                if (e.patron) partes.push(`<${tag} ${forma} fill="url(#${prefijo}-${e.patron})"/>`);
            } else if (e.t === 'linea') {
                const color = paleta[e.rol] ?? paleta.guia;
                partes.push(`<line x1="${r2(e.x1)}" y1="${r2(e.y1)}" x2="${r2(e.x2)}" y2="${r2(e.y2)}" stroke="${color}" stroke-width="${grosor(e.rol)}"${e.punteado ? ' stroke-dasharray="4 3"' : ''}/>`);
            } else if (e.t === 'texto') {
                const color = paleta[e.rol] ?? paleta.texto;
                partes.push(`<text x="${r2(e.x)}" y="${r2(e.y)}" text-anchor="${e.ancla}" dominant-baseline="${e.base === 'middle' ? 'central' : e.base}" font-size="${e.tam}" ` +
                            `font-weight="${e.peso}" fill="${color}">${esc(e.texto)}</text>`);
            } else if (e.t === 'grupo') {
                partes.push(`<g transform="translate(${e.x} ${e.y}) scale(${e.escala})">`);
                escribir(e.elementos);
                partes.push('</g>');
            }
        }
    };
    escribir(escena.elementos);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${escena.ancho}" height="${Math.ceil(escena.alto)}" ` +
           `viewBox="0 0 ${escena.ancho} ${Math.ceil(escena.alto)}" role="img" aria-labelledby="${prefijo}-titulo ${prefijo}-desc">` +
           `<title id="${prefijo}-titulo">${esc(titulo)}</title><desc id="${prefijo}-desc">${esc(descripcion)}</desc>` +
           `<style>text{font-family:${FUENTE.replace(/"/g, "'")};}</style><defs>${defs}</defs>` +
           `<rect width="100%" height="100%" fill="${paleta.fondo}"/>${partes.join('')}</svg>\n`;
}

const grosor = (rol) => ({ cero: 1.4, referencia: 1.4, total: 2, llave: 1.2, marcador: 3 }[rol] ?? 1);

// Pinta la escena en un lienzo de ancho anchoPx (3000 por omisión), con la altura que haga falta.
export function lienzo(escena, paleta, { anchoPx = 3000, crear = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }) } = {}) {
    const escala = anchoPx / escena.ancho;
    const canvas = crear(anchoPx, Math.ceil(escena.alto * escala));
    const ctx = canvas.getContext('2d');
    ctx.scale(escala, escala);
    ctx.fillStyle = paleta.fondo;
    ctx.fillRect(0, 0, escena.ancho, escena.alto);
    const patrones = {};
    const patron = (p) => {
        if (!patrones[p]) {
            const t = crear(Math.round(6 * escala), Math.round(6 * escala));
            const c = t.getContext('2d');
            c.scale(escala, escala);
            c.strokeStyle = paleta.patron;
            c.lineWidth = p === 'nd' ? 1 : 1.6;
            c.beginPath();
            if (p === 'negativo') {
                c.moveTo(0, 0); c.lineTo(6, 6); c.moveTo(-3, 3); c.lineTo(3, 9); c.moveTo(3, -3); c.lineTo(9, 3);
            } else {
                c.moveTo(0, 6); c.lineTo(6, 0); c.moveTo(-3, 3); c.lineTo(3, -3); c.moveTo(3, 9); c.lineTo(9, 3);
            }
            c.stroke();
            const pat = ctx.createPattern(t, 'repeat');
            pat.setTransform?.(new DOMMatrix().scale(1 / escala));
            patrones[p] = pat;
        }
        return patrones[p];
    };
    const pintar = (elementos) => {
        for (const e of elementos) {
            if (e.t === 'rect' || e.t === 'trayecto') {
                const camino = e.t === 'rect' ? rectangulo(e) : new Path2D(e.d);
                ctx.globalAlpha = e.banda ? Number(paleta.banda) || 0.38 : 1;
                ctx.fillStyle = paleta[e.rol] ?? '#888888';
                ctx.fill(camino);
                ctx.globalAlpha = 1;
                if (e.patron) {
                    ctx.fillStyle = patron(e.patron);
                    ctx.fill(camino);
                }
                if (e.celda) {
                    ctx.strokeStyle = paleta.fondo;
                    ctx.lineWidth = 1.5;
                    ctx.stroke(camino);
                } else if (e.separado) {
                    ctx.setLineDash([3, 2]);
                    ctx.strokeStyle = paleta.texto;
                    ctx.lineWidth = 1;
                    ctx.stroke(camino);
                    ctx.setLineDash([]);
                }
            } else if (e.t === 'linea') {
                ctx.strokeStyle = paleta[e.rol] ?? paleta.guia;
                ctx.lineWidth = grosor(e.rol);
                ctx.setLineDash(e.punteado ? [4, 3] : []);
                ctx.beginPath();
                ctx.moveTo(e.x1, e.y1);
                ctx.lineTo(e.x2, e.y2);
                ctx.stroke();
                ctx.setLineDash([]);
            } else if (e.t === 'texto') {
                ctx.fillStyle = paleta[e.rol] ?? paleta.texto;
                ctx.font = `${e.peso} ${e.tam}px ${FUENTE}`;
                ctx.textAlign = { start: 'left', middle: 'center', end: 'right' }[e.ancla] ?? 'left';
                ctx.textBaseline = e.base === 'middle' ? 'middle' : e.base === 'hanging' ? 'top' : 'alphabetic';
                ctx.fillText(e.texto, e.x, e.y);
            } else if (e.t === 'grupo') {
                ctx.save();
                ctx.translate(e.x, e.y);
                ctx.scale(e.escala, e.escala);
                pintar(e.elementos);
                ctx.restore();
            }
        }
    };
    pintar(escena.elementos);
    return canvas;
}

function rectangulo(e) {
    const p = new Path2D();
    const rx = Math.min(e.rx ?? (e.celda ? 0 : 1.5), Math.max(e.w, 0) / 2, Math.max(e.h, 0) / 2);
    if (p.roundRect && rx > 0) p.roundRect(e.x, e.y, Math.max(e.w, 0), Math.max(e.h, 0), rx);
    else p.rect(e.x, e.y, Math.max(e.w, 0), Math.max(e.h, 0));
    return p;
}

// Medida de texto con la fuente real del navegador (un solo lienzo para toda la sesión).
let medidor = null;
export function medirTexto(texto, tam = 12, peso = 400) {
    if (!medidor) medidor = document.createElement('canvas').getContext('2d');
    medidor.font = `${peso} ${tam}px ${FUENTE}`;
    return medidor.measureText(String(texto)).width;
}
