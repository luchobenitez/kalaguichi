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
// Los dos cargos (ADR-024): '1' Intendencia y '2' Junta Municipal, con la clave del hash y cómo se nombran en una frase.
const CARGOS = { '1': { clave: 'intendencia', nombre: 'Intendencia', de: 'de la Intendencia', planilla: 'las planillas uninominales del TREP' },
                 '2': { clave: 'junta', nombre: 'Junta Municipal', de: 'de la Junta', planilla: 'las planillas del TREP de la Junta' } };
const cargoDe = (clave) => (clave === 'junta' || clave === '2' ? '2' : '1');
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
const estado = { cargo: '1', departamento: null, elegido: null, capa: 'ganadora', partido: 'ANR', ipm: 'H', area: 'total', opacidad: OPACIDAD_POR_OMISION,
                 ver: { departamentos: true, distritos: true, nombres: true }, panel: 'resultados', bandeja: null, orden: null,
                 ordenRanking: 'desc', filtro: '' };

// --- Modelo -------------------------------------------------------------------------------------------------------

const grupoDe = (lista, sigla) => (lista.tipo === 'partido' ? sigla : LOCALES);
const enFiltro = (d) => estado.departamento === null || d.departamento === estado.departamento;
const visibles = () => distritos.filter(enFiltro);
const nombreDep = (codigo) => porDep.get(codigo)?.nombre ?? '';
const participacionDe = (d) => (d.participacion === null || d.participacion === undefined ? null : 100 * d.participacion);
const pctDe = (d, sigla) => (d.votos_listas && d.listas[sigla] ? (100 * d.votos[sigla]) / d.votos_listas : null);
const tramo = (v) => (v < TRAMOS_VENTAJA[0] ? 0 : v < TRAMOS_VENTAJA[1] ? 1 : 2);
// Valor del componente en el área: sin dato (Asunción, un área sin población) o intensidad sin personas pobres (H = 0), null.
const ipmDe = (d, k = estado.ipm, area = estado.area) => {
    const x = ipmPor.get(d.clave);
    const v = x?.[k]?.[area];
    return v === null || v === undefined || (k === 'A' && x.H[area] === 0) ? null : v;
};
const formatoIpm = (k = estado.ipm) => (k === 'A' ? pct : pct2);
const indicadorIpm = (k = estado.ipm) => ipm.indicadores.find((x) => x.id === k);
// Por qué un distrito no tiene el valor en la capa del IPM.
const sinIpm = (d) => (d.clave === ASUNCION ? 'su IPM es por barrio (en su tablero)'
    : ipmPor.get(d.clave)?.H?.[estado.area] === null ? `sin población ${estado.area}` : 'sin dato');

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
const tableroDisponible = (clave) => clave === ASUNCION || TABLERO_DE_DISTRITO;
const enlaceTablero = (clave) => hashDe({ distrito: clave }, { cargoDisponible: (c) => cargosDelPais().includes(c) || clave === ASUNCION,
                                                              eleccion: contexto.eleccion.id, anio: contexto.anio.anio, cargo: CARGOS[estado.cargo].clave });
// Los cargos que el manifiesto declara para el país (ADR-024).
const cargosDelPais = () => contexto.anio.nacional?.cargos ?? ['junta'];

function preparar(datos) {
    indice = datos;
    porDep = new Map(datos.departamentos.map((d) => [d.codigo, d]));
    // La Junta: los campos de cada registro; la Intendencia: su bloque, con los mismos nombres (las bancas son de la Junta).
    const junta = datos.distritos.map((d) => ({ ...d, gana: d.listas[d.ganadora] }));
    const intendencia = datos.distritos.filter((d) => d.intendencia).map((d) => {
        const i = d.intendencia;
        return { ...d, votos: i.votos, votos_listas: i.votos_listas, blancos: i.blancos, nulos: i.nulos, nocomputados: i.nocomputados, emitidos: i.emitidos,
                 participacion: i.participacion, ganadora: i.ganadora, segunda: i.segunda, pct_ganadora: i.pct_ganadora, ventaja: i.ventaja, listas: i.listas,
                 mesas: { esperadas: d.mesas.esperadas, con_acta: i.mesas.con_acta },
                 electores: { padron: d.electores.padron, en_mesas_con_acta: i.electores_en_mesas_con_acta }, gana: i.listas[i.ganadora] };
    });
    porCargo = {};
    for (const [cargo, lista] of [['2', junta], ['1', intendencia]]) {
        if (!lista.length) continue;
        const delCargo = new Map();
        for (const d of lista) {
            for (const [sigla, x] of Object.entries(d.listas)) {
                if (x.tipo !== 'partido') continue;
                const p = delCargo.get(sigla) ?? { sigla, nombre: x.nombre, color: colores?.partidos?.[sigla] ?? x.color, distritos: 0 };
                p.distritos += 1;
                delCargo.set(sigla, p);
            }
        }
        porCargo[cargo] = { distritos: lista, porClave: new Map(lista.map((d) => [d.clave, d])), partidos: delCargo };
    }
    usarCargo(estado.cargo);
}

