// Sección Análisis (ADR-019): catálogo de análisis, fuente (TREP u oficial) y filtro de zona o barrio a la izquierda; el
// gráfico en el centro y su tabla debajo; a la derecha (o debajo, en tablet) cómo leerlo. Los datos se cargan una vez y
// cada análisis es un módulo que se pide al abrirlo; cambiar de análisis no recarga la página y conserva el contexto
// (elección, año, cargo) y el filtro. Estado en el hash: #…&analisis=voto-cruzado&zona=…; cambiar de fuente recarga.
// Con datos nacionales (ADR-022 y ADR-023), el ámbito es un distrito o «Paraguay, por distrito» (ambito=pais): los
// distritos son las unidades, con la Junta Municipal y el IPM del INE por distrito, y el filtro es el departamento.
import { estado as compartido, listo as shellListo } from '../shell.js';
import { vigilarDesplazables } from '../desplazables.js';
import { manifiesto, elegir, listaDistritos } from '../datos.js';
import { ambitoDeAnalisis, ASUNCION } from '../ambito.js';
import { cargarModelo } from '../tablero/modelo.js';
import { crearFicha } from '../tablero/ficha.js';
import { $, el } from '../tablero/util.js';

// requiere: lo que el distrito tiene que tener (ADR-022): Intendencia por mesa, el IPM por barrio (los dos, solo en
// Asunción), dos listas para el margen o el cómputo oficial publicado. pais: también existe en «Paraguay, por distrito»
// (ADR-023), con su módulo en MODULOS_PAIS; soloPais: solo allí.
const CATALOGO = [
    { id: 'voto-cruzado', titulo: 'Intendente vs Junta', descripcion: 'Voto cruzado por local: Lista 1 y Alianza (L3 frente a L2 + L3).', requiere: 'intendencia' },
    { id: 'margen', titulo: 'Distribución del margen', descripcion: 'ANR − AJA por mesa, local o barrio, en tramos de 5 puntos.', requiere: 'margen',
      descripcionDistrito: 'Las dos listas más votadas de la Junta, por mesa o local, en tramos de 5 puntos.' },
    { id: 'participacion-ipm', titulo: 'Participación y pobreza', descripcion: 'Participación frente al IPM por barrio, con su tendencia.', requiere: 'ipm',
      pais: true, descripcionPais: 'Participación de cada distrito frente a su IPM (INE), con la tendencia.' },
    { id: 'ganador-ipm', titulo: 'Ganador por mesa y pobreza', descripcion: 'Cada mesa con el color de la lista que ganó, frente a la pobreza de su barrio, y las curvas por lista.', requiere: 'ipm',
      pais: true, tituloPais: 'Ganador y pobreza', descripcionPais: 'Cada distrito con el color de su lista más votada, frente a su IPM, y las curvas por partido.' },
    { id: 'lista-ipm', titulo: 'Votos de un partido y pobreza', soloPais: true,
      descripcionPais: 'El porcentaje de un partido en cada distrito donde presenta lista propia, frente al IPM.' },
    { id: 'ranking', titulo: 'Ranking por lista', descripcion: 'Locales y barrios según el voto de cada lista.', descripcionDistrito: 'Locales según el voto de cada lista de la Junta.' },
    { id: 'trep-oficial', titulo: 'TREP vs oficial', descripcion: 'Diferencias entre las dos fuentes, por mesa y por local.', requiere: 'oficial' },
];
const MOTIVOS = { oficial: 'Disponible cuando se publique el cómputo oficial.', intendencia: 'Necesita Intendencia por mesa: solo Asunción.',
                  ipm: 'Necesita el IPM por barrio del INE: solo Asunción (por distrito, en Paraguay).', margen: 'Este distrito tiene una sola lista en la Junta.',
                  distrito: 'Es por mesa o local: elegí un distrito en la barra.', pais: 'Compara distritos: elegí Paraguay en la barra.' };
