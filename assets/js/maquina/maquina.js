// Máquina de votación (ADR-021, etapa 5): el inventario del software según la documentación técnica (inventario.json, de
// scripts/mv_inventario.py), los identificadores CPE revisados por una persona (cpe_map.json) y las CVE conocidas de cada
// versión (cves_resumen.json para el resumen y la tabla; cves.json, con todas las CVE, recién al abrir un detalle). Los
// filtros, la búsqueda y el detalle abierto van en el hash (#categoria=…&severidad=…&q=…&software=mv-041). Todo el texto
// se escribe con textContent, sin HTML desde los datos; los únicos enlaces externos son a NVD, OSV.dev y PyPI.
import { estado as compartido } from '../shell.js';
import { crearDialogo } from '../dialogo.js';
import { $, el, fmt, cantidad } from '../tablero/util.js';
import { descargarCsv } from '../analisis/exportar.js';

const BASE = new URL('../../../datos/maquina_votacion/', import.meta.url);
const SEVERIDADES = ['crítica', 'alta', 'media', 'baja'];
const ROTULO = { 'crítica': 'Crítica', alta: 'Alta', media: 'Media', baja: 'Baja', ninguna: 'Ninguna', 'sin puntaje': 'Sin puntaje' };
const PLURAL = { 'crítica': ['crítica', 'críticas'], alta: ['alta', 'altas'], media: ['media', 'medias'], baja: ['baja', 'bajas'] };
const CLASE = { 'crítica': 'critica', alta: 'alta', media: 'media', baja: 'baja', ninguna: 'ninguna', 'sin puntaje': 'sin-puntaje' };
const POR_PAGINA = 50;
const fecha = new Intl.DateTimeFormat('es-PY', { dateStyle: 'long', timeZone: 'America/Asuncion' });
const fechaCorta = new Intl.DateTimeFormat('es-PY', { dateStyle: 'medium', timeZone: 'UTC' });
const decimal = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

let inventario = null;
let cpeMap = null;
let resumen = null;
let todasLasCves = null;      // Promesa de cves.json: se pide una sola vez, al abrir el primer detalle con CVE.
let filas = [];               // [{ e, c, r, verificable, motivo, buscable }]
let idNucleo = null;
const dialogos = new Map();

async function leer(nombre) {
    const respuesta = await fetch(new URL(nombre, BASE));
    if (!respuesta.ok) throw new Error(`${nombre}: ${respuesta.status}`);
    return respuesta.json();
}

const cargarCves = () => (todasLasCves ??= leer('cves.json'));
const normal = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dia = (iso) => (iso ? fecha.format(new Date(iso)) : '—');
// Fechas sin hora («2025-03-05»): se leen como día, sin correrlas por la zona horaria.
const diaCorto = (texto) => (texto ? fechaCorta.format(new Date(`${texto.slice(0, 10)}T12:00:00Z`)) : '—');
const sinVersion = (e) => e.version === inventario.sin_version;

function par(dl, termino, valor) {
    if (valor === null || valor === undefined || valor === '') return;
    const div = el('div');
    const dd = el('dd');
    if (valor instanceof Node) dd.append(valor);
    else dd.textContent = String(valor);
    div.append(el('dt', null, termino), dd);
    dl.append(div);
}

function pildora(severidad, cvss) {
    const texto = cvss ? `${ROTULO[severidad]} · ${decimal.format(cvss.puntaje)}` : ROTULO[severidad];
    return el('span', `sev sev--${CLASE[severidad]}`, texto);
}

function enlaceExterno(texto, url, clase) {
    const a = el('a', clase, texto);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
}

// --- Modelo ---------------------------------------------------------------------------------------------------------

function motivo(e, c) {
    if (c?.estado === 'sin CPE') return 'Sin CPE (según la revisión)';
    if (sinVersion(e)) return 'Versión no especificada';
    const texto = (c?.nota ?? '').replace(/^No verificable automáticamente: /, '').replace(/\.$/, '');
    return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : 'Sin identificador público';
}

