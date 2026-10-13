// Mapa del país (ADR-022, tarea M15): el TREP abre en Paraguay por distrito, con el color de la lista más votada del cargo
// de la barra en cada uno (Intendencia o Junta Municipal, ADR-024; los partidos con su color; las alianzas, los
// movimientos locales y las listas solo de Intendencia en verde), sin mapa base
// de calles. Usa las piezas del tablero de un distrito: panel de pestañas (Resultados, Bancas, Filtros, Capas y Método)
// en columna, cajón u hoja (hoja.js), bandeja con la tabla y el ranking de distritos, la ficha en pantalla completa
// (ficha.js) y los controles del mapa. Tocar un distrito muestra su resumen y el enlace a su tablero. El estado va en el
// hash: departamento, elegido, mapa (la capa), partido, ipm y area (la capa del IPM, ADR-023), panel y bandeja. Sin HTML
// desde datos: todo con textContent.
import { vigilarDesplazables } from '../desplazables.js';
import { indiceNacional, geoNacional, archivoNacional, carpetaNacional } from '../datos.js';
import { estado as compartido, listo as shellListo } from '../shell.js';
import { ASUNCION, TABLERO_DE_DISTRITO, hashDe } from '../ambito.js';
import { crearDialogo } from '../dialogo.js';
import { $, el, cantidad, fmt, pct, pct2 } from './util.js';
import { PARTICIPACION_COLOR, IPM_COLOR, mezclar, escala, cuantiles, opacidadPaso, paleta, itemLeyenda } from './mapa.js';
import { crearMapaPais } from './mapa_pais.js';
import { crearPanel, crearBandeja } from './hoja.js';
import { cargosDe, datoDe } from '../cargos.js';

const CAPAS = ['ganadora', 'participacion', 'ventaja', 'partido', 'ipm'];
// Pobreza multidimensional por distrito (INE, Censo 2022; ADR-023): el componente y el área.
const IPM = ['H', 'A', 'IPM'];
const AREAS = ['total', 'urbana', 'rural'];
const EN_AREA = { total: '', urbana: ' (área urbana)', rural: ' (área rural)' };
const EN_FRASE = { H: 'incidencia (H)', A: 'intensidad (A)', IPM: 'IPM (H × A)' };
const PANELES = ['resultados', 'bancas', 'filtros', 'capas', 'metodo'];
const BANDEJAS = ['tabla', 'ranking'];
const ELEMENTOS = ['departamentos', 'distritos', 'nombres'];
const OPACIDAD_POR_OMISION = 85;
const TRAMOS_VENTAJA = [10, 25];
const TEXTO_TRAMO = ['por menos de 10 puntos', 'por 10 a 25 puntos', 'por 25 puntos o más'];
// Grupo de las alianzas y los movimientos locales (cada uno es de un solo distrito): no es una sigla.
const LOCALES = '~locales';
const NOMBRE_LOCALES = 'Alianzas y movimientos locales';
// Porcentaje de los votos a listas desde el que un partido tiene fila propia en los resultados del país.
const MINIMO_FILA = 1;
// Los cargos del año (ADR-024 y ADR-042): los declara el manifiesto (cargos.js), con la clave del hash, cómo se nombran en
// el panel y en una frase, y de dónde salen sus cifras. Municipales 2026: '1' Intendencia y '2' Junta Municipal del TREP.
let CARGOS = {};
const EN_EL_PANEL = { junta: 'Junta Municipal', 'junta-departamental': 'Junta departamental', consejo: 'Consejo de la Magistratura' };
const PLANILLAS_TREP_2026 = { intendencia: 'las planillas uninominales del TREP', junta: 'las planillas del TREP de la Junta' };
function armarCargos(anio, fuente) {
    CARGOS = Object.fromEntries(Object.values(cargosDe(anio)).map((c) => [c.dato, {
        ...c, nombre: EN_EL_PANEL[c.clave] ?? c.etiqueta,
        planilla: fuente === 'trep' ? PLANILLAS_TREP_2026[c.clave] ?? 'el TREP' : 'el cómputo oficial del TSJE' }]));
}
// La clave de los datos de un cargo pedido (por el hash o por los datos); si el año no lo tiene, su primer cargo.
const cargoDe = (clave) => datoDe(contexto.anio, clave) ?? Object.keys(CARGOS)[0];
const conBancasDeDistrito = (cargo) => CARGOS[cargo]?.bancas === 'distrito';
// Con resultados por mesa (los años sin ellos, ADR-042, no tienen actas ni tablero de distrito).
const porMesa = () => (contexto.anio.nacional?.nivel ?? 'mesa') === 'mesa';
let fuente = 'trep';
const TITULOS_CAPA = { participacion: 'Participación por distrito', ventaja: 'Ventaja del primero sobre el segundo',
                       partido: 'Votos de un partido, por distrito', ipm: 'Pobreza multidimensional por distrito' };
// En la leyenda, el grupo verde (en los dos cargos).
const LOCAL_EN_LEYENDA = 'Alianza o movimiento local';
const tituloCapa = (capa) => (capa === 'ganadora' ? `Lista más votada ${CARGOS[estado.cargo].de}, por distrito` : TITULOS_CAPA[capa]);
const colador = new Intl.Collator('es', { sensitivity: 'base' });
const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// «04/10/2026 23:48» desde «2026-10-04T23:48:02» (hora de Paraguay, sin zona): sin pasar por Date, que la cambiaría.
const fechaLarga = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso ?? '');
    return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : iso ?? '';
};

let contexto = null;
let indice = null;
let distritos = [];
let porClave = new Map();
let porDep = new Map();
let claves = [];
let colores = null;
let partidos = new Map();   // sigla → { sigla, nombre, color, distritos }
// Los distritos de cada cargo, con los mismos campos (votos, listas, ganadora…): el de la barra es el que se muestra.
let porCargo = {};
let opcionesPartido = null;  // Cargo con el que se armó la lista de partidos de Capas.
let mapa = null;
let panel = null;
let bandeja = null;
let ficha = null;
let dialogos = null;
let enlaceListo = false;
let opcionesFiltro = null;  // Departamento con el que se armó la lista de distritos de Filtros.
// indicadores_distritos.json (47 KB): se lee la primera vez que se elige la capa del IPM o se abre la fuente.
let ipm = null;
let ipmPor = new Map();
let ipmEnCurso = null;
let ipmFallo = false;
const estado = { cargo: null, departamento: null, elegido: null, capa: 'ganadora', partido: 'ANR', ipm: 'H', area: 'total', opacidad: OPACIDAD_POR_OMISION,
                 ver: { departamentos: true, distritos: true, nombres: true, base: true }, panel: 'resultados', bandeja: null, orden: null,
                 ordenRanking: 'desc', filtro: '' };

// --- Modelo -------------------------------------------------------------------------------------------------------

// Las alianzas y los movimientos van juntos («locales») en las municipales y las complementarias, donde cada uno es de un
// distrito; en las demás elecciones (generales, ADR-042) son nacionales o departamentales: cada uno con su sigla.
const agruparLocales = () => ['municipales', 'complementarias'].includes(contexto.eleccion.id);
const grupoDe = (lista, sigla) => (lista.tipo === 'empate' ? EMPATE : lista.tipo === 'partido' || !agruparLocales() ? sigla : LOCALES);
// La sigla de la ganadora para mostrar (un empate no tiene sigla).
const siglaGanadora = (d) => (d.ganadora === EMPATE ? 'empate' : d.ganadora);
const enFiltro = (d) => estado.departamento === null || d.departamento === estado.departamento;
const visibles = () => distritos.filter(enFiltro);
const nombreDep = (codigo) => porDep.get(codigo)?.nombre ?? '';
const participacionDe = (d) => (d.participacion === null || d.participacion === undefined ? null : 100 * d.participacion);
const pctDe = (d, sigla) => (d.votos_listas && d.listas[sigla] ? (100 * d.votos[sigla]) / d.votos_listas : null);
const tramo = (v) => (v < TRAMOS_VENTAJA[0] ? 0 : v < TRAMOS_VENTAJA[1] ? 1 : 2);
// Valor del componente en el área: sin dato (Asunción, un área sin población) o intensidad sin personas pobres (H = 0), null.
const ipmDe = (d, k = estado.ipm, area = estado.area) => {
    if (d.abarca) return null;   // ADR-043: el IPM es de los distritos de hoy y este abarcaba varios
    const x = ipmPor.get(d.clave);
    const v = x?.[k]?.[area];
    return v === null || v === undefined || (k === 'A' && x.H[area] === 0) ? null : v;
};
const formatoIpm = (k = estado.ipm) => (k === 'A' ? pct : pct2);
const indicadorIpm = (k = estado.ipm) => ipm.indicadores.find((x) => x.id === k);
// Por qué un distrito no tiene el valor en la capa del IPM.
const sinIpm = (d) => (d.clave === ASUNCION ? 'su IPM es por barrio (en su tablero)'
    : d.abarca ? `abarcaba ${cantidad(d.abarca.length, 'distrito', 'distritos')} de hoy (el IPM es por distrito de hoy)`
    : ipmPor.get(d.clave)?.H?.[estado.area] === null ? `sin población ${estado.area}` : 'sin dato');
// Los distritos de hoy que abarcaba un distrito de entonces (ADR-043), sin el suyo.
const otrosDeHoy = (d) => {
    const otros = (d.abarca ?? []).slice(1).map((x) => x.nombre);
    return otros.length > 1 ? `${otros.slice(0, -1).join(', ')} y ${otros.at(-1)}` : otros[0] ?? '';
};

function cargarIpm() {
    ipmEnCurso ??= archivoNacional(contexto.eleccion.id, contexto.anio.anio, 'indicadores_distritos.json').then((datos) => {
        ipm = datos;
        ipmPor = new Map(Object.entries(datos.distritos));
        return true;
    }, (error) => {
        console.warn(error);
        ipmFallo = true;
        return false;
    });
    return ipmEnCurso;
}
const opacidad = () => estado.opacidad / 100;
// El tablero mesa por mesa existe con resultados por mesa y la carpeta del distrito (ADR-042: en el histórico por distrito,
// no).
const tableroDisponible = (clave) => porMesa() && (clave === ASUNCION || TABLERO_DE_DISTRITO) && porClave.get(clave)?.carpeta != null;
const enlaceTablero = (clave) => hashDe({ distrito: clave }, { cargoDisponible: (c) => cargosDelPais().includes(c) || clave === ASUNCION,
                                                              cargoPorOmision: cargosDelPais().includes('junta') ? 'junta' : cargosDelPais()[0],
                                                              eleccion: contexto.eleccion.id, anio: contexto.anio.anio, cargo: CARGOS[estado.cargo].clave });
// Los cargos que el manifiesto declara para el país (ADR-024).
const cargosDelPais = () => contexto.anio.nacional?.cargos ?? contexto.anio.cargos;

// La lista que gana un distrito; sin ganadora (un empate en el primer lugar), una lista ficticia en el gris de «otro».
const EMPATE = '~empate';
const ganaDe = (x) => x.listas[x.ganadora] ?? { nombre: 'Empate en el primer lugar', color: colores?.otro ?? '#94A3B8', tipo: 'empate' };

function preparar(datos) {
    indice = datos;
    porDep = new Map(datos.departamentos.map((d) => [d.codigo, d]));
    // Cada cargo (índice versión 2, ADR-042; datos.js convierte el de municipales 2026): un registro por distrito con los
    // campos de su bloque. Los electores: los de las mesas con acta (TREP 2026) o, en el histórico, el padrón del TSJE; la
    // participación, votos emitidos sobre esos electores.
    porCargo = {};
    for (const cargo of Object.keys(CARGOS)) {
        const lista = datos.distritos.filter((d) => d.cargos?.[cargo]).map((d) => {
            const x = d.cargos[cargo];
            const padron = d.electores?.padron ?? 0;
            const enMesas = x.electores_en_mesas_con_acta ?? d.electores?.en_mesas_con_acta ?? padron;
            return { ...d, ...x, nocomputados: x.nocomputados ?? 0, locales: d.locales ?? 0,
                     mesas: { esperadas: d.mesas?.esperadas ?? 0, con_acta: x.mesas ?? d.mesas?.con_acta ?? 0 },
                     electores: { padron, en_mesas_con_acta: enMesas ?? 0 },
                     participacion: x.participacion ?? (enMesas ? x.emitidos / enMesas : null),
                     bancas: x.bancas ?? { total: 0, reparto: {} }, ganadora: x.ganadora ?? EMPATE, gana: ganaDe(x) };
        });
        if (!lista.length) continue;
        const delCargo = new Map();
        for (const d of lista) {
            for (const [sigla, x] of Object.entries(d.listas)) {
                if (x.tipo !== 'partido' && agruparLocales()) continue;
                const p = delCargo.get(sigla) ?? { sigla, nombre: x.nombre, color: colores?.partidos?.[sigla] ?? x.color, distritos: 0 };
                p.distritos += 1;
                delCargo.set(sigla, p);
            }
        }
        porCargo[cargo] = { distritos: lista, porClave: new Map(lista.map((d) => [d.clave, d])), partidos: delCargo };
    }
    usarCargo(estado.cargo);
}

