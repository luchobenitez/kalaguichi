// Vista informe del TREP (#modo=informe): la página vertical anterior al tablero, con sus pestañas de mapas y tablas,
// el histograma del margen e «Intendente vs Junta». Todo número sale de /datos/<eleccion>/<anio>/ (mismo origen),
// según el manifiesto /datos/elecciones.json (assets/js/datos.js, ADR 0009 del módulo). El modelo, los mapas y el
// panel de resultados son los del tablero (modelo.js, mapa.js y panel.js).
// Sin dependencias ni HTML desde datos: el texto se asigna con textContent y los estilos por CSSOM.
// La sección «Intendente vs Junta» vive en su propio módulo y carga Chart.js solo al abrirse.
import { crearIntendenteJunta } from '../analisis/intendente_junta.js';
import { crearFicha } from './ficha.js';
import { vigilarDesplazables } from '../desplazables.js';
import { estado as compartido, listo as shellListo } from '../shell.js';
import { salirDePantallaCompleta } from './zoom_mapa.js';
import { $, el, svg, titulo, cantidad, celdaNombre, fmt, pct, pct2, movimiento } from './util.js';
import { MARGEN, formaDe, cargarModelo, ganador, participacion, margenDe, agregadosBarrio as agregadosDe, unidades as unidadesDe,
         textoBarrio as textoDeBarrio } from './modelo.js';
import { COLORES_ZONA, PARTICIPACION_COLOR, IPM_COLOR, simbolo, crearMapaBase as mapaBase, crearMapaConMesas as mapaConMesas,
         encuadre as encuadreDe, mezclar, escala, cuantiles, opacidadPaso, pintarBarrio as pintar, itemLeyenda } from './mapa.js';
import { renderTotales as totalesDe, renderBancas as bancasDe, renderFuentes, renderNoDisponible } from './panel.js';

// Celular y tablet (y un mapa en pantalla completa): tocar un local o un barrio abre la ficha inferior en lugar de
// desplazar la página hasta el panel de resultados. En escritorio se conserva el desplazamiento.
const PANTALLA_ANGOSTA = matchMedia('(max-width: 899px)');
// Celular: las tarjetas «No disponible» y «Fuentes y método» empiezan plegadas (en escritorio siguen abiertas).
const PANTALLA_CHICA = matchMedia('(max-width: 640px)');
const usarFicha = () => PANTALLA_ANGOSTA.matches || Boolean(document.querySelector('.mapa--pantalla'));
let ficha;

const VISTAS = ['mapa', 'barrios', 'listas', 'participacion', 'ipm', 'margen', 'tablas'];
const estado = { cargo: '1', zona: null, zonaMunicipal: null, local: null, barrio: null, vista: 'mapa', colorMapa: 'lista',
                 lista: { 1: null, 2: null }, medida: 'pct', ipm: 'H', tabla: 'local', unidad: 'mesa', binHistograma: null,
                 orden: null, filtro: '' };
let datos;

const sumar = (indices, cargo) => datos.sumar(indices, cargo);
const margen = (total) => margenDe(datos, total, estado.cargo);

function mesasDe(filtro) {
    return datos.filas.filter(filtro).map((f) => f.i);
}

// Filtro de zona activo: electoral (TSJE, de las actas) o municipal (oficial, por la ubicación del local).
function enZona(f) {
    return (estado.zona === null || f.zona === estado.zona) && (estado.zonaMunicipal === null || f.zonaMunicipal === estado.zonaMunicipal);
}

function seleccionActual() {
    if (estado.local) {
        const info = datos.infoLocal.get(estado.local);
        return { titulo: info.nombre, eyebrow: `Local · zona ${info.zona_nombre}`, indices: mesasDe((f) => f.clave === estado.local),
                 meta: [info.direccion, info.barrio ? `barrio ${info.barrio}` : null].filter(Boolean).join(' · ') };
    }
    if (estado.barrio) {
        const b = datos.barrioPor.get(estado.barrio);
        const locales = [...datos.infoLocal.values()].filter((x) => x.barrio === estado.barrio).length;
        return { titulo: estado.barrio, eyebrow: 'Barrio (ubicación de los locales)', indices: mesasDe((f) => f.barrio === estado.barrio),
                 meta: [`${fmt.format(locales)} locales`, b?.poblacion_2022 ? `población 2022: ${fmt.format(b.poblacion_2022)}` : null].filter(Boolean).join(' · ') };
    }
    if (estado.zonaMunicipal !== null) {
        const locales = [...datos.infoLocal.values()].filter((x) => x.zona_municipal === estado.zonaMunicipal).length;
        return { titulo: datos.resumen.zonas_municipales[estado.zonaMunicipal], eyebrow: `Zona municipal ${estado.zonaMunicipal} (oficial)`,
                 indices: mesasDe((f) => f.zonaMunicipal === estado.zonaMunicipal),
                 meta: `${fmt.format(locales)} locales ubicados en la zona` };
    }
    if (estado.zona !== null) {
        return { titulo: datos.resumen.zonas[estado.zona], eyebrow: `Zona TSJE ${estado.zona}`, indices: mesasDe((f) => f.zona === estado.zona), meta: '' };
    }
    return { titulo: 'Asunción', eyebrow: 'Resultado', indices: datos.filas.map((f) => f.i), meta: '' };
}

function colorDe(j, cargo = estado.cargo) {
    return datos.listas[cargo][j].color;
}
function renderTotales() {
    totalesDe(datos, estado.cargo, seleccionActual(),
              { hayFiltro: Boolean(estado.local || estado.barrio) || estado.zona !== null || estado.zonaMunicipal !== null });
}

const renderBancas = () => bancasDe(datos, estado.cargo);

// --- Mapas --------------------------------------------------------------------------------------
const crearMapaBase = (id, etiqueta) => mapaBase(datos, id, etiqueta);
const crearMapaConMesas = (id, etiqueta, alElegir) => mapaConMesas(datos, id, etiqueta, alElegir);

function crearMapaMesas() {
    datos.mapas.mesas = crearMapaConMesas('mapa', 'Mapa de Asunción con las zonas municipales y un punto por mesa alrededor de cada local de votación',
        seleccionarLocal);
    datos.puntos = datos.mapas.mesas.puntos;
}
const encuadre = () => encuadreDe(datos, estado);

