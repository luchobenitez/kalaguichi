// Tablero de resultados en una pantalla (ADR-017 y ADR-021 del proyecto): un panel de pestañas (Resultados de la
// selección, D'Hondt, Filtros con la ruta geográfica Asunción › zona › barrio › local › mesa y la búsqueda, Capas y
// Método) y el mapa, con la bandeja de Tabla y Ranking desplegable sobre él (hoja.js); las estadísticas de la selección,
// la fuente y el método van en diálogos (dialogos.js). Elegir en el mapa, en la tabla, en el ranking o en los filtros
// cambia la misma selección; cambiar de capa conserva el zoom y la selección. Todo número sale de
// /datos/<eleccion>/<anio>/ según el manifiesto (datos.js); el mismo módulo sirve a cada fuente (TREP u oficial).
// Sin HTML desde datos: el texto va con textContent y los estilos por CSSOM.
import { vigilarDesplazables } from '../desplazables.js';
import { cargarEleccion } from '../datos.js';
import { estado as compartido, listo as shellListo } from '../shell.js';
import { $, el, cantidad, fmt, pct, pct2, porcentaje } from './util.js';
import { formaDe, cargarModelo, ganador, participacion, ventajaDe, agregadosBarrio, unidades, textoBarrio, compararFuentes } from './modelo.js';
import { PARTICIPACION_COLOR, IPM_COLOR, COLORES_ZONA, mezclar, escala, cuantiles, opacidadPaso, paleta, itemLeyenda } from './mapa.js';
import { crearMapaGL } from './mapa_gl.js';
import { renderTotales, renderBancas } from './panel.js';
import { crearPanel, crearBandeja } from './hoja.js';
import { crearDialogos } from './dialogos.js';

const CAPAS = ['lista', 'listas', 'participacion', 'margen', 'ipm', 'zona', 'zona_municipal'];
const BASES = ['calles', 'ninguno'];
// Elementos visibles del mapa (casillas de la pestaña Capas) y los que se ven por omisión.
const ELEMENTOS = ['limites', 'nombres', 'puntos', 'manzanas'];
const VER_POR_OMISION = 'limites,nombres,puntos';
const OPACIDAD_POR_OMISION = 45;
const UNIDADES = ['mesa', 'local', 'barrio', 'zona', 'zona_municipal'];
const PANELES = ['resultados', 'dhondt', 'filtros', 'capas', 'metodo'];
const BANDEJAS = ['tabla', 'ranking'];
const IPM = ['H', 'A', 'IPM'];
const CARGO_HASH = { 1: 'intendencia', 2: 'junta' };
// Equivalencias con la vista informe: sus pestañas (vista) y las capas del tablero.
const VISTA_A_CAPA = { mapa: 'lista', barrios: 'lista', listas: 'listas', participacion: 'participacion', ipm: 'ipm', margen: 'margen', tablas: 'lista' };
const CAPA_A_VISTA = { lista: 'mapa', listas: 'listas', participacion: 'participacion', margen: 'margen', ipm: 'ipm' };
const TITULOS_CAPA = { lista: 'Lista más votada por barrio', listas: 'Votos por lista, por barrio', participacion: 'Participación por barrio',
                       margen: 'Margen entre el primero y el segundo', ipm: 'Pobreza multidimensional por barrio', zona: 'Zonas electorales del TSJE',
                       zona_municipal: 'Zonas municipales' };
// Margen entre el primero y el segundo: tramos de la ventaja en puntos (menos de 10, de 10 a 25 y 25 o más).
const TRAMOS_MARGEN = [10, 25];
const TEXTO_TRAMO = ['por menos de 10 puntos', 'por 10 a 25 puntos', 'por 25 puntos o más'];
const GRIS = '#9ca3af';
// Fuentes: cómo se nombran dentro de una frase.
const EN_LA_FUENTE = { trep: 'el TREP', oficial: 'el cómputo oficial' };

const estado = { cargo: '1', capa: 'lista', zona: null, zonaMunicipal: null, barrio: null, local: null, mesa: null,
                 lista: { 1: null, 2: null }, medida: 'pct', ipm: 'H', tabla: 'local', orden: null, filtro: '',
                 panel: 'resultados', bandeja: null, ranking: 'local', ordenRanking: 'desc',
                 base: 'calles', opacidad: OPACIDAD_POR_OMISION, ver: { limites: true, nombres: true, puntos: true, manzanas: false } };
let datos, mapa, panel, bandeja, dialogos;
let fuente = 'trep';
let otraFuente = 'oficial';
let agregados = new Map();
let enlaceListo = false;      // La carga no escribe el hash: la dirección queda limpia hasta el primer cambio.
let seleccionMostrada = '';   // La tabla y el ranking se desplazan hasta la fila elegida solo cuando cambia la selección.

const infoDe = (clave) => datos.infoLocal.get(clave);
const colorDe = (j) => datos.listas[estado.cargo][j].color;
const normalizarTexto = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
const hayZona = () => estado.zona !== null || estado.zonaMunicipal !== null;
const haySeleccion = () => hayZona() || Boolean(estado.barrio || estado.local);
const claveSeleccion = () => [estado.zona, estado.zonaMunicipal, estado.barrio, estado.local, estado.mesa, estado.tabla, estado.ranking].join('|');

// Filtro de zona: electoral (TSJE, de las actas) o municipal (oficial, por la ubicación del local).
function enZona(f) {
    return (estado.zona === null || f.zona === estado.zona) && (estado.zonaMunicipal === null || f.zonaMunicipal === estado.zonaMunicipal);
}

function fueraDeZona(info) {
    return (estado.zona !== null && info.zona !== estado.zona) || (estado.zonaMunicipal !== null && info.zona_municipal !== estado.zonaMunicipal);
}

function nombreZona() {
    if (estado.zonaMunicipal !== null) return `Zona municipal ${estado.zonaMunicipal} · ${datos.resumen.zonas_municipales[estado.zonaMunicipal]}`;
    if (estado.zona !== null) return `Zona TSJE ${estado.zona} · ${datos.resumen.zonas[estado.zona]}`;
    return null;
}

// Lista elegida para la capa «Votos por lista» (por omisión, la más votada en Asunción).
function listaElegida() {
    const j = estado.lista[estado.cargo];
    if (j !== null && j < datos.listas[estado.cargo].length) return j;
    estado.lista[estado.cargo] = ganador(datos.totalAsuncion[estado.cargo].votos) ?? 0;
    return estado.lista[estado.cargo];
}

// --- Selección: el nivel más profundo de la ruta geográfica ---------------------------------------------------------

function seleccion() {
    if (estado.local) {
        const info = infoDe(estado.local);
        const meta = [info.direccion, info.barrio ? `barrio ${info.barrio}` : null].filter(Boolean).join(' · ');
        if (estado.mesa !== null) {
            const fila = datos.porLocal.get(estado.local).find((f) => f.mesa === estado.mesa);
            return { titulo: `Mesa ${estado.mesa}`, eyebrow: `Mesa · ${info.nombre}`, indices: [fila.i], meta };
        }
        return { titulo: info.nombre, eyebrow: `Local · zona ${info.zona_nombre}`, indices: datos.porLocal.get(estado.local).map((f) => f.i), meta };
    }
    if (estado.barrio) {
        const b = datos.barrioPor.get(estado.barrio);
        const locales = [...datos.infoLocal.values()].filter((x) => x.barrio === estado.barrio).length;
        return { titulo: estado.barrio, eyebrow: 'Barrio (ubicación de los locales)', indices: datos.mesasDe((f) => f.barrio === estado.barrio),
                 meta: [cantidad(locales, 'local', 'locales'), b?.poblacion_2022 ? `población 2022: ${fmt.format(b.poblacion_2022)}` : null].filter(Boolean).join(' · ') };
    }
    if (estado.zonaMunicipal !== null) {
        const locales = [...datos.infoLocal.values()].filter((x) => x.zona_municipal === estado.zonaMunicipal).length;
        return { titulo: datos.resumen.zonas_municipales[estado.zonaMunicipal], eyebrow: `Zona municipal ${estado.zonaMunicipal} (oficial)`,
                 indices: datos.mesasDe((f) => f.zonaMunicipal === estado.zonaMunicipal), meta: `${cantidad(locales, 'local ubicado', 'locales ubicados')} en la zona` };
    }
    if (estado.zona !== null) {
        return { titulo: datos.resumen.zonas[estado.zona], eyebrow: `Zona TSJE ${estado.zona}`, indices: datos.mesasDe((f) => f.zona === estado.zona), meta: '' };
    }
    return { titulo: 'Asunción', eyebrow: 'Resultado', indices: datos.filas.map((f) => f.i), meta: '' };
}

// Mesas esperadas de la selección que no tienen acta (para «Actas computadas» y «Mesas sin acta»).
function sinActa() {
    return datos.faltantes.filter((x) => {
        if (estado.local) return estado.mesa === null && x.clave === estado.local;
        if (estado.barrio) return x.info?.barrio === estado.barrio;
        if (estado.zonaMunicipal !== null) return x.info?.zona_municipal === estado.zonaMunicipal;
        if (estado.zona !== null) return x.zona === estado.zona;
        return true;
    });
}

