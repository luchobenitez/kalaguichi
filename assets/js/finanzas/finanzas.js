// Finanzas municipales · Ejercicio 2025 (ADR-029; ADR 0027 del módulo): la página /analisis/financiero/2025/. Lee una sola
// vez los datos preparados (datos/finanzas/municipalidad/2025/) y la geometría del país del sitio; arma los filtros (cargo,
// departamento, municipio, listas e indicador, en el enlace), un solo mapa coroplético por municipio con la escala nacional
// fija del indicador, su leyenda, la cobertura y la tabla de Presupuesto y Balance con la ficha de cada municipio y el CSV
// del filtro. Al filtrar se vuelve a pintar el mismo mapa: no se recrea ni se vuelve a leer nada. Sin HTML desde datos.
import { $, el, fmt } from '../tablero/util.js';
import { geoNacional, indiceNacional } from '../datos.js';
import { crearMapaPais } from '../tablero/mapa_pais.js';
import { enlaceOsm } from '../tablero/base_pais.js';
import { descargar, nombreArchivo } from '../analisis/exportar.js';
import * as L from './logica.js';

const CARPETA = new URL('../../../datos/finanzas/municipalidad/2025/', import.meta.url);
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

let modelo = null;
let estado = null;
let info = null;        // el conjunto del filtro
let mapa = null;        // la API del mapa (null mientras carga o sin WebGL)
let encuadre;           // el departamento encuadrado: undefined, ninguno todavía; null, el país
let cajasDep = new Map();
let claveListas = null; // cargo y departamento con los que se armaron las opciones de listas
let turnoTabla = 0;
let columnasArmadas = null; // la vista con la que se armó el selector de columnas
const tabla = { pagina: 0, orden: null, busqueda: '', elegidas: Object.fromEntries(L.VISTAS.map((v) => [v, new Set(L.RESUMEN[v])])) };
const oscuro = () => document.documentElement.dataset.theme === 'dark';
const ordenarPorNombre = (lista) => [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
const siglaDe = (cargo) => (id) => modelo.electoral.listas[cargo]?.[id]?.sigla ?? id;
const cantidad = (n, uno, varios) => `${fmt.format(n)} ${n === 1 ? uno : varios}`;
// La primera letra en minúscula (sin tocar siglas como TREP), para usar un rótulo dentro de una oración.
const enOracion = (texto) => texto.charAt(0).toLowerCase() + texto.slice(1);

function fechaLarga(iso) {
    const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
    const fecha = new Date(a, m - 1, d).toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' });
    return iso.length > 10 ? `${fecha}, ${iso.slice(11, 16)}` : fecha;
}

async function cargarHoja(vista) {
    if (modelo.hojas[vista]) return;
    L.agregarHoja(modelo, vista, await leer(`${vista}.json`));
}

// --- Estado y enlace ----------------------------------------------------------------------------------------------------
function escribirEnlace() {
    const hash = L.textoEstado(estado, modelo);
    if (hash !== location.hash.slice(1)) history.replaceState(null, '', hash ? `#${hash}` : `${location.pathname}${location.search}`);
}

function mostrarMensajes(mensajes) {
    const nodo = $('mensajeFiltros');
    nodo.textContent = mensajes.join(' ');
    nodo.hidden = !mensajes.length;
}

// Un cambio de estado: se recalcula el conjunto y se vuelve a dibujar todo desde los datos ya leídos.
function aplicar(mensajes = []) {
    info = L.conjunto(modelo, estado);
    if (estado.municipio !== null && !info.claves.has(estado.municipio)) {
        estado = { ...estado, municipio: null };
        mensajes = [...mensajes, 'El municipio elegido quedó fuera del filtro: se quitó la selección.'];
    }
    if (!info.municipios.length) {
        mensajes = [...mensajes, 'Ningún municipio cumple todos los filtros a la vez: probá con otras listas, otro departamento o «Restablecer filtros».'];
    }
    reflejarControles();
    pintarMapa();
    dibujarLeyenda();
    dibujarIndicador();
    dibujarAmbito();
    dibujarDato();
    dibujarCobertura();
    dibujarTabla();
    escribirEnlace();
    mostrarMensajes(mensajes);
}

// --- Controles ----------------------------------------------------------------------------------------------------------
function armarControles() {
    for (const boton of $('filtroCargo').querySelectorAll('button[data-cargo]')) {
        boton.addEventListener('click', () => {
            if (estado.cargo === boton.dataset.cargo) return;
            const antes = estado.cargo;
            const cambio = L.cambiarCargo(modelo, estado, boton.dataset.cargo);
            const mensajes = [];
            if (cambio.quitadas.length) {
                mensajes.push(`Al cambiar a ${L.ROTULO_CARGO[cambio.estado.cargo]} se ${cambio.quitadas.length === 1 ? 'quitó una lista' : `quitaron ${cambio.quitadas.length} listas`} ` +
                    `sin municipios en ese cargo: ${cambio.quitadas.map(siglaDe(antes)).join(', ')}.`);
            }
            if (cambio.municipioQuitado) mensajes.push('El municipio elegido quedó fuera del filtro: se quitó la selección.');
            estado = cambio.estado;
            tabla.pagina = 0;
            aplicar(mensajes);
        });
    }
    const sDep = $('filtroDepartamento');
    for (const d of modelo.departamentos) sDep.append(new Option(d.nombre, String(d.codigo)));
    sDep.addEventListener('change', () => {
        estado = { ...estado, departamento: sDep.value === '' ? null : Number(sDep.value) };
        tabla.pagina = 0;
        aplicar();
    });
    $('filtroMunicipio').addEventListener('change', (evento) => elegirMunicipio(evento.target.value || null));
    $('buscarLista').addEventListener('input', filtrarOpcionesListas);
    $('todasLasListas').addEventListener('click', () => {
        estado = { ...estado, listas: [] };
        tabla.pagina = 0;
        aplicar();
    });
    $('opcionesListas').addEventListener('change', (evento) => {
        const caja = evento.target.closest('input[type="checkbox"]');
        if (!caja) return;
        const listas = new Set(estado.listas);
        if (caja.checked) listas.add(caja.value);
        else listas.delete(caja.value);
        estado = { ...estado, listas: [...listas] };
        tabla.pagina = 0;
        aplicar();
    });
    const sInd = $('filtroIndicador');
    const grupos = new Map();
    for (const m of modelo.metricas) {
        if (!grupos.has(m.grupo)) {
            const grupo = el('optgroup');
            grupo.label = m.grupo;
            grupos.set(m.grupo, grupo);
            sInd.append(grupo);
        }
        grupos.get(m.grupo).append(new Option(`${m.nombre} (${L.UNIDAD_CORTA[m.unidad] ?? m.unidad})`, m.campo));
    }
    // Cambiar de indicador conserva el filtro, el encuadre y la selección.
    sInd.addEventListener('change', () => {
        estado = { ...estado, indicador: sInd.value };
        aplicar();
    });
    const buscar = $('buscarIndicador');
    const resultados = $('resultadosIndicador');
    const elegirMetrica = (campo) => {
        buscar.value = '';
        resultados.hidden = true;
        estado = { ...estado, indicador: campo };
        aplicar();
        sInd.focus();
    };
    buscar.addEventListener('input', () => {
        const encontradas = L.buscarMetricas(modelo, buscar.value);
        resultados.replaceChildren(...encontradas.slice(0, 10).map((m) => {
            const li = el('li');
            const boton = el('button', 'finanzas__resultado', `${m.nombre} (${L.UNIDAD_CORTA[m.unidad] ?? m.unidad})`);
            boton.type = 'button';
            boton.dataset.campo = m.campo;
            if (m.subtitulo) boton.append(el('span', 'finanzas__resultado-detalle', m.subtitulo));
            li.append(boton);
            return li;
        }));
        if (buscar.value.trim() && !encontradas.length) resultados.append(el('li', 'finanzas__resultado-vacio', 'Ningún indicador coincide.'));
        resultados.hidden = !buscar.value.trim();
    });
    buscar.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter') {
            evento.preventDefault();
            const primero = resultados.querySelector('[data-campo]');
            if (primero) elegirMetrica(primero.dataset.campo);
        } else if (evento.key === 'Escape') {
            buscar.value = '';
            resultados.hidden = true;
        }
    });
    resultados.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-campo]');
        if (boton) elegirMetrica(boton.dataset.campo);
    });
    $('restablecerFiltros').addEventListener('click', () => {
        estado = L.estadoInicial(modelo);
        Object.assign(tabla, { pagina: 0, orden: null, busqueda: '' });
        for (const v of L.VISTAS) tabla.elegidas[v] = new Set(L.RESUMEN[v]);
        $('buscarMunicipio').value = '';
        $('buscarLista').value = '';
        aplicar(['Se restableció la vista nacional con los valores iniciales.']);
    });
}