// Cambia los distritos que se muestran a los del cargo (el primero del año, si falta).
function usarCargo(cargo) {
    estado.cargo = porCargo[cargo] ? cargo : Object.keys(porCargo)[0];
    ({ distritos, porClave, partidos } = porCargo[estado.cargo]);
    claves = distritos.map((d) => d.clave);
}

// Suma de un grupo de distritos (el país o un departamento): totales y votos, bancas y distritos ganados por partido, con
// las alianzas y los movimientos locales juntos. Las bancas, solo del cargo que las reparte en el distrito (la Junta).
function agregar(lista, cargo = estado.cargo) {
    const conBancas = conBancasDeDistrito(cargo);
    const colorPartido = (sigla) => porCargo[cargo].partidos.get(sigla)?.color;
    const t = { distritos: lista.length, mesas: 0, esperadas: 0, locales: 0, electores: 0, padron: 0, emitidos: 0, listas: 0, blancos: 0,
                nulos: 0, nocomputados: 0, bancas: 0 };
    const grupos = new Map();
    for (const d of lista) {
        t.mesas += d.mesas.con_acta;
        t.esperadas += d.mesas.esperadas;
        t.locales += d.locales;
        t.electores += d.electores.en_mesas_con_acta;
        t.padron += d.electores.padron;
        t.emitidos += d.emitidos;
        t.listas += d.votos_listas;
        t.blancos += d.blancos;
        t.nulos += d.nulos;
        t.nocomputados += d.nocomputados;
        if (conBancas) t.bancas += d.bancas.total;
        const presentes = new Set();
        for (const [sigla, x] of Object.entries(d.listas)) {
            const g = grupoDe(x, sigla);
            if (!grupos.has(g)) {
                grupos.set(g, g === LOCALES
                    ? { clave: g, sigla: null, nombre: NOMBRE_LOCALES, color: colores.verdes[0], votos: 0, bancas: 0, ganados: 0, distritos: 0 }
                    : { clave: g, sigla, nombre: x.nombre, color: colorPartido(sigla) ?? x.color, votos: 0, bancas: 0, ganados: 0, distritos: 0 });
            }
            const r = grupos.get(g);
            r.votos += d.votos[sigla];
            if (conBancas) r.bancas += d.bancas.reparto[sigla] ?? 0;
            if (d.ganadora === sigla) r.ganados += 1;
            presentes.add(g);
        }
        for (const g of presentes) grupos.get(g).distritos += 1;
    }
    return { ...t, grupos: [...grupos.values()].sort((a, b) => b.votos - a.votos) };
}

// Texto oscuro o claro sobre un color (sigla dentro de su muestra).
function tintaSobre(hex) {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#0f172a' : '#ffffff';
}

const textoSigla = (g) => (g.clave === LOCALES ? 'LOCAL' : g.sigla.slice(0, 5));

// --- Panel: resultados ----------------------------------------------------------------------------------------------

// Una fila de lista (o de grupo): sigla en su color, nombre, cifra principal, barra y pie.
function filaResultado({ sigla, color, nombre, valor, parte, total, pie }) {
    const fila = el('div', 'resultado');
    const figura = el('span', 'resultado__foto resultado__foto--sigla', sigla);
    figura.style.background = color;
    figura.style.borderColor = color;
    figura.style.color = tintaSobre(color);
    const cuerpo = el('div', 'resultado__cuerpo');
    const encabezado = el('div', 'resultado__encabezado');
    encabezado.append(el('strong', 'resultado__nombre', nombre), el('span', 'resultado__votos', valor));
    const barra = el('div', 'barra');
    const relleno = el('span', 'barra__relleno');
    relleno.style.width = `${total ? (100 * parte) / total : 0}%`;
    relleno.style.background = color;
    barra.append(relleno);
    const piePagina = el('div', 'resultado__pie');
    piePagina.append(el('span', null, pie), el('span', 'resultado__pct', `${total ? pct.format((100 * parte) / total) : '0,0'} %`));
    cuerpo.append(encabezado, barra, piePagina);
    fila.append(figura, cuerpo);
    return fila;
}

// Barra apilada (distritos ganados o bancas) y su lista; partes: [{ clave, texto, color, n }].
function apilada(contenedor, titulo, partes, total, unidad) {
    contenedor.replaceChildren();
    contenedor.append(el('h3', 'pais-apilada__titulo', titulo));
    const barra = el('div', 'pais-apilada__barra');
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', `${titulo}: ${partes.map((p) => `${p.texto} ${fmt.format(p.n)}`).join(', ')}`);
    const listaNodo = el('ul', 'pais-apilada__lista');
    for (const p of partes) {
        const segmento = el('span', 'pais-apilada__parte');
        segmento.style.width = `${(100 * p.n) / total}%`;
        segmento.style.background = p.color;
        segmento.title = `${p.texto}: ${cantidad(p.n, unidad[0], unidad[1])}`;
        barra.append(segmento);
        const item = el('li');
        const muestra = el('span', 'pais-apilada__muestra');
        muestra.style.background = p.color;
        item.append(muestra, el('span', null, p.texto), el('strong', null, fmt.format(p.n)));
        listaNodo.append(item);
    }
    contenedor.append(barra, listaNodo);
}

function renderParticipacion(emitidos, electores) {
    const nodo = $('participacion');
    nodo.replaceChildren();
    if (!electores) return;
    nodo.append(el('span', 'participacion__titulo', 'Participación'),
        el('strong', 'participacion__valor', `${pct.format((100 * emitidos) / electores)} %`),
        el('span', 'participacion__detalle', `${fmt.format(emitidos)} votos emitidos de ${fmt.format(electores)} electores habilitados en las mesas con acta (padrón).`));
}

function renderOtros(t) {
    const otros = $('otrosVotos');
    otros.replaceChildren();
    for (const [etiqueta, valor] of [['Votos a listas', t.listas], ['Blancos', t.blancos], ['Nulos', t.nulos], ['No computados', t.nocomputados],
        ['Emitidos', t.emitidos], ['Electores', t.electores]]) {
        const grupo = el('div');
        grupo.append(el('dt', null, etiqueta), el('dd', null, fmt.format(valor)));
        otros.append(grupo);
    }
}

function renderResultados() {
    const d = estado.elegido ? porClave.get(estado.elegido) : null;
    if (d) {
        renderDistrito(d);
        return;
    }
    const t = agregar(visibles());
    const pais = estado.departamento === null;
    const junta = conBancasDeDistrito(estado.cargo);
    $('eyebrowTotales').textContent = `${pais ? 'Todo el país' : 'Departamento'} · ${CARGOS[estado.cargo].nombre}`;
    $('tituloTotales').textContent = pais ? contexto.anio.nacional?.nombre ?? 'Paraguay' : nombreDep(estado.departamento);
    $('metaTotales').textContent = `${cantidad(t.distritos, 'distrito', 'distritos')} · ` +
        (porMesa() ? `${fmt.format(t.mesas)} de ${fmt.format(t.esperadas)} mesas con acta` : 'resultados por distrito') +
        (junta ? ` · ${fmt.format(t.bancas)} bancas` : '');
    $('abrirDistrito').hidden = true;
    $('limpiarSeleccion').hidden = pais;
    $('limpiarSeleccion').textContent = 'Ver todo el país';
    const ganados = $('ganados');
    ganados.hidden = false;
    apilada(ganados, `Distritos ganados (lista más votada ${CARGOS[estado.cargo].de})`,
        t.grupos.filter((g) => g.ganados).sort((a, b) => b.ganados - a.ganados)
            .map((g) => ({ clave: g.clave, texto: g.clave === LOCALES ? NOMBRE_LOCALES : g.sigla, color: g.color, n: g.ganados })),
        t.distritos, ['distrito', 'distritos']);
    const propias = t.grupos.filter((g) => g.clave === LOCALES || (100 * g.votos) / t.listas >= MINIMO_FILA);
    const resto = t.grupos.filter((g) => !propias.includes(g));
    const filas = propias.map((g) => filaResultado({
        sigla: textoSigla(g), color: g.color, nombre: g.clave === LOCALES ? NOMBRE_LOCALES : g.nombre,
        valor: `${fmt.format(g.votos)} votos`, parte: g.votos, total: t.listas,
        pie: (g.clave === LOCALES
            ? `${cantidad(g.distritos, 'distrito', 'distritos')} con alguna · ganan ${fmt.format(g.ganados)}`
            : `Lista propia en ${fmt.format(g.distritos)} de ${fmt.format(t.distritos)} · gana ${fmt.format(g.ganados)}`) +
            (junta ? ` · ${cantidad(g.bancas, 'banca', 'bancas')}` : ''),
    }));
    if (resto.length) {
        const votos = resto.reduce((s, g) => s + g.votos, 0);
        const bancas = resto.reduce((s, g) => s + g.bancas, 0);
        filas.push(filaResultado({ sigla: '+', color: colores.otro, nombre: `Otros ${resto.length} partidos`, valor: `${fmt.format(votos)} votos`,
            parte: votos, total: t.listas, pie: `${resto.map((g) => g.sigla).join(', ')}${junta ? ` · ${cantidad(bancas, 'banca', 'bancas')}` : ''}` }));
    }
    $('listaResultados').replaceChildren(...filas);
    renderParticipacion(t.emitidos, t.electores);
    $('diferencia').replaceChildren();
    renderOtros(t);
    const plra = t.grupos.find((g) => g.sigla === 'PLRA');
    const soloIntendencia = CARGOS[estado.cargo].clave === 'intendencia' ? ' y las listas solo de Intendencia' : '';
    $('notaResultados').textContent = `Votos ${CARGOS[estado.cargo].de} sumados por partido en ${pais ? 'los distritos del país' : `los distritos de ${nombreDep(estado.departamento)}`}. ` +
        `Las alianzas y los movimientos locales${contexto.eleccion.id === 'municipales' ? ' (cada uno de un solo distrito)' : ''}${soloIntendencia} van juntos, en verde. ` +
        (plra ? `Un partido puede ir dentro de una alianza donde no presenta lista propia: el PLRA la presenta en ${fmt.format(plra.distritos)} de ${fmt.format(t.distritos)} distritos. ` : '') +
        'Porcentajes sobre los votos a listas.' + textoFueraDelMapa();
}

// Los votos que no están en el mapa (ADR-042): los del exterior (generales 2013-2023) y los de las unidades electorales de
// 1996-1998 que no son un distrito actual; se dicen en la nota del país, no se suman a ningún distrito. Las gobernaciones
// de las complementarias (2012 y 2023), que el TSJE da solo por departamento, se dicen en el país y en su departamento.
function textoFueraDelMapa() {
    const fuera = indice.fuera_del_mapa ?? {};
    const departamentales = (fuera.departamentales ?? []).filter((x) => estado.departamento === null || x.dep === estado.departamento)
        .flatMap((x) => Object.values(x.cargos).map((c) => {
            const primeras = Object.entries(c.votos).sort((a, b) => b[1] - a[1]).slice(0, 2);
            return ` Además, la elección de ${c.nombre} de ${x.departamento_nombre} del ${fechaLarga(x.fecha)}, con resultados solo por ` +
                `departamento: ${primeras.map(([s, v]) => `${s} ${fmt.format(v)} votos (${pct.format((100 * v) / c.votos_listas)} %)`).join(', ')}.`;
        })).join('');
    if (estado.departamento !== null) return departamentales;
    const votos = (lista) => lista.reduce((s, x) => s + (x.cargos?.[estado.cargo]?.votos_listas ?? 0), 0);
    const exterior = votos(fuera.exterior ?? []);
    const sinDistrito = votos(fuera.sin_distrito ?? []);
    return (exterior ? ` Fuera del mapa: ${fmt.format(exterior)} votos a listas del exterior (${(fuera.exterior ?? []).map((x) => x.pais).join(', ')}).` : '') +
        (sinDistrito ? ` Fuera del mapa: ${fmt.format(sinDistrito)} votos a listas de ${cantidad((fuera.sin_distrito ?? []).length, 'unidad electoral', 'unidades electorales')} ` +
                       'de entonces que no son un distrito actual (Fuente).' : '') + departamentales;
}