// Cambia los distritos que se muestran a los del cargo (el que haya, si falta).
function usarCargo(cargo) {
    estado.cargo = porCargo[cargo] ? cargo : porCargo['1'] ? '1' : '2';
    ({ distritos, porClave, partidos } = porCargo[estado.cargo]);
    claves = distritos.map((d) => d.clave);
}

// Suma de un grupo de distritos (el país o un departamento): totales y votos, bancas y distritos ganados por partido, con
// las alianzas y los movimientos locales juntos.
function agregar(lista, cargo = estado.cargo) {
    const conBancas = cargo === '2';
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
    const junta = estado.cargo === '2';
    $('eyebrowTotales').textContent = `${pais ? 'Todo el país' : 'Departamento'} · ${CARGOS[estado.cargo].nombre}`;
    $('tituloTotales').textContent = pais ? contexto.anio.nacional?.nombre ?? 'Paraguay' : nombreDep(estado.departamento);
    $('metaTotales').textContent = `${cantidad(t.distritos, 'distrito', 'distritos')} · ${fmt.format(t.mesas)} de ${fmt.format(t.esperadas)} mesas con acta` +
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
    $('notaResultados').textContent = `Votos ${CARGOS[estado.cargo].de} sumados por partido en ${pais ? 'los distritos del país' : `los distritos de ${nombreDep(estado.departamento)}`}. ` +
        `Las alianzas y los movimientos locales (cada uno de un solo distrito)${junta ? '' : ' y las listas solo de Intendencia'} van juntos, en verde. ` +
        (plra ? `Un partido puede ir dentro de una alianza donde no presenta lista propia: el PLRA la presenta en ${fmt.format(plra.distritos)} de ${fmt.format(t.distritos)} distritos. ` : '') +
        'Porcentajes sobre los votos a listas.';
}