function reflejarControles() {
    for (const boton of $('filtroCargo').querySelectorAll('button[data-cargo]')) boton.setAttribute('aria-pressed', String(boton.dataset.cargo === estado.cargo));
    $('filtroDepartamento').value = estado.departamento === null ? '' : String(estado.departamento);
    // Municipio: los del filtro, por departamento si no hay uno elegido.
    const sMun = $('filtroMunicipio');
    const opciones = [new Option(`Todos (${fmt.format(info.municipios.length)})`, '')];
    if (estado.departamento === null) {
        const porDep = new Map();
        for (const m of info.municipios) porDep.set(m.departamento, [...(porDep.get(m.departamento) ?? []), m]);
        for (const lista of porDep.values()) {
            const grupo = el('optgroup');
            grupo.label = lista[0].departamento_nombre;
            grupo.append(...ordenarPorNombre(lista).map((m) => new Option(m.nombre, m.clave)));
            opciones.push(grupo);
        }
    } else {
        opciones.push(...ordenarPorNombre(info.municipios).map((m) => new Option(m.nombre, m.clave)));
    }
    sMun.replaceChildren(...opciones);
    sMun.disabled = !info.municipios.length;
    sMun.value = estado.municipio ?? '';
    reflejarListas();
    $('filtroIndicador').value = estado.indicador;
}

// Las opciones de listas se arman de nuevo solo al cambiar el cargo o el departamento (así no se pierde el foco).
function reflejarListas() {
    const clave = `${estado.cargo}|${estado.departamento}`;
    if (clave !== claveListas) {
        claveListas = clave;
        const opciones = L.opcionesListas(modelo, estado.cargo, estado.departamento);
        $('leyendaListas').textContent = estado.cargo === 'junta' ? 'Listas con más bancas en al menos un municipio (Junta Municipal)'
            : 'Listas más votadas según el TREP en al menos un municipio (Intendencia)';
        $('opcionesListas').replaceChildren(...opciones.map((o) => {
            const etiqueta = el('label', 'finanzas__opcion-lista');
            const caja = el('input');
            caja.type = 'checkbox';
            caja.value = o.id;
            const cuenta = `${cantidad(o.pais, 'municipio', 'municipios')}${o.paisEmpates ? `, ${fmt.format(o.paisEmpates)} con empate` : ''}` +
                (estado.departamento !== null ? ` · ${fmt.format(o.departamento)} en el departamento` : '');
            etiqueta.append(caja, el('span', 'finanzas__opcion-texto', o.rotulo), el('span', 'finanzas__opcion-cuenta', cuenta));
            etiqueta.dataset.busqueda = L.sinTildes(o.rotulo);
            return etiqueta;
        }));
        filtrarOpcionesListas();
    }
    const elegidas = new Set(estado.listas);
    for (const caja of $('opcionesListas').querySelectorAll('input[type="checkbox"]')) caja.checked = elegidas.has(caja.value);
    $('resumenListas').textContent = estado.listas.length ? `Listas (${L.ROTULO_CARGO[estado.cargo]}): ${estado.listas.map(siglaDe(estado.cargo)).join(', ')}` : 'Listas: todas';
}

function filtrarOpcionesListas() {
    const q = L.sinTildes($('buscarLista').value.trim());
    for (const etiqueta of $('opcionesListas').children) etiqueta.hidden = Boolean(q) && !etiqueta.dataset.busqueda.includes(q);
}

function elegirMunicipio(clave) {
    estado = { ...estado, municipio: clave };
    tabla.pagina = 0;
    aplicar();
}