const MODULOS = { 'voto-cruzado': () => import('./voto_cruzado.js'), margen: () => import('./margen.js'),
                  'participacion-ipm': () => import('./participacion_ipm.js'), 'ganador-ipm': () => import('./ganador_ipm.js'),
                  ranking: () => import('./ranking.js'),
                  'trep-oficial': () => import('./trep_oficial.js') };
const MODULOS_PAIS = { 'participacion-ipm': () => import('./pais_participacion.js'), 'ganador-ipm': () => import('./pais_ganador.js'),
                       'lista-ipm': () => import('./pais_lista.js') };
const FECHA = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

const estado = { analisis: 'voto-cruzado', filtro: '' };
const instancias = new Map();
let datos, ctxBase, ficha;
let oficialPublicada = false;
let enlaceListo = false;
let turno = 0;

// Fuera de Asunción, solo la Junta (ADR-022).
const cargo = () => (datos?.pais || compartido.obtener('cargo') === 'junta' || !datos?.listas['1'] ? '2' : '1');
const lugar = () => datos.lugar.nombre;
const esAsuncion = () => datos.lugar.clave === ASUNCION;
const esPais = () => Boolean(datos?.pais);
// Por qué un análisis no está disponible en este ámbito (null: disponible). «TREP vs oficial» solo existe con las dos
// fuentes publicadas. En el país, solo los análisis por distrito.
function motivo(item) {
    if (esPais()) {
        if (item.pais || item.soloPais) return null;
        if (item.requiere === 'intendencia') return MOTIVOS.intendencia;
        return item.requiere === 'oficial' && !oficialPublicada ? MOTIVOS.oficial : MOTIVOS.distrito;
    }
    if (item.soloPais) return MOTIVOS.pais;
    const falta = { oficial: !oficialPublicada, intendencia: !datos?.listas['1'], ipm: !datos?.conIpm, margen: !datos?.margen }[item.requiere];
    return falta ? MOTIVOS[item.requiere] : null;
}
const tituloDe = (item) => (esPais() && item.tituloPais) || item.titulo;
const descripcionDe = (item) => (esPais() ? item.descripcionPais ?? item.descripcion
    : !esAsuncion() && item.descripcionDistrito ? item.descripcionDistrito : item.descripcion);
const disponible = (id) => CATALOGO.some((x) => x.id === id && !motivo(x));
const primeroDisponible = () => CATALOGO.find((x) => !motivo(x)).id;
const actual = () => instancias.get(estado.analisis);

// Filtro de zona o barrio: t<zona TSJE>, m<zona municipal> o b:<barrio>, con las mismas claves del hash que el tablero.
// En el país, d<departamento> (la clave departamento del hash), sobre los distritos.
function enFiltro(f) {
    const v = estado.filtro;
    if (!v) return true;
    if (esPais()) return String(f.departamento) === v.slice(1);
    if (v.startsWith('t')) return String(f.zona) === v.slice(1);
    if (v.startsWith('m')) return String(f.zonaMunicipal) === v.slice(1);
    return f.barrio === v.slice(2);
}

function textoFiltro() {
    const opcion = $('filtroGeo').selectedOptions[0];
    return estado.filtro && opcion ? opcion.textContent : esPais() ? 'Todo el país' : esAsuncion() ? 'Toda Asunción' : lugar();
}

function filtroDelHash(p) {
    if (esPais()) {
        const dep = p.get('departamento');
        return /^\d{1,2}$/.test(dep ?? '') && datos.porDep.has(Number(dep)) ? `d${Number(dep)}` : '';
    }
    const de = (objeto, clave) => (clave !== null && /^\d+$/.test(clave) && Object.hasOwn(objeto, clave) ? clave : null);
    const zm = de(datos.resumen.zonas_municipales, p.get('zona_municipal'));
    if (zm !== null) return `m${zm}`;
    const z = de(datos.resumen.zonas, p.get('zona'));
    if (z !== null) return `t${z}`;
    const barrio = p.get('barrio');
    return barrio && datos.filas.some((f) => f.barrio === barrio) ? `b:${barrio}` : '';
}