function armarFilas() {
    filas = inventario.elementos.map((e) => {
        const c = cpeMap.elementos[e.id] ?? null;
        const r = resumen.elementos[e.id] ?? null;
        return { e, c, r, verificable: Boolean(r), motivo: r ? null : motivo(e, c),
                 buscable: normal([e.componente, e.nombre, e.version, e.categoria, e.fabricante, e.origen.parrafo, e.origen.seccion, c?.cpe_final].join(' ')) };
    });
    idNucleo = inventario.elementos.find((e) => e.categoria === 'Núcleo' && resumen.elementos[e.id])?.id ?? null;
}

// --- Hash: filtros y detalle abierto ----------------------------------------------------------------------------------

function filtro() {
    const categoria = compartido.obtener('categoria') ?? '';
    const severidad = compartido.obtener('severidad') ?? '';
    return {
        categoria: inventario.categorias.includes(categoria) ? categoria : '',
        severidad: [...SEVERIDADES, 'ninguna', 'no-verificable'].includes(severidad) ? severidad : '',
        q: compartido.obtener('q') ?? '',
    };
}

function pasa(f, x) {
    if (f.categoria && x.e.categoria !== f.categoria) return false;
    if (f.severidad === 'no-verificable' && x.verificable) return false;
    if (f.severidad === 'ninguna' && (!x.verificable || x.r.total)) return false;
    if (SEVERIDADES.includes(f.severidad) && (!x.verificable || x.r.max_severidad !== f.severidad)) return false;
    const palabras = normal(f.q).split(/\s+/).filter(Boolean);
    return palabras.every((p) => x.buscable.includes(p));
}

// --- Resumen ------------------------------------------------------------------------------------------------------

function renderResumen() {
    const conVersion = inventario.elementos.filter((e) => e.version_exacta).length;
    const cifras = $('cifras');
    const tarjeta = (titulo, valor, clase, detalle) => {
        const div = el('div', `maquina__cifra ${clase ?? ''}`.trim());
        div.append(el('dt', null, titulo), el('dd', null, valor));
        if (detalle) div.append(el('dd', 'maquina__cifra-detalle', detalle));
        cifras.append(div);
    };
    cifras.replaceChildren();
    tarjeta('Componentes del inventario', fmt.format(inventario.elementos.length), null, `${cantidad(inventario.tablas, 'tabla', 'tablas')} y ${fmt.format(inventario.parrafos)} párrafos leídos`);
    tarjeta('Con versión exacta', fmt.format(conVersion), null, `${fmt.format(Object.keys(resumen.elementos).length)} con CPE revisado`);
    for (const s of SEVERIDADES) tarjeta(`CVE ${PLURAL[s][1]}`, fmt.format(resumen.por_severidad[s] ?? 0), `maquina__cifra--${CLASE[s]}`);
    tarjeta('En el catálogo KEV', fmt.format(resumen.en_kev), 'maquina__cifra--kev', 'con explotación conocida');
    tarjeta('Última consulta', dia(resumen.consultado_utc), 'maquina__cifra--fecha', 'NVD, OSV.dev y CISA KEV');
    const nota = $('notaResumen');
    nota.replaceChildren(`En total, ${cantidad(resumen.total, 'CVE conocida', 'CVE conocidas')} de las ${fmt.format(Object.keys(resumen.elementos).length)} versiones consultadas.`);
    if (idNucleo && resumen.cves_solo_de?.[idNucleo]) {
        const n = resumen.cves_solo_de[idNucleo];
        const boton = el('button', 'maquina__enlace', `ver el detalle del núcleo`);
        boton.type = 'button';
        boton.addEventListener('click', () => compartido.cambiar({ software: idNucleo }));
        nota.append(` ${cantidad(n, 'es', 'son')} solo del núcleo Linux 6.8: es una búsqueda amplia, porque Ubuntu corrige muchas en sus ` +
                    `compilaciones sin cambiar ese número (`, boton, `). Sin el núcleo quedan ${fmt.format(resumen.total - n)}.`);
    }
}