// --- Mapa ---------------------------------------------------------------------------------------------------------------
async function iniciarMapa() {
    const caja = $('mapaFinanzas');
    try {
        const { id, anio } = modelo.electoral.eleccion;
        const [indice, distritos, departamentos] = await Promise.all([indiceNacional(id, anio), geoNacional(id, anio, 'distritos'), geoNacional(id, anio, 'departamentos')]);
        cajasDep = new Map(indice.departamentos.map((d) => [d.codigo, d.caja]));
        const pais = indice.departamentos.reduce((c, d) => [Math.min(c[0], d.caja[0]), Math.min(c[1], d.caja[1]), Math.max(c[2], d.caja[2]), Math.max(c[3], d.caja[3])],
            [Infinity, Infinity, -Infinity, -Infinity]);
        const pie = el('p', 'mapa__atribucion');
        caja.append(pie);
        const api = crearMapaPais({ distritos, departamentos },
            { distritos: indice.distritos.map((d) => ({ clave: d.clave, nombre: d.nombre, centro: d.centro })), departamentos: indice.departamentos }, caja,
            { etiqueta: 'Mapa de Paraguay por municipio: finanzas municipales del ejercicio 2025', atribucion: pie, pais, estadosExtra: true,
              texto: (clave) => L.textoMunicipio(modelo, estado, info, clave), alTocar: tocar, alCambiarTema: () => { pintarMapa(); dibujarLeyenda(); },
              leyendas: () => [document.querySelector('.finanzas__leyenda-caja')] });
        pie.replaceChildren(enlaceOsm(), ' (ODbL) · Protomaps · Límites: INE (CNPV 2022) · Finanzas: MEF, Informe Financiero 2025 · Contexto electoral: TREP');
        pie.title = 'Mapa base: rutas, ríos y arroyos de OpenStreetMap (ODbL), del build de Protomaps. Límites referenciales de los distritos y los ' +
            'departamentos: INE, Cartografía digital del CNPV 2022, simplificados. Finanzas: Ministerio de Economía y Finanzas (MEF), Informe ' +
            'Financiero Ejercicio 2025. Contexto electoral: resultados preliminares del TREP (Justicia Electoral).';
        mapa = api;
        pintarMapa();
        await api.listo;
    } catch (error) {
        mapa = null;
        caja.append(el('p', 'mapa__sin-mapa', 'No se pudo mostrar el mapa en este navegador (necesita WebGL). La tabla y la ficha siguen disponibles.'));
        console.warn(error);
    }
}

function pintarMapa() {
    if (!mapa) return;
    mapa.pintar(modelo.municipios.map((m) => m.clave), L.pintura(modelo, estado, info.claves, oscuro()));
    mapa.elegir(estado.municipio);
    if (estado.departamento !== encuadre) {
        const animar = encuadre !== undefined;
        encuadre = estado.departamento;
        mapa.encuadrar(encuadre === null ? null : cajasDep.get(encuadre) ?? null, { animar });
    }
}

// Un toque elige el municipio si está en el filtro; si no, solo muestra su dato.
function tocar(clave) {
    if (info.claves.has(clave)) {
        elegirMunicipio(clave);
        return;
    }
    $('datoFinanzas').textContent = `${L.textoMunicipio(modelo, estado, info, clave).replace(/\n/g, ' · ')}. Para elegirlo, ampliá el filtro.`;
}

function muestra(item) {
    const nodo = el('span', `leyenda__muestra finanzas__muestra finanzas__muestra--${item.tipo}`);
    if (item.color) nodo.style.background = item.color;
    return nodo;
}

function dibujarLeyenda() {
    const l = L.leyenda(modelo, estado, info, oscuro());
    $('tituloLeyenda').textContent = l.titulo;
    $('leyendaFinanzas').replaceChildren(...l.items.map((item) => {
        const li = el('li', `finanzas__leyenda-item finanzas__leyenda-item--${item.tipo}`);
        li.append(muestra(item), el('span', null, item.texto), el('span', 'finanzas__leyenda-n', `(${fmt.format(item.n)})`));
        return li;
    }));
    $('notaLeyenda').textContent = l.nota;
}

function dibujarDato() {
    const nodo = $('datoFinanzas');
    const acciones = $('accionesMunicipio');
    if (estado.municipio === null) {
        nodo.textContent = matchMedia('(hover: hover)').matches ? 'Pasá el puntero por un municipio para ver su dato; tocalo para elegirlo.'
            : 'Tocá un municipio para elegirlo y ver su dato.';
        acciones.hidden = true;
        return;
    }
    nodo.textContent = L.textoMunicipio(modelo, estado, info, estado.municipio).replace(/\n/g, ' · ');
    acciones.hidden = false;
}

// --- Indicador, ámbito y cobertura --------------------------------------------------------------------------------------
function dibujarIndicador() {
    const m = modelo.porCampo.get(estado.indicador);
    const caja = $('fichaIndicador');
    const dl = el('dl', 'finanzas__indicador-datos');
    const fila = (dt, dd) => dl.append(el('dt', null, dt), el('dd', null, dd));
    fila('Unidad', { PYG: 'Guaraníes nominales (Gs.)', '%': 'Porcentaje (puntos porcentuales)', veces: 'Veces (razón)' }[m.unidad] ?? m.unidad);
    fila('Definición', m.definicion ?? 'El diccionario no trae una definición para este indicador.');
    fila('Justificación', m.justificacion ?? 'El diccionario no trae una justificación para este indicador.');
    fila('Límites', m.limitacion ?? 'El diccionario no trae límites para este indicador.');
    const total = modelo.datos.manifiesto.cobertura;
    fila('Cobertura', `Con dato en ${fmt.format(m.cobertura)} de ${fmt.format(total.informantes)} municipios con informe; ${fmt.format(total.informantes - m.cobertura)} ` +
        `sin el dato (tramados en el mapa, con su motivo) y ${fmt.format(total.sin_informe)} sin informe (en gris).`);
    if (m.ampliacion) {
        const amp = modelo.ampliacion;
        const o = m.origen ?? {};
        fila('Origen', o.hoja ? `Hoja ${o.hoja} del paquete del MEF, columna «${o.encabezado}» (${o.campo}); tomo ${o.tomo}.`
            : `Renglones ya extraídos del tomo ${o.tomo} (ejecucion_detalle): ${o.tipo}, nivel ${o.nivel}, ${o.codigo ? `código ${o.codigo}` : `subgrupos ${o.subgrupos.join(' y ')}`}, ` +
              `columna presupuesto vigente${o.denominador ? `; denominador: ${o.denominador}` : ''}.`);
        fila('Etapa', amp.etapa.texto);
        if (m.campo === 'presupuesto_servicios_personales_gs') {
            fila('Criterio de salarios', `El ${amp.criterios.salarios.decision}. El objeto 111 (Sueldos) va aparte, en la tabla y la ficha.`);
        }
        if (m.campo === 'transferencias_intergubernamentales_sobre_presupuesto_pct') {
            const c = amp.criterios.transferencias;
            fila('Emisores', `${c.regla} ${c.nivel} ${c.excluidos}`);
            fila('Denominador', `Presupuesto vigente de ingresos; la tarjeta del Presupuesto Total Anual usa el de gastos. Coinciden en ` +
                `${fmt.format(c.controles.ingresos_igual_a_gastos)} de ${fmt.format(total.informantes)} municipios con informe: no hay diferencia que exponer.`);
        }
    }
    caja.replaceChildren(el('p', 'finanzas__indicador-rotulo', m.rotulo), el('h2', 'finanzas__indicador-nombre', m.nombre),
        ...(m.subtitulo ? [el('p', 'finanzas__indicador-subtitulo', m.subtitulo)] : []), dl);
}