function renderMapaMesas() {
    const c = datos.mesas.cargos[estado.cargo];
    const leyenda = $('leyenda');
    leyenda.replaceChildren();
    const conteo = new Map();
    const visibleEn = (nodo) => (estado.zona === null || Number(nodo.dataset.zona) === estado.zona) &&
        (estado.zonaMunicipal === null || nodo.dataset.zm === String(estado.zonaMunicipal));
    const porZona = new Map();
    // Los puntos siempre llevan el color de la lista más votada de su mesa, también en el modo Zona TSJE.
    for (const punto of datos.puntos) {
        const i = Number(punto.dataset.i);
        const j = ganador(c.votos[i]);
        const clave = j === null ? 'empate' : `lista-${j}`;
        const visible = visibleEn(punto);
        punto.setAttribute('fill', j === null ? '#9ca3af' : colorDe(j));
        datos.mapas.mesas.formaPunto(punto, j === null ? 'circulo' : formaDe(datos.listas[estado.cargo][j]));
        punto.classList.toggle('es-seleccion', punto.dataset.local === estado.local);
        punto.classList.toggle('es-atenuado', !visible);
        if (visible) {
            conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
            const z = porZona.get(punto.dataset.zona) ?? { mesas: 0, locales: new Set() };
            z.mesas += 1;
            z.locales.add(punto.dataset.local);
            porZona.set(punto.dataset.zona, z);
        }
    }
    const lienzo = datos.mapas.mesas.lienzo;
    lienzo.classList.toggle('es-modo-zona', estado.colorMapa === 'zona');
    for (const halo of lienzo.querySelectorAll('.mapa__halo')) halo.classList.toggle('es-atenuado', !visibleEn(halo));
    for (const nodo of datos.mapas.mesas.lienzo.querySelectorAll('[data-zona-municipal]')) {
        nodo.classList.toggle('es-seleccion', Number(nodo.dataset.zonaMunicipal) === estado.zonaMunicipal);
        nodo.classList.toggle('es-atenuado', estado.zonaMunicipal !== null && Number(nodo.dataset.zonaMunicipal) !== estado.zonaMunicipal);
    }
    datos.mapas.mesas.fijarMarco(encuadre());
    datos.listas[estado.cargo].forEach((item, j) => {
        if (conteo.get(`lista-${j}`)) leyenda.append(itemLeyenda(item.color, `${item.sigla}: ${fmt.format(conteo.get(`lista-${j}`))} mesas`, null, formaDe(item)));
    });
    if (conteo.get('empate')) leyenda.append(itemLeyenda(null, `Empate: ${fmt.format(conteo.get('empate'))} mesas`, 'leyenda__muestra--empate'));
    if (estado.colorMapa === 'zona') {
        for (const [codigo, nombre] of Object.entries(datos.resumen.zonas)) {
            const z = porZona.get(codigo);
            if (!z) continue;
            const li = itemLeyenda(null, `Zona TSJE ${codigo} · ${nombre}: ${cantidad(z.locales.size, 'local', 'locales')}, ${cantidad(z.mesas, 'mesa', 'mesas')}`,
                'leyenda__muestra--halo');
            li.firstChild.style.borderColor = COLORES_ZONA[codigo];
            leyenda.append(li);
        }
    }
    leyenda.append(itemLeyenda(null, 'Contorno: zonas municipales oficiales', 'leyenda__muestra--zona'));
    $('notaMapa').textContent = 'Cada punto es una mesa, con el color y la forma de la lista más votada (ver la leyenda), dibujada alrededor de su local de votación: los puntos ' +
        'se separan para que se vean y no indican una ubicación propia. ' +
        (estado.colorMapa === 'zona' ? 'El halo de cada local indica su zona electoral del TSJE. ' : '') +
        'Los contornos rotulados son las 6 zonas municipales oficiales (Municipalidad de Asunción), que no coinciden con las 6 zonas ' +
        'electorales del TSJE de las actas: por ejemplo, Zeballos Cué (TSJE) queda dentro de Santísima Trinidad (municipal). Tocá un local para ver sus cifras.';
}
const agregadosBarrio = () => agregadosDe(datos, estado.cargo);

function prepararMapaBarrios(clave, id, etiqueta) {
    if (datos.mapas[clave]) return datos.mapas[clave];
    const mapa = crearMapaBase(id, etiqueta);
    mapa.lienzo.addEventListener('click', (evento) => {
        const barrio = evento.target.closest('[data-barrio]')?.dataset.barrio;
        if (barrio && datos.agregados?.has(barrio)) seleccionarBarrio(barrio, mapa.lienzo);
    });
    datos.mapas[clave] = mapa;
    return mapa;
}
const pintarBarrio = (path, nombre, color, opacidad, texto) => pintar(path, color, opacidad, texto, nombre === estado.barrio);
const textoBarrio = (nombre, total) => textoDeBarrio(datos, nombre, total, estado.cargo);

function renderMapaBarrios() {
    const mapa = prepararMapaBarrios('barrios', 'mapaBarrios', 'Barrios de Asunción coloreados por la lista más votada en sus locales');
    const conteo = new Map();
    for (const [nombre, path] of mapa.barrios) {
        const total = datos.agregados.get(nombre);
        if (!total) { pintarBarrio(path, nombre, null, 0, textoBarrio(nombre, null)); continue; }
        const j = ganador(total.votos);
        const orden = [...total.votos].sort((a, b) => b - a);
        const ventaja = total.listas ? (100 * (orden[0] - (orden[1] ?? 0))) / total.listas : 0;
        pintarBarrio(path, nombre, j === null ? '#9ca3af' : colorDe(j), 0.35 + 0.6 * Math.min(1, ventaja / 40), textoBarrio(nombre, total));
        const clave = j === null ? 'empate' : j;
        conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
    }
    const leyenda = $('leyendaBarrios');
    leyenda.replaceChildren();
    datos.listas[estado.cargo].forEach((item, j) => {
        if (conteo.get(j)) leyenda.append(itemLeyenda(item.color, `${item.sigla}: ${cantidad(conteo.get(j), 'barrio', 'barrios')}`, null, formaDe(item)));
    });
    if (conteo.get('empate')) leyenda.append(itemLeyenda(null, `Empate: ${cantidad(conteo.get('empate'), 'barrio', 'barrios')}`, 'leyenda__muestra--empate'));
    leyenda.append(itemLeyenda(null, `Sin locales de votación: ${cantidad(mapa.barrios.size - datos.agregados.size, 'barrio', 'barrios')}`, 'leyenda__muestra--vacio'));
    $('notaBarrios').textContent = 'Color: lista más votada en los locales de cada barrio; más intenso cuanto mayor la ventaja sobre la segunda. ' +
        'El barrio es la ubicación del local, no la residencia de sus electores. Tocá un barrio para ver sus cifras. Barrios: INE, CNPV 2022.';
}

function renderMapaListas() {
    const mapa = prepararMapaBarrios('listas', 'mapaListas', 'Barrios de Asunción coloreados por el porcentaje de la lista elegida');
    const listas = datos.listas[estado.cargo];
    if (estado.lista[estado.cargo] === null || estado.lista[estado.cargo] >= listas.length) {
        const total = sumar(datos.filas.map((f) => f.i), estado.cargo);
        estado.lista[estado.cargo] = ganador(total.votos) ?? 0;
    }
    const j = estado.lista[estado.cargo];
    const selector = $('selectorLista');
    if (selector.dataset.cargo !== estado.cargo) {
        selector.replaceChildren();
        listas.forEach((item, k) => {
            const boton = el('button', null, item.sigla);
            boton.type = 'button';
            boton.dataset.lista = String(k);
            selector.append(boton);
        });
        selector.dataset.cargo = estado.cargo;
    }
    for (const boton of selector.querySelectorAll('button')) boton.setAttribute('aria-pressed', String(Number(boton.dataset.lista) === j));
    for (const boton of document.querySelectorAll('[data-medida]')) boton.setAttribute('aria-pressed', String(boton.dataset.medida === estado.medida));
    const enPct = estado.medida === 'pct';
    const medir = (t) => (enPct ? (100 * t.votos[j]) / t.listas : t.votos[j]);
    const rotular = (v) => (enPct ? `${pct.format(v)} %` : `${fmt.format(Math.round(v))} votos`);
    const valores = [...datos.agregados.values()].filter((t) => t.listas).map(medir);
    const { cortes, clase } = escala(valores);
    for (const [nombre, path] of mapa.barrios) {
        const total = datos.agregados.get(nombre);
        if (!total || !total.listas) { pintarBarrio(path, nombre, null, 0, textoBarrio(nombre, null)); continue; }
        pintarBarrio(path, nombre, listas[j].color, opacidadPaso(clase(medir(total))),
            `${nombre}: ${listas[j].sigla} ${fmt.format(total.votos[j])} votos (${pct.format((100 * total.votos[j]) / total.listas)} % de los votos a listas)`);
    }
    const leyenda = $('leyendaListas');
    leyenda.replaceChildren();
    for (let k = 0; k < cortes.length - 1; k++) {
        leyenda.append(itemLeyenda(mezclar(listas[j].color, opacidadPaso(k)), `${rotular(cortes[k])} a ${rotular(cortes[k + 1])}`));
    }
    $('notaListas').textContent = (enPct
        ? `Porcentaje de ${listas[j].sigla} (${listas[j].lista}) sobre los votos a listas de los locales de cada barrio`
        : `Votos de ${listas[j].sigla} (${listas[j].lista}) en los locales de cada barrio; depende de cuántas mesas hay en el barrio`) +
        ', en 5 tramos iguales entre el mínimo y el máximo. Elegí otra lista o medida con los botones. El barrio es la ubicación del local.';
}

