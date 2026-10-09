// Análisis del padrón (ADR-028; ADR 0026 del módulo): lee los tres archivos del conjunto (manifiesto, resumen y
// demografía), arma los filtros (departamento y distrito) y dibuja los quince segmentos. El estado va en el enlace
// (#departamento=…&distrito=…&vista=resumida). Los datos se leen una sola vez: al cambiar un filtro todo se vuelve a
// dibujar desde ellos, y un gráfico que termina de cargar después de otro cambio no se dibuja (T29).
import { $, el, fmt } from '../tablero/util.js';
import { renderizar, metodo } from './segmentos.js';

const CARPETA = new URL('../../../datos/padron_analisis/municipales-2026/padron-2026/', import.meta.url);
const estado = { dep: null, dis: null, vista: 'desplegada' };
let datos = null;
let turno = 0;

async function leer(nombre) {
    const respuesta = await fetch(new URL(nombre, CARPETA));
    if (!respuesta.ok) throw new Error(`${nombre}: HTTP ${respuesta.status}`);
    return respuesta.json();
}

const fechaLarga = (iso) => {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, m - 1, d).toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' });
};

function leerEnlace() {
    const p = new URLSearchParams(location.hash.slice(1));
    const dep = p.get('departamento');
    estado.dep = /^\d+$/.test(dep ?? '') && datos.porDep.has(Number(dep)) ? Number(dep) : null;
    const dis = p.get('distrito');
    estado.dis = dis && datos.porDis.has(dis) && (estado.dep === null || datos.porDis.get(dis).departamento === estado.dep) ? dis : null;
    if (estado.dis !== null) estado.dep = datos.porDis.get(estado.dis).departamento;
    estado.vista = p.get('vista') === 'resumida' ? 'resumida' : 'desplegada';
}

function escribirEnlace() {
    const p = new URLSearchParams();
    if (estado.dep !== null) p.set('departamento', String(estado.dep));
    if (estado.dis !== null) p.set('distrito', estado.dis);
    if (estado.vista === 'resumida') p.set('vista', 'resumida');
    const hash = p.toString();
    if (hash !== location.hash.slice(1)) history.replaceState(null, '', hash ? `#${hash}` : `${location.pathname}${location.search}`);
}

function armarFiltros() {
    const sDep = $('filtroDepartamento');
    const sDis = $('filtroDistrito');
    for (const d of datos.demografia.departamentos) sDep.append(new Option(d.nombre, String(d.codigo)));
    sDep.addEventListener('change', () => {
        estado.dep = sDep.value === '' ? null : Number(sDep.value);
        estado.dis = null;
        dibujar();
    });
    sDis.addEventListener('change', () => {
        estado.dis = sDis.value || null;
        dibujar();
    });
}

function reflejarFiltros() {
    const sDep = $('filtroDepartamento');
    const sDis = $('filtroDistrito');
    sDep.value = estado.dep === null ? '' : String(estado.dep);
    const suyos = estado.dep === null ? [] : datos.demografia.distritos.filter((d) => d.departamento === estado.dep)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    sDis.replaceChildren(new Option('Todos los distritos', ''), ...suyos.map((d) => new Option(d.nombre, d.clave)));
    sDis.disabled = estado.dep === null;
    sDis.value = estado.dis ?? '';
}

function contexto() {
    const nivel = estado.dis !== null ? 'distrito' : estado.dep !== null ? 'departamento' : 'pais';
    const dep = estado.dep !== null ? datos.porDep.get(estado.dep) : null;
    const dis = estado.dis !== null ? datos.porDis.get(estado.dis) : null;
    const fila = nivel === 'departamento' ? datos.filaDep.get(estado.dep) : nivel === 'distrito' ? datos.filaDis.get(estado.dis) : null;
    const textoAmbito = nivel === 'pais' ? 'Todo el país' : nivel === 'departamento' ? dep.nombre : `${dis.nombre}, ${dep.nombre}`;
    turno += 1;
    return { ...datos, nivel, dep, dis, fila, vista: estado.vista, turno, turnoActual: () => turno, textoAmbito,
             textoFechaEtaria: fechaLarga(datos.manifiesto.fecha_etaria.valor),
             textoFecha: 'Municipales 2026',
             textoFechaEdad: `Edad cumplida al ${fechaLarga(datos.manifiesto.fecha_etaria.valor)}`,
             alCambiarVista: (vista) => {
                 estado.vista = vista;
                 dibujar();
             } };
}

function dibujar() {
    reflejarFiltros();
    const ctx = contexto();
    $('ambitoAnalisis').textContent = `Mostrando: ${ctx.textoAmbito}.`;
    renderizar(ctx, { cuerpo: (id) => document.querySelector(`[data-segmento="${id}"]`),
                      estado: (id) => document.querySelector(`[data-estado-de="${id}"]`) });
    escribirEnlace();
}

function cabecera() {
    const m = datos.manifiesto;
    const dl = $('datosDelConjunto');
    for (const [dt, dd] of [['Universo', m.universo.split(':')[0]], ['Registros', fmt.format(datos.demografia.pais.registros)],
                            ['Edad cumplida al', fechaLarga(m.fecha_etaria.valor)], ['Resultados', m.evento.etapa_de_resultados]]) {
        dl.append(el('dt', null, dt), el('dd', null, dd));
    }
    $('metodoAnalisis').replaceChildren(metodo({ ...datos, textoFechaEtaria: fechaLarga(m.fecha_etaria.valor) }));
}

async function iniciar() {
    const main = $('contenido');
    try {
        const [manifiesto, resumen, demografia] = await Promise.all([leer('manifiesto.json'), leer('resumen.json'), leer('demografia.json')]);
        datos = { manifiesto, resumen, demografia,
                  porDep: new Map(demografia.departamentos.map((d) => [d.codigo, d])),
                  porDis: new Map(demografia.distritos.map((d) => [d.clave, d])),
                  filaDep: new Map(resumen.s04.departamentos.map((d) => [d.codigo, d])),
                  filaDis: new Map(resumen.s04.distritos.map((d) => [d.clave, d])) };
    } catch (error) {
        const aviso = el('p', 'padron-analisis__error', 'No fue posible leer los cuadros del análisis del padrón. Revisá la conexión o el servidor local.');
        aviso.setAttribute('role', 'alert');
        main.querySelector('.padron-analisis__cabecera').after(aviso);
        main.dataset.listo = 'error';
        console.error(error);
        return;
    }
    cabecera();
    armarFiltros();
    leerEnlace();
    dibujar();
    addEventListener('hashchange', () => {
        leerEnlace();
        dibujar();
    });
    // Al cambiar el tema, los gráficos toman los colores nuevos.
    new MutationObserver(() => dibujar()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    main.dataset.listo = 'true';
}

iniciar();
