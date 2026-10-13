// Visualización financiera (ADR-035; tarea M46): de un modelo de vista a una escena de primitivas (rectángulos, trayectos,
// líneas y textos) en píxeles, sin DOM ni colores: cada primitiva lleva un rol (pagado, saldo, diferencia…) que la hoja de
// estilos pinta según el tema y que las descargas traducen a la paleta del tema elegido. La misma escena se dibuja en SVG
// (pantalla y descarga) y en un lienzo (PNG), así que lo que se ve y lo que se descarga no divergen.
// Escalas: en los Sankey, una sola escala para las tres columnas (alto proporcional al importe); en el treemap, área
// proporcional (squarified); en cascadas y barras con signo, un eje con el cero.
import { mm, porciento, veces, gs, CLASES_EJECUCION } from './modelo.js';

export const FUENTE = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// Medida aproximada (Node y pruebas); en el navegador se pasa la del lienzo, con la misma fuente.
export const medidaAproximada = (texto, tam = 12, peso = 400) => String(texto).length * tam * (peso >= 600 ? 0.58 : 0.53);

// Las palabras en renglones que entran en el ancho; el último lleva «…» si no alcanza (el texto entero queda en el
// globo, la tabla y el título accesible: no se completa ni se inventa nada).
export function partir(texto, ancho, tam, medir, maxLineas = 2, peso = 400) {
    const palabras = String(texto).split(/\s+/).filter(Boolean);
    const lineas = [];
    let k = 0;
    while (k < palabras.length && lineas.length < maxLineas) {
        // El último renglón permitido lleva todo lo que queda (y se corta con «…» si no entra).
        if (lineas.length === maxLineas - 1) {
            lineas.push(palabras.slice(k).join(' '));
            break;
        }
        let linea = palabras[k++];
        while (k < palabras.length && medir(`${linea} ${palabras[k]}`, tam, peso) <= ancho) linea += ` ${palabras[k++]}`;
        lineas.push(linea);
    }
    return lineas.map((l) => {
        if (medir(l, tam, peso) <= ancho) return l;
        let s = l;
        while (s.length > 1 && medir(`${s}…`, tam, peso) > ancho) s = s.slice(0, -1);
        return `${s.trimEnd()}…`;
    });
}

const texto = (x, y, t, { tam = 12, peso = 400, ancla = 'start', rol = 'texto', base = 'middle' } = {}) => ({ t: 'texto', x, y, texto: t, tam, peso, ancla, rol, base });
const linea = (x1, y1, x2, y2, rol = 'eje', extra = {}) => ({ t: 'linea', x1, y1, x2, y2, rol, ...extra });
// Un recuadro del color del fondo detrás de un rótulo que empieza en x: la línea del cero, las guías y la referencia
// pasan por detrás y no lo tachan.
const fondoRotulo = (x, y, ancho, alto) => ({ t: 'rect', x: x - 3, y, w: ancho + 6, h: alto, rol: 'fondo' });

// Separa rótulos verticales que se pisan (posición deseada → posición final), dentro de [min, max].
function relajar(items, alto, min, max) {
    const orden = [...items].sort((a, b) => a.deseado - b.deseado);
    for (let k = 0; k < orden.length; k++) {
        orden[k].y = Math.max(orden[k].deseado, k ? orden[k - 1].y + alto : min);
    }
    for (let k = orden.length - 1; k >= 0; k--) {
        const tope = k === orden.length - 1 ? max : orden[k + 1].y - alto;
        if (orden[k].y > tope) orden[k].y = tope;
    }
    for (let k = 0; k < orden.length; k++) if (k && orden[k].y < orden[k - 1].y + alto) orden[k].y = orden[k - 1].y + alto;
    return items;
}

// Números «redondos» para las marcas del eje.
function marcas(min, max, cuantas = 5) {
    const rango = max - min || 1;
    const paso0 = rango / cuantas;
    const mag = 10 ** Math.floor(Math.log10(paso0));
    const paso = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((p) => p >= paso0) ?? 10 * mag;
    const out = [];
    for (let x = Math.ceil(min / paso) * paso; x <= max + paso * 1e-9; x += paso) out.push(Math.abs(x) < paso * 1e-9 ? 0 : x);
    return out;
}

const info = (titulo, ...lineas) => ({ titulo, lineas: lineas.filter(Boolean) });