function renderMapaParticipacion() {
    const mapa = prepararMapaBarrios('participacion', 'mapaParticipacion', 'Barrios de Asunción coloreados por la participación');
    const valores = [...datos.agregados.values()].filter((t) => t.electores).map((t) => participacion(t));
    const { cortes, clase } = escala(valores);
    for (const [nombre, path] of mapa.barrios) {
        const total = datos.agregados.get(nombre);
        if (!total || !total.electores) { pintarBarrio(path, nombre, null, 0, textoBarrio(nombre, null)); continue; }
        const v = participacion(total);
        pintarBarrio(path, nombre, PARTICIPACION_COLOR, opacidadPaso(clase(v)),
            `${nombre}: participación ${pct.format(v)} % (${fmt.format(total.emitidos)} de ${fmt.format(total.electores)} electores)`);
    }
    const leyenda = $('leyendaParticipacion');
    leyenda.replaceChildren();
    for (let k = 0; k < cortes.length - 1; k++) {
        leyenda.append(itemLeyenda(mezclar(PARTICIPACION_COLOR, opacidadPaso(k)), `${pct.format(cortes[k])} a ${pct.format(cortes[k + 1])} %`));
    }
    const r = datos.resumen.electores;
    $('notaParticipacion').textContent = `Votos emitidos sobre electores habilitados de las mesas con acta, por barrio de los locales. ` +
        `Electores: recuento agregado del padrón por mesa (${fmt.format(r.en_mesas_con_acta)} en las mesas con acta, ${fmt.format(r.padron_total)} en total). ` +
        `${fmt.format(r.mesas_con_mas_emitidos_que_electores)} mesas tienen más votos que electores: se muestran tal cual, sin interpretarlas.`;
}

// Locales de votación encima del mapa del IPM: color de la lista más votada, tamaño según electores.
function prepararLocalesIpm(mapa) {
    if (mapa.locales) return;
    const porLocal = new Map();
    for (const f of datos.filas) {
        if (!porLocal.has(f.clave)) porLocal.set(f.clave, []);
        porLocal.get(f.clave).push(f.i);
    }
    // Los locales grandes van primero para que los chicos queden visibles encima.
    const ordenados = [...porLocal].map(([clave, indices]) => ({ clave, indices, info: datos.infoLocal.get(clave) }))
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
    mapa.lienzo.append(capa);
    mapa.lienzo.addEventListener('zoommapa', (evento) => {
        mapa.raizZoom = Math.sqrt(evento.detail.factor);
        for (const l of mapa.locales) mapa.dibujarLocal(l);
    });
    mapa.lienzo.addEventListener('click', (evento) => {
        const local = evento.target.closest('[data-local]')?.dataset.local;
        if (local) seleccionarLocal(local, mapa.lienzo);
    });
}

function renderMapaIpm() {
    const mapa = prepararMapaBarrios('ipm', 'mapaIpm', 'Barrios de Asunción coloreados por un componente del IPM, con los locales de votación encima');
    prepararLocalesIpm(mapa);
    for (const boton of document.querySelectorAll('[data-ipm]')) boton.setAttribute('aria-pressed', String(boton.dataset.ipm === estado.ipm));
    const ind = datos.ipm.indicadores.find((x) => x.id === estado.ipm);
    const formato = estado.ipm === 'A' ? pct : pct2;
    // Sin dato publicado, o intensidad sin personas pobres (H = 0): no se colorea.
    const valorDe = (b) => (!b || b[estado.ipm] === null || (estado.ipm === 'A' && b.H === 0) ? null : b[estado.ipm]);
    const motivo = (b) => (!b ? 'sin dato' : b.nota ?? 'sin dato');
    const valores = datos.geo.barrios.map((b) => valorDe(datos.ipmPor.get(b.clave))).filter((v) => v !== null);
    const { cortes, clase } = cuantiles(valores);
    const conteo = new Array(5).fill(0);
    for (const [nombre, path] of mapa.barrios) {
        const b = datos.ipmPor.get(path.dataset.clave);
        const v = valorDe(b);
        if (v === null) {
            pintarBarrio(path, nombre, null, 0, `${nombre}: ${motivo(b)}`);
            continue;
        }
        const k = clase(v);
        conteo[k] += 1;
        pintarBarrio(path, nombre, IPM_COLOR, opacidadPaso(k), `${nombre}: ${ind.nombre} ${formato.format(v)} %`);
    }
    const leyenda = $('leyendaIpm');
    leyenda.replaceChildren();
    for (let k = 0; k < 5; k++) {
        leyenda.append(itemLeyenda(mezclar(IPM_COLOR, opacidadPaso(k)),
            `${formato.format(cortes[k])} a ${formato.format(cortes[k + 1])} % · ${cantidad(conteo[k], 'barrio', 'barrios')}`));
    }
    const sinColor = mapa.barrios.size - conteo.reduce((a, b) => a + b, 0);
    if (sinColor) leyenda.append(itemLeyenda(null, `Sin dato o no aplica: ${cantidad(sinColor, 'barrio', 'barrios')}`, 'leyenda__muestra--vacio'));
    const ganados = new Map();
    for (const l of mapa.locales) {
        const total = sumar(l.indices, estado.cargo);
        const j = ganador(total.votos);
        l.nodo.setAttribute('fill', j === null ? '#9ca3af' : colorDe(j));
        const forma = j === null ? 'circulo' : formaDe(datos.listas[estado.cargo][j]);
        if (forma !== l.forma) {
            l.forma = forma;
            mapa.dibujarLocal(l);
        }
        l.nodo.classList.toggle('es-seleccion', l.clave === estado.local);
        ganados.set(j ?? 'empate', (ganados.get(j ?? 'empate') ?? 0) + 1);
        const delBarrio = datos.ipmPor.get(datos.barrioPor.get(l.info.barrio)?.clave);
        const vb = valorDe(delBarrio);
        const lider = j === null ? 'empate' : `${datos.listas[estado.cargo][j].sigla} ${pct.format((100 * total.votos[j]) / total.listas)} %`;
        l.nodo.replaceChildren();
        titulo(l.nodo, `${l.info.nombre} · ${lider} · ${fmt.format(l.info.electores)} electores · barrio ${l.info.barrio}: ` +
            `${ind.nombre} ${vb === null ? motivo(delBarrio) : `${formato.format(vb)} %`}`);
    }
    const leyendaLocales = $('leyendaIpmLocales');
    leyendaLocales.replaceChildren();
    datos.listas[estado.cargo].forEach((item, j) => {
        if (ganados.get(j)) leyendaLocales.append(itemLeyenda(item.color, `Locales con ${item.sigla} más votada: ${fmt.format(ganados.get(j))}`, 'leyenda__muestra--local', formaDe(item)));
    });
    if (ganados.get('empate')) leyendaLocales.append(itemLeyenda(null, `Locales con empate: ${fmt.format(ganados.get('empate'))}`, 'leyenda__muestra--empate'));
    $('notaIpm').textContent = `${ind.nombre}: ${ind.descripcion} Barrios en quintiles, cinco grupos con casi la misma cantidad de barrios ` +
        `(INE, Censo 2022). Símbolos: los ${fmt.format(mapa.locales.length)} locales de votación, con el color y la forma de la lista más votada en ` +
        `${estado.cargo === '1' ? 'Intendencia' : 'Junta Municipal'} y tamaño según sus electores. Es una comparación entre agregados: no muestra ` +
        'cómo votaron las personas en situación de pobreza ni ningún otro grupo, y el barrio del local no es necesariamente el de residencia de sus electores.';
}
// Unidades para histograma y tabla, con el filtro de zona del visor.
const unidades = (tipo) => unidadesDe(datos, tipo, estado.cargo, enZona);

