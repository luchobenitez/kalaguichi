// Finanzas municipales · Histórico (ADR-044; tarea M56): la página /analisis/financiero/historico/. Lee el manifiesto del
// histórico, el índice del país del sitio (nombres, departamentos y centros de hoy) y el año elegido; arma los filtros
// (año, departamento, municipio, indicador y montos, en el enlace), un mapa coroplético con los distritos de ese año (los
// creados después, dentro del distrito del que se separaron; ADR-043), su leyenda, la cobertura, la tabla del balance y
// del estado de resultados con su ficha y su CSV, y la evolución del municipio elegido en todos los años (guaraníes de
// 2025 con el IPC del BCP o de cada año). Al filtrar se vuelve a pintar el mismo mapa; al cambiar de año, el mapa se
// rearma solo si los distritos de ese año son otros. Sin HTML desde datos.
import { $, el, fmt } from '../tablero/util.js';
import { geoNacional, indiceNacional } from '../datos.js';
import { crearMapaPais } from '../tablero/mapa_pais.js';
import { enlaceOsm } from '../tablero/base_pais.js';
import { descargar, nombreArchivo, cargarChart, colores as coloresTema } from '../analisis/exportar.js';
import * as H from './historico_logica.js';

const CARPETA = new URL('../../../datos/finanzas/municipalidad/historico/', import.meta.url);
const PAGINA_2025 = new URL('../../../analisis/financiero/2025/', import.meta.url);
const lecturas = new Map();
// Cada archivo se pide una sola vez en la sesión.
function leer(nombre) {
    if (!lecturas.has(nombre)) {
        lecturas.set(nombre, fetch(new URL(nombre, CARPETA), { credentials: 'omit', referrerPolicy: 'no-referrer' }).then((r) => {
            if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status}`);
            return r.json();
        }));
    }
    return lecturas.get(nombre);
}

let cat = null;          // el catálogo (manifiesto)
let indice = null;       // el índice del país (municipales 2026)
const anios = new Map(); // año → modelo del año (los ya leídos)
let am = null;           // el modelo del año a la vista
let estado = null;
let info = null;
let mapa = null;
let geoDelMapa = null;   // la geometría con la que se armó el mapa
let turnoMapa = 0;
let encuadre;
let grafico = null;
const tabla = { pagina: 0, orden: null, busqueda: '' };
const oscuro = () => document.documentElement.dataset.theme === 'dark';
const ordenarPorNombre = (lista) => [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
const cantidad = (n, uno, varios) => `${fmt.format(n)} ${n === 1 ? uno : varios}`;
const geoDe = (g) => (g.distritos ? `${g.distritos.eleccion}-${g.distritos.anio}` : 'municipales-2026');

async function cargarAnio(anio) {
    if (!anios.has(anio)) anios.set(anio, H.crearAnio(cat, await leer(`anios/${anio}.json`), indice));
    return anios.get(anio);
}

// --- Estado y enlace ----------------------------------------------------------------------------------------------------
function escribirEnlace() {
    const hash = H.textoEstado(estado);
    if (hash !== location.hash.slice(1)) history.replaceState(null, '', `#${hash}`);
}

function mostrarMensajes(mensajes) {
    const nodo = $('mensajeFiltros');
    nodo.textContent = mensajes.join(' ');
    nodo.hidden = !mensajes.length;
}

function aplicar(mensajes = []) {
    info = H.conjunto(am, estado);
    if (estado.municipio !== null && !info.claves.has(estado.municipio)) {
        estado = { ...estado, municipio: null };
        mensajes = [...mensajes, 'El municipio elegido quedó fuera del filtro: se quitó la selección.'];
    }
    reflejarControles();
    dibujarCabecera();
    pintarMapa();
    dibujarLeyenda();
    dibujarIndicador();
    dibujarAmbito();
    dibujarDato();
    dibujarCobertura();
    dibujarTabla();
    dibujarEvolucion();
    dibujarMetodo();
    escribirEnlace();
    mostrarMensajes(mensajes);
}

// Un año nuevo: se lee (una vez), se ajustan el departamento y el municipio, y el mapa se rearma si sus distritos son otros.
async function irAlAnio(anio, mensajes = []) {
    const main = $('contenido');
    main.dataset.listo = 'false';
    try {
        am = await cargarAnio(anio);
    } catch (error) {
        mostrarMensajes([`No fue posible leer los datos de ${anio}.`]);
        console.error(error);
        main.dataset.listo = 'error';
        return;
    }
    const r = H.ajustarAlAnio({ ...estado, anio }, am);
    estado = r.estado;
    tabla.pagina = 0;
    aplicar([...mensajes, ...r.avisos]);
    main.dataset.listo = 'true';
    if (mapa !== null && geoDe(am.geometria) !== geoDelMapa) await armarMapa();
}

// --- Controles ----------------------------------------------------------------------------------------------------------
function armarControles() {
    const sAnio = $('filtroAnio');
    // Solo los años con datos, rotulados con el año (M57); los sin datos y su motivo están en el método.
    for (const a of [...cat.anios].reverse().filter((x) => x.estado === 'con_datos')) sAnio.append(new Option(String(a.anio), String(a.anio)));
    sAnio.addEventListener('change', () => irAlAnio(Number(sAnio.value)));
    const sDep = $('filtroDepartamento');
    for (const d of indice.departamentos.slice().sort((a, b) => a.codigo - b.codigo)) sDep.append(new Option(d.nombre, String(d.codigo)));
    sDep.addEventListener('change', () => {
        estado = { ...estado, departamento: sDep.value === '' ? null : Number(sDep.value) };
        tabla.pagina = 0;
        aplicar();
    });
    $('filtroMunicipio').addEventListener('change', (evento) => elegirMunicipio(evento.target.value || null));
    const sInd = $('filtroIndicador');
    for (const grupo of H.GRUPOS) {
        const og = el('optgroup');
        og.label = grupo;
        for (const c of cat.campos.filter((x) => x.grupo === grupo)) og.append(new Option(`${c.nombre} (${H.UNIDAD_CORTA[c.unidad] ?? c.unidad})`, c.campo));
        sInd.append(og);
    }
    sInd.addEventListener('change', () => {
        estado = { ...estado, indicador: sInd.value };
        aplicar();
    });
    for (const boton of $('filtroMontos').querySelectorAll('button[data-montos]')) {
        boton.addEventListener('click', () => {
            if (estado.montos === boton.dataset.montos) return;
            estado = { ...estado, montos: boton.dataset.montos };
            aplicar();
        });
    }
    for (const boton of $('serieMontos').querySelectorAll('button[data-serie]')) {
        boton.addEventListener('click', () => {
            if (estado.serie === boton.dataset.serie) return;
            estado = { ...estado, serie: boton.dataset.serie };
            dibujarEvolucion();
            reflejarControles();
            escribirEnlace();
        });
    }
    $('restablecerFiltros').addEventListener('click', () => {
        const anio = estado.anio;
        estado = { ...H.estadoInicial(cat), anio };
        Object.assign(tabla, { pagina: 0, orden: null, busqueda: '' });
        $('buscarMunicipio').value = '';
        aplicar(['Se restableció la vista nacional del año con los valores iniciales.']);
    });
}

function reflejarControles() {
    $('filtroAnio').value = String(estado.anio);
    $('filtroDepartamento').value = estado.departamento === null ? '' : String(estado.departamento);
    const sMun = $('filtroMunicipio');
    const opciones = [new Option(`Todos (${fmt.format(info.municipios.length)})`, '')];
    if (estado.departamento === null) {
        const porDep = new Map();
        for (const m of info.municipios) porDep.set(m.departamento, [...(porDep.get(m.departamento) ?? []), m]);
        for (const lista of [...porDep.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1])) {
            const grupo = el('optgroup');
            grupo.label = lista[0].departamento_nombre;
            grupo.append(...ordenarPorNombre(lista).map((m) => new Option(m.nombre, m.clave)));
            opciones.push(grupo);
        }
    } else {
        opciones.push(...ordenarPorNombre(info.municipios).map((m) => new Option(m.nombre, m.clave)));
    }
    sMun.replaceChildren(...opciones);
    sMun.value = estado.municipio ?? '';
    $('filtroIndicador').value = estado.indicador;
    for (const boton of $('filtroMontos').querySelectorAll('button[data-montos]')) boton.setAttribute('aria-pressed', String(boton.dataset.montos === estado.montos));
    for (const boton of $('serieMontos').querySelectorAll('button[data-serie]')) boton.setAttribute('aria-pressed', String(boton.dataset.serie === estado.serie));
    $('todasLasColumnas').checked = estado.columnas === 'todas';
}

function elegirMunicipio(clave) {
    estado = { ...estado, municipio: clave };
    tabla.pagina = 0;
    aplicar();
}

// --- Cabecera -----------------------------------------------------------------------------------------------------------
function dibujarCabecera() {
    $('tituloHistorico').textContent = `Finanzas municipales · Ejercicio ${am.anio}`;
    document.title = `Kalaguichi.com · Finanzas municipales · Ejercicio ${am.anio}`;
    const f = am.fuente;
    const corte = `Ejercicio ${am.anio}: balance general al 31 de diciembre y estado de resultados del año, del Informe Financiero ${am.anio} del MEF ` +
        `(${f.tomo}${f.escala === 'millones de guaraníes' ? ', en millones de guaraníes' : ''}).`;
    $('corteFinanzas').textContent = corte;
    $('formatoAnio').textContent = `Formato de ${am.anio}: ${cat.formatos[am.formato]}`;
    $('advertenciaFinanzas').textContent = cat.manifiesto.advertencia;
    const nodo = $('aviso2025');
    nodo.hidden = am.anio !== 2025;
    for (const a of document.querySelectorAll('[data-fuente-anio]')) {
        a.href = f.url;
        a.textContent = `Fuente oficial: MEF · Informe Financiero ${am.anio}${f.archivo_web ? ' (copia del Wayback Machine)' : ''}`;
        if (f.archivo_web) a.href = f.archivo_web;
        a.title = `${f.tomo}. Se abre en otra pestaña.`;
    }
}

// --- Mapa ---------------------------------------------------------------------------------------------------------------
async function armarMapa() {
    const turno = ++turnoMapa;
    const caja = $('mapaFinanzas');
    const g = am.geometria;
    try {
        const [distritos, departamentos] = await Promise.all([geoNacional(g.eleccion, g.anio, 'distritos'), geoNacional(g.eleccion, g.anio, 'departamentos')]);
        if (turno !== turnoMapa) return;
        if (mapa?.map) mapa.map.remove();
        mapa = null;
        caja.replaceChildren();
        const pais = indice.departamentos.reduce((c, d) => [Math.min(c[0], d.caja[0]), Math.min(c[1], d.caja[1]), Math.max(c[2], d.caja[2]), Math.max(c[3], d.caja[3])],
            [Infinity, Infinity, -Infinity, -Infinity]);
        const pie = el('p', 'mapa__atribucion');
        caja.append(pie);
        const api = crearMapaPais({ distritos, departamentos },
            { distritos: am.municipios.map((m) => ({ clave: m.clave, nombre: m.nombre, centro: m.centro })), departamentos: indice.departamentos }, caja,
            { etiqueta: `Mapa de Paraguay con los distritos de ${am.anio}: finanzas municipales del ejercicio ${am.anio}`, atribucion: pie, pais, estadosExtra: true,
              texto: (clave) => nodoMunicipio(clave, '\n'), alTocar: tocar, alCambiarTema: () => { pintarMapa(); dibujarLeyenda(); },
              leyendas: () => [document.querySelector('.finanzas__leyenda-caja')] });
        pie.replaceChildren(enlaceOsm(), ` (ODbL) · Protomaps · Límites: INE (CNPV 2022), con los distritos de ${am.anio} · Finanzas: MEF, Informe Financiero ${am.anio}`);
        pie.title = 'Mapa base: rutas, ríos y arroyos de OpenStreetMap (ODbL), del build de Protomaps. Límites referenciales de los distritos y los ' +
            `departamentos: INE, Cartografía digital del CNPV 2022, simplificados; los distritos creados después de ${am.anio}, dentro del distrito del que se ` +
            `separaron (ADR-043). Finanzas: Ministerio de Economía y Finanzas (MEF), Informe Financiero ${am.anio}.`;
        mapa = api;
        geoDelMapa = geoDe(g);
        encuadre = undefined;
        pintarMapa();
        await api.listo;
        $('contenido').dataset.mapa = 'listo';
    } catch (error) {
        mapa = null;
        caja.replaceChildren(el('p', 'mapa__sin-mapa', 'No se pudo mostrar el mapa en este navegador (necesita WebGL). La tabla, la ficha y la evolución siguen disponibles.'));
        $('contenido').dataset.mapa = 'sin-mapa';
        console.warn(error);
    }
}

function pintarMapa() {
    if (!mapa) return;
    mapa.pintar(am.municipios.map((m) => m.clave), H.pintura(cat, am, estado, info.claves, oscuro()));
    mapa.elegir(estado.municipio);
    if (estado.departamento !== encuadre) {
        const animar = encuadre !== undefined;
        encuadre = estado.departamento;
        mapa.encuadrar(encuadre === null ? null : am.departamentos.find((d) => d.codigo === encuadre)?.caja ?? null, { animar });
    }
}

function tocar(clave) {
    if (info.claves.has(clave)) {
        elegirMunicipio(clave);
        return;
    }
    $('datoFinanzas').replaceChildren(nodoMunicipio(clave, ' · '), '. Para elegirlo, ampliá el filtro.');
}

function nodoMunicipio(clave, separador) {
    const lineas = H.lineasMunicipio(cat, am, estado, info, clave);
    if (!lineas) return null;
    const nodo = document.createDocumentFragment();
    lineas.forEach((partes, i) => {
        if (i) nodo.append(separador);
        partes.forEach((parte, k) => { if (parte) nodo.append(k === 1 ? el('strong', 'finanzas__falta', parte) : parte); });
    });
    return nodo;
}

function dibujarLeyenda() {
    const l = H.leyenda(cat, am, estado, info, oscuro());
    $('tituloLeyenda').textContent = l.titulo;
    $('leyendaFinanzas').replaceChildren(...l.items.map((item) => {
        const li = el('li', `finanzas__leyenda-item finanzas__leyenda-item--${item.tipo}`);
        const muestra = el('span', `leyenda__muestra finanzas__muestra finanzas__muestra--${item.tipo}`);
        if (item.color) muestra.style.background = item.color;
        li.append(muestra, el('span', null, item.texto), el('span', 'finanzas__leyenda-n', `(${fmt.format(item.n)})`));
        return li;
    }));
    $('notaLeyenda').textContent = l.nota;
}

function dibujarDato() {
    const nodo = $('datoFinanzas');
    if (estado.municipio === null) {
        nodo.textContent = matchMedia('(hover: hover)').matches ? 'Pasá el puntero por un municipio para ver su dato; tocalo para elegirlo.'
            : 'Tocá un municipio para elegirlo y ver su dato.';
        $('accionesMunicipio').hidden = true;
        return;
    }
    nodo.replaceChildren(nodoMunicipio(estado.municipio, ' · '));
    $('accionesMunicipio').hidden = false;
}

// --- Indicador, ámbito y cobertura --------------------------------------------------------------------------------------
function dibujarIndicador() {
    const m = cat.porCampo.get(estado.indicador);
    const dl = el('dl', 'finanzas__indicador-datos');
    const fila = (dt, dd) => dl.append(el('dt', null, dt), el('dd', null, dd));
    fila('Unidad', m.unidad === 'PYG' ? `${H.ROTULO_MONTOS[estado.montos]} (Gs.)${estado.montos === 'constantes'
        ? `: los de ${am.anio} multiplicados por ${String(H.factor(cat, m.campo, am.anio, 'constantes')).replace('.', ',')} (IPC del BCP, ${m.tipo === 'flujo' ? 'promedio del año' : 'diciembre'})` : ''}`
        : m.unidad === '%' ? 'Porcentaje (puntos porcentuales)' : 'Veces (razón)');
    fila('Definición', m.definicion);
    if (m.justificacion) fila('Justificación', m.justificacion);
    if (m.limitacion) fila('Límites', m.limitacion);
    const comparable = { totales: 'todos los años con datos', rotulos: 'desde 2008 (en 2004 y 2005 no es comparable)', codigos: 'desde 2012 (antes no es comparable)' };
    fila('Comparable', comparable[m.desde]);
    const con = am.municipios.filter((x) => am.valor(x.clave, m.campo) !== null).length;
    fila('Cobertura', `Con dato en ${fmt.format(con)} de ${fmt.format(am.informantes)} municipios con balance en ${am.anio}; ` +
        `${fmt.format(am.municipios.length - am.informantes)} sin balance en el informe (gris liso).`);
    $('fichaIndicador').replaceChildren(el('p', 'finanzas__indicador-rotulo', m.rotulo), el('h2', 'finanzas__indicador-nombre', m.nombre), dl);
}

function dibujarAmbito() {
    const partes = [`Ejercicio ${am.anio}`];
    if (estado.departamento !== null) partes.push(am.departamentos.find((d) => d.codigo === estado.departamento).nombre);
    let texto = `Mostrando: ${partes.join(' · ')} — ${cantidad(info.municipios.length, 'municipio', 'municipios')} del mapa de ese año ` +
        `(${fmt.format(info.informantes)} con balance, ${fmt.format(info.sinInforme)} sin balance)`;
    if (estado.municipio !== null) texto += `. Municipio elegido: ${am.porClave.get(estado.municipio).nombre}`;
    $('ambitoFinanzas').textContent = `${texto}.`;
}

function dibujarCobertura() {
    const a = cat.porAnio.get(am.anio);
    const dl = el('dl', 'finanzas__cobertura-datos');
    const fila = (dt, dd) => dl.append(el('dt', null, dt), typeof dd === 'string' ? el('dd', null, dd) : (() => { const n = el('dd'); n.append(dd); return n; })());
    const sin = am.municipios.filter((m) => m.estado === 'sin_informe');
    fila('Municipios del mapa', `${fmt.format(am.municipios.length)} distritos en ${am.anio}: ${fmt.format(am.informantes)} con balance en el informe del MEF y ` +
        `${fmt.format(sin.length)} sin balance${sin.length && sin.length <= 40 ? ` (${ordenarPorNombre(sin).map((m) => m.nombre).join(', ')})` : ''}.`);
    if (a.nota_mef !== undefined) {
        fila('Nota del MEF', a.nota_mef === am.informantes ? `El tomo dice que refleja la situación patrimonial de ${fmt.format(a.nota_mef)} municipalidades: las mismas que se leyeron.`
            : `El tomo dice que refleja la situación patrimonial de ${fmt.format(a.nota_mef)} municipalidades, pero trae los estados de ${fmt.format(am.informantes)} ` +
              '(la nota repite la del año anterior).');
    }
    const unidos = Object.keys(am.unidos).length;
    fila('Distritos de entonces', unidos ? `El mapa es el de la última elección hasta el 31 de diciembre de ${am.anio} (${am.geometria.eleccion} ${am.geometria.anio}): ` +
        `${fmt.format(unidos)} distritos abarcaban el territorio de otros creados después (ADR-043).` : `El mapa es el de los ${fmt.format(am.municipios.length)} distritos de hoy.`);
    const conNotas = am.municipios.filter((m) => m.registro?.notas?.some((n) => !['abarca', 'codigo_mef_distinto'].includes(n))).length;
    fila('Controles', `Cada balance cuadra (activo = pasivo + patrimonio + resultado, contra los subtotales que publica el propio estado) y cada estado ` +
        `de resultados también (ingresos − egresos = resultado). ${conNotas ? `${cantidad(conNotas, 'municipio tiene', 'municipios tienen')} una nota sobre ` +
        'cómo se leyó alguna cifra (en su ficha).' : 'Ningún municipio necesitó correcciones con los subtotales.'}`);
    $('coberturaFinanzas').replaceChildren(dl);
}

// --- Tabla --------------------------------------------------------------------------------------------------------------
const valorOrden = (m, id) => {
    if (id === 'municipio') return m.nombre;
    if (id === 'estado') return m.estado === 'informante' ? 'Con balance' : 'Sin balance';
    return am.valor(m.clave, id, estado.montos);
};

function armarTabla() {
    $('buscarMunicipio').addEventListener('input', (evento) => {
        tabla.busqueda = evento.target.value;
        tabla.pagina = 0;
        dibujarTabla();
    });
    $('todasLasColumnas').addEventListener('change', (evento) => {
        estado = { ...estado, columnas: evento.target.checked ? 'todas' : 'resumen' };
        dibujarTabla();
        escribirEnlace();
    });
    $('tablaFinanzas').addEventListener('click', (evento) => {
        const orden = evento.target.closest('[data-columna]');
        if (orden) {
            const id = orden.dataset.columna;
            const texto = id === 'municipio' || id === 'estado';
            tabla.orden = tabla.orden?.id === id ? { id, dir: -tabla.orden.dir } : { id, dir: texto ? 1 : -1 };
            tabla.pagina = 0;
            dibujarTabla();
            return;
        }
        const elegir = evento.target.closest('[data-elegir]');
        if (elegir) {
            elegirMunicipio(elegir.dataset.elegir);
            return;
        }
        const ficha = evento.target.closest('[data-ficha]');
        if (ficha) abrirFicha(ficha.dataset.ficha);
    });
    $('paginaAnterior').addEventListener('click', () => { tabla.pagina -= 1; dibujarTabla(); });
    $('paginaSiguiente').addEventListener('click', () => { tabla.pagina += 1; dibujarTabla(); });
    $('descargarCsvFinanzas').addEventListener('click', descargarCsv);
    $('verTodosMunicipios').addEventListener('click', () => elegirMunicipio(null));
    $('verFichaElegido').addEventListener('click', () => abrirFicha(estado.municipio));
    $('verEvolucionElegido').addEventListener('click', () => $('evolucion').scrollIntoView({ block: 'start' }));
    $('quitarSeleccion').addEventListener('click', () => elegirMunicipio(null));
}

function dibujarTabla() {
    const visibles = H.columnas(cat, estado);
    const filas = H.filasTabla(am, estado, info, { busqueda: tabla.busqueda, orden: tabla.orden, valor: valorOrden });
    const paginas = Math.max(1, Math.ceil(filas.length / H.POR_PAGINA));
    tabla.pagina = Math.min(Math.max(0, tabla.pagina), paginas - 1);
    const pagina = filas.slice(tabla.pagina * H.POR_PAGINA, (tabla.pagina + 1) * H.POR_PAGINA);
    const t = $('tablaFinanzas');
    if (!t.tHead) t.createTHead();
    if (!t.tBodies.length) t.createTBody();
    if (!t.caption) t.createCaption();
    t.caption.textContent = `Balance y estado de resultados ${am.anio} por municipio (${H.ROTULO_MONTOS[estado.montos].toLowerCase()}; Informe Financiero del MEF)`;
    const cabeza = el('tr');
    const encabezado = (id, texto, clase) => {
        const th = el('th', clase);
        th.scope = 'col';
        const boton = el('button', 'tabla__orden', texto);
        boton.type = 'button';
        boton.dataset.columna = id;
        if (tabla.orden?.id === id) th.setAttribute('aria-sort', tabla.orden.dir > 0 ? 'ascending' : 'descending');
        th.append(boton);
        return th;
    };
    cabeza.append(encabezado('municipio', 'Municipio', 'tabla__texto'), encabezado('estado', 'Balance', 'tabla__texto'),
        ...visibles.map((c) => encabezado(c.campo, `${c.nombre} (${H.UNIDAD_CORTA[c.unidad] ?? c.unidad})`)));
    const fuente = el('th', 'tabla__texto', `Páginas (${am.fuente.tomo})`);
    fuente.scope = 'col';
    cabeza.append(fuente);
    t.tHead.replaceChildren(cabeza);
    const cuerpo = document.createDocumentFragment();
    for (const m of pagina) {
        const tr = el('tr');
        tr.dataset.clave = m.clave;
        if (m.clave === estado.municipio) tr.classList.add('es-seleccion');
        const th = el('th', 'tabla__texto finanzas__celda-municipio');
        th.scope = 'row';
        const nombre = el('button', 'finanzas__elegir', m.nombre);
        nombre.type = 'button';
        nombre.dataset.elegir = m.clave;
        nombre.title = `Elegir ${m.nombre} en el mapa y en los filtros`;
        const ficha = el('button', 'finanzas__abrir-ficha', 'Ficha');
        ficha.type = 'button';
        ficha.dataset.ficha = m.clave;
        ficha.setAttribute('aria-label', `Ficha completa de ${m.nombre} en ${am.anio}`);
        const segunda = el('span', 'finanzas__celda-segunda');
        segunda.append(el('span', 'finanzas__celda-departamento', m.departamento_nombre), ficha);
        th.append(nombre, segunda);
        tr.append(th);
        const informe = el('td', 'tabla__texto', m.estado === 'informante' ? 'Con balance' : 'Sin balance');
        if (m.estado !== 'informante') {
            informe.classList.add('finanzas__sin-informe');
            informe.title = H.TEXTO.sinInforme;
        }
        tr.append(informe);
        for (const c of visibles) {
            const v = m.estado === 'informante' ? am.valor(m.clave, c.campo, estado.montos) : null;
            const td = el('td', v === null ? 'finanzas__nd' : null, H.numeroCelda(v, c.unidad));
            td.title = m.estado !== 'informante' ? H.TEXTO.sinInforme : am.estado(m.clave, c.campo).texto;
            tr.append(td);
        }
        tr.append(el('td', 'tabla__texto', textoPaginasCorto(m.clave) ?? H.TEXTO.nd));
        cuerpo.append(tr);
    }
    t.tBodies[0].replaceChildren(cuerpo);
    t.dataset.filas = String(filas.length);
    t.dataset.columnas = String(visibles.length);
    $('paginaActual').textContent = `Página ${tabla.pagina + 1} de ${paginas} · ${cantidad(filas.length, 'municipio', 'municipios')}`;
    $('paginaAnterior').disabled = tabla.pagina === 0;
    $('paginaSiguiente').disabled = tabla.pagina >= paginas - 1;
    $('verTodosMunicipios').hidden = estado.municipio === null;
    $('notaTabla').textContent = `${filas.length ? '' : 'Ningún municipio cumple el filtro y la búsqueda. '}N/D: dato no disponible (sin balance en el informe, ` +
        'cuenta no expuesta o no comparable en el formato del año): pasá el puntero por la celda para ver su estado. ' +
        `Columnas a la vista: ${visibles.length} de ${cat.campos.length}. Sin totales ni promedios: cada fila es un municipio.`;
}

function textoPaginasCorto(clave) {
    const p = am.paginas(clave);
    if (!p) return null;
    const rango = (l) => (l.length === 1 ? String(l[0]) : `${l[0]}-${l[l.length - 1]}`);
    return [p.balance.length ? rango(p.balance) : null, p.resultados.length ? rango(p.resultados) : null].filter(Boolean).join('; ') || null;
}

function descargarCsv() {
    const filas = H.filasTabla(am, estado, info, { busqueda: tabla.busqueda, orden: tabla.orden, valor: valorOrden });
    const columnas = [
        { titulo: 'ejercicio', v: () => am.anio },
        { titulo: 'departamento', v: (m) => m.departamento_nombre },
        { titulo: 'municipio', v: (m) => m.nombre },
        { titulo: 'clave_distrito', v: (m) => m.clave },
        { titulo: 'abarca', v: (m) => (m.abarca ? m.abarca.join(' ') : null) },
        { titulo: 'nombre_mef', v: (m) => m.registro?.nombre_mef ?? null },
        { titulo: 'codigo_mef', v: (m) => m.registro?.codigo_mef ?? null },
        { titulo: 'estado_documental', v: (m) => (m.estado === 'informante' ? 'con_balance' : 'sin_balance') },
        { titulo: 'montos', v: () => estado.montos },
        ...cat.campos.map((c) => ({ titulo: c.campo, v: (m) => (m.estado === 'informante' ? am.valor(m.clave, c.campo, estado.montos) : null) })),
        ...cat.campos.filter((c) => c.naturaleza === 'publicado').map((c) => ({ titulo: `estado_${c.campo}`, v: (m) => (m.estado === 'informante' ? am.estado(m.clave, c.campo).codigo : null) })),
        { titulo: 'paginas_balance', v: (m) => am.paginas(m.clave)?.balance.join(' ') || null },
        { titulo: 'paginas_resultados', v: (m) => am.paginas(m.clave)?.resultados.join(' ') || null },
        { titulo: 'notas', v: (m) => am.notas(m.clave).join(' | ') || null },
        { titulo: 'fuente_oficial', v: () => `Ministerio de Economía y Finanzas (MEF), Informe Financiero ${am.anio}, ${am.fuente.tomo}` },
        { titulo: 'url_fuente_oficial', v: () => am.fuente.url },
        { titulo: 'archivo_sha256', v: () => am.fuente.sha256 },
    ];
    const ambito = [estado.departamento === null ? null : am.departamentos.find((d) => d.codigo === estado.departamento).nombre,
                    estado.municipio === null ? null : am.porClave.get(estado.municipio).nombre, estado.montos === 'constantes' ? 'guaranies-2025' : null];
    descargar(new Blob([H.textoCsv(columnas, filas)], { type: 'text/csv;charset=utf-8' }), `${nombreArchivo('finanzas-municipales', String(am.anio), ...ambito)}.csv`);
}

// --- Ficha ----------------------------------------------------------------------------------------------------------------
function lista(titulo, filas) {
    const seccion = el('section', 'finanzas__ficha-seccion');
    seccion.append(el('h3', null, titulo));
    const dl = el('dl', 'finanzas__ficha-datos');
    for (const [nombre, valor, detalle, falta] of filas) {
        const dd = el('dd', falta ? 'finanzas__nd' : null, valor);
        if (detalle) dd.append(el('span', 'finanzas__ficha-detalle', detalle));
        dl.append(el('dt', null, nombre), dd);
    }
    seccion.append(dl);
    return seccion;
}

function abrirFicha(clave) {
    const m = am.porClave.get(clave);
    if (!m) return;
    const dialogo = $('fichaMunicipio');
    $('fichaMunicipioTitulo').textContent = `${m.nombre} · ${m.departamento_nombre} · ${am.anio}`;
    const informante = m.estado === 'informante';
    const r = m.registro;
    const resumen = [
        ['Balance', informante ? `En el Informe Financiero ${am.anio} del MEF` : H.TEXTO.sinInforme, null, !informante],
        ['Fuente', H.textoPaginas(am, clave) ?? H.TEXTO.nd, `${am.fuente.archivo} · SHA-256 ${am.fuente.sha256}`],
    ];
    if (informante) {
        resumen.push(['Nombre en el informe', r.nombre_mef ?? H.TEXTO.nd, r.codigo_mef ? `Código de entidad del MEF: ${r.codigo_mef}` : null]);
        resumen.push(['Correspondencia', `Unido con el distrito ${m.clave} del sitio (${String(r.union).replace(/_/g, ' ')})`]);
    }
    if (m.abarca) resumen.push(['Territorio', `En ${am.anio} abarcaba también ${am.abarcados(clave).join(', ')}, creados después (ADR-043).`]);
    const notas = am.notas(clave);
    if (notas.length) resumen.push(['Notas', notas.join(' ')]);
    const montos = estado.montos === 'constantes' ? ' (guaraníes de 2025)' : ` (guaraníes de ${am.anio})`;
    const filas = (grupo) => cat.campos.filter((c) => c.grupo === grupo).map((c) => {
        const v = informante ? am.valor(clave, c.campo, estado.montos) : null;
        const est = informante ? am.estado(clave, c.campo) : null;
        return [c.nombre, H.formato(v, c.unidad), v === null && est ? est.texto : (est && est.codigo === 's' ? est.texto : null), v === null];
    });
    const secciones = [lista('Resumen', resumen), lista(`Balance${montos}`, filas('Balance')), lista(`Estado de resultados${montos}`, filas('Estado de resultados')),
        lista('Indicadores calculados', filas('Indicadores calculados'))];
    const evolucion = el('button', 'boton-secundario', 'Ver su evolución en todos los años');
    evolucion.type = 'button';
    evolucion.addEventListener('click', () => {
        dialogo.close();
        if (estado.municipio !== clave) elegirMunicipio(clave);
        $('evolucion').scrollIntoView({ block: 'start' });
    });
    $('fichaMunicipioCuerpo').replaceChildren(...secciones, evolucion);
    if (!dialogo.open) dialogo.showModal();
}

// --- Evolución --------------------------------------------------------------------------------------------------------------
async function dibujarEvolucion() {
    const caja = $('evolucionCuerpo');
    const metrica = cat.porCampo.get(estado.indicador);
    $('serieMontos').hidden = metrica.unidad !== 'PYG';
    if (estado.municipio === null) {
        if (grafico) { grafico.destroy(); grafico = null; }
        caja.replaceChildren(el('p', 'nota', 'Elegí un municipio (en el mapa, la tabla o el filtro) para ver su evolución en todos los años del histórico.'));
        $('tituloEvolucion').textContent = 'Evolución por municipio';
        return;
    }
    // La clave de hoy del municipio elegido: la del distrito del mapa del año (la misma, o la del que abarcaba otros).
    const clave = estado.municipio;
    const m = am.porClave.get(clave);
    $('tituloEvolucion').textContent = `Evolución de ${m.nombre} · ${metrica.nombre}`;
    const puntos = H.serie(cat, anios, clave, estado.indicador, metrica.unidad === 'PYG' ? estado.serie : 'nominales');
    const eje = H.aniosDelEje(cat);
    const lienzo = el('canvas');
    lienzo.setAttribute('role', 'img');
    lienzo.setAttribute('aria-label', `Evolución de ${metrica.nombre} de ${m.nombre}, ${eje[0]}-${eje[eje.length - 1]}`);
    const contenedor = el('div', 'finanzas__evolucion-grafico');
    contenedor.append(lienzo);
    const t = el('table', 'tabla finanzas__evolucion-tabla');
    t.createCaption().textContent = `${metrica.nombre} de ${m.nombre} por año${metrica.unidad === 'PYG' ? ` (${H.ROTULO_MONTOS[estado.serie].toLowerCase()})` : ''}`;
    const cabeza = el('tr');
    for (const texto of ['Año', 'Valor', 'Estado']) {
        const th = el('th', texto === 'Valor' ? null : 'tabla__texto', texto);
        th.scope = 'col';
        cabeza.append(th);
    }
    t.createTHead().append(cabeza);
    const cuerpo = t.createTBody();
    for (const p of puntos.filter((x) => x.anio >= eje[0]).slice().reverse()) {
        const tr = el('tr');
        const th = el('th', 'tabla__texto', String(p.anio));
        th.scope = 'row';
        const nota = p.estado === 'valor' ? [p.codigo === 's' ? cat.estados.s : null, p.abarca?.length ? 'abarcaba distritos creados después' : null].filter(Boolean).join('; ') || 'publicado'
            : p.texto;
        tr.append(th, el('td', p.valor === null ? 'finanzas__nd' : null, p.valor === null ? H.TEXTO.nd : H.numeroCelda(p.valor, metrica.unidad)),
            el('td', 'tabla__texto', nota));
        cuerpo.append(tr);
    }
    const antes = cat.anios.filter((a) => a.anio < eje[0]).map((a) => a.anio);
    const nota = el('p', 'nota', `${antes.length ? `De ${antes[0]} a ${antes[antes.length - 1]} el MEF no publicó balances municipales. ` : ''}` +
        'Un hueco en la línea es un año sin dato: sin balances ese año, sin balance de este municipio o la cuenta no comparable en ese formato. ' +
        (metrica.unidad === 'PYG' ? (estado.serie === 'constantes' ? 'Montos en guaraníes de 2025: los saldos del balance, con el IPC de diciembre; ingresos, egresos y resultado, con el promedio del año (BCP).'
            : 'Montos en guaraníes de cada año (nominales): no se comparan entre años sin llevarlos a una misma moneda.') : ''));
    const scroll = el('div', 'tabla-scroll');
    scroll.append(t);
    caja.replaceChildren(contenedor, nota, scroll);
    try {
        const Chart = await cargarChart();
        if (!lienzo.isConnected) return;
        const c = coloresTema();
        if (grafico) grafico.destroy();
        const valores = eje.map((a) => puntos.find((p) => p.anio === a)?.valor ?? null);
        grafico = new Chart(lienzo, {
            type: 'line',
            data: { labels: eje.map(String), datasets: [{ label: metrica.nombre, data: valores, borderColor: c.naranja, backgroundColor: c.naranja, spanGaps: false, tension: 0, pointRadius: 3 }] },
            options: { responsive: true, maintainAspectRatio: false, animation: false,
                       plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => H.formato(ctx.parsed.y, metrica.unidad) } } },
                       scales: { x: { ticks: { color: c.suave }, grid: { color: c.borde } },
                                 y: { ticks: { color: c.suave, callback: (v) => (metrica.unidad === 'PYG' ? `${fmt.format(Math.round(v / 1e6))} M` : fmt.format(v)) }, grid: { color: c.borde } } } },
        });
    } catch (error) {
        contenedor.replaceChildren(el('p', 'nota', 'No se pudo dibujar el gráfico; la tabla de abajo trae los mismos valores.'));
        console.warn(error);
    }
}

