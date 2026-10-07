// Ganador por mesa y pobreza (ADR 0013 del módulo): cada mesa con acta, con el color y la forma de la lista que ganó en
// ella para el cargo de la barra (Intendencia o Junta Municipal), frente a un indicador de pobreza del barrio de su local
// (incidencia, intensidad o IPM del INE, Censo 2022). «Curvas por lista» ordena los barrios por el indicador, los agrupa en
// tramos con una cantidad parecida de mesas (barrios enteros) y muestra qué parte de las mesas de cada tramo ganó cada
// lista. Es una comparación entre agregados (mesas y barrios), no de personas.
import { cargarChart, colores, fondo, descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { unidades, ganador, ventajaDe, formaDe } from '../tablero/modelo.js';
import { el, fmt, pct, pct2, cantidad } from '../tablero/util.js';

const INDICADORES = [['H', 'Incidencia'], ['A', 'Intensidad'], ['IPM', 'IPM']];
const GRAFICOS = [['mesas', 'Cada mesa'], ['curvas', 'Curvas por lista']];
const PUNTO = { circulo: 'circle', rombo: 'rectRot', cuadrado: 'rect' };
// Curvas: hasta 8 tramos, con unas 25 mesas por tramo como mínimo.
export const TRAMOS = 8;
export const MESAS_POR_TRAMO = 25;
export const EMPATE = -1;
const conAlfa = (color, alfa) => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}${Math.round(alfa * 255).toString(16).padStart(2, '0')}` : color);

// Cantidad de tramos para un conjunto de mesas con dato.
export const cantidadTramos = (mesas) => Math.max(1, Math.min(TRAMOS, new Set(mesas.map((m) => m.barrio)).size,
                                                              Math.floor(mesas.length / MESAS_POR_TRAMO)));

// Barrios ordenados por el indicador (y por nombre, con el mismo valor) y agrupados en k tramos con una cantidad parecida de
// mesas, sin partir barrios: cada barrio va al tramo que le corresponde por las mesas acumuladas antes de él.
export function tramos(mesas, k) {
    const porBarrio = new Map();
    for (const m of mesas) {
        if (!porBarrio.has(m.barrio)) porBarrio.set(m.barrio, { barrio: m.barrio, x: m.x, mesas: [] });
        porBarrio.get(m.barrio).mesas.push(m);
    }
    const orden = [...porBarrio.values()].sort((a, b) => a.x - b.x || (a.barrio < b.barrio ? -1 : a.barrio > b.barrio ? 1 : 0));
    const grupos = [];
    let acumuladas = 0;
    for (const b of orden) {
        const i = Math.min(k - 1, Math.floor((acumuladas * k) / mesas.length));
        grupos[i] ??= { barrios: [], mesas: [] };
        grupos[i].barrios.push(b.barrio);
        grupos[i].mesas.push(...b.mesas);
        acumuladas += b.mesas.length;
    }
    return grupos.filter(Boolean).map((g) => ({
        ...g, x: g.mesas.reduce((a, m) => a + m.x, 0) / g.mesas.length,
        desde: Math.min(...g.mesas.map((m) => m.x)), hasta: Math.max(...g.mesas.map((m) => m.x)),
    }));
}

// «A, B y C».
const enumerar = (partes) => (partes.length < 2 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`);

