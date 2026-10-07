// Utilidades del tablero y de la vista informe: nodos sin HTML desde datos (el texto va con textContent) y formatos
// numéricos en español del Paraguay.
export const SVG = 'http://www.w3.org/2000/svg';
export const fmt = new Intl.NumberFormat('es-PY');
export const pct = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const pct2 = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const $ = (id) => document.getElementById(id);
export const movimiento = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

export function el(tag, clase, texto) {
    const nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto !== undefined && texto !== null) nodo.textContent = String(texto);
    return nodo;
}

export function cantidad(n, singular, plural) {
    return `${fmt.format(n)} ${n === 1 ? singular : plural}`;
}

export function svg(tag, atributos = {}) {
    const nodo = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(atributos)) nodo.setAttribute(k, String(v));
    return nodo;
}

// Encabezado de fila: el nombre va en un span para poder cortarlo en dos renglones en pantallas angostas.
export function celdaNombre(texto, clase) {
    const th = el('th', clase);
    th.scope = 'row';
    th.append(el('span', 'tabla__nombre', texto));
    return th;
}

export function titulo(nodo, texto) {
    const t = svg('title');
    t.textContent = texto;
    nodo.append(t);
    return nodo;
}

// Porcentaje con un decimal sobre un total; «0,0» si el total es cero.
export const porcentaje = (parte, total) => (total ? pct.format((100 * parte) / total) : '0,0');