// --- Inventario ---------------------------------------------------------------------------------------------------

function renderFiltros() {
    const f = filtro();
    const categorias = $('filtroCategoria');
    if (categorias.options.length === 1) {
        for (const c of inventario.categorias) {
            const n = filas.filter((x) => x.e.categoria === c).length;
            if (n) categorias.append(new Option(`${c} (${fmt.format(n)})`, c));
        }
    }
    categorias.value = f.categoria;
    $('filtroSeveridad').value = f.severidad;
    if (document.activeElement !== $('filtroBuscar')) $('filtroBuscar').value = f.q;
}

function celdaOrigen(e) {
    const td = el('td', 'maquina__origen-celda');
    td.dataset.etiqueta = 'Origen';
    td.append(el('span', 'maquina__ubicacion', e.origen.parrafo));
    const detalle = [e.origen.seccion, e.origen.referencia_documental].filter(Boolean).join(' · ');
    if (detalle) td.append(el('span', 'maquina__referencia', detalle));
    return td;
}

function renderTabla() {
    const f = filtro();
    const visibles = filas.filter((x) => pasa(f, x));
    const cuerpo = $('filasInventario');
    cuerpo.replaceChildren(...visibles.map((x) => {
        const tr = el('tr');
        tr.dataset.id = x.e.id;
        const componente = el('td', 'tabla__texto', x.e.componente);
        componente.dataset.etiqueta = 'Componente';
        const nombre = el('th', 'tabla__texto maquina__software');
        nombre.scope = 'row';
        const boton = el('button', 'maquina__abrir', x.e.nombre);
        boton.type = 'button';
        boton.setAttribute('aria-haspopup', 'dialog');
        boton.addEventListener('click', () => compartido.cambiar({ software: x.e.id }));
        nombre.append(boton);
        if (x.e.fabricante && !x.e.fabricante.startsWith('no indicado')) nombre.append(el('span', 'maquina__fabricante', x.e.fabricante));
        const version = el('td', `tabla__texto maquina__version${sinVersion(x.e) ? ' maquina__version--sin' : ''}`, x.e.version);
        version.dataset.etiqueta = 'Versión';
        const categoria = el('td', 'tabla__texto', x.e.categoria);
        categoria.dataset.etiqueta = 'Categoría';
        const cves = el('td', 'maquina__cves');
        cves.dataset.etiqueta = 'CVE conocidas';
        if (x.verificable) {
            cves.append(el('span', 'maquina__total', fmt.format(x.r.total)));
            if (x.r.en_kev) cves.append(el('span', 'kev', `KEV ${fmt.format(x.r.en_kev)}`));
        } else {
            cves.append(el('span', 'maquina__no-verificable', 'No verificable'));
        }
        const severidad = el('td', 'maquina__severidad');
        severidad.dataset.etiqueta = 'Severidad máxima';
        if (x.verificable && x.r.max_severidad) severidad.append(pildora(x.r.max_severidad, x.r.max_puntaje !== null ? { puntaje: x.r.max_puntaje } : null));
        else severidad.append(el('span', 'maquina__vacio', x.verificable ? 'Ninguna conocida' : '—'));
        tr.append(componente, nombre, version, categoria, cves, severidad, celdaOrigen(x.e));
        return tr;
    }));
    const cuenta = $('cuentaInventario');
    cuenta.replaceChildren(`Se muestran ${fmt.format(visibles.length)} de ${cantidad(filas.length, 'elemento', 'elementos')}.`);
    if (f.categoria || f.severidad || f.q) {
        const limpiar = el('button', 'maquina__enlace', 'Quitar los filtros');
        limpiar.type = 'button';
        limpiar.addEventListener('click', () => compartido.cambiar({ categoria: null, severidad: null, q: null }));
        cuenta.append(' ', limpiar);
    }
    return visibles;
}