function dibujarAmbito() {
    const partes = [];
    if (estado.departamento !== null) partes.push(modelo.departamentos.find((d) => d.codigo === estado.departamento).nombre);
    if (estado.listas.length) partes.push(`${L.ROTULO_CARGO[estado.cargo]}: ${estado.listas.map(siglaDe(estado.cargo)).join(', ')}`);
    const alcance = partes.length ? partes.join(' · ') : 'Todo el país';
    let texto = `Mostrando: ${alcance} — ${cantidad(info.municipios.length, 'municipio', 'municipios')} (${fmt.format(info.informantes)} con informe, ` +
        `${fmt.format(info.sinInforme)} sin informe)`;
    if (estado.listas.length) {
        texto += `; ${fmt.format(info.exclusivas)} con ${estado.listas.length === 1 ? 'la lista' : 'una de las listas'} como única ` +
            `${estado.cargo === 'junta' ? 'con más bancas' : 'más votada'} y ${fmt.format(info.empates)} con empate`;
    }
    if (estado.municipio !== null) texto += `. Municipio elegido: ${modelo.porClave.get(estado.municipio).nombre}`;
    $('ambitoFinanzas').textContent = `${texto}.`;
}

function dibujarCobertura() {
    const c = modelo.datos.manifiesto.cobertura;
    const sinInforme = modelo.municipios.filter((m) => m.estado === 'sin_informe');
    const pendientes = modelo.municipios.filter((m) => m.union?.estado !== 'unida').length;
    const u = c.uniones;
    const metrica = modelo.porCampo.get(estado.indicador);
    const electoral = info.municipios.map((m) => modelo.electoral.distritos[m.clave]?.[estado.cargo]);
    const dl = el('dl', 'finanzas__cobertura-datos');
    const fila = (dt, dd) => dl.append(el('dt', null, dt), el('dd', null, dd));
    fila('Municipios del sitio', `${fmt.format(c.municipios)}: ${fmt.format(c.informantes)} con informe en el corte del MEF y ${fmt.format(c.sin_informe)} sin informe ` +
        `(${sinInforme.map((m) => m.nombre).join(', ')}).`);
    fila('Correspondencia territorial', `${fmt.format(c.municipios - pendientes)} municipios unidos con los distritos del sitio (${fmt.format(u.departamento_y_nombre_exacto_unico)} ` +
        `por departamento y nombre exactos, ${fmt.format(u.nombre_de_la_nota_exacto_unico)} por el nombre de la nota del MEF y ${fmt.format(u.confirmada_por_el_usuario)} ` +
        `confirmados uno a uno); ${fmt.format(pendientes)} pendientes.`);
    fila('Indicador elegido', `${metrica.nombre}: con dato en ${fmt.format(metrica.cobertura)} de ${fmt.format(c.informantes)} municipios con informe.`);
    fila('En el filtro', `${cantidad(info.municipios.length, 'municipio', 'municipios')}: ${fmt.format(info.informantes)} con informe y ${fmt.format(info.sinInforme)} ` +
        `sin informe. ${L.ROTULO_CARGO[estado.cargo]}: ${fmt.format(electoral.filter((x) => x?.empate).length)} con empate, ` +
        `${fmt.format(electoral.filter((x) => x?.parcial).length)} con resultado parcial y ${fmt.format(electoral.filter((x) => !x || x.estado !== 'con_resultado').length)} sin datos electorales.`);
    $('coberturaFinanzas').replaceChildren(dl);
}

// --- Tabla ----------------------------------------------------------------------------------------------------------------
const valorOrden = (vista) => (m, id) => {
    if (id === 'municipio') return m.nombre;
    if (id === 'estado') return m.estado === 'informante' ? 'Con informe' : 'Sin informe';
    return modelo.hojas[vista]?.valor(m.clave, id) ?? null;
};

function columnasVisibles(vista) {
    const todas = modelo.hojas[vista].columnas;
    return estado.columnas === 'todas' ? todas : todas.filter((c) => tabla.elegidas[vista].has(c.campo));
}

