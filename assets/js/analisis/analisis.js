// Sección Análisis (ADR-019): catálogo de análisis, fuente (TREP u oficial) y filtro de zona o barrio a la izquierda; el
// gráfico en el centro y su tabla debajo; a la derecha (o debajo, en tablet) cómo leerlo. Los datos se cargan una vez y
// cada análisis es un módulo que se pide al abrirlo; cambiar de análisis no recarga la página y conserva el contexto
// (elección, año, cargo) y el filtro. Estado en el hash: #…&analisis=voto-cruzado&zona=…; cambiar de fuente recarga.
import { estado as compartido, listo as shellListo } from '../shell.js';
import { vigilarDesplazables } from '../desplazables.js';
import { manifiesto, elegir } from '../datos.js';
import { cargarModelo } from '../tablero/modelo.js';
import { crearFicha } from '../tablero/ficha.js';
import { $, el } from '../tablero/util.js';

const CATALOGO = [
    { id: 'voto-cruzado', titulo: 'Intendente vs Junta', descripcion: 'Voto cruzado por local: Lista 1 y Alianza (L3 frente a L2 + L3).' },
    { id: 'margen', titulo: 'Distribución del margen', descripcion: 'ANR − AJA por mesa, local o barrio, en tramos de 5 puntos.' },
    { id: 'participacion-ipm', titulo: 'Participación y pobreza', descripcion: 'Participación frente al IPM por barrio, con su tendencia.' },
    { id: 'ranking', titulo: 'Ranking por lista', descripcion: 'Locales y barrios según el voto de cada lista.' },
    { id: 'trep-oficial', titulo: 'TREP vs oficial', descripcion: 'Diferencias entre las dos fuentes, por mesa y por local.', requiereOficial: true },
];
const MODULOS = { 'voto-cruzado': () => import('./voto_cruzado.js'), margen: () => import('./margen.js'),
                  'participacion-ipm': () => import('./participacion_ipm.js'), ranking: () => import('./ranking.js'),
                  'trep-oficial': () => import('./trep_oficial.js') };
const FECHA = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

const estado = { analisis: 'voto-cruzado', filtro: '' };
const instancias = new Map();
let datos, ctxBase, ficha;
let oficialPublicada = false;
let enlaceListo = false;
let turno = 0;

const cargo = () => (compartido.obtener('cargo') === 'junta' ? '2' : '1');
// «TREP vs oficial» solo existe con las dos fuentes publicadas.
const disponible = (id) => CATALOGO.some((x) => x.id === id && (!x.requiereOficial || oficialPublicada));
const actual = () => instancias.get(estado.analisis);

// Filtro de zona o barrio: t<zona TSJE>, m<zona municipal> o b:<barrio>, con las mismas claves del hash que el tablero.
function enFiltro(f) {
    const v = estado.filtro;
    if (!v) return true;
    if (v.startsWith('t')) return String(f.zona) === v.slice(1);
    if (v.startsWith('m')) return String(f.zonaMunicipal) === v.slice(1);
    return f.barrio === v.slice(2);
}

function textoFiltro() {
    const opcion = $('filtroGeo').selectedOptions[0];
    return estado.filtro && opcion ? opcion.textContent : 'Toda Asunción';
}

