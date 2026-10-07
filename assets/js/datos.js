// Datos de las elecciones (ADR 0009 del módulo). El manifiesto /datos/elecciones.json enumera elecciones, años,
// cargos y el estado de cada fuente (TREP y cómputo oficial); los JSON viven en /datos/<eleccion>/<anio>/:
// comun/ (geografía, locales, candidaturas, indicadores) y una carpeta por fuente con el mismo esquema.
// Todo se pide al mismo origen y las rutas se resuelven desde la raíz del sitio, también bajo una subruta.
const RAIZ = new URL('../../', import.meta.url);
const FUENTES = ['trep', 'oficial'];

async function leer(url) {
    const respuesta = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!respuesta.ok) throw new Error(`No se pudo leer ${url.pathname}`);
    return respuesta.json();
}

let manifiestoEnCurso = null;

export function manifiesto() {
    manifiestoEnCurso ??= leer(new URL('datos/elecciones.json', RAIZ));
    return manifiestoEnCurso;
}

export const carpeta = (eleccion, anio, parte) => new URL(`datos/${eleccion}/${anio}/${parte}/`, RAIZ);

// Elección y año pedidos (en el hash) si existen en el manifiesto; si no, la primera elección y su año más reciente.
export function elegir(m, pedido = {}) {
    const eleccion = m.elecciones.find((e) => e.id === pedido.eleccion) ?? m.elecciones[0];
    const anios = [...eleccion.anios].sort((a, b) => b.anio - a.anio);
    const anio = anios.find((a) => String(a.anio) === String(pedido.anio)) ?? anios[0];
    return { eleccion, anio };
}

// Carga los JSON de una elección, un año y una fuente. comun: la carpeta común, para resolver las fotos.
export async function cargarEleccion(pedido = {}, fuente = 'trep', archivos = {}) {
    if (!FUENTES.includes(fuente)) throw new Error(`Fuente desconocida: ${fuente}`);
    const m = await manifiesto();
    const { eleccion, anio } = elegir(m, pedido);
    const estado = anio.fuentes?.[fuente]?.estado ?? 'pendiente';
    const comun = carpeta(eleccion.id, anio.anio, 'comun');
    const base = { eleccion, anio, fuente, estado, comun, manifiesto: m };
    if (estado !== 'publicado') return { ...base, datos: null };
    const de = carpeta(eleccion.id, anio.anio, fuente);
    const pedidos = { ...Object.fromEntries((archivos.comun ?? []).map((n) => [n, new URL(n, comun)])),
                      ...Object.fromEntries((archivos.fuente ?? []).map((n) => [n, new URL(n, de)])) };
    const nombres = Object.keys(pedidos);
    const contenidos = await Promise.all(nombres.map((n) => leer(pedidos[n])));
    return { ...base, datos: Object.fromEntries(nombres.map((n, k) => [n, contenidos[k]])) };
}

// Dirección de una foto de candidaturas.json: sus rutas son relativas a la carpeta comun/.
export const urlFoto = (foto, comun) => new URL(foto.archivo, comun).href;