function renderDistrito(d) {
    const junta = conBancasDeDistrito(estado.cargo);
    const uninominal = CARGOS[estado.cargo].tipo === 'uninominal';
    $('eyebrowTotales').textContent = `Distrito · ${d.departamento_nombre} · ${CARGOS[estado.cargo].nombre}`;
    $('tituloTotales').textContent = d.nombre;
    $('metaTotales').textContent = (porMesa() ? `${fmt.format(d.mesas.con_acta)} de ${fmt.format(d.mesas.esperadas)} mesas con acta · ${cantidad(d.locales, 'local', 'locales')}`
        : `${d.fecha ? `Elección del ${fechaLarga(d.fecha)}` : 'Resultados por distrito'}`) +
        (junta ? ` · ${cantidad(d.bancas.total, 'banca', 'bancas')}` : ` · ${cantidad(Object.keys(d.votos).length, uninominal ? 'candidatura' : 'lista', uninominal ? 'candidaturas' : 'listas')}`);
    const abrir = $('abrirDistrito');
    abrir.hidden = !tableroDisponible(d.clave);
    abrir.href = enlaceTablero(d.clave);
    abrir.textContent = d.clave === ASUNCION ? 'Abrir Asunción mesa por mesa' : `Abrir el tablero de ${d.nombre}`;
    $('limpiarSeleccion').hidden = false;
    $('limpiarSeleccion').textContent = estado.departamento === null ? 'Ver todo el país' : `Ver ${nombreDep(estado.departamento)}`;
    $('ganados').hidden = true;
    const orden = Object.keys(d.votos).sort((a, b) => d.votos[b] - d.votos[a]);
    const deLista = (x) => (x.numLista ? `Lista ${x.numLista}` : x.nombre);
    $('listaResultados').replaceChildren(...orden.map((s) => {
        const x = d.listas[s];
        // Los cargos uninominales (Intendencia, Presidencia, Gobernación): el nombre de la candidatura y, al pie, su lista; la
        // Junta: la lista y sus bancas; los demás plurinominales: la lista.
        return filaResultado({ sigla: s.slice(0, 5), color: x.color, nombre: uninominal ? x.candidato ?? x.nombre : x.nombre, valor: `${fmt.format(d.votos[s])} votos`,
            parte: d.votos[s], total: d.votos_listas,
            pie: junta ? `${deLista(x)} · ${cantidad(d.bancas.reparto[s] ?? 0, 'banca', 'bancas')}`
                : uninominal ? `${x.nombre}${x.numLista ? ` · lista ${x.numLista}` : ''}` : x.numLista ? `Lista ${x.numLista}` : '' });
    }));
    renderParticipacion(d.emitidos, d.electores.en_mesas_con_acta);
    const dif = $('diferencia');
    dif.replaceChildren();
    if (d.ganadora === EMPATE) {
        dif.append(el('span', 'diferencia__titulo', 'Diferencia entre las dos más votadas'), el('strong', 'diferencia__valor', 'Empate en el primer lugar'));
    } else if (d.segunda) {
        const votos = d.votos[d.ganadora] - d.votos[d.segunda];
        dif.append(el('span', 'diferencia__titulo', 'Diferencia entre las dos más votadas'),
            el('strong', 'diferencia__valor', `${fmt.format(votos)} votos · ${pct.format(d.ventaja)} puntos`),
            el('span', 'diferencia__detalle', `${d.ganadora} sobre ${d.segunda}. Porcentajes sobre ${fmt.format(d.votos_listas)} votos a listas.`));
    }
    renderOtros({ listas: d.votos_listas, blancos: d.blancos, nulos: d.nulos, nocomputados: d.nocomputados, emitidos: d.emitidos,
                  electores: d.electores.en_mesas_con_acta });
    const faltan = porMesa() ? d.mesas.esperadas - d.mesas.con_acta : 0;
    $('notaResultados').textContent = (faltan > 0 ? `Falta el acta de ${cantidad(faltan, 'mesa', 'mesas')}. ` : '') +
        (!porMesa() ? `Resultados ${CARGOS[estado.cargo].de} del distrito según ${CARGOS[estado.cargo].planilla} (el TSJE no publica las mesas de esta elección).`
            : d.clave === ASUNCION ? 'Asunción tiene además los resultados por mesa, local, barrio y zona en su tablero.'
                : `Resultados ${CARGOS[estado.cargo].de} del distrito según ${CARGOS[estado.cargo].planilla}; mesa por mesa, en su tablero.`) +
        (d.nombre_tsje && contexto.anio.geometria && normalizar(d.nombre_tsje).replace(/[^a-z0-9]/g, '') !== normalizar(d.nombre).replace(/[^a-z0-9]/g, '')
            ? ` En esta elección, el TSJE lo llama ${d.nombre_tsje}.` : '') +
        (d.abarca ? ` En ${contexto.anio.anio}, ${d.nombre} abarcaba también lo que hoy son ${otrosDeHoy(d)}: el mapa muestra el distrito de entonces.` : '') +
        (estado.capa === 'ipm' && ipm ? ` ${textoIpmDistrito(d)}` : '');
}

// El IPM del distrito (total del distrito), en la nota de sus resultados.
function textoIpmDistrito(d) {
    if (d.clave === ASUNCION) return 'Pobreza multidimensional: el INE la publica por barrio para Asunción (capa del IPM en su tablero).';
    if (d.abarca) return 'Pobreza multidimensional: el IPM del INE (Censo 2022) es de los distritos de hoy, y este abarcaba varios.';
    const valor = (k) => {
        const v = ipmDe(d, k, 'total');
        return v === null ? 'sin dato' : `${formatoIpm(k).format(v)} %`;
    };
    return `Pobreza multidimensional (INE, Censo 2022), total del distrito: incidencia ${valor('H')}, intensidad ${valor('A')} e IPM ${valor('IPM')}.`;
}

// --- Panel: bancas --------------------------------------------------------------------------------------------------

// El cargo de las bancas (ADR-042): la Junta Municipal en las municipales (sea cual sea el cargo de la barra); en las
// generales, el cargo de la barra si reparte bancas (Senado y Parlasur en el país, Diputados y Junta departamental en cada
// departamento) o, con un cargo uninominal, el primero que las reparte. null: la elección no tiene bancas que mostrar.
function cargoDeBancas() {
    const delDistrito = Object.keys(CARGOS).find((c) => conBancasDeDistrito(c) && porCargo[c]);
    if (delDistrito) return delDistrito;
    if (CARGOS[estado.cargo]?.bancas && porCargo[estado.cargo]) return estado.cargo;
    return Object.keys(CARGOS).find((c) => CARGOS[c].bancas && porCargo[c]) ?? null;
}

// Las personas electas (electos.json, ADR-042): se leen la primera vez que se muestran; solo nombres (el sexo y la edad
// van sumados en el archivo).
let electos = null;
let electosEnCurso = null;
function cargarElectos() {
    electosEnCurso ??= archivoNacional(contexto.eleccion.id, contexto.anio.anio, 'electos.json').then((datos) => {
        const i = Object.fromEntries(datos.campos.map((c, k) => [c, k]));
        electos = { ...datos, filas: datos.filas.map((f) => Object.fromEntries(Object.entries(i).map(([c, k]) => [c, f[k]]))) };
        renderBancas();
        return true;
    }, (error) => { console.warn(error); return false; });
    return electosEnCurso;
}
const conElectos = () => Boolean(contexto.anio.geometria);
// Los nombres de las personas electas titulares de un cargo en un ámbito, por sigla, en su orden.
function electosDe(cargo, ambito, clave) {
    const porSigla = new Map();
    for (const e of electos?.filas ?? []) {
        if (e.cargo !== cargo || !e.titular || e.ambito !== ambito || (e.clave ?? null) !== (clave ?? null)) continue;
        if (!porSigla.has(e.sigla)) porSigla.set(e.sigla, []);
        porSigla.get(e.sigla).push(e);
    }
    for (const lista of porSigla.values()) lista.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    return porSigla;
}
// Bajo la lista de bancas: las personas electas de cada lista (como en el tablero de un distrito).
function listarElectos(porSigla, orden, color) {
    const nodos = [];
    for (const sigla of orden) {
        const personas = porSigla.get(sigla) ?? [];
        if (!personas.length) continue;
        const grupo = el('div', 'bancas__lista');
        const encabezado = el('h3', null, `${sigla} · ${cantidad(personas.length, 'banca', 'bancas')}`);
        encabezado.style.borderColor = color(sigla);
        const ol = el('ol');
        for (const e of personas) ol.append(el('li', null, e.votos_preferentes ? `${e.persona} (${fmt.format(e.votos_preferentes)} preferenciales)` : e.persona ?? 'Sin nombre en la fuente'));
        grupo.append(encabezado, ol);
        nodos.push(grupo);
    }
    return nodos;
}

function renderBancas() {
    const c = cargoDeBancas();
    if (c === null) {
        $('eyebrowBancas').textContent = 'Bancas';
        $('tituloBancas').textContent = 'Esta elección no reparte bancas por lista';
        $('metaBancas').textContent = '';
        $('barraBancas').replaceChildren();
        $('listaBancas').replaceChildren();
        $('notaBancas').textContent = 'Las cifras de esta elección van por lista en la pestaña Resultados.';
        return;
    }
    if (!conBancasDeDistrito(c)) {
        renderBancasFueraDelDistrito(c);
        return;
    }
    if (conElectos() && !electos) cargarElectos();
    const J = porCargo[c];
    const d = estado.elegido ? J.porClave.get(estado.elegido) : null;
    const nota = (fuente === 'trep'
        ? 'Integración oficial de cada Junta Municipal según el TREP; el D\'Hondt sobre los votos por lista da el mismo reparto en los '
        : 'Integración oficial de cada Junta Municipal según el TSJE (archivo de electos D\'Hondt) en los ') + `${fmt.format(J.distritos.length)} distritos.`;
    if (d) {
        const orden = Object.keys(d.bancas.reparto).sort((a, b) => d.bancas.reparto[b] - d.bancas.reparto[a] || d.votos[b] - d.votos[a]);
        $('eyebrowBancas').textContent = `Distrito · ${d.departamento_nombre}`;
        $('tituloBancas').textContent = `Bancas de la Junta Municipal de ${d.nombre}`;
        $('metaBancas').textContent = `${cantidad(d.bancas.total, 'banca', 'bancas')} · mayoría con ${fmt.format(Math.floor(d.bancas.total / 2) + 1)}`;
        apilada($('barraBancas'), 'Reparto', orden.map((s) => ({ clave: s, texto: s, color: d.listas[s].color, n: d.bancas.reparto[s] })), d.bancas.total,
            ['banca', 'bancas']);
        const color = (s) => d.listas[s]?.color ?? colores.otro;
        $('listaBancas').replaceChildren(...orden.map((s) => filaResultado({ sigla: s.slice(0, 5), color: color(s), nombre: d.listas[s]?.nombre ?? s,
            valor: cantidad(d.bancas.reparto[s], 'banca', 'bancas'), parte: d.bancas.reparto[s], total: d.bancas.total,
            pie: d.votos[s] === undefined ? '' : `${fmt.format(d.votos[s])} votos (${pct.format(pctDe(d, s))} %)` })),
            ...(electos ? listarElectos(electosDe(c, 'distrito', d.clave), orden, color) : []));
        $('notaBancas').textContent = nota + (electos ? ' Debajo, las personas electas titulares según el TSJE.' : '');
        return;
    }
    const t = agregar(J.distritos.filter(enFiltro), c);
    const pais = estado.departamento === null;
    const conBancas = t.grupos.filter((g) => g.bancas).sort((a, b) => b.bancas - a.bancas);
    $('eyebrowBancas').textContent = pais ? 'Todo el país · reparto oficial' : `${nombreDep(estado.departamento)} · reparto oficial`;
    $('tituloBancas').textContent = 'Bancas de las juntas municipales';
    $('metaBancas').textContent = `${fmt.format(t.bancas)} bancas en ${cantidad(t.distritos, 'junta', 'juntas')}`;
    apilada($('barraBancas'), 'Reparto', conBancas.map((g) => ({ clave: g.clave, texto: g.clave === LOCALES ? NOMBRE_LOCALES : g.sigla, color: g.color, n: g.bancas })),
        t.bancas, ['banca', 'bancas']);
    $('listaBancas').replaceChildren(...conBancas.map((g) => filaResultado({ sigla: textoSigla(g), color: g.color,
        nombre: g.clave === LOCALES ? NOMBRE_LOCALES : g.nombre, valor: cantidad(g.bancas, 'banca', 'bancas'), parte: g.bancas, total: t.bancas,
        pie: `En ${cantidad(g.distritos, 'distrito', 'distritos')}` })));
    $('notaBancas').textContent = `${nota} Las alianzas y los movimientos locales van juntos.${pais ? textoSexoElectos(c) : ''}`;
}

// Sexo de las personas electas titulares de un cargo en todo el país, solo sumado (decisión del usuario, ADR-042).
function textoSexoElectos(cargo) {
    const s = electos?.totales?.[cargo]?.titulares?.por_sexo;
    if (!s) return '';
    return ` Titulares electos en todo el país: ${cantidad(s.mujeres ?? 0, 'mujer', 'mujeres')} y ${cantidad(s.hombres ?? 0, 'hombre', 'hombres')}` +
        `${s.sin_dato ? ` (${fmt.format(s.sin_dato)} sin dato)` : ''}, según el TSJE.`;
}