function armarTabla() {
    const pestanas = [...document.querySelectorAll('.finanzas__pestanas [role="tab"]')];
    for (const p of pestanas) {
        p.addEventListener('click', () => cambiarVista(p.dataset.vista));
        p.addEventListener('keydown', (evento) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evento.key)) return;
            evento.preventDefault();
            const k = pestanas.indexOf(p);
            const destino = evento.key === 'Home' ? 0 : evento.key === 'End' ? pestanas.length - 1 : (k + (evento.key === 'ArrowRight' ? 1 : pestanas.length - 1)) % pestanas.length;
            pestanas[destino].focus();
            cambiarVista(pestanas[destino].dataset.vista);
        });
    }
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
    $('opcionesColumnas').addEventListener('change', (evento) => {
        const caja = evento.target.closest('input[type="checkbox"]');
        if (!caja) return;
        const vista = estado.vista;
        if (estado.columnas === 'todas') {
            tabla.elegidas[vista] = new Set(modelo.hojas[vista].columnas.map((c) => c.campo));
            estado = { ...estado, columnas: 'resumen' };
        }
        if (caja.checked) tabla.elegidas[vista].add(caja.value);
        else tabla.elegidas[vista].delete(caja.value);
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
    $('quitarSeleccion').addEventListener('click', () => elegirMunicipio(null));
}

function cambiarVista(vista) {
    if (vista === estado.vista) return;
    estado = { ...estado, vista };
    tabla.orden = null;
    tabla.pagina = 0;
    dibujarTabla();
    escribirEnlace();
}

async function dibujarTabla() {
    const turno = ++turnoTabla;
    const vista = estado.vista;
    for (const p of document.querySelectorAll('.finanzas__pestanas [role="tab"]')) {
        const activa = p.dataset.vista === vista;
        p.setAttribute('aria-selected', String(activa));
        p.tabIndex = activa ? 0 : -1;
    }
    $('panelFinanzas').setAttribute('aria-labelledby', vista === 'balance' ? 'pestanaBalance' : 'pestanaPresupuesto');
    $('tomoVista').textContent = vista === 'balance' ? '· Balance: tomo V-A — Municipalidades: Situación Financiera'
        : '· Presupuesto: tomo V-B — Municipalidades: Situación Presupuestaria';
    try {
        await cargarHoja(vista);
    } catch (error) {
        $('notaTabla').textContent = `No se pudo leer la vista ${L.ROTULO_VISTA[vista]}.`;
        console.error(error);
        return;
    }
    if (turno !== turnoTabla) return;
    const hoja = modelo.hojas[vista];
    const visibles = columnasVisibles(vista);
    // Selector de columnas: se arma al cambiar de vista; si no, solo se marcan las casillas (así no se pierde el foco).
    $('todasLasColumnas').checked = estado.columnas === 'todas';
    if (columnasArmadas !== vista) {
        columnasArmadas = vista;
        $('opcionesColumnas').replaceChildren(...hoja.columnas.map((c) => {
            const etiqueta = el('label', 'finanzas__opcion-columna');
            const caja = el('input');
            caja.type = 'checkbox';
            caja.value = c.campo;
            etiqueta.append(caja, ` ${c.nombre} (${L.UNIDAD_CORTA[c.unidad] ?? c.unidad})`);
            return etiqueta;
        }));
    }
    const marcadas = new Set(visibles.map((c) => c.campo));
    for (const caja of $('opcionesColumnas').querySelectorAll('input[type="checkbox"]')) caja.checked = marcadas.has(caja.value);
    const filas = L.filasTabla(modelo, estado, info, { busqueda: tabla.busqueda, orden: tabla.orden, valor: valorOrden(vista) });
    const paginas = Math.max(1, Math.ceil(filas.length / L.POR_PAGINA));
    tabla.pagina = Math.min(Math.max(0, tabla.pagina), paginas - 1);
    const pagina = filas.slice(tabla.pagina * L.POR_PAGINA, (tabla.pagina + 1) * L.POR_PAGINA);
    const t = $('tablaFinanzas');
    if (!t.tHead) t.createTHead();
    if (!t.tBodies.length) t.createTBody();
    if (!t.caption) t.createCaption();
    t.caption.textContent = `${L.ROTULO_VISTA[vista]} 2025 por municipio (tomo ${L.TOMO_VISTA[vista]} del Informe Financiero del MEF)`;
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
    cabeza.append(encabezado('municipio', 'Municipio', 'tabla__texto'), encabezado('estado', 'Informe', 'tabla__texto'),
        ...visibles.map((c) => {
            const th = encabezado(c.campo, `${c.nombre} (${L.UNIDAD_CORTA[c.unidad] ?? c.unidad})`, c.ampliacion ? 'finanzas__col-ampliacion' : null);
            // Las columnas del «Presupuesto anual»: la opción del mapa que muestran y, las nuevas, la marca de ampliación.
            if (c.opcion && c.opcion !== c.nombre) th.append(el('span', 'finanzas__col-opcion', c.opcion));
            if (c.ampliacion) th.append(el('span', 'finanzas__col-marca', 'ampliación 7.1'));
            return th;
        }));
    const fuente = el('th', 'tabla__texto', `Páginas (tomo ${L.TOMO_VISTA[vista]})`);
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
        ficha.setAttribute('aria-label', `Ficha completa de ${m.nombre}`);
        const segunda = el('span', 'finanzas__celda-segunda');
        segunda.append(el('span', 'finanzas__celda-departamento', m.departamento_nombre), ficha);
        th.append(nombre, segunda);
        tr.append(th);
        const informe = el('td', 'tabla__texto', m.estado === 'informante' ? 'Con informe' : 'Sin informe');
        if (m.estado !== 'informante') {
            informe.classList.add('finanzas__sin-informe');
            informe.title = `${L.TEXTO.sinInforme}. ${m.sin_informe?.advertencia ?? ''}`.trim();
        }
        tr.append(informe);
        for (const c of visibles) {
            const v = m.estado === 'informante' ? hoja.valor(m.clave, c.campo) : null;
            const td = el('td', v === null ? 'finanzas__nd' : null, L.numeroCelda(v, c.unidad));
            const est = m.estado === 'informante' ? hoja.estado(m.clave, c.campo) : null;
            const pag = m.estado === 'informante' ? hoja.pagina(m.clave, c.campo) : null;
            td.title = m.estado !== 'informante' ? L.TEXTO.sinInforme
                : [est?.texto, pag ? `tomo ${c.tomo}, pág. ${pag}` : null].filter(Boolean).join(' · ');
            tr.append(td);
        }
        const rango = vista === 'balance' ? m.fuente?.paginas_financieras : m.fuente?.paginas_presupuesto;
        tr.append(el('td', 'tabla__texto', rango ?? L.TEXTO.nd));
        cuerpo.append(tr);
    }
    t.tBodies[0].replaceChildren(cuerpo);
    t.dataset.filas = String(filas.length);
    t.dataset.columnas = String(visibles.length);
    $('paginaActual').textContent = `Página ${tabla.pagina + 1} de ${paginas} · ${cantidad(filas.length, 'municipio', 'municipios')}`;
    $('paginaAnterior').disabled = tabla.pagina === 0;
    $('paginaSiguiente').disabled = tabla.pagina >= paginas - 1;
    $('verTodosMunicipios').hidden = estado.municipio === null;
    $('notaTabla').textContent = `${filas.length ? '' : 'Ningún municipio cumple el filtro y la búsqueda. '}N/D: dato no disponible (sin informe, no expuesto en el ` +
        'informe o celda vacía en la fuente): pasá el puntero por la celda para ver su estado y su página. Un cero publicado se muestra como 0. ' +
        `Columnas a la vista: ${visibles.length} de ${hoja.columnas.length}. Sin totales ni promedios: cada fila es un municipio.`;
}

// El CSV: las filas de la tabla (el filtro, la selección y la búsqueda; todas las páginas) con todas las columnas de la
// vista y los valores exactos; vacío = no disponible.
async function descargarCsv() {
    const vista = estado.vista;
    await cargarHoja(vista);
    const hoja = modelo.hojas[vista];
    const filas = L.filasTabla(modelo, estado, info, { busqueda: tabla.busqueda, orden: tabla.orden, valor: valorOrden(vista) });
    const columnas = [
        { titulo: 'departamento', v: (m) => m.departamento_nombre },
        { titulo: 'municipio', v: (m) => m.nombre },
        { titulo: 'clave_distrito', v: (m) => m.clave },
        { titulo: 'codigo_mef', v: (m) => m.codigo_mef },
        { titulo: 'estado_documental', v: (m) => (m.estado === 'informante' ? 'con_informe' : m.sin_informe?.estado ?? 'sin_informe') },
        ...hoja.columnasHoja.map((c) => ({ titulo: c.campo, v: (m) => (m.estado === 'informante' ? hoja.valor(m.clave, c.campo) : null) })),
        ...(vista === 'presupuesto' && modelo.ampliacion ? [{ titulo: 'motivo_transferencias_intergubernamentales',
            v: (m) => modelo.motivo(m.clave, 'transferencias_intergubernamentales_sobre_presupuesto_pct') }] : []),
        { titulo: `paginas_tomo_${L.TOMO_VISTA[vista]}`, v: (m) => (vista === 'balance' ? m.fuente?.paginas_financieras : m.fuente?.paginas_presupuesto) ?? null },
        { titulo: `contexto_electoral_${estado.cargo}`, v: (m) => L.textoElectoral(modelo, m.clave, estado.cargo) },
        { titulo: 'fuente_oficial', v: () => `${modelo.datos.manifiesto.procedencia.institucion}, ${modelo.datos.manifiesto.procedencia.publicacion}, ` +
            (vista === 'balance' ? 'Tomo V-A — Municipalidades: Situación Financiera' : 'Tomo V-B — Municipalidades: Situación Presupuestaria') },
        { titulo: 'url_fuente_oficial', v: () => modelo.datos.manifiesto.procedencia.url },
    ];
    const ambito = [estado.departamento === null ? null : modelo.departamentos.find((d) => d.codigo === estado.departamento).nombre,
                    estado.municipio === null ? null : modelo.porClave.get(estado.municipio).nombre,
                    estado.listas.length ? `${estado.cargo}-${estado.listas.map(siglaDe(estado.cargo)).join('-')}` : null];
    descargar(new Blob([L.textoCsv(columnas, filas)], { type: 'text/csv;charset=utf-8' }),
        `${nombreArchivo('finanzas-municipales-2025', L.ROTULO_VISTA[vista], ...ambito)}.csv`);
}

