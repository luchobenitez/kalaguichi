// Gráficos y descargas de los análisis: Chart.js autoalojado (ADR-015), que se carga solo cuando un análisis lo usa;
// colores del tema activo; CSV en UTF-8 con BOM (lo abre bien una planilla) y PNG del gráfico con título y fuente.
// La política de seguridad no admite imágenes data: ni blob:, así que el PNG sale del lienzo de Chart.js (toBlob).
import { el } from '../tablero/util.js';

const RUTA_CHART = new URL('../../vendor/chartjs/chart.umd.min.js', import.meta.url).href;

export async function cargarChart() {
    if (!globalThis.Chart) await import(RUTA_CHART);
    return globalThis.Chart;
}

export function colores() {
    const css = getComputedStyle(document.documentElement);
    const leer = (nombre, defecto) => css.getPropertyValue(nombre).trim() || defecto;
    return { texto: leer('--text', '#0f172a'), suave: leer('--text-muted', '#64748b'), borde: leer('--border', '#e2e8f0'),
             fondo: leer('--surface-solid', '#ffffff'), naranja: leer('--orange-500', '#f97316'), verde: leer('--emerald-600', '#059669'),
             rojo: leer('--red-600', '#dc2626') };
}

// Fondo del color de la superficie: el PNG descargado no queda transparente.
export const fondo = (c) => ({ id: 'fondoAnalisis', beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.fillStyle = c.fondo;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
} });

export function descargar(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const enlace = el('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const nombreArchivo = (...partes) => partes.filter(Boolean).map((p) => String(p).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).join('_');

// columnas: [{ titulo, v: (fila) => valor }]; los números van sin separador de miles y con punto decimal.
export function descargarCsv(nombre, columnas, filas) {
    const celda = (v) => {
        const s = v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lineas = [columnas.map((c) => celda(c.titulo)).join(','), ...filas.map((f) => columnas.map((c) => celda(c.v(f))).join(','))];
    descargar(new Blob([`﻿${lineas.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), `${nombre}.csv`);
}

// PNG: el lienzo del gráfico con un título arriba y la fuente abajo, sobre el fondo del tema.
export function descargarPng(lienzo, { nombre, titulo, fuente }) {
    const c = colores();
    const escala = lienzo.width / (lienzo.clientWidth || lienzo.width);
    const margen = Math.round(16 * escala);
    const cabecera = Math.round(44 * escala), pie = Math.round(30 * escala);
    const final = el('canvas');
    final.width = lienzo.width + 2 * margen;
    final.height = lienzo.height + cabecera + pie;
    const ctx = final.getContext('2d');
    ctx.fillStyle = c.fondo;
    ctx.fillRect(0, 0, final.width, final.height);
    ctx.fillStyle = c.texto;
    ctx.font = `700 ${Math.round(16 * escala)}px system-ui, sans-serif`;
    ctx.fillText(titulo, margen, Math.round(28 * escala));
    ctx.drawImage(lienzo, margen, cabecera);
    ctx.fillStyle = c.suave;
    ctx.font = `${Math.round(11 * escala)}px system-ui, sans-serif`;
    ctx.fillText(`${fuente} · Kalaguichi.com · descargado el ${new Date().toLocaleDateString('es-PY')}`, margen, final.height - Math.round(10 * escala));
    final.toBlob((blob) => descargar(blob, `${nombre}.png`), 'image/png');
}

// Tabla con encabezados que ordenan (aria-sort) y primera columna como encabezado de fila. columnas: [{ id, titulo,
// texto?, v, f? (formato) }]; estado: { orden: { id, dir } | null }. Devuelve las filas en el orden mostrado.
export function renderTablaOrdenable(tabla, columnas, filas, estado, { elegida } = {}) {
    let ordenadas = filas;
    const col = estado.orden && columnas.find((c) => c.id === estado.orden.id);
    if (col) {
        ordenadas = [...filas].sort((a, b) => {
            const va = col.v(a), vb = col.v(b);
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            return estado.orden.dir * (typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb);
        });
    }
    const cabeza = el('tr');
    for (const c of columnas) {
        const th = el('th', c.texto ? 'tabla__texto' : null);
        th.scope = 'col';
        const boton = el('button', 'tabla__orden', c.titulo);
        boton.type = 'button';
        boton.dataset.columna = c.id;
        if (estado.orden?.id === c.id) th.setAttribute('aria-sort', estado.orden.dir > 0 ? 'ascending' : 'descending');
        th.append(boton);
        cabeza.append(th);
    }
    if (!tabla.tHead) tabla.createTHead();
    if (!tabla.tBodies.length) tabla.createTBody();
    tabla.tHead.replaceChildren(cabeza);
    const cuerpo = document.createDocumentFragment();
    for (const fila of ordenadas) {
        const tr = el('tr');
        if (elegida?.(fila)) tr.classList.add('es-seleccion');
        columnas.forEach((c, k) => {
            const v = c.v(fila);
            const texto = c.f ? c.f(v, fila) : typeof v === 'number' ? new Intl.NumberFormat('es-PY').format(v) : (v ?? '—');
            if (k === 0) {
                const th = el('th', 'tabla__texto');
                th.scope = 'row';
                th.append(el('span', 'tabla__nombre', texto));
                tr.append(th);
            } else {
                tr.append(el('td', c.texto ? 'tabla__texto' : c.clase?.(v, fila) ?? null, texto));
            }
        });
        cuerpo.append(tr);
    }
    tabla.tBodies[0].replaceChildren(cuerpo);
    tabla.dataset.filas = String(ordenadas.length);
    return ordenadas;
}

// Ordenar al tocar un encabezado: misma columna invierte; otra empieza descendente (de texto, ascendente).
export function alOrdenar(tabla, estado, columnas, render) {
    tabla.addEventListener('click', (evento) => {
        const id = evento.target.closest('[data-columna]')?.dataset.columna;
        if (!id) return;
        const col = columnas().find((c) => c.id === id);
        estado.orden = estado.orden?.id === id ? { id, dir: -estado.orden.dir } : { id, dir: col?.texto ? 1 : -1 };
        render();
    });
}