// Las bancas que se reparten en el país (Senado y Parlasur) o en cada departamento (Diputados y Junta departamental), según
// el TSJE (electos D'Hondt, ADR-042): en el país, las del país o la suma de los departamentos; con un departamento o un
// distrito elegido, las de su departamento, con los nombres de las personas electas titulares.
function renderBancasFueraDelDistrito(c) {
    if (conElectos() && !electos) cargarElectos();
    const info = CARGOS[c];
    const elegido = estado.elegido ? porCargo[c].porClave.get(estado.elegido) : null;
    const dep = info.bancas === 'departamento' ? elegido?.departamento ?? estado.departamento : null;
    const b = dep === null ? indice.bancas?.[c] : porDep.get(dep)?.bancas?.[c];
    const datosDe = new Map();
    for (const d of porCargo[c].distritos) for (const [s, x] of Object.entries(d.listas)) if (!datosDe.has(s)) datosDe.set(s, x);
    const color = (s) => (datosDe.get(s)?.tipo === 'partido' ? colores.partidos?.[s] ?? datosDe.get(s).color : datosDe.has(s) ? colores.verdes[0] : colores.otro);
    $('eyebrowBancas').textContent = `${dep === null ? 'Todo el país' : nombreDep(dep)} · reparto oficial`;
    $('tituloBancas').textContent = `Bancas ${info.de}`;
    if (!b) {
        $('metaBancas').textContent = '';
        $('barraBancas').replaceChildren();
        $('listaBancas').replaceChildren();
        $('notaBancas').textContent = `El archivo de electos del TSJE no trae las bancas ${info.de} ${dep === null ? 'de esta elección' : `de ${nombreDep(dep)}`}.`;
        return;
    }
    const orden = Object.keys(b.reparto).sort((x, y) => b.reparto[y] - b.reparto[x] || x.localeCompare(y));
    const departamentos = indice.departamentos.filter((x) => x.bancas?.[c]).length;
    $('metaBancas').textContent = `${cantidad(b.total, 'banca', 'bancas')}${info.bancas === 'departamento' && dep === null ? ` en ${cantidad(departamentos, 'departamento', 'departamentos')}` : ''} · mayoría con ` +
        `${fmt.format(Math.floor(b.total / 2) + 1)}`;
    apilada($('barraBancas'), 'Reparto', orden.map((s) => ({ clave: s, texto: s, color: color(s), n: b.reparto[s] })), b.total, ['banca', 'bancas']);
    const filas = orden.map((s) => filaResultado({ sigla: s.slice(0, 5), color: color(s), nombre: datosDe.get(s)?.nombre ?? s,
        valor: cantidad(b.reparto[s], 'banca', 'bancas'), parte: b.reparto[s], total: b.total, pie: '' }));
    const conNombres = electos && (info.bancas === 'nacional' || dep !== null);
    const personas = conNombres ? electosDe(c, info.bancas === 'nacional' ? 'nacional' : 'departamento', info.bancas === 'nacional' ? null : String(dep)) : null;
    $('listaBancas').replaceChildren(...filas, ...(personas ? listarElectos(personas, orden, color) : []));
    $('notaBancas').textContent = `Integración oficial ${info.de} según el TSJE (archivo de electos D'Hondt)` +
        (info.bancas === 'departamento' ? '; cada departamento reparte las suyas.' : '.') +
        (info.bancas === 'departamento' && dep === null ? ' Elegí un departamento para ver sus bancas y las personas electas.' : conNombres ? ' Debajo, las personas electas titulares.' : '') +
        (dep === null ? textoSexoElectos(c) : '');
}

// --- Panel: filtros (departamento, distrito y búsqueda) --------------------------------------------------------------

function renderFiltros() {
    const sDep = $('filtroDepartamento');
    if (!sDep.options.length) {
        sDep.append(new Option('Todo el país', ''));
        for (const d of indice.departamentos) sDep.append(new Option(`${d.nombre} (${d.distritos})`, String(d.codigo)));
    }
    sDep.value = estado.departamento === null ? '' : String(estado.departamento);
    const sDis = $('filtroDistrito');
    if (opcionesFiltro !== estado.departamento || !sDis.options.length) {
        opcionesFiltro = estado.departamento;
        sDis.replaceChildren(new Option('Ningún distrito elegido', ''));
        const deps = estado.departamento === null ? indice.departamentos : [porDep.get(estado.departamento)];
        for (const dep of deps) {
            const delDep = distritos.filter((d) => d.departamento === dep.codigo).sort((a, b) => colador.compare(a.nombre, b.nombre));
            const destino = deps.length > 1 ? Object.assign(document.createElement('optgroup'), { label: dep.nombre }) : sDis;
            for (const d of delDep) destino.append(new Option(d.nombre, d.clave));
            if (destino !== sDis) sDis.append(destino);
        }
    }
    sDis.value = estado.elegido ?? '';
}

let sugerencias = [];
let activa = -1;

function buscar(texto) {
    const q = normalizar(texto.trim());
    if (!q) return [];
    const empiezan = [], contienen = [];
    for (const d of distritos) {
        const n = normalizar(d.nombre);
        if (n.startsWith(q) || n.split(/\s+/).some((p) => p.startsWith(q))) empiezan.push(d);
        else if (n.includes(q) || normalizar(d.departamento_nombre).startsWith(q)) contienen.push(d);
    }
    const orden = (a, b) => colador.compare(a.nombre, b.nombre);
    return [...empiezan.sort(orden), ...contienen.sort(orden)].slice(0, 8);
}