function renderDistrito(d) {
    const junta = estado.cargo === '2';
    $('eyebrowTotales').textContent = `Distrito · ${d.departamento_nombre} · ${CARGOS[estado.cargo].nombre}`;
    $('tituloTotales').textContent = d.nombre;
    $('metaTotales').textContent = `${fmt.format(d.mesas.con_acta)} de ${fmt.format(d.mesas.esperadas)} mesas con acta · ${cantidad(d.locales, 'local', 'locales')}` +
        (junta ? ` · ${cantidad(d.bancas.total, 'banca', 'bancas')}` : ` · ${cantidad(Object.keys(d.votos).length, 'candidatura', 'candidaturas')}`);
    const abrir = $('abrirDistrito');
    abrir.hidden = !tableroDisponible(d.clave);
    abrir.href = enlaceTablero(d.clave);
    abrir.textContent = d.clave === ASUNCION ? 'Abrir Asunción mesa por mesa' : `Abrir el tablero de ${d.nombre}`;
    $('limpiarSeleccion').hidden = false;
    $('limpiarSeleccion').textContent = estado.departamento === null ? 'Ver todo el país' : `Ver ${nombreDep(estado.departamento)}`;
    $('ganados').hidden = true;
    const orden = Object.keys(d.votos).sort((a, b) => d.votos[b] - d.votos[a]);
    $('listaResultados').replaceChildren(...orden.map((s) => {
        const x = d.listas[s];
        // Intendencia: el nombre de la candidatura y, al pie, su lista; Junta: la lista y sus bancas.
        return filaResultado({ sigla: s.slice(0, 5), color: x.color, nombre: junta ? x.nombre : x.candidato ?? x.nombre, valor: `${fmt.format(d.votos[s])} votos`,
            parte: d.votos[s], total: d.votos_listas,
            pie: junta ? `Lista ${x.numLista} · ${cantidad(d.bancas.reparto[s] ?? 0, 'banca', 'bancas')}` : `${x.nombre} · lista ${x.numLista}` });
    }));
    renderParticipacion(d.emitidos, d.electores.en_mesas_con_acta);
    const dif = $('diferencia');
    dif.replaceChildren();
    if (d.segunda) {
        const votos = d.votos[d.ganadora] - d.votos[d.segunda];
        dif.append(el('span', 'diferencia__titulo', 'Diferencia entre las dos más votadas'),
            el('strong', 'diferencia__valor', `${fmt.format(votos)} votos · ${pct.format(d.ventaja)} puntos`),
            el('span', 'diferencia__detalle', `${d.ganadora} sobre ${d.segunda}. Porcentajes sobre ${fmt.format(d.votos_listas)} votos a listas.`));
    }
    renderOtros({ listas: d.votos_listas, blancos: d.blancos, nulos: d.nulos, nocomputados: d.nocomputados, emitidos: d.emitidos,
                  electores: d.electores.en_mesas_con_acta });
    const faltan = d.mesas.esperadas - d.mesas.con_acta;
    $('notaResultados').textContent = (faltan ? `Falta el acta de ${cantidad(faltan, 'mesa', 'mesas')}. ` : '') +
        (d.clave === ASUNCION ? 'Asunción tiene además los resultados por mesa, local, barrio y zona en su tablero.'
            : `Resultados ${CARGOS[estado.cargo].de} del distrito según ${CARGOS[estado.cargo].planilla}; mesa por mesa, en su tablero.`) +
        (estado.capa === 'ipm' && ipm ? ` ${textoIpmDistrito(d)}` : '');
}

// El IPM del distrito (total del distrito), en la nota de sus resultados.
function textoIpmDistrito(d) {
    if (d.clave === ASUNCION) return 'Pobreza multidimensional: el INE la publica por barrio para Asunción (capa del IPM en su tablero).';
    const valor = (k) => {
        const v = ipmDe(d, k, 'total');
        return v === null ? 'sin dato' : `${formatoIpm(k).format(v)} %`;
    };
    return `Pobreza multidimensional (INE, Censo 2022), total del distrito: incidencia ${valor('H')}, intensidad ${valor('A')} e IPM ${valor('IPM')}.`;
}

// --- Panel: bancas --------------------------------------------------------------------------------------------------

