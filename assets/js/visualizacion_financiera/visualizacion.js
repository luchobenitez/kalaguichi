// Visualización financiera · Ejercicio 2025 (ADR-035; tarea M46): la página /analisis/visualizacion-financiera/2025/.
// Al abrir lee solo el manifiesto, el catálogo de municipalidades, el de gráficos y la configuración; al elegir una
// municipalidad, su resumen (y los objetos del gasto solo si el treemap los pide). Dibuja en SVG la vista activa con el
// modelo de vista común (modelo.js → geometria.js → pintar.js) y descarga PNG (3000 px), SVG, CSV y la ficha municipal en
// HTML. El enlace guarda ejercicio, departamento, municipio, gráfico, apertura y métrica, con atrás/adelante. Un cambio
// rápido de municipio cancela la lectura anterior y descarta su respuesta; el cambio de tema no recalcula nada (los colores
// salen de la hoja de estilos). Sin HTML desde datos: todo texto va con textContent.
import { $, el } from '../tablero/util.js';
import { descargar, nombreArchivo } from '../analisis/exportar.js';
import * as M from './modelo.js';
import * as G from './geometria.js';
import * as P from './pintar.js';

const EJERCICIOS = [2025];
const CARPETA = { 2025: new URL('../../../datos/visualizacion_financiera/municipalidad/2025/', import.meta.url) };
const RETENER = 24; // municipalidades leídas que se conservan en memoria

const main = $('contenido');
let manifiesto = null;
let catalogo = null;
let graficos = [];
let configuracion = null;
let estado = null;
let turno = 0;
let controlador = null;
let actual = null; // { entrada, municipio, vista, escena }
let construcciones = 0;
let escenas = 0;
const memoria = new Map();

// --- Lectura ------------------------------------------------------------------------------------------------------------
async function leer(rel, { senal, versionada = true } = {}) {
    const url = new URL(rel, CARPETA[estado?.ejercicio ?? EJERCICIOS[0]]);
    if (versionada && manifiesto) url.searchParams.set('v', manifiesto.version);
    const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: senal, cache: versionada && manifiesto ? 'force-cache' : 'no-cache' });
    if (!r.ok) throw new Error(`${rel}: el servidor respondió ${r.status}`);
    return r.json();
}

async function cargarMunicipio(entrada, senal) {
    if (memoria.has(entrada.id)) {
        const x = memoria.get(entrada.id);
        memoria.delete(entrada.id);
        memoria.set(entrada.id, x);
        return x;
    }
    const resumen = await leer(`municipios/${entrada.id}.json`, { senal });
    if (resumen.id !== entrada.id) throw new Error('El archivo leído no es el de la municipalidad elegida.');
    const municipio = M.crearMunicipio(resumen, entrada);
    memoria.set(entrada.id, municipio);
    while (memoria.size > RETENER) memoria.delete(memoria.keys().next().value);
    return municipio;
}

async function cargarDetalle(municipio, senal) {
    if (municipio.detalleCargado) return;
    const detalle = await leer(`detalle/${municipio.id}.json`, { senal });
    if (detalle.id !== municipio.id) throw new Error('El detalle leído no es el de la municipalidad elegida.');
    M.agregarDetalle(municipio, detalle);
}

// --- Estado y enlace ----------------------------------------------------------------------------------------------------
const contexto = () => ({ ejercicios: EJERCICIOS, catalogo, graficos });

function escribirEnlace(modo = 'push') {
    const hash = M.textoEstado(estado);
    const destino = `${location.pathname}${location.search}${hash ? `#${hash}` : ''}`;
    if (destino === `${location.pathname}${location.search}${location.hash}`) return;
    history[modo === 'push' ? 'pushState' : 'replaceState'](null, '', destino);
}

function mensaje(textos) {
    const nodo = $('kvfMensaje');
    nodo.textContent = textos.filter(Boolean).join(' ');
    nodo.hidden = !nodo.textContent;
}

function cambiar(cambios, { modo = 'push', avisos = [] } = {}) {
    estado = { ...estado, ...cambios };
    escribirEnlace(modo);
    mensaje(avisos);
    reflejarControles();
    mostrar();
}

// --- Controles ----------------------------------------------------------------------------------------------------------
const catGrafico = (id) => graficos.find((g) => g.id === id);

function armarControles() {
    const ej = $('kvfEjercicio');
    for (const a of EJERCICIOS) ej.append(Object.assign(el('option', null, String(a)), { value: String(a) }));
    ej.addEventListener('change', () => cambiar({ ejercicio: Number(ej.value) }));
    const dep = $('kvfDepartamento');
    for (const d of catalogo.departamentos) dep.append(Object.assign(el('option', null, d.nombre), { value: String(d.codigo) }));
    dep.addEventListener('change', () => {
        const d = dep.value === '' ? null : Number(dep.value);
        const m = estado.municipio ? catalogo.porId.get(estado.municipio) : null;
        const quitar = m && d !== null && m.departamento !== d;
        cambiar({ departamento: d, ...(quitar ? { municipio: null } : {}) },
                { avisos: quitar ? [`Se quitó ${m.nombre}: no es de ese departamento. Elegí una municipalidad de la lista.`] : [] });
        $('kvfBuscar').value = '';
        opciones('');
    });
    const sel = $('kvfGrafico');
    graficos.forEach((g, k) => sel.append(Object.assign(el('option', null, `${String(k + 1).padStart(2, '0')}. ${g.titulo}`), { value: g.id })));
    sel.addEventListener('change', () => cambiar({ grafico: sel.value, apertura: null, metrica: null }));
    $('kvfAnterior').addEventListener('click', () => mover(-1));
    $('kvfSiguiente').addEventListener('click', () => mover(1));
    $('kvfMiniaturas').addEventListener('click', () => {
        const abierta = $('kvfGaleria').hidden;
        $('kvfGaleria').hidden = !abierta;
        $('kvfMiniaturas').setAttribute('aria-expanded', String(abierta));
        if (abierta) dibujarGaleria();
    });
    armarBuscador();
    $('kvfReintentar').addEventListener('click', () => mostrar());
    $('kvfPng').addEventListener('click', () => exportar('png'));
    $('kvfSvg').addEventListener('click', () => exportar('svg'));
    $('kvfCsv').addEventListener('click', () => exportar('csv'));
    $('kvfCopiar').addEventListener('click', copiarEnlace);
    $('kvfAmpliar').addEventListener('click', ampliar);
    $('kvfFichaHtml').addEventListener('click', descargarFicha);
    $('kvfCancelarFicha').addEventListener('click', () => { if (fichaEnCurso) fichaEnCurso.cancelada = true; });
    document.addEventListener('fullscreenchange', () => {
        const activa = document.fullscreenElement === $('kvfVista');
        $('kvfAmpliar').textContent = activa ? 'Salir de pantalla ampliada' : 'Pantalla ampliada';
        $('kvfAmpliar').setAttribute('aria-pressed', String(activa));
        redibujar(true);
    });
}