function descargar() {
    const visibles = filas.filter((x) => pasa(filtro(), x));
    const columnas = [
        { titulo: 'id', v: (x) => x.e.id }, { titulo: 'componente', v: (x) => x.e.componente }, { titulo: 'software', v: (x) => x.e.nombre },
        { titulo: 'fabricante', v: (x) => x.e.fabricante }, { titulo: 'version', v: (x) => x.e.version },
        { titulo: 'version_exacta', v: (x) => (x.e.version_exacta ? 'sí' : 'no') }, { titulo: 'categoria', v: (x) => x.e.categoria },
        { titulo: 'cpe', v: (x) => x.c?.cpe_final ?? '' }, { titulo: 'estado_cpe', v: (x) => x.c?.estado ?? '' },
        { titulo: 'cve_conocidas', v: (x) => (x.verificable ? x.r.total : 'no verificable') },
        { titulo: 'severidad_maxima', v: (x) => (x.verificable ? x.r.max_severidad ?? 'ninguna' : '') },
        { titulo: 'cve_en_kev', v: (x) => (x.verificable ? x.r.en_kev : '') }, { titulo: 'motivo_no_verificable', v: (x) => x.motivo ?? '' },
        { titulo: 'origen_ubicacion', v: (x) => x.e.origen.parrafo }, { titulo: 'origen_seccion', v: (x) => x.e.origen.seccion },
        { titulo: 'origen_referencia', v: (x) => x.e.origen.referencia_documental ?? '' }, { titulo: 'origen_texto_literal', v: (x) => x.e.origen.texto_literal },
    ];
    descargarCsv('maquina-votacion_inventario', columnas, visibles);
}

// --- No verificables ------------------------------------------------------------------------------------------------

function renderNoVerificables() {
    const grupos = new Map();
    for (const x of filas.filter((f) => !f.verificable)) {
        if (!grupos.has(x.motivo)) grupos.set(x.motivo, []);
        grupos.get(x.motivo).push(x);
    }
    const caja = $('gruposNoVerificables');
    caja.replaceChildren(...[...grupos].sort((a, b) => b[1].length - a[1].length).map(([titulo, lista]) => {
        const det = el('details', 'maquina__grupo');
        det.append(el('summary', null, `${titulo} (${fmt.format(lista.length)})`));
        const ul = el('ul', 'maquina__lista-simple');
        for (const x of lista) {
            const li = el('li');
            const boton = el('button', 'maquina__abrir', x.e.nombre);
            boton.type = 'button';
            boton.setAttribute('aria-haspopup', 'dialog');
            boton.addEventListener('click', () => compartido.cambiar({ software: x.e.id }));
            li.append(boton, el('span', 'maquina__fabricante', `${sinVersion(x.e) ? 'sin versión' : x.e.version} · ${x.e.componente} · ${x.e.origen.parrafo}`));
            ul.append(li);
        }
        det.append(ul);
        return det;
    }));
    $('tituloNoVerificables').textContent = `No verificables automáticamente (${fmt.format(filas.filter((f) => !f.verificable).length)})`;
}

// --- Fuentes --------------------------------------------------------------------------------------------------------