function parametrosEnlace() {
    const { eleccion, anio } = datos.contexto;
    if (esPais()) {
        const p = new URLSearchParams({ eleccion: eleccion.id, anio: String(anio.anio), cargo: 'junta', ambito: 'pais', analisis: estado.analisis });
        if (estado.filtro) p.set('departamento', estado.filtro.slice(1));
        for (const [clave, valor] of Object.entries(actual()?.modulo.estadoEnlace() ?? {})) if (valor !== null && valor !== undefined) p.set(clave, valor);
        return p;
    }
    const p = new URLSearchParams({ eleccion: eleccion.id, anio: String(anio.anio), cargo: datos.listas['1'] ? compartido.obtener('cargo') ?? anio.cargos[0] : 'junta',
                                    analisis: estado.analisis });
    // Con datos nacionales (ADR-022), el distrito va en el enlace.
    if (anio.nacional) p.set('distrito', datos.lugar.clave);
    if (ctxBase.fuente === 'oficial') p.set('fuente', 'oficial');
    const v = estado.filtro;
    if (v.startsWith('m')) p.set('zona_municipal', v.slice(1));
    else if (v.startsWith('t')) p.set('zona', v.slice(1));
    else if (v.startsWith('b:')) p.set('barrio', v.slice(2));
    for (const [clave, valor] of Object.entries(actual()?.modulo.estadoEnlace() ?? {})) if (valor !== null && valor !== undefined) p.set(clave, valor);
    return p;
}

function actualizarEnlace() {
    actualizarCabecera();
    if (enlaceListo) compartido.reemplazar(Object.fromEntries(parametrosEnlace()), 'analisis');
}

function actualizarCabecera() {
    const item = CATALOGO.find((x) => x.id === estado.analisis);
    const { eleccion, anio } = datos.contexto;
    $('eyebrowAnalisis').textContent = `Análisis · ${ctxBase.nombreFuente} · ${eleccion.nombre} ${anio.anio} · ${lugar()}`;
    $('tituloAnalisis').textContent = tituloDe(item);
    $('metaAnalisis').textContent = actual()?.modulo.meta() ?? '';
    for (const boton of $('catalogo').querySelectorAll('[data-analisis]')) {
        if (boton.dataset.analisis === estado.analisis) boton.setAttribute('aria-current', 'true');
        else boton.removeAttribute('aria-current');
    }
    $('elegirAnalisis').value = estado.analisis;
}

// Cada análisis tiene sus contenedores (controles, gráfico, tabla y lectura); al cambiar, solo se ocultan los demás.
async function activar(id, parametros = null) {
    if (!disponible(id)) return;
    const miTurno = ++turno;
    estado.analisis = id;
    let instancia = instancias.get(id);
    if (!instancia) {
        const contenedores = { controles: el('div', 'analisis__controles-de'), cuerpo: el('div', 'analisis__cuerpo-de'),
                               tabla: el('div', 'analisis__tabla-de'), lectura: el('div', 'analisis__lectura-de') };
        for (const [area, nodo] of Object.entries(contenedores)) {
            nodo.dataset.analisis = id;
            $({ controles: 'controlesAnalisis', cuerpo: 'cuerpoAnalisis', tabla: 'tablaAnalisis', lectura: 'lecturaAnalisis' }[area]).append(nodo);
        }
        const { crear } = await (esPais() ? MODULOS_PAIS : MODULOS)[id]();
        const modulo = crear({ ...ctxBase, ...contenedores });
        modulo.aplicarEnlace(parametros ?? new URLSearchParams());
        instancia = { modulo, contenedores };
        instancias.set(id, instancia);
    } else if (parametros) {
        instancia.modulo.aplicarEnlace(parametros);
    }
    if (miTurno !== turno) return;
    for (const [otro, { contenedores }] of instancias) for (const nodo of Object.values(contenedores)) nodo.hidden = otro !== id;
    $('analisis').dataset.analisis = id;
    actualizarCabecera();
    await renderActual();
    if (miTurno === turno) actualizarEnlace();
}

async function renderActual() {
    const instancia = actual();
    if (!instancia) return;
    $('analisis').removeAttribute('data-listo-analisis');
    await instancia.modulo.render();
    actualizarCabecera();
    $('analisis').dataset.listoAnalisis = estado.analisis;
}