const NOMBRES_UNIDAD = { mesa: ['mesa', 'mesas'], local: ['local', 'locales'], barrio: ['barrio', 'barrios'] };

function rangoBin(b) {
    const desde = b < 20 ? -100 + b * 5 : (b - 20) * 5;
    return `${desde} a ${desde + 5} puntos`;
}

function renderDetalleHistograma() {
    const caja = $('detalleHistograma');
    const h = datos.histograma;
    const b = estado.binHistograma;
    for (const barra of document.querySelectorAll('.histograma__barra')) barra.classList.toggle('es-seleccion', Number(barra.dataset.bin) === b);
    caja.replaceChildren();
    if (b === null || !h || !h.porBin[b].length) {
        caja.hidden = true;
        return;
    }
    const filas = [...h.porBin[b]].sort((x, y) => x.m - y.m);
    const [singular, plural] = NOMBRES_UNIDAD[h.unidad];
    const cabecera = el('div', 'histograma__detalle-cabecera');
    cabecera.append(el('h4', null, `${rangoBin(b)} · ${(b < 20 ? h.neg : h.pos).nombre} adelante · ${cantidad(filas.length, singular, plural)}`));
    const cerrar = el('button', 'boton-tabla', 'Cerrar');
    cerrar.type = 'button';
    cerrar.dataset.cerrarDetalle = 'true';
    cabecera.append(cerrar);
    const tabla = el('table', 'tabla');
    const encabezado = el('tr');
    const columnas = [singular[0].toUpperCase() + singular.slice(1), ...(h.unidad === 'barrio' ? [] : ['Barrio']), 'Margen', 'Emitidos', 'Mesas'];
    columnas.forEach((texto, k) => {
        const th = el('th', k === 0 || (k === 1 && h.unidad !== 'barrio') ? 'tabla__texto' : null, texto);
        th.scope = 'col';
        encabezado.append(th);
    });
    tabla.createTHead().append(encabezado);
    const cuerpo = tabla.createTBody();
    for (const { u, m } of filas) {
        const tr = el('tr');
        tr.append(celdaNombre(u.nombre));
        if (h.unidad !== 'barrio') tr.append(el('td', 'tabla__texto', u.barrio ?? '—'));
        tr.append(el('td', null, `${m > 0 ? '+' : ''}${pct.format(m)}`), el('td', null, fmt.format(u.total.emitidos)), el('td', null, fmt.format(u.total.mesas)));
        cuerpo.append(tr);
    }
    const desplazable = el('div', 'tabla-scroll tabla-scroll--detalle');
    desplazable.append(tabla);
    caja.append(cabecera, desplazable);
    caja.dataset.filas = String(filas.length);
    caja.hidden = false;
}

function renderHistograma() {
    const contenedor = $('histograma');
    contenedor.replaceChildren();
    const nota = $('notaHistograma');
    const botones = $('unidadHistograma');
    if (estado.cargo !== MARGEN.cargo) {
        botones.hidden = true;
        datos.histograma = null;
        renderDetalleHistograma();
        nota.textContent = 'El margen compara las dos candidaturas a Intendencia pedidas para este análisis; no se aplica a la Junta Municipal.';
        contenedor.append(el('p', 'histograma__vacio', 'Elegí Intendencia para ver la distribución del margen.'));
        return;
    }
    botones.hidden = false;
    const pos = datos.listas[MARGEN.cargo][datos.indiceMargen.positivo];
    const neg = datos.listas[MARGEN.cargo][datos.indiceMargen.negativo];
    const conteo = new Array(40).fill(0);
    const porBin = Array.from({ length: 40 }, () => []);
    let empates = 0, sinVotos = 0, terceros = 0;
    const lista = unidades(estado.unidad);
    const [singular, plural] = NOMBRES_UNIDAD[estado.unidad];
    for (const u of lista) {
        const m = margen(u.total);
        if (m === null) { sinVotos += 1; continue; }
        const g = ganador(u.total.votos);
        if (g !== null && g !== datos.indiceMargen.positivo && g !== datos.indiceMargen.negativo) terceros += 1;
        if (m === 0) { empates += 1; continue; }
        const k = Math.min(20, Math.ceil(Math.abs(m) / 5));
        const b = m > 0 ? 19 + k : 20 - k;
        conteo[b] += 1;
        porBin[b].push({ u, m });
    }
    datos.histograma = { porBin, unidad: estado.unidad, pos, neg };
    const maximo = Math.max(1, ...conteo);
    // Franja superior reservada a los rótulos y margen lateral para las etiquetas extremas del eje.
    const ancho = 800, alto = 290, arriba = 40, abajo = 34, izquierda = 40, derecha = 40;
    const g = svg('svg', { viewBox: `0 0 ${ancho} ${alto}`, class: 'histograma__svg', role: 'img',
        'aria-label': `Histograma del margen por ${estado.unidad}: ${lista.length} unidades` });
    const paso = (ancho - izquierda - derecha) / 40;
    conteo.forEach((n, b) => {
        const h = ((alto - abajo - arriba) * n) / maximo;
        const x = izquierda + b * paso;
        const barra = svg('rect', { x: x + 1, y: alto - abajo - h, width: Math.max(1, paso - 2), height: h,
            fill: b < 20 ? neg.color : pos.color, class: 'histograma__barra' });
        barra.dataset.bin = b;
        barra.dataset.n = n;
        const resumen = `${rangoBin(b)}, ${(b < 20 ? neg : pos).nombre} adelante: ${cantidad(n, singular, plural)}`;
        if (n) {
            // Cada barra lleva su conteo; el detalle del tramo se abre al tocarla o con Enter.
            const nombres = porBin[b].map((x) => x.u.nombre);
            barra.setAttribute('tabindex', '0');
            barra.setAttribute('role', 'button');
            barra.setAttribute('aria-label', `${resumen}. Ver el detalle.`);
            g.append(titulo(barra, `${resumen}\n${nombres.slice(0, 12).join(' · ')}${nombres.length > 12 ? ` y ${fmt.format(nombres.length - 12)} más` : ''}`));
            const valor = svg('text', { x: x + paso / 2, y: alto - abajo - h - 4, 'text-anchor': 'middle', class: 'histograma__valor' });
            valor.textContent = fmt.format(n);
            g.append(valor);
        } else {
            g.append(titulo(barra, resumen));
        }
    });
    for (const valor of [-100, -50, 0, 50, 100]) {
        const x = izquierda + ((valor + 100) / 5) * paso;
        g.append(svg('line', { x1: x, x2: x, y1: alto - abajo, y2: alto - abajo + 6, class: 'histograma__eje' }));
        const etiqueta = svg('text', { x, y: alto - 10, 'text-anchor': 'middle', class: 'histograma__texto' });
        etiqueta.textContent = valor > 0 ? `+${valor}` : String(valor);
        g.append(etiqueta);
    }
    g.append(svg('line', { x1: izquierda, x2: ancho - derecha, y1: alto - abajo, y2: alto - abajo, class: 'histograma__eje' }));
    const centroX = izquierda + 20 * paso;
    g.append(svg('line', { x1: centroX, x2: centroX, y1: arriba - 6, y2: alto - abajo, class: 'histograma__centro' }));
    const izq = svg('text', { x: centroX - 8, y: 20, 'text-anchor': 'end', class: 'histograma__texto' });
    izq.textContent = `← ${neg.nombre} adelante`;
    const der = svg('text', { x: centroX + 8, y: 20, class: 'histograma__texto' });
    der.textContent = `${pos.nombre} adelante →`;
    g.append(izq, der);
    contenedor.append(g);
    const unidadTexto = { mesa: 'mesas', local: 'locales', barrio: 'barrios' }[estado.unidad];
    nota.textContent = `Margen = 100 × (${pos.sigla} − ${neg.sigla}) / votos a listas de Intendencia, en puntos; tramos de 5 puntos. ` +
        `${fmt.format(lista.length)} ${unidadTexto}` + (empates ? `; ${fmt.format(empates)} con empate exacto, fuera de las barras` : '') +
        (sinVotos ? `; ${fmt.format(sinVotos)} sin votos a listas` : '') +
        (terceros ? `; en ${fmt.format(terceros)} ganó otra lista` : '') +
        '. Tocá una barra para ver sus datos. Barrio = ubicación del local, no residencia de sus electores.';
    contenedor.dataset.total = String(conteo.reduce((a, b) => a + b, 0) + empates);
    renderDetalleHistograma();
}