// --- Sankey de tres columnas ---------------------------------------------------------------------------------------------
function sankey(g, { ancho, medir }) {
    const ancN = 14;
    const margenLat = Math.max(120, Math.min(300, ancho * 0.27));
    const altoRotulo = 32;
    const sep = 6;
    const arriba = 34;
    // Cada nodo de los costados ocupa al menos el alto de su rótulo (el del centro lo lleva arriba): el espacio de más va
    // alrededor de las barras chicas, nunca dentro, así que cada rótulo queda a la altura de su barra y la escala sigue
    // siendo una sola. El gráfico crece con la cantidad de nodos.
    const ranura = (c) => (c === 1 ? 0 : altoRotulo);
    const separadosExtra = (col) => col.filter((n) => n.separado).length * sep * 2;
    const huecos = (col) => (col.length - 1) * sep + separadosExtra(col);
    const altoUtil = Math.max(300, ...g.columnas.map((col, c) => col.length * ranura(c) + huecos(col) + 100));
    const alto = arriba + altoUtil + 16;
    const usado = (col, c, k) => col.reduce((s, n) => s + Math.max(n.valor * k, ranura(c)), 0) + huecos(col);
    // La mayor escala con la que entran las tres columnas (el alto usado crece con la escala: búsqueda binaria).
    const k = Math.min(...g.columnas.map((col, c) => {
        let lo = 0;
        let hi = (altoUtil - huecos(col)) / col.reduce((s, n) => s + n.valor, 0);
        if (usado(col, c, hi) <= altoUtil) return hi;
        for (let i = 0; i < 60; i++) {
            const medio = (lo + hi) / 2;
            if (usado(col, c, medio) <= altoUtil) lo = medio;
            else hi = medio;
        }
        return lo;
    }));
    const xs = [margenLat, ancho / 2 - ancN / 2, ancho - margenLat - ancN];
    const elementos = [];
    const pos = new Map();
    g.columnas.forEach((col, c) => {
        let y = arriba + (altoUtil - usado(col, c, k)) / 2;
        for (const n of col) {
            if (n.separado) y += sep * 2;
            const h = n.valor * k;
            const lugar = Math.max(h, ranura(c));
            const y0 = y + (lugar - h) / 2;
            pos.set(n.id, { x: xs[c], y: y0, h, c, n, entra: y0, sale: y0 });
            y += lugar + sep;
        }
    });
    // Bandas: cada una sale del borde derecho de su origen y llega al izquierdo de su destino, apiladas en orden.
    for (const e of g.enlaces) {
        const a = pos.get(e.de);
        const b = pos.get(e.a);
        const h = e.valor * k;
        const x0 = a.x + ancN;
        const x1 = b.x;
        const y0 = a.sale;
        const y1 = b.entra;
        a.sale += h;
        b.entra += h;
        const xm = (x0 + x1) / 2;
        elementos.push({ t: 'trayecto', d: `M${r(x0)} ${r(y0)}C${r(xm)} ${r(y0)} ${r(xm)} ${r(y1)} ${r(x1)} ${r(y1)}L${r(x1)} ${r(y1 + h)}C${r(xm)} ${r(y1 + h)} ${r(xm)} ${r(y0 + h)} ${r(x0)} ${r(y0 + h)}Z`,
                         rol: e.rol, patron: e.patron, banda: true, id: `${e.de}>${e.a}`,
                         info: info(`${a.n.rotulo} → ${b.n.rotulo}`, gs(e.valor), `${porciento((100 * e.valor) / g.total)} del total`) });
    }
    const rotulos = [];
    for (const p of pos.values()) {
        const pct = porciento((100 * p.n.valor) / g.total);
        elementos.push({ t: 'rect', x: p.x, y: p.y, w: ancN, h: Math.max(p.h, 0.5), rol: p.n.rol, patron: p.n.patron, id: p.n.id, separado: p.n.separado,
                         foco: { etiqueta: `${p.n.rotulo}: ${gs(p.n.valor)}, ${pct} del total` }, info: info(p.n.rotulo, gs(p.n.valor), `${pct} del total`) });
        if (p.c === 1) {
            elementos.push(texto(p.x + ancN / 2, arriba - 20, p.n.rotulo, { tam: 13, peso: 700, ancla: 'middle' }),
                           texto(p.x + ancN / 2, arriba - 6, `${mm(p.n.valor)} · 100 %`, { tam: 11.5, ancla: 'middle', rol: 'suave' }));
            continue;
        }
        rotulos.push({ p, deseado: p.y + p.h / 2 - altoRotulo / 2 + 6 });
    }
    for (const lado of [0, 2]) {
        const items = rotulos.filter((x) => x.p.c === lado);
        relajar(items, altoRotulo, arriba, arriba + altoUtil - altoRotulo + 8);
        for (const it of items) {
            const { p } = it;
            const izquierdo = lado === 0;
            const xt = izquierdo ? p.x - 8 : p.x + ancN + 8;
            const lineas = partir(p.n.rotulo, margenLat - 16, 12, medir, 1, 600);
            elementos.push(texto(xt, it.y, lineas[0], { tam: 12, peso: 600, ancla: izquierdo ? 'end' : 'start' }),
                           texto(xt, it.y + 14, `${mm(p.n.valor)} · ${porciento((100 * p.n.valor) / g.total)}`, { tam: 11, ancla: izquierdo ? 'end' : 'start', rol: 'suave' }));
            const centro = p.y + p.h / 2;
            if (Math.abs(it.y + 7 - centro) > 6) {
                const xa = izquierdo ? p.x - 3 : p.x + ancN + 3;
                elementos.push(linea(xa, centro, xa + (izquierdo ? -4 : 4), it.y + 7, 'conector'));
            }
        }
    }
    return { ancho, alto, elementos };
}

const r = (x) => Math.round(x * 10) / 10;

// --- Treemap (squarified) ------------------------------------------------------------------------------------------------
function peor(fila, lado) {
    const s = fila.reduce((t, x) => t + x.area, 0);
    const max = Math.max(...fila.map((x) => x.area));
    const min = Math.min(...fila.map((x) => x.area));
    return Math.max((lado * lado * max) / (s * s), (s * s) / (lado * lado * min));
}

