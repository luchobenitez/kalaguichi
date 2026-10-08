// Participación y pobreza, por distrito (ADR-023, tarea M21): un punto por distrito con su participación en la Junta
// Municipal y su pobreza multidimensional (INE, Censo 2022: incidencia, intensidad o IPM, del total del distrito o de su área
// urbana o rural), la recta de tendencia (mínimos cuadrados) y la correlación. Es una comparación entre agregados.
import { cargarChart, colores, fondo, descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { tendencia, fuerza } from './tendencia.js';
import { controlesIpm, valorIpm, sinIpm, indicador, enFrase, formatoIpm, textoArea, textoFuera, ipmDelEnlace, ipmAlEnlace } from './pais_datos.js';
import { IPM_COLOR } from '../tablero/mapa.js';
import { el, pct, pct2, cantidad } from '../tablero/util.js';

export function crear(ctx) {
    const { datos } = ctx;
    const estado = { ipm: 'H', area: 'total', orden: { id: 'ipm', dir: -1 } };
    let grafico = null;
    let puntos = [];
    let todos = [];
    let ajuste = null;
    let mostradas = [];

    const marcar = controlesIpm(ctx.controles, estado, () => {
        render();
        ctx.alCambiar();
    });
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

    const ind = () => indicador(datos, estado.ipm);
    const frase = () => `${enFrase(datos, estado.ipm)}${textoArea(estado.area)}`;
    const formato = (v) => formatoIpm(estado.ipm, v);

    function calcular() {
        todos = ctx.delCargo().distritos.filter(ctx.enFiltro).map((d) => ({
            d, nombre: d.nombre, departamento: d.departamento_nombre, x: valorIpm(datos, d.clave, estado.ipm, estado.area),
            y: d.participacion === null || d.participacion === undefined ? null : 100 * d.participacion, motivo: sinIpm(datos, d.clave, estado.area) }));
        puntos = todos.filter((p) => p.x !== null && p.y !== null);
        ajuste = tendencia(puntos);
    }

    const columnas = () => [
        { id: 'nombre', titulo: 'Distrito', texto: true, v: (p) => p.nombre },
        { id: 'departamento', titulo: 'Departamento', texto: true, v: (p) => p.departamento },
        { id: 'ipm', titulo: `${ind().nombre}${textoArea(estado.area)}`, v: (p) => p.x, f: (v, p) => (v === null ? p.motivo : formato(v)) },
        { id: 'participacion', titulo: 'Participación', v: (p) => p.y, f: (v) => (v === null ? '—' : `${pct.format(v)} %`) },
        { id: 'electores', titulo: 'Electores', v: (p) => p.d.electores.en_mesas_con_acta },
        { id: 'emitidos', titulo: 'Emitidos', v: (p) => p.d.emitidos },
        { id: 'mesas', titulo: 'Mesas con acta', v: (p) => p.d.mesas.con_acta },
    ];
    alOrdenar(tabla, estado, columnas, () => renderTabla());

    function renderTabla() {
        mostradas = renderTablaOrdenable(tabla, columnas(), todos, estado);
        const fuera = todos.length - puntos.length;
        nota.textContent = `${cantidad(todos.length, 'distrito', 'distritos')}` +
            (fuera ? `; ${cantidad(fuera, 'queda', 'quedan')} fuera del gráfico por no tener el dato del INE` : '') +
            `. Participación = emitidos / electores habilitados de las mesas con acta, en ${ctx.nombreCargo()}.`;
    }

    function renderLectura() {
        const partes = [el('p', null, `Cada punto es un distrito: más a la derecha, mayor ${frase()} (${ind().descripcion.replace(/\.$/, '').toLowerCase()}); ` +
            `más arriba, mayor participación en la elección de ${ctx.nombreCargo()}.`)];
        if (ajuste) {
            partes.push(el('p', null, `La línea es la tendencia lineal: ${ajuste.pendiente >= 0 ? 'sube' : 'baja'} ${pct2.format(Math.abs(ajuste.pendiente))} ` +
                `puntos de participación por cada punto de ${enFrase(datos, estado.ipm)}. Correlación r = ${pct2.format(ajuste.r)}: ${fuerza(ajuste.r)}, ` +
                `con ${cantidad(puntos.length, 'distrito', 'distritos')}. Cada distrito pesa lo mismo, tenga muchos o pocos electores.`));
        } else {
            partes.push(el('p', null, 'Con menos de dos distritos con dato no se calcula la tendencia.'));
        }
        const fuera = textoFuera(datos, todos.filter((p) => p.x === null).map((p) => p.d), estado.area);
        if (fuera) partes.push(el('p', null, fuera));
        partes.push(el('p', null, 'Es una comparación entre distritos (agregados): no dice cómo votaron las personas en situación de pobreza ni ningún ' +
            'otro grupo, y una correlación no indica causa. El IPM es del Censo 2022 y los votos, de 2026.'));
        lectura.replaceChildren(...partes);
    }

    async function renderGrafico() {
        const Chart = await cargarChart();
        const c = colores();
        const xs = puntos.map((p) => p.x);
        const recta = ajuste && xs.length ? [Math.min(...xs), Math.max(...xs)].map((x) => ({ x, y: ajuste.ordenada + ajuste.pendiente * x })) : [];
        lienzo.setAttribute('aria-label', `Dispersión de ${cantidad(puntos.length, 'distrito', 'distritos')}: ${ind().nombre}${textoArea(estado.area)} ` +
            `frente a participación${ajuste ? `, correlación ${pct2.format(ajuste.r)}` : ''}`);
        grafico?.destroy();
        grafico = new Chart(lienzo, {
            data: { datasets: [
                { type: 'scatter', label: 'Distritos', data: puntos.map((p) => ({ x: p.x, y: p.y, nombre: p.nombre, departamento: p.departamento })),
                  backgroundColor: IPM_COLOR, borderColor: 'rgba(0, 0, 0, .25)', pointRadius: 4, pointHoverRadius: 7 },
                { type: 'line', label: 'Tendencia', data: recta, borderColor: c.naranja, borderWidth: 2, pointRadius: 0, borderDash: [6, 4] },
            ] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                scales: {
                    x: { type: 'linear', grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => `${v} %` },
                         title: { display: true, text: `${ind().nombre}${textoArea(estado.area)} (%)`, color: c.suave } },
                    y: { grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => `${v} %` }, title: { display: true, text: 'Participación (%)', color: c.suave } },
                },
                plugins: {
                    legend: { display: true, position: 'bottom', labels: { color: c.texto, boxWidth: 12 } },
                    tooltip: { filter: (item) => item.datasetIndex === 0, callbacks: {
                        label: (item) => `${item.raw.nombre} (${item.raw.departamento}): ${ind().nombre} ${formato(item.raw.x)} · participación ${pct.format(item.raw.y)} %` } },
                },
            },
            plugins: [fondo(c)],
        });
    }

    async function render() {
        marcar();
        calcular();
        renderTabla();
        renderLectura();
        await renderGrafico();
    }

    const nombre = () => nombreArchivo('participacion_ipm_distritos', estado.ipm, estado.area === 'total' ? null : estado.area, ctx.textoFiltro());
    return {
        titulo: 'Participación y pobreza',
        meta: () => `${ind().nombre}${textoArea(estado.area)} (INE, Censo 2022) y participación por distrito · ${ctx.nombreCargo()} · ${ctx.textoFiltro()}`,
        render,
        alCambiarTema: () => renderGrafico(),
        csv: () => descargarCsv(nombre(), columnas(), mostradas),
        png: () => descargarPng(lienzo, { nombre: nombre(), titulo: `Participación e ${frase()} por distrito · ${ctx.textoFiltro()}`,
                                          fuente: `${ctx.textoFuente()} · IPM: INE, Censo 2022` }),
        estadoEnlace: () => ipmAlEnlace(estado),
        aplicarEnlace(p) { Object.assign(estado, ipmDelEnlace(p)); },
    };
}