// --- Fuentes y metodología -------------------------------------------------------------------------------------------------
function enlaceExterno(href, texto) {
    const a = el('a', null, texto);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
}

function bloque(titulo, ...hijos) {
    const seccion = el('section', 'finanzas__metodo-bloque');
    seccion.append(el('h3', null, titulo), ...hijos);
    return seccion;
}

function dibujarMetodo() {
    const man = cat.manifiesto;
    const fuentes = el('ul', 'finanzas__tomos');
    for (const a of [...cat.anios].reverse()) {
        const li = el('li');
        if (a.estado !== 'con_datos') {
            li.append(el('strong', null, `${a.anio}: sin datos. `), a.motivo);
        } else {
            li.append(el('strong', null, `${a.anio}: `), `${a.tomo} — ${fmt.format(a.municipios)} municipios con balance de ${fmt.format(a.distritos_del_mapa)} distritos del mapa.`);
        }
        fuentes.append(li);
    }
    const ipc = man.ipc;
    const ipcTexto = el('p', null, `${ipc.indice} (${ipc.institucion}). ${ipc.metodo} Control: ${fmt.format(ipc.control.meses_en_comun)} meses en común entre la serie ` +
        `empalmada y el informe de septiembre de 2026 (${ipc.control.desde} a ${ipc.control.hasta}), sin diferencias.`);
    const ipcFuentes = el('ul', 'finanzas__tomos');
    for (const f of ipc.fuentes) {
        const li = el('li');
        li.append(`${f.archivo}: ${f.uso}. `, el('span', 'finanzas__huella', `SHA-256: ${f.sha256}`));
        ipcFuentes.append(li);
    }
    const formatos = el('ul', 'finanzas__tomos');
    for (const [k, v] of Object.entries(cat.formatos)) {
        const li = el('li');
        li.append(el('strong', null, `${{ totales: '2004 y 2005', rotulos: '2008 a 2011', codigos: '2012 a 2025' }[k]}: `), v);
        formatos.append(li);
    }
    const descargas = el('ul', 'finanzas__descargas');
    const enlaceDatos = (nombre, texto) => {
        const a = el('a', null, texto);
        a.href = new URL(nombre, CARPETA).href;
        a.download = nombre;
        return a;
    };
    for (const [nombre, texto] of [['manifiesto.json', 'Manifiesto: años, fuentes, formatos, campos e IPC (JSON)'], [`anios/${am.anio}.json`, `Datos de ${am.anio} (JSON)`]]) {
        const li = el('li');
        li.append(enlaceDatos(nombre, texto));
        descargas.append(li);
    }
    const pagina = el('p');
    pagina.append(enlaceExterno(man.pagina_mef, 'MEF · Informes Financieros Anuales'), ' (página oficial de los informes; los enlaces de cada tomo, en el JSON de cada año).');
    $('metodoFinanzas').replaceChildren(
        el('blockquote', 'finanzas__atribucion', man.atribucion),
        bloque('Fuentes por año', pagina, fuentes),
        bloque('Formatos y comparabilidad', formatos),
        bloque('Guaraníes de 2025', ipcTexto, ipcFuentes),
        bloque('Lo que no hace', el('p', null, `${man.advertencia} No suma ni promedia municipios, no califica la gestión y no atribuye los resultados a ` +
            'autoridades electas. Los mapas de cada año usan los distritos de entonces (ADR-043).')),
        bloque('Descargas', descargas));
}