export function squarify(valores, x, y, w, h) {
    const total = valores.reduce((s, v) => s + v.valor, 0);
    const items = valores.map((v) => ({ ...v, area: (v.valor / total) * w * h })).sort((a, b) => b.area - a.area);
    const out = [];
    let caja = { x, y, w, h };
    let fila = [];
    const colocar = () => {
        const s = fila.reduce((t, it) => t + it.area, 0);
        if (caja.w >= caja.h) {
            const ancho = s / caja.h;
            let yy = caja.y;
            for (const it of fila) {
                const hh = it.area / ancho;
                out.push({ ...it, x: caja.x, y: yy, w: ancho, h: hh });
                yy += hh;
            }
            caja = { x: caja.x + ancho, y: caja.y, w: caja.w - ancho, h: caja.h };
        } else {
            const altoF = s / caja.w;
            let xx = caja.x;
            for (const it of fila) {
                const ww = it.area / altoF;
                out.push({ ...it, x: xx, y: caja.y, w: ww, h: altoF });
                xx += ww;
            }
            caja = { x: caja.x, y: caja.y + altoF, w: caja.w, h: caja.h - altoF };
        }
        fila = [];
    };
    for (const it of items) {
        const lado = Math.min(caja.w, caja.h);
        if (!fila.length || peor([...fila, it], lado) <= peor(fila, lado)) fila.push(it);
        else {
            colocar();
            fila.push(it);
        }
    }
    if (fila.length) colocar();
    return out;
}

const OSCUROS = new Set(['ej3', 'ej4', 'ej5']);

function treemap(g, { ancho, medir }) {
    const alto = Math.round(Math.max(300, Math.min(560, ancho * 0.56)));
    const celdas = squarify(g.items, 0, 0, ancho, alto);
    const elementos = [];
    for (const c of celdas) {
        const pct = porciento((100 * c.valor) / g.total);
        const lineasInfo = [gs(c.valor), `${pct} de la partida`, c.ejecucion === null ? 'Obligado / vigente: sin cociente' : `Obligado / vigente: ${porciento(c.ejecucion)}`, c.extra];
        elementos.push({ t: 'rect', x: c.x, y: c.y, w: c.w, h: c.h, rol: c.rol, patron: c.rol === 'ejnd' ? 'nd' : null, celda: true, id: c.id,
                         foco: { etiqueta: `${c.rotulo}${c.extra ? ` (${c.extra})` : ''}: ${gs(c.valor)}, ${pct}${c.abrible ? '. Enter abre su detalle' : ''}`,
                                 accion: c.abrible ? { apertura: c.destino } : null },
                         info: info(c.rotulo, ...lineasInfo, c.abrible ? 'Clic o Enter: abrir' : '') });
        if (c.w > 64 && c.h > 30) {
            const rol = OSCUROS.has(c.rol) ? 'claro' : 'texto';
            const lineas = partir(c.rotulo, c.w - 12, 11.5, medir, c.h > 58 ? 2 : 1, 600);
            lineas.forEach((l, k) => elementos.push(texto(c.x + 6, c.y + 13 + k * 14, l, { tam: 11.5, peso: 600, rol })));
            if (c.h > 30 + lineas.length * 14) elementos.push(texto(c.x + 6, c.y + 13 + lineas.length * 14, `${mm(c.valor)} · ${pct}`, { tam: 11, rol }));
        }
    }
    return { ancho, alto, elementos };
}

// --- Cascada -------------------------------------------------------------------------------------------------------------
function cascada(g, { ancho, medir }) {
    const pasos = g.pasos.filter((p) => !p.oculto);
    const izq = 78;
    const der = 16;
    const arriba = 24;
    const altoPlot = 300;
    const altoRotulos = 54;
    const alto = arriba + altoPlot + altoRotulos + 10;
    let corriente = 0;
    const barras = pasos.map((p) => {
        let desde;
        let hasta;
        if (p.tipo === 'total') {
            desde = 0;
            hasta = p.valor;
            corriente = p.valor;
        } else {
            desde = corriente;
            hasta = corriente + p.valor;
            corriente = hasta;
        }
        return { p, desde, hasta };
    });
    const extremos = barras.flatMap((b) => [b.desde, b.hasta]);
    let min = Math.min(0, ...extremos);
    let max = Math.max(0, ...extremos);
    const pad = (max - min) * 0.08 || 1;
    max += max > 0 ? pad : 0;
    min -= min < 0 ? pad : 0;
    const y = (v) => arriba + ((max - v) / (max - min)) * altoPlot;
    const ranura = (ancho - izq - der) / pasos.length;
    const anchoB = Math.min(84, ranura * 0.62);
    const elementos = [];
    for (const m of marcas(min, max)) {
        elementos.push(linea(izq, y(m), ancho - der, y(m), m === 0 ? 'cero' : 'guia'), texto(izq - 6, y(m), mm(m), { tam: 10.5, ancla: 'end', rol: 'suave' }));
    }
    barras.forEach((b, k) => {
        const x = izq + ranura * k + (ranura - anchoB) / 2;
        const y0 = y(Math.max(b.desde, b.hasta));
        const h = Math.max(Math.abs(y(b.desde) - y(b.hasta)), 1);
        const valorTxt = b.p.tipo === 'total' ? mm(b.p.valor) : `${b.p.valor >= 0 ? '+' : '−'}${mm(Math.abs(b.p.valor))}`;
        elementos.push({ t: 'rect', x, y: y0, w: anchoB, h, rol: b.p.rol, patron: b.p.patron ?? (b.p.tipo === 'delta' && b.p.valor < 0 ? 'negativo' : null), id: b.p.id,
                         foco: { etiqueta: `${b.p.rotulo}: ${b.p.tipo === 'total' ? gs(b.p.valor) : `${b.p.valor >= 0 ? 'suma' : 'resta'} ${gs(Math.abs(b.p.valor))}`}` },
                         info: info(b.p.rotulo, b.p.tipo === 'total' ? gs(b.p.valor) : `${b.p.valor >= 0 ? 'Suma' : 'Resta'} ${gs(Math.abs(b.p.valor))}`) });
        const arribaDe = b.hasta >= b.desde ? y(b.hasta) : y(b.desde);
        const negativoTotal = b.p.tipo === 'total' && b.p.valor < 0;
        elementos.push(texto(x + anchoB / 2, negativoTotal ? y(b.hasta) + 12 : arribaDe - 8, valorTxt, { tam: 11, peso: 700, ancla: 'middle' }));
        partir(b.p.rotulo, ranura - 6, 10.5, medir, 3).forEach((l, j) => elementos.push(texto(x + anchoB / 2, arriba + altoPlot + 14 + j * 13, l, { tam: 10.5, ancla: 'middle', rol: 'suave' })));
        if (k < barras.length - 1) {
            const sig = barras[k + 1];
            const nivel = sig.p.tipo === 'total' ? sig.hasta : sig.desde;
            elementos.push(linea(x + anchoB, y(nivel), x + ranura, y(nivel), 'conector', { punteado: true }));
        }
    });
    return { ancho, alto, elementos };
}

