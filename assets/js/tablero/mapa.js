// Mapas SVG de Asunción (metros, sin fondo propio): distrito, río, barrios, zonas municipales rotuladas y un punto por
// mesa alrededor de su local, con zoom y controles (zoom_mapa.js). También la paleta de los coropléticos, que mezcla
// cada color con la superficie del tema activo, y los ítems de leyenda. Lo usan el tablero y la vista informe.
import { habilitarZoom, agregarControles } from './zoom_mapa.js';
import { $, el, svg, titulo } from './util.js';

const ESPIRAL_M = 34;          // Separación de los puntos de mesa alrededor del local, en metros.
export const PUNTO_M = 30;     // Radio de cada punto de mesa, en metros.
// Colores de las zonas TSJE: categóricos y distintos de los de las listas, para no sugerir afinidad.
export const COLORES_ZONA = { 1: '#f97316', 2: '#22d3ee', 3: '#a78bfa', 4: '#facc15', 5: '#34d399', 6: '#f472b6' };
export const PARTICIPACION_COLOR = '#f97316';
// IPM: tono ámbar, distinto de los colores de las listas que llevan los locales encima.
export const IPM_COLOR = '#fbbf24';

// Símbolo de igual área que un círculo de radio r, como trazado SVG.
export function simbolo(x, y, r, forma) {
    const n = (v) => Math.round(v * 10) / 10;
    if (forma === 'rombo') {
        const s = r * 1.2533;
        return `M${n(x)} ${n(y - s)}L${n(x + s)} ${n(y)}L${n(x)} ${n(y + s)}L${n(x - s)} ${n(y)}Z`;
    }
    if (forma === 'cuadrado') {
        const h = r * 0.8862;
        return `M${n(x - h)} ${n(y - h)}h${n(2 * h)}v${n(2 * h)}h${n(-2 * h)}Z`;
    }
    return `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

export function anillosDePath(d) {
    return d.split('M').filter((s) => s.trim()).map((s) => {
        const numeros = (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        const puntos = [];
        for (let i = 0; i + 1 < numeros.length; i += 2) puntos.push([numeros[i], numeros[i + 1]]);
        return puntos;
    });
}

function dentroDe(x, y, anillos) {
    let dentro = false;
    for (const a of anillos) {
        for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
            const [xi, yi] = a[i], [xj, yj] = a[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
        }
    }
    return dentro;
}

function distanciaBorde(x, y, anillos) {
    let minimo = Infinity;
    for (const a of anillos) {
        for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
            const [x1, y1] = a[j], [x2, y2] = a[i];
            const dx = x2 - x1, dy = y2 - y1;
            const t = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
            minimo = Math.min(minimo, Math.hypot(x - x1 - t * dx, y - y1 - t * dy));
        }
    }
    return minimo;
}

// Lugar del rótulo: punto interior más alejado del borde, buscado en una grilla y refinado una vez.
function lugarRotulo(d) {
    const anillos = anillosDePath(d);
    const todos = anillos.flat();
    let [x0, y0, x1, y1] = [Math.min(...todos.map((p) => p[0])), Math.min(...todos.map((p) => p[1])),
        Math.max(...todos.map((p) => p[0])), Math.max(...todos.map((p) => p[1]))];
    let mejor = null;
    for (let ronda = 0; ronda < 2; ronda++) {
        const n = 24, px = (x1 - x0) / n, py = (y1 - y0) / n;
        for (let i = 0; i <= n; i++) {
            for (let j = 0; j <= n; j++) {
                const x = x0 + i * px, y = y0 + j * py;
                if (!dentroDe(x, y, anillos)) continue;
                const dist = distanciaBorde(x, y, anillos);
                if (!mejor || dist > mejor.dist) mejor = { x, y, dist };
            }
        }
        if (!mejor) break;
        [x0, y0, x1, y1] = [mejor.x - px, mejor.y - py, mejor.x + px, mejor.y + py];
    }
    return mejor ?? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

function lineasRotulo(nombre) {
    if (nombre.length <= 14) return [nombre];
    const medio = nombre.length / 2;
    const espacios = [...nombre.matchAll(/ /g)].map((m) => m.index);
    const corte = espacios.reduce((a, b) => (Math.abs(b - medio) < Math.abs(a - medio) ? b : a), espacios[0]);
    return [nombre.slice(0, corte), nombre.slice(corte + 1)];
}

// Caja [x, y, ancho, alto] de un conjunto de puntos, con margen y la proporción del distrito.
export function cajaDe(datos, xs, ys, margenM) {
    let [x0, y0, x1, y1] = [Math.min(...xs) - margenM, Math.min(...ys) - margenM, Math.max(...xs) + margenM, Math.max(...ys) + margenM];
    const [, , ancho, alto] = datos.geo.viewBox;
    const proporcion = ancho / alto;
    if ((x1 - x0) / (y1 - y0) < proporcion) {
        const extra = (y1 - y0) * proporcion - (x1 - x0);
        x0 -= extra / 2; x1 += extra / 2;
    } else {
        const extra = (x1 - x0) / proporcion - (y1 - y0);
        y0 -= extra / 2; y1 += extra / 2;
    }
    return [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)];
}

// Encuadre del filtro de zona: la zona municipal (su contorno) o los locales de la zona TSJE; sin filtro, el distrito.
export function encuadre(datos, { zona, zonaMunicipal }) {
    if (zonaMunicipal !== null) {
        const puntos = anillosDePath(datos.zonaMunicipalPor.get(zonaMunicipal).d).flat();
        return cajaDe(datos, puntos.map((p) => p[0]), puntos.map((p) => p[1]), 350);
    }
    if (zona !== null) {
        const locales = [...datos.infoLocal.values()].filter((x) => x.zona === zona);
        return cajaDe(datos, locales.map((x) => x.x), locales.map((x) => x.y), 700);
    }
    return datos.geo.viewBox;
}

// opciones.leyendas: las listas de leyenda que se muestran superpuestas en pantalla completa (por omisión, las de la
// columna lateral de la vista); opciones.controles: se pasa a agregarControles.
export function crearMapaBase(datos, id, etiqueta, opciones = {}) {
    const [x0, y0, ancho, alto] = datos.geo.viewBox;
    const lienzo = svg('svg', { viewBox: `${x0} ${y0} ${ancho} ${alto}`, role: 'img', class: 'mapa__svg', 'aria-label': etiqueta });
    const defs = svg('defs');
    const filtro = svg('filter', { id: `brillo-${id}`, x: '-50%', y: '-50%', width: '200%', height: '200%' });
    filtro.append(svg('feGaussianBlur', { stdDeviation: 22, result: 'difuso' }));
    const mezcla = svg('feMerge');
    mezcla.append(svg('feMergeNode', { in: 'difuso' }), svg('feMergeNode', { in: 'SourceGraphic' }));
    filtro.append(mezcla);
    defs.append(filtro);
    lienzo.append(defs);
    if (datos.geo.rio) lienzo.append(svg('path', { d: datos.geo.rio, class: 'mapa__rio' }));
    lienzo.append(svg('path', { d: datos.geo.distrito, class: 'mapa__distrito' }));
    const barrios = svg('g', { class: 'mapa__barrios' });
    const porNombre = new Map();
    for (const b of datos.geo.barrios) {
        const p = svg('path', { d: b.d, class: 'mapa__barrio', 'fill-rule': 'evenodd' });
        p.dataset.barrio = b.nombre;
        p.dataset.clave = b.clave;
        barrios.append(p);
        porNombre.set(b.nombre, p);
    }
    lienzo.append(barrios);
    const contenedor = $(id);
    contenedor.replaceChildren(lienzo);
    // Zoom: parte del encuadre que fija el visor (zona elegida o todo el distrito) y «reiniciar» vuelve a él.
    const mapa = { lienzo, barrios: porNombre, filtro: `url(#brillo-${id})`, marco: datos.geo.viewBox, marcoTexto: datos.geo.viewBox.join(' ') };
    mapa.zoom = habilitarZoom(lienzo, () => mapa.marco);
    mapa.fijarMarco = (marco) => {
        const texto = marco.join(' ');
        if (texto === mapa.marcoTexto) return;
        mapa.marco = marco;
        mapa.marcoTexto = texto;
        mapa.zoom.reiniciar();
    };
    const leyendas = opciones.leyendas ?? (() => [...(contenedor.closest('.vista__cuerpo')?.querySelectorAll('.vista__lateral .leyenda') ?? [])]);
    mapa.pantalla = agregarControles(contenedor, mapa.zoom, leyendas, opciones.controles);
    return mapa;
}

// Mapa con las zonas municipales y un punto por mesa alrededor de cada local. Lo usan el tablero, el mapa de mesas y el
// de voto cruzado de «Intendente vs Junta»; alElegir recibe la clave del local tocado.
export function crearMapaConMesas(datos, id, etiqueta, alElegir, opciones = {}) {
    const mapa = crearMapaBase(datos, id, etiqueta, opciones);
    const zonas = svg('g', { class: 'mapa__zonas' });
    const rotulos = svg('g', { class: 'mapa__rotulos' });
    for (const z of datos.geo.zonas_municipales) {
        const contorno = svg('path', { d: z.d, class: 'mapa__zona', 'fill-rule': 'evenodd' });
        contorno.dataset.zonaMunicipal = z.numero;
        zonas.append(titulo(contorno, `Zona municipal ${z.numero}: ${z.nombre}`));
        const { x, y } = lugarRotulo(z.d);
        const lineas = lineasRotulo(z.nombre);
        const texto = svg('text', { x: Math.round(x), y: Math.round(y - ((lineas.length - 1) * 440) / 2), 'text-anchor': 'middle',
            'dominant-baseline': 'middle', class: 'mapa__rotulo' });
        texto.dataset.zonaMunicipal = z.numero;
        lineas.forEach((linea, k) => {
            const tramo = svg('tspan', { x: Math.round(x), dy: k ? 440 : 0 });
            tramo.textContent = linea;
            texto.append(tramo);
        });
        rotulos.append(texto);
    }
    const halos = svg('g', { class: 'mapa__halos' });
    const puntos = svg('g', { class: 'mapa__puntos', filter: mapa.filtro });
    const toques = svg('g', { class: 'mapa__toques' });
    mapa.puntos = [];
    mapa.radioLocal = new Map();
    mapa.radio = PUNTO_M;
    // Cada punto es un trazado: círculo, rombo o cuadrado (formaPunto), con el radio del zoom actual.
    const lugar = new Map();
    mapa.formaPunto = (punto, forma) => {
        if (punto.dataset.forma === forma) return;
        punto.dataset.forma = forma;
        const [x, y] = lugar.get(punto);
        punto.setAttribute('d', simbolo(x, y, mapa.radio, forma));
    };
    for (const [clave, filas] of datos.porLocal) {
        const info = datos.infoLocal.get(clave);
        filas.forEach((f, k) => {
            const angulo = k * 2.399963;
            const radio = ESPIRAL_M * Math.sqrt(k + 0.5);
            const x = Math.round(info.x + radio * Math.cos(angulo)), y = Math.round(info.y + radio * Math.sin(angulo));
            const punto = svg('path', { d: simbolo(x, y, PUNTO_M, 'circulo'), class: 'mapa__mesa' });
            lugar.set(punto, [x, y]);
            punto.dataset.forma = 'circulo';
            punto.dataset.i = f.i;
            punto.dataset.local = clave;
            punto.dataset.zona = f.zona;
            punto.dataset.zm = f.zonaMunicipal ?? '';
            puntos.append(punto);
            mapa.puntos.push(punto);
        });
        const radio = Math.max(120, ESPIRAL_M * Math.sqrt(filas.length) + PUNTO_M + 40);
        mapa.radioLocal.set(clave, radio);
        // Modo Zona TSJE: el halo lleva el color de la zona y los puntos conservan el de su lista.
        const halo = svg('circle', { cx: info.x, cy: info.y, r: radio, class: 'mapa__halo', fill: COLORES_ZONA[info.zona], stroke: COLORES_ZONA[info.zona] });
        halo.dataset.zona = info.zona;
        halo.dataset.zm = info.zona_municipal ?? '';
        halos.append(halo);
        const toque = svg('circle', { cx: info.x, cy: info.y, r: radio, class: 'mapa__toque' });
        toque.dataset.local = clave;
        toques.append(titulo(toque, `${info.nombre} · ${filas.length} mesas · zona TSJE ${info.zona_nombre}`));
    }
    mapa.lienzo.append(zonas, rotulos, halos, puntos, toques, svg('g', { class: 'mapa__ranking' }));
    // Al acercar, el radio de los puntos de mesa crece menos que el mapa: se separan y se distinguen.
    mapa.lienzo.addEventListener('zoommapa', (evento) => {
        const r = Math.round((10 * PUNTO_M) / Math.sqrt(evento.detail.factor)) / 10;
        if (r === mapa.radio) return;
        mapa.radio = r;
        mapa.lienzo.dataset.radioPunto = String(r);
        for (const punto of mapa.puntos) {
            const [x, y] = lugar.get(punto);
            punto.setAttribute('d', simbolo(x, y, r, punto.dataset.forma));
        }
    });
    mapa.lienzo.addEventListener('click', (evento) => {
        const local = evento.target.closest('[data-local]')?.dataset.local;
        if (local) alElegir(local, mapa.lienzo);
    });
    return mapa;
}

// --- Paleta: los mapas no tienen fondo propio; los coropléticos mezclan el color con la superficie del tema activo
// (claro u oscuro) y la leyenda usa el mismo tono. Al cambiar el tema se vuelven a pintar. -------------------------

const aRgb = (hex) => {
    const n = parseInt(hex.trim().slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const aHex = (canales) => `#${canales.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
let paletaTema = null;

export function paleta() {
    const tema = document.documentElement.dataset.theme;
    if (paletaTema?.tema === tema) return paletaTema;
    const css = getComputedStyle(document.documentElement);
    const leer = (nombre, defecto) => aRgb(css.getPropertyValue(nombre).trim() || defecto);
    const fondo = leer('--surface-solid', '#ffffff');
    const suave = leer('--text-muted', '#64748b');
    // Barrio sin dato: gris tenue del tema, el mismo que .leyenda__muestra--vacio en resultados.css.
    paletaTema = { tema, fondo, sinDatos: aHex(fondo.map((v, k) => v + 0.18 * (suave[k] - v))) };
    return paletaTema;
}

export function mezclar(hex, alfa) {
    const { fondo } = paleta();
    return aHex(aRgb(hex).map((v, k) => fondo[k] + alfa * (v - fondo[k])));
}

export function escala(valores, pasos = 5) {
    const min = Math.min(...valores), max = Math.max(...valores);
    const ancho = (max - min) / pasos || 1;
    const cortes = Array.from({ length: pasos + 1 }, (_, i) => min + i * ancho);
    return { cortes, clase: (v) => Math.min(pasos - 1, Math.floor((v - min) / ancho)) };
}

// Quintiles: cinco grupos con (casi) la misma cantidad de barrios; útil para distribuciones muy asimétricas.
export function cuantiles(valores, pasos = 5) {
    const orden = [...valores].sort((a, b) => a - b);
    const cortes = Array.from({ length: pasos + 1 }, (_, k) => orden[Math.round((k * (orden.length - 1)) / pasos)]);
    const clase = (v) => {
        let k = 0;
        while (k < pasos - 1 && v > cortes[k + 1]) k += 1;
        return k;
    };
    return { cortes, clase };
}

export function opacidadPaso(paso, pasos = 5) {
    return 0.28 + (0.7 * paso) / (pasos - 1);
}

// Barrio coroplético: relleno mezclado con la superficie (o el gris «sin dato») y su texto al pasar el puntero.
export function pintarBarrio(path, color, opacidad, texto, seleccionado) {
    path.setAttribute('fill', color ? mezclar(color, opacidad) : paleta().sinDatos);
    path.classList.toggle('es-seleccion', seleccionado);
    path.replaceChildren();
    titulo(path, texto);
}

// forma: la del símbolo en el mapa (círculo por omisión); el nombre de la lista siempre va en el texto.
export function itemLeyenda(color, texto, extra, forma) {
    const li = el('li');
    const muestra = el('span', `leyenda__muestra${extra ? ` ${extra}` : ''}${forma && forma !== 'circulo' ? ` leyenda__muestra--${forma}` : ''}`);
    if (color) muestra.style.background = color;
    li.append(muestra, el('span', null, texto));
    return li;
}
