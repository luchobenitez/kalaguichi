// Tablero de resultados en una pantalla (ADR-017 del proyecto): indicadores de la selección, filtros (ruta geográfica
// Asunción › zona › barrio › local › mesa, búsqueda de local y capa del mapa), un solo mapa con capas, el panel de
// resultados de la selección y la bandeja con la tabla y el ranking. Elegir en el mapa, en la tabla, en el ranking o
// en los filtros cambia la misma selección; cambiar de capa conserva el zoom y la selección. Todo número sale de
// /datos/<eleccion>/<anio>/ según el manifiesto (datos.js); el mismo módulo sirve a cada fuente (TREP u oficial).
// Sin HTML desde datos: el texto va con textContent y los estilos por CSSOM.
import { vigilarDesplazables } from '../desplazables.js';
import { cargarEleccion } from '../datos.js';
import { estado as compartido, listo as shellListo } from '../shell.js';
import { $, el, svg, titulo, cantidad, fmt, pct, pct2, porcentaje } from './util.js';
import { MARGEN, formaDe, cargarModelo, ganador, participacion, margenDe, agregadosBarrio, unidades, textoBarrio, compararFuentes } from './modelo.js';
import { PARTICIPACION_COLOR, IPM_COLOR, COLORES_ZONA, simbolo, anillosDePath, cajaDe, encuadre, crearMapaConMesas, mezclar,
         escala, cuantiles, opacidadPaso, pintarBarrio, itemLeyenda } from './mapa.js';
import { renderTotales, renderBancas, renderFuentes, renderNoDisponible } from './panel.js';
import { crearHoja } from './hoja.js';

const CAPAS = ['lista', 'listas', 'participacion', 'margen', 'ipm', 'zona'];
// Capas que colorean los barrios: los puntos de mesa no se dibujan y se elige tocando un barrio (o un local en el IPM).
const CAPAS_BARRIO = new Set(['listas', 'participacion', 'ipm']);
const UNIDADES = ['mesa', 'local', 'barrio', 'zona', 'zona_municipal'];
const PANELES = ['resultados', 'tabla', 'ranking'];
const IPM = ['H', 'A', 'IPM'];
const CARGO_HASH = { 1: 'intendencia', 2: 'junta' };
// Equivalencias con la vista informe: sus pestañas (vista) y las capas del tablero.
const VISTA_A_CAPA = { mapa: 'lista', barrios: 'lista', listas: 'listas', participacion: 'participacion', ipm: 'ipm', margen: 'margen', tablas: 'lista' };
const CAPA_A_VISTA = { lista: 'mapa', listas: 'listas', participacion: 'participacion', margen: 'margen', ipm: 'ipm' };
const TITULOS_CAPA = { lista: 'Lista más votada por mesa', listas: 'Votos por lista, por barrio', participacion: 'Participación por barrio',
                       margen: 'Margen ANR − AJA por mesa', ipm: 'Pobreza multidimensional por barrio', zona: 'Zonas electorales del TSJE' };
// Margen: tramos de la diferencia en puntos a cada lado del empate (menos de 10, de 10 a 25 y 25 o más).
const TRAMOS_MARGEN = [10, 25];
const TEXTO_TRAMO = ['por menos de 10 puntos', 'por 10 a 25 puntos', 'por 25 puntos o más'];
const GRIS = '#9ca3af';
// Fuentes: cómo se nombran dentro de una frase.
const EN_LA_FUENTE = { trep: 'el TREP', oficial: 'el cómputo oficial' };

const estado = { cargo: '1', capa: 'lista', zona: null, zonaMunicipal: null, barrio: null, local: null, mesa: null,
                 lista: { 1: null, 2: null }, medida: 'pct', ipm: 'H', tabla: 'local', orden: null, filtro: '',
                 panel: 'resultados', ranking: 'local', ordenRanking: 'desc' };
let datos, mapa, hoja;
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

// Mesas sin acta dentro de la selección (para «Actas computadas»).
function faltantes() {
    return datos.faltantes.filter((x) => {
        if (estado.local) return estado.mesa === null && x.clave === estado.local;
        if (estado.barrio) return x.info?.barrio === estado.barrio;
        if (estado.zonaMunicipal !== null) return x.info?.zona_municipal === estado.zonaMunicipal;
        if (estado.zona !== null) return x.zona === estado.zona;
        return true;
    }).length;
}