function filtroDelHash(p) {
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
    const p = new URLSearchParams({ eleccion: eleccion.id, anio: String(anio.anio), cargo: compartido.obtener('cargo') ?? anio.cargos[0], analisis: estado.analisis });
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
    $('eyebrowAnalisis').textContent = `Análisis · ${ctxBase.nombreFuente} · ${eleccion.nombre} ${anio.anio}`;
    $('tituloAnalisis').textContent = item.titulo;
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
        const { crear } = await MODULOS[id]();
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
        const abierto = disponible(item.id);
        const li = el('li');
        const boton = el('button', 'catalogo__boton');
        boton.type = 'button';
        boton.dataset.analisis = item.id;
        boton.append(el('strong', null, item.titulo), el('span', null, abierto ? item.descripcion : 'Disponible cuando se publique el cómputo oficial.'));
        if (!abierto) {
            boton.disabled = true;
            boton.title = 'El cómputo oficial aún no fue publicado';
        }
        li.append(boton);
        lista.append(li);
        const opcion = new Option(abierto ? item.titulo : `${item.titulo} (cuando se publique el cómputo oficial)`, item.id);
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

function construirFiltro() {
    const select = $('filtroGeo');
    const grupo = (etiqueta, opciones) => {
        const og = el('optgroup');
        og.label = etiqueta;
        for (const [valor, texto] of opciones) og.append(new Option(texto, valor));
        select.append(og);
    };
    grupo('Zonas electorales (TSJE)', Object.entries(datos.resumen.zonas).map(([k, n]) => [`t${k}`, `Zona TSJE ${k} · ${n}`]));
    grupo('Zonas municipales (oficiales)', Object.entries(datos.resumen.zonas_municipales).map(([k, n]) => [`m${k}`, `Zona municipal ${k} · ${n}`]));
    grupo('Barrios', [...new Set(datos.filas.map((f) => f.barrio).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')).map((b) => [`b:${b}`, b]));
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
    // El cargo de la barra de contexto cambia los análisis que dependen de él.
    compartido.suscribir(async ({ cambiadas, origen }) => {
        if (origen !== 'barra' || !cambiadas.has('cargo')) return;
        await renderActual();
        actualizarEnlace();
    });
    // Un enlace pegado en la misma pestaña (o el hash editado a mano): otro análisis, filtro o estado sin recargar.
    window.addEventListener('hashchange', () => {
        const p = new URLSearchParams(location.hash.slice(1));
        estado.filtro = filtroDelHash(p);
        $('filtroGeo').value = estado.filtro;
        activar(disponible(p.get('analisis')) ? p.get('analisis') : CATALOGO[0].id, p);
    });
    new MutationObserver(() => actual()?.modulo.alCambiarTema?.())
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
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
        const { anio } = elegir(await manifiesto(), pedido);
        oficialPublicada = anio.fuentes?.oficial?.estado === 'publicado';
        const fuente = p.get('fuente') === 'oficial' && oficialPublicada ? 'oficial' : 'trep';
        const cargado = await cargarModelo(pedido, fuente);
        if (!cargado.datos) throw new Error(`La fuente ${fuente} no está publicada.`);
        datos = cargado.datos;
        const info = anio.fuentes?.[fuente] ?? {};
        ficha = crearFicha();
        ctxBase = { datos, fuente, pedido, anio, ficha, nombreFuente: info.nombre ?? fuente,
                    momentoFuente: `${fuente === 'trep' ? 'corte' : 'cómputo'} ${conFecha(info.corte ?? info.fecha ?? datos.resumen.eleccion.corte)}`,
                    cargo, nombreCargo: () => datos.resumen.cargos[cargo()].nombre, filtro: () => estado.filtro, enFiltro, textoFiltro,
                    textoFuente: () => `TSJE · ${ctxBase.nombreFuente}, ${ctxBase.momentoFuente}`, alCambiar: () => actualizarEnlace() };
        $('tituloPagina').textContent = `Análisis · ${datos.contexto.eleccion.nombre} ${anio.anio} · ${anio.ambito ?? ''}`;
        estado.filtro = filtroDelHash(p);
        construirCatalogo();
        construirFuente();
        construirFiltro();
        prepararHojaTabla();
        eventos();
        await activar(disponible(p.get('analisis')) ? p.get('analisis') : CATALOGO[0].id, p);
        enlaceListo = true;
        await shellListo;
        vigilarDesplazables();
        raiz.dataset.listo = 'true';
    } catch (error) {
        const aviso = $('errorCarga');
        aviso.hidden = false;
        aviso.textContent = 'No fue posible leer los datos de los análisis. Revisá la conexión o el servidor local.';
        console.error(error);
    } finally {
        raiz.setAttribute('aria-busy', 'false');
    }
}

iniciar();