function renderTabla() {
    const listas = datos.listas[estado.cargo];
    const titulos = { mesa: 'Mesa', local: 'Local', barrio: 'Barrio', zona: 'Zona TSJE', zona_municipal: 'Zona municipal' };
    const columnas = [{ id: 'nombre', titulo: titulos[estado.tabla], texto: true }];
    if (estado.tabla === 'mesa' || estado.tabla === 'local') columnas.push({ id: 'zona', titulo: 'Zona' });
    if (estado.tabla === 'local') columnas.push({ id: 'barrio', titulo: 'Barrio', texto: true });
    if (estado.tabla !== 'mesa') columnas.push({ id: 'mesas', titulo: 'Mesas' });
    columnas.push({ id: 'electores', titulo: 'Electores' }, { id: 'emitidos', titulo: 'Emitidos' }, { id: 'participacion', titulo: 'Particip.' });
    listas.forEach((item, j) => columnas.push({ id: `lista-${j}`, titulo: item.sigla, lista: j }));
    if (estado.cargo === MARGEN.cargo) columnas.push({ id: 'margen', titulo: 'Margen' });
    const filtro = estado.filtro.trim().toLocaleLowerCase('es');
    let filas = unidades(estado.tabla).filter((u) => !filtro || u.nombre.toLocaleLowerCase('es').includes(filtro) ||
        (u.barrio ?? '').toLocaleLowerCase('es').includes(filtro));
    const valor = (u, col) => {
        if (col.lista !== undefined) return u.total.votos[col.lista];
        if (col.id === 'nombre') return u.nombre;
        if (col.id === 'zona') return u.zona;
        if (col.id === 'barrio') return u.barrio ?? '';
        if (col.id === 'mesas') return u.total.mesas;
        if (col.id === 'electores') return u.total.electores;
        if (col.id === 'emitidos') return u.total.emitidos;
        if (col.id === 'participacion') return participacion(u.total) ?? -Infinity;
        if (col.id === 'margen') return margen(u.total) ?? -Infinity;
        return 0;
    };
    if (estado.orden) {
        const col = columnas.find((x) => x.id === estado.orden.id);
        if (col) {
            filas = filas.sort((a, b) => {
                const va = valor(a, col), vb = valor(b, col);
                const r = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
                return estado.orden.dir * r;
            });
        }
    }
    const tr = el('tr');
    for (const col of columnas) {
        const th = el('th', col.texto ? 'tabla__texto' : null);
        th.scope = 'col';
        const boton = el('button', 'tabla__orden', col.titulo);
        boton.type = 'button';
        boton.dataset.columna = col.id;
        if (estado.orden?.id === col.id) th.setAttribute('aria-sort', estado.orden.dir > 0 ? 'ascending' : 'descending');
        th.append(boton);
        tr.append(th);
    }
    if (estado.tabla === 'local') tr.append(el('th', null, ''));
    $('tabla').tHead.replaceChildren(tr);
    const fragmento = document.createDocumentFragment();
    for (const u of filas) {
        const fila = el('tr');
        if (u.local && estado.local === u.local) fila.classList.add('es-seleccion');
        for (const col of columnas) {
            const v = valor(u, col);
            let texto = v;
            if (col.lista !== undefined) texto = `${fmt.format(v)} (${u.total.listas ? pct.format((100 * v) / u.total.listas) : '0,0'} %)`;
            else if (col.id === 'margen') texto = v === -Infinity ? '—' : `${v > 0 ? '+' : ''}${pct.format(v)}`;
            else if (col.id === 'participacion') texto = v === -Infinity ? '—' : `${pct.format(v)} %`;
            else if (typeof v === 'number') texto = fmt.format(v);
            // Solo el nombre de la unidad encabeza la fila; las demás columnas de texto se alinean a la izquierda.
            fila.append(col.id === 'nombre' ? celdaNombre(texto, 'tabla__texto') : el('td', col.texto ? 'tabla__texto' : null, texto));
        }
        if (estado.tabla === 'local') {
            const celda = el('td');
            const boton = el('button', 'boton-tabla', 'Ver');
            boton.type = 'button';
            boton.dataset.local = u.local;
            boton.setAttribute('aria-label', `Ver ${u.nombre} en el panel de resultados y en el mapa de mesas`);
            celda.append(boton);
            fila.append(celda);
        }
        fragmento.append(fila);
    }
    $('tabla').tBodies[0].replaceChildren(fragmento);
    $('tabla').dataset.filas = String(filas.length);
    $('notaTabla').textContent = `${fmt.format(filas.length)} filas. Porcentajes sobre votos a listas de cada unidad; participación = emitidos / electores` +
        (estado.cargo === MARGEN.cargo ? '; margen en puntos, positivo = ' + datos.listas[MARGEN.cargo][datos.indiceMargen.positivo].sigla + ' adelante.' : '.') +
        (estado.tabla === 'zona_municipal' ? ' Zona municipal según la ubicación del local.' : '');
}

