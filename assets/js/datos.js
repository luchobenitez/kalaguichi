// Datos de las elecciones (ADR 0009 del módulo; ADR-042). El manifiesto /datos/elecciones.json enumera elecciones, años,
// cargos y el estado de cada fuente (TREP y cómputo oficial: cada año declara solo las que existen); los JSON viven en
// /datos/<eleccion>/<anio>/: comun/ (locales, candidaturas), una carpeta por fuente con el mismo esquema y nacional/
// (el país por distrito). Los años del histórico (ADR-042) toman los departamentos y el IPM de otro año (municipales 2026):
// el manifiesto lo declara en «geometria» y estas funciones lo buscan allí; sus distritos son los de entonces (ADR-043):
// «geometria.distritos» dice de qué año es el mapa del país y «geometria.propios», el límite de cada distrito que abarcaba
// varios de hoy (datos/historico/limites/). Todo se pide al mismo origen y las rutas se resuelven desde la raíz del sitio,
// también bajo una subruta.
const RAIZ = new URL('../../', import.meta.url);
const FUENTES = ['trep', 'oficial'];
// Archivos de comun/ que son de la geometría (la vista informe y el IPM por barrio de Asunción): van con «geometria».
const DE_LA_GEOMETRIA = ['geo.json', 'indicadores_barrios.json'];
// Archivos de nacional/ que son de la geometría: el IPM por distrito (INE, Censo 2022).
const NACIONALES_DE_LA_GEOMETRIA = ['indicadores_distritos.json'];

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

// Un año tiene una fuente si la declara (publicada o pendiente); sin fuente pedida, todos.
export const tieneFuente = (anio, fuente) => !fuente || Boolean(anio.fuentes?.[fuente]);

// Las elecciones con algún año que tenga la fuente (el TREP no ofrece las elecciones sin TREP; Oficiales, las que no
// tienen cómputo oficial), con solo esos años, del más reciente al más viejo.
export function eleccionesCon(m, fuente = null) {
    return m.elecciones.map((e) => ({ ...e, anios: [...e.anios].filter((a) => tieneFuente(a, fuente)).sort((a, b) => b.anio - a.anio) }))
        .filter((e) => e.anios.length);
}

// Elección y año pedidos (en el hash) si existen en el manifiesto con la fuente; si no, la primera elección y su año
// más reciente.
export function elegir(m, pedido = {}, fuente = null) {
    const elecciones = eleccionesCon(m, fuente);
    const lista = elecciones.length ? elecciones : eleccionesCon(m);
    const eleccion = lista.find((e) => e.id === pedido.eleccion) ?? lista[0];
    const anio = eleccion.anios.find((a) => String(a.anio) === String(pedido.anio)) ?? eleccion.anios[0];
    return { eleccion: m.elecciones.find((e) => e.id === eleccion.id), anio };
}

// La elección y el año de la geometría de un año: la suya o la que declara en «geometria» (ADR-042).
export const geometriaDe = (eleccion, anio) => (anio.geometria ? { eleccion: anio.geometria.eleccion, anio: anio.geometria.anio }
    : { eleccion: typeof eleccion === 'string' ? eleccion : eleccion.id, anio: anio.anio });

// Carga los JSON de una elección, un año y una fuente. comun: la carpeta común, para resolver las fotos; comunGeo: la de su
// geometría. pedido.distrito (ADR-022): un distrito distinto de Asunción lee su carpeta nacional/distritos/<clave>/, con
// el mismo esquema.
export async function cargarEleccion(pedido = {}, fuente = 'trep', archivos = {}) {
    if (!FUENTES.includes(fuente)) throw new Error(`Fuente desconocida: ${fuente}`);
    const m = await manifiesto();
    const { eleccion, anio } = elegir(m, pedido, fuente);
    const distrito = pedido.distrito && pedido.distrito !== '0-0' && anio.nacional ? pedido.distrito : null;
    const publicada = anio.fuentes?.[fuente]?.estado ?? 'pendiente';
    const estado = distrito && !anio.nacional.fuentes?.includes(fuente) ? 'pendiente' : publicada;
    const raiz = distrito ? new URL(`distritos/${distrito}/`, carpetaNacional(eleccion.id, anio.anio)) : null;
    const comun = raiz ? new URL('comun/', raiz) : carpeta(eleccion.id, anio.anio, 'comun');
    const geo = geometriaDe(eleccion, anio);
    // El límite de un distrito que abarcaba varios de hoy (ADR-043), el de su elección; si no, el de la geometría.
    const limite = distrito ? anio.geometria?.propios?.[distrito] : null;
    const comunGeo = limite ? new URL(`datos/historico/limites/${limite}/`, RAIZ)
        : distrito ? new URL(`distritos/${distrito}/comun/`, carpetaNacional(geo.eleccion, geo.anio)) : carpeta(geo.eleccion, geo.anio, 'comun');
    const base = { eleccion, anio, fuente, estado, comun, comunGeo, manifiesto: m, distrito: distrito ?? (anio.nacional ? '0-0' : null) };
    if (estado !== 'publicado') return { ...base, datos: null };
    const de = raiz ? new URL(`${fuente}/`, raiz) : carpeta(eleccion.id, anio.anio, fuente);
    const pedidos = { ...Object.fromEntries((archivos.comun ?? []).map((n) => [n, new URL(n, DE_LA_GEOMETRIA.includes(n) ? comunGeo : comun)])),
                      ...Object.fromEntries((archivos.fuente ?? []).map((n) => [n, new URL(n, de)])) };
    const nombres = Object.keys(pedidos);
    const contenidos = await Promise.all(nombres.map((n) => leer(pedidos[n])));
    return { ...base, datos: Object.fromEntries(nombres.map((n, k) => [n, contenidos[k]])) };
}