// --- Viñetas -------------------------------------------------------------------------------------------------------------
function vinetas(g, { ancho, medir }) {
    const altoFila = 48;
    const arriba = 26;
    const rot = Math.max(130, Math.min(320, ancho * 0.3));
    const valores = 132;
    const x0 = rot + 12;
    const x1 = ancho - valores - 12;
    const escala = (p) => x0 + ((x1 - x0) * p) / g.escalaMax;
    const alto = arriba + g.filas.length * altoFila + 8;
    const elementos = [];
    for (const m of marcas(0, g.escalaMax, 4).filter((x) => x <= g.escalaMax)) {
        elementos.push(linea(escala(m), arriba - 4, escala(m), alto - 6, m === 100 ? 'referencia' : 'guia', { punteado: m === 100 }),
                       texto(escala(m), arriba - 14, `${m} %`, { tam: 10.5, ancla: 'middle', rol: 'suave' }));
    }
    g.filas.forEach((f, k) => {
        const yc = arriba + k * altoFila + altoFila / 2;
        partir(f.rotulo, rot - 8, 11.5, medir, 2, f.esTotal ? 700 : 600)
            .forEach((l, j, todas) => elementos.push(texto(rot, yc - (todas.length - 1) * 7 + j * 14, l, { tam: 11.5, peso: f.esTotal ? 700 : 600, ancla: 'end' })));
        const etiqueta = `${f.rotulo}: vigente ${gs(f.vigente)}; obligado ${gs(f.obligado)} (${porciento(f.pctObligado)}); pagado ${gs(f.pagado)} (${porciento(f.pctPagado)})`;
        const datos = info(f.rotulo, `Presupuesto vigente: ${gs(f.vigente)}`, `Obligado: ${gs(f.obligado)} (${porciento(f.pctObligado)})`,
                           `Pagado: ${gs(f.pagado)} (${porciento(f.pctPagado)})`, `Pendiente de pago: ${gs(f.pendiente)}`, f.nd);
        if (f.pctObligado === null && f.pctPagado === null) {
            elementos.push({ t: 'rect', x: x0, y: yc - 12, w: x1 - x0, h: 24, rol: 'nd', patron: 'nd', id: f.id, foco: { etiqueta: `${etiqueta}. ${f.nd}` }, info: datos },
                           texto(x0 + 8, yc, f.nd ?? 'Sin cociente', { tam: 10.5, rol: 'suave' }));
            return;
        }
        elementos.push({ t: 'rect', x: x0, y: yc - 12, w: escala(100) - x0, h: 24, rol: 'vigente_fondo', id: f.id, foco: { etiqueta }, info: datos });
        if (f.pctObligado !== null) elementos.push({ t: 'rect', x: x0, y: yc - 6, w: Math.max(escala(f.pctObligado) - x0, 0.5), h: 12, rol: 'obligado' });
        if (f.pctPagado !== null) elementos.push({ t: 'rect', x: escala(f.pctPagado) - 1.5, y: yc - 13, w: 3, h: 26, rol: 'pagado', marcador: true });
        elementos.push(texto(x1 + 12, yc - 7, `Obligado ${porciento(f.pctObligado)}`, { tam: 11, peso: 600 }),
                       texto(x1 + 12, yc + 8, `Pagado ${porciento(f.pctPagado)}`, { tam: 11, rol: 'suave' }));
    });
    return { ancho, alto, elementos };
}