// Pestañas (selector de cargo y gráficos): solo la elegida entra en el orden de tabulación.
function marcarPestanas(lista, esActiva) {
    for (const boton of lista.querySelectorAll('[role="tab"]')) {
        const activa = esActiva(boton);
        boton.setAttribute('aria-selected', String(activa));
        boton.tabIndex = activa ? 0 : -1;
    }
}

// Flechas izquierda y derecha, Inicio y Fin mueven el foco entre pestañas y las eligen (activación automática).
function pestanasConTeclado(lista) {
    lista.addEventListener('keydown', (evento) => {
        const actual = evento.target.closest('[role="tab"]');
        if (!actual) return;
        const todas = [...lista.querySelectorAll('[role="tab"]')];
        const k = todas.indexOf(actual);
        const destino = { ArrowRight: (k + 1) % todas.length, ArrowLeft: (k - 1 + todas.length) % todas.length, Home: 0, End: todas.length - 1 }[evento.key];
        if (destino === undefined) return;
        evento.preventDefault();
        todas[destino].focus();
        todas[destino].click();
    });
}

function renderVista() {
    marcarPestanas($('pestanas'), (boton) => boton.dataset.vista === estado.vista);
    for (const boton of document.querySelectorAll('#pestanas [data-vista]')) $(`vista-${boton.dataset.vista}`).hidden = boton.dataset.vista !== estado.vista;
    const render = { mapa: renderMapaMesas, barrios: renderMapaBarrios, listas: renderMapaListas, participacion: renderMapaParticipacion,
                     ipm: renderMapaIpm, margen: renderHistograma, tablas: renderTabla }[estado.vista];
    render();
    actualizarEnlace();
}

// --- Enlace compartible: el estado va en el hash (#eleccion=municipales&anio=2026&cargo=intendencia&vista=mapa&local=…) ---

// Cargo del visor ('1', '2' o 'c' para el voto cruzado) ↔ valor del hash (intendencia | junta).
const CARGO_HASH = { 1: 'intendencia', 2: 'junta' };

let enlaceListo = false;  // La carga no escribe el hash: la dirección queda limpia hasta el primer cambio.

function parametrosEnlace() {
    const p = new URLSearchParams({ eleccion: datos.contexto.eleccion.id, anio: String(datos.contexto.anio.anio),
                                    cargo: CARGO_HASH[estado.cargo] ?? 'intendencia', modo: 'informe' });
    if (estado.cargo === 'c') {
        p.set('analisis', 'voto-cruzado');
        const ivj = datos.ivj.estadoEnlace();
        p.set('grupo', ivj.grupo);
        p.set('metrica', ivj.metrica);
        p.set('grafico', ivj.grafico);
        if (ivj.local) p.set('local', ivj.local);
    } else {
        p.set('vista', estado.vista);
        if (estado.local) p.set('local', estado.local);
        else if (estado.barrio) p.set('barrio', estado.barrio);
    }
    if (estado.zonaMunicipal !== null) p.set('zona_municipal', String(estado.zonaMunicipal));
    else if (estado.zona !== null) p.set('zona', String(estado.zona));
    return p;
}

// «Ver el tablero»: el mismo cargo, zona y local o barrio, con la capa que corresponde a la pestaña abierta.
const VISTA_A_CAPA = { mapa: 'lista', barrios: 'lista', listas: 'listas', participacion: 'participacion', ipm: 'ipm', margen: 'margen', tablas: 'lista' };
const CAPA_A_VISTA = { lista: 'mapa', listas: 'listas', participacion: 'participacion', margen: 'margen', ipm: 'ipm', zona: 'mapa' };

function actualizarEnlaceTablero() {
    const p = parametrosEnlace();
    const capa = estado.cargo === 'c' ? 'lista' : estado.vista === 'mapa' && estado.colorMapa === 'zona' ? 'zona' : VISTA_A_CAPA[estado.vista];
    const t = new URLSearchParams({ eleccion: p.get('eleccion'), anio: p.get('anio'), cargo: p.get('cargo'), capa });
    for (const clave of estado.cargo === 'c' ? ['zona_municipal', 'zona'] : ['zona_municipal', 'zona', 'barrio', 'local']) {
        if (p.has(clave)) t.set(clave, p.get(clave));
    }
    $('enlaceTablero').href = `#${t}`;
}

// El estado compartido (shell.js) escribe el hash con history.replaceState: sin entradas nuevas en el historial.
function actualizarEnlace() {
    actualizarEnlaceTablero();
    if (!enlaceListo) return;
    compartido.reemplazar(Object.fromEntries(parametrosEnlace()), 'visor');
}

// Aplica el hash al estado; los valores que no existen en los datos se ignoran y quedan los de omisión.
function leerEnlace() {
    const p = new URLSearchParams(location.hash.slice(1));
    const de = (objeto, clave) => (clave !== null && /^\d+$/.test(clave) && Object.hasOwn(objeto, clave) ? Number(clave) : null);
    // También acepta los valores viejos (1, 2 y c) por si llega un enlace sin pasar por la redirección.
    const cargo = p.get('cargo');
    estado.cargo = p.get('analisis') === 'voto-cruzado' || cargo === 'c' ? 'c' : cargo === 'junta' || cargo === '2' ? '2' : '1';
    estado.vista = VISTAS.includes(p.get('vista')) ? p.get('vista') : CAPA_A_VISTA[p.get('capa')] ?? 'mapa';
    if (!p.has('vista') && p.get('capa') === 'zona') estado.colorMapa = 'zona';
    estado.zonaMunicipal = de(datos.resumen.zonas_municipales, p.get('zona_municipal'));
    estado.zona = estado.zonaMunicipal === null ? de(datos.resumen.zonas, p.get('zona')) : null;
    const local = p.get('local'), barrio = p.get('barrio');
    estado.local = estado.cargo !== 'c' && local && datos.infoLocal.has(local) ? local : null;
    estado.barrio = estado.cargo !== 'c' && !estado.local && barrio && datos.filas.some((f) => f.barrio === barrio) ? barrio : null;
    estado.orden = null;
    estado.binHistograma = null;
    $('filtroZona').value = estado.zonaMunicipal !== null ? `m${estado.zonaMunicipal}` : estado.zona !== null ? `t${estado.zona}` : '';
    datos.ivj.aplicarEnlace({ grupo: p.get('grupo'), metrica: p.get('metrica'), grafico: p.get('grafico'), local: estado.cargo === 'c' ? local : null });
}

// «Copiar enlace»: con el menú de compartir del sistema si existe; si no, al portapapeles. Si nada funciona, se
// muestra el enlace para copiarlo a mano.
async function compartirEnlace(aviso) {
    const enlace = `${location.origin}${location.pathname}${location.search}#${parametrosEnlace()}`;
    const avisar = (texto) => {
        aviso.textContent = texto;
        clearTimeout(aviso.espera);
        if (texto) aviso.espera = setTimeout(() => { aviso.textContent = ''; }, 6000);
    };
    if (navigator.share) {
        try {
            await navigator.share({ title: document.title, url: enlace });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }
    }
    try {
        await navigator.clipboard.writeText(enlace);
        avisar('Enlace copiado');
    } catch {
        avisar(`Copiá este enlace: ${enlace}`);
    }
}

