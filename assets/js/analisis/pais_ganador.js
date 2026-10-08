// Ganador y pobreza, por distrito (ADR-023, tarea M21): cada distrito con el color y la forma del partido de su lista más
// votada de la Junta Municipal (las alianzas y los movimientos locales juntos, en verde), frente a su pobreza
// multidimensional (INE, Censo 2022: incidencia, intensidad o IPM, del total del distrito o de su área urbana o rural).
// «Curvas por partido» ordena los distritos por el indicador, los agrupa en tramos con la misma cantidad de distritos y
// muestra qué parte de los distritos de cada tramo ganó cada partido. Es una comparación entre agregados, no de personas.
import { cargarChart, colores, fondo, descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { controlesIpm, segmentos, valorIpm, sinIpm, indicador, enFrase, formatoIpm, textoArea, textoFuera, ipmDelEnlace, ipmAlEnlace, grupoDe,
         tramosDistritos, cantidadTramosPais, PUNTO, LOCALES } from './pais_datos.js';
import { el, fmt, pct, cantidad } from '../tablero/util.js';

const GRAFICOS = [['distritos', 'Cada distrito'], ['curvas', 'Curvas por partido']];
const conAlfa = (color, alfa) => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}${Math.round(alfa * 255).toString(16).padStart(2, '0')}` : color);
// «A, B y C».
const enumerar = (partes) => (partes.length < 2 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`);