// --- Barras de liquidez --------------------------------------------------------------------------------------------------
function barras(g, { ancho, medir }) {
    const rot = Math.max(140, Math.min(300, ancho * 0.3));
    const x0 = rot + 12;
    const x1 = ancho - 110;
    const altoFila = 62;
    const arriba = 30;
    const maximo = Math.max(1.5, ...g.barras.filter((b) => b.valor !== null).map((b) => b.valor * 1.1));
    const escala = (v) => x0 + ((x1 - x0) * v) / maximo;
    const alto = arriba + g.barras.length * altoFila + 10;
    const elementos = [linea(escala(1), arriba - 8, escala(1), alto - 4, 'referencia', { punteado: true }),
                       texto(escala(1), arriba - 16, g.referencia.texto, { tam: 10.5, ancla: 'middle', rol: 'suave' })];
    g.barras.forEach((b, k) => {
        const yc = arriba + k * altoFila + altoFila / 2;
        elementos.push(texto(rot, yc - 7, b.rotulo, { tam: 12.5, peso: 700, ancla: 'end' }));
        partir(b.formula, rot - 6, 10, medir, 2).forEach((l, j) => elementos.push(texto(rot, yc + 8 + j * 12, l, { tam: 10, ancla: 'end', rol: 'suave' })));
        if (b.valor === null) {
            elementos.push({ t: 'rect', x: x0, y: yc - 11, w: Math.min(220, x1 - x0), h: 22, rol: 'nd', patron: 'nd', id: b.id,
                             foco: { etiqueta: `${b.rotulo}: no calculable. ${b.motivo ?? ''}` }, info: info(b.rotulo, 'No calculable', b.motivo) },
                           texto(x0 + 8, yc, 'No calculable', { tam: 11, peso: 600 }));
            return;
        }
        elementos.push({ t: 'rect', x: x0, y: yc - 11, w: Math.max(escala(b.valor) - x0, 1), h: 22, rol: b.rol, id: b.id,
                         foco: { etiqueta: `${b.rotulo}: ${veces(b.valor)}` }, info: info(b.rotulo, veces(b.valor), b.formula) },
                       fondoRotulo(escala(b.valor) + 8, yc - 9, medir(veces(b.valor), 12, 700), 18),
                       texto(escala(b.valor) + 8, yc, veces(b.valor), { tam: 12, peso: 700 }));
    });
    return { ancho, alto, elementos };
}

// --- Barra apilada al 100 % ----------------------------------------------------------------------------------------------
function apilada(g, { ancho, medir }) {
    const izq = 8;
    const der = 8;
    const arriba = 28;
    const altoBarra = 46;
    const w = ancho - izq - der;
    const elementos = [];
    let x = izq;
    const tramos = {};
    for (const s of g.segmentos) {
        const ws = (w * s.valor) / g.total;
        elementos.push({ t: 'rect', x, y: arriba, w: ws, h: altoBarra, rol: s.rol, patron: s.patron, id: s.id, celda: true,
                         foco: { etiqueta: `${s.rotulo}: ${gs(s.valor)}, ${porciento(s.pct)}` }, info: info(s.rotulo, gs(s.valor), `${porciento(s.pct)} de los ingresos sin financiamiento`) });
        if (ws > 46) elementos.push(texto(x + ws / 2, arriba + altoBarra / 2, porciento(s.pct), { tam: 11, peso: 700, ancla: 'middle', rol: s.rol === 'transferencia' ? 'claro' : 'texto' }));
        tramos[s.categoria] = tramos[s.categoria] ?? { desde: x, hasta: x };
        tramos[s.categoria].hasta = x + ws;
        x += ws;
    }
    // Llaves de las tres familias (propios, transferencias y otros) debajo de la barra.
    for (const c of g.categorias ?? []) {
        const t = tramos[c.id];
        if (!t) continue;
        const yl = arriba + altoBarra + 8;
        elementos.push(linea(t.desde + 1, yl, t.hasta - 1, yl, 'llave'), linea(t.desde + 1, yl - 4, t.desde + 1, yl, 'llave'), linea(t.hasta - 1, yl - 4, t.hasta - 1, yl, 'llave'));
        if (t.hasta - t.desde > 70) {
            partir(`${c.texto}: ${porciento(c.pct)}`, t.hasta - t.desde - 4, 11, medir, 2, 600)
                .forEach((l, j) => elementos.push(texto((t.desde + t.hasta) / 2, yl + 13 + j * 13, l, { tam: 11, peso: 600, ancla: 'middle' })));
        }
    }
    // Lista de componentes (también en la descarga).
    const y0 = arriba + altoBarra + 50;
    const altoFila = 20;
    g.segmentos.forEach((s, k) => {
        const yy = y0 + k * altoFila;
        elementos.push({ t: 'rect', x: izq, y: yy - 6, w: 12, h: 12, rol: s.rol, patron: s.patron, rx: 2 },
                       texto(izq + 18, yy, partir(s.rotulo, w * 0.62, 11.5, medir, 1)[0], { tam: 11.5 }),
                       texto(ancho - der, yy, `${mm(s.valor)} · ${porciento(s.pct)}`, { tam: 11.5, ancla: 'end', rol: 'suave' }));
    });
    return { ancho, alto: y0 + g.segmentos.length * altoFila + 4, elementos };
}