function indicador(etiqueta, valor, detalle) {
    const grupo = el('div', 'indicador');
    grupo.append(el('dt', 'indicador__etiqueta', etiqueta), el('dd', 'indicador__valor', valor), el('dd', 'indicador__detalle', detalle));
    return grupo;
}

function renderIndicadores(total) {
    const listas = datos.listas[estado.cargo];
    const orden = total.votos.map((v, j) => j).sort((a, b) => total.votos[b] - total.votos[a]);
    const p = participacion(total);
    const nodos = [indicador('Participación', p === null ? '—' : `${pct.format(p)} %`, `sobre ${fmt.format(total.electores)} electores`)];
    if (orden.length > 1 && total.votos[orden[0]] > total.votos[orden[1]]) {
        const [a, b] = orden;
        const votos = total.votos[a] - total.votos[b];
        nodos.push(indicador(`Ventaja de ${listas[a].sigla}`, `${fmt.format(votos)} votos`, `${pct.format((100 * votos) / total.listas)} puntos sobre ${listas[b].sigla}`));
    } else {
        nodos.push(indicador('Ventaja', total.listas ? 'Empate' : '—', 'entre las dos más votadas'));
    }
    nodos.push(indicador('Votos emitidos', fmt.format(total.emitidos), `en ${cantidad(total.mesas, 'mesa', 'mesas')}`));
    const blancosNulos = total.blancos + total.nulos;
    nodos.push(indicador('Blancos y nulos', fmt.format(blancosNulos), `${porcentaje(blancosNulos, total.emitidos)} % de emitidos`));
    const esperadas = total.mesas + faltantes();
    nodos.push(indicador('Actas computadas', `${porcentaje(total.mesas, esperadas)} %`, `${fmt.format(total.mesas)} de ${fmt.format(esperadas)}`));
    $('indicadores').replaceChildren(...nodos);
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
    const pasos = [{ nivel: 'asuncion', texto: 'Asunción' }];
    if (hayZona()) pasos.push({ nivel: 'zona', texto: nombreZona() });
    if (estado.barrio) pasos.push({ nivel: 'barrio', texto: estado.barrio });
    if (estado.local) pasos.push({ nivel: 'local', texto: infoDe(estado.local).nombre });
    if (estado.mesa !== null) pasos.push({ nivel: 'mesa', texto: `Mesa ${estado.mesa}` });
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
    for (const radio of document.querySelectorAll('input[name="capa"]')) {
        radio.checked = radio.value === estado.capa;
        if (radio.value !== 'margen') continue;
        radio.disabled = estado.cargo !== MARGEN.cargo;
        radio.nextElementSibling.textContent = radio.disabled ? 'Margen ANR − AJA (solo Intendencia)' : 'Margen ANR − AJA';
    }
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

// --- Mapa: un solo lienzo; cada capa pinta los puntos de mesa o los barrios ------------------------------------------

function crearMapa() {
    mapa = crearMapaConMesas(datos, 'mapa', 'Mapa de Asunción con los barrios, las zonas municipales y un punto por mesa alrededor de cada local de votación',
        (clave) => tocarLocal(clave), { leyendas: () => [], controles: { ampliarEnGrupo: true } });
    // La leyenda va superpuesta al mapa, también en pantalla completa.
    $('mapa').append($('leyendaMapa'));
    // Marca del local elegido, a la vista en todas las capas (en las de barrios no se dibujan los puntos de mesa).
    mapa.marca = svg('circle', { class: 'mapa__marca es-oculta', cx: 0, cy: 0, r: 0 });
    mapa.lienzo.append(mapa.marca);
    mapa.lienzo.addEventListener('click', (evento) => {
        if (!CAPAS_BARRIO.has(estado.capa) || evento.target.closest('[data-local]')) return;
        const barrio = evento.target.closest('[data-barrio]')?.dataset.barrio;
        if (barrio && agregados.has(barrio)) tocarBarrio(barrio);
    });
}

const tramoMargen = (m) => (Math.abs(m) < TRAMOS_MARGEN[0] ? 0 : Math.abs(m) < TRAMOS_MARGEN[1] ? 1 : 2);

function pintarPuntos(visibleEn) {
    const leyenda = $('leyenda');
    const c = datos.mesas.cargos[estado.cargo];
    const conteo = new Map();
    const porZona = new Map();
    const conMargen = estado.capa === 'margen';
    const pos = datos.listas[MARGEN.cargo][datos.indiceMargen.positivo];
    const neg = datos.listas[MARGEN.cargo][datos.indiceMargen.negativo];
    for (const punto of mapa.puntos) {
        const i = Number(punto.dataset.i);
        let clave, color, forma;
        if (conMargen) {
            const m = datos.margenMesa[i];
            if (m === null || m === 0) {
                [clave, color, forma] = [m === null ? 'sin' : 'empate', GRIS, 'circulo'];
            } else {
                const k = tramoMargen(m);
                const item = m > 0 ? pos : neg;
                [clave, color, forma] = [`${m > 0 ? 'pos' : 'neg'}-${k}`, mezclar(item.color, opacidadPaso(k, 3)), formaDe(item)];
            }
        } else {
            const j = ganador(c.votos[i]);
            [clave, color, forma] = j === null ? ['empate', GRIS, 'circulo'] : [`lista-${j}`, colorDe(j), formaDe(datos.listas[estado.cargo][j])];
        }
        punto.setAttribute('fill', color);
        mapa.formaPunto(punto, forma);
        const visible = visibleEn(punto);
        punto.classList.toggle('es-atenuado', !visible);
        if (!visible) continue;
        conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
        const z = porZona.get(punto.dataset.zona) ?? { mesas: 0, locales: new Set() };
        z.mesas += 1;
        z.locales.add(punto.dataset.local);
        porZona.set(punto.dataset.zona, z);
    }
    if (conMargen) {
        for (const [item, signo, tramos] of [[pos, 'pos', [2, 1, 0]], [neg, 'neg', [0, 1, 2]]]) {
            for (const k of tramos) {
                const n = conteo.get(`${signo}-${k}`);
                if (n) leyenda.append(itemLeyenda(mezclar(item.color, opacidadPaso(k, 3)), `${item.sigla} adelante ${TEXTO_TRAMO[k]}: ${cantidad(n, 'mesa', 'mesas')}`, null, formaDe(item)));
            }
        }
        if (conteo.get('empate')) leyenda.append(itemLeyenda(null, `Empate: ${cantidad(conteo.get('empate'), 'mesa', 'mesas')}`, 'leyenda__muestra--empate'));
        $('notaCapa').textContent = `Margen = 100 × (${pos.sigla} − ${neg.sigla}) / votos a listas de Intendencia en cada mesa, en puntos. Color de la que ` +
            'va adelante, más intenso cuanto mayor la diferencia; la forma también la distingue. Cada punto es una mesa dibujada alrededor de su local.';
    } else {
        datos.listas[estado.cargo].forEach((item, j) => {
            const n = conteo.get(`lista-${j}`);
            if (n) leyenda.append(itemLeyenda(item.color, `${item.sigla}: ${cantidad(n, 'mesa', 'mesas')}`, null, formaDe(item)));
        });
        if (conteo.get('empate')) leyenda.append(itemLeyenda(null, `Empate: ${cantidad(conteo.get('empate'), 'mesa', 'mesas')}`, 'leyenda__muestra--empate'));
        if (estado.capa === 'zona') {
            for (const [codigo, nombre] of Object.entries(datos.resumen.zonas)) {
                const z = porZona.get(codigo);
                if (!z) continue;
                const li = itemLeyenda(null, `Zona TSJE ${codigo} · ${nombre}: ${cantidad(z.locales.size, 'local', 'locales')}`, 'leyenda__muestra--halo');
                li.firstChild.style.borderColor = COLORES_ZONA[codigo];
                leyenda.append(li);
            }
        }
        $('notaCapa').textContent = 'Cada punto es una mesa, con el color y la forma de la lista más votada, dibujada alrededor de su local de votación: ' +
            'los puntos se separan para que se vean y no indican una ubicación propia. ' +
            (estado.capa === 'zona' ? 'El halo de cada local indica su zona electoral del TSJE, que no coincide con las zonas municipales. ' : '') +
            'Los contornos rotulados son las 6 zonas municipales oficiales. Tocá un local para ver sus cifras.';
    }
    leyenda.append(itemLeyenda(null, 'Contorno: zonas municipales oficiales', 'leyenda__muestra--zona'));
}

// Sin capa de barrios: los barrios vuelven a ser contorno (sin relleno), con su texto al pasar el puntero.
function vaciarBarrios() {
    for (const [nombre, path] of mapa.barrios) {
        path.removeAttribute('fill');
        path.classList.toggle('es-seleccion', nombre === estado.barrio && !estado.local);
        path.replaceChildren();
        titulo(path, textoBarrio(datos, nombre, agregados.get(nombre), estado.cargo));
    }
}

const barrioElegido = (nombre) => nombre === estado.barrio && !estado.local;

function pintarListas() {
    const listas = datos.listas[estado.cargo];
    const j = listaElegida();
    const enPct = estado.medida === 'pct';
    const medir = (t) => (enPct ? (100 * t.votos[j]) / t.listas : t.votos[j]);
    const rotular = (v) => (enPct ? `${pct.format(v)} %` : `${fmt.format(Math.round(v))} votos`);
    const { cortes, clase } = escala([...agregados.values()].filter((t) => t.listas).map(medir));
    for (const [nombre, path] of mapa.barrios) {
        const total = agregados.get(nombre);
        if (!total || !total.listas) {
            pintarBarrio(path, null, 0, textoBarrio(datos, nombre, null, estado.cargo), barrioElegido(nombre));
            continue;
        }
        pintarBarrio(path, listas[j].color, opacidadPaso(clase(medir(total))),
            `${nombre}: ${listas[j].sigla} ${fmt.format(total.votos[j])} votos (${pct.format((100 * total.votos[j]) / total.listas)} % de los votos a listas)`, barrioElegido(nombre));
    }
    const leyenda = $('leyenda');
    for (let k = 0; k < cortes.length - 1; k++) leyenda.append(itemLeyenda(mezclar(listas[j].color, opacidadPaso(k)), `${rotular(cortes[k])} a ${rotular(cortes[k + 1])}`, 'leyenda__muestra--escala'));
    leyenda.append(itemLeyenda(null, 'Sin locales de votación', 'leyenda__muestra--vacio'));
    $('notaCapa').textContent = (enPct
        ? `Porcentaje de ${listas[j].sigla} (${listas[j].lista}) sobre los votos a listas de los locales de cada barrio`
        : `Votos de ${listas[j].sigla} (${listas[j].lista}) en los locales de cada barrio; depende de cuántas mesas hay en el barrio`) +
        ', en 5 tramos iguales entre el mínimo y el máximo. El barrio es la ubicación del local, no la residencia de sus electores. Tocá un barrio para ver sus cifras.';
}

function pintarParticipacion() {
    const { cortes, clase } = escala([...agregados.values()].filter((t) => t.electores).map(participacion));
    for (const [nombre, path] of mapa.barrios) {
        const total = agregados.get(nombre);
        if (!total || !total.electores) {
            pintarBarrio(path, null, 0, textoBarrio(datos, nombre, null, estado.cargo), barrioElegido(nombre));
            continue;
        }
        const v = participacion(total);
        pintarBarrio(path, PARTICIPACION_COLOR, opacidadPaso(clase(v)),
            `${nombre}: participación ${pct.format(v)} % (${fmt.format(total.emitidos)} de ${fmt.format(total.electores)} electores)`, barrioElegido(nombre));
    }
    const leyenda = $('leyenda');
    for (let k = 0; k < cortes.length - 1; k++) leyenda.append(itemLeyenda(mezclar(PARTICIPACION_COLOR, opacidadPaso(k)), `${pct.format(cortes[k])} a ${pct.format(cortes[k + 1])} %`, 'leyenda__muestra--escala'));
    leyenda.append(itemLeyenda(null, 'Sin locales de votación', 'leyenda__muestra--vacio'));
    const r = datos.resumen.electores;
    $('notaCapa').textContent = 'Votos emitidos sobre electores habilitados de las mesas con acta, por barrio de los locales. Electores: recuento ' +
        `agregado del padrón por mesa (${fmt.format(r.en_mesas_con_acta)} en las mesas con acta). ${fmt.format(r.mesas_con_mas_emitidos_que_electores)} mesas ` +
        'tienen más votos que electores: se muestran tal cual, sin interpretarlas. Tocá un barrio para ver sus cifras.';
}

// Locales de votación encima del IPM: color y forma de la lista más votada, tamaño según electores.
function prepararLocales() {
    if (mapa.locales) return;
    const ordenados = [...datos.porLocal].map(([clave, filas]) => ({ clave, indices: filas.map((f) => f.i), info: infoDe(clave) }))
        .sort((a, b) => b.info.electores - a.info.electores);
    const capa = svg('g', { class: 'mapa__locales' });
    mapa.raizZoom = 1;
    mapa.locales = ordenados.map((l) => {
        const r = Math.round(50 + 2.4 * Math.sqrt(l.info.electores));
        const nodo = svg('path', { d: simbolo(l.info.x, l.info.y, r, 'circulo'), class: 'mapa__local' });
        nodo.dataset.local = l.clave;
        capa.append(nodo);
        return { ...l, nodo, r, forma: 'circulo' };
    });
    mapa.dibujarLocal = (l) => {
        l.nodo.dataset.forma = l.forma;
        l.nodo.setAttribute('d', simbolo(l.info.x, l.info.y, l.r / mapa.raizZoom, l.forma));
    };
    mapa.lienzo.insertBefore(capa, mapa.marca);
    mapa.lienzo.addEventListener('zoommapa', (evento) => {
        mapa.raizZoom = Math.sqrt(evento.detail.factor);
        for (const l of mapa.locales) mapa.dibujarLocal(l);
    });
}

function pintarIpm() {
    prepararLocales();
    const ind = datos.ipm.indicadores.find((x) => x.id === estado.ipm);
    const formato = estado.ipm === 'A' ? pct : pct2;
    // Sin dato publicado, o intensidad sin personas pobres (H = 0): no se colorea.
    const valorDe = (b) => (!b || b[estado.ipm] === null || (estado.ipm === 'A' && b.H === 0) ? null : b[estado.ipm]);
    const motivo = (b) => (!b ? 'sin dato' : b.nota ?? 'sin dato');
    const { cortes, clase } = cuantiles(datos.geo.barrios.map((b) => valorDe(datos.ipmPor.get(b.clave))).filter((v) => v !== null));
    const conteo = new Array(5).fill(0);
    for (const [nombre, path] of mapa.barrios) {
        const b = datos.ipmPor.get(path.dataset.clave);
        const v = valorDe(b);
        if (v === null) {
            pintarBarrio(path, null, 0, `${nombre}: ${motivo(b)}`, barrioElegido(nombre));
            continue;
        }
        const k = clase(v);
        conteo[k] += 1;
        pintarBarrio(path, IPM_COLOR, opacidadPaso(k), `${nombre}: ${ind.nombre} ${formato.format(v)} %`, barrioElegido(nombre));
    }
    const leyenda = $('leyenda');
    for (let k = 0; k < 5; k++) {
        leyenda.append(itemLeyenda(mezclar(IPM_COLOR, opacidadPaso(k)), `${formato.format(cortes[k])} a ${formato.format(cortes[k + 1])} % · ${cantidad(conteo[k], 'barrio', 'barrios')}`, 'leyenda__muestra--escala'));
    }
    const sinColor = mapa.barrios.size - conteo.reduce((a, b) => a + b, 0);
    if (sinColor) leyenda.append(itemLeyenda(null, `Sin dato o no aplica: ${cantidad(sinColor, 'barrio', 'barrios')}`, 'leyenda__muestra--vacio'));
    const ganados = new Map();
    for (const l of mapa.locales) {
        const total = datos.sumar(l.indices, estado.cargo);
        const j = ganador(total.votos);
        l.nodo.setAttribute('fill', j === null ? GRIS : colorDe(j));
        const forma = j === null ? 'circulo' : formaDe(datos.listas[estado.cargo][j]);
        if (forma !== l.forma) {
            l.forma = forma;
            mapa.dibujarLocal(l);
        }
        l.nodo.classList.toggle('es-seleccion', l.clave === estado.local);
        l.nodo.classList.toggle('es-atenuado', fueraDeZona(l.info));
        ganados.set(j ?? 'empate', (ganados.get(j ?? 'empate') ?? 0) + 1);
        const delBarrio = datos.ipmPor.get(datos.barrioPor.get(l.info.barrio)?.clave);
        const vb = valorDe(delBarrio);
        const lider = j === null ? 'empate' : `${datos.listas[estado.cargo][j].sigla} ${pct.format((100 * total.votos[j]) / total.listas)} %`;
        l.nodo.replaceChildren();
        titulo(l.nodo, `${l.info.nombre} · ${lider} · ${fmt.format(l.info.electores)} electores · barrio ${l.info.barrio}: ` +
            `${ind.nombre} ${vb === null ? motivo(delBarrio) : `${formato.format(vb)} %`}`);
    }
    datos.listas[estado.cargo].forEach((item, j) => {
        if (ganados.get(j)) leyenda.append(itemLeyenda(item.color, `Locales con ${item.sigla} más votada: ${fmt.format(ganados.get(j))}`, 'leyenda__muestra--local', formaDe(item)));
    });
    $('notaCapa').textContent = `${ind.nombre}: ${ind.descripcion} Barrios en quintiles (INE, Censo 2022). Símbolos: los locales de votación, con el ` +
        'color y la forma de la lista más votada y tamaño según sus electores. Es una comparación entre agregados: no muestra cómo votaron las personas ' +
        'en situación de pobreza ni ningún otro grupo, y el barrio del local no es necesariamente el de residencia de sus electores.';
}

function marcarSeleccion() {
    for (const punto of mapa.puntos) {
        const delLocal = punto.dataset.local === estado.local;
        punto.classList.toggle('es-seleccion', delLocal);
        punto.classList.toggle('es-seleccion-mesa', delLocal && estado.mesa !== null && datos.filas[Number(punto.dataset.i)].mesa === estado.mesa);
    }
    const marca = mapa.marca;
    marca.classList.toggle('es-oculta', !estado.local);
    if (estado.local) {
        const info = infoDe(estado.local);
        marca.setAttribute('cx', info.x);
        marca.setAttribute('cy', info.y);
        marca.setAttribute('r', mapa.radioLocal.get(estado.local) + 60);
    }
}

function renderMapa() {
    const lienzo = mapa.lienzo;
    lienzo.dataset.capa = estado.capa;
    lienzo.classList.toggle('es-modo-zona', estado.capa === 'zona');
    const visibleEn = (nodo) => (estado.zona === null || Number(nodo.dataset.zona) === estado.zona) &&
        (estado.zonaMunicipal === null || nodo.dataset.zm === String(estado.zonaMunicipal));
    for (const halo of lienzo.querySelectorAll('.mapa__halo')) halo.classList.toggle('es-atenuado', !visibleEn(halo));
    for (const nodo of lienzo.querySelectorAll('[data-zona-municipal]')) {
        nodo.classList.toggle('es-seleccion', Number(nodo.dataset.zonaMunicipal) === estado.zonaMunicipal);
        nodo.classList.toggle('es-atenuado', estado.zonaMunicipal !== null && Number(nodo.dataset.zonaMunicipal) !== estado.zonaMunicipal);
    }
    // El encuadre solo depende de la zona: cambiar de capa o elegir un local conserva el zoom.
    mapa.fijarMarco(encuadre(datos, estado));
    $('leyenda').replaceChildren();
    $('tituloLeyenda').textContent = TITULOS_CAPA[estado.capa];
    if (estado.capa === 'listas') pintarListas();
    else if (estado.capa === 'participacion') pintarParticipacion();
    else if (estado.capa === 'ipm') pintarIpm();
    else pintarPuntos(visibleEn);
    if (!CAPAS_BARRIO.has(estado.capa)) vaciarBarrios();
    marcarSeleccion();
}

// Encuadra el mapa en un local (o en su mesa): conserva un acercamiento mayor si ya lo había. En celular lo deja en
// la parte del mapa que no tapa la hoja inferior.
function enfocarCaja(caja) {
    mapa.zoom.enfocar(caja);
    if (!hoja.celular()) return;
    const lienzo = mapa.lienzo.getBoundingClientRect();
    const tapado = Math.max(0, lienzo.bottom - $('hoja').getBoundingClientRect().top);
    const vista = mapa.zoom.vista();
    if (!tapado || !vista) return;
    const k = vista[2] / lienzo.width;
    mapa.zoom.enfocar([vista[0], vista[1] + (tapado / 2) * k, vista[2], vista[3]]);
}

function enfocarLocal(clave) {
    const info = infoDe(clave);
    const vista = mapa.zoom.vista();
    const lado = Math.min(vista ? vista[2] : Infinity, 2600);
    enfocarCaja([info.x - lado / 2, info.y - lado / 2, lado, lado]);
}

function enfocarBarrio(nombre) {
    const b = datos.barrioPor.get(nombre);
    if (!b) return;
    const puntos = anillosDePath(b.d).flat();
    enfocarCaja(cajaDe(datos, puntos.map((p) => p[0]), puntos.map((p) => p[1]), 250));
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
    if (estado.cargo === MARGEN.cargo) columnas.push({ id: 'margen', titulo: 'Margen' });
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
        if (col.id === 'margen') return margenDe(datos, u.total, estado.cargo) ?? -Infinity;
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
            else if (c.id === 'margen') texto = v === -Infinity ? '—' : `${v > 0 ? '+' : ''}${pct.format(v)}`;
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
        'participación = emitidos / electores' + (estado.cargo === MARGEN.cargo
        ? ` · margen en puntos (+ = ${datos.listas[MARGEN.cargo][datos.indiceMargen.positivo].sigla} adelante)` : '') + ' · tocá un nombre para verlo en el mapa';
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

// Ranking según la capa: el porcentaje de la lista elegida, la participación, el margen o el IPM del barrio; con
// «Lista más votada» y «Zona TSJE», el porcentaje de la lista más votada en Asunción.
function metricaRanking() {
    const listas = datos.listas[estado.cargo];
    const porLista = (j, tituloMetrica) => ({ titulo: tituloMetrica, valor: (u) => (u.total.listas ? (100 * u.total.votos[j]) / u.total.listas : null),
                                              texto: (v) => `${pct.format(v)} %`, color: () => listas[j].color });
    if (estado.capa === 'listas') return porLista(listaElegida(), `% de ${listas[listaElegida()].sigla}`);
    if (estado.capa === 'participacion') return { titulo: 'Participación', valor: (u) => participacion(u.total), texto: (v) => `${pct.format(v)} %`, color: () => PARTICIPACION_COLOR };
    if (estado.capa === 'margen') {
        const pos = datos.listas[MARGEN.cargo][datos.indiceMargen.positivo], neg = datos.listas[MARGEN.cargo][datos.indiceMargen.negativo];
        return { titulo: `Margen ${pos.sigla} − ${neg.sigla}`, valor: (u) => margenDe(datos, u.total, estado.cargo),
                 texto: (v) => `${v > 0 ? '+' : ''}${pct.format(v)} puntos`, color: (v) => (v >= 0 ? pos.color : neg.color) };
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
        relleno.style.background = m.color(v);
        barra.append(relleno);
        boton.append(el('span', 'ranking-lista__pos', `${k + 1}.`), el('span', 'ranking-lista__nombre', u.nombre), barra, el('span', 'ranking-lista__valor', m.texto(v)));
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
    const visible = hoja.visible();
    const cambio = claveSeleccion() !== seleccionMostrada;
    if (visible === 'tabla') {
        renderTabla();
        if (cambio) mostrarElegida($('desplazaTabla'), $('tabla').querySelector('tbody tr.es-seleccion'));
    } else if (visible === 'ranking') {
        renderRanking();
        if (cambio) mostrarElegida($('ranking'), $('ranking').querySelector('[aria-current="true"]'));
    }
    if (visible !== 'resultados') seleccionMostrada = claveSeleccion();
}

// --- Render y elecciones ----------------------------------------------------------------------------------------

function renderTodo() {
    if (estado.capa === 'margen' && estado.cargo !== MARGEN.cargo) estado.capa = 'lista';
    agregados = agregadosBarrio(datos, estado.cargo);
    const total = renderTotales(datos, estado.cargo, seleccion(), { hayFiltro: haySeleccion() });
    renderBancas(datos, estado.cargo, { fuente, nombreFuente: datos.contexto.anio.fuentes?.[fuente]?.nombre });
    renderIndicadores(total);
    renderFiltros();
    renderCapas();
    renderMapa();
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

// En celular, lo tocado en el mapa abre la hoja a media altura con sus resultados y queda a la vista.
function tocarLocal(clave) {
    elegirLocal(clave);
    if (!hoja.celular()) return;
    hoja.elegirPanel('resultados', { altura: 'medio' });
    const punto = mapa.lienzo.querySelector(`.mapa__toque[data-local="${CSS.escape(clave)}"]`)?.getBoundingClientRect();
    if (punto && punto.top + punto.height / 2 > $('hoja').getBoundingClientRect().top - 24) enfocarLocal(clave);
}

function tocarBarrio(nombre) {
    elegirBarrio(nombre);
    if (hoja.celular()) hoja.elegirPanel('resultados', { altura: 'medio' });
}

// Elegido en la tabla o el ranking: en celular, la hoja baja a media altura para que se vea el mapa.
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
    if (hoja.celular()) hoja.fijarAltura('medio');
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

function elegirSugerencia(clave) {
    $('buscarLocal').value = '';
    cerrarSugerencias();
    $('estadoBusqueda').textContent = `Elegido: ${infoDe(clave).nombre}`;
    elegirLocal(clave, { enfocar: false });
    if (!hoja.ancho()) abrirFiltros(false, { foco: false });
    if (hoja.celular()) hoja.elegirPanel('resultados', { altura: 'medio' });
    enfocarLocal(clave);
}

// --- Filtros como panel superpuesto (tablet vertical y celular) ---------------------------------------------------

function abrirFiltros(abrir, { foco = true } = {}) {
    $('filtros').classList.toggle('es-abierto', abrir);
    $('botonCapas').setAttribute('aria-expanded', String(abrir));
    if (!foco) return;
    if (abrir) $('cerrarFiltros').focus();
    else $('botonCapas').focus();
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
    if (estado.zonaMunicipal !== null) p.set('zona_municipal', String(estado.zonaMunicipal));
    else if (estado.zona !== null) p.set('zona', String(estado.zona));
    if (estado.local) p.set('local', estado.local);
    else if (estado.barrio) p.set('barrio', estado.barrio);
    if (estado.mesa !== null) p.set('mesa', String(estado.mesa));
    if (estado.tabla !== 'local') p.set('tabla', estado.tabla);
    if (estado.panel !== 'resultados') p.set('panel', estado.panel);
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
    estado.tabla = UNIDADES.includes(p.get('tabla')) ? p.get('tabla') : 'local';
    estado.panel = PANELES.includes(p.get('panel')) ? p.get('panel') : 'resultados';
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
    // Fuentes y método: diálogo modal; se cierra con «Cerrar», Escape o tocando fuera, y el foco vuelve al botón.
    const dialogo = $('dialogoFuentes');
    $('abrirFuentes').addEventListener('click', () => dialogo.showModal());
    $('cerrarFuentes').addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('click', (evento) => { if (evento.target === dialogo) dialogo.close(); });
    dialogo.addEventListener('close', () => $('abrirFuentes').focus());
    $('botonCapas').addEventListener('click', () => abrirFiltros(!$('filtros').classList.contains('es-abierto')));
    $('cerrarFiltros').addEventListener('click', () => abrirFiltros(false));
    document.addEventListener('keydown', (evento) => {
        if (evento.key === 'Escape' && !evento.defaultPrevented && $('filtros').classList.contains('es-abierto') && !hoja.ancho()) {
            evento.preventDefault();
            abrirFiltros(false);
        }
    });
    // Un enlace pegado en la misma pestaña (o el hash editado a mano) cambia la vista sin recargar.
    window.addEventListener('hashchange', () => {
        leerEnlace();
        hoja.elegirPanel(estado.panel, { avisar: false });
        renderTodo();
    });
    // Cambio de tema: el mapa se vuelve a pintar con la superficie nueva.
    new MutationObserver(() => renderMapa()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

function renderFijos() {
    const r = datos.resumen;
    const { eleccion, anio } = datos.contexto;
    $('tituloTablero').textContent = `${anio.fuentes?.[fuente]?.nombre ?? r.eleccion.etapa} · ${eleccion.nombre} ${anio.anio} · ${anio.ambito ?? ''}`;
    if (r.eleccion.aviso) $('avisoLegal').append(` ${r.eleccion.aviso}`);
    for (const [codigo, nombre] of Object.entries(r.zonas_municipales)) $('opcionesMunicipales').append(new Option(`${codigo} · ${nombre}`, `m${codigo}`));
    for (const [codigo, nombre] of Object.entries(r.zonas)) $('opcionesTsje').append(new Option(`${codigo} · ${nombre}`, `t${codigo}`));
    renderFuentes(datos, { fuente });
    renderNoDisponible(datos);
    // La vista informe existe solo en las páginas que tienen su plantilla (TREP).
    $('enlaceInforme').hidden = !document.getElementById('plantillaInforme');
}

// La leyenda empieza abierta solo si el mapa tiene alto de sobra (en celular y en pantallas bajas, plegada).
function abrirLeyendaSiCabe() {
    $('leyendaMapa').open = !hoja.celular() && $('mapa').getBoundingClientRect().height >= 320;
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
        // Margen por mesa (Intendencia), para la capa del margen.
        datos.margenMesa = datos.filas.map((f) => margenDe(datos, datos.sumar([f.i], MARGEN.cargo), MARGEN.cargo));
        renderFijos();
        crearMapa();
        hoja = crearHoja({ alElegirPanel: (panel) => { estado.panel = panel; renderBandeja(); actualizarEnlace(); }, alMostrar: () => renderBandeja() });
        eventos();
        abrirLeyendaSiCabe();
        leerEnlace();
        // Celular: la hoja asoma con los indicadores; con un local elegido, a media altura; con la tabla, completa.
        hoja.elegirPanel(estado.panel, { avisar: false, altura: estado.panel !== 'resultados' ? 'completo' : haySeleccion() ? 'medio' : 'peek' });
        renderTodo();
        enlaceListo = true;
        await shellListo;  // La barra de contexto (cargos y estado de la fuente) también está lista.
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