export function crear(ctx) {
    const { datos } = ctx;
    const estado = { ipm: 'H', area: 'total', grafico: 'distritos', orden: { id: 'indicador', dir: -1 } };
    let grafico = null;
    let calculo = null;
    let mostradas = [];

    const marcar = controlesIpm(ctx.controles, estado, () => {
        render();
        ctx.alCambiar();
    });
    const graficos = segmentos('Gráfico', GRAFICOS, 'grafico');
    graficos.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-grafico]');
        if (!boton || boton.dataset.grafico === estado.grafico) return;
        elegirGrafico(boton.dataset.grafico);
        render();
        ctx.alCambiar();
    });
    ctx.controles.append(graficos);
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
        estado.orden = id === 'distritos' ? { id: 'indicador', dir: -1 } : { id: 'tramo', dir: 1 };
    }
    const ind = () => indicador(datos, estado.ipm);
    const frase = () => `${enFrase(datos, estado.ipm)}${textoArea(estado.area)}`;
    const formato = (v) => formatoIpm(estado.ipm, v);

    function calcular() {
        const todos = datos.distritos.filter(ctx.enFiltro).map((d) => ({
            d, nombre: d.nombre, departamento: d.departamento_nombre, grupo: grupoDe(datos, d), x: valorIpm(datos, d.clave, estado.ipm, estado.area),
            y: d.pct_ganadora, ventaja: d.segunda ? d.ventaja : null, motivo: sinIpm(datos, d.clave, estado.area) }));
        const conDato = todos.filter((u) => u.x !== null && u.y !== null);
        const grupos = conDato.length ? tramosDistritos(conDato, cantidadTramosPais(conDato.length)) : [];
        const info = new Map();
        const ganadas = new Map();
        for (const u of conDato) {
            info.set(u.grupo.id, u.grupo);
            ganadas.set(u.grupo.id, (ganadas.get(u.grupo.id) ?? 0) + 1);
        }
        for (const g of grupos) {
            g.ganadas = new Map();
            for (const u of g.distritos) g.ganadas.set(u.grupo.id, (g.ganadas.get(u.grupo.id) ?? 0) + 1);
        }
        // Partidos que ganaron algún distrito con dato, de más a menos distritos.
        const ganadores = [...ganadas.keys()].sort((a, b) => ganadas.get(b) - ganadas.get(a) || a.localeCompare(b, 'es'));
        return { todos, conDato, grupos, ganadas, ganadores, info };
    }

    const columnasDistritos = () => [
        { id: 'nombre', titulo: 'Distrito', texto: true, v: (u) => u.nombre },
        { id: 'departamento', titulo: 'Departamento', texto: true, v: (u) => u.departamento },
        { id: 'indicador', titulo: `${ind().nombre}${textoArea(estado.area)}`, v: (u) => u.x, f: (v, u) => (v === null ? u.motivo : formato(v)) },
        { id: 'ganadora', titulo: 'Lista más votada', texto: true, v: (u) => u.d.ganadora },
        { id: 'grupo', titulo: 'Partido o grupo', texto: true, v: (u) => (u.grupo.id === u.d.ganadora ? u.grupo.sigla : u.grupo.nombre) },
        { id: 'pct', titulo: '% de la más votada', v: (u) => u.y, f: (v) => `${pct.format(v)} %` },
        { id: 'ventaja', titulo: 'Ventaja (puntos)', v: (u) => u.ventaja, f: (v) => (v === null ? 'lista única' : pct.format(v)) },
        { id: 'listas', titulo: 'Votos a listas', v: (u) => u.d.votos_listas },
    ];
    const columnasTramos = () => [
        { id: 'tramo', titulo: 'Tramo', v: (g) => g.n },
        { id: 'desde', titulo: `${ind().nombre} desde`, v: (g) => g.desde, f: (v) => formato(v) },
        { id: 'hasta', titulo: `${ind().nombre} hasta`, v: (g) => g.hasta, f: (v) => formato(v) },
        { id: 'medio', titulo: `${ind().nombre} medio`, v: (g) => g.x, f: (v) => formato(v) },
        { id: 'distritos', titulo: 'Distritos', v: (g) => g.distritos.length },
        ...calculo.ganadores.map((id) => ({ id: `g${id}`, titulo: `% ganados por ${calculo.info.get(id).sigla}`,
                                           v: (g) => (100 * (g.ganadas.get(id) ?? 0)) / g.distritos.length, f: (v) => `${pct.format(v)} %` })),
    ];
    const columnas = () => (estado.grafico === 'distritos' ? columnasDistritos() : columnasTramos());
    alOrdenar(tabla, estado, columnas, () => renderTabla());

    function renderTabla() {
        if (estado.grafico === 'distritos') {
            mostradas = renderTablaOrdenable(tabla, columnasDistritos(), calculo.todos, estado);
            const fuera = calculo.todos.length - calculo.conDato.length;
            nota.textContent = `${cantidad(calculo.todos.length, 'distrito', 'distritos')}` +
                (fuera ? `; ${cantidad(fuera, 'queda', 'quedan')} fuera del gráfico por no tener el dato del INE` : '') +
                '. Lista más votada: la de más votos de la Junta Municipal en el distrito; «Locales» reúne a las alianzas y los movimientos locales. ' +
                'Ventaja: puntos de la primera sobre la segunda, sobre los votos a listas.';
        } else {
            mostradas = renderTablaOrdenable(tabla, columnasTramos(), calculo.grupos.map((g, i) => Object.assign(g, { n: i + 1 })), estado);
            nota.textContent = `${cantidad(calculo.grupos.length, 'tramo', 'tramos')} de distritos ordenados por ${frase()}, con la misma cantidad de ` +
                'distritos cada uno (o uno de diferencia). Cada columna de partido: porcentaje de los distritos del tramo que ganó.';
        }
    }

    function renderLectura() {
        const { conDato, grupos, ganadas, ganadores, info, todos } = calculo;
        if (!conDato.length) {
            lectura.replaceChildren(el('p', null, 'En la selección no hay distritos con el dato del INE.'));
            return;
        }
        const partes = [estado.grafico === 'distritos'
            ? el('p', null, `Cada punto es un distrito, con el color y la forma del partido de su lista más votada de la Junta Municipal (las alianzas ` +
                `y los movimientos locales juntos, en verde). Más a la derecha, mayor ${frase()} (${ind().descripcion.replace(/\.$/, '').toLowerCase()}); ` +
                'más arriba, mayor porcentaje de la lista más votada sobre los votos a listas.')
            : el('p', null, `Los distritos se ordenan por ${frase()} y se agrupan en ${cantidad(grupos.length, 'tramo', 'tramos')} con la misma cantidad ` +
                'de distritos. Cada curva muestra qué porcentaje de los distritos de cada tramo ganó ese partido; cada punto va en el valor medio del tramo.')];
        const mostrar = ganadores.slice(0, 4).map((id) => `${id === LOCALES ? 'las alianzas y los movimientos locales ganaron' : `${id} ganó`} ` +
            `${fmt.format(ganadas.get(id))} (${pct.format((100 * ganadas.get(id)) / conDato.length)} %)`);
        if (ganadores.length > 4) mostrar.push(`otros ${fmt.format(ganadores.length - 4)} partidos, el resto`);
        partes.push(el('p', null, `De ${cantidad(conDato.length, 'distrito con dato', 'distritos con dato')}, ${enumerar(mostrar)}.`));
        const fuera = textoFuera(datos, todos.filter((u) => u.x === null).map((u) => u.d), estado.area);
        if (fuera) partes.push(el('p', null, fuera));
        partes.push(el('p', null, 'Es una comparación entre distritos (agregados): no dice cómo votaron las personas en situación de pobreza ni ningún ' +
            'otro grupo, y que dos cosas varíen juntas no indica que una cause la otra. El IPM es del Censo 2022 y los votos, de 2026.'));
        lectura.replaceChildren(...partes);
    }

    async function renderGrafico() {
        const Chart = await cargarChart();
        const c = colores();
        const { conDato, grupos, ganadores, info } = calculo;
        const eje = (texto, extra = {}) => ({ grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => `${v} %` },
                                               title: { display: true, text: texto, color: c.suave }, ...extra });
        const etiqueta = (id) => (id === LOCALES ? info.get(id).nombre : `${id} · ${info.get(id).nombre}`);
        let config;
        if (estado.grafico === 'distritos') {
            lienzo.setAttribute('aria-label', `Dispersión de ${cantidad(conDato.length, 'distrito', 'distritos')}: ${ind().nombre}${textoArea(estado.area)} ` +
                'frente al porcentaje de la lista más votada, con el color y la forma de su partido');
            config = {
                type: 'scatter',
                data: { datasets: ganadores.map((id) => ({
                    label: etiqueta(id), sigla: info.get(id).sigla,
                    data: conDato.filter((u) => u.grupo.id === id).map((u) => ({ x: u.x, y: u.y, nombre: u.nombre, departamento: u.departamento, ganadora: u.d.ganadora })),
                    backgroundColor: conAlfa(info.get(id).color, 0.7), borderColor: info.get(id).color, borderWidth: 1,
                    pointStyle: PUNTO[info.get(id).forma] ?? 'circle', pointRadius: 5, pointHoverRadius: 8 })) },
                options: {
                    scales: { x: eje(`${ind().nombre}${textoArea(estado.area)} (%)`, { type: 'linear' }), y: eje('% de la lista más votada', { suggestedMax: 100 }) },
                    plugins: { tooltip: { callbacks: {
                        label: (item) => `${item.raw.nombre} (${item.raw.departamento}): ${item.raw.ganadora} ${pct.format(item.raw.y)} % · ${ind().nombre} ${formato(item.raw.x)}` } } },
                },
            };
        } else {
            lienzo.setAttribute('aria-label', `Curvas por partido en ${cantidad(grupos.length, 'tramo', 'tramos')} de ${ind().nombre}: porcentaje de los ` +
                'distritos de cada tramo que ganó cada partido');
            config = {
                type: 'line',
                data: { datasets: ganadores.map((id) => ({
                    label: etiqueta(id), sigla: info.get(id).sigla,
                    data: grupos.map((g, i) => ({ x: g.x, y: (100 * (g.ganadas.get(id) ?? 0)) / g.distritos.length, tramo: i + 1, ganadas: g.ganadas.get(id) ?? 0,
                                                  n: g.distritos.length, desde: g.desde, hasta: g.hasta })),
                    borderColor: info.get(id).color, backgroundColor: info.get(id).color, pointStyle: PUNTO[info.get(id).forma] ?? 'circle',
                    pointRadius: 5, pointHoverRadius: 8, borderWidth: 2 })) },
                options: {
                    scales: { x: eje(`${ind().nombre} medio del tramo (%)`, { type: 'linear' }), y: eje('% de los distritos del tramo', { min: 0, max: 100 }) },
                    plugins: { tooltip: { callbacks: {
                        title: (items) => `Tramo ${items[0].raw.tramo}: ${ind().nombre} ${formato(items[0].raw.desde)} a ${formato(items[0].raw.hasta)}`,
                        label: (item) => `${item.dataset.sigla}: ${fmt.format(item.raw.ganadas)} de ${fmt.format(item.raw.n)} distritos (${pct.format(item.raw.y)} %)` } } },
                },
            };
        }
        config.options = { responsive: true, maintainAspectRatio: false, animation: false, ...config.options };
        config.options.plugins.legend = { display: true, position: 'bottom', labels: { color: c.texto, boxWidth: 12, usePointStyle: true } };
        grafico?.destroy();
        grafico = new Chart(lienzo, { ...config, plugins: [fondo(c)] });
    }

    async function render() {
        marcar();
        for (const b of graficos.querySelectorAll('[data-grafico]')) b.setAttribute('aria-pressed', String(b.dataset.grafico === estado.grafico));
        calculo = calcular();
        renderTabla();
        renderLectura();
        await renderGrafico();
    }

    const nombre = () => nombreArchivo('ganador_pobreza_distritos', estado.ipm, estado.area === 'total' ? null : estado.area, estado.grafico, ctx.textoFiltro());
    return {
        titulo: 'Ganador y pobreza',
        meta: () => `${ind().nombre}${textoArea(estado.area)} (INE, Censo 2022) y lista más votada por distrito · ${ctx.nombreCargo()} · ${ctx.textoFiltro()}`,
        render,
        alCambiarTema: () => renderGrafico(),
        csv: () => descargarCsv(nombre(), columnas(), mostradas),
        png: () => descargarPng(lienzo, { nombre: nombre(),
            titulo: estado.grafico === 'distritos' ? `Lista más votada por distrito e ${frase()} · ${ctx.textoFiltro()}`
                : `Distritos ganados por cada partido según ${frase()} · ${ctx.textoFiltro()}`,
            fuente: `${ctx.textoFuente()} · IPM: INE, Censo 2022` }),
        estadoEnlace: () => ({ ...ipmAlEnlace(estado), grafico: estado.grafico === 'distritos' ? null : estado.grafico }),
        aplicarEnlace(p) {
            Object.assign(estado, ipmDelEnlace(p));
            elegirGrafico(GRAFICOS.some(([id]) => id === p.get('grafico')) ? p.get('grafico') : 'distritos');
        },
    };
}