function renderFuentes() {
    const fu = resumen.fuentes;
    const revisados = Object.values(cpeMap.elementos).filter((x) => ['confirmado', 'corregido', 'sin CPE'].includes(x.estado));
    const cuenta = (estado) => revisados.filter((x) => x.estado === estado).length;
    const dl = $('fuentes');
    dl.replaceChildren();
    const f = inventario.fuente;
    par(dl, 'Inventario', `«${f.titulo}», documento técnico de divulgación (${f.fecha_del_documento ?? 'sin fecha'}), elaborado a partir de la ` +
        'documentación de las máquinas (entre otras, la Nota S.G. N.º 306/2026 del TSJE, la memoria técnica y las respuestas de la auditoría de ' +
        `febrero de 2026). Archivo ${f.documento} (la especificación lo llama mv.docx), SHA-256 ${f.sha256}. Extraído con ` +
        `scripts/mv_inventario.py el ${dia(inventario.generado_utc)}: ${fmt.format(f.tablas)} tablas y ${fmt.format(f.parrafos_con_texto)} párrafos; cada ` +
        'elemento lleva su ubicación y el texto literal del documento.');
    par(dl, 'Identificadores CPE', `Propuestos con la API de productos CPE 2.0 de NVD (scripts/mv_cpe.py) y revisados por una persona el ` +
        `${dia(cpeMap.revisado_utc)}: ${cantidad(cuenta('confirmado'), 'confirmado', 'confirmados')}, ${cantidad(cuenta('corregido'), 'corregido', 'corregidos')}` +
        ` y ${fmt.format(cuenta('sin CPE'))} sin CPE. Solo esos se consultan.`);
    const nvd = el('span');
    nvd.append(`API 2.0 de CVE del NIST, consultada el ${dia(fu.nvd.consultado_utc)} por cpeName, solo con las configuraciones en que esa versión es ` +
        'vulnerable y sin las CVE rechazadas (scripts/mv_cve.py). ', enlaceExterno('nvd.nist.gov', 'https://nvd.nist.gov/'),
        '. Este sitio usa la API de NVD, pero NVD no lo avala ni lo certifica (This product uses the NVD API but is not endorsed or certified by the NVD).');
    par(dl, 'NVD', nvd);
    const osv = el('span');
    osv.append(`Consultado el ${dia(fu.osv.consultado_utc)} para las bibliotecas de PyPI con CPE revisado; sus avisos con identificador CVE se ` +
        'suman a la lista con su registro de NVD. Cada aviso conserva la licencia de su base de origen. ', enlaceExterno('osv.dev', 'https://osv.dev/'), '.');
    par(dl, 'OSV.dev', osv);
    const kev = el('span');
    kev.append(`Catálogo de vulnerabilidades con explotación conocida, versión ${fu.kev.version_catalogo} (${dia(fu.kev.publicado)}), consultado el ` +
        `${dia(fu.kev.consultado_utc)}. `, enlaceExterno('cisa.gov', 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog'), '.');
    par(dl, 'CISA KEV', kev);
    par(dl, 'Actualización', 'scripts/mv_cve.py repite las consultas a mano o con una GitHub Action semanal; el sitio publicado se actualiza ' +
        'cuando se publica una versión nueva. Datos completos en datos/maquina_votacion/ (inventario.json, cpe_map.json y cves.json).');
    par(dl, 'Severidad', 'La de NVD según CVSS (la versión 3.1 cuando existe; si NVD no la calculó, la que informa quien registró la CVE). ' +
        'La descripción de cada CVE es la de NVD, en inglés.');
    const t = $('alcanceFuentes');
    t.textContent = `Inventario: el documento técnico «${f.titulo}» (${f.fecha_del_documento ?? 'sin fecha'}). Bases consultadas: NVD el ` +
        `${dia(fu.nvd.consultado_utc)}, OSV.dev el ${dia(fu.osv.consultado_utc)} y el catálogo KEV de CISA (versión ${fu.kev.version_catalogo}) el ` +
        `${dia(fu.kev.consultado_utc)}.`;
}

// --- Detalle de un software -------------------------------------------------------------------------------------------

function seccion(titulo, ...nodos) {
    const s = el('section', 'maquina__detalle-seccion');
    s.append(el('h3', null, titulo), ...nodos);
    return s;
}

function bloqueOrigen(e) {
    const caja = el('div', 'maquina__origen');
    caja.append(el('p', 'maquina__ubicacion', `${e.origen.parrafo} · ${e.origen.seccion}`));
    if (e.origen.referencia_documental) caja.append(el('p', 'nota', `Fuente que cita el documento: ${e.origen.referencia_documental}`));
    caja.append(el('blockquote', 'maquina__cita', e.origen.texto_literal));
    const otras = e.menciones.filter((m) => m.parrafo !== e.origen.parrafo || m.texto_literal !== e.origen.texto_literal);
    if (otras.length) {
        const det = el('details', 'maquina__menciones');
        det.append(el('summary', null, `Otras ${cantidad(otras.length, 'mención', 'menciones')} en el documento`));
        const ol = el('ol');
        for (const m of otras) {
            const li = el('li');
            li.append(el('span', 'maquina__ubicacion', `${m.parrafo} · ${m.seccion}`), el('span', 'maquina__cita-breve', m.texto_literal));
            ol.append(li);
        }
        det.append(ol);
        caja.append(det);
    }
    return caja;
}

function bloqueCpe(x) {
    const dl = el('dl', 'maquina__datos');
    const c = x.c;
    if (!c) return dl;
    const estado = { confirmado: 'Confirmado por la revisión', corregido: 'Corregido por la revisión', 'sin CPE': 'Sin CPE según la revisión',
                     'no verificable': 'No verificable automáticamente', propuesto: 'Propuesto, sin revisar' }[c.estado] ?? c.estado;
    par(dl, 'Estado', estado);
    if (c.cpe_final) par(dl, 'CPE', el('code', 'maquina__cpe', c.cpe_final));
    if (c.cpe_final && c.propuesto && c.propuesto !== c.cpe_final) par(dl, 'Propuesto antes', el('code', 'maquina__cpe', c.propuesto));
    if (c.osv) {
        const osv = el('span');
        osv.append(`${c.osv.ecosystem} · ${c.osv.name} ${c.osv.version} (`, enlaceExterno('PyPI', `https://pypi.org/project/${encodeURIComponent(c.osv.name)}/${encodeURIComponent(c.osv.version)}/`), ')');
        par(dl, 'Paquete en OSV.dev', osv);
    }
    if (!x.verificable) par(dl, 'Motivo', x.motivo);
    if (c.revisado_utc) par(dl, 'Revisado', dia(c.revisado_utc));
    return dl;
}

function itemCve(r) {
    const li = el('li', 'cve');
    const cabecera = el('div', 'cve__cabecera');
    cabecera.append(enlaceExterno(r.id, r.url, 'cve__id'), pildora(r.severidad, r.cvss));
    if (r.kev) cabecera.append(el('span', 'kev', 'KEV: explotación conocida'));
    li.append(cabecera);
    const meta = [`Publicada el ${diaCorto(r.publicado)}`, r.cvss ? `CVSS ${r.cvss.version}: ${decimal.format(r.cvss.puntaje)} (${r.cvss.fuente})` : 'Sin puntaje',
                  `Encontrada en ${r.fuentes.join(' y ')}`];
    if (r.kev) meta.push(`En el catálogo KEV desde el ${diaCorto(r.kev.agregada)}`);
    li.append(el('p', 'cve__meta', meta.join(' · ')));
    const descripcion = el('p', 'cve__descripcion', r.descripcion);
    descripcion.lang = 'en';
    li.append(descripcion);
    return li;
}

async function bloqueCves(x) {
    const caja = el('div', 'maquina__cves-detalle');
    const r = x.r;
    const partes = SEVERIDADES.filter((s) => r.por_severidad[s]).map((s) => `${fmt.format(r.por_severidad[s])} ${PLURAL[s][r.por_severidad[s] === 1 ? 0 : 1]}`);
    caja.append(el('p', 'maquina__cves-resumen', r.total
        ? `${cantidad(r.total, 'CVE conocida', 'CVE conocidas')}: ${partes.join(', ')}${r.en_kev ? `; ${fmt.format(r.en_kev)} en el catálogo KEV` : ''}.`
        : 'Ninguna CVE conocida para esta versión en las bases consultadas.'));
    caja.append(el('p', 'nota', `Consultas: NVD por el CPE (${cantidad(r.nvd, 'CVE', 'CVE')})${r.osv ? `, OSV.dev por el paquete de PyPI (${cantidad(r.osv_avisos, 'aviso', 'avisos')})` : ''}.`));
    if (x.c?.aviso) caja.append(el('p', 'maquina__aviso', x.c.aviso));
    if (!r.total) return caja;
    const datos = await cargarCves();
    const lista = datos.elementos[x.e.id].cves.map((id) => datos.cves[id]);
    // Filtros dentro del detalle (útiles con muchas CVE): severidad, solo KEV y búsqueda.
    const controles = el('div', 'maquina__filtros maquina__filtros--detalle');
    const severidad = el('select');
    severidad.id = `sev-${x.e.id}`;
    severidad.append(new Option('Todas', ''), ...SEVERIDADES.filter((s) => r.por_severidad[s]).map((s) => new Option(ROTULO[s], s)));
    const etiquetaSev = el('label', 'campo-select', 'Severidad');
    etiquetaSev.htmlFor = severidad.id;
    etiquetaSev.append(severidad);
    const soloKev = el('input');
    soloKev.type = 'checkbox';
    soloKev.id = `kev-${x.e.id}`;
    const etiquetaKev = el('label', 'maquina__casilla', 'Solo en KEV');
    etiquetaKev.htmlFor = soloKev.id;
    etiquetaKev.prepend(soloKev);
    const buscar = el('input');
    buscar.type = 'search';
    buscar.id = `buscar-${x.e.id}`;
    buscar.placeholder = 'CVE o palabra (en inglés)';
    buscar.autocomplete = 'off';
    const etiquetaBuscar = el('label', 'campo-buscar', 'Buscar');
    etiquetaBuscar.htmlFor = buscar.id;
    etiquetaBuscar.append(buscar);
    if (lista.length > 8) controles.append(etiquetaSev, ...(r.en_kev ? [etiquetaKev] : []), etiquetaBuscar);
    const cuenta = el('p', 'nota');
    cuenta.setAttribute('aria-live', 'polite');
    const ul = el('ul', 'maquina__lista-cves');
    const mas = el('button', 'boton-secundario', '');
    mas.type = 'button';
    let mostradas = POR_PAGINA;
    const pintar = () => {
        const q = normal(buscar.value.trim());
        const elegidas = lista.filter((c) => (!severidad.value || c.severidad === severidad.value) && (!soloKev.checked || c.kev)
            && (!q || normal(`${c.id} ${c.descripcion}`).includes(q)));
        ul.replaceChildren(...elegidas.slice(0, mostradas).map(itemCve));
        cuenta.textContent = elegidas.length > mostradas ? `Se muestran ${fmt.format(mostradas)} de ${fmt.format(elegidas.length)}.` : `${cantidad(elegidas.length, 'CVE', 'CVE')}.`;
        mas.hidden = elegidas.length <= mostradas;
        mas.textContent = `Mostrar ${fmt.format(Math.min(POR_PAGINA, elegidas.length - mostradas))} más`;
    };
    for (const control of [severidad, soloKev]) control.addEventListener('change', () => { mostradas = POR_PAGINA; pintar(); });
    buscar.addEventListener('input', () => { mostradas = POR_PAGINA; pintar(); });
    mas.addEventListener('click', () => { mostradas += POR_PAGINA; pintar(); });
    pintar();
    caja.append(controles, cuenta, ul, mas);
    const sinCve = (datos.avisos_osv_sin_cve ?? []).filter((a) => a.afecta.includes(x.e.id));
    if (sinCve.length) {
        const ol = el('ul', 'maquina__lista-simple');
        for (const a of sinCve) {
            const li = el('li');
            li.append(enlaceExterno(a.id, a.url), ` · ${a.resumen}`);
            ol.append(li);
        }
        caja.append(el('h4', null, 'Avisos de OSV.dev sin identificador CVE'), ol);
    }
    return caja;
}

async function contenidoDetalle(x) {
    const raiz = el('div', 'maquina__detalle');
    const datos = el('dl', 'maquina__datos');
    par(datos, 'Componente', x.e.componente);
    par(datos, 'Categoría', x.e.categoria);
    par(datos, 'Fabricante', x.e.fabricante);
    par(datos, 'Versión', x.e.version);
    par(datos, 'Versión exacta', x.e.version_exacta ? 'Sí' : 'No');
    par(datos, 'Licencia declarada', x.e.licencia_declarada);
    par(datos, 'Notas', x.e.notas);
    raiz.append(seccion('En el inventario', datos), seccion('Origen en el documento', bloqueOrigen(x.e)), seccion('Identificador CPE', bloqueCpe(x)));
    if (x.verificable) raiz.append(seccion('Vulnerabilidades conocidas (CVE)', await bloqueCves(x)));
    else raiz.append(seccion('Vulnerabilidades conocidas (CVE)', el('p', 'nota', `No verificable automáticamente (${x.motivo.toLowerCase()}): no se consultaron bases de vulnerabilidades.`)));
    raiz.append(el('p', 'maquina__alcance-breve', 'Una CVE asociada a esta versión indica una vulnerabilidad conocida del software, no que sea explotable en la ' +
        'configuración de la máquina de votación; eso depende de cómo está instalado y protegido.'));
    return raiz;
}

function dialogoDe(x) {
    if (!dialogos.has(x.e.id)) {
        const titulo = sinVersion(x.e) ? x.e.nombre : `${x.e.nombre} ${x.e.version}`;
        const d = crearDialogo({ titulo, contenido: () => contenidoDetalle(x), clase: 'dialogo--maquina' });
        d.elemento.dataset.software = x.e.id;
        d.elemento.addEventListener('close', () => {
            if (compartido.obtener('software') === x.e.id) compartido.cambiar({ software: null });
        });
        dialogos.set(x.e.id, d);
    }
    return dialogos.get(x.e.id);
}

function aplicarDetalle() {
    const id = compartido.obtener('software');
    const x = filas.find((f) => f.e.id === id);
    for (const [otro, d] of dialogos) if (d.abierto() && otro !== id) d.cerrar();
    if (!x) {
        if (id) compartido.cambiar({ software: null });
        return;
    }
    const d = dialogoDe(x);
    if (!d.abierto()) d.abrir(document.activeElement);
}

// --- Arranque -------------------------------------------------------------------------------------------------------

function eventos() {
    $('filtroCategoria').addEventListener('change', (evento) => compartido.cambiar({ categoria: evento.target.value || null }));
    $('filtroSeveridad').addEventListener('change', (evento) => compartido.cambiar({ severidad: evento.target.value || null }));
    let espera = null;
    $('filtroBuscar').addEventListener('input', (evento) => {
        clearTimeout(espera);
        espera = setTimeout(() => compartido.cambiar({ q: evento.target.value.trim() || null }), 200);
    });
    $('descargarCsv').addEventListener('click', descargar);
    compartido.suscribir(({ cambiadas }) => {
        if (['categoria', 'severidad', 'q'].some((k) => cambiadas.has(k))) {
            renderFiltros();
            renderTabla();
        }
        if (cambiadas.has('software')) aplicarDetalle();
    });
}

async function iniciar() {
    const raiz = $('maquina');
    try {
        [inventario, cpeMap, resumen] = await Promise.all([leer('inventario.json'), leer('cpe_map.json'), leer('cves_resumen.json')]);
        inventario.tablas = inventario.fuente.tablas;
        inventario.parrafos = inventario.fuente.parrafos_con_texto;
        armarFilas();
        renderResumen();
        renderFiltros();
        renderTabla();
        renderNoVerificables();
        renderFuentes();
        eventos();
        raiz.dataset.listo = 'true';
        aplicarDetalle();
    } catch (error) {
        const aviso = $('errorCarga');
        aviso.hidden = false;
        aviso.textContent = 'No fue posible leer los datos de la máquina de votación. Revisá la conexión o el servidor local.';
        raiz.dataset.listo = 'error';
        console.error(error);
    } finally {
        raiz.setAttribute('aria-busy', 'false');
    }
}

iniciar();