// Dirección de una foto de candidaturas.json: sus rutas son relativas a la carpeta comun/.
export const urlFoto = (foto, comun) => new URL(foto.archivo, comun).href;

// --- Datos nacionales (ADR-022): datos/<eleccion>/<anio>/nacional/, si el año del manifiesto declara «nacional» ------
export const carpetaNacional = (eleccion, anio) => new URL(`datos/${eleccion}/${anio}/nacional/`, RAIZ);
const nacionales = new Map();
function leerNacional(eleccion, anio, nombre) {
    const clave = `${eleccion}/${anio}/${nombre}`;
    if (!nacionales.has(clave)) nacionales.set(clave, leer(new URL(nombre, carpetaNacional(eleccion, anio))));
    return nacionales.get(clave);
}
async function anioDelManifiesto(eleccion, anio) {
    const m = await manifiesto();
    return m.elecciones.find((e) => e.id === eleccion)?.anios.find((a) => String(a.anio) === String(anio)) ?? null;
}
// lista.json (9 KB): clave, nombre y departamento de cada distrito, para el selector de la barra.
export const listaDistritos = (eleccion, anio) => leerNacional(eleccion, anio, 'lista.json');

// El índice del país (distritos.json) en la versión 2 (ADR-042): por distrito, un bloque por cargo con votos, listas,
// ganadora, ventaja, mesas, participación y, en la Junta Municipal, sus bancas. El de municipales 2026 (versión 1: la Junta
// en el registro y la Intendencia en su bloque) se convierte al leerlo, sin tocar el archivo. Con dos fuentes (el Consejo
// de la Magistratura 2023), cada una tiene su índice: «nacional.indices» del manifiesto.
export function normalizarIndice(indice) {
    if ((indice.version ?? 1) >= 2) return indice;
    const distritos = indice.distritos.map((d) => {
        const cargos = { 2: { votos: d.votos, votos_listas: d.votos_listas, blancos: d.blancos, nulos: d.nulos, nocomputados: d.nocomputados,
                              emitidos: d.emitidos, ganadora: d.ganadora, segunda: d.segunda, pct_ganadora: d.pct_ganadora, ventaja: d.ventaja,
                              listas: d.listas, bancas: d.bancas, mesas: d.mesas?.con_acta, participacion: d.participacion,
                              electores_en_mesas_con_acta: d.electores?.en_mesas_con_acta } };
        if (d.intendencia) {
            const i = d.intendencia;
            cargos[1] = { votos: i.votos, votos_listas: i.votos_listas, blancos: i.blancos, nulos: i.nulos, nocomputados: i.nocomputados,
                          emitidos: i.emitidos, ganadora: i.ganadora, segunda: i.segunda, pct_ganadora: i.pct_ganadora, ventaja: i.ventaja,
                          listas: i.listas, mesas: i.mesas?.con_acta, participacion: i.participacion,
                          electores_en_mesas_con_acta: i.electores_en_mesas_con_acta };
        }
        return { ...d, cargos };
    });
    return { ...indice, version: 2, distritos };
}

export async function indiceNacional(eleccion, anio, fuente = null) {
    const a = await anioDelManifiesto(eleccion, anio);
    const nombre = (fuente && a?.nacional?.indices?.[fuente]) || 'distritos.json';
    return normalizarIndice(await leerNacional(eleccion, anio, nombre));
}

// La geometría del país (geo/distritos.geojson y geo/departamentos.geojson): la del año o la que declara «geometria»; los
// distritos, los de esa elección si «geometria.distritos» lo dice (ADR-043).
export async function geoNacional(eleccion, anio, nombre) {
    const a = await anioDelManifiesto(eleccion, anio);
    const geo = a?.geometria?.distritos && nombre === 'distritos' ? a.geometria.distritos : a ? geometriaDe(eleccion, a) : { eleccion, anio };
    return leerNacional(geo.eleccion, geo.anio, `geo/${nombre}.geojson`);
}

// Cualquier otro archivo de nacional/ (colores.json, procedencia.json, electos.json), una sola vez; el IPM por distrito,
// de la geometría.
export async function archivoNacional(eleccion, anio, nombre) {
    if (NACIONALES_DE_LA_GEOMETRIA.includes(nombre)) {
        const a = await anioDelManifiesto(eleccion, anio);
        const geo = a ? geometriaDe(eleccion, a) : { eleccion, anio };
        return leerNacional(geo.eleccion, geo.anio, nombre);
    }
    return leerNacional(eleccion, anio, nombre);
}