// --- Columnas apiladas con signo -----------------------------------------------------------------------------------------
function firmadas(g, { ancho, medir }) {
    const izq = 78;
    const arriba = 24;
    const altoPlot = 320;
    const alto = arriba + altoPlot + 46;
    const cols = g.columnas.map((c) => {
        let pos = 0;
        let neg = 0;
        const segs = c.segmentos.map((s) => {
            const d = s.valor >= 0 ? { desde: pos, hasta: pos + s.valor } : { desde: neg + s.valor, hasta: neg };
            if (s.valor >= 0) pos += s.valor;
            else neg += s.valor;
            return { ...s, ...d };
        });
        return { ...c, segs, pos, neg };
    });
    let max = Math.max(0, ...cols.map((c) => c.pos), ...cols.map((c) => c.total ?? 0));
    let min = Math.min(0, ...cols.map((c) => c.neg), ...cols.map((c) => c.total ?? 0));
    const pad = (max - min) * 0.06 || 1;
    max += max > 0 ? pad : 0;
    min -= min < 0 ? pad : 0;
    const y = (v) => arriba + ((max - v) / (max - min)) * altoPlot;
    const ranura = (ancho - izq - 8) / cols.length;
    const anchoB = Math.min(120, ranura * 0.34);
    const elementos = [];
    for (const m of marcas(min, max)) {
        elementos.push(linea(izq, y(m), ancho - 8, y(m), m === 0 ? 'cero' : 'guia'), texto(izq - 6, y(m), mm(m), { tam: 10.5, ancla: 'end', rol: 'suave' }));
    }
    cols.forEach((c, k) => {
        const x = izq + ranura * k + 10;
        const rotulos = [];
        for (const s of c.segs) {
            const y0 = y(s.hasta);
            const h = Math.max(y(s.desde) - y(s.hasta), 0.5);
            elementos.push({ t: 'rect', x, y: y0, w: anchoB, h, rol: s.rol, patron: s.patron ?? (s.valor < 0 ? 'negativo' : null), id: `${c.id}:${s.id}`, celda: true,
                             foco: { etiqueta: `${c.rotulo}, ${s.rotulo}: ${gs(s.valor)}` }, info: info(s.rotulo, gs(s.valor), c.rotulo) });
            rotulos.push({ s, deseado: y0 + h / 2 - 7, centro: y0 + h / 2 });
        }
        const anchoRot = ranura - anchoB - 30;
        relajar(rotulos, 28, arriba, arriba + altoPlot - 20);
        for (const it of rotulos) {
            const nombre = partir(it.s.rotulo, anchoRot, 11, medir, 1, 600)[0];
            const valor = `${it.s.valor < 0 ? '−' : ''}${mm(Math.abs(it.s.valor))}`;
            elementos.push(fondoRotulo(x + anchoB + 14, it.y - 8, Math.max(medir(nombre, 11, 600), medir(valor, 10.5)), 28),
                           texto(x + anchoB + 14, it.y, nombre, { tam: 11, peso: 600 }),
                           texto(x + anchoB + 14, it.y + 13, valor, { tam: 10.5, rol: 'suave' }));
            if (Math.abs(it.y + 6 - it.centro) > 5) elementos.push(linea(x + anchoB + 2, it.centro, x + anchoB + 11, it.y + 6, 'conector'));
        }
        if (c.total !== null && c.total !== undefined) {
            elementos.push(linea(x - 6, y(c.total), x + anchoB + 6, y(c.total), 'total'));
        }
        partir(c.rotulo, ranura - 12, 11.5, medir, 2, 700).forEach((l, j) => elementos.push(texto(x + anchoB / 2, arriba + altoPlot + 16 + j * 14, l, { tam: 11.5, peso: 700, ancla: 'middle' })));
        if (c.total !== null && c.total !== undefined) {
            elementos.push(texto(x + anchoB / 2, arriba + altoPlot + 16 + 2 * 14, `Total ${c.total < 0 ? '−' : ''}${mm(Math.abs(c.total))}`, { tam: 10.5, ancla: 'middle', rol: 'suave' }));
        }
    });
    return { ancho, alto: alto + 14, elementos };
}

// --- Líneas: la evolución histórica (M57) ----------------------------------------------------------------------------------
// Un eje de años parejo (de 2004 a 2025) y un eje de valores con el cero; cada serie, en segmentos entre años seguidos con
// dato (un hueco no se une: un año sin balance no es un cero ni se interpola). Los años que el MEF no publicó van como una
// franja tramada; los que la municipalidad no figura en el tomo o no existía, como una marca tramada sobre el eje.
const nfEje = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 2 });
const rotuloEje = (m, unidad) => (unidad === 'gs' ? mm(m) : unidad === 'pct' ? `${nfEje.format(m)} %` : nfEje.format(m));
const textoValor = (x, unidad) => (unidad === 'gs' ? gs(x) : unidad === 'pct' ? porciento(x) : veces(x));