// --- Inicio ---------------------------------------------------------------------------------------------------------------
async function iniciar() {
    const main = $('contenido');
    try {
        const [manifiesto, ind] = await Promise.all([leer('manifiesto.json'), indiceNacional('municipales', 2026)]);
        cat = H.crearCatalogo(manifiesto);
        indice = ind;
    } catch (error) {
        const aviso = el('p', 'finanzas__error', 'No fue posible leer los datos financieros. Revisá la conexión o el servidor local.');
        aviso.setAttribute('role', 'alert');
        main.querySelector('.finanzas__cabecera').after(aviso);
        main.dataset.listo = 'error';
        console.error(error);
        return;
    }
    $('cerrarFicha').addEventListener('click', () => $('fichaMunicipio').close());
    $('enlace2025').href = PAGINA_2025.href;
    armarControles();
    armarTabla();
    const { estado: leido, avisos } = H.leerEstado(location.hash.slice(1), cat);
    estado = leido;
    await irAlAnio(estado.anio, avisos);
    if (main.dataset.listo === 'error') return;
    addEventListener('hashchange', () => {
        if (location.hash.slice(1) === H.textoEstado(estado)) return;
        const r = H.leerEstado(location.hash.slice(1), cat);
        const anio = r.estado.anio;
        estado = r.estado;
        irAlAnio(anio, r.avisos);
    });
    // Los demás años, para la evolución, sin apuro: la vista del año ya está.
    Promise.all(cat.conDatos.map((a) => cargarAnio(a).catch(() => null))).then(() => {
        dibujarEvolucion();
        main.dataset.evolucion = 'lista';
    });
    await armarMapa();
}

iniciar();