function construirCatalogo() {
    const lista = $('catalogo');
    const elegir = $('elegirAnalisis');
    for (const item of CATALOGO) {
        const por = motivo(item);
        const abierto = !por;
        const li = el('li');
        const boton = el('button', 'catalogo__boton');
        boton.type = 'button';
        boton.dataset.analisis = item.id;
        boton.append(el('strong', null, tituloDe(item)), el('span', null, abierto ? descripcionDe(item) : por));
        if (!abierto) {
            boton.disabled = true;
            boton.title = por;
        }
        li.append(boton);
        lista.append(li);
        const opcion = new Option(abierto ? tituloDe(item) : `${tituloDe(item)} (${por.replace(/\.$/, '').toLowerCase()})`, item.id);
        opcion.disabled = !abierto;
        elegir.append(opcion);
    }
    lista.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-analisis]');
        if (boton && !boton.disabled && boton.dataset.analisis !== estado.analisis) activar(boton.dataset.analisis);
    });
    elegir.addEventListener('change', () => {
        if (disponible(elegir.value)) activar(elegir.value);
        else elegir.value = estado.analisis;
    });
}

function construirFuente() {
    for (const boton of $('selectorFuente').querySelectorAll('[data-fuente]')) {
        const esta = boton.dataset.fuente === ctxBase.fuente;
        boton.setAttribute('aria-pressed', String(esta));
        if (boton.dataset.fuente === 'oficial' && !oficialPublicada) {
            boton.disabled = true;
            boton.title = 'El cómputo oficial aún no fue publicado';
        }
        boton.addEventListener('click', () => {
            if (esta || boton.disabled) return;
            // Otra fuente es otro conjunto de datos: se recarga con el mismo contexto.
            const p = parametrosEnlace();
            if (boton.dataset.fuente === 'oficial') p.set('fuente', 'oficial');
            else p.delete('fuente');
            location.hash = p.toString();
            location.reload();
        });
    }
    $('notaFuente').textContent = oficialPublicada
        ? `Datos: ${ctxBase.nombreFuente}, ${ctxBase.momentoFuente}.`
        : `El cómputo oficial aún no fue publicado: los análisis usan el TREP preliminar (${ctxBase.momentoFuente}).`;
}

// El país: el filtro es el departamento, el mismo de la barra de contexto.
function construirFiltroPais() {
    const select = $('filtroGeo');
    select.options[0].textContent = 'Todo el país';
    const etiqueta = select.closest('label')?.firstChild;
    if (etiqueta?.nodeType === Node.TEXT_NODE) etiqueta.textContent = 'Departamento ';
    for (const d of datos.departamentos) select.append(new Option(d.nombre, `d${d.codigo}`));
    select.value = estado.filtro;
    select.addEventListener('change', async () => {
        estado.filtro = select.value;
        await renderActual();
        actualizarEnlace();
    });
}