// Ruta geográfica de la selección: Asunción › zona › barrio › local › mesa.
function pasosRuta() {
    const pasos = [{ nivel: 'asuncion', texto: 'Asunción' }];
    if (hayZona()) pasos.push({ nivel: 'zona', texto: nombreZona() });
    if (estado.barrio) pasos.push({ nivel: 'barrio', texto: estado.barrio });
    if (estado.local) pasos.push({ nivel: 'local', texto: infoDe(estado.local).nombre });
    if (estado.mesa !== null) pasos.push({ nivel: 'mesa', texto: `Mesa ${estado.mesa}` });
    return pasos;
}

// --- Filtros: ruta geográfica, búsqueda y capas -------------------------------------------------------------------

const opcionesPrevias = new WeakMap();
function rellenar(select, opciones, valor) {
    const clave = opciones.map(([v, t]) => `${v}=${t}`).join('|');
    if (opcionesPrevias.get(select) !== clave) {
        select.replaceChildren(...opciones.map(([v, t]) => new Option(t, v)));
        opcionesPrevias.set(select, clave);
    }
    select.value = valor;
}

function renderFiltros() {
    $('nivelZona').value = estado.zonaMunicipal !== null ? `m${estado.zonaMunicipal}` : estado.zona !== null ? `t${estado.zona}` : '';
    const enLaZona = [...datos.infoLocal.entries()].filter(([, x]) => !fueraDeZona(x));
    const barrios = [...new Set(enLaZona.map(([, x]) => x.barrio).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    rellenar($('nivelBarrio'), [['', `Todos los barrios (${fmt.format(barrios.length)})`], ...barrios.map((b) => [b, b])], estado.barrio ?? '');
    const locales = enLaZona.filter(([, x]) => !estado.barrio || x.barrio === estado.barrio).sort(([, a], [, b]) => a.nombre.localeCompare(b.nombre, 'es'));
    rellenar($('nivelLocal'), [['', `Todos los locales (${fmt.format(locales.length)})`], ...locales.map(([clave, x]) => [clave, x.nombre])], estado.local ?? '');
    const mesas = estado.local ? datos.porLocal.get(estado.local).map((f) => f.mesa).sort((a, b) => a - b) : [];
    rellenar($('nivelMesa'), [['', estado.local ? `Todas las mesas (${mesas.length})` : 'Elegí antes un local'], ...mesas.map((m) => [String(m), `Mesa ${m}`])],
        estado.mesa === null ? '' : String(estado.mesa));
    $('nivelMesa').disabled = !estado.local;
    const pasos = pasosRuta();
    $('rutaGeo').replaceChildren(...pasos.map((paso, k) => {
        const li = el('li');
        if (k === pasos.length - 1) {
            const actual = el('span', 'ruta-geo__actual', paso.texto);
            actual.setAttribute('aria-current', 'location');
            li.append(actual);
        } else {
            const boton = el('button', 'ruta-geo__paso', paso.texto);
            boton.type = 'button';
            boton.dataset.nivel = paso.nivel;
            boton.setAttribute('aria-label', `Volver a ${paso.texto}`);
            li.append(boton);
        }
        return li;
    }));
}

function renderCapas() {
    for (const boton of document.querySelectorAll('[data-base]')) boton.setAttribute('aria-pressed', String(boton.dataset.base === estado.base));
    for (const radio of document.querySelectorAll('input[name="capa"]')) radio.checked = radio.value === estado.capa;
    $('opacidadCapa').value = String(estado.opacidad);
    $('valorOpacidad').textContent = `${fmt.format(estado.opacidad)} %`;
    for (const casilla of document.querySelectorAll('input[name="ver"]')) casilla.checked = Boolean(estado.ver[casilla.value]);
    $('detalleListas').hidden = estado.capa !== 'listas';
    $('detalleIpm').hidden = estado.capa !== 'ipm';
    const selector = $('capaLista');
    if (selector.dataset.cargo !== estado.cargo) {
        selector.replaceChildren(...datos.listas[estado.cargo].map((item, j) => new Option(estado.cargo === '1' ? `${item.sigla} · ${item.nombre}` : `${item.sigla} · lista ${item.num}`, String(j))));
        selector.dataset.cargo = estado.cargo;
    }
    selector.value = String(listaElegida());
    for (const boton of document.querySelectorAll('[data-medida]')) boton.setAttribute('aria-pressed', String(boton.dataset.medida === estado.medida));
    for (const boton of document.querySelectorAll('[data-ipm]')) boton.setAttribute('aria-pressed', String(boton.dataset.ipm === estado.ipm));
}

// --- Mapa (MapLibre, mapa_gl.js): una capa temática semitransparente (barrios, zonas o halos de la zona TSJE), los
// límites y los puntos de mesas o locales; las calles del mapa base se ven debajo -----------------------------------

let encuadreMostrado = null;  // El encuadre solo cambia con la zona: cambiar de capa o de local conserva el zoom.

// Píxeles del mapa tapados por la hoja (celular), la bandeja abierta o el cajón (tablet vertical), y por las
// herramientas de arriba: el encuadre deja el local o la zona en la parte que se ve.
function margenMapa() {
    const lienzo = $('mapa').getBoundingClientRect();
    const tapan = [panel?.celular() ? $('hoja') : null, bandeja?.abierta() ? $('bandeja') : null].filter(Boolean);
    const abajo = Math.max(0, ...tapan.map((n) => lienzo.bottom - n.getBoundingClientRect().top));
    const izquierda = panel?.cajon() && panel.abierto() ? Math.max(0, $('hoja').getBoundingClientRect().right - lienzo.left) : 0;
    const limitar = (v, max) => Math.max(8, Math.min(v, max));
    return { top: limitar(64, lienzo.height / 3), right: limitar(56, lienzo.width / 4), bottom: limitar(abajo + 20, lienzo.height * 0.7),
             left: limitar(izquierda + 20, lienzo.width * 0.7) };
}

function crearMapa() {
    // La leyenda y la atribución van superpuestas al mapa, también en pantalla completa.
    $('mapa').append($('leyendaMapa'), $('atribucionMapa'));
    mapa = crearMapaGL(datos, $('mapa'), {
        etiqueta: 'Mapa de Asunción con los barrios, las zonas municipales y los locales y mesas de votación',
        atribucion: $('atribucionMapa'), margen: margenMapa, controles: { ampliarEnGrupo: true }, puntosPorLocal: true,
        alTocarLocal: (clave) => tocarLocal(clave),
        alTocarBarrio: (nombre) => { if (agregados.has(nombre)) tocarBarrio(nombre); },
        alTocarZona: (numero) => elegirZona(`m${numero}`),
        alCambiarEstilo: () => renderMapa(),
    });
}

const tramoMargen = (m) => (Math.abs(m) < TRAMOS_MARGEN[0] ? 0 : Math.abs(m) < TRAMOS_MARGEN[1] ? 1 : 2);
const opacidad = () => estado.opacidad / 100;
// Muestra de la leyenda del relleno: con la opacidad elegida, como se ve en el mapa.
function itemRelleno(color, texto, extra) {
    const li = itemLeyenda(color, texto, extra);
    if (color) li.firstChild.style.opacity = String(Math.max(0.12, opacidad()));
    return li;
}

// Puntos de mesas (al acercar) y de locales (al alejar): el color y la forma de la lista más votada.
function pintarPuntos(leyenda) {
    const c = datos.mesas.cargos[estado.cargo];
    const conteo = new Map();
    mapa.pintarMesas((m) => {
        const f = datos.filas[m.i];
        const j = ganador(c.votos[m.i]);
        const visible = enZona(f);
        if (visible) conteo.set(j ?? 'empate', (conteo.get(j ?? 'empate') ?? 0) + 1);
        return { color: j === null ? GRIS : colorDe(j), forma: j === null ? 'circulo' : formaDe(datos.listas[estado.cargo][j]), atenuado: !visible,
                 seleccionada: m.clave === estado.local && estado.mesa === f.mesa,
                 texto: `${infoDe(m.clave).nombre} · mesa ${f.mesa} · ${j === null ? 'empate' : `${datos.listas[estado.cargo][j].sigla} más votada`}` };
    });
    mapa.pintarLocales((clave, info) => {
        const total = datos.sumar(datos.porLocal.get(clave).map((f) => f.i), estado.cargo);
        const j = ganador(total.votos);
        const lider = j === null ? 'empate' : `${datos.listas[estado.cargo][j].sigla} ${pct.format((100 * total.votos[j]) / total.listas)} %`;
        return { color: j === null ? GRIS : colorDe(j), forma: j === null ? 'circulo' : formaDe(datos.listas[estado.cargo][j]),
                 escala: Math.sqrt(info.electores) / 50, atenuado: fueraDeZona(info),
                 texto: `${info.nombre} · ${lider} · ${cantidad(total.mesas, 'mesa', 'mesas')} · ${fmt.format(info.electores)} electores` };
    });
    if (!estado.ver.puntos) return;
    leyenda.append(el('li', 'leyenda__subtitulo', 'Puntos: locales (al acercar, sus mesas) con la lista más votada'));
    datos.listas[estado.cargo].forEach((item, j) => {
        const n = conteo.get(j);
        if (n) leyenda.append(itemLeyenda(item.color, `${item.sigla}: ${cantidad(n, 'mesa', 'mesas')}`, null, formaDe(item)));
    });
    if (conteo.get('empate')) leyenda.append(itemLeyenda(null, `Empate: ${cantidad(conteo.get('empate'), 'mesa', 'mesas')}`, 'leyenda__muestra--empate'));
}

const barrioElegido = (nombre) => nombre === estado.barrio && !estado.local;

// Barrios sin relleno (capas que no son de barrios): solo el contorno, con su texto al pasar el puntero.
function vaciarBarrios() {
    mapa.pintarBarrios((b) => ({ color: null, seleccion: barrioElegido(b.nombre), texto: textoBarrio(datos, b.nombre, agregados.get(b.nombre), estado.cargo) }));
}

const sinLocales = (b) => ({ color: paleta().sinDatos, seleccion: barrioElegido(b.nombre), texto: textoBarrio(datos, b.nombre, null, estado.cargo) });

// Lista más votada en cada barrio (por la ubicación de sus locales).
function pintarLista(leyenda) {
    const listas = datos.listas[estado.cargo];
    const conteo = new Map();
    mapa.pintarBarrios((b) => {
        const total = agregados.get(b.nombre);
        if (!total || !total.listas) return sinLocales(b);
        const j = ganador(total.votos);
        conteo.set(j ?? 'empate', (conteo.get(j ?? 'empate') ?? 0) + 1);
        return { color: j === null ? GRIS : colorDe(j), seleccion: barrioElegido(b.nombre), texto: textoBarrio(datos, b.nombre, total, estado.cargo) };
    });
    listas.forEach((item, j) => {
        if (conteo.get(j)) leyenda.append(itemRelleno(item.color, `${item.sigla} más votada: ${cantidad(conteo.get(j), 'barrio', 'barrios')}`, 'leyenda__muestra--escala'));
    });
    if (conteo.get('empate')) leyenda.append(itemRelleno(GRIS, `Empate: ${cantidad(conteo.get('empate'), 'barrio', 'barrios')}`, 'leyenda__muestra--escala'));
    leyenda.append(itemLeyenda(null, 'Sin locales de votación', 'leyenda__muestra--vacio'));
    $('notaCapa').textContent = 'Cada barrio, con el color de la lista más votada en sus locales de votación (el barrio es la ubicación del local, ' +
        'no la residencia de sus electores). Encima, los locales y, al acercar, sus mesas. Tocá un barrio o un local para ver sus cifras.';
}

function pintarListas(leyenda) {
    const listas = datos.listas[estado.cargo];
    const j = listaElegida();
    const enPct = estado.medida === 'pct';
    const medir = (t) => (enPct ? (100 * t.votos[j]) / t.listas : t.votos[j]);
    const rotular = (v) => (enPct ? `${pct.format(v)} %` : `${fmt.format(Math.round(v))} votos`);
    const { cortes, clase } = escala([...agregados.values()].filter((t) => t.listas).map(medir));
    mapa.pintarBarrios((b) => {
        const total = agregados.get(b.nombre);
        if (!total || !total.listas) return sinLocales(b);
        return { color: mezclar(listas[j].color, opacidadPaso(clase(medir(total)))), seleccion: barrioElegido(b.nombre),
                 texto: `${b.nombre}: ${listas[j].sigla} ${fmt.format(total.votos[j])} votos (${pct.format((100 * total.votos[j]) / total.listas)} % de los votos a listas)` };
    });
    for (let k = 0; k < cortes.length - 1; k++) leyenda.append(itemRelleno(mezclar(listas[j].color, opacidadPaso(k)), `${rotular(cortes[k])} a ${rotular(cortes[k + 1])}`, 'leyenda__muestra--escala'));
    leyenda.append(itemLeyenda(null, 'Sin locales de votación', 'leyenda__muestra--vacio'));
    $('notaCapa').textContent = (enPct
        ? `Porcentaje de ${listas[j].sigla} (${listas[j].lista}) sobre los votos a listas de los locales de cada barrio`
        : `Votos de ${listas[j].sigla} (${listas[j].lista}) en los locales de cada barrio; depende de cuántas mesas hay en el barrio`) +
        ', en 5 tramos iguales entre el mínimo y el máximo. El barrio es la ubicación del local, no la residencia de sus electores. Tocá un barrio para ver sus cifras.';
}

function pintarParticipacion(leyenda) {
    const { cortes, clase } = escala([...agregados.values()].filter((t) => t.electores).map(participacion));
    mapa.pintarBarrios((b) => {
        const total = agregados.get(b.nombre);
        if (!total || !total.electores) return sinLocales(b);
        const v = participacion(total);
        return { color: mezclar(PARTICIPACION_COLOR, opacidadPaso(clase(v))), seleccion: barrioElegido(b.nombre),
                 texto: `${b.nombre}: participación ${pct.format(v)} % (${fmt.format(total.emitidos)} de ${fmt.format(total.electores)} electores)` };
    });
    for (let k = 0; k < cortes.length - 1; k++) leyenda.append(itemRelleno(mezclar(PARTICIPACION_COLOR, opacidadPaso(k)), `${pct.format(cortes[k])} a ${pct.format(cortes[k + 1])} %`, 'leyenda__muestra--escala'));
    leyenda.append(itemLeyenda(null, 'Sin locales de votación', 'leyenda__muestra--vacio'));
    const r = datos.resumen.electores;
    $('notaCapa').textContent = 'Votos emitidos sobre electores habilitados de las mesas con acta, por barrio de los locales. Electores: recuento ' +
        `agregado del padrón por mesa (${fmt.format(r.en_mesas_con_acta)} en las mesas con acta). ${fmt.format(r.mesas_con_mas_emitidos_que_electores)} mesas ` +
        'tienen más votos que electores: se muestran tal cual, sin interpretarlas. Tocá un barrio para ver sus cifras.';
}

// Margen entre el primero y el segundo de cada barrio: el color de la que va primera, más intenso cuanto mayor la ventaja.
function pintarMargen(leyenda) {
    const listas = datos.listas[estado.cargo];
    const conteo = new Map();
    mapa.pintarBarrios((b) => {
        const total = agregados.get(b.nombre);
        const v = total && ventajaDe(total);
        if (!v) return sinLocales(b);
        if (v.empate) {
            conteo.set('empate', (conteo.get('empate') ?? 0) + 1);
            return { color: GRIS, seleccion: barrioElegido(b.nombre), texto: `${b.nombre}: empate entre ${listas[v.primero].sigla} y ${listas[v.segundo].sigla}` };
        }
        const k = tramoMargen(v.puntos);
        conteo.set(`${v.primero}-${k}`, (conteo.get(`${v.primero}-${k}`) ?? 0) + 1);
        return { color: mezclar(colorDe(v.primero), opacidadPaso(k, 3)), seleccion: barrioElegido(b.nombre),
                 texto: `${b.nombre}: ${listas[v.primero].sigla} primera, ${pct.format(v.puntos)} puntos sobre ${listas[v.segundo].sigla}` };
    });
    listas.forEach((item, j) => {
        for (const k of [2, 1, 0]) {
            const n = conteo.get(`${j}-${k}`);
            if (n) leyenda.append(itemRelleno(mezclar(item.color, opacidadPaso(k, 3)), `${item.sigla} primera ${TEXTO_TRAMO[k]}: ${cantidad(n, 'barrio', 'barrios')}`, 'leyenda__muestra--escala'));
        }
    });
    if (conteo.get('empate')) leyenda.append(itemRelleno(GRIS, `Empate: ${cantidad(conteo.get('empate'), 'barrio', 'barrios')}`, 'leyenda__muestra--escala'));
    leyenda.append(itemLeyenda(null, 'Sin locales de votación', 'leyenda__muestra--vacio'));
    $('notaCapa').textContent = 'Margen = 100 × (votos del primero − votos del segundo) / votos a listas, en puntos, en los locales de cada barrio. ' +
        'Color de la lista que va primera en ese barrio (puede no ser la misma en todos), más intenso cuanto mayor la ventaja: menos de 10, de 10 a 25 ' +
        'y 25 puntos o más. Tocá un barrio para ver sus cifras.';
}

// IPM por barrio (INE, Censo 2022), en quintiles.
function pintarIpm(leyenda) {
    const ind = datos.ipm.indicadores.find((x) => x.id === estado.ipm);
    const formato = estado.ipm === 'A' ? pct : pct2;
    // Sin dato publicado, o intensidad sin personas pobres (H = 0): no se colorea.
    const valorDe = (b) => (!b || b[estado.ipm] === null || (estado.ipm === 'A' && b.H === 0) ? null : b[estado.ipm]);
    const motivo = (b) => (!b ? 'sin dato' : b.nota ?? 'sin dato');
    const { cortes, clase } = cuantiles(datos.geo.barrios.map((b) => valorDe(datos.ipmPor.get(b.clave))).filter((v) => v !== null));
    const conteo = new Array(5).fill(0);
    let sinColor = 0;
    mapa.pintarBarrios((b) => {
        const x = datos.ipmPor.get(b.clave);
        const v = valorDe(x);
        if (v === null) {
            sinColor += 1;
            return { color: paleta().sinDatos, seleccion: barrioElegido(b.nombre), texto: `${b.nombre}: ${motivo(x)}` };
        }
        const k = clase(v);
        conteo[k] += 1;
        return { color: mezclar(IPM_COLOR, opacidadPaso(k)), seleccion: barrioElegido(b.nombre), texto: `${b.nombre}: ${ind.nombre} ${formato.format(v)} %` };
    });
    for (let k = 0; k < 5; k++) {
        leyenda.append(itemRelleno(mezclar(IPM_COLOR, opacidadPaso(k)), `${formato.format(cortes[k])} a ${formato.format(cortes[k + 1])} % · ${cantidad(conteo[k], 'barrio', 'barrios')}`, 'leyenda__muestra--escala'));
    }
    if (sinColor) leyenda.append(itemLeyenda(null, `Sin dato o no aplica: ${cantidad(sinColor, 'barrio', 'barrios')}`, 'leyenda__muestra--vacio'));
    $('notaCapa').textContent = `${ind.nombre}: ${ind.descripcion} Barrios en quintiles (INE, Censo 2022). Encima, los locales de votación con el ` +
        'color y la forma de la lista más votada y tamaño según sus electores. Es una comparación entre agregados: no muestra cómo votaron las personas ' +
        'en situación de pobreza ni ningún otro grupo, y el barrio del local no es necesariamente el de residencia de sus electores.';
}

// Zonas electorales del TSJE: sin polígonos publicados, un halo del color de la zona alrededor de cada local.
function pintarZonasTsje(leyenda) {
    const porZona = new Map();
    for (const [clave, info] of datos.infoLocal) {
        if (!datos.porLocal.has(clave) || fueraDeZona(info)) continue;
        porZona.set(info.zona, (porZona.get(info.zona) ?? 0) + 1);
    }
    mapa.pintarHalos((clave, info) => ({ color: COLORES_ZONA[info.zona], atenuado: fueraDeZona(info) }));
    for (const [codigo, nombre] of Object.entries(datos.resumen.zonas)) {
        const n = porZona.get(Number(codigo));
        if (!n) continue;
        const li = itemLeyenda(null, `Zona TSJE ${codigo} · ${nombre}: ${cantidad(n, 'local', 'locales')}`, 'leyenda__muestra--halo');
        li.firstChild.style.borderColor = COLORES_ZONA[codigo];
        li.firstChild.style.opacity = String(Math.max(0.2, opacidad()));
        leyenda.append(li);
    }
    $('notaCapa').textContent = 'El TSJE no publica los límites de sus zonas electorales: cada local lleva un halo del color de su zona, que no coincide ' +
        'con las zonas municipales. Tocá un local para ver sus cifras.';
}

// Las 6 zonas municipales oficiales, con los colores de zona del sitio (en el orden de su número).
function pintarZonasMunicipales(leyenda) {
    const numeros = Object.keys(datos.resumen.zonas_municipales).map(Number).sort((a, b) => a - b);
    const color = (n) => COLORES_ZONA[numeros.indexOf(n) + 1] ?? GRIS;
    mapa.pintarZonas((z) => ({ color: color(z.numero), seleccion: z.numero === estado.zonaMunicipal,
                               atenuada: estado.zonaMunicipal !== null && z.numero !== estado.zonaMunicipal,
                               texto: `Zona municipal ${z.numero}: ${z.nombre}` }));
    for (const n of numeros) leyenda.append(itemRelleno(color(n), `Zona municipal ${n} · ${datos.resumen.zonas_municipales[n]}`, 'leyenda__muestra--escala'));
    $('notaCapa').textContent = 'Las 6 zonas municipales oficiales (Municipalidad de Asunción). Tocá una zona fuera de los barrios, o elegila en Filtros, ' +
        'para ver sus cifras.';
}

// Encuadre del filtro de zona: la zona municipal, los locales de la zona TSJE o el distrito.
function cajaDeZona() {
    if (estado.zonaMunicipal !== null) return mapa.cajaZonaMunicipal(estado.zonaMunicipal);
    if (estado.zona !== null) return mapa.cajaLocales([...datos.infoLocal.entries()].filter(([, x]) => x.zona === estado.zona).map(([k]) => k));
    return mapa.cajaDistrito();
}

const PINTORES = { lista: pintarLista, listas: pintarListas, participacion: pintarParticipacion, margen: pintarMargen, ipm: pintarIpm };

function renderMapa() {
    if (estado.capa !== 'zona_municipal') {
        mapa.pintarZonas((z) => ({ color: null, seleccion: z.numero === estado.zonaMunicipal,
                                   atenuada: estado.zonaMunicipal !== null && z.numero !== estado.zonaMunicipal, texto: `Zona municipal ${z.numero}: ${z.nombre}` }));
    }
    const clave = `${estado.zona}|${estado.zonaMunicipal}`;
    if (clave !== encuadreMostrado) {
        encuadreMostrado = clave;
        mapa.listo.then(() => mapa.encuadrar(cajaDeZona())).catch(() => {});
    }
    mapa.fijarBase(estado.base === 'calles');
    mapa.fijarOpacidad(opacidad());
    mapa.fijarElementos(estado.ver);
    const leyenda = $('leyenda');
    leyenda.replaceChildren();
    $('tituloLeyenda').textContent = TITULOS_CAPA[estado.capa];
    if (PINTORES[estado.capa]) PINTORES[estado.capa](leyenda);
    else vaciarBarrios();
    if (estado.capa === 'zona') pintarZonasTsje(leyenda);
    else mapa.pintarHalos(null);
    if (estado.capa === 'zona_municipal') pintarZonasMunicipales(leyenda);
    mapa.mostrar({ 'k-halos': estado.capa === 'zona' });
    leyenda.append(el('li', 'leyenda__nota', `Relleno al ${fmt.format(estado.opacidad)} %${estado.base === 'calles' ? ', con las calles debajo' : ''}.`));
    pintarPuntos(leyenda);
    leyenda.append(itemLeyenda(null, 'Contorno: zonas municipales oficiales', 'leyenda__muestra--zona'));
    mapa.marcar(estado.local);
}

function enfocarLocal(clave) {
    mapa.enfocarLocal(clave);
}

function enfocarBarrio(nombre) {
    mapa.enfocarCaja(mapa.cajaBarrio(nombre));
}

// --- Tabla y ranking ------------------------------------------------------------------------------------------------

function esElegida(u) {
    if (estado.tabla === 'mesa') return Boolean(estado.local) && u.local === estado.local && (estado.mesa === null || u.mesa === estado.mesa);
    if (estado.tabla === 'local') return Boolean(estado.local) && u.local === estado.local;
    if (estado.tabla === 'barrio') return Boolean(estado.barrio) && u.barrioClave === estado.barrio;
    if (estado.tabla === 'zona') return estado.zona !== null && u.zona === estado.zona;
    return estado.zonaMunicipal !== null && u.zonaMunicipal === estado.zonaMunicipal;
}

function renderTabla() {
    $('unidadTabla').value = estado.tabla;
    const listas = datos.listas[estado.cargo];
    const titulos = { mesa: 'Mesa', local: 'Local', barrio: 'Barrio', zona: 'Zona TSJE', zona_municipal: 'Zona municipal' };
    const columnas = [{ id: 'nombre', titulo: titulos[estado.tabla], texto: true }];
    if (estado.tabla === 'mesa' || estado.tabla === 'local') columnas.push({ id: 'zona', titulo: 'Zona' });
    if (estado.tabla === 'mesa' || estado.tabla === 'local') columnas.push({ id: 'barrio', titulo: 'Barrio', texto: true });
    if (estado.tabla !== 'mesa') columnas.push({ id: 'mesas', titulo: 'Mesas' });
    columnas.push({ id: 'electores', titulo: 'Electores' }, { id: 'emitidos', titulo: 'Emitidos' }, { id: 'participacion', titulo: 'Particip.' });
    listas.forEach((item, j) => columnas.push({ id: `lista-${j}`, titulo: item.sigla, lista: j }));
    columnas.push({ id: 'ventaja', titulo: 'Ventaja' });
    const filtro = normalizarTexto(estado.filtro.trim());
    let filas = unidades(datos, estado.tabla, estado.cargo, enZona)
        .filter((u) => !filtro || normalizarTexto(`${u.nombre} ${u.barrio ?? ''}`).includes(filtro));
    const valor = (u, col) => {
        if (col.lista !== undefined) return u.total.votos[col.lista];
        if (col.id === 'nombre') return u.nombre;
        if (col.id === 'zona') return u.zona;
        if (col.id === 'barrio') return u.barrio ?? '';
        if (col.id === 'mesas') return u.total.mesas;
        if (col.id === 'electores') return u.total.electores;
        if (col.id === 'emitidos') return u.total.emitidos;
        if (col.id === 'participacion') return participacion(u.total) ?? -Infinity;
        if (col.id === 'ventaja') return ventajaDe(u.total)?.puntos ?? -Infinity;
        return 0;
    };
    const col = estado.orden && columnas.find((x) => x.id === estado.orden.id);
    if (col) {
        filas = filas.sort((a, b) => {
            const va = valor(a, col), vb = valor(b, col);
            return estado.orden.dir * (typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb);
        });
    }
    const tr = el('tr');
    for (const c of columnas) {
        const th = el('th', c.texto ? 'tabla__texto' : null);
        th.scope = 'col';
        const boton = el('button', 'tabla__orden', c.titulo);
        boton.type = 'button';
        boton.dataset.columna = c.id;
        if (estado.orden?.id === c.id) th.setAttribute('aria-sort', estado.orden.dir > 0 ? 'ascending' : 'descending');
        th.append(boton);
        tr.append(th);
    }
    $('tabla').tHead.replaceChildren(tr);
    const fragmento = document.createDocumentFragment();
    for (const u of filas) {
        const fila = el('tr');
        if (esElegida(u)) fila.classList.add('es-seleccion');
        for (const c of columnas) {
            const v = valor(u, c);
            if (c.id === 'nombre') {
                // El nombre elige la unidad: el mapa la encuadra y el panel muestra sus cifras.
                const th = el('th', 'tabla__texto');
                th.scope = 'row';
                const boton = el('button', 'tabla__elegir');
                boton.type = 'button';
                boton.dataset.tipo = estado.tabla;
                boton.dataset.clave = u.clave;
                boton.append(el('span', 'tabla__nombre', v));
                th.append(boton);
                const diferencia = marcaDeFuente(u);
                if (diferencia) {
                    th.append(el('span', 'tabla__marca', diferencia));
                    fila.dataset.diferencia = 'true';
                }
                fila.append(th);
                continue;
            }
            let texto = v;
            if (c.lista !== undefined) texto = `${fmt.format(v)} (${porcentaje(v, u.total.listas)} %)`;
            else if (c.id === 'ventaja') {
                const w = ventajaDe(u.total);
                texto = !w ? '—' : w.empate ? 'empate' : `${pct.format(w.puntos)} ${listas[w.primero].sigla}`;
            }
            else if (c.id === 'participacion') texto = v === -Infinity ? '—' : `${pct.format(v)} %`;
            else if (typeof v === 'number') texto = fmt.format(v);
            fila.append(el('td', c.texto ? 'tabla__texto' : null, texto));
        }
        fragmento.append(fila);
    }
    // Mesas sin acta en esta fuente que la otra sí tiene: al final, sin cifras.
    const soloAlla = estado.tabla === 'mesa' ? mesasSoloEnLaOtra(filtro) : [];
    for (const x of soloAlla) {
        const fila = el('tr', 'tabla__ausente');
        fila.dataset.diferencia = 'true';
        const th = el('th', 'tabla__texto');
        th.scope = 'row';
        th.append(el('span', 'tabla__nombre', `${x.info?.nombre ?? `Local ${x.local}`} · mesa ${x.mesa}`),
            el('span', 'tabla__marca', `Sin acta aquí: solo en ${EN_LA_FUENTE[otraFuente]}`));
        fila.append(th);
        for (const c of columnas.slice(1)) {
            fila.append(el('td', c.texto ? 'tabla__texto' : null, c.id === 'zona' ? String(x.zona) : c.id === 'barrio' ? x.info?.barrio ?? '' : '—'));
        }
        fragmento.append(fila);
    }
    $('tabla').tBodies[0].replaceChildren(fragmento);
    $('tabla').dataset.filas = String(filas.length);
    const marcadas = $('tabla').querySelectorAll('tbody tr[data-diferencia]').length;
    $('notaTabla').textContent = `${cantidad(filas.length, 'fila', 'filas')}${hayZona() ? ` de la ${nombreZona()}` : ''}` +
        (marcadas ? ` · ${cantidad(marcadas, 'marcada', 'marcadas')}: mesas con acta en una sola fuente` : '') + ' · % sobre votos a listas · ' +
        'participación = emitidos / electores · ventaja: puntos del primero sobre el segundo y la sigla del primero · tocá un nombre para verlo en el mapa';
}

// Mesas con acta en esta fuente y sin acta en la otra (o al revés), según la comparación de las dos fuentes.
function marcaDeFuente(u) {
    const comp = datos.comparacion;
    if (!comp) return null;
    if (estado.tabla === 'mesa') return comp.soloAqui.has(u.clave) ? `No está en ${EN_LA_FUENTE[otraFuente]}` : null;
    if (estado.tabla !== 'local') return null;
    const aqui = [...comp.soloAqui].filter((k) => k.startsWith(`${u.local}-`)).length;
    const alla = comp.soloAlla.filter((x) => x.clave === u.local).length;
    return [aqui ? `${cantidad(aqui, 'mesa', 'mesas')} sin acta en ${EN_LA_FUENTE[otraFuente]}` : null,
            alla ? `${cantidad(alla, 'mesa', 'mesas')} solo en ${EN_LA_FUENTE[otraFuente]}` : null].filter(Boolean).join(' · ') || null;
}

function mesasSoloEnLaOtra(filtro) {
    return (datos.comparacion?.soloAlla ?? []).filter((x) => (!x.info || !fueraDeZona(x.info)) &&
        (!filtro || normalizarTexto(`${x.info?.nombre ?? ''} ${x.info?.barrio ?? ''}`).includes(filtro)));
}

// Ranking según la capa: el porcentaje de la lista elegida, la participación, la ventaja del primero o el IPM del barrio;
// con las demás capas, el porcentaje de la lista más votada en Asunción.
function metricaRanking() {
    const listas = datos.listas[estado.cargo];
    const porLista = (j, tituloMetrica) => ({ titulo: tituloMetrica, valor: (u) => (u.total.listas ? (100 * u.total.votos[j]) / u.total.listas : null),
                                              texto: (v) => `${pct.format(v)} %`, color: () => listas[j].color });
    if (estado.capa === 'listas') return porLista(listaElegida(), `% de ${listas[listaElegida()].sigla}`);
    if (estado.capa === 'participacion') return { titulo: 'Participación', valor: (u) => participacion(u.total), texto: (v) => `${pct.format(v)} %`, color: () => PARTICIPACION_COLOR };
    if (estado.capa === 'margen') {
        return { titulo: 'Margen entre el primero y el segundo', valor: (u) => ventajaDe(u.total)?.puntos ?? null,
                 texto: (v, u) => `${pct.format(v)} puntos · ${listas[ventajaDe(u.total).primero].sigla}`,
                 color: (v, u) => listas[ventajaDe(u.total).primero].color };
    }
    if (estado.capa === 'ipm') {
        const ind = datos.ipm.indicadores.find((x) => x.id === estado.ipm);
        const formato = estado.ipm === 'A' ? pct : pct2;
        return { titulo: ind.nombre, valor: (u) => datos.ipmPor.get(datos.barrioPor.get(u.barrioClave)?.clave)?.[estado.ipm] ?? null,
                 texto: (v) => `${formato.format(v)} %`, color: () => IPM_COLOR, soloBarrios: true };
    }
    const j = ganador(datos.totalAsuncion[estado.cargo].votos) ?? 0;
    return porLista(j, `% de ${listas[j].sigla} (la más votada en Asunción)`);
}

function renderRanking() {
    const m = metricaRanking();
    const tipo = m.soloBarrios ? 'barrio' : estado.ranking;
    for (const boton of document.querySelectorAll('[data-ranking]')) {
        boton.setAttribute('aria-pressed', String(boton.dataset.ranking === tipo));
        boton.disabled = Boolean(m.soloBarrios) && boton.dataset.ranking === 'local';
    }
    for (const boton of document.querySelectorAll('[data-orden-ranking]')) boton.setAttribute('aria-pressed', String(boton.dataset.ordenRanking === estado.ordenRanking));
    const dir = estado.ordenRanking === 'asc' ? 1 : -1;
    const filas = unidades(datos, tipo, estado.cargo, enZona).map((u) => ({ u, v: m.valor(u) }))
        .filter((x) => x.v !== null && Number.isFinite(x.v))
        .sort((a, b) => dir * (a.v - b.v) || a.u.nombre.localeCompare(b.u.nombre, 'es'));
    const maximo = Math.max(1e-9, ...filas.map((x) => Math.abs(x.v)));
    $('tituloRanking').textContent = `${m.titulo} · ${tipo === 'local' ? 'locales' : 'barrios'}${hayZona() ? ` de la ${nombreZona()}` : ' de Asunción'}`;
    const elegido = tipo === 'local' ? estado.local : estado.local ? null : estado.barrio;
    $('ranking').replaceChildren(...filas.map(({ u, v }, k) => {
        const li = el('li');
        const boton = el('button', 'ranking-lista__boton');
        boton.type = 'button';
        boton.dataset.tipo = tipo;
        boton.dataset.clave = u.clave;
        if (u.clave === elegido) boton.setAttribute('aria-current', 'true');
        const barra = el('span', 'ranking-lista__barra');
        const relleno = el('span', 'ranking-lista__relleno');
        relleno.style.width = `${(100 * Math.abs(v)) / maximo}%`;
        relleno.style.background = m.color(v, u);
        barra.append(relleno);
        boton.append(el('span', 'ranking-lista__pos', `${k + 1}.`), el('span', 'ranking-lista__nombre', u.nombre), barra, el('span', 'ranking-lista__valor', m.texto(v, u)));
        li.append(boton);
        return li;
    }));
    $('notaRanking').textContent = m.soloBarrios
        ? 'El IPM es un indicador por barrio (INE, Censo 2022): el ranking muestra los barrios con locales de votación. Tocá uno para verlo en el mapa.'
        : `Ordenado según la capa del mapa. ${cantidad(filas.length, tipo === 'local' ? 'local' : 'barrio', tipo === 'local' ? 'locales' : 'barrios')}. ` +
          'Tocá uno para verlo en el mapa.';
}

// Lleva la fila elegida a la vista dentro de su caja, sin mover la página.
function mostrarElegida(caja, nodo) {
    if (!caja || !nodo) return;
    const c = caja.getBoundingClientRect(), n = nodo.getBoundingClientRect();
    const cabecera = caja.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    if (n.top >= c.top + cabecera && n.bottom <= c.bottom) return;
    caja.scrollTop += n.top - c.top - cabecera - (c.height - cabecera - n.height) / 2;
}

function renderBandeja() {
    const visible = bandeja.visible();
    const cambio = claveSeleccion() !== seleccionMostrada;
    if (visible === 'tabla') {
        renderTabla();
        if (cambio) mostrarElegida($('desplazaTabla'), $('tabla').querySelector('tbody tr.es-seleccion'));
    } else if (visible === 'ranking') {
        renderRanking();
        if (cambio) mostrarElegida($('ranking'), $('ranking').querySelector('[aria-current="true"]'));
    }
    if (visible) seleccionMostrada = claveSeleccion();
}

// Pestañas que dependen del cargo y de la selección: D'Hondt solo con la Junta (atenuada con Intendencia) y «Limpiar
// filtros» con algo elegido.
function renderPestanas() {
    const junta = estado.cargo === '2';
    const dhondt = $('pestana-dhondt');
    dhondt.classList.toggle('es-atenuada', !junta);
    if (junta) {
        dhondt.removeAttribute('aria-describedby');
        dhondt.removeAttribute('title');
        $('avisoDhondt').hidden = true;
    } else {
        dhondt.setAttribute('aria-describedby', 'avisoDhondt');
        dhondt.title = $('avisoDhondt').textContent;
    }
    $('dhondtNoDisponible').hidden = junta;
    $('limpiarFiltros').disabled = !haySeleccion();
}

// --- Render y elecciones ----------------------------------------------------------------------------------------

function renderTodo() {
    agregados = agregadosBarrio(datos, estado.cargo);
    renderTotales(datos, estado.cargo, seleccion(), { hayFiltro: haySeleccion() });
    renderBancas(datos, estado.cargo, { fuente, nombreFuente: datos.contexto.anio.fuentes?.[fuente]?.nombre });
    renderFiltros();
    renderCapas();
    renderMapa();
    renderPestanas();
    renderBandeja();
    actualizarEnlaceInforme();
}

function actualizarTodo() {
    renderTodo();
    actualizarEnlace();
}

// nivel: hasta dónde se conserva la ruta (asuncion, zona, barrio o local); lo más profundo se quita.
function subirA(nivel) {
    const orden = ['asuncion', 'zona', 'barrio', 'local', 'mesa'];
    const k = orden.indexOf(nivel);
    if (k < 1) estado.zona = estado.zonaMunicipal = null;
    if (k < 2) estado.barrio = null;
    if (k < 3) estado.local = null;
    estado.mesa = null;
    actualizarTodo();
}

function elegirZona(valor) {
    estado.zona = valor.startsWith('t') ? Number(valor.slice(1)) : null;
    estado.zonaMunicipal = valor.startsWith('m') ? Number(valor.slice(1)) : null;
    estado.barrio = estado.local = estado.mesa = null;
    actualizarTodo();
}

// Un barrio o un local fuera de la zona elegida quitan el filtro de zona (el mapa vuelve a todo el distrito).
function elegirBarrio(nombre, { enfocar = false } = {}) {
    if (!nombre) return subirA('zona');
    if ([...datos.infoLocal.values()].filter((x) => x.barrio === nombre).every(fueraDeZona)) estado.zona = estado.zonaMunicipal = null;
    estado.barrio = nombre;
    estado.local = estado.mesa = null;
    actualizarTodo();
    if (enfocar) enfocarBarrio(nombre);
}

function elegirLocal(clave, { enfocar = false, mesa = null } = {}) {
    if (!clave) return subirA('barrio');
    const info = infoDe(clave);
    if (fueraDeZona(info)) estado.zona = estado.zonaMunicipal = null;
    estado.barrio = info.barrio ?? null;
    estado.local = clave;
    estado.mesa = mesa;
    actualizarTodo();
    if (enfocar) enfocarLocal(clave);
}

// Lo tocado en el mapa muestra sus resultados: en celular la hoja sube a media altura y en tablet vertical se abre el
// cajón; el local queda a la vista.
function mostrarResultados() {
    if (panel.celular()) panel.elegir('resultados', { altura: 'medio' });
    else if (panel.cajon()) {
        panel.elegir('resultados');
        panel.abrir(true);
    }
    estado.panel = panel.panel();
}

function tocarLocal(clave) {
    elegirLocal(clave);
    if (panel.ancho()) return;
    mostrarResultados();
    actualizarEnlace();
    // Si la hoja o el cajón tapan el local, el mapa lo trae a la parte que se ve.
    const punto = mapa.proyectar(clave);
    const hoja = $('hoja').getBoundingClientRect();
    if (punto && (panel.celular() ? punto[1] > hoja.top - 24 : punto[0] < hoja.right + 24)) enfocarLocal(clave);
}

function tocarBarrio(nombre) {
    elegirBarrio(nombre);
    if (panel.ancho()) return;
    mostrarResultados();
    actualizarEnlace();
}

// Elegido en la tabla o el ranking: el mapa lo encuadra por encima de la bandeja.
function elegirUnidad(tipo, clave) {
    if (tipo === 'mesa') {
        const [zona, local, mesa] = clave.split('-');
        elegirLocal(`${zona}-${local}`, { enfocar: true, mesa: Number(mesa) });
    } else if (tipo === 'local') {
        elegirLocal(clave, { enfocar: true });
    } else if (tipo === 'barrio') {
        elegirBarrio(clave === 'Sin barrio' ? null : clave, { enfocar: true });
    } else {
        elegirZona(`${tipo === 'zona' ? 't' : 'm'}${clave}`);
    }
}

// --- Búsqueda de local (combobox con lista de sugerencias) -------------------------------------------------------

let sugerencias = [];
let activa = -1;

function cerrarSugerencias() {
    sugerencias = [];
    activa = -1;
    $('sugerenciasLocal').hidden = true;
    $('sugerenciasLocal').replaceChildren();
    $('buscarLocal').setAttribute('aria-expanded', 'false');
    $('buscarLocal').removeAttribute('aria-activedescendant');
}

function buscar() {
    const texto = normalizarTexto($('buscarLocal').value.trim());
    if (texto.length < 2) {
        cerrarSugerencias();
        $('estadoBusqueda').textContent = '';
        return;
    }
    sugerencias = [...datos.infoLocal.entries()]
        .filter(([, x]) => normalizarTexto(`${x.nombre} ${x.direccion ?? ''} ${x.barrio ?? ''}`).includes(texto))
        .sort(([, a], [, b]) => a.nombre.localeCompare(b.nombre, 'es')).slice(0, 8);
    activa = -1;
    const lista = $('sugerenciasLocal');
    lista.replaceChildren(...sugerencias.map(([clave, x], k) => {
        const li = el('li', 'sugerencias__item');
        li.id = `sugerencia-${k}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.clave = clave;
        li.append(el('span', 'sugerencias__nombre', x.nombre), el('span', 'sugerencias__detalle', [x.barrio, `zona ${x.zona_nombre}`].filter(Boolean).join(' · ')));
        return li;
    }));
    lista.hidden = !sugerencias.length;
    $('buscarLocal').setAttribute('aria-expanded', String(!lista.hidden));
    $('buscarLocal').removeAttribute('aria-activedescendant');
    $('estadoBusqueda').textContent = sugerencias.length ? cantidad(sugerencias.length, 'local encontrado', 'locales encontrados') : 'Ningún local coincide';
}

function marcarActiva(k) {
    activa = k;
    for (const [n, li] of [...$('sugerenciasLocal').children].entries()) {
        li.setAttribute('aria-selected', String(n === k));
        if (n === k) li.scrollIntoView({ block: 'nearest' });
    }
    if (k >= 0) $('buscarLocal').setAttribute('aria-activedescendant', `sugerencia-${k}`);
    else $('buscarLocal').removeAttribute('aria-activedescendant');
}

// El local elegido en la búsqueda muestra sus resultados (en tablet vertical, el cajón se cierra para ver el mapa).
function elegirSugerencia(clave) {
    $('buscarLocal').value = '';
    cerrarSugerencias();
    $('estadoBusqueda').textContent = `Elegido: ${infoDe(clave).nombre}`;
    elegirLocal(clave, { enfocar: false });
    panel.elegir('resultados', { altura: panel.celular() ? 'medio' : null });
    if (panel.cajon()) panel.abrir(false);
    estado.panel = panel.panel();
    actualizarEnlace();
    enfocarLocal(clave);
}

// --- Panel: pestañas, cajón (tablet vertical) y búsqueda desde el mapa -------------------------------------------

// D'Hondt con Intendencia: tocarla cambia el cargo a la Junta y la muestra.
function elegirPestana(nombre, { toque = false, foco = false } = {}) {
    if (nombre === 'dhondt' && estado.cargo !== '2' && toque) {
        compartido.cambiar({ cargo: 'junta' }, { origen: 'barra', forzar: true });
    }
    panel.elegir(nombre, { foco });
    estado.panel = panel.panel();
    actualizarEnlace();
}

// Lupa del mapa: la búsqueda de locales está en la pestaña Filtros (en el cajón o en la hoja si hace falta).
function abrirBusqueda() {
    panel.elegir('filtros', { altura: panel.celular() ? 'completo' : null });
    if (panel.cajon()) panel.abrir(true);
    estado.panel = panel.panel();
    actualizarEnlace();
    $('buscarLocal').focus();
}

function mostrarAvisoDhondt(visible) {
    const aviso = $('avisoDhondt');
    const pestana = $('pestana-dhondt');
    aviso.hidden = !visible || estado.cargo === '2';
    if (aviso.hidden) return;
    const caja = pestana.getBoundingClientRect(), raiz = $('hoja').getBoundingClientRect();
    aviso.style.left = `${Math.max(8, Math.min(caja.left - raiz.left, raiz.width - aviso.offsetWidth - 8))}px`;
    aviso.style.top = `${caja.bottom - raiz.top + 4}px`;
}

// --- Enlace compartible: #eleccion=…&anio=…&cargo=…&capa=…&local=… -----------------------------------------------

function parametrosEnlace() {
    const p = new URLSearchParams({ eleccion: datos.contexto.eleccion.id, anio: String(datos.contexto.anio.anio),
                                    cargo: CARGO_HASH[estado.cargo], capa: estado.capa });
    if (estado.capa === 'listas') {
        p.set('lista', datos.listas[estado.cargo][listaElegida()].num);
        if (estado.medida !== 'pct') p.set('medida', estado.medida);
    }
    if (estado.capa === 'ipm' && estado.ipm !== 'H') p.set('ipm', estado.ipm);
    if (estado.opacidad !== OPACIDAD_POR_OMISION) p.set('opacidad', String(estado.opacidad));
    if (estado.base !== 'calles') p.set('base', estado.base);
    const ver = ELEMENTOS.filter((k) => estado.ver[k]).join(',');
    if (ver !== VER_POR_OMISION) p.set('ver', ver || 'ninguno');
    if (estado.zonaMunicipal !== null) p.set('zona_municipal', String(estado.zonaMunicipal));
    else if (estado.zona !== null) p.set('zona', String(estado.zona));
    if (estado.local) p.set('local', estado.local);
    else if (estado.barrio) p.set('barrio', estado.barrio);
    if (estado.mesa !== null) p.set('mesa', String(estado.mesa));
    if (estado.tabla !== 'local') p.set('tabla', estado.tabla);
    if (estado.panel !== 'resultados') p.set('panel', estado.panel);
    if (estado.bandeja) p.set('bandeja', estado.bandeja);
    return p;
}

// «Vista informe»: la misma elección, cargo, zona y local o barrio, en la pestaña que corresponde a la capa.
function actualizarEnlaceInforme() {
    const p = new URLSearchParams({ eleccion: datos.contexto.eleccion.id, anio: String(datos.contexto.anio.anio), cargo: CARGO_HASH[estado.cargo], modo: 'informe' });
    if (estado.capa === 'zona') p.set('capa', 'zona');
    else p.set('vista', CAPA_A_VISTA[estado.capa]);
    if (estado.zonaMunicipal !== null) p.set('zona_municipal', String(estado.zonaMunicipal));
    else if (estado.zona !== null) p.set('zona', String(estado.zona));
    if (estado.local) p.set('local', estado.local);
    else if (estado.barrio) p.set('barrio', estado.barrio);
    $('enlaceInforme').href = `#${p}`;
}

// El estado compartido (shell.js) escribe el hash con history.replaceState: sin entradas nuevas en el historial.
function actualizarEnlace() {
    actualizarEnlaceInforme();
    if (enlaceListo) compartido.reemplazar(Object.fromEntries(parametrosEnlace()), 'visor');
}

// Aplica el hash al estado; los valores que no existen en los datos se ignoran y quedan los de omisión. Acepta los
// enlaces de la vista informe (vista=…) y los valores viejos del cargo (1 y 2).
function leerEnlace() {
    const p = new URLSearchParams(location.hash.slice(1));
    const de = (objeto, clave) => (clave !== null && /^\d+$/.test(clave) && Object.hasOwn(objeto, clave) ? Number(clave) : null);
    const cargo = p.get('cargo');
    estado.cargo = cargo === 'junta' || cargo === '2' ? '2' : '1';
    const capa = p.get('capa') ?? VISTA_A_CAPA[p.get('vista')];
    estado.capa = CAPAS.includes(capa) ? capa : 'lista';
    estado.zonaMunicipal = de(datos.resumen.zonas_municipales, p.get('zona_municipal'));
    estado.zona = estado.zonaMunicipal === null ? de(datos.resumen.zonas, p.get('zona')) : null;
    const local = p.get('local'), barrio = p.get('barrio'), mesa = p.get('mesa');
    estado.local = local && datos.infoLocal.has(local) ? local : null;
    estado.barrio = estado.local ? infoDe(estado.local).barrio ?? null : barrio && datos.filas.some((f) => f.barrio === barrio) ? barrio : null;
    estado.mesa = estado.local && /^\d+$/.test(mesa ?? '') && datos.porLocal.get(estado.local).some((f) => f.mesa === Number(mesa)) ? Number(mesa) : null;
    if (estado.local ? fueraDeZona(infoDe(estado.local))
        : estado.barrio && [...datos.infoLocal.values()].filter((x) => x.barrio === estado.barrio).every(fueraDeZona)) {
        estado.zona = estado.zonaMunicipal = null;
    }
    const lista = datos.listas[estado.cargo].findIndex((x) => x.num === p.get('lista'));
    if (lista >= 0) estado.lista[estado.cargo] = lista;
    estado.medida = p.get('medida') === 'votos' ? 'votos' : 'pct';
    estado.ipm = IPM.includes(p.get('ipm')) ? p.get('ipm') : 'H';
    const opacidadPedida = Number(p.get('opacidad'));
    estado.opacidad = p.has('opacidad') && Number.isInteger(opacidadPedida) && opacidadPedida >= 0 && opacidadPedida <= 100 ? opacidadPedida : OPACIDAD_POR_OMISION;
    estado.base = BASES.includes(p.get('base')) ? p.get('base') : 'calles';
    // «ninguno» apaga todos los elementos; un valor sin elementos conocidos vuelve a los de por omisión.
    const pedidos = (p.get('ver') ?? '').split(',').filter((k) => ELEMENTOS.includes(k));
    const ver = pedidos.length || p.get('ver') === 'ninguno' ? pedidos : VER_POR_OMISION.split(',');
    estado.ver = Object.fromEntries(ELEMENTOS.map((k) => [k, ver.includes(k)]));
    estado.tabla = UNIDADES.includes(p.get('tabla')) ? p.get('tabla') : 'local';
    // panel: la pestaña del panel; bandeja: Tabla o Ranking abiertos. Los enlaces de antes (panel=tabla o ranking) abren
    // la bandeja.
    const pedido = p.get('panel');
    estado.panel = PANELES.includes(pedido) ? pedido : 'resultados';
    estado.bandeja = BANDEJAS.includes(p.get('bandeja')) ? p.get('bandeja') : BANDEJAS.includes(pedido) ? pedido : null;
    estado.orden = null;
}

// --- Eventos ----------------------------------------------------------------------------------------------------

function eventos() {
    compartido.suscribir(({ cambiadas, origen }) => {
        if (origen !== 'barra' || !cambiadas.has('cargo')) return;
        estado.cargo = compartido.obtener('cargo') === 'junta' ? '2' : '1';
        estado.orden = null;
        actualizarTodo();
    });
    $('nivelZona').addEventListener('change', (evento) => elegirZona(evento.target.value));
    $('nivelBarrio').addEventListener('change', (evento) => elegirBarrio(evento.target.value, { enfocar: true }));
    $('nivelLocal').addEventListener('change', (evento) => elegirLocal(evento.target.value, { enfocar: true }));
    $('nivelMesa').addEventListener('change', (evento) => {
        estado.mesa = evento.target.value === '' ? null : Number(evento.target.value);
        actualizarTodo();
    });
    $('rutaGeo').addEventListener('click', (evento) => {
        const paso = evento.target.closest('[data-nivel]');
        if (paso) subirA(paso.dataset.nivel);
    });
    $('limpiarSeleccion').addEventListener('click', () => subirA('asuncion'));
    $('limpiarFiltros').addEventListener('click', () => subirA('asuncion'));
    $('verJunta').addEventListener('click', () => compartido.cambiar({ cargo: 'junta' }, { origen: 'barra', forzar: true }));
    $('botonBuscar').addEventListener('click', abrirBusqueda);
    $('botonTabla').addEventListener('click', () => bandeja.abrir(!bandeja.abierta(), { foco: true }));
    $('botonPanel').addEventListener('click', () => panel.abrir(!panel.abierto(), { foco: true }));
    $('cerrarPanel').addEventListener('click', () => panel.abrir(false, { foco: true }));
    const dhondt = $('pestana-dhondt');
    dhondt.addEventListener('pointerenter', () => mostrarAvisoDhondt(true));
    dhondt.addEventListener('pointerleave', () => mostrarAvisoDhondt(false));
    dhondt.addEventListener('focus', () => mostrarAvisoDhondt(true));
    dhondt.addEventListener('blur', () => mostrarAvisoDhondt(false));
    $('capas').addEventListener('change', (evento) => {
        if (evento.target.name !== 'capa') return;
        estado.capa = evento.target.value;
        actualizarTodo();
    });
    $('capaLista').addEventListener('change', (evento) => {
        estado.lista[estado.cargo] = Number(evento.target.value);
        actualizarTodo();
    });
    for (const boton of document.querySelectorAll('[data-medida]')) {
        boton.addEventListener('click', () => { estado.medida = boton.dataset.medida; actualizarTodo(); });
    }
    for (const boton of document.querySelectorAll('[data-ipm]')) {
        boton.addEventListener('click', () => { estado.ipm = boton.dataset.ipm; actualizarTodo(); });
    }
    for (const boton of document.querySelectorAll('[data-base]')) {
        boton.addEventListener('click', () => { estado.base = boton.dataset.base; renderCapas(); renderMapa(); actualizarEnlace(); });
    }
    // Opacidad: el mapa y la leyenda siguen el deslizador; el hash se escribe al soltarlo.
    $('opacidadCapa').addEventListener('input', (evento) => {
        estado.opacidad = Number(evento.target.value);
        $('valorOpacidad').textContent = `${fmt.format(estado.opacidad)} %`;
        renderMapa();
    });
    $('opacidadCapa').addEventListener('change', () => actualizarEnlace());
    $('elementosMapa').addEventListener('change', (evento) => {
        if (evento.target.name !== 'ver') return;
        estado.ver[evento.target.value] = evento.target.checked;
        renderMapa();
        actualizarEnlace();
    });
    $('unidadTabla').addEventListener('change', (evento) => {
        estado.tabla = evento.target.value;
        estado.orden = null;
        renderBandeja();
        actualizarEnlace();
    });
    $('filtroTabla').addEventListener('input', (evento) => { estado.filtro = evento.target.value; renderTabla(); });
    $('tabla').addEventListener('click', (evento) => {
        const elegir = evento.target.closest('.tabla__elegir');
        if (elegir) {
            elegirUnidad(elegir.dataset.tipo, elegir.dataset.clave);
            return;
        }
        const columna = evento.target.closest('[data-columna]')?.dataset.columna;
        if (!columna) return;
        estado.orden = estado.orden?.id === columna ? { id: columna, dir: -estado.orden.dir } : { id: columna, dir: columna === 'nombre' ? 1 : -1 };
        renderTabla();
    });
    for (const boton of document.querySelectorAll('[data-ranking]')) {
        boton.addEventListener('click', () => { estado.ranking = boton.dataset.ranking; renderBandeja(); });
    }
    for (const boton of document.querySelectorAll('[data-orden-ranking]')) {
        boton.addEventListener('click', () => { estado.ordenRanking = boton.dataset.ordenRanking; renderRanking(); });
    }
    $('ranking').addEventListener('click', (evento) => {
        const boton = evento.target.closest('.ranking-lista__boton');
        if (boton) elegirUnidad(boton.dataset.tipo, boton.dataset.clave);
    });
    // Búsqueda: flechas para recorrer las sugerencias, Enter para elegir, Escape para cerrarlas.
    const buscador = $('buscarLocal');
    buscador.addEventListener('input', buscar);
    buscador.addEventListener('keydown', (evento) => {
        if (evento.key === 'ArrowDown' && sugerencias.length) {
            evento.preventDefault();
            marcarActiva(Math.min(activa + 1, sugerencias.length - 1));
        } else if (evento.key === 'ArrowUp' && sugerencias.length) {
            evento.preventDefault();
            marcarActiva(Math.max(activa - 1, 0));
        } else if (evento.key === 'Enter' && sugerencias.length) {
            evento.preventDefault();
            elegirSugerencia(sugerencias[activa >= 0 ? activa : 0][0]);
        } else if (evento.key === 'Escape' && !$('sugerenciasLocal').hidden) {
            evento.preventDefault();
            evento.stopPropagation();
            cerrarSugerencias();
        }
    });
    // mousedown: el clic en una sugerencia no le quita el foco al buscador antes de elegirla.
    $('sugerenciasLocal').addEventListener('mousedown', (evento) => evento.preventDefault());
    $('sugerenciasLocal').addEventListener('click', (evento) => {
        const item = evento.target.closest('[data-clave]');
        if (item) elegirSugerencia(item.dataset.clave);
    });
    buscador.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== buscador) cerrarSugerencias(); }, 0));
    // Fuente, Método y Estadísticas generales: diálogos modales (dialogo.js); el foco vuelve al botón que los abrió.
    for (const [id, nombre] of [['abrirFuente', 'fuente'], ['abrirMetodo', 'metodo'], ['abrirEstadisticas', 'estadisticas'], ['verEstadisticas', 'estadisticas']]) {
        $(id).setAttribute('aria-controls', dialogos[nombre].elemento.id);
        $(id).addEventListener('click', (evento) => dialogos[nombre].abrir(evento.currentTarget));
    }
    // Un enlace pegado en la misma pestaña (o el hash editado a mano) cambia la vista sin recargar.
    window.addEventListener('hashchange', () => {
        leerEnlace();
        aplicarPaneles();
        renderTodo();
    });
    // Cambio de tema: mapa_gl.js cambia el estilo del mapa base y avisa (alCambiarEstilo) para volver a pintar las capas.
}

function renderFijos() {
    const r = datos.resumen;
    const { eleccion, anio } = datos.contexto;
    $('tituloTablero').textContent = `${anio.fuentes?.[fuente]?.nombre ?? r.eleccion.etapa} · ${eleccion.nombre} ${anio.anio} · ${anio.ambito ?? ''}`;
    if (r.eleccion.aviso) $('avisoLegal').append(` ${r.eleccion.aviso}`);
    for (const [codigo, nombre] of Object.entries(r.zonas_municipales)) $('opcionesMunicipales').append(new Option(`${codigo} · ${nombre}`, `m${codigo}`));
    for (const [codigo, nombre] of Object.entries(r.zonas)) $('opcionesTsje').append(new Option(`${codigo} · ${nombre}`, `t${codigo}`));
    // La vista informe existe solo en las páginas que tienen su plantilla (TREP).
    $('enlaceInforme').hidden = !document.getElementById('plantillaInforme');
}

// La leyenda empieza abierta solo si el mapa tiene alto de sobra (en celular y en pantallas bajas, plegada).
function abrirLeyendaSiCabe() {
    $('leyendaMapa').open = !panel.celular() && $('mapa').getBoundingClientRect().height >= 320;
}

// Pestaña del panel y bandeja según el estado (al abrir un enlace).
function aplicarPaneles({ altura = null } = {}) {
    panel.elegir(estado.panel, { altura });
    if (estado.bandeja) bandeja.elegir(estado.bandeja);
    bandeja.abrir(Boolean(estado.bandeja));
}

// La llama inicio.js con la fuente de la sección (trep u oficial).
export async function iniciar({ fuente: deLaSeccion = 'trep' } = {}) {
    const visor = $('visor');
    fuente = deLaSeccion;
    otraFuente = fuente === 'trep' ? 'oficial' : 'trep';
    try {
        const params = new URLSearchParams(location.hash.slice(1));
        const pedido = { eleccion: params.get('eleccion'), anio: params.get('anio') };
        const { eleccion, datos: modelo } = await cargarModelo(pedido, fuente);
        if (!modelo) throw new Error(`La fuente ${fuente} no está publicada (${eleccion.estado}).`);
        datos = modelo;
        // Con la otra fuente publicada, sus mesas sin acta (resumen.json, liviano) permiten marcar las diferencias.
        if (eleccion.anio.fuentes?.[otraFuente]?.estado === 'publicado') {
            const otra = await cargarEleccion(pedido, otraFuente, { fuente: ['resumen.json'] });
            datos.comparacion = compararFuentes(datos, otra.datos['resumen.json']);
        }
        const todas = datos.filas.map((f) => f.i);
        datos.totalAsuncion = { 1: datos.sumar(todas, '1'), 2: datos.sumar(todas, '2') };
        renderFijos();
        dialogos = crearDialogos({ datos, fuente, cargo: () => estado.cargo, seleccion, ruta: () => pasosRuta().map((x) => x.texto), sinActa });
        crearMapa();
        panel = crearPanel({ alElegir: elegirPestana, atenuada: (nombre) => nombre === 'dhondt' && estado.cargo !== '2' });
        bandeja = crearBandeja({
            alElegir: (nombre) => { estado.bandeja = nombre; renderBandeja(); actualizarEnlace(); },
            alCambiar: (abierta) => { estado.bandeja = abierta ? bandeja.panel() : null; renderBandeja(); actualizarEnlace(); },
        });
        eventos();
        leerEnlace();
        // Celular: la hoja asoma con la selección; con un local elegido o con otra pestaña, a media altura.
        aplicarPaneles({ altura: estado.panel !== 'resultados' || haySeleccion() ? 'medio' : 'peek' });
        renderTodo();
        enlaceListo = true;
        await shellListo;  // La barra de contexto (cargos y estado de la fuente) también está lista.
        // El mapa (MapLibre y el mapa base) termina de cargar aparte: si el navegador no puede mostrarlo, el resto sigue.
        const hayMapa = await mapa.listo.then(() => true, (error) => {
            const aviso = el('p', 'mapa__sin-mapa', 'No se pudo mostrar el mapa en este navegador (necesita WebGL). Los resultados, la tabla y el ranking siguen disponibles.');
            $('mapa').append(aviso);
            console.warn(error);
            return false;
        });
        // Con el mapa listo, la capa se vuelve a dibujar: las cuentas de la leyenda salen de los barrios del mapa, que en la
        // primera pasada todavía no habían llegado.
        if (hayMapa) renderMapa();
        abrirLeyendaSiCabe();
        vigilarDesplazables();
        visor.dataset.listo = 'true';
    } catch (error) {
        const aviso = $('errorCarga');
        aviso.hidden = false;
        aviso.textContent = 'No fue posible leer los datos del tablero. Revisá la conexión o el servidor local.';
        console.error(error);
    } finally {
        visor.setAttribute('aria-busy', 'false');
    }
}