function mover(paso) {
    const k = graficos.findIndex((g) => g.id === estado.grafico);
    const sig = graficos[(k + paso + graficos.length) % graficos.length];
    cambiar({ grafico: sig.id, apertura: null, metrica: null });
}

function reflejarControles() {
    $('kvfEjercicio').value = String(estado.ejercicio);
    $('kvfDepartamento').value = estado.departamento === null ? '' : String(estado.departamento);
    $('kvfGrafico').value = estado.grafico;
    const m = estado.municipio ? catalogo.porId.get(estado.municipio) : null;
    if (m && document.activeElement !== $('kvfBuscar')) $('kvfBuscar').value = m.nombre;
    if (!m && document.activeElement !== $('kvfBuscar')) $('kvfBuscar').value = '';
    const k = graficos.findIndex((g) => g.id === estado.grafico);
    $('kvfPosicion').textContent = `Gráfico ${k + 1} de ${graficos.length}`;
}

// Buscador de municipalidades (combobox con lista): sin mayúsculas ni acentos; Enter elige la activa o la primera.
let activa = -1;
let resultados = [];
let cierre = null; // el cierre pendiente de la lista tras perder el foco (se cancela si el foco vuelve antes)

function armarBuscador() {
    const input = $('kvfBuscar');
    input.addEventListener('input', () => opciones(input.value, true));
    input.addEventListener('focus', () => opciones(input.value === (catalogo.porId.get(estado.municipio)?.nombre ?? '') ? '' : input.value, true));
    input.addEventListener('keydown', (ev) => {
        const lista = $('kvfOpciones');
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            if (lista.hidden) opciones(input.value, true);
            activa = Math.max(0, Math.min(resultados.length - 1, activa + (ev.key === 'ArrowDown' ? 1 : -1)));
            marcarActiva();
        } else if (ev.key === 'Enter') {
            ev.preventDefault();
            const m = resultados[activa >= 0 ? activa : 0];
            if (m) elegir(m);
        } else if (ev.key === 'Escape') {
            cerrarLista();
            input.value = catalogo.porId.get(estado.municipio)?.nombre ?? '';
        }
    });
    input.addEventListener('blur', () => {
        clearTimeout(cierre);
        cierre = setTimeout(cerrarLista, 150);
    });
}