function lineas(g, { ancho, medir }) {
    const izq = ancho < 520 ? 66 : 86;
    const der = 18;
    const arriba = 26;
    const altoPlot = 300;
    const alto = arriba + altoPlot + 40;
    const n = g.anios.length;
    const paso = (ancho - izq - der) / n;
    const x = (k) => izq + paso * (k + 0.5);
    const valores = g.series.flatMap((s) => s.puntos.map((p) => p.valor).filter((v) => v !== null && v !== undefined));
    let min = Math.min(0, ...valores, ...(g.referencia ? [g.referencia.valor] : []));
    let max = Math.max(0, ...valores, ...(g.referencia ? [g.referencia.valor] : []));
    const pad = (max - min) * 0.08 || 1;
    max += max > 0 ? pad : 0;
    min -= min < 0 ? pad : 0;
    const y = (v) => arriba + ((max - v) / (max - min)) * altoPlot;
    const elementos = [];
    // Los años sin balance, detrás de todo.
    g.anios.forEach((anio, k) => {
        const p = g.series[0].puntos[k];
        if (p.estado === 'sin_datos_anio') {
            elementos.push({ t: 'rect', x: x(k) - paso * 0.42, y: arriba, w: paso * 0.84, h: altoPlot, rol: 'nd', patron: 'nd', rx: 0, id: `hueco-${anio}`,
                             foco: { etiqueta: `${anio}: ${p.texto}` }, info: info(String(anio), p.texto) });
        } else if (p.estado === 'sin_informe' || p.estado === 'parte_de') {
            elementos.push({ t: 'rect', x: x(k) - paso * 0.3, y: y(min) - 12, w: paso * 0.6, h: 12, rol: 'nd', patron: 'nd', rx: 0, id: `hueco-${anio}`,
                             foco: { etiqueta: `${anio}: ${p.texto}` }, info: info(String(anio), p.texto) });
        }
    });
    for (const m of marcas(min, max)) {
        elementos.push(linea(izq, y(m), ancho - der, y(m), m === 0 ? 'cero' : 'guia'), texto(izq - 6, y(m), rotuloEje(m, g.unidad), { tam: 10.5, ancla: 'end', rol: 'suave' }));
    }
    if (g.referencia) {
        const yr = y(g.referencia.valor);
        elementos.push(linea(izq, yr, ancho - der, yr, 'referencia', { punteado: true }),
                       fondoRotulo(ancho - der - medir(g.referencia.texto, 10.5) - 4, yr - 16, medir(g.referencia.texto, 10.5), 14),
                       texto(ancho - der - 4, yr - 9, g.referencia.texto, { tam: 10.5, ancla: 'end', rol: 'suave' }));
    }
    // Los años: todos si entran; si no, cada dos o cada cinco, contados desde el último (que siempre lleva su rótulo).
    const cada = paso >= 34 ? 1 : paso >= 17 ? 2 : 5;
    g.anios.forEach((anio, k) => {
        if ((n - 1 - k) % cada === 0) elementos.push(texto(x(k), arriba + altoPlot + 16, String(anio), { tam: 10.5, ancla: 'middle', rol: 'suave' }));
        elementos.push(linea(x(k), arriba + altoPlot, x(k), arriba + altoPlot + 4, 'eje'));
    });
    elementos.push(linea(izq, arriba + altoPlot, ancho - der, arriba + altoPlot, 'eje'));
    // Las series: primero los segmentos, después los puntos (encima, con su globo).
    for (const s of g.series) {
        for (let k = 0; k < n - 1; k++) {
            const a = s.puntos[k].valor;
            const b = s.puntos[k + 1].valor;
            if (a === null || b === null) continue;
            elementos.push(linea(x(k), y(a), x(k + 1), y(b), s.rol, { serie: true }));
        }
    }
    const radio = Math.max(2.6, Math.min(4.2, paso * 0.16));
    for (const s of g.series) {
        s.puntos.forEach((p, k) => {
            if (p.valor === null) return;
            const lineasInfo = [textoValor(p.valor, g.unidad)];
            if (p.factor) lineasInfo.push(`${gs(p.nominal)} de ${p.anio} × ${nfEje.format(Math.round(p.factor * 10000) / 10000)} (IPC)`);
            lineasInfo.push(p.texto);
            elementos.push({ t: 'rect', x: x(k) - radio, y: y(p.valor) - radio, w: 2 * radio, h: 2 * radio, rx: radio, rol: s.rol, id: `${s.id}-${p.anio}`,
                             foco: { etiqueta: `${s.rotulo}, ${p.anio}: ${textoValor(p.valor, g.unidad)}` }, info: info(`${s.rotulo} · ${p.anio}`, ...lineasInfo) });
        });
    }
    return { ancho, alto, elementos };
}

// --- Leyendas ------------------------------------------------------------------------------------------------------------
const TEXTO_ROL = {
    presupuesto: 'Presupuesto vigente', inicial: 'Presupuesto inicial', aumento: 'Aumento (modificación positiva)', reduccion: 'Reducción (modificación negativa)',
    obligado: 'Obligado', pagado: 'Pagado', pendiente: 'Obligado pendiente de pago', saldo: 'Saldo sin obligar', diferencia: 'Diferencia aritmética (no es una partida oficial)',
    nd: 'Sin dato o sin cociente', vigente_fondo: 'Presupuesto vigente (= 100 %)', ingreso_gestion: 'Ingresos de gestión', egreso_gestion: 'Egresos de gestión',
    resultado_pos: 'Resultado positivo', resultado_neg: 'Resultado negativo', activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio neto (cuenta 8)',
    propio: 'Ingresos propios identificados', transferencia: 'Transferencias', otro_ingreso: 'Otros componentes', recaudado: 'Recaudado', liquidez: 'Razón (veces)',
};

export function leyenda(v, escena) {
    if (!escena) return [];
    if (v.grafico?.tipo === 'lineas') {
        const huecos = v.grafico.series[0].puntos.some((p) => p.valor === null);
        return [...v.grafico.series.map((s) => ({ rol: s.rol, texto: s.rotulo, linea: true })),
                ...(huecos ? [{ rol: 'nd', patron: 'nd', texto: 'Año sin balance (no publicado, sin informe o el distrito no existía)' }] : [])];
    }
    if (v.grafico?.tipo === 'treemap') {
        return [...CLASES_EJECUCION.map((c) => ({ rol: c.id, texto: c.texto })), { rol: 'ejnd', patron: 'nd', texto: 'Sin cociente (vigente cero o sin dato)' }];
    }
    if (v.grafico?.tipo === 'vinetas') {
        return [{ rol: 'vigente_fondo', texto: 'Presupuesto vigente (= 100 %)' }, { rol: 'obligado', texto: 'Obligado (barra)' }, { rol: 'pagado', marcador: true, texto: 'Pagado (marcador)' }];
    }
    const vistos = new Map();
    for (const e of escena.elementos) {
        if ((e.t !== 'rect' && e.t !== 'trayecto') || e.banda || !e.rol || e.rol.startsWith('gas') || e.rol.startsWith('ing') && e.rol !== 'ingreso_gestion') continue;
        const k = `${e.rol}|${e.patron ?? ''}`;
        if (vistos.has(k) || !TEXTO_ROL[e.rol]) continue;
        // En una cascada, la trama marca lo que se resta; en las barras con signo, un importe negativo.
        const marca = ['resultado_neg', 'reduccion'].includes(e.rol) ? '' : escena.tipo === 'cascada' ? ' (resta)' : ' (importe negativo)';
        vistos.set(k, { rol: e.rol, patron: e.patron ?? null, texto: e.patron === 'negativo' ? `${TEXTO_ROL[e.rol]}${marca}` : TEXTO_ROL[e.rol] });
    }
    return [...vistos.values()];
}