function construirFiltro() {
    if (esPais()) {
        construirFiltroPais();
        return;
    }
    const select = $('filtroGeo');
    const grupo = (etiqueta, opciones) => {
        const og = el('optgroup');
        og.label = etiqueta;
        for (const [valor, texto] of opciones) og.append(new Option(texto, valor));
        select.append(og);
    };
    if (!esAsuncion()) select.options[0].textContent = 'Todo el distrito';
    // Sin barrios ni zonas municipales fuera de Asunción: el filtro es solo por zona electoral.
    if (!datos.conBarrios && select.closest('label')?.firstChild?.nodeType === Node.TEXT_NODE) select.closest('label').firstChild.textContent = 'Zona electoral ';
    grupo('Zonas electorales (TSJE)', Object.entries(datos.resumen.zonas).map(([k, n]) => [`t${k}`, `Zona TSJE ${k} · ${n}`]));
    // Las zonas municipales y los barrios existen solo con la cartografía de Asunción.
    if (datos.conZonasMunicipales) grupo('Zonas municipales (oficiales)', Object.entries(datos.resumen.zonas_municipales).map(([k, n]) => [`m${k}`, `Zona municipal ${k} · ${n}`]));
    if (datos.conBarrios) grupo('Barrios', [...new Set(datos.filas.map((f) => f.barrio).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')).map((b) => [`b:${b}`, b]));
    select.value = estado.filtro;
    select.addEventListener('change', async () => {
        estado.filtro = select.value;
        await renderActual();
        actualizarEnlace();
    });
}

// Celular: la tabla del análisis abre en una hoja inferior.
function prepararHojaTabla() {
    const hoja = $('hojaTabla');
    const boton = $('verTabla');
    const abrir = (abierta) => {
        hoja.classList.toggle('es-abierta', abierta);
        boton.setAttribute('aria-expanded', String(abierta));
        if (abierta) $('cerrarTabla').focus();
        else boton.focus();
    };
    boton.addEventListener('click', () => abrir(!hoja.classList.contains('es-abierta')));
    $('cerrarTabla').addEventListener('click', () => abrir(false));
    document.addEventListener('keydown', (evento) => {
        if (evento.key === 'Escape' && !evento.defaultPrevented && hoja.classList.contains('es-abierta')) {
            evento.preventDefault();
            abrir(false);
        }
    });
}

function eventos() {
    $('descargarCsv').addEventListener('click', () => actual()?.modulo.csv());
    $('descargarPng').addEventListener('click', () => actual()?.modulo.png());
    // El cargo de la barra de contexto cambia los análisis que dependen de él; en el país, su departamento es el filtro.
    compartido.suscribir(async ({ cambiadas, origen }) => {
        if (esPais() && origen === 'barra' && cambiadas.has('departamento')) {
            const dep = compartido.obtener('departamento');
            estado.filtro = dep !== null && datos.porDep.has(Number(dep)) ? `d${Number(dep)}` : '';
            $('filtroGeo').value = estado.filtro;
            await renderActual();
            actualizarEnlace();
            return;
        }
        if (origen !== 'barra' || !cambiadas.has('cargo')) return;
        await renderActual();
        actualizarEnlace();
    });
    // Un enlace pegado en la misma pestaña (o el hash editado a mano): otro análisis, filtro o estado sin recargar.
    window.addEventListener('hashchange', () => {
        const p = new URLSearchParams(location.hash.slice(1));
        // Otro distrito o el país (el selector de la barra o un enlace) es otro conjunto de datos: se recarga.
        if (claveDelHash(p) !== datos.lugar.clave) {
            location.reload();
            return;
        }
        estado.filtro = filtroDelHash(p);
        $('filtroGeo').value = estado.filtro;
        activar(disponible(p.get('analisis')) ? p.get('analisis') : primeroDisponible(), p);
    });
    new MutationObserver(() => actual()?.modulo.alCambiarTema?.())
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// El ámbito del hash (ADR-022 y ADR-023, ambitoDeAnalisis): la clave del distrito o null para el país. Sin datos
// nacionales, siempre Asunción.
let claves = new Set([ASUNCION]);
let conNacional = false;
function claveDelHash(p) {
    return conNacional ? ambitoDeAnalisis(`#${p}`, (c) => claves.has(c)).distrito : ASUNCION;
}

const conFecha = (iso) => {
    const m = FECHA.exec(iso ?? '');
    return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : iso ?? '';
};

export async function iniciar() {
    const raiz = $('analisis');
    try {
        const p = new URLSearchParams(location.hash.slice(1));
        const pedido = { eleccion: p.get('eleccion'), anio: p.get('anio') };
        const { eleccion, anio } = elegir(await manifiesto(), pedido);
        oficialPublicada = anio.fuentes?.oficial?.estado === 'publicado';
        // El distrito (ADR-022): los datos nacionales son del TREP; con el cómputo oficial, Asunción.
        const lista = anio.nacional ? await listaDistritos(eleccion.id, anio.anio).catch(() => null) : null;
        claves = new Set([ASUNCION, ...(lista?.distritos.map(([clave]) => clave) ?? [])]);
        conNacional = Boolean(lista);
        if (conNacional && claveDelHash(p) === null) {
            await iniciarPais(p, { eleccion, anio });
            return;
        }
        pedido.distrito = lista ? claveDelHash(p) : null;
        const fuente = p.get('fuente') === 'oficial' && oficialPublicada && (!pedido.distrito || pedido.distrito === ASUNCION) ? 'oficial' : 'trep';
        const cargado = await cargarModelo(pedido, fuente);
        if (!cargado.datos) throw new Error(`La fuente ${fuente} no está publicada.`);
        datos = cargado.datos;
        const fila = lista?.distritos.find(([clave]) => clave === pedido.distrito);
        datos.lugar = pedido.distrito && pedido.distrito !== ASUNCION
            ? { clave: pedido.distrito, nombre: fila?.[1] ?? pedido.distrito, departamento: lista.departamentos.find((d) => d.codigo === fila?.[2])?.nombre ?? '' }
            : { clave: ASUNCION, nombre: anio.ambito ?? 'Asunción', departamento: 'Capital' };
        const info = anio.fuentes?.[fuente] ?? {};
        ficha = crearFicha();
        ctxBase = { datos, fuente, pedido, anio, ficha, nombreFuente: info.nombre ?? fuente,
                    momentoFuente: `${fuente === 'trep' ? 'corte' : 'cómputo'} ${conFecha(info.corte ?? info.fecha ?? datos.resumen.eleccion.corte)}`,
                    cargo, nombreCargo: () => datos.resumen.cargos[cargo()].nombre, filtro: () => estado.filtro, enFiltro, textoFiltro,
                    textoFuente: () => `TSJE · ${ctxBase.nombreFuente}, ${ctxBase.momentoFuente}`, alCambiar: () => actualizarEnlace(), lugar };
        await armar(p);
    } catch (error) {
        const aviso = $('errorCarga');
        aviso.hidden = false;
        aviso.textContent = 'No fue posible leer los datos de los análisis. Revisá la conexión o el servidor local.';
        console.error(error);
    } finally {
        raiz.setAttribute('aria-busy', 'false');
    }
}

// Catálogo, fuente, filtro y el primer análisis, en un distrito o en el país.
async function armar(p) {
    $('tituloPagina').textContent = `Análisis · ${datos.contexto.eleccion.nombre} ${datos.contexto.anio.anio} · ${lugar()}`;
    estado.filtro = filtroDelHash(p);
    construirCatalogo();
    construirFuente();
    construirFiltro();
    prepararHojaTabla();
    eventos();
    await activar(disponible(p.get('analisis')) ? p.get('analisis') : primeroDisponible(), p);
    enlaceListo = true;
    await shellListo;
    vigilarDesplazables();
    $('analisis').dataset.listo = 'true';
}

// «Paraguay, por distrito» (ADR-023): el índice nacional de la Junta, el IPM del INE por distrito y los colores; solo el
// TREP (los datos nacionales son de esa fuente).
async function iniciarPais(p, { eleccion, anio }) {
    const { cargarPais } = await import('./pais_datos.js');
    datos = await cargarPais(eleccion.id, anio.anio);
    datos.contexto = { eleccion, anio };
    datos.lugar = { clave: null, nombre: anio.nacional?.nombre ?? 'Paraguay', departamento: null };
    datos.listas = {};
    const info = anio.fuentes?.trep ?? {};
    ficha = crearFicha();
    ctxBase = { datos, fuente: 'trep', pedido: { eleccion: eleccion.id, anio: anio.anio, distrito: null }, anio, ficha, nombreFuente: info.nombre ?? 'TREP',
                momentoFuente: `corte ${conFecha(info.corte ?? datos.indice.eleccion?.corte)}`, cargo: () => '2',
                nombreCargo: () => anio.nombres_cargo?.junta ?? 'Junta Municipal', filtro: () => estado.filtro, enFiltro, textoFiltro,
                textoFuente: () => `TSJE · ${ctxBase.nombreFuente}, ${ctxBase.momentoFuente}`, alCambiar: () => actualizarEnlace(), lugar };
    await armar(p);
}

iniciar();