// --- Ficha de un municipio ----------------------------------------------------------------------------------------------
function lista(dt, filas) {
    const seccion = el('section', 'finanzas__ficha-seccion');
    seccion.append(el('h3', null, dt));
    const dl = el('dl', 'finanzas__ficha-datos');
    for (const [nombre, valor, detalle] of filas) {
        const dd = el('dd', valor === L.TEXTO.nd ? 'finanzas__nd' : null, valor);
        if (detalle) dd.append(el('span', 'finanzas__ficha-detalle', detalle));
        dl.append(el('dt', null, nombre), dd);
    }
    seccion.append(dl);
    return seccion;
}

// Las cuatro cifras del «Presupuesto anual» (apartado 7.1) y el origen de las nuevas: el renglón del grupo 100, las líneas
// del objeto 111 y los renglones de transferencias con su emisor (de presupuesto_anual_origen.json).
function seccionPresupuestoAnual(m, origen) {
    const amp = modelo.ampliacion;
    const informante = m.estado === 'informante';
    const o = informante ? origen?.municipios?.[m.clave] : null;
    const gs = (v) => L.formato(v, 'PYG');
    const filas = [];
    for (const campo of amp.campos) {
        const metrica = amp.metricas.find((x) => x.campo === campo);
        const columna = amp.columnas.find((x) => x.campo === campo);
        const v = informante ? modelo.valor(m.clave, campo) : null;
        let detalle = v === null && informante ? modelo.motivo(m.clave, campo) : null;
        if (o && campo === 'presupuesto_servicios_personales_gs' && o.grupo_100) detalle = `Grupo 100 del detalle, pág. ${o.grupo_100[0]} del tomo V-B`;
        if (o && campo === 'presupuesto_sueldos_111_gs' && v !== null) {
            detalle = `Objeto 111: ${o.objeto_111.map(([ff, of, dpt, pag, vig]) => `FF ${ff ?? '—'}, OF ${of ?? '—'}, departamento fuente ${dpt ?? '—'}, ` +
                `pág. ${pag}: ${gs(vig)}`).join('; ')}`;
        }
        if (o && campo === 'transferencias_intergubernamentales_sobre_presupuesto_pct' && v !== null) {
            detalle = `${gs(o.numerador)} de ${gs(o.denominador)} (presupuesto vigente de ingresos)`;
        }
        filas.push([metrica ? `${metrica.nombre} (${metrica.subtitulo})` : columna.nombre, informante ? L.formato(v, (metrica ?? columna).unidad) : L.TEXTO.nd, detalle]);
    }
    const seccion = lista('Presupuesto anual (ampliación, apartado 7.1: presupuesto vigente al 31/12/2025)', filas);
    if (o?.transferencias?.length) {
        const emisores = origen.emisores;
        const tabla = lista('Renglones de transferencias del presupuesto vigente (subgrupos 150 y 220)', o.transferencias.map((r) => {
            const fila = Object.fromEntries(origen.renglon.map((k, i) => [k, r[i]]));
            const [descripcion, clase, emisor] = emisores[fila.emisor] ?? ['(sin descripción)', 'sin_clasificar', 'sin emisor'];
            // La descripción tal como la trae el informe (con sus siglas: IVA, INC).
            return [`${fila.codigo}-${fila.detalle ?? ''} ${descripcion}`, gs(fila.vigente),
                    `${clase === 'intergubernamental' ? `Intergubernamental: ${emisor}` : `Sin clasificar: ${emisor}`} · pág. ${fila.pagina}`];
        }));
        seccion.append(...tabla.childNodes);
    }
    return seccion;
}