function mostrarSugerencias() {
    const caja = $('sugerenciasDistrito');
    const entrada = $('buscarDistrito');
    caja.replaceChildren(...sugerencias.map((d, k) => {
        const li = el('li', 'sugerencias__item');
        li.id = `sugerencia-distrito-${k}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(k === activa));
        li.dataset.clave = d.clave;
        li.append(el('span', 'sugerencias__nombre', d.nombre), el('span', 'sugerencias__detalle', d.departamento_nombre));
        return li;
    }));
    const abierta = sugerencias.length > 0;
    caja.hidden = !abierta;
    entrada.setAttribute('aria-expanded', String(abierta));
    if (activa >= 0) entrada.setAttribute('aria-activedescendant', `sugerencia-distrito-${activa}`);
    else entrada.removeAttribute('aria-activedescendant');
    $('estadoBusqueda').textContent = entrada.value.trim() ? (sugerencias.length ? `${cantidad(sugerencias.length, 'distrito encontrado', 'distritos encontrados')}` : 'Ningún distrito encontrado') : '';
}

function cerrarSugerencias() {
    sugerencias = [];
    activa = -1;
    mostrarSugerencias();
}

// El distrito elegido en la búsqueda muestra sus resultados (en tablet vertical, como en el tablero, el cajón se cierra para
// ver el mapa).
function elegirSugerencia(clave) {
    $('buscarDistrito').value = '';
    cerrarSugerencias();
    $('estadoBusqueda').textContent = `Elegido: ${porClave.get(clave).nombre}`;
    panel.elegir('resultados', { altura: panel.celular() ? 'medio' : null });
    if (panel.cajon()) panel.abrir(false);
    estado.panel = panel.panel();
    elegirDistrito(clave, { enfocar: true });
}

// --- Panel: capas ---------------------------------------------------------------------------------------------------

function renderCapas() {
    for (const radio of document.querySelectorAll('input[name="mapa"]')) radio.checked = radio.value === estado.capa;
    $('detallePartido').hidden = estado.capa !== 'partido';
    $('detalleIpm').hidden = estado.capa !== 'ipm';
    for (const boton of document.querySelectorAll('[data-ipm]')) boton.setAttribute('aria-pressed', String(boton.dataset.ipm === estado.ipm));
    for (const boton of document.querySelectorAll('[data-area]')) boton.setAttribute('aria-pressed', String(boton.dataset.area === estado.area));
    // Los gráficos del IPM por distrito en Análisis (ADR-023), con el componente, el área y el departamento elegidos.
    const analisis = new URLSearchParams({ eleccion: contexto.eleccion.id, anio: String(contexto.anio.anio), cargo: CARGOS[estado.cargo].clave, ambito: 'pais',
                                           analisis: 'participacion-ipm' });
    if (estado.departamento !== null) analisis.set('departamento', String(estado.departamento));
    if (estado.ipm !== 'H') analisis.set('ipm', estado.ipm);
    if (estado.area !== 'total') analisis.set('area', estado.area);
    $('enlaceAnalisisIpm').href = `../analisis/#${analisis}`;
    const sPartido = $('capaPartido');
    if (opcionesPartido !== estado.cargo) {
        opcionesPartido = estado.cargo;
        sPartido.replaceChildren();
        for (const p of [...partidos.values()].sort((a, b) => b.distritos - a.distritos || colador.compare(a.sigla, b.sigla))) {
            sPartido.append(new Option(`${p.sigla} · lista propia en ${cantidad(p.distritos, 'distrito', 'distritos')}`, p.sigla));
        }
    }
    if (!partidos.has(estado.partido)) estado.partido = partidos.has('ANR') ? 'ANR' : [...partidos.keys()][0];
    sPartido.value = estado.partido;
    $('opacidadCapa').value = String(estado.opacidad);
    $('valorOpacidad').textContent = `${fmt.format(estado.opacidad)} %`;
    for (const casilla of document.querySelectorAll('input[name="ver"]')) casilla.checked = Boolean(estado.ver[casilla.value]);
}

// --- Mapa y leyenda -------------------------------------------------------------------------------------------------

// Muestra de la leyenda del relleno: con la opacidad elegida, como se ve en el mapa.
function itemRelleno(color, texto, extra = 'leyenda__muestra--escala') {
    const li = itemLeyenda(color, texto, extra);
    if (color) li.firstChild.style.opacity = String(Math.max(0.12, opacidad()));
    return li;
}

// Pinta los distritos de la elección con fn y, en gris, los que no tienen resultados en ella (ADR-042: los creados
// después, los que no tuvieron elección complementaria ese año o no tienen mesas del Consejo); devuelve cuántos son.
let todas = [];              // Las claves de la geometría (los 263 distritos actuales).
let nombreGeo = new Map();   // Su nombre, para los que no tienen resultados.
let abarcanGeo = 0;          // Los distritos de entonces que abarcaban varios de hoy (ADR-043), con o sin resultados.
function pintar(fn) {
    const gris = paleta().sinDatos;
    let sin = 0;
    mapa.pintar(todas.length ? todas : claves, (clave) => {
        if (porClave.has(clave)) return fn(clave);
        sin += 1;
        return { color: gris, atenuado: false };
    });
    return sin;
}
const textoSinResultados = () => ({ complementarias: `Sin elección complementaria en ${contexto.anio.anio}`, 'consejo-magistratura': 'Sin mesas de esta elección' }[contexto.eleccion.id]
    ?? `Sin resultados ${CARGOS[estado.cargo].de} en ${contexto.anio.anio}`);
// Por qué un distrito del mapa no tiene resultados del cargo: no lo elige (Asunción no elige Gobernador) o existía y no votó
// en esa elección (ADR-043: los demás distritos de hoy van dentro del distrito de entonces).
function motivoSinResultados(clave) {
    const sin = (indice?.sin_resultados ?? []).find((x) => x.clave === clave);
    if (sin) return sin.motivo;
    if (indice?.distritos?.some((d) => d.clave === clave && d.cargos && Object.keys(d.cargos).length)) return `no elige ${CARGOS[estado.cargo].nombre.toLowerCase()}.`;
    return null;
}
function itemSinResultados(leyenda, sin) {
    if (sin) leyenda.append(itemRelleno(paleta().sinDatos, `${textoSinResultados()}: ${cantidad(sin, 'distrito', 'distritos')}`));
}

function pintarGanadora(leyenda) {
    const conteo = new Map();
    const sin = pintar((clave) => {
        const d = porClave.get(clave);
        if (enFiltro(d)) {
            const g = grupoDe(d.gana, d.ganadora);
            const c = conteo.get(g) ?? { n: 0, color: g === LOCALES ? colores.verdes[0] : d.gana.color,
                                         texto: g === LOCALES ? LOCAL_EN_LEYENDA : g === EMPATE ? 'Empate en el primer lugar' : `${d.ganadora} más votada` };
            c.n += 1;
            conteo.set(g, c);
        }
        return { color: d.gana.color, atenuado: !enFiltro(d) };
    });
    for (const c of [...conteo.values()].sort((a, b) => b.n - a.n)) leyenda.append(itemRelleno(c.color, `${c.texto}: ${cantidad(c.n, 'distrito', 'distritos')}`));
    itemSinResultados(leyenda, sin);
    $('notaCapa').textContent = `Cada distrito, con el color de la lista más votada ${CARGOS[estado.cargo].de}: los partidos con su color y las alianzas y los ` +
        `movimientos locales${CARGOS[estado.cargo].clave === 'intendencia' ? ' (y las listas solo de Intendencia)' : ''} en verde (tonos distintos si un distrito tiene más de ` +
        'uno). Tocá un distrito para ver sus cifras.';
}

function pintarParticipacion(leyenda) {
    const valores = visibles().map(participacionDe).filter((v) => v !== null);
    const { cortes, clase } = escala(valores.length ? valores : [0]);
    const paso = (v) => Math.max(0, Math.min(4, clase(v)));
    const sin = pintar((clave) => {
        const d = porClave.get(clave);
        const v = participacionDe(d);
        return { color: v === null ? null : mezclar(PARTICIPACION_COLOR, opacidadPaso(paso(v))), atenuado: !enFiltro(d) };
    });
    if (valores.length) {
        for (let k = 0; k < cortes.length - 1; k++) leyenda.append(itemRelleno(mezclar(PARTICIPACION_COLOR, opacidadPaso(k)), `${pct.format(cortes[k])} a ${pct.format(cortes[k + 1])} %`));
    }
    itemSinResultados(leyenda, sin);
    $('notaCapa').textContent = (porMesa() && fuente === 'trep'
        ? 'Votos emitidos sobre electores habilitados de las mesas con acta (recuento agregado del padrón por mesa), por distrito, en '
        : 'Votos emitidos sobre electores habilitados (padrón del TSJE), por distrito, en ') +
        'cinco tramos de igual ancho entre el menor y el mayor de los distritos a la vista. Tocá un distrito para ver sus cifras.' +
        (valores.length ? '' : ' Esta elección no tiene electores por distrito.');
}

function pintarVentaja(leyenda) {
    const conteo = new Map();
    const sin = pintar((clave) => {
        const d = porClave.get(clave);
        const k = tramo(d.ventaja ?? 0);
        if (enFiltro(d)) {
            const g = grupoDe(d.gana, d.ganadora);
            const c = conteo.get(`${g}|${k}`) ?? { g, k, n: 0, color: g === LOCALES ? colores.verdes[0] : d.gana.color,
                                                    sigla: g === LOCALES ? LOCAL_EN_LEYENDA : g === EMPATE ? 'Empate' : d.ganadora };
            c.n += 1;
            conteo.set(`${g}|${k}`, c);
        }
        return { color: mezclar(d.gana.color, opacidadPaso(k, 3)), atenuado: !enFiltro(d) };
    });
    const total = new Map();
    for (const c of conteo.values()) total.set(c.g, (total.get(c.g) ?? 0) + c.n);
    for (const c of [...conteo.values()].sort((a, b) => total.get(b.g) - total.get(a.g) || b.k - a.k)) {
        leyenda.append(itemRelleno(mezclar(c.color, opacidadPaso(c.k, 3)), c.g === EMPATE ? `Empate en el primer lugar: ${cantidad(c.n, 'distrito', 'distritos')}`
            : `${c.sigla} primera ${TEXTO_TRAMO[c.k]}: ${cantidad(c.n, 'distrito', 'distritos')}`));
    }
    itemSinResultados(leyenda, sin);
    $('notaCapa').textContent = `Ventaja = 100 × (votos del primero − votos del segundo) / votos a listas ${CARGOS[estado.cargo].de}, en puntos. Color de la lista que va primera ` +
        'en cada distrito, más intenso cuanto mayor la ventaja: menos de 10, de 10 a 25 y 25 puntos o más.';
}

function pintarPartido(leyenda) {
    const p = partidos.get(estado.partido);
    const valores = visibles().map((d) => pctDe(d, p.sigla)).filter((v) => v !== null);
    const { cortes, clase } = escala(valores.length ? valores : [0]);
    const paso = (v) => Math.max(0, Math.min(4, clase(v)));
    const gris = paleta().sinDatos;
    let sin = 0;
    const sinResultados = pintar((clave) => {
        const d = porClave.get(clave);
        const v = pctDe(d, p.sigla);
        if (v === null && enFiltro(d)) sin += 1;
        return { color: v === null ? gris : mezclar(p.color, opacidadPaso(paso(v))), atenuado: !enFiltro(d) };
    });
    if (valores.length) {
        for (let k = 0; k < cortes.length - 1; k++) leyenda.append(itemRelleno(mezclar(p.color, opacidadPaso(k)), `${pct.format(cortes[k])} a ${pct.format(cortes[k + 1])} %`));
    }
    if (sin) leyenda.append(itemRelleno(gris, `Sin lista propia de ${p.sigla}: ${cantidad(sin, 'distrito', 'distritos')}`));
    itemSinResultados(leyenda, sinResultados);
    $('notaCapa').textContent = `Votos de ${p.sigla} (${p.nombre}) sobre los votos a listas ${CARGOS[estado.cargo].de} de cada distrito, en cinco tramos de igual ancho. ` +
        'En gris, los distritos donde no presentó lista propia (puede ir dentro de una alianza).';
}

// IPM por distrito (INE, Censo 2022), en quintiles de los distritos a la vista; sin dato, en gris.
function pintarIpm(leyenda) {
    if (!ipm) {
        pintar((clave) => ({ color: paleta().sinDatos, atenuado: !enFiltro(porClave.get(clave)) }));
        if (ipmFallo) $('notaCapa').textContent = 'No fue posible leer la pobreza multidimensional por distrito. Revisá la conexión o el servidor local.';
        else {
            $('notaCapa').textContent = 'Cargando la pobreza multidimensional por distrito…';
            cargarIpm().then(() => renderTodo());
        }
        return;
    }
    const ind = indicadorIpm();
    const formato = formatoIpm();
    const valores = visibles().map((d) => ipmDe(d)).filter((v) => v !== null);
    const { cortes, clase } = cuantiles(valores.length ? valores : [0]);
    const conteo = new Array(5).fill(0);
    const gris = paleta().sinDatos;
    let sin = 0;
    const sinResultados = pintar((clave) => {
        const d = porClave.get(clave);
        const v = ipmDe(d);
        if (v === null) {
            if (enFiltro(d)) sin += 1;
            return { color: gris, atenuado: !enFiltro(d) };
        }
        const k = clase(v);
        if (enFiltro(d)) conteo[k] += 1;
        return { color: mezclar(IPM_COLOR, opacidadPaso(k)), atenuado: !enFiltro(d) };
    });
    if (valores.length) {
        for (let k = 0; k < 5; k++) {
            leyenda.append(itemRelleno(mezclar(IPM_COLOR, opacidadPaso(k)), `${formato.format(cortes[k])} a ${formato.format(cortes[k + 1])} % · ${cantidad(conteo[k], 'distrito', 'distritos')}`));
        }
    }
    if (sin) leyenda.append(itemRelleno(gris, `Sin dato: ${cantidad(sin, 'distrito', 'distritos')}`));
    itemSinResultados(leyenda, sinResultados);
    $('notaCapa').textContent = `${ind.nombre}${EN_AREA[estado.area]}: ${ind.descripcion} Distritos en quintiles: cinco grupos con casi la misma ` +
        'cantidad de distritos a la vista (INE, Censo 2022). En gris, sin dato: Asunción (el INE publica su IPM por barrio, en su tablero)' +
        (estado.area === 'rural' ? ' y los distritos sin población rural' : '') + '. Es una comparación entre agregados: no muestra cómo votaron las ' +
        'personas en situación de pobreza ni ningún otro grupo.' + (contexto.anio.geometria ? ` El IPM es del Censo 2022; los votos, de ${contexto.anio.anio}.` : '');
}

const PINTORES = { ganadora: pintarGanadora, participacion: pintarParticipacion, ventaja: pintarVentaja, partido: pintarPartido, ipm: pintarIpm };

function renderMapa() {
    if (!mapa) return;
    mapa.fijarOpacidad(opacidad());
    mapa.fijarElementos(estado.ver);
    const leyenda = $('leyenda');
    leyenda.replaceChildren();
    $('tituloLeyenda').textContent = estado.capa === 'partido' ? `Votos de ${estado.partido} por distrito`
        : estado.capa === 'ipm' && ipm ? `${indicadorIpm().nombre} por distrito${EN_AREA[estado.area]}` : tituloCapa(estado.capa);
    PINTORES[estado.capa](leyenda);
    if (estado.departamento !== null) leyenda.append(el('li', 'leyenda__nota', `Fuera de ${nombreDep(estado.departamento)}, atenuados.`));
    if (abarcanGeo) leyenda.append(el('li', 'leyenda__nota', `Los ${fmt.format(todas.length)} distritos de ${contexto.anio.anio}: ` +
        `${cantidad(abarcanGeo, 'abarcaba', 'abarcaban')} lo que hoy son varios.`));
    leyenda.append(el('li', 'leyenda__nota', `Relleno al ${fmt.format(estado.opacidad)} %` +
        `${estado.ver.base ? ', con las rutas, los ríos y los arroyos de OpenStreetMap encima' : ''}.`));
    leyenda.append(itemLeyenda(null, 'Límite de departamento', 'leyenda__muestra--limite'));
    mapa.elegir(estado.elegido);
}

function textoDistrito(clave) {
    const d = porClave.get(clave);
    if (!d) return `${nombreGeo.get(clave) ?? clave}: ${motivoSinResultados(clave) ?? textoSinResultados().toLowerCase()}`;
    const base = `${d.nombre} (${d.departamento_nombre})`;
    if (estado.capa === 'participacion') {
        const v = participacionDe(d);
        return `${base}: participación ${v === null ? '—' : `${pct.format(v)} %`}`;
    }
    if (estado.capa === 'ventaja') return d.segunda ? `${base}: ${d.ganadora} primera, ${pct.format(d.ventaja)} puntos sobre ${d.segunda}` : `${base}: lista única`;
    if (estado.capa === 'partido') {
        const v = pctDe(d, estado.partido);
        return v === null ? `${base}: sin lista propia de ${estado.partido}` : `${base}: ${estado.partido} ${pct.format(v)} %`;
    }
    if (estado.capa === 'ipm' && ipm) {
        const v = ipmDe(d);
        return v === null ? `${base}: ${sinIpm(d)}` : `${base}: ${indicadorIpm().nombre}${EN_AREA[estado.area]} ${formatoIpm().format(v)} %`;
    }
    if (d.ganadora === EMPATE) return `${base}: empate en el primer lugar`;
    return `${base}: ${d.ganadora} ${pct.format(d.pct_ganadora)} %${d.segunda ? ` · ventaja ${pct.format(d.ventaja)} puntos` : ''}`;
}

// Píxeles del mapa tapados por la hoja (celular), la bandeja abierta o el cajón (tablet vertical): el encuadre deja el
// país, el departamento o el distrito en la parte que se ve (como en el tablero de un distrito).
function margenMapa() {
    const lienzo = $('mapa').getBoundingClientRect();
    const tapan = [panel?.celular() ? $('hoja') : null, bandeja?.abierta() ? $('bandeja') : null].filter(Boolean);
    const abajo = Math.max(0, ...tapan.map((n) => lienzo.bottom - n.getBoundingClientRect().top));
    const izquierda = panel?.cajon() && panel.abierto() ? Math.max(0, $('hoja').getBoundingClientRect().right - lienzo.left) : 0;
    const limitar = (v, max) => Math.max(8, Math.min(v, max));
    return { top: limitar(56, lienzo.height / 3), right: limitar(56, lienzo.width / 4), bottom: limitar(abajo + 20, lienzo.height * 0.7),
             left: limitar(izquierda + 20, lienzo.width * 0.7) };
}

// El departamento elegido o el del distrito elegido; si no, el país.
function cajaDelEstado() {
    const dep = estado.departamento ?? (estado.elegido ? porClave.get(estado.elegido).departamento : null);
    return dep === null ? null : porDep.get(dep).caja;
}

// --- Tabla y ranking de distritos -----------------------------------------------------------------------------------

function columnasTabla() {
    const columnas = [{ id: 'nombre', titulo: 'Distrito', texto: true }, { id: 'departamento', titulo: 'Departamento', texto: true },
        { id: 'ganadora', titulo: 'Más votada', texto: true }, { id: 'pct', titulo: '% más votada' }, { id: 'ventaja', titulo: 'Ventaja' },
        { id: 'participacion', titulo: 'Particip.' }];
    if (estado.capa === 'partido') columnas.push({ id: 'partido', titulo: `% ${estado.partido}` });
    if (estado.capa === 'ipm' && ipm) columnas.push({ id: 'ipm', titulo: `${indicadorIpm().nombre}${estado.area === 'total' ? '' : ` ${estado.area}`}` });
    if (porMesa()) columnas.push({ id: 'mesas', titulo: 'Mesas' });
    columnas.push({ id: 'electores', titulo: 'Electores' });
    if (conBancasDeDistrito(estado.cargo)) columnas.push({ id: 'bancas', titulo: 'Bancas' });
    return columnas;
}

function valorTabla(d, id) {
    switch (id) {
        case 'nombre': return d.nombre;
        case 'departamento': return d.departamento_nombre;
        case 'ganadora': return siglaGanadora(d);
        case 'pct': return d.pct_ganadora ?? -Infinity;
        case 'ventaja': return d.ventaja ?? -Infinity;
        case 'participacion': return participacionDe(d) ?? -Infinity;
        case 'partido': return pctDe(d, estado.partido) ?? -Infinity;
        case 'ipm': return ipmDe(d) ?? -Infinity;
        case 'mesas': return d.mesas.con_acta;
        case 'electores': return d.electores.en_mesas_con_acta;
        default: return d.bancas.total;
    }
}

function filasTabla() {
    const filtro = normalizar(estado.filtro.trim());
    let filas = visibles().filter((d) => !filtro || normalizar(`${d.nombre} ${d.departamento_nombre}`).includes(filtro));
    const col = estado.orden && columnasTabla().find((c) => c.id === estado.orden.id);
    filas = filas.sort(col
        ? (a, b) => {
            const va = valorTabla(a, col.id), vb = valorTabla(b, col.id);
            return estado.orden.dir * (typeof va === 'string' ? colador.compare(va, vb) : va - vb) || colador.compare(a.nombre, b.nombre);
        }
        : (a, b) => a.departamento - b.departamento || colador.compare(a.nombre, b.nombre));
    return filas;
}

function renderTabla() {
    const columnas = columnasTabla();
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
    const filas = filasTabla();
    const fragmento = document.createDocumentFragment();
    for (const d of filas) {
        const fila = el('tr');
        if (d.clave === estado.elegido) fila.classList.add('es-seleccion');
        for (const c of columnas) {
            if (c.id === 'nombre') {
                const th = el('th', 'tabla__texto');
                th.scope = 'row';
                const boton = el('button', 'tabla__elegir');
                boton.type = 'button';
                boton.dataset.clave = d.clave;
                boton.append(el('span', 'tabla__nombre', d.nombre));
                th.append(boton);
                fila.append(th);
                continue;
            }
            const td = el('td', c.texto ? 'tabla__texto' : null);
            if (c.id === 'ganadora') {
                const muestra = el('span', 'tabla__muestra');
                muestra.style.background = d.gana.color;
                td.append(muestra, siglaGanadora(d));
            } else if (c.id === 'departamento') td.textContent = d.departamento_nombre;
            else if (c.id === 'pct') td.textContent = d.pct_ganadora === null ? '—' : `${pct.format(d.pct_ganadora)} %`;
            else if (c.id === 'ventaja') td.textContent = d.segunda ? `${pct.format(d.ventaja)}` : 'única';
            else if (c.id === 'participacion') td.textContent = participacionDe(d) === null ? '—' : `${pct.format(participacionDe(d))} %`;
            else if (c.id === 'partido') td.textContent = pctDe(d, estado.partido) === null ? '—' : `${pct.format(pctDe(d, estado.partido))} %`;
            else if (c.id === 'ipm') td.textContent = ipmDe(d) === null ? '—' : `${formatoIpm().format(ipmDe(d))} %`;
            else if (c.id === 'mesas') td.textContent = d.mesas.con_acta === d.mesas.esperadas ? fmt.format(d.mesas.con_acta) : `${fmt.format(d.mesas.con_acta)}/${fmt.format(d.mesas.esperadas)}`;
            else if (c.id === 'electores') td.textContent = fmt.format(d.electores.en_mesas_con_acta);
            else td.textContent = fmt.format(d.bancas.total);
            fila.append(td);
        }
        fragmento.append(fila);
    }
    $('tabla').tBodies[0].replaceChildren(fragmento);
    $('notaTabla').textContent = `${cantidad(filas.length, 'distrito', 'distritos')}${estado.departamento === null ? '' : ` de ${nombreDep(estado.departamento)}`}. ` +
        `Porcentajes y ventaja (en puntos) sobre los votos a listas ${CARGOS[estado.cargo].de}; ` +
        (porMesa() ? 'participación sobre los electores de las mesas con acta. Mesas: con acta / esperadas cuando falta alguna.'
            : 'participación sobre los electores habilitados del padrón del TSJE.') +
        (estado.capa === 'ipm' && ipm ? ` ${indicadorIpm().nombre}${EN_AREA[estado.area]}: INE, Censo 2022 («—», sin dato).` : '') +
        ' Tocá un distrito para verlo en el mapa.';
}

function metricaRanking() {
    const p = partidos.get(estado.partido);
    return {
        ganadora: { titulo: 'Distritos por porcentaje de la lista más votada', valor: (d) => d.pct_ganadora, color: (d) => d.gana.color,
                    texto: (v, d) => `${pct.format(v)} % ${siglaGanadora(d)}` },
        participacion: { titulo: 'Distritos por participación', valor: participacionDe, color: () => PARTICIPACION_COLOR, texto: (v) => `${pct.format(v)} %` },
        ventaja: { titulo: 'Distritos por ventaja del primero', valor: (d) => (d.segunda ? d.ventaja : null), color: (d) => d.gana.color,
                   texto: (v, d) => `${pct.format(v)} pts ${siglaGanadora(d)}` },
        partido: { titulo: `Distritos por votos de ${p.sigla}`, valor: (d) => pctDe(d, p.sigla), color: () => p.color, texto: (v) => `${pct.format(v)} %` },
        ipm: ipm ? { titulo: `Distritos por ${EN_FRASE[estado.ipm]}${EN_AREA[estado.area]}`, valor: (d) => ipmDe(d), color: () => IPM_COLOR,
                     texto: (v) => `${formatoIpm().format(v)} %` }
            : { titulo: 'Distritos por pobreza multidimensional', valor: () => null, color: () => IPM_COLOR, texto: () => '' },
    }[estado.capa];
}

function renderRanking() {
    const m = metricaRanking();
    for (const boton of document.querySelectorAll('[data-orden-ranking]')) boton.setAttribute('aria-pressed', String(boton.dataset.ordenRanking === estado.ordenRanking));
    const dir = estado.ordenRanking === 'asc' ? 1 : -1;
    const filas = visibles().map((d) => ({ d, v: m.valor(d) })).filter((x) => x.v !== null && Number.isFinite(x.v))
        .sort((a, b) => dir * (a.v - b.v) || colador.compare(a.d.nombre, b.d.nombre));
    const maximo = Math.max(1e-9, ...filas.map((x) => Math.abs(x.v)));
    $('tituloRanking').textContent = `${m.titulo} · ${estado.departamento === null ? 'todo el país' : nombreDep(estado.departamento)}`;
    $('ranking').replaceChildren(...filas.map(({ d, v }, k) => {
        const li = el('li');
        const boton = el('button', 'ranking-lista__boton');
        boton.type = 'button';
        boton.dataset.clave = d.clave;
        if (d.clave === estado.elegido) boton.setAttribute('aria-current', 'true');
        const barra = el('span', 'ranking-lista__barra');
        const relleno = el('span', 'ranking-lista__relleno');
        relleno.style.width = `${(100 * Math.abs(v)) / maximo}%`;
        relleno.style.background = m.color(d);
        barra.append(relleno);
        boton.append(el('span', 'ranking-lista__pos', `${k + 1}.`), el('span', 'ranking-lista__nombre', `${d.nombre} · ${d.departamento_nombre}`), barra,
            el('span', 'ranking-lista__valor', m.texto(v, d)));
        li.append(boton);
        return li;
    }));
    $('notaRanking').textContent = `Ordenado según la capa del mapa. ${cantidad(filas.length, 'distrito', 'distritos')}` +
        (estado.capa === 'ipm' && ipm ? ' con dato del INE (Censo 2022); sin Asunción, cuyo IPM es por barrio' : '') + '. Tocá uno para verlo en el mapa.';
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
    const visible = bandeja?.visible();
    if (visible === 'tabla') {
        renderTabla();
        mostrarElegida($('desplazaTabla'), $('tabla').querySelector('tr.es-seleccion'));
    } else if (visible === 'ranking') {
        renderRanking();
        mostrarElegida($('panelRanking'), $('ranking').querySelector('[aria-current="true"]'));
    }
}

// --- Ficha (mapa en pantalla completa) ------------------------------------------------------------------------------

const pantallaCompleta = () => $('mapa').classList.contains('mapa--pantalla');

// La ficha (ficha.js) se carga la primera vez que se toca un distrito con el mapa en pantalla completa.
async function abrirFicha(d) {
    if (!ficha) {
        const { crearFicha } = await import('./ficha.js');
        ficha ??= crearFicha();
    }
    const cuerpo = el('ul', 'ficha__listas');
    for (const s of Object.keys(d.votos).sort((a, b) => d.votos[b] - d.votos[a]).slice(0, 5)) {
        const li = el('li');
        const muestra = el('span', 'tabla__muestra');
        muestra.style.background = d.listas[s].color;
        const candidato = CARGOS[estado.cargo].tipo === 'uninominal' ? d.listas[s].candidato : null;
        li.append(muestra, el('strong', null, s), `${candidato ? ` ${candidato}` : ''} ${pct.format(pctDe(d, s))} % · ${fmt.format(d.votos[s])} votos`);
        cuerpo.append(li);
    }
    const v = participacionDe(d);
    const pobreza = estado.capa === 'ipm' && ipm ? ` · ${textoDistrito(d.clave).slice(`${d.nombre} (${d.departamento_nombre}): `.length)}` : '';
    $('fichaDetalle').textContent = d.clave === ASUNCION ? 'Abrir Asunción mesa por mesa' : 'Abrir el tablero';
    const cobertura = porMesa() ? `${fmt.format(d.mesas.con_acta)} de ${fmt.format(d.mesas.esperadas)} mesas con acta` : d.fecha ? `Elección del ${fechaLarga(d.fecha)}` : 'Resultados por distrito';
    if (d.abarca) cuerpo.append(el('li', 'ficha__nota', `En ${contexto.anio.anio} abarcaba también lo que hoy son ${otrosDeHoy(d)}.`));
    ficha.abrir({ eyebrow: `Distrito · ${d.departamento_nombre} · ${CARGOS[estado.cargo].nombre}`, titulo: d.nombre,
                  meta: `${cobertura}${v === null ? '' : ` · participación ${pct.format(v)} %`}${pobreza}`,
                  cuerpo, detalle: tableroDisponible(d.clave) ? () => location.assign(new URL(enlaceTablero(d.clave), location.href).href) : null }, 'pais');
}

// --- Diálogos: fuente y método --------------------------------------------------------------------------------------

function seccion(titulo, ...hijos) {
    const nodo = el('section', 'dialogo__seccion');
    nodo.append(el('h3', null, titulo), ...hijos);
    return nodo;
}

function listaDef(items) {
    const dl = el('dl', 'fuentes__lista');
    for (const [titulo, contenido] of items) {
        const grupo = el('div');
        const dd = el('dd');
        dd.append(...[contenido].flat());
        grupo.append(el('dt', null, titulo), dd);
        dl.append(grupo);
    }
    return dl;
}

async function contenidoFuente() {
    const caja = el('div', 'dialogo__contenido');
    const e = indice.eleccion;
    const t = agregar(distritos);
    const faltan = porMesa() ? distritos.filter((d) => d.mesas.esperadas > d.mesas.con_acta) : [];
    // El TREP de municipales 2026 (con su corte y sus planillas) o el histórico del TSJE (ADR-042).
    const trep2026 = fuente === 'trep' && contexto.eleccion.id === 'municipales';
    const corte = contexto.anio.fuentes?.[fuente]?.corte;
    const nombresCargos = Object.values(CARGOS).map((c) => c.nombre);
    caja.append(seccion('Resultados', listaDef([
        ['Fuente', e.fuente],
        trep2026 ? ['Corte', `${corte ? fechaLarga(corte) : fechaLarga(e.corte)}. ${e.corte_base}`]
            : ['Elección', e.fechas?.length ? `Elecciones del ${e.fechas.map(fechaLarga).join(', ')}.` : `${fechaLarga(e.fecha ?? contexto.anio.fecha)}.${corte ? ` TREP: corte ${fechaLarga(corte)}.` : ''}`],
        ['Aviso', e.aviso],
        ['Cargo', `${nombresCargos.length > 1 ? `${nombresCargos.slice(0, -1).join(', ')} y ${nombresCargos.at(-1)}` : nombresCargos[0]} en ` +
                  `${cantidad(distritos.length, 'distrito', 'distritos')}; las cifras de esta vista son ${CARGOS[estado.cargo].de}.`],
        ...(!trep2026 ? [['Distritos', 'Cada distrito se dibuja como era en esa elección: con los límites del INE 2022, unidos donde abarcaba lo que hoy ' +
                                       'son varios, según la ley que creó cada distrito nuevo (datos/historico/distritos_creacion.json; si salió de varios, va ' +
                                       'con el que más electores perdió). Cada distrito del TSJE se une al de hoy por su código y su nombre ' +
                                       '(datos/historico/correspondencia_distritos.json). En gris, los que no tienen resultados del cargo: no lo eligen o ' +
                                       'existían y no votaron en esa elección.' + textoFueraDelMapa()]] : []),
        ...(trep2026 && porCargo['1'] ? [['Intendencia', 'Planillas uninominales del TREP (Justicia Electoral): una fila por mesa y lista. Cada lista tiene una ' +
                                             'candidatura; su sigla y su nombre salen de la planilla del TSJE con los resultados de Intendencia por ' +
                                             'distrito, que coincide voto por voto con la uninominal.'],
                             ['Nombres', 'Los de las candidaturas a Intendencia salen del padrón electoral (nombres y apellidos), buscados por la ' +
                                         'cédula que trae la planilla; la cédula no se guarda ni se publica. En Asunción, los nombres de la boleta.']] : []),
    ])));
    const tablaFaltan = el('table', 'tabla-compacta');
    tablaFaltan.append(el('caption', null, 'Distritos con mesas sin acta'));
    const cabeza = el('tr');
    for (const texto of ['Distrito', 'Departamento', 'Sin acta']) {
        const th = el('th', null, texto);
        th.scope = 'col';
        cabeza.append(th);
    }
    tablaFaltan.createTHead().append(cabeza);
    const cuerpo = tablaFaltan.createTBody();
    for (const d of faltan.sort((a, b) => a.departamento - b.departamento || colador.compare(a.nombre, b.nombre))) {
        const fila = el('tr');
        const th = el('th', null, d.nombre);
        th.scope = 'row';
        fila.append(th, el('td', null, d.departamento_nombre), el('td', null, fmt.format(d.mesas.esperadas - d.mesas.con_acta)));
        cuerpo.append(fila);
    }
    const cajaTabla = el('div', 'tabla-compacta__caja');
    cajaTabla.append(tablaFaltan);
    if (porMesa()) {
        caja.append(seccion('Cobertura', el('p', null, `${CARGOS[estado.cargo].nombre}: ${fmt.format(t.mesas)} de ${fmt.format(t.esperadas)} mesas con acta en ${fmt.format(t.distritos)} distritos; ` +
            `${cantidad(t.esperadas - t.mesas, 'mesa', 'mesas')} sin acta en ${cantidad(faltan.length, 'distrito', 'distritos')}. Una mesa sin acta no se completa ni se estima.`),
        ...(faltan.length ? [cajaTabla] : [])));
    } else {
        caja.append(seccion('Cobertura', el('p', null, `${CARGOS[estado.cargo].nombre}: resultados por distrito en ${cantidad(t.distritos, 'distrito', 'distritos')}. ` +
            'El TSJE no publica las mesas de esta elección: no hay tablero mesa por mesa.')));
    }
    caja.append(seccion('Electores y límites', listaDef([
        ['Electores', trep2026 ? `Recuento agregado del padrón por mesa, sin datos de personas: ${fmt.format(t.padron)} electores en el padrón y ` +
                                 `${fmt.format(t.electores)} en las mesas con acta.`
            : t.padron ? `Padrón por mesa del TSJE (estadísticas de padrón y participación; cantidades, sin datos de personas): ${fmt.format(t.padron)} electores ` +
                         'en los distritos de esta vista.'
                : 'La fuente no publica los electores de esta elección.'],
        ['Límites', 'INE, Cartografía digital del CNPV 2022 (límites referenciales), simplificados para el mapa del país; Licencia de Uso de Información Pública.'],
        ['Mapa base', 'Rutas, ríos, arroyos, espejos de agua y nombres de lugares de OpenStreetMap (© colaboradores de OpenStreetMap, ODbL 1.0), del build de ' +
                      'Protomaps del 08/10/2026, con más detalle al acercar; el navegador pide solo las partes a la vista. Se apaga en Capas.'],
        ['Códigos', 'Los códigos del TSJE y del INE no coinciden: cada distrito del TSJE se unió con su par del INE por el nombre, dentro del departamento.'],
        ['Nombres', 'Los del INE, con tildes; el TSJE los escribe en mayúsculas y a veces abreviados.'],
    ])));
    const enlace = el('a', null, 'nacional/procedencia.json');
    enlace.href = new URL('procedencia.json', carpetaNacional(contexto.eleccion.id, contexto.anio.anio)).href;
    const procedencia = seccion('Procedencia (SHA-256)', el('p', null, trep2026 ? 'Huellas de las planillas del TSJE, del catálogo del TREP y de la cartografía del INE: '
        : 'Huellas de los archivos de datos abiertos del TSJE (datos.gov.py) con que se armaron estos datos: '), enlace);
    try {
        const p = await archivoNacional(contexto.eleccion.id, contexto.anio.anio, 'procedencia.json');
        // Municipales 2026: las planillas del TREP; el histórico (ADR-042): la lista de archivos del TSJE.
        const items = [...(Array.isArray(p.fuentes) ? p.fuentes.map((f) => [f.archivo, f.sha256]) : Object.entries(p.fuentes?.planillas ?? {})),
                       ...(p.fuentes?.intendencia ? [[p.fuentes.intendencia.planilla, p.fuentes.intendencia.sha256]] : [])].map(([nombre, huella]) => {
            const codigo = el('code', 'huella', /^[0-9a-f]{64}$/.test(huella) ? huella : '—');
            return [nombre, codigo];
        });
        if (items.length) procedencia.append(listaDef(items));
    } catch (error) {
        console.warn(error);
    }
    caja.append(procedencia);
    if (await cargarIpm()) {
        const huella = el('code', 'huella', /^[0-9a-f]{64}$/.test(ipm.archivo?.sha256 ?? '') ? ipm.archivo.sha256 : '—');
        caja.append(seccion('Pobreza multidimensional (IPM)', listaDef([
            ['Fuente', `${ipm.fuente}. Incidencia, intensidad e IPM de ${fmt.format([...ipmPor.values()].filter(Boolean).length)} distritos, en total y por área (urbana y rural).`],
            ['Unión', 'Cada distrito del anexo se unió con su distrito del TSJE por el nombre, dentro del departamento.'],
            ['Asunción', ipm.notas.asuncion.replace(' (comun/indicadores_barrios.json)', '')],
            ['Sin población', `${ipm.notas.sin_poblacion} Son ${cantidad(ipm.sin_poblacion_rural.length, 'distrito', 'distritos')}.`],
            [ipm.archivo?.nombre ?? 'Anexo', huella],
        ])));
    }
    caja.append(seccion('No disponible', el('p', null, 'La pobreza multidimensional (IPM) por barrio existe solo para Asunción; en el país, el IPM va por ' +
        'distrito.')));
    return caja;
}

function contenidoMetodo() {
    const caja = el('div', 'dialogo__contenido');
    const trep2026 = fuente === 'trep' && contexto.eleccion.id === 'municipales';
    const nombres = Object.values(CARGOS).map((c) => c.nombre).join(', ');
    caja.append(seccion('Cifras de cada distrito', listaDef([
        ['Lista más votada', trep2026 ? 'La que tiene más votos a listas del cargo de la barra (Intendencia o Junta Municipal) en el distrito.'
            : `La que tiene más votos a listas del cargo de la barra (${nombres}) en el distrito; con un empate en el primer lugar, en gris.`],
        ...(CARGOS['1']?.clave === 'intendencia' ? [['Intendencia', 'Una candidatura por lista y sin bancas. Las alianzas y los movimientos locales van en verde, como en la Junta.']] : []),
        ['Participación', trep2026 ? 'Votos emitidos / electores habilitados de las mesas con acta (recuento del padrón por mesa).'
            : 'Votos emitidos del cargo / electores habilitados del distrito (padrón por mesa del TSJE).'],
        ['Ventaja', '100 × (votos del primero − votos del segundo) / votos a listas, en puntos.'],
        ['Votos de un partido', 'Sus votos sobre los votos a listas del distrito; sin lista propia, el distrito va en gris.'],
        ['Bancas', trep2026 ? 'La integración oficial de la Junta según el TREP; el D\'Hondt sobre los votos por lista da el mismo reparto en todos los distritos.'
            : 'La integración oficial según el TSJE (archivo de electos D\'Hondt): las juntas municipales por distrito; el Senado y el Parlasur en el país; ' +
              'Diputados y la Junta departamental en cada departamento. Con los nombres de las personas electas; su sexo y su edad, solo sumados.'],
    ])));
    caja.append(seccion('El país y los departamentos', listaDef([
        ['Sumas', 'Votos, mesas, electores y bancas sumados distrito por distrito.'],
        ['Partidos y alianzas', 'Los partidos se suman por sigla. Las alianzas y los movimientos locales (cada uno de un solo distrito) van juntos; ' +
                                'donde un partido va dentro de una alianza, sus votos son de la alianza.'],
        ['Colores', 'Los partidos con su color (ANR rojo, PLRA azul y un color fijo para cada uno de los demás); las alianzas y los movimientos ' +
                    'locales en verde, con tonos distintos si un distrito tiene más de uno.' +
                    (trep2026 ? '' : ' En las elecciones anteriores, los partidos que no tienen color en 2026 van en gris, y las alianzas de entonces ' +
                                     '(siglas unidas por «_», como PLRA_PEN) cuentan como alianzas.')],
        ['Tramos', 'Participación y votos de un partido: cinco tramos de igual ancho entre el menor y el mayor de los distritos a la vista.'],
    ])));
    caja.append(seccion('Pobreza multidimensional (IPM)', listaDef([
        ['Incidencia (H)', 'Porcentaje de personas en situación de pobreza multidimensional (INE, Censo 2022).'],
        ['Intensidad (A)', 'Promedio de privaciones entre las personas en situación de pobreza multidimensional.'],
        ['IPM', 'Incidencia por intensidad: H × A / 100.'],
        ['Área', 'El total del distrito, o solo su área urbana o rural; un área sin población (los distritos solo urbanos no tienen rural) va sin dato.'],
        ['Quintiles', 'En el mapa, los distritos a la vista se agrupan en cinco grupos con casi la misma cantidad de distritos.'],
        ['Lectura', 'Es una comparación entre agregados: no muestra cómo votaron las personas en situación de pobreza ni ningún otro grupo. El IPM es ' +
                    `del Censo 2022 y los votos, de ${contexto.anio.anio}.`],
    ])));
    return caja;
}

// --- Selección ------------------------------------------------------------------------------------------------------

// Lo tocado en el mapa muestra sus resultados: en celular la hoja sube a media altura y en tablet vertical se abre el
// cajón (como en el tablero de un distrito).
function mostrarResultados() {
    if (panel.celular()) panel.elegir('resultados', { altura: 'medio' });
    else if (panel.cajon()) {
        panel.elegir('resultados');
        panel.abrir(true);
    } else panel.elegir('resultados');
    estado.panel = panel.panel();
}

function elegirDistrito(clave, { enfocar = false, mostrar = false } = {}) {
    const d = clave ? porClave.get(clave) : null;
    estado.elegido = d ? d.clave : null;
    if (d && estado.departamento !== null && d.departamento !== estado.departamento) estado.departamento = d.departamento;
    if (mostrar) mostrarResultados();
    renderTodo();
    actualizarEnlace();
    if (d && enfocar) mapa.encuadrar(d.caja, { animar: true, maxZoom: 9.5 }).catch(() => {});
}

function tocarDistrito(clave) {
    if (pantallaCompleta()) {
        estado.elegido = clave;
        renderTodo();
        actualizarEnlace();
        abrirFicha(porClave.get(clave)).catch((error) => console.error(error));
        return;
    }
    elegirDistrito(clave, { mostrar: !panel.ancho() });
}

function elegirDepartamento(dep, { encuadrar = true } = {}) {
    estado.departamento = dep === null || dep === '' || !porDep.has(Number(dep)) ? null : Number(dep);
    if (estado.elegido && !enFiltro(porClave.get(estado.elegido))) estado.elegido = null;
    renderTodo();
    actualizarEnlace();
    if (encuadrar) mapa.encuadrar(cajaDelEstado(), { animar: true }).catch(() => {});
}

function limpiar() {
    const dep = estado.elegido && estado.departamento !== null ? estado.departamento : null;
    estado.elegido = null;
    elegirDepartamento(dep);
}

// --- Enlace compartible ---------------------------------------------------------------------------------------------

function parametrosEnlace() {
    const p = new URLSearchParams({ eleccion: contexto.eleccion.id, anio: String(contexto.anio.anio), cargo: CARGOS[estado.cargo].clave });
    if (estado.departamento !== null) p.set('departamento', String(estado.departamento));
    if (estado.elegido) p.set('elegido', estado.elegido);
    if (estado.capa !== 'ganadora') p.set('mapa', estado.capa);
    if (estado.capa === 'partido') p.set('partido', estado.partido);
    if (estado.capa === 'ipm' && estado.ipm !== 'H') p.set('ipm', estado.ipm);
    if (estado.capa === 'ipm' && estado.area !== 'total') p.set('area', estado.area);
    if (estado.panel !== 'resultados') p.set('panel', estado.panel);
    if (estado.bandeja) p.set('bandeja', estado.bandeja);
    return p;
}

// El estado compartido (shell.js) escribe el hash con history.replaceState: sin entradas nuevas en el historial.
function actualizarEnlace() {
    if (enlaceListo) compartido.reemplazar(Object.fromEntries(parametrosEnlace()), 'visor');
}

// Aplica el hash al estado; lo que no existe en los datos queda con el valor por omisión. Sin tablero de distrito
// (TABLERO_DE_DISTRITO en false), distrito=<clave> abre el país con ese distrito elegido.
function leerEnlace() {
    const p = new URLSearchParams(location.hash.slice(1));
    // El cargo (ADR-024): el del hash si el año lo tiene (por su nombre o, en los enlaces de antes, por su número); si no, el
    // primero que declara el manifiesto para el país (como la barra).
    usarCargo(datoDe(contexto.anio, p.get('cargo')) ?? cargoDe(cargosDelPais()[0]));
    const dep = p.get('departamento');
    estado.departamento = /^\d{1,2}$/.test(dep ?? '') && porDep.has(Number(dep)) ? Number(dep) : null;
    // Sin tablero de distrito (TABLERO_DE_DISTRITO en false, o un año sin datos por mesa, ADR-042), distrito=<clave> abre el
    // país con ese distrito elegido.
    const distritoPedido = p.get('distrito');
    const elegido = p.get('elegido') ?? (!porMesa() || (!TABLERO_DE_DISTRITO && distritoPedido !== ASUNCION) ? distritoPedido : null);
    estado.elegido = elegido && porClave.has(elegido) ? elegido : null;
    if (estado.elegido && estado.departamento !== null && !enFiltro(porClave.get(estado.elegido))) estado.departamento = porClave.get(estado.elegido).departamento;
    estado.capa = CAPAS.includes(p.get('mapa')) ? p.get('mapa') : 'ganadora';
    estado.partido = partidos.has(p.get('partido')) ? p.get('partido') : 'ANR';
    estado.ipm = IPM.includes(p.get('ipm')) ? p.get('ipm') : 'H';
    estado.area = AREAS.includes(p.get('area')) ? p.get('area') : 'total';
    estado.panel = PANELES.includes(p.get('panel')) ? p.get('panel') : 'resultados';
    estado.bandeja = BANDEJAS.includes(p.get('bandeja')) ? p.get('bandeja') : null;
}

function aplicarPaneles({ altura = null } = {}) {
    panel.elegir(estado.panel, { altura });
    if (estado.bandeja) bandeja.elegir(estado.bandeja);
    bandeja.abrir(Boolean(estado.bandeja));
}

function renderTodo() {
    renderResultados();
    renderBancas();
    renderFiltros();
    renderCapas();
    renderMapa();
    renderBandeja();
}

// --- Eventos --------------------------------------------------------------------------------------------------------

function abrirBusqueda() {
    panel.elegir('filtros', { altura: 'completo' });
    if (panel.cajon()) panel.abrir(true);
    estado.panel = 'filtros';
    actualizarEnlace();
    $('buscarDistrito').focus();
}

function eventos() {
    // El departamento de la barra de contexto (shell.js).
    compartido.suscribir(({ cambiadas, origen }) => {
        // El cargo de la barra (ADR-024): las cifras de cada distrito pasan a las de ese cargo.
        if (origen === 'barra' && cambiadas.has('cargo')) {
            usarCargo(cargoDe(compartido.obtener('cargo')));
            if (estado.orden?.id === 'bancas' && !conBancasDeDistrito(estado.cargo)) estado.orden = null;
            renderTodo();
            actualizarEnlace();
            return;
        }
        if (origen !== 'barra' || !cambiadas.has('departamento')) return;
        elegirDepartamento(compartido.obtener('departamento'));
    });
    $('filtroDepartamento').addEventListener('change', (evento) => elegirDepartamento(evento.target.value));
    $('filtroDistrito').addEventListener('change', (evento) => elegirDistrito(evento.target.value || null, { enfocar: true }));
    $('limpiarFiltros').addEventListener('click', () => {
        estado.elegido = null;
        elegirDepartamento(null);
    });
    $('limpiarSeleccion').addEventListener('click', limpiar);
    $('capas').addEventListener('change', (evento) => {
        if (evento.target.name !== 'mapa') return;
        estado.capa = evento.target.value;
        estado.orden = ['partido', 'ipm'].includes(estado.orden?.id) && estado.capa !== estado.orden.id ? null : estado.orden;
        // La nota de los resultados de un distrito trae su IPM con la capa del IPM.
        renderResultados();
        renderCapas();
        renderMapa();
        renderBandeja();
        actualizarEnlace();
    });
    $('capaPartido').addEventListener('change', (evento) => {
        estado.partido = evento.target.value;
        renderMapa();
        renderBandeja();
        actualizarEnlace();
    });
    for (const [atributo, clave] of [['ipm', 'ipm'], ['area', 'area']]) {
        for (const boton of document.querySelectorAll(`[data-${atributo}]`)) {
            boton.addEventListener('click', () => {
                estado[clave] = boton.dataset[atributo];
                renderCapas();
                renderMapa();
                renderBandeja();
                actualizarEnlace();
            });
        }
    }
    $('opacidadCapa').addEventListener('input', (evento) => {
        estado.opacidad = Number(evento.target.value);
        $('valorOpacidad').textContent = `${fmt.format(estado.opacidad)} %`;
        renderMapa();
    });
    $('elementosMapa').addEventListener('change', (evento) => {
        if (evento.target.name !== 'ver') return;
        estado.ver[evento.target.value] = evento.target.checked;
        renderMapa();
    });
    // Tabla: el nombre elige el distrito; los encabezados ordenan.
    $('tabla').addEventListener('click', (evento) => {
        const elegir = evento.target.closest('.tabla__elegir');
        if (elegir) {
            elegirDistrito(elegir.dataset.clave, { enfocar: true });
            return;
        }
        const orden = evento.target.closest('.tabla__orden');
        if (!orden) return;
        const id = orden.dataset.columna;
        const texto = columnasTabla().find((c) => c.id === id)?.texto;
        estado.orden = estado.orden?.id === id ? { id, dir: -estado.orden.dir } : { id, dir: texto ? 1 : -1 };
        renderTabla();
        $('tabla').querySelector(`[data-columna="${id}"]`)?.focus();
    });
    $('filtroTabla').addEventListener('input', (evento) => {
        estado.filtro = evento.target.value;
        renderTabla();
    });
    $('ranking').addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-clave]');
        if (boton) elegirDistrito(boton.dataset.clave, { enfocar: true });
    });
    for (const boton of document.querySelectorAll('[data-orden-ranking]')) {
        boton.addEventListener('click', () => {
            estado.ordenRanking = boton.dataset.ordenRanking;
            renderRanking();
        });
    }
    // Búsqueda de distrito: combobox con lista de sugerencias.
    const buscador = $('buscarDistrito');
    buscador.addEventListener('input', () => {
        sugerencias = buscar(buscador.value);
        activa = sugerencias.length ? 0 : -1;
        mostrarSugerencias();
    });
    buscador.addEventListener('keydown', (evento) => {
        if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
            if (!sugerencias.length) return;
            evento.preventDefault();
            activa = (activa + (evento.key === 'ArrowDown' ? 1 : sugerencias.length - 1)) % sugerencias.length;
            mostrarSugerencias();
        } else if (evento.key === 'Enter') {
            if (!sugerencias.length) return;
            evento.preventDefault();
            elegirSugerencia(sugerencias[Math.max(0, activa)].clave);
        } else if (evento.key === 'Escape' && sugerencias.length) {
            evento.preventDefault();
            cerrarSugerencias();
        }
    });
    $('sugerenciasDistrito').addEventListener('mousedown', (evento) => evento.preventDefault());
    $('sugerenciasDistrito').addEventListener('click', (evento) => {
        const item = evento.target.closest('[data-clave]');
        if (item) elegirSugerencia(item.dataset.clave);
    });
    buscador.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== buscador) cerrarSugerencias(); }, 0));
    $('botonBuscar').addEventListener('click', abrirBusqueda);
    $('botonTabla').addEventListener('click', () => bandeja.abrir(!bandeja.abierta(), { foco: true }));
    $('botonPanel').addEventListener('click', () => panel.abrir(!panel.abierto(), { foco: true }));
    $('cerrarPanel').addEventListener('click', () => panel.abrir(false, { foco: true }));
    for (const [id, nombre] of [['abrirFuente', 'fuente'], ['abrirMetodo', 'metodo']]) {
        $(id).setAttribute('aria-controls', dialogos[nombre].elemento.id);
        $(id).addEventListener('click', (evento) => dialogos[nombre].abrir(evento.currentTarget));
    }
    $('fichaEnlace').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(location.href);
            $('fichaAviso').textContent = 'Enlace copiado';
        } catch {
            $('fichaAviso').textContent = `Copiá este enlace: ${location.href}`;
        }
    });
    // Un enlace pegado en la misma pestaña (o el hash editado a mano) cambia la vista sin recargar.
    window.addEventListener('hashchange', async () => {
        leerEnlace();
        if (estado.capa === 'ipm') await cargarIpm();
        aplicarPaneles();
        renderTodo();
        mapa.encuadrar(cajaDelEstado()).catch(() => {});
    });
}