// La escena del gráfico de una vista, al ancho pedido (cada formato tiene un ancho mínimo; debajo, la caja se desplaza).
export const ANCHO_MINIMO = { sankey: 620, treemap: 320, cascada: 560, vinetas: 560, barras: 480, apilada: 360, firmadas: 560, lineas: 330 };
const DIBUJOS = { sankey, treemap, cascada, vinetas, barras, apilada, firmadas, lineas };

export function escena(v, { ancho = 960, medir = medidaAproximada } = {}) {
    if (!v.grafico) return null;
    const fn = DIBUJOS[v.grafico.tipo];
    if (!fn) throw new Error(`Formato sin dibujo: ${v.grafico.tipo}`);
    const a = Math.max(ancho, ANCHO_MINIMO[v.grafico.tipo] ?? 320);
    return { ...fn(v.grafico, { ancho: a, medir }), tipo: v.grafico.tipo };
}

// Para las descargas: título, municipio, unidad y etapas arriba; leyenda, «Qué muestra», límite, cambio de formato y
// fuente abajo. Todo en la misma escena (el PNG y el SVG salen de acá).
export function componer(v, esc, { municipio, departamento, ejercicio, corte, version, medir = medidaAproximada, ancho = 1200 } = {}) {
    const m = 36;
    const util = ancho - 2 * m;
    const el = [];
    let y = m + 6;
    const bloque = (t, { tam = 12, peso = 400, rol = 'texto', max = 4, sep = 4 } = {}) => {
        for (const l of partir(t, util, tam, medir, max, peso)) {
            el.push(texto(m, y, l, { tam, peso, rol, base: 'middle' }));
            y += tam * 1.35;
        }
        y += sep;
    };
    bloque(v.titulo, { tam: 22, peso: 800, max: 2 });
    bloque(`${municipio} · ${departamento} · Ejercicio ${ejercicio} · Corte ${corte}`, { tam: 13.5, peso: 600 });
    bloque(`Unidad: ${v.unidad}. ${v.etapas}${v.denominador ? ` Denominador: ${v.denominador}` : ''}`, { tam: 11.5, rol: 'suave', max: 3 });
    if (v.cambio) bloque(textoCambio(v.cambio), { tam: 11.5, peso: 600, rol: 'aviso', max: 3 });
    if (v.estado === 'parcial' && v.motivo) bloque(`Parcial: ${v.motivo}`, { tam: 11.5, peso: 600, rol: 'aviso', max: 3 });
    y += 6;
    let alto = y;
    if (esc) {
        const escala = Math.min(1, util / esc.ancho);
        el.push({ t: 'grupo', x: m, y, escala, elementos: esc.elementos });
        y += esc.alto * escala + 12;
        const ley = leyenda(v, esc);
        let x = m;
        for (const it of ley) {
            const w = medir(it.texto, 11.5) + 34;
            if (x + w > ancho - m) {
                x = m;
                y += 20;
            }
            el.push({ t: 'rect', x, y: y - 6, w: 14, h: 12, rol: it.rol, patron: it.patron, rx: 2 }, texto(x + 20, y, it.texto, { tam: 11.5 }));
            x += w;
        }
        y += ley.length ? 26 : 6;
    }
    for (const a of v.avisos ?? []) bloque(a, { tam: 11, rol: 'suave', max: 3, sep: 2 });
    bloque(`Qué muestra: ${v.que_muestra}`, { tam: 11.5, max: 4 });
    bloque(`Límite de interpretación: ${v.limite}`, { tam: 11.5, max: 4 });
    bloque(`Fuente: ${v.fuente}`, { tam: 11, rol: 'suave', max: 3 });
    bloque(`Visualización y cálculos de agrupación: Kalaguichi.com (no es un aval del MEF). Datos versión ${version}, método vf-1.`, { tam: 10.5, rol: 'suave', max: 2 });
    alto = y + m - 10;
    return { ancho, alto, elementos: el, tipo: 'exportacion' };
}

// «Cambio de formato: barras con signo en lugar de un Sankey, porque …» (la misma frase en la página y en las descargas).
export const textoCambio = (c) => `Cambio de formato: ${NOMBRE_FORMATO[c.a] ?? c.a} en lugar de ${NOMBRE_FORMATO[c.de] ?? c.de}, porque ${c.causa}.`;

export const NOMBRE_FORMATO = { sankey: 'un Sankey', barras_firmadas: 'barras con signo', cascada: 'una cascada', vinetas: 'viñetas', treemap: 'un treemap',
                                barra_apilada: 'una barra apilada', barras: 'barras', composicion: 'una composición con signo', lineas: 'líneas' };