function opciones(texto, abrir = false) {
    const lista = $('kvfOpciones');
    resultados = M.buscar(catalogo, texto, estado.departamento);
    activa = -1;
    lista.replaceChildren();
    for (const m of resultados) {
        const li = el('li', `kvf__opcion${m.estado === 'sin_informe' ? ' kvf__opcion--sin-informe' : ''}`);
        li.id = `kvfOpcion-${m.id}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(m.id === estado.municipio));
        li.append(el('span', 'kvf__opcion-nombre', m.nombre), el('span', 'kvf__opcion-dep', `${m.departamento_nombre}${m.estado === 'sin_informe' ? ' · sin informe' : ''}`));
        li.addEventListener('mousedown', (ev) => ev.preventDefault());
        li.addEventListener('click', () => elegir(m));
        lista.append(li);
    }
    if (!resultados.length) lista.append(el('li', 'kvf__opcion kvf__opcion--vacia', 'Ninguna municipalidad coincide.'));
    $('kvfBuscarCuenta').textContent = `${resultados.length} municipalidad${resultados.length === 1 ? '' : 'es'}`;
    if (abrir) {
        clearTimeout(cierre);
        lista.hidden = false;
        $('kvfBuscar').setAttribute('aria-expanded', 'true');
    }
}

function marcarActiva() {
    const items = [...$('kvfOpciones').querySelectorAll('[role="option"]')];
    items.forEach((li, k) => li.classList.toggle('es-activa', k === activa));
    const li = items[activa];
    if (li) {
        $('kvfBuscar').setAttribute('aria-activedescendant', li.id);
        li.scrollIntoView({ block: 'nearest' });
    }
}

function cerrarLista() {
    $('kvfOpciones').hidden = true;
    $('kvfBuscar').setAttribute('aria-expanded', 'false');
    $('kvfBuscar').removeAttribute('aria-activedescendant');
}

function elegir(m) {
    cerrarLista();
    $('kvfBuscar').value = m.nombre;
    cambiar({ municipio: m.id, departamento: estado.departamento === null ? null : m.departamento });
}

// --- Dibujo -------------------------------------------------------------------------------------------------------------
function limpiar() {
    actual = null;
    for (const id of ['kvfFichaDatos', 'kvfFichaObservaciones', 'kvfGraficoCaja', 'kvfLeyenda', 'kvfTabla', 'kvfAvisos', 'kvfControlesVista']) $(id).replaceChildren();
    for (const id of ['kvfVistaEstado', 'kvfCambio']) {
        $(id).textContent = '';
        $(id).hidden = true;
    }
    for (const id of ['kvfQue', 'kvfLimite', 'kvfFuente', 'kvfGraficoRotulo', 'kvfVistaMeta', 'kvfAvisoEnlace']) $(id).textContent = '';
    $('kvfError').hidden = true;
    $('kvfGlobo').hidden = true;
    $('kvfDesplazar').hidden = true;
    main.dataset.vista = '';
    for (const id of ['kvfPng', 'kvfSvg', 'kvfCsv', 'kvfFichaHtml']) $(id).disabled = true;
}

async function mostrar() {
    const mio = ++turno;
    const t0 = performance.now();
    controlador?.abort();
    controlador = new AbortController();
    const senal = controlador.signal;
    limpiar();
    const entrada = estado.municipio ? catalogo.porId.get(estado.municipio) : null;
    $('kvfInicio').hidden = Boolean(entrada);
    $('kvfFicha').hidden = !entrada;
    $('kvfVista').hidden = !entrada;
    main.dataset.municipio = entrada?.id ?? '';
    if (!entrada) {
        main.dataset.estado = 'inicio';
        $('kvfGaleria').replaceChildren();
        return;
    }
    cabeceraFicha(entrada);
    const cat = catGrafico(estado.grafico);
    cabeceraVista(cat, entrada);
    if (entrada.estado === 'sin_informe') {
        fichaSinInforme(entrada);
        dibujarVista(M.construirVista(cat, null, entrada), entrada, null);
        main.dataset.estado = 'listo';
        return;
    }
    main.dataset.estado = 'cargando';
    $('kvfVistaEstado').textContent = `Cargando los datos de ${entrada.nombre}…`;
    $('kvfVistaEstado').hidden = false;
    try {
        const municipio = await cargarMunicipio(entrada, senal);
        if (mio !== turno) return;
        fichaDatos(municipio, entrada);
        let v = construir(cat, municipio, entrada);
        if (v.requiereDetalle) {
            await cargarDetalle(municipio, senal);
            if (mio !== turno) return;
            v = construir(cat, municipio, entrada);
        }
        dibujarVista(v, entrada, municipio);
        if (!$('kvfGaleria').hidden) dibujarGaleria();
        // Medidas para la documentación de rendimiento: lectura + armado + dibujo de la vista (ms).
        main.dataset.msVista = String(Math.round(performance.now() - t0));
        main.dataset.estado = 'listo';
    } catch (error) {
        if (senal.aborted || mio !== turno) return;
        limpiar();
        main.dataset.estado = 'error';
        $('kvfErrorTexto').textContent = `No se pudieron leer los datos de ${entrada.nombre} (${error.message}). No se muestra ninguna cifra; podés reintentar.`;
        $('kvfError').hidden = false;
    }
}

function construir(cat, municipio, entrada) {
    construcciones += 1;
    main.dataset.construcciones = String(construcciones);
    const v = M.construirVista(cat, municipio, entrada, { apertura: estado.apertura, metrica: estado.metrica }, { emisores: configuracion.prioritarios.emisores });
    // Una apertura o métrica que no vale para esta municipalidad vuelve a la inicial, en el enlace también.
    const ap = v.apertura?.actual ?? null;
    const apInicial = v.apertura?.opciones?.[0]?.id ?? (v.apertura?.migas ? 'todo' : null);
    const normal = ap && ap !== apInicial ? ap : null;
    const me = v.metrica?.actual && v.metrica.actual !== v.metrica.opciones[0].id ? v.metrica.actual : null;
    if (!v.requiereDetalle && (normal !== estado.apertura || me !== estado.metrica)) {
        estado = { ...estado, apertura: normal, metrica: me };
        escribirEnlace('replace');
    }
    return v;
}

const fecha = (iso) => {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, m - 1, d).toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' });
};

function cabeceraFicha(entrada) {
    $('kvfFichaTitulo').textContent = entrada.nombre;
    const partes = [entrada.departamento_nombre, entrada.sistema === 'codigo_mef' ? `Código MEF ${entrada.id}` : `Clave interna ${entrada.id} (no es un código del MEF)`,
                    `Nombre en la fuente: ${entrada.nombre_fuente}`, `Ejercicio ${estado.ejercicio}`, `Corte: ${fecha(manifiesto.corte)}`];
    if (entrada.paginas) partes.push(`Páginas: V-B ${entrada.paginas.presupuesto}; V-A ${entrada.paginas.financieras}`);
    $('kvfFichaMeta').textContent = partes.join(' · ');
    const insignia = $('kvfFichaEstado');
    insignia.textContent = entrada.estado === 'sin_informe' ? 'Sin informe en el corte' : 'Con informe';
    insignia.className = `kvf__insignia kvf__insignia--${entrada.estado === 'sin_informe' ? 'sin-informe' : 'informante'}`;
    const mapa = $('kvfVerMapa');
    mapa.href = `../../financiero/2025/#municipio=${encodeURIComponent(entrada.distrito)}`;
}

function fichaSinInforme(entrada) {
    const caja = $('kvfFichaDatos');
    caja.append(el('p', 'kvf__sin-informe', `${entrada.nombre} no figura con informe en el Informe Financiero 2025 al elaborarse (${entrada.sin_informe.fuente}).`),
                el('p', 'nota', entrada.sin_informe.advertencia), el('p', 'nota', catalogo.nota));
}

function fichaDatos(municipio, entrada) {
    const dl = el('dl', 'kvf__prioritarios');
    for (const p of M.ficha(municipio)) {
        const caja = el('div', 'kvf__prioritario');
        const dd = el('dd', p.valor === null ? 'kvf__valor es-falta' : 'kvf__valor', p.texto_valor);
        caja.append(el('dt', null, p.texto), dd, el('p', 'kvf__alcance', p.motivo ? `${p.alcance} Motivo: ${p.motivo}` : p.alcance));
        dl.append(caja);
    }
    $('kvfFichaDatos').append(dl);
    const obs = $('kvfFichaObservaciones');
    const lista = [...(municipio.observaciones ?? []).map((o) => `${o.detalle} (${o.fuente})`),
                   ...(municipio.alertas ?? []).map((a) => `Alerta del paquete: ${a.replace(/_/g, ' ')}.`)];
    if (lista.length) {
        obs.append(el('h3', null, 'Observaciones de calidad'));
        const ul = el('ul', 'kvf__observaciones');
        for (const t of lista) ul.append(el('li', null, t));
        obs.append(ul);
    }
    $('kvfFichaHtml').disabled = false;
}

function cabeceraVista(cat, entrada) {
    const k = graficos.findIndex((g) => g.id === cat.id);
    $('kvfVistaEyebrow').textContent = `Gráfico ${k + 1} de ${graficos.length}${cat.informativo ? ' · informativo' : ''}`;
    $('kvfVistaTitulo').textContent = cat.titulo;
    $('kvfVistaSub').textContent = `${entrada.nombre} · ${entrada.departamento_nombre} · Ejercicio ${estado.ejercicio} · Corte: ${fecha(manifiesto.corte)}`;
    $('kvfVistaMeta').textContent = '';
}

function dibujarVista(v, entrada, municipio) {
    actual = { entrada, municipio, vista: v, escena: null };
    main.dataset.vista = v.id;
    main.dataset.vistaEstado = v.estado;
    main.dataset.formato = v.formato;
    $('kvfVistaMeta').textContent = [`Unidad: ${v.unidad}.`, `Etapas: ${v.etapas}`, v.denominador ? `Denominador: ${v.denominador}` : null].filter(Boolean).join(' ');
    if (v.cambio) {
        $('kvfCambio').textContent = G.textoCambio(v.cambio);
        $('kvfCambio').hidden = false;
    }
    const estadoTxt = { parcial: `Parcial: ${v.motivo}`, sin_datos: `Sin datos para este gráfico: ${v.motivo}`, no_aplicable: v.motivo, error: v.motivo }[v.estado];
    if (estadoTxt) {
        $('kvfVistaEstado').textContent = estadoTxt;
        $('kvfVistaEstado').className = `kvf__estado kvf__estado--${v.estado}${v.causa === 'sin_informe' ? ' kvf__estado--sin-informe' : ''}`;
        $('kvfVistaEstado').hidden = false;
    } else {
        $('kvfVistaEstado').hidden = true;
    }
    controlesVista(v);
    $('kvfQue').textContent = v.que_muestra;
    $('kvfLimite').textContent = v.limite;
    $('kvfFuente').textContent = v.fuente;
    const avisos = $('kvfAvisos');
    for (const a of v.avisos) avisos.append(el('li', null, a));
    tabla(v);
    redibujar();
    if (v.estado === 'no_aplicable') {
        const ir = el('p', 'kvf__ir');
        for (const id of ['01_origen_asignacion', '09_presupuesto_ejecucion', '14_balance']) {
            const b = el('button', 'boton-secundario', `Ver ${catGrafico(id).titulo.toLowerCase()}`);
            b.type = 'button';
            b.addEventListener('click', () => cambiar({ grafico: id, apertura: null, metrica: null }));
            ir.append(b);
        }
        $('kvfGraficoCaja').append(ir);
    }
    $('kvfCsv').disabled = !v.tabla;
    $('kvfPng').disabled = !v.grafico;
    $('kvfSvg').disabled = !v.grafico;
    actualizarOpcionesGrafico(municipio, entrada);
}

// El selector de gráficos dice, para la municipalidad elegida, cuáles cambian de formato o no tienen datos.
function actualizarOpcionesGrafico(municipio, entrada) {
    const sel = $('kvfGrafico');
    graficos.forEach((g, k) => {
        const v = g.id === actual?.vista.id ? actual.vista : M.construirVista(g, municipio, entrada, {}, { emisores: configuracion.prioritarios.emisores });
        const extra = { sin_datos: ' — sin datos', no_aplicable: ' — informativo', error: ' — error', parcial: ' — parcial' }[v.estado] ?? (v.cambio ? ` — ${G.NOMBRE_FORMATO[v.cambio.a]}` : '');
        sel.options[k].textContent = `${String(k + 1).padStart(2, '0')}. ${g.titulo}${extra}`;
    });
}

function controlesVista(v) {
    const caja = $('kvfControlesVista');
    if (v.apertura?.migas) {
        const nav = el('nav', 'kvf__migas');
        nav.setAttribute('aria-label', 'Nivel del treemap');
        const ol = el('ol');
        v.apertura.migas.forEach((m, k) => {
            const li = el('li');
            if (k === v.apertura.migas.length - 1) {
                const s = el('span', null, m.texto);
                s.setAttribute('aria-current', 'location');
                li.append(s);
            } else {
                const b = el('button', 'kvf__miga', m.texto);
                b.type = 'button';
                b.addEventListener('click', () => cambiar({ apertura: m.id === 'todo' ? null : m.id }));
                li.append(b);
            }
            ol.append(li);
        });
        nav.append(ol);
        caja.append(nav);
    }
    const grupoBotones = (titulo, opciones, actualId, clave) => {
        const id = `kvfSeg-${clave}`;
        const envoltura = el('div', 'kvf__campo');
        const rot = el('span', 'kvf__rotulo', titulo);
        rot.id = id;
        const seg = el('div', 'segmentos');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-labelledby', id);
        for (const o of opciones) {
            const b = el('button', null, o.texto);
            b.type = 'button';
            b.dataset[clave] = o.id;
            b.setAttribute('aria-pressed', String(o.id === actualId));
            b.addEventListener('click', () => cambiar({ [clave]: o.id === opciones[0].id ? null : o.id }));
            seg.append(b);
        }
        envoltura.append(rot, seg);
        caja.append(envoltura);
    };
    if (v.apertura?.opciones && v.apertura.opciones.length <= 3) grupoBotones('Apertura', v.apertura.opciones, v.apertura.actual, 'apertura');
    if (v.apertura?.opciones && v.apertura.opciones.length > 3) {
        const etiqueta = el('label', 'campo-select', 'Apertura');
        const s = el('select');
        s.id = 'kvfApertura';
        for (const o of v.apertura.opciones) s.append(Object.assign(el('option', null, o.texto), { value: o.id }));
        s.value = v.apertura.actual;
        s.addEventListener('change', () => cambiar({ apertura: s.value === v.apertura.opciones[0].id ? null : s.value }));
        etiqueta.append(s);
        caja.append(etiqueta);
    }
    if (v.metrica) grupoBotones('Métrica', v.metrica.opciones, v.metrica.actual, 'metrica');
}

// La escena al ancho de la caja (con su mínimo por formato: debajo, la caja se desplaza sin deformar el gráfico).
let anchoDibujado = 0;
function redibujar(forzar = false) {
    if (!actual?.vista.grafico) return;
    const caja = $('kvfGraficoCaja');
    const ancho = Math.round(caja.clientWidth || 960);
    if (!forzar && actual.escena && Math.abs(ancho - anchoDibujado) < 24) return;
    anchoDibujado = ancho;
    escenas += 1;
    main.dataset.escenas = String(escenas);
    const t0 = performance.now();
    const esc = G.escena(actual.vista, { ancho: Math.min(ancho, 1400), medir: P.medirTexto });
    actual.escena = esc;
    const svg = P.svgEnPagina(esc, { titulo: `${actual.vista.titulo} · ${actual.entrada.nombre}`, descripcion: actual.vista.resumen, alActivar: activar,
                                      alMostrar: globo, alOcultar: () => { $('kvfGlobo').hidden = true; } });
    caja.replaceChildren(svg);
    main.dataset.msDibujo = String(Math.round((performance.now() - t0) * 10) / 10);
    main.dataset.elementos = String(svg.querySelectorAll('rect, path, text, line').length);
    const desplazable = esc.ancho > ancho + 1;
    caja.classList.toggle('kvf__grafico--desplazable', desplazable);
    $('kvfDesplazar').hidden = !desplazable;
    const ley = $('kvfLeyenda');
    ley.replaceChildren();
    for (const it of G.leyenda(actual.vista, esc)) {
        const li = el('li');
        const muestra = el('span', `kvf__muestra kvf__muestra--${it.rol}${it.patron ? ` kvf__muestra--patron-${it.patron}` : ''}${it.marcador ? ' kvf__muestra--marcador' : ''}`);
        muestra.setAttribute('aria-hidden', 'true');
        li.append(muestra, el('span', null, it.texto));
        ley.append(li);
    }
    $('kvfGraficoRotulo').textContent = actual.vista.resumen;
}

function activar(e) {
    if (e.foco?.accion?.apertura) cambiar({ apertura: e.foco.accion.apertura });
}

function globo(e, nodo) {
    if (!e.info) return;
    const g = $('kvfGlobo');
    g.replaceChildren(el('strong', null, e.info.titulo), ...e.info.lineas.map((l) => el('span', null, l)));
    g.hidden = false;
    const caja = $('kvfGraficoMarco').getBoundingClientRect();
    const b = nodo.getBoundingClientRect();
    const x = Math.min(Math.max(b.left + b.width / 2 - caja.left, 8), caja.width - 8);
    g.style.left = `${x}px`;
    g.style.top = `${Math.max(b.top - caja.top, 0)}px`;
    g.classList.toggle('kvf__globo--abajo', b.top - caja.top < 90);
    if (g.classList.contains('kvf__globo--abajo')) g.style.top = `${b.bottom - caja.top}px`;
}

const nfTabla = {
    importe: (x) => M.entero(x), pct: (x) => M.porciento(x), veces: (x) => M.veces(x),
};

function tabla(v) {
    const caja = $('kvfTabla');
    if (!v.tabla) {
        caja.append(el('p', 'nota', 'Esta vista no tiene tabla: no hay cifras que mostrar.'));
        return;
    }
    const t = el('table', 'tabla kvf__tabla');
    t.dataset.filas = String(v.tabla.filas.length);
    const cap = el('caption', 'visualmente-oculto', `Datos de «${v.titulo}» para ${actual.entrada.nombre}`);
    const thead = el('thead');
    const tr = el('tr');
    v.tabla.columnas.forEach((c, k) => {
        const th = el('th', c.tipo === 'texto' || c.tipo === 'codigo' ? 'tabla__texto' : null, c.titulo);
        th.scope = 'col';
        if (k === 0) th.classList.add('kvf__primera');
        tr.append(th);
    });
    thead.append(tr);
    const tbody = el('tbody');
    for (const f of v.tabla.filas) {
        const fila = el('tr');
        v.tabla.columnas.forEach((c, k) => {
            const valor = f[c.id];
            const noAplica = f.na?.includes(c.id);
            const vacio = valor === null || valor === undefined || valor === '';
            const numerico = c.tipo === 'importe' || c.tipo === 'pct' || c.tipo === 'veces';
            // «—»: la celda no corresponde a esa fila; N/D (rojo): el dato falta en la fuente.
            const textoCelda = noAplica ? '—' : vacio ? (numerico ? M.ND : '') : numerico ? nfTabla[c.tipo](valor) : String(valor);
            const td = el(k === 0 ? 'th' : 'td', [!numerico && 'tabla__texto', c.tipo === 'codigo' && 'kvf__codigo', noAplica && 'kvf__na', numerico && vacio && !noAplica && 'es-falta',
                                                 numerico && !vacio && valor < 0 && 'es-negativa'].filter(Boolean).join(' '), textoCelda);
            if (k === 0) td.scope = 'row';
            if (numerico && !vacio && c.tipo === 'importe') td.title = M.gs(valor);
            if (!numerico && textoCelda.length > 28) td.title = textoCelda;
            fila.append(td);
        });
        tbody.append(fila);
    }
    t.append(cap, thead, tbody);
    const scroll = el('div', 'tabla-scroll kvf__tabla-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', `Tabla de «${v.titulo}»`);
    scroll.append(t);
    caja.append(scroll);
}

// --- Miniaturas ---------------------------------------------------------------------------------------------------------
function dibujarGaleria() {
    const caja = $('kvfGaleria');
    caja.replaceChildren();
    if (!actual) {
        caja.append(el('p', 'nota', 'Elegí una municipalidad para ver las miniaturas de sus gráficos.'));
        return;
    }
    const { municipio, entrada } = actual;
    const lista = el('ul', 'kvf__miniaturas');
    for (const g of graficos) {
        const v = M.construirVista(g, municipio, entrada, {}, { emisores: configuracion.prioritarios.emisores });
        const li = el('li');
        const b = el('button', `kvf__miniatura${g.id === estado.grafico ? ' es-actual' : ''}`);
        b.type = 'button';
        b.setAttribute('aria-label', `${g.titulo}: ${{ disponible: 'disponible', parcial: 'parcial', sin_datos: 'sin datos', no_aplicable: 'informativo', error: 'error' }[v.estado]}`);
        if (g.id === estado.grafico) b.setAttribute('aria-current', 'true');
        const marco = el('span', 'kvf__miniatura-marco');
        if (v.grafico) marco.append(P.svgEnPagina(G.escena(v, { ancho: 520, medir: P.medirTexto }), { miniatura: true }));
        else marco.append(el('span', 'kvf__miniatura-vacia', v.estado === 'no_aplicable' ? 'Informativo' : 'Sin datos'));
        b.append(marco, el('span', 'kvf__miniatura-titulo', g.corto));
        b.addEventListener('click', () => cambiar({ grafico: g.id, apertura: null, metrica: null }));
        li.append(b);
        lista.append(li);
    }
    caja.append(lista);
}

// --- Descargas ----------------------------------------------------------------------------------------------------------
const tema = () => (document.documentElement.dataset.theme === 'dark' ? 'oscuro' : 'claro');
const meta = () => ({ ejercicio: estado.ejercicio, corte: manifiesto.corte, version: manifiesto.version });

function nombreDe(v, entrada, extension) {
    return `${nombreArchivo('kalaguichi', estado.ejercicio, entrada.nombre, v.id, v.apertura?.actual && v.apertura.actual !== (v.apertura.opciones?.[0]?.id ?? 'todo') ? v.apertura.actual : '',
                           v.metrica?.actual && v.metrica.actual !== v.metrica.opciones[0].id ? v.metrica.actual : '', extension === 'csv' ? '' : tema())}.${extension}`;
}

function escenaExportable(v, entrada) {
    const chart = G.escena(v, { ancho: 1128, medir: P.medirTexto });
    return G.componer(v, chart, { municipio: entrada.nombre, departamento: entrada.departamento_nombre, ejercicio: estado.ejercicio, corte: fecha(manifiesto.corte),
                                  version: manifiesto.version, medir: P.medirTexto });
}

function exportar(tipo) {
    if (!actual) return;
    const { vista: v, entrada } = actual;
    if (tipo === 'csv') {
        const texto = M.csvDeVista(v, entrada, meta());
        if (texto) descargar(new Blob([`﻿${texto}`], { type: 'text/csv;charset=utf-8' }), nombreDe(v, entrada, 'csv'));
        return;
    }
    if (!v.grafico) return;
    const comp = escenaExportable(v, entrada);
    const paleta = P.paletaDe(main);
    if (tipo === 'svg') {
        descargar(new Blob([P.svgTexto(comp, paleta, { titulo: `${v.titulo} · ${entrada.nombre}`, descripcion: v.resumen })], { type: 'image/svg+xml;charset=utf-8' }),
                  nombreDe(v, entrada, 'svg'));
        return;
    }
    const canvas = P.lienzo(comp, paleta, { anchoPx: 3000 });
    main.dataset.pngAncho = String(canvas.width);
    main.dataset.pngAlto = String(canvas.height);
    canvas.toBlob((blob) => { if (blob) descargar(blob, nombreDe(v, entrada, 'png')); }, 'image/png');
}

async function copiarEnlace() {
    const url = location.href;
    try {
        await navigator.clipboard.writeText(url);
        $('kvfAvisoEnlace').textContent = 'Enlace copiado.';
    } catch (_) {
        $('kvfAvisoEnlace').textContent = `Copiá este enlace: ${url}`;
    }
}

function ampliar() {
    const vista = $('kvfVista');
    if (document.fullscreenElement) {
        document.exitFullscreen?.();
        return;
    }
    if (vista.requestFullscreen) {
        vista.requestFullscreen().catch(() => alternarAmpliada(vista));
    } else {
        alternarAmpliada(vista);
    }
}

function alternarAmpliada(vista) {
    const activa = vista.classList.toggle('kvf__vista--ampliada');
    $('kvfAmpliar').textContent = activa ? 'Salir de pantalla ampliada' : 'Pantalla ampliada';
    $('kvfAmpliar').setAttribute('aria-pressed', String(activa));
    redibujar(true);
}

// Ficha municipal: un HTML autónomo con los gráficos disponibles (SVG en línea), sus tablas, la ficha y la metodología de
// esta municipalidad, en el tema elegido. Se arma vista por vista, con progreso y se puede cancelar.
let fichaEnCurso = null;

async function descargarFicha() {
    if (!actual?.municipio || fichaEnCurso) return;
    const { municipio, entrada } = actual;
    const trabajo = { cancelada: false };
    fichaEnCurso = trabajo;
    const progreso = $('kvfProgreso');
    $('kvfFichaProgreso').hidden = false;
    $('kvfFichaHtml').disabled = true;
    try {
        await cargarDetalle(municipio);
        const paleta = P.paletaDe(main);
        const secciones = [];
        for (let k = 0; k < graficos.length; k++) {
            if (trabajo.cancelada) throw new Error('cancelada');
            progreso.value = k;
            progreso.max = graficos.length;
            $('kvfProgresoTexto').textContent = `Armando ${k + 1} de ${graficos.length}: ${graficos[k].titulo}`;
            await new Promise((r) => setTimeout(r, 0));
            const v = M.construirVista(graficos[k], municipio, entrada, {}, { emisores: configuracion.prioritarios.emisores });
            const svg = v.grafico ? P.svgTexto(escenaExportable(v, entrada), paleta, { titulo: `${v.titulo} · ${entrada.nombre}`, descripcion: v.resumen, prefijo: `g${k + 1}` }) : null;
            secciones.push({ v, svg });
        }
        const html = fichaHtml(municipio, entrada, secciones, paleta);
        descargar(new Blob([html], { type: 'text/html;charset=utf-8' }), `${nombreArchivo('kalaguichi', estado.ejercicio, entrada.nombre, 'ficha', tema())}.html`);
        $('kvfProgresoTexto').textContent = 'Ficha descargada.';
    } catch (error) {
        $('kvfProgresoTexto').textContent = error.message === 'cancelada' ? 'Descarga cancelada: no se generó ningún archivo.' : `No se pudo armar la ficha: ${error.message}`;
    } finally {
        fichaEnCurso = null;
        $('kvfFichaHtml').disabled = false;
        progreso.value = 0;
    }
}

const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fichaHtml(municipio, entrada, secciones, paleta) {
    const proc = configuracion.procedencia;
    const tablaHtml = (v) => {
        if (!v.tabla) return '';
        const cab = v.tabla.columnas.map((c) => `<th>${h(c.titulo)}</th>`).join('');
        const filas = v.tabla.filas.map((f) => `<tr>${v.tabla.columnas.map((c) => {
            const x = f[c.id];
            const num = ['importe', 'pct', 'veces'].includes(c.tipo);
            const t = f.na?.includes(c.id) ? '—' : x === null || x === undefined || x === '' ? (num ? M.ND : '') : num ? nfTabla[c.tipo](x) : String(x);
            return `<td class="${num ? 'n' : ''}">${h(t)}</td>`;
        }).join('')}</tr>`).join('');
        return `<div class="t"><table><thead><tr>${cab}</tr></thead><tbody>${filas}</tbody></table></div>`;
    };
    const cuerpo = secciones.map(({ v, svg }) => `<section><h2>${h(v.titulo)}</h2>` +
        `<p class="m">Estado: ${h({ disponible: 'disponible', parcial: 'parcial', sin_datos: 'sin datos', no_aplicable: 'informativo', error: 'error técnico' }[v.estado])}` +
        `${v.motivo ? ` — ${h(v.motivo)}` : ''}</p>${svg ? `<figure>${svg.replace(/^<\?xml[^>]*>\s*/, '')}</figure>` : ''}` +
        `<p><strong>Qué muestra:</strong> ${h(v.que_muestra)}</p><p><strong>Límite de interpretación:</strong> ${h(v.limite)}</p>` +
        `<p class="m">Fuente: ${h(v.fuente)}</p>${tablaHtml(v)}</section>`).join('\n');
    const fichaFilas = M.ficha(municipio).map((p) => `<tr><th>${h(p.texto)}</th><td class="n">${h(p.texto_valor)}</td><td>${h(p.alcance)}${p.motivo ? ` Motivo: ${h(p.motivo)}` : ''}</td></tr>`).join('');
    const obs = (municipio.observaciones ?? []).map((o) => `<li>${h(o.detalle)} (${h(o.fuente)})</li>`).join('');
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${h(entrada.nombre)} · Ficha financiera ${estado.ejercicio} · Kalaguichi.com</title>
<style>body{margin:0;padding:24px;background:${paleta.fondo};color:${paleta.texto};font-family:${G.FUENTE};line-height:1.5}
main{max-width:1240px;margin:0 auto}h1{margin:0 0 4px}h2{margin:32px 0 8px;border-top:1px solid ${paleta.guia};padding-top:16px}.m{color:${paleta.suave};font-size:14px}
figure{margin:12px 0}figure svg{max-width:100%;height:auto}.t{overflow:auto;max-height:420px;border:1px solid ${paleta.guia};border-radius:8px}
table{border-collapse:collapse;font-size:13px;width:100%}th,td{padding:4px 8px;border-bottom:1px solid ${paleta.guia};text-align:left;white-space:nowrap}
td.n{text-align:right;font-variant-numeric:tabular-nums}</style></head>
<body><main>
<p class="m">Kalaguichi.com · Visualización financiera · Ficha municipal</p>
<h1>${h(entrada.nombre)}</h1>
<p class="m">${h(entrada.departamento_nombre)} · Código MEF ${h(entrada.id)} · Nombre en la fuente: ${h(entrada.nombre_fuente)} · Ejercicio ${estado.ejercicio} · Corte: ${h(fecha(manifiesto.corte))}</p>
<h2>Conceptos prioritarios</h2><table><tbody>${fichaFilas}</tbody></table>
${obs ? `<h2>Observaciones de calidad</h2><ul>${obs}</ul>` : ''}
${cuerpo}
<h2>Metodología y procedencia</h2>
<p>${h(proc.atribucion)}</p>
<p>Página oficial (procedencia documental, no una API): ${h(proc.url)}</p>
<p>Los importes son guaraníes nominales enteros; un N/D es un dato ausente, nunca un cero. Las agrupaciones, porcentajes y diferencias aritméticas son cálculos de Kalaguichi sobre las cifras publicadas y no partidas oficiales; los gráficos no son un aval del MEF ni una calificación de la gestión.</p>
<p class="m">Datos versión ${h(manifiesto.version)}, método ${M.METODO}. Generado en el navegador; no incluye datos de otras municipalidades.</p>
</main></body></html>
`;
}

// --- Inicio -------------------------------------------------------------------------------------------------------------
function metodo() {
    const caja = $('kvfMetodoCuerpo');
    const proc = configuracion.procedencia;
    const p1 = el('p', null, proc.atribucion);
    const p2 = el('p');
    const a = el('a', null, proc.enlace);
    a.href = proc.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    p2.append(a, document.createTextNode(` — ${proc.naturaleza}`));
    const p3 = el('p', null, 'Los datos se prepararon en local a partir de los CSV del paquete del MEF (cuadros presupuestarios y cuentas contables de cada ' +
        'municipalidad, sin abrir los PDF) y de los datos ya publicados en Financiero. Los importes son guaraníes nominales enteros; un N/D es ausencia, ' +
        'nunca cero. Las agrupaciones, los porcentajes y las diferencias aritméticas son cálculos de Kalaguichi, no partidas oficiales.');
    const p4 = el('p', null, `Dibujo: ${manifiesto.modos.decision} Datos versión ${manifiesto.version}, método ${M.METODO}, generados el ` +
        `${manifiesto.generado.slice(0, 10)}.`);
    caja.append(p1, p2, p3, p4);
    const t = el('table', 'tabla kvf__cobertura');
    const cab = el('tr');
    for (const x of ['Gráfico', 'Disponible', 'Parcial', 'Sin datos', 'Informativo', 'Con otro formato']) {
        const th = el('th', x === 'Gráfico' ? 'tabla__texto' : null, x);
        th.scope = 'col';
        cab.append(th);
    }
    const thead = el('thead');
    thead.append(cab);
    const tbody = el('tbody');
    for (const g of graficos) {
        const c = manifiesto.cobertura.graficos[g.id];
        const tr = el('tr');
        const th = el('th', 'tabla__texto', g.titulo);
        th.scope = 'row';
        const otros = Object.values(c.cambios).reduce((s, n) => s + n, 0);
        tr.append(th, ...[c.disponible, c.parcial, c.sin_datos, c.no_aplicable, otros].map((n) => el('td', null, M.entero(n))));
        tbody.append(tr);
    }
    t.append(thead, tbody);
    const scroll = el('div', 'tabla-scroll');
    scroll.append(t);
    caja.append(el('h3', null, `Cobertura de los ${graficos.length} gráficos en las ${M.entero(manifiesto.cobertura.municipios)} municipalidades`), scroll,
                el('p', 'nota', `${manifiesto.cobertura.informantes} con informe y ${manifiesto.cobertura.sin_informe} sin informe en el corte (para estas, una ficha documental sin cifras). ` +
                    '«Con otro formato»: barras con signo o cascada en lugar del Sankey, por negativos o recaudación superior a la prevista.'));
}

async function iniciar() {
    try {
        estado = M.estadoInicial(EJERCICIOS[0]);
        manifiesto = await leer('manifest.json', { versionada: false });
        const [municipios, cat, conf] = await Promise.all([leer('municipios.json'), leer('catalogo_graficos.json'), leer('configuracion.json')]);
        catalogo = M.crearCatalogo(municipios);
        graficos = cat.graficos;
        configuracion = conf;
    } catch (error) {
        main.dataset.listo = 'error';
        $('kvfErrorInicio').textContent = `No se pudieron leer los datos de la visualización (${error.message}).`;
        $('kvfErrorInicio').hidden = false;
        return;
    }
    $('kvfCorte').textContent = `Ejercicio ${manifiesto.ejercicio}, corte al ${fecha(manifiesto.corte)} · ${M.entero(manifiesto.cobertura.informantes)} municipalidades con informe y ` +
        `${M.entero(manifiesto.cobertura.sin_informe)} sin informe.`;
    for (const a of document.querySelectorAll('[data-fuente-oficial]')) {
        a.href = configuracion.procedencia.url;
        a.textContent = configuracion.procedencia.enlace;
    }
    armarControles();
    metodo();
    const { estado: leido, avisos } = M.leerEstado(location.hash, contexto());
    estado = leido;
    escribirEnlace('replace');
    mensaje(avisos);
    reflejarControles();
    opciones('');
    window.addEventListener('popstate', alNavegar);
    window.addEventListener('hashchange', alNavegar);
    new ResizeObserver(() => redibujar()).observe($('kvfGraficoCaja'));
    main.dataset.listo = 'true';
    await mostrar();
}

function alNavegar() {
    if (location.hash.replace(/^#/, '') === M.textoEstado(estado)) return;
    const { estado: leido, avisos } = M.leerEstado(location.hash, contexto());
    estado = leido;
    mensaje(avisos);
    reflejarControles();
    mostrar();
}

iniciar();