function renderTodo() {
    // El cargo lo elige la barra de contexto (shell.js); el voto cruzado tiene su propio botón en el visor.
    $('cargo-c').setAttribute('aria-pressed', String(estado.cargo === 'c'));
    // «Intendente vs Junta» reemplaza al panel de resultado y a los gráficos mientras está elegida.
    const intendenteJunta = estado.cargo === 'c';
    $('panelIvj').hidden = !intendenteJunta;
    $('panelTotales').hidden = intendenteJunta;
    $('panelGraficos').hidden = intendenteJunta;
    if (intendenteJunta) {
        if (ficha.abierta() && ficha.propietario() !== 'ivj') ficha.cerrar({ devolverFoco: false });
        renderBancas();
        datos.ivj.render();
        actualizarEnlace();
        return;
    }
    if (ficha.abierta() && ficha.propietario() !== 'visor') ficha.cerrar({ devolverFoco: false });
    for (const boton of document.querySelectorAll('[data-tabla]')) boton.setAttribute('aria-pressed', String(boton.dataset.tabla === estado.tabla));
    for (const boton of document.querySelectorAll('[data-unidad]')) boton.setAttribute('aria-pressed', String(boton.dataset.unidad === estado.unidad));
    for (const boton of document.querySelectorAll('[data-color]')) boton.setAttribute('aria-pressed', String(boton.dataset.color === estado.colorMapa));
    datos.agregados = agregadosBarrio();
    renderTotales();
    renderBancas();
    renderVista();
    // Con la ficha abierta, un cambio de cargo o de filtro la actualiza; sin local ni barrio elegido, se cierra.
    if (ficha.abierta()) mostrarFicha();
}

// --- Ficha inferior del local o barrio elegido --------------------------------------------------

function contenidoFicha() {
    const cargo = datos.resumen.cargos[estado.cargo].nombre;
    const zonaMunicipal = (n) => `Zona municipal ${n} (${datos.resumen.zonas_municipales[n]})`;
    let indices, contenido;
    if (estado.local) {
        const info = datos.infoLocal.get(estado.local);
        indices = mesasDe((f) => f.clave === estado.local);
        contenido = { eyebrow: `Local de votación · ${cargo}`, titulo: info.nombre,
            meta: [info.barrio ? `Barrio ${info.barrio}` : null, `Zona TSJE ${info.zona} (${info.zona_nombre})`,
                info.zona_municipal === null || info.zona_municipal === undefined ? null : zonaMunicipal(info.zona_municipal),
                cantidad(indices.length, 'mesa', 'mesas')].filter(Boolean).join(' · ') };
    } else if (estado.barrio) {
        const locales = [...datos.infoLocal.values()].filter((x) => x.barrio === estado.barrio);
        indices = mesasDe((f) => f.barrio === estado.barrio);
        const unicos = (valores) => [...new Set(valores.filter((v) => v !== null && v !== undefined))].sort((a, b) => a - b);
        const tsje = unicos(locales.map((x) => x.zona)), municipales = unicos(locales.map((x) => x.zona_municipal));
        contenido = { eyebrow: `Barrio · ${cargo}`, titulo: estado.barrio,
            meta: [cantidad(locales.length, 'local', 'locales'), cantidad(indices.length, 'mesa', 'mesas'),
                `${tsje.length === 1 ? 'Zona TSJE' : 'Zonas TSJE'} ${tsje.join(', ')}`,
                municipales.length === 1 ? zonaMunicipal(municipales[0]) : municipales.length ? `Zonas municipales ${municipales.join(', ')}` : null]
                .filter(Boolean).join(' · ') };
    } else {
        return null;
    }
    const total = sumar(indices, estado.cargo);
    const listas = datos.listas[estado.cargo];
    const orden = total.votos.map((v, j) => j).sort((a, b) => total.votos[b] - total.votos[a]);
    const cuerpo = el('div', 'ficha__datos');
    const ul = el('ul', 'ficha__listas');
    for (const j of orden) {
        const item = listas[j];
        const li = el('li', 'ficha__lista');
        li.dataset.lista = item.num;
        const forma = formaDe(item);
        const muestra = el('span', `leyenda__muestra${forma !== 'circulo' ? ` leyenda__muestra--${forma}` : ''}`);
        muestra.style.background = item.color;
        li.append(muestra, el('span', 'ficha__nombre', estado.cargo === '1' ? `${item.sigla} · ${item.nombre}` : `${item.sigla} · lista ${item.num}`),
            el('span', 'ficha__votos', fmt.format(total.votos[j])),
            el('span', 'ficha__pct', `${total.listas ? pct.format((100 * total.votos[j]) / total.listas) : '0,0'} %`));
        ul.append(li);
    }
    const dl = el('dl', 'ficha__resumen');
    const dato = (termino, valor) => {
        const grupo = el('div');
        grupo.append(el('dt', null, termino), el('dd', null, valor));
        dl.append(grupo);
    };
    const p = participacion(total);
    if (p !== null) dato('Participación', `${pct.format(p)} % · ${fmt.format(total.emitidos)} de ${fmt.format(total.electores)} electores`);
    if (orden.length > 1 && total.listas) {
        const [a, b] = orden;
        const votos = total.votos[a] - total.votos[b];
        dato('Diferencia entre las dos primeras', `${listas[a].sigla} sobre ${listas[b].sigla}: ${fmt.format(votos)} votos · ` +
            `${pct.format((100 * votos) / total.listas)} puntos`);
    }
    cuerpo.append(ul, dl);
    return { ...contenido, cuerpo, detalle: () => {
        salirDePantallaCompleta();
        $('tituloTotales').scrollIntoView({ block: 'start', behavior: movimiento() });
    } };
}

function mostrarFicha() {
    const contenido = contenidoFicha();
    if (contenido) ficha.abrir(contenido, 'visor');
    else ficha.cerrar({ devolverFoco: false });
}

// Con la ficha, la página no se mueve: el panel de resultados (más arriba) cambia de alto con cada local, así que se
// compensa el desplazamiento para que lo tocado quede en el mismo lugar de la pantalla. Safari no ancla el
// desplazamiento por su cuenta y Chrome no siempre lo hace.
function sinMoverLaPagina(referencia, accion) {
    const antes = referencia?.getBoundingClientRect().top;
    accion();
    if (antes === undefined || !referencia.isConnected) return;
    const corrimiento = referencia.getBoundingClientRect().top - antes;
    if (Math.abs(corrimiento) >= 1) window.scrollBy({ top: corrimiento, behavior: 'instant' });
}

function elegir(cambio, referencia) {
    if (!usarFicha()) {
        cambio();
        renderTodo();
        $('tituloTotales').scrollIntoView({ block: 'nearest', behavior: movimiento() });
        return;
    }
    sinMoverLaPagina(referencia, () => {
        cambio();
        renderTodo();
    });
    mostrarFicha();
}

// referencia: el mapa o la tabla donde se tocó; con la ficha, queda quieto en la pantalla.
function seleccionarLocal(clave, referencia) {
    elegir(() => { estado.local = clave; estado.barrio = null; }, referencia);
}

function seleccionarBarrio(nombre, referencia) {
    elegir(() => { estado.barrio = nombre; estado.local = null; }, referencia);
}