function elegirPestana(nombre, { foco = false } = {}) {
    panel.elegir(nombre, { foco });
    estado.panel = panel.panel();
    actualizarEnlace();
}

// La leyenda empieza abierta solo si el mapa tiene alto de sobra (en celular y en pantallas bajas, plegada).
function abrirLeyendaSiCabe() {
    $('leyendaMapa').open = !panel.celular() && $('mapa').getBoundingClientRect().height >= 320;
}

// La llama inicio.js con la fuente de la sección (TREP o Resultados oficiales), el contexto (elección y año) y la lista de
// distritos.
export async function iniciar({ fuente: deLaSeccion = 'trep', contexto: ctx } = {}) {
    const visor = $('visor');
    try {
        contexto = ctx;
        fuente = deLaSeccion;
        const { eleccion, anio } = ctx;
        armarCargos(anio, fuente);
        const [datos, geoDistritos, geoDepartamentos, coloresNacionales] = await Promise.all([indiceNacional(eleccion.id, anio.anio, fuente),
            geoNacional(eleccion.id, anio.anio, 'distritos'), geoNacional(eleccion.id, anio.anio, 'departamentos'),
            archivoNacional(eleccion.id, anio.anio, 'colores.json')]);
        colores = coloresNacionales;
        // Todos los distritos de la geometría (ADR-042): los que no tienen resultados en esta elección van en gris.
        todas = geoDistritos.features.map((f) => f.properties.clave);
        nombreGeo = new Map(geoDistritos.features.map((f) => [f.properties.clave, f.properties.nombre]));
        abarcanGeo = geoDistritos.features.filter((f) => f.properties.abarca).length;
        preparar(datos);
        $('tituloTablero').textContent = `${anio.fuentes?.[fuente]?.nombre ?? 'TREP'} · ${eleccion.nombre} ${anio.anio} · ${anio.nacional?.nombre ?? 'Paraguay'}`;
        if (datos.eleccion.aviso) $('avisoLegal').append(` ${datos.eleccion.aviso}`);
        // Asunción mesa por mesa, si esta elección la tiene (ADR-042: no en los años sin datos por mesa ni en las complementarias).
        $('enlaceAsuncion').hidden = !Object.values(porCargo).some((x) => x.porClave.has(ASUNCION)) || !porMesa();
        const deAsuncion = Object.values(CARGOS).filter((c) => porCargo[c.dato]?.porClave.has(ASUNCION)).map((c) => c.etiqueta);
        $('enlaceAsuncion').textContent = `Asunción mesa por mesa (${deAsuncion.join(', ').replace(/, ([^,]*)$/, ' y $1')})`;
        $('enlaceAsuncion').href = enlaceTablero(ASUNCION);
        // La leyenda y la atribución van superpuestas al mapa, también en pantalla completa.
        $('mapa').append($('leyendaMapa'), $('atribucionMapa'));
        const pais = indice.departamentos.reduce((c, d) => [Math.min(c[0], d.caja[0]), Math.min(c[1], d.caja[1]), Math.max(c[2], d.caja[2]), Math.max(c[3], d.caja[3])],
            [Infinity, Infinity, -Infinity, -Infinity]);
        mapa = crearMapaPais({ distritos: geoDistritos, departamentos: geoDepartamentos },
            { distritos: distritos.map((d) => ({ clave: d.clave, nombre: d.nombre, centro: d.centro })), departamentos: indice.departamentos },
            $('mapa'), { etiqueta: `Mapa de Paraguay con los ${fmt.format(distritos.length)} distritos coloreados según la capa elegida`, atribucion: $('atribucionMapa'), pais,
                         resultados: fuente === 'trep' ? 'TREP (Justicia Electoral)' : 'cómputo oficial (TSJE)',
                         margen: margenMapa, controles: { ampliarEnGrupo: true }, alTocar: tocarDistrito, texto: textoDistrito,
                         alCambiarTema: () => renderMapa() });
        panel = crearPanel({ alElegir: elegirPestana });
        bandeja = crearBandeja({
            alElegir: (nombre) => { estado.bandeja = nombre; renderBandeja(); actualizarEnlace(); },
            alCambiar: (abierta) => { estado.bandeja = abierta ? bandeja.panel() : null; renderBandeja(); actualizarEnlace(); },
        });
        dialogos = { fuente: crearDialogo({ titulo: 'Fuente', contenido: contenidoFuente }), metodo: crearDialogo({ titulo: 'Método', contenido: contenidoMetodo }) };
        eventos();
        leerEnlace();
        if (estado.capa === 'ipm') await cargarIpm();
        aplicarPaneles({ altura: estado.panel !== 'resultados' || estado.elegido ? 'medio' : 'peek' });
        renderTodo();
        enlaceListo = true;
        // Como el tablero, la carga no escribe el hash (la dirección queda limpia); uno que llegó se normaliza.
        if (location.hash.length > 1) actualizarEnlace();
        await shellListo;
        const hayMapa = await mapa.listo.then(() => true, (error) => {
            $('mapa').append(el('p', 'mapa__sin-mapa', 'No se pudo mostrar el mapa en este navegador (necesita WebGL). Los resultados, la tabla y el ranking siguen disponibles.'));
            console.warn(error);
            return false;
        });
        if (hayMapa) {
            renderMapa();
            const caja = cajaDelEstado();
            if (caja) await mapa.encuadrar(caja);
        }
        abrirLeyendaSiCabe();
        vigilarDesplazables();
        visor.dataset.listo = 'true';
    } catch (error) {
        const aviso = $('errorCarga');
        aviso.hidden = false;
        aviso.textContent = 'No fue posible leer los datos del mapa del país. Revisá la conexión o el servidor local.';
        console.error(error);
    } finally {
        visor.setAttribute('aria-busy', 'false');
    }
}