export function crear(ctx) {
    const { datos } = ctx;
    const estado = { indicador: 'H', grafico: 'mesas', orden: { id: 'indicador', dir: -1 } };
    let grafico = null;
    let calculo = null;
    let mostradas = [];

    const segmentos = (etiqueta, opciones, atributo) => {
        const grupo = el('div', 'segmentos');
        grupo.setAttribute('role', 'group');
        grupo.setAttribute('aria-label', etiqueta);
        for (const [id, nombre] of opciones) {
            const boton = el('button', null, nombre);
            boton.type = 'button';
            boton.dataset[atributo] = id;
            grupo.append(boton);
        }
        return grupo;
    };
    const indicadores = segmentos('Indicador de pobreza', INDICADORES, 'indicador');
    const graficos = segmentos('Gráfico', GRAFICOS, 'grafico');
    indicadores.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-indicador]');
        if (!boton || boton.dataset.indicador === estado.indicador) return;
        estado.indicador = boton.dataset.indicador;
        render();
        ctx.alCambiar();
    });
    graficos.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-grafico]');
        if (!boton || boton.dataset.grafico === estado.grafico) return;
        elegirGrafico(boton.dataset.grafico);
        render();
        ctx.alCambiar();
    });
    ctx.controles.append(indicadores, graficos);
    const caja = el('div', 'analisis__lienzo analisis__lienzo--cuadrado');
    const lienzo = el('canvas');
    lienzo.setAttribute('role', 'img');
    caja.append(lienzo);
    ctx.cuerpo.append(caja);
    const tabla = el('table', 'tabla');
    const desplazable = el('div', 'tabla-scroll');
    desplazable.append(tabla);
    const nota = el('p', 'nota');
    ctx.tabla.append(desplazable, nota);
    const lectura = el('div');
    ctx.lectura.append(lectura);

    function elegirGrafico(id) {
        estado.grafico = id;
        estado.orden = id === 'mesas' ? { id: 'indicador', dir: -1 } : { id: 'tramo', dir: 1 };
    }
    const indicador = () => datos.ipm.indicadores.find((x) => x.id === estado.indicador);
    // Nombre del indicador dentro de una frase: sin el paréntesis y en minúscula, salvo una sigla («IPM»).
    const enFrase = () => {
        const base = indicador().nombre.replace(/\s*\(.*\)\s*$/, '');
        return base === base.toUpperCase() ? base : base.toLowerCase();
    };
    const formato = (v) => `${(estado.indicador === 'A' ? pct : pct2).format(v)} %`;
    // Sin dato publicado, o intensidad sin personas pobres (H = 0): la mesa queda fuera del gráfico.
    const valorDe = (b) => (!b || b[estado.indicador] === null || b[estado.indicador] === undefined || (estado.indicador === 'A' && b.H === 0)
        ? null : b[estado.indicador]);
    const listas = () => datos.listas[ctx.cargo()];
    const nombreLista = (item) => (ctx.cargo() === '1' ? `${item.sigla} · ${item.nombre}` : `${item.sigla} · lista ${item.num}`);
    const siglaDe = (g) => (g === EMPATE ? 'Empate' : listas()[g].sigla);

    function calcular() {
        const todas = unidades(datos, 'mesa', ctx.cargo(), ctx.enFiltro).map((u) => {
            const t = u.total;
            const g = t.listas ? (ganador(t.votos) ?? EMPATE) : null;
            const v = ventajaDe(t);
            return { u, nombre: u.nombre, barrio: u.barrio ?? null, g, ventaja: v ? v.puntos : null,
                     x: valorDe(datos.ipmPor.get(datos.barrioPor.get(u.barrio)?.clave)),
                     y: t.listas ? (100 * Math.max(...t.votos)) / t.listas : null };
        });
        const conVotos = todas.filter((m) => m.g !== null);
        const mesas = conVotos.filter((m) => m.x !== null);
        const grupos = mesas.length ? tramos(mesas, cantidadTramos(mesas)) : [];
        const ganadas = new Map();
        for (const m of mesas) ganadas.set(m.g, (ganadas.get(m.g) ?? 0) + 1);
        for (const g of grupos) {
            g.ganadas = new Map();
            for (const m of g.mesas) g.ganadas.set(m.g, (g.ganadas.get(m.g) ?? 0) + 1);
        }
        // Listas que ganaron alguna mesa con dato, de más a menos mesas; los empates van aparte.
        const ganadoras = [...ganadas.keys()].filter((j) => j !== EMPATE).sort((a, b) => ganadas.get(b) - ganadas.get(a) || a - b);
        return { todas, conVotos, mesas, grupos, ganadas, ganadoras, sinVotos: todas.length - conVotos.length, sinDato: conVotos.length - mesas.length };
    }

    const columnasMesas = () => [
        { id: 'nombre', titulo: 'Mesa', texto: true, v: (m) => m.nombre },
        { id: 'barrio', titulo: 'Barrio', texto: true, v: (m) => m.barrio ?? '' },
        { id: 'indicador', titulo: indicador().nombre, v: (m) => m.x, f: (v) => (v === null ? 'sin dato' : formato(v)) },
        { id: 'ganadora', titulo: 'Lista ganadora', texto: true, v: (m) => siglaDe(m.g) },
        { id: 'pct', titulo: '% de la ganadora', v: (m) => m.y, f: (v) => `${pct.format(v)} %` },
        { id: 'ventaja', titulo: 'Ventaja (puntos)', v: (m) => m.ventaja, f: (v) => (v === null ? '—' : pct.format(v)) },
        { id: 'listas', titulo: 'Votos a listas', v: (m) => m.u.total.listas },
    ];
    const columnasTramos = () => [
        { id: 'tramo', titulo: 'Tramo', v: (g) => g.n },
        { id: 'desde', titulo: `${indicador().nombre} desde`, v: (g) => g.desde, f: (v) => formato(v) },
        { id: 'hasta', titulo: `${indicador().nombre} hasta`, v: (g) => g.hasta, f: (v) => formato(v) },
        { id: 'medio', titulo: `${indicador().nombre} medio`, v: (g) => g.x, f: (v) => formato(v) },
        { id: 'mesas', titulo: 'Mesas', v: (g) => g.mesas.length },
        { id: 'barrios', titulo: 'Barrios', v: (g) => g.barrios.length },
        ...calculo.ganadoras.map((j) => ({ id: `l${j}`, titulo: `% ganadas por ${listas()[j].sigla}`,
                                           v: (g) => (100 * (g.ganadas.get(j) ?? 0)) / g.mesas.length, f: (v) => `${pct.format(v)} %` })),
        ...(calculo.ganadas.get(EMPATE) ? [{ id: 'empates', titulo: 'Empates', v: (g) => g.ganadas.get(EMPATE) ?? 0 }] : []),
    ];
    const columnas = () => (estado.grafico === 'mesas' ? columnasMesas() : columnasTramos());
    alOrdenar(tabla, estado, columnas, () => renderTabla());

    function renderTabla() {
        if (estado.grafico === 'mesas') {
            mostradas = renderTablaOrdenable(tabla, columnasMesas(), calculo.conVotos, estado);
            nota.textContent = `${cantidad(calculo.conVotos.length, 'mesa con votos a listas', 'mesas con votos a listas')}` +
                (calculo.sinDato ? `; ${cantidad(calculo.sinDato, 'queda', 'quedan')} fuera del gráfico por no tener dato del indicador en su barrio` : '') +
                `. Lista ganadora: la más votada de la mesa para ${ctx.nombreCargo()} («Empate» si dos o más quedan arriba con los mismos votos). ` +
                'Ventaja: puntos de la primera sobre la segunda, sobre los votos a listas.';
        } else {
            mostradas = renderTablaOrdenable(tabla, columnasTramos(), calculo.grupos.map((g, i) => Object.assign(g, { n: i + 1 })), estado);
            nota.textContent = `${cantidad(calculo.grupos.length, 'tramo', 'tramos')} de barrios ordenados por ${enFrase()}, con una cantidad parecida de ` +
                'mesas cada uno y sin partir barrios. Cada columna de lista: porcentaje de las mesas del tramo que ganó.';
        }
    }

    function renderLectura() {
        const { mesas, grupos, ganadas, ganadoras, sinVotos, sinDato } = calculo;
        const cargo = ctx.nombreCargo();
        if (!mesas.length) {
            lectura.replaceChildren(el('p', null, 'En la selección no hay mesas con votos a listas y dato del indicador en su barrio.'));
            return;
        }
        const partes = [estado.grafico === 'mesas'
            ? el('p', null, `Cada punto es una mesa con acta, con el color y la forma de la lista que ganó en ella para ${cargo} (en gris, los ` +
                `empates). Más a la derecha, mayor ${enFrase()} en el barrio de su local (${indicador().descripcion.replace(/\.$/, '')}); más arriba, ` +
                'mayor porcentaje de la ganadora sobre los votos a listas de la mesa. Las mesas de un mismo barrio comparten su valor y forman una columna.')
            : el('p', null, `Los barrios se ordenan por ${enFrase()} y se agrupan en ${cantidad(grupos.length, 'tramo', 'tramos')} con una cantidad ` +
                `parecida de mesas, sin partir barrios. Cada curva muestra qué porcentaje de las mesas de cada tramo ganó esa lista para ${cargo}; ` +
                'cada punto va en el valor medio del tramo.')];
        const mostrar = ganadoras.slice(0, 4).map((j) => `${listas()[j].sigla} ganó ${fmt.format(ganadas.get(j))} (${pct.format((100 * ganadas.get(j)) / mesas.length)} %)`);
        if (ganadoras.length > 4) mostrar.push(`otras ${fmt.format(ganadoras.length - 4)} listas, el resto`);
        partes.push(el('p', null, `De ${cantidad(mesas.length, 'mesa con dato', 'mesas con dato')}, ${enumerar(mostrar)}` +
            (ganadas.get(EMPATE) ? `; ${cantidad(ganadas.get(EMPATE), 'quedó empatada', 'quedaron empatadas')}` : '') + '.' +
            (sinDato ? ` ${cantidad(sinDato, 'mesa queda', 'mesas quedan')} fuera por no tener dato del indicador en su barrio.` : '') +
            (sinVotos ? ` ${cantidad(sinVotos, 'mesa no tiene', 'mesas no tienen')} votos a listas.` : '')));
        partes.push(el('p', null, 'Es una comparación entre mesas y barrios (agregados): no dice cómo votaron las personas en situación de pobreza ni ' +
            'ningún otro grupo, y que dos cosas varíen juntas no indica que una cause la otra. El barrio es la ubicación del local, no ' +
            'necesariamente la residencia de sus electores. El cargo se elige arriba, en la barra (Intendencia o Junta Municipal).'));
        lectura.replaceChildren(...partes);
    }

    async function renderGrafico() {
        const Chart = await cargarChart();
        const c = colores();
        const ind = indicador();
        const { mesas, grupos, ganadas, ganadoras } = calculo;
        const series = [...ganadoras, ...(ganadas.get(EMPATE) ? [EMPATE] : [])];
        const colorDe = (j) => (j === EMPATE ? c.suave : listas()[j].color);
        const puntoDe = (j) => (j === EMPATE ? 'triangle' : PUNTO[formaDe(listas()[j])]);
        const etiquetaDe = (j) => (j === EMPATE ? 'Empate' : nombreLista(listas()[j]));
        const eje = (texto, extra = {}) => ({ grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => `${v} %` },
                                               title: { display: true, text: texto, color: c.suave }, ...extra });
        let config;
        if (estado.grafico === 'mesas') {
            lienzo.setAttribute('aria-label', `Dispersión de ${cantidad(mesas.length, 'mesa', 'mesas')}: ${ind.nombre} del barrio frente al porcentaje ` +
                'de la lista ganadora, con el color y la forma de cada lista');
            config = {
                type: 'scatter',
                data: { datasets: series.map((j) => ({
                    label: etiquetaDe(j), sigla: siglaDe(j),
                    data: mesas.filter((m) => m.g === j).map((m) => ({ x: m.x, y: m.y, nombre: m.nombre, barrio: m.barrio })),
                    backgroundColor: conAlfa(colorDe(j), 0.7), borderColor: colorDe(j), borderWidth: 1, pointStyle: puntoDe(j),
                    pointRadius: 4, pointHoverRadius: 7 })) },
                options: {
                    scales: { x: eje(`${ind.nombre} del barrio (%)`, { type: 'linear' }), y: eje('% de la lista ganadora', { suggestedMax: 100 }) },
                    plugins: { tooltip: { callbacks: {
                        label: (item) => `${item.raw.nombre} (${item.raw.barrio}): ${item.dataset.sigla} ${pct.format(item.raw.y)} % · ${ind.nombre} ${formato(item.raw.x)}` } } },
                },
            };
        } else {
            lienzo.setAttribute('aria-label', `Curvas por lista en ${cantidad(grupos.length, 'tramo', 'tramos')} de ${ind.nombre}: porcentaje de las ` +
                'mesas de cada tramo que ganó cada lista');
            config = {
                type: 'line',
                data: { datasets: series.map((j) => ({
                    label: etiquetaDe(j), sigla: siglaDe(j),
                    data: grupos.map((g, i) => ({ x: g.x, y: (100 * (g.ganadas.get(j) ?? 0)) / g.mesas.length, tramo: i + 1, ganadas: g.ganadas.get(j) ?? 0,
                                                  n: g.mesas.length, desde: g.desde, hasta: g.hasta })),
                    borderColor: colorDe(j), backgroundColor: colorDe(j), pointStyle: puntoDe(j), pointRadius: 5, pointHoverRadius: 8,
                    borderWidth: 2, borderDash: j === EMPATE ? [4, 4] : [] })) },
                options: {
                    scales: { x: eje(`${ind.nombre} medio del tramo (%)`, { type: 'linear' }), y: eje('% de las mesas del tramo', { min: 0, max: 100 }) },
                    plugins: { tooltip: { callbacks: {
                        title: (items) => `Tramo ${items[0].raw.tramo}: ${ind.nombre} ${formato(items[0].raw.desde)} a ${formato(items[0].raw.hasta)}`,
                        label: (item) => `${item.dataset.sigla}: ${fmt.format(item.raw.ganadas)} de ${fmt.format(item.raw.n)} mesas (${pct.format(item.raw.y)} %)` } } },
                },
            };
        }
        config.options = { responsive: true, maintainAspectRatio: false, animation: false, ...config.options };
        config.options.plugins.legend = { display: true, position: 'bottom', labels: { color: c.texto, boxWidth: 12, usePointStyle: true } };
        grafico?.destroy();
        grafico = new Chart(lienzo, { ...config, plugins: [fondo(c)] });
    }

    async function render() {
        for (const b of indicadores.querySelectorAll('[data-indicador]')) b.setAttribute('aria-pressed', String(b.dataset.indicador === estado.indicador));
        for (const b of graficos.querySelectorAll('[data-grafico]')) b.setAttribute('aria-pressed', String(b.dataset.grafico === estado.grafico));
        calculo = calcular();
        renderTabla();
        renderLectura();
        await renderGrafico();
    }

    const nombre = () => nombreArchivo('ganador_pobreza', ctx.nombreCargo(), estado.indicador, estado.grafico, ctx.textoFiltro());
    return {
        titulo: 'Ganador por mesa y pobreza',
        meta: () => `${indicador().nombre} (INE, Censo 2022) y lista ganadora por mesa · ${ctx.nombreCargo()} · ${ctx.textoFiltro()}`,
        render,
        alCambiarTema: () => renderGrafico(),
        csv: () => descargarCsv(nombre(), columnas(), mostradas),
        png: () => descargarPng(lienzo, { nombre: nombre(),
            titulo: estado.grafico === 'mesas' ? `Lista ganadora por mesa e ${enFrase()} del barrio · ${ctx.nombreCargo()} · ${ctx.textoFiltro()}`
                : `Mesas ganadas por cada lista según ${enFrase()} · ${ctx.nombreCargo()} · ${ctx.textoFiltro()}`,
            fuente: `${ctx.textoFuente()} · IPM: INE, Censo 2022` }),
        estadoEnlace: () => ({ ipm: estado.indicador === 'H' ? null : estado.indicador, grafico: estado.grafico === 'mesas' ? null : estado.grafico }),
        aplicarEnlace(p) {
            estado.indicador = INDICADORES.some(([id]) => id === p.get('ipm')) ? p.get('ipm') : 'H';
            elegirGrafico(GRAFICOS.some(([id]) => id === p.get('grafico')) ? p.get('grafico') : 'mesas');
        },
    };
}