function renderBancas() {
    // Las bancas son de la Junta, sea cual sea el cargo de la barra.
    const J = porCargo['2'];
    const d = estado.elegido ? J.porClave.get(estado.elegido) : null;
    const nota = 'Integración oficial de cada Junta Municipal según el TREP; el D\'Hondt sobre los votos por lista da el mismo reparto en los ' +
        `${fmt.format(distritos.length)} distritos.`;
    if (d) {
        const orden = Object.keys(d.bancas.reparto).sort((a, b) => d.bancas.reparto[b] - d.bancas.reparto[a] || d.votos[b] - d.votos[a]);
        $('eyebrowBancas').textContent = `Distrito · ${d.departamento_nombre}`;
        $('tituloBancas').textContent = `Bancas de la Junta Municipal de ${d.nombre}`;
        $('metaBancas').textContent = `${cantidad(d.bancas.total, 'banca', 'bancas')} · mayoría con ${fmt.format(Math.floor(d.bancas.total / 2) + 1)}`;
        apilada($('barraBancas'), 'Reparto', orden.map((s) => ({ clave: s, texto: s, color: d.listas[s].color, n: d.bancas.reparto[s] })), d.bancas.total,
            ['banca', 'bancas']);
        $('listaBancas').replaceChildren(...orden.map((s) => filaResultado({ sigla: s.slice(0, 5), color: d.listas[s].color, nombre: d.listas[s].nombre,
            valor: cantidad(d.bancas.reparto[s], 'banca', 'bancas'), parte: d.bancas.reparto[s], total: d.bancas.total,
            pie: `${fmt.format(d.votos[s])} votos (${pct.format(pctDe(d, s))} %)` })));
        $('notaBancas').textContent = nota;
        return;
    }
    const t = agregar(J.distritos.filter(enFiltro), '2');
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
    $('notaBancas').textContent = `${nota} Las alianzas y los movimientos locales van juntos.`;
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

function pintarGanadora(leyenda) {
    const conteo = new Map();
    mapa.pintar(claves, (clave) => {
        const d = porClave.get(clave);
        if (enFiltro(d)) {
            const g = grupoDe(d.gana, d.ganadora);
            const c = conteo.get(g) ?? { n: 0, color: g === LOCALES ? colores.verdes[0] : d.gana.color, texto: g === LOCALES ? LOCAL_EN_LEYENDA : `${d.ganadora} más votada` };
            c.n += 1;
            conteo.set(g, c);
        }
        return { color: d.gana.color, atenuado: !enFiltro(d) };
    });
    for (const c of [...conteo.values()].sort((a, b) => b.n - a.n)) leyenda.append(itemRelleno(c.color, `${c.texto}: ${cantidad(c.n, 'distrito', 'distritos')}`));
    $('notaCapa').textContent = `Cada distrito, con el color de la lista más votada ${CARGOS[estado.cargo].de}: los partidos con su color y las alianzas y los ` +
        `movimientos locales${estado.cargo === '1' ? ' (y las listas solo de Intendencia)' : ''} en verde (tonos distintos si un distrito tiene más de ` +
        'uno). Tocá un distrito para ver sus cifras.';
}

function pintarParticipacion(leyenda) {
    const valores = visibles().map(participacionDe).filter((v) => v !== null);
    const { cortes, clase } = escala(valores);
    const paso = (v) => Math.max(0, Math.min(4, clase(v)));
    mapa.pintar(claves, (clave) => {
        const d = porClave.get(clave);
        const v = participacionDe(d);
        return { color: v === null ? null : mezclar(PARTICIPACION_COLOR, opacidadPaso(paso(v))), atenuado: !enFiltro(d) };
    });
    for (let k = 0; k < cortes.length - 1; k++) leyenda.append(itemRelleno(mezclar(PARTICIPACION_COLOR, opacidadPaso(k)), `${pct.format(cortes[k])} a ${pct.format(cortes[k + 1])} %`));
    $('notaCapa').textContent = 'Votos emitidos sobre electores habilitados de las mesas con acta (recuento agregado del padrón por mesa), por distrito, en ' +
        'cinco tramos de igual ancho entre el menor y el mayor de los distritos a la vista. Tocá un distrito para ver sus cifras.';
}

function pintarVentaja(leyenda) {
    const conteo = new Map();
    mapa.pintar(claves, (clave) => {
        const d = porClave.get(clave);
        const k = tramo(d.ventaja ?? 0);
        if (enFiltro(d)) {
            const g = grupoDe(d.gana, d.ganadora);
            const c = conteo.get(`${g}|${k}`) ?? { g, k, n: 0, color: g === LOCALES ? colores.verdes[0] : d.gana.color, sigla: g === LOCALES ? LOCAL_EN_LEYENDA : d.ganadora };
            c.n += 1;
            conteo.set(`${g}|${k}`, c);
        }
        return { color: mezclar(d.gana.color, opacidadPaso(k, 3)), atenuado: !enFiltro(d) };
    });
    const total = new Map();
    for (const c of conteo.values()) total.set(c.g, (total.get(c.g) ?? 0) + c.n);
    for (const c of [...conteo.values()].sort((a, b) => total.get(b.g) - total.get(a.g) || b.k - a.k)) {
        leyenda.append(itemRelleno(mezclar(c.color, opacidadPaso(c.k, 3)), `${c.sigla} primera ${TEXTO_TRAMO[c.k]}: ${cantidad(c.n, 'distrito', 'distritos')}`));
    }
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
    mapa.pintar(claves, (clave) => {
        const d = porClave.get(clave);
        const v = pctDe(d, p.sigla);
        if (v === null && enFiltro(d)) sin += 1;
        return { color: v === null ? gris : mezclar(p.color, opacidadPaso(paso(v))), atenuado: !enFiltro(d) };
    });
    if (valores.length) {
        for (let k = 0; k < cortes.length - 1; k++) leyenda.append(itemRelleno(mezclar(p.color, opacidadPaso(k)), `${pct.format(cortes[k])} a ${pct.format(cortes[k + 1])} %`));
    }
    if (sin) leyenda.append(itemRelleno(gris, `Sin lista propia de ${p.sigla}: ${cantidad(sin, 'distrito', 'distritos')}`));
    $('notaCapa').textContent = `Votos de ${p.sigla} (${p.nombre}) sobre los votos a listas ${CARGOS[estado.cargo].de} de cada distrito, en cinco tramos de igual ancho. ` +
        'En gris, los distritos donde no presentó lista propia (puede ir dentro de una alianza).';
}

// IPM por distrito (INE, Censo 2022), en quintiles de los distritos a la vista; sin dato, en gris.
function pintarIpm(leyenda) {
    if (!ipm) {
        mapa.pintar(claves, (clave) => ({ color: paleta().sinDatos, atenuado: !enFiltro(porClave.get(clave)) }));
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
    mapa.pintar(claves, (clave) => {
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
    $('notaCapa').textContent = `${ind.nombre}${EN_AREA[estado.area]}: ${ind.descripcion} Distritos en quintiles: cinco grupos con casi la misma ` +
        'cantidad de distritos a la vista (INE, Censo 2022). En gris, sin dato: Asunción (el INE publica su IPM por barrio, en su tablero)' +
        (estado.area === 'rural' ? ' y los distritos sin población rural' : '') + '. Es una comparación entre agregados: no muestra cómo votaron las ' +
        'personas en situación de pobreza ni ningún otro grupo.';
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
    leyenda.append(el('li', 'leyenda__nota', `Relleno al ${fmt.format(estado.opacidad)} %, sin mapa base de calles.`));
    leyenda.append(itemLeyenda(null, 'Límite de departamento', 'leyenda__muestra--limite'));
    mapa.elegir(estado.elegido);
}

function textoDistrito(clave) {
    const d = porClave.get(clave);
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
    columnas.push({ id: 'mesas', titulo: 'Mesas' }, { id: 'electores', titulo: 'Electores' });
    if (estado.cargo === '2') columnas.push({ id: 'bancas', titulo: 'Bancas' });
    return columnas;
}

function valorTabla(d, id) {
    switch (id) {
        case 'nombre': return d.nombre;
        case 'departamento': return d.departamento_nombre;
        case 'ganadora': return d.ganadora;
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
                td.append(muestra, d.ganadora);
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
        `Porcentajes y ventaja (en puntos) sobre los votos a listas ${CARGOS[estado.cargo].de}; participación sobre los electores de las mesas con acta. ` +
        'Mesas: con acta / esperadas cuando falta alguna.' +
        (estado.capa === 'ipm' && ipm ? ` ${indicadorIpm().nombre}${EN_AREA[estado.area]}: INE, Censo 2022 («—», sin dato).` : '') +
        ' Tocá un distrito para verlo en el mapa.';
}

function metricaRanking() {
    const p = partidos.get(estado.partido);
    return {
        ganadora: { titulo: 'Distritos por porcentaje de la lista más votada', valor: (d) => d.pct_ganadora, color: (d) => d.gana.color,
                    texto: (v, d) => `${pct.format(v)} % ${d.ganadora}` },
        participacion: { titulo: 'Distritos por participación', valor: participacionDe, color: () => PARTICIPACION_COLOR, texto: (v) => `${pct.format(v)} %` },
        ventaja: { titulo: 'Distritos por ventaja del primero', valor: (d) => (d.segunda ? d.ventaja : null), color: (d) => d.gana.color,
                   texto: (v, d) => `${pct.format(v)} pts ${d.ganadora}` },
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
        const candidato = estado.cargo === '1' ? d.listas[s].candidato : null;
        li.append(muestra, el('strong', null, s), `${candidato ? ` ${candidato}` : ''} ${pct.format(pctDe(d, s))} % · ${fmt.format(d.votos[s])} votos`);
        cuerpo.append(li);
    }
    const v = participacionDe(d);
    const pobreza = estado.capa === 'ipm' && ipm ? ` · ${textoDistrito(d.clave).slice(`${d.nombre} (${d.departamento_nombre}): `.length)}` : '';
    $('fichaDetalle').textContent = d.clave === ASUNCION ? 'Abrir Asunción mesa por mesa' : 'Abrir el tablero';
    ficha.abrir({ eyebrow: `Distrito · ${d.departamento_nombre} · ${CARGOS[estado.cargo].nombre}`, titulo: d.nombre,
                  meta: `${fmt.format(d.mesas.con_acta)} de ${fmt.format(d.mesas.esperadas)} mesas con acta${v === null ? '' : ` · participación ${pct.format(v)} %`}${pobreza}`,
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
    const faltan = distritos.filter((d) => d.mesas.esperadas > d.mesas.con_acta);
    const corte = contexto.anio.fuentes?.trep?.corte;
    caja.append(seccion('Resultados', listaDef([
        ['Fuente', e.fuente],
        ['Corte', `${corte ? fechaLarga(corte) : fechaLarga(e.corte)}. ${e.corte_base}`],
        ['Aviso', e.aviso],
        ['Cargo', `${cargosDelPais().length > 1 ? 'Intendencia y Junta Municipal' : 'Junta Municipal'} en los ${fmt.format(distritos.length)} distritos; ` +
                  `las cifras de esta vista son ${CARGOS[estado.cargo].de}.`],
        ...(porCargo['1'] ? [['Intendencia', 'Planillas uninominales del TREP (Justicia Electoral): una fila por mesa y lista. Cada lista tiene una ' +
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
    caja.append(seccion('Cobertura', el('p', null, `${CARGOS[estado.cargo].nombre}: ${fmt.format(t.mesas)} de ${fmt.format(t.esperadas)} mesas con acta en ${fmt.format(t.distritos)} distritos; ` +
        `${cantidad(t.esperadas - t.mesas, 'mesa', 'mesas')} sin acta en ${cantidad(faltan.length, 'distrito', 'distritos')}. Una mesa sin acta no se completa ni se estima.`),
    ...(faltan.length ? [cajaTabla] : [])));
    caja.append(seccion('Electores y límites', listaDef([
        ['Electores', `Recuento agregado del padrón por mesa, sin datos de personas: ${fmt.format(t.padron)} electores en el padrón y ` +
                      `${fmt.format(t.electores)} en las mesas con acta.`],
        ['Límites', 'INE, Cartografía digital del CNPV 2022 (límites referenciales), simplificados para el mapa del país; Licencia de Uso de Información Pública.'],
        ['Códigos', 'Los códigos del TSJE y del INE no coinciden: cada distrito del TSJE se unió con su par del INE por el nombre, dentro del departamento.'],
        ['Nombres', 'Los del INE, con tildes; el TSJE los escribe en mayúsculas y a veces abreviados.'],
    ])));
    const enlace = el('a', null, 'nacional/procedencia.json');
    enlace.href = new URL('procedencia.json', carpetaNacional(contexto.eleccion.id, contexto.anio.anio)).href;
    const procedencia = seccion('Procedencia (SHA-256)', el('p', null, 'Huellas de las planillas del TSJE, del catálogo del TREP y de la cartografía del INE: '), enlace);
    try {
        const p = await archivoNacional(contexto.eleccion.id, contexto.anio.anio, 'procedencia.json');
        const items = [...Object.entries(p.fuentes?.planillas ?? {}),
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
    caja.append(seccion('Cifras de cada distrito', listaDef([
        ['Lista más votada', 'La que tiene más votos a listas del cargo de la barra (Intendencia o Junta Municipal) en el distrito.'],
        ['Intendencia', 'Una candidatura por lista y sin bancas. Las alianzas y los movimientos locales van en verde, como en la Junta.'],
        ['Participación', 'Votos emitidos / electores habilitados de las mesas con acta (recuento del padrón por mesa).'],
        ['Ventaja', '100 × (votos del primero − votos del segundo) / votos a listas, en puntos.'],
        ['Votos de un partido', 'Sus votos sobre los votos a listas del distrito; sin lista propia, el distrito va en gris.'],
        ['Bancas', 'La integración oficial de la Junta según el TREP; el D\'Hondt sobre los votos por lista da el mismo reparto en todos los distritos.'],
    ])));
    caja.append(seccion('El país y los departamentos', listaDef([
        ['Sumas', 'Votos, mesas, electores y bancas sumados distrito por distrito.'],
        ['Partidos y alianzas', 'Los partidos se suman por sigla. Las alianzas y los movimientos locales (cada uno de un solo distrito) van juntos; ' +
                                'donde un partido va dentro de una alianza, sus votos son de la alianza.'],
        ['Colores', 'Los partidos con su color (ANR rojo, PLRA azul y un color fijo para cada uno de los demás); las alianzas y los movimientos ' +
                    'locales en verde, con tonos distintos si un distrito tiene más de uno.'],
        ['Tramos', 'Participación y votos de un partido: cinco tramos de igual ancho entre el menor y el mayor de los distritos a la vista.'],
    ])));
    caja.append(seccion('Pobreza multidimensional (IPM)', listaDef([
        ['Incidencia (H)', 'Porcentaje de personas en situación de pobreza multidimensional (INE, Censo 2022).'],
        ['Intensidad (A)', 'Promedio de privaciones entre las personas en situación de pobreza multidimensional.'],
        ['IPM', 'Incidencia por intensidad: H × A / 100.'],
        ['Área', 'El total del distrito, o solo su área urbana o rural; un área sin población (los distritos solo urbanos no tienen rural) va sin dato.'],
        ['Quintiles', 'En el mapa, los distritos a la vista se agrupan en cinco grupos con casi la misma cantidad de distritos.'],
        ['Lectura', 'Es una comparación entre agregados: no muestra cómo votaron las personas en situación de pobreza ni ningún otro grupo. El IPM es ' +
                    'del Censo 2022 y los votos, de 2026.'],
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
    // El cargo (ADR-024): el del hash si el país lo tiene; si no, el primero que declara el manifiesto (como la barra).
    const disponibles = cargosDelPais();
    usarCargo(cargoDe(disponibles.includes(p.get('cargo')) ? p.get('cargo') : p.get('cargo') === '1' || p.get('cargo') === '2'
        ? CARGOS[p.get('cargo')].clave : disponibles[0]));
    const dep = p.get('departamento');
    estado.departamento = /^\d{1,2}$/.test(dep ?? '') && porDep.has(Number(dep)) ? Number(dep) : null;
    const elegido = p.get('elegido') ?? (!TABLERO_DE_DISTRITO && p.get('distrito') !== ASUNCION ? p.get('distrito') : null);
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
            if (estado.orden?.id === 'bancas' && estado.cargo !== '2') estado.orden = null;
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

// La llama inicio.js con el contexto (elección y año) y la lista de distritos.
export async function iniciar({ contexto: ctx } = {}) {
    const visor = $('visor');
    try {
        contexto = ctx;
        const { eleccion, anio } = ctx;
        const [datos, geoDistritos, geoDepartamentos, coloresNacionales] = await Promise.all([indiceNacional(eleccion.id, anio.anio),
            geoNacional(eleccion.id, anio.anio, 'distritos'), geoNacional(eleccion.id, anio.anio, 'departamentos'),
            archivoNacional(eleccion.id, anio.anio, 'colores.json')]);
        colores = coloresNacionales;
        preparar(datos);
        $('tituloTablero').textContent = `${anio.fuentes?.trep?.nombre ?? 'TREP'} · ${eleccion.nombre} ${anio.anio} · ${anio.nacional?.nombre ?? 'Paraguay'}`;
        if (datos.eleccion.aviso) $('avisoLegal').append(` ${datos.eleccion.aviso}`);
        $('enlaceAsuncion').href = enlaceTablero(ASUNCION);
        // La leyenda y la atribución van superpuestas al mapa, también en pantalla completa.
        $('mapa').append($('leyendaMapa'), $('atribucionMapa'));
        const pais = indice.departamentos.reduce((c, d) => [Math.min(c[0], d.caja[0]), Math.min(c[1], d.caja[1]), Math.max(c[2], d.caja[2]), Math.max(c[3], d.caja[3])],
            [Infinity, Infinity, -Infinity, -Infinity]);
        mapa = crearMapaPais({ distritos: geoDistritos, departamentos: geoDepartamentos },
            { distritos: distritos.map((d) => ({ clave: d.clave, nombre: d.nombre, centro: d.centro })), departamentos: indice.departamentos },
            $('mapa'), { etiqueta: `Mapa de Paraguay con los ${fmt.format(distritos.length)} distritos coloreados según la capa elegida`, atribucion: $('atribucionMapa'), pais,
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