async function abrirFicha(clave) {
    const m = modelo.porClave.get(clave);
    if (!m) return;
    const dialogo = $('fichaMunicipio');
    $('fichaMunicipioTitulo').textContent = `${m.nombre} · ${m.departamento_nombre}`;
    const cuerpo = $('fichaMunicipioCuerpo');
    cuerpo.replaceChildren(el('p', 'nota', 'Cargando la ficha…'));
    if (!dialogo.open) dialogo.showModal();
    let calidad = null;
    let origen = null;
    try {
        await Promise.all(L.VISTAS.map(cargarHoja));
        [calidad, origen] = await Promise.all([leer('calidad.json'), leer('presupuesto_anual_origen.json')]);
    } catch (error) {
        console.error(error);
    }
    const informante = m.estado === 'informante';
    const resumen = [
        ['Informe', informante ? 'Con informe en el corte del MEF (31/12/2025)' : L.TEXTO.sinInforme, informante ? null : m.sin_informe?.advertencia],
        ['Fuente', L.textoPaginas(m) ?? L.TEXTO.nd],
        ['Código MEF', m.codigo_mef ?? L.TEXTO.nd, m.nombre_mef ? `Nombre en el informe: ${m.nombre_mef}` : null],
        ['Correspondencia', m.union?.estado === 'unida' ? `Unido con el distrito ${m.clave} del sitio (${m.union.regla.replace(/_/g, ' ')})` : L.TEXTO.pendiente],
        ...L.CARGOS.map((cargo) => [L.ROTULO_CARGO[cargo], L.textoElectoral(modelo, clave, cargo).replace(`${L.ROTULO_CARGO[cargo]}: `, '')]),
    ];
    if (m.alertas?.length) resumen.push(['Alertas del paquete', m.alertas.map((a) => a.replace(/_/g, ' ')).join('; ')]);
    const secciones = [lista('Resumen', resumen)];
    if (modelo.ampliacion) secciones.push(seccionPresupuestoAnual(m, origen));
    // Los 27 indicadores del paquete (las cuatro opciones del «Presupuesto anual» van en su sección).
    const indicadores = modelo.metricas.filter((x) => !x.ampliacion);
    secciones.push(lista(`Indicadores calculados (${indicadores.length})`, indicadores.map((x) => {
        const v = informante ? modelo.valor(clave, x.campo) : null;
        return [x.nombre, L.formato(v, x.unidad), v === null && informante ? modelo.motivo(clave, x.campo) : null];
    })));
    for (const vista of L.VISTAS) {
        const hoja = modelo.hojas[vista];
        if (!hoja) continue;
        // Las columnas de la hoja; las de la ampliación ya van en su sección.
        const deLaHoja = hoja.columnasHoja.filter((c) => !c.ampliacion);
        secciones.push(lista(`${L.ROTULO_VISTA[vista]} (tomo ${L.TOMO_VISTA[vista]}, ${deLaHoja.length} columnas)`, deLaHoja.map((c) => {
            const v = informante ? hoja.valor(clave, c.campo) : null;
            const est = informante ? hoja.estado(clave, c.campo) : null;
            const pag = informante ? hoja.pagina(clave, c.campo) : null;
            const detalle = [v === null && est ? est.texto : null, pag ? `pág. ${pag}` : null].filter(Boolean).join(' · ');
            return [c.nombre, L.formato(v, c.unidad), detalle || null];
        })));
    }
    const observaciones = calidad?.observaciones?.[clave] ?? [];
    if (observaciones.length) {
        secciones.push(lista('Observaciones de calidad del paquete', observaciones.map((o) => [o.tipo.replace(/_/g, ' '), o.detalle,
            [o.valor_1, o.valor_2].filter(Boolean).join(' · ') || null])));
    }
    if ($('fichaMunicipioTitulo').textContent === `${m.nombre} · ${m.departamento_nombre}`) cuerpo.replaceChildren(...secciones);
}

// --- Cabecera y método --------------------------------------------------------------------------------------------------
function dibujarCabecera() {
    const man = modelo.datos.manifiesto;
    const ele = modelo.electoral.eleccion;
    $('corteFinanzas').textContent = `Ejercicio ${man.ejercicio}: cifras del Informe Financiero del MEF al cierre del ${fechaLarga(man.corte)}. ` +
        `Contexto electoral: ${ele.nombre}, ${ele.fuente} (corte del ${fechaLarga(ele.corte)}).`;
    $('advertenciaFinanzas').textContent = man.advertencia;
}

function bloque(titulo, filas) {
    const seccion = el('section', 'finanzas__metodo-bloque');
    seccion.append(el('h3', null, titulo));
    const dl = el('dl', 'finanzas__metodo-datos');
    for (const [dt, dd] of filas) dl.append(el('dt', null, dt), typeof dd === 'string' ? el('dd', null, dd) : (() => { const n = el('dd'); n.append(dd); return n; })());
    seccion.append(dl);
    return seccion;
}

function enlaceExterno(href, texto) {
    const a = el('a', null, texto);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
}

function enlaceDatos(nombre, texto) {
    const a = el('a', null, texto);
    a.href = new URL(nombre, CARPETA).href;
    a.download = nombre;
    return a;
}