function renderFijos() {
    const r = datos.resumen;
    $('resumenLead').textContent = `Corte del ${new Date(`${r.eleccion.corte}T12:00:00`).toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' })}. ` +
        `${fmt.format(r.cobertura.mesas_con_acta)} de ${fmt.format(r.cobertura.mesas_esperadas)} mesas con acta en ${fmt.format(datos.infoLocal.size)} locales de votación. ` +
        `Participación: ${pct.format(100 * r.electores.participacion)} %.`;
    $('avisoTrep').textContent = r.eleccion.aviso;
    for (const [codigo, nombre] of Object.entries(r.zonas_municipales)) $('opcionesMunicipales').append(new Option(`${codigo} · ${nombre}`, `m${codigo}`));
    for (const [codigo, nombre] of Object.entries(r.zonas)) $('opcionesTsje').append(new Option(`${codigo} · ${nombre}`, `t${codigo}`));
    renderNoDisponible(datos);
    renderFuentes(datos);
}

// Secciones plegables: cerradas en celular y abiertas en escritorio, donde no se pliegan (se ven como antes).
function prepararPlegables() {
    const ajustar = () => { for (const d of document.querySelectorAll('details.plegable')) d.open = !PANTALLA_CHICA.matches; };
    for (const resumen of document.querySelectorAll('details.plegable > summary')) {
        resumen.addEventListener('click', (evento) => { if (!PANTALLA_CHICA.matches) evento.preventDefault(); });
    }
    PANTALLA_CHICA.addEventListener('change', ajustar);
    ajustar();
}

function eventos() {
    // Voto cruzado: entra y sale con su botón; la barra de contexto elige Intendencia o Junta (y sale del voto cruzado).
    $('cargo-c').addEventListener('click', () => {
        estado.cargo = estado.cargo === 'c' ? (compartido.obtener('cargo') === 'junta' ? '2' : '1') : 'c';
        estado.orden = null;
        renderTodo();
    });
    compartido.suscribir(({ cambiadas, origen }) => {
        if (origen !== 'barra' || !cambiadas.has('cargo')) return;
        estado.cargo = compartido.obtener('cargo') === 'junta' ? '2' : '1';
        estado.orden = null;
        renderTodo();
    });
    for (const boton of document.querySelectorAll('#pestanas [data-vista]')) {
        boton.addEventListener('click', () => { estado.vista = boton.dataset.vista; renderVista(); });
    }
    for (const boton of document.querySelectorAll('[data-tabla]')) {
        boton.addEventListener('click', () => { estado.tabla = boton.dataset.tabla; estado.orden = null; renderTodo(); });
    }
    for (const boton of document.querySelectorAll('[data-unidad]')) {
        boton.addEventListener('click', () => { estado.unidad = boton.dataset.unidad; renderTodo(); });
    }
    for (const boton of document.querySelectorAll('[data-color]')) {
        boton.addEventListener('click', () => { estado.colorMapa = boton.dataset.color; renderTodo(); });
    }
    for (const boton of document.querySelectorAll('[data-ipm]')) {
        boton.addEventListener('click', () => { estado.ipm = boton.dataset.ipm; renderVista(); });
    }
    for (const boton of document.querySelectorAll('[data-medida]')) {
        boton.addEventListener('click', () => { estado.medida = boton.dataset.medida; renderVista(); });
    }
    const elegirBarra = (barra) => {
        const b = Number(barra.dataset.bin);
        estado.binHistograma = estado.binHistograma === b ? null : b;
        renderDetalleHistograma();
    };
    $('histograma').addEventListener('click', (evento) => {
        const barra = evento.target.closest('.histograma__barra');
        if (barra && Number(barra.dataset.n)) elegirBarra(barra);
    });
    $('histograma').addEventListener('keydown', (evento) => {
        const barra = evento.target.closest('.histograma__barra');
        if (barra && (evento.key === 'Enter' || evento.key === ' ')) {
            evento.preventDefault();
            elegirBarra(barra);
        }
    });
    $('detalleHistograma').addEventListener('click', (evento) => {
        if (evento.target.closest('[data-cerrar-detalle]')) {
            estado.binHistograma = null;
            renderDetalleHistograma();
        }
    });
    $('selectorLista').addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-lista]');
        if (!boton) return;
        estado.lista[estado.cargo] = Number(boton.dataset.lista);
        renderVista();
    });
    $('filtroZona').addEventListener('change', (evento) => {
        const valor = evento.target.value;
        estado.zona = valor.startsWith('t') ? Number(valor.slice(1)) : null;
        estado.zonaMunicipal = valor.startsWith('m') ? Number(valor.slice(1)) : null;
        estado.local = null;
        estado.barrio = null;
        renderTodo();
    });
    $('limpiarSeleccion').addEventListener('click', () => {
        estado.local = null;
        estado.barrio = null;
        estado.zona = null;
        estado.zonaMunicipal = null;
        $('filtroZona').value = '';
        renderTodo();
    });
    $('filtroTabla').addEventListener('input', (evento) => { estado.filtro = evento.target.value; renderTabla(); });
    pestanasConTeclado($('pestanas'));
    $('copiarEnlace').addEventListener('click', () => compartirEnlace($('avisoEnlace')));
    $('fichaEnlace').addEventListener('click', () => compartirEnlace($('fichaAviso')));
    // Un enlace pegado en la misma pestaña (o el hash editado a mano) cambia la vista sin recargar.
    window.addEventListener('hashchange', () => { leerEnlace(); renderTodo(); });
    // Cambio de tema: los mapas se vuelven a pintar con la superficie nueva («Intendente vs Junta» lo hace en su módulo).
    new MutationObserver(() => { if (estado.cargo !== 'c') renderVista(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    $('tabla').addEventListener('click', (evento) => {
        const local = evento.target.closest('[data-local]')?.dataset.local;
        if (local) { seleccionarLocal(local, evento.target.closest('[data-local]')); return; }
        const columna = evento.target.closest('[data-columna]')?.dataset.columna;
        if (!columna) return;
        estado.orden = estado.orden?.id === columna ? { id: columna, dir: -estado.orden.dir } : { id: columna, dir: columna === 'nombre' ? 1 : -1 };
        renderTabla();
    });
}

// La llama inicio.js con la fuente de la sección; por ahora la vista informe solo existe para el TREP.
export async function iniciar({ fuente = 'trep' } = {}) {
    const visor = $('visor');
    try {
        const pedido = new URLSearchParams(location.hash.slice(1));
        const { datos: modelo } = await cargarModelo({ eleccion: pedido.get('eleccion'), anio: pedido.get('anio') }, fuente);
        if (!modelo) throw new Error('Los resultados de esta fuente aún no están publicados.');
        datos = modelo;
        ficha = crearFicha();
        // Al pasar a escritorio (tablet que gira, ventana que se agranda) la ficha se cierra: allí se usa el panel.
        PANTALLA_ANGOSTA.addEventListener('change', () => { if (!usarFicha()) ficha.cerrar({ devolverFoco: false }); });
        datos.ivj = crearIntendenteJunta(datos, { crearMapa: crearMapaConMesas, mezclar, cuantiles, opacidadPaso, ficha, usarFicha, movimiento,
                                                  alCambiar: () => actualizarEnlace() });
        renderFijos();
        prepararPlegables();
        crearMapaMesas();
        eventos();
        leerEnlace();
        renderTodo();
        enlaceListo = true;
        await shellListo;  // La barra de contexto (cargos y estado de la fuente) también está lista.
        vigilarDesplazables();
        visor.dataset.listo = 'true';
    } catch (error) {
        const aviso = $('errorCarga');
        aviso.hidden = false;
        aviso.textContent = 'No fue posible leer los datos del análisis. Revisá la conexión o el servidor local.';
        $('resumenLead').textContent = '';
        console.error(error);
    } finally {
        visor.setAttribute('aria-busy', 'false');
    }
}