// Las tres procedencias por separado (el enlace al MEF no le atribuye los resultados electorales, las uniones, los colores
// ni los textos de este sitio), la metodología y las descargas.
function dibujarMetodo() {
    const man = modelo.datos.manifiesto;
    const pr = man.procedencia;
    const ele = modelo.electoral;
    const amp = modelo.ampliacion;
    const atribucion = el('blockquote', 'finanzas__atribucion', pr.atribucion);
    const fechas = `${pr.fechas.nota} Corte financiero: ${fechaLarga(pr.corte)}. Actualización de esta página: ` +
        `${fechaLarga(pr.fechas.actualizacion_de_la_pagina.slice(0, 10))}.`;
    const tomos = el('ul', 'finanzas__tomos');
    for (const x of pr.tomos) {
        const li = el('li');
        li.append(el('strong', null, `Tomo ${x.tomo}`), ` — ${x.archivo} (${fmt.format(x.paginas)} páginas). ${x.uso} `,
            el('span', 'finanzas__huella', `SHA-256: ${x.sha256}`));
        tomos.append(li);
    }
    const pagina = el('span');
    pagina.append(enlaceExterno(pr.url, `${pr.institucion} · ${pr.seccion}`), ` (${pr.naturaleza})`);
    const financiera = bloque('Procedencia financiera (MEF)', [
        ['Institución', pr.institucion],
        ['Publicación', `${pr.publicacion}: ${pr.tomos_municipales.join(' y ')}. El tomo V-A es la referencia del balance y los estados financieros; el ` +
            'V-B, de la ejecución presupuestaria.'],
        ['Ejercicio y corte', `Del ${fechaLarga(pr.periodo.desde)} al ${fechaLarga(pr.periodo.hasta)}; saldos patrimoniales al cierre (${fechaLarga(pr.corte)}).`],
        ['Página oficial', pagina],
        ['Tomos del informe', tomos],
        ['Fechas', fechas],
        ['Alcance', 'El MEF es la fuente de las cifras financieras. La unión con los distritos del sitio, la escala y los colores del mapa, los filtros ' +
            'electorales, las cuatro opciones del «Presupuesto anual» y los textos son de Kalaguichi; usar información publicada no implica patrocinio ' +
            'ni validación del MEF. Esta página usa una copia local de los datos ya procesados: no consulta el portal.'],
    ]);
    const electoral = bloque('Procedencia electoral (TREP)', [
        ['Elección', `${ele.eleccion.nombre}: ${ele.eleccion.fuente}, corte del ${fechaLarga(ele.eleccion.corte)} (la misma elección y el mismo corte que ` +
            'muestra la sección TREP del sitio).'],
        ['Carácter', `${ele.eleccion.caracter} ${ele.eleccion.nota}`],
        ['Criterios', `Intendencia: ${enOracion(ele.criterios.intendencia.rotulo)}. Junta Municipal: ${enOracion(ele.criterios.junta.rotulo)} ` +
            '(definición elegida por el propietario). Los empates se muestran como empates y no se cuentan como victorias exclusivas; un resultado con ' +
            'actas faltantes se marca como parcial.'],
        ['Advertencia', man.advertencia],
    ]);
    const cartografia = bloque('Cartografía', [
        ['Límites', 'Distritos y departamentos del INE (Cartografía digital del CNPV 2022), simplificados: los mismos del mapa del país del sitio.'],
        ['Mapa base', 'Rutas, ríos y arroyos de OpenStreetMap (ODbL), del build de Protomaps, servidos desde este sitio.'],
    ]);
    const salarios = amp.criterios.salarios;
    const transferencias = amp.criterios.transferencias;
    const metodo = bloque('Metodología', [
        ['Indicadores', `Los 27 indicadores vienen calculados en el paquete y se muestran tal cual («${L.TEXTO.calculado}»), con la definición, la ` +
            'justificación y los límites de su diccionario. No son calificaciones oficiales del MEF.'],
        ['Presupuesto anual', `Cuatro opciones primeras en el selector, con el ${amp.etapa.texto.toLowerCase()}: el Presupuesto Total Anual y el de ` +
            'Inversiones Físicas son columnas publicadas («Valor presupuestario publicado»); el de Salarios es el grupo 100 del detalle ya extraído, ' +
            `con el ${salarios.decision}; el % de Transferencias Intergubernamentales se calcula sobre datos publicados. ${transferencias.regla} ` +
            `${transferencias.nivel} ${transferencias.excluidos} Si falta la clasificación: «${transferencias.motivo_si_falta}».`],
        ['Escala del mapa', 'Una clasificación nacional por indicador, fija al filtrar: cuantiles de los municipios con dato (secuencial si no hay ' +
            'negativos; divergente alrededor de cero si hay valores de los dos signos). Sirve solo para dibujar: no cambia el valor, no recorta extremos ' +
            'ni porcentajes mayores que 100 y no califica un valor como bueno o malo. Los colores son financieros, nunca partidarios.'],
        ['Ausencias', `Gris sólido: «${L.TEXTO.sinInforme}» (la ausencia en el informe al elaborarse, no un incumplimiento actual ni una deuda cero). ` +
            'Tramado: el municipio presentó su informe pero el dato no está disponible (el motivo, en el globo y en la ficha). Un cero publicado tiene el ' +
            `color de su clase. Punteado: «${L.TEXTO.pendiente}». Fuera del filtro: solo el borde.`],
        ['Unión territorial', 'Los municipios del MEF se unen a los distritos del sitio con un adaptador aparte: por departamento y nombre exactos, por el ' +
            'nombre de la nota del MEF (los sin informe) y, el resto, confirmados uno a uno. El código del MEF no es el del INE ni el del TSJE.'],
        ['Lo que no hace', 'No suma ingresos con gastos ni ratios, no calcula promedios nacionales ni consolidados oficiales y no atribuye la gestión de ' +
            '2025 a quienes ganaron en 2026. Los conteos son de municipios únicos (un empate o un municipio en varias piezas no se repite).'],
    ]);
    const descargas = el('ul', 'finanzas__descargas');
    for (const [nombre, texto] of [['manifiesto.json', 'Metadatos y procedencia (JSON)'], ['catalogo.json', 'Diccionario de columnas e indicadores (JSON)'],
                                   ['presupuesto_anual.json', 'Presupuesto anual: las cuatro opciones (JSON)'],
                                   ['presupuesto_anual_origen.json', 'Presupuesto anual: renglones de origen (JSON)']]) {
        const li = el('li');
        li.append(enlaceDatos(nombre, texto));
        descargas.append(li);
    }
    const nota = el('p', 'nota', 'El CSV de la tabla («Descargar CSV») trae las filas del filtro con todas las columnas de la vista, los valores exactos ' +
        '(vacío: no disponible) y columnas de fuente (tomo, páginas y página oficial del MEF).');
    const bloqueDescargas = el('section', 'finanzas__metodo-bloque');
    bloqueDescargas.append(el('h3', null, 'Descargas'), descargas, nota);
    $('metodoFinanzas').replaceChildren(atribucion, financiera, electoral, cartografia, metodo, bloqueDescargas);
}

// --- Inicio ---------------------------------------------------------------------------------------------------------------
async function iniciar() {
    const main = $('contenido');
    try {
        const [manifiesto, catalogo, municipios, indicadores, electoral, presupuesto, ampliacion] = await Promise.all(
            ['manifiesto.json', 'catalogo.json', 'municipios.json', 'indicadores.json', 'electoral.json', 'presupuesto.json', 'presupuesto_anual.json'].map(leer));
        modelo = L.crearModelo({ manifiesto, catalogo, municipios, indicadores, electoral, presupuesto, presupuesto_anual: ampliacion });
    } catch (error) {
        const aviso = el('p', 'finanzas__error', 'No fue posible leer los datos financieros. Revisá la conexión o el servidor local.');
        aviso.setAttribute('role', 'alert');
        main.querySelector('.finanzas__cabecera').after(aviso);
        main.dataset.listo = 'error';
        console.error(error);
        return;
    }
    // Las acciones del municipio elegido (debajo del dato del mapa) y la vuelta a todos (sobre la tabla).
    const acciones = el('div', 'finanzas__acciones');
    acciones.id = 'accionesMunicipio';
    const verFicha = el('button', 'boton-secundario', 'Ver la ficha completa');
    verFicha.type = 'button';
    verFicha.id = 'verFichaElegido';
    const quitar = el('button', 'boton-secundario', 'Quitar la selección');
    quitar.type = 'button';
    quitar.id = 'quitarSeleccion';
    acciones.append(verFicha, quitar);
    $('datoFinanzas').after(acciones);
    const todos = el('button', 'boton-secundario', 'Ver todos los municipios del filtro');
    todos.type = 'button';
    todos.id = 'verTodosMunicipios';
    $('panelFinanzas').before(todos);
    const nota = el('p', 'nota finanzas__leyenda-nota');
    nota.id = 'notaLeyenda';
    $('leyendaFinanzas').after(nota);
    $('cerrarFicha').addEventListener('click', () => $('fichaMunicipio').close());

    const procedencia = modelo.datos.manifiesto.procedencia;
    for (const a of document.querySelectorAll('[data-fuente-oficial]')) {
        a.href = procedencia.url;
        a.textContent = procedencia.enlace;
        a.title = `${procedencia.institucion}: ${procedencia.publicacion} (${procedencia.seccion}). Se abre en otra pestaña.`;
    }
    dibujarCabecera();
    dibujarMetodo();
    armarControles();
    armarTabla();
    const { estado: leido, avisos } = L.leerEstado(location.hash.slice(1), modelo);
    estado = leido;
    aplicar(avisos);
    addEventListener('hashchange', () => {
        if (location.hash.slice(1) === L.textoEstado(estado, modelo)) return;
        const r = L.leerEstado(location.hash.slice(1), modelo);
        estado = r.estado;
        aplicar(r.avisos);
    });
    main.dataset.listo = 'true';
    await iniciarMapa();
    main.dataset.mapa = mapa ? 'listo' : 'sin-mapa';
}

iniciar();
