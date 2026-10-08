// Votos de un partido y pobreza, por distrito (ADR-023, tarea M21): el porcentaje de un partido sobre los votos a listas de
// la Junta Municipal en cada distrito donde presenta lista propia, frente a la pobreza multidimensional del distrito (INE,
// Censo 2022: incidencia, intensidad o IPM, del total o de su área urbana o rural), con la tendencia y la correlación.
// Donde el partido va dentro de una alianza sus votos son de la alianza: esos distritos no entran. Es una comparación
// entre agregados.
import { cargarChart, colores, fondo, descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { tendencia, fuerza } from './tendencia.js';
import { controlesIpm, valorIpm, sinIpm, indicador, enFrase, formatoIpm, textoArea, textoFuera, ipmDelEnlace, ipmAlEnlace, PUNTO } from './pais_datos.js';
import { el, fmt, pct, pct2, cantidad } from '../tablero/util.js';

const POR_OMISION = 'ANR';

export function crear(ctx) {
    const { datos } = ctx;
    // Partidos con lista propia en algún distrito, de más a menos distritos.
    const partidos = [...datos.partidos.values()].sort((a, b) => b.distritos - a.distritos || a.sigla.localeCompare(b.sigla, 'es'));
    const estado = { partido: datos.partidos.has(POR_OMISION) ? POR_OMISION : partidos[0].sigla, ipm: 'H', area: 'total', orden: { id: 'ipm', dir: -1 } };
    let grafico = null;
    let todos = [];
    let puntos = [];
    let sinLista = [];
    let ajuste = null;
    let mostradas = [];

    const selector = el('select');
    selector.id = 'partidoPais';
    const campo = el('label', 'campo-select', 'Partido ');
    campo.htmlFor = 'partidoPais';
    for (const p of partidos) selector.append(new Option(`${p.sigla} · lista propia en ${cantidad(p.distritos, 'distrito', 'distritos')}`, p.sigla));
    campo.append(selector);
    selector.addEventListener('change', () => {
        estado.partido = selector.value;
        render();
        ctx.alCambiar();
    });
    ctx.controles.append(campo);
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

    const partido = () => datos.partidos.get(estado.partido);
    const ind = () => indicador(datos, estado.ipm);
    const frase = () => `${enFrase(datos, estado.ipm)}${textoArea(estado.area)}`;
    const formato = (v) => formatoIpm(estado.ipm, v);
    // Puesto del partido en el distrito (1: la lista más votada).
    const puesto = (d, sigla) => 1 + Object.values(d.votos).filter((v) => v > d.votos[sigla]).length;

    function calcular() {
        const s = estado.partido;
        const enFiltro = datos.distritos.filter(ctx.enFiltro);
        sinLista = enFiltro.filter((d) => !d.listas[s]);
        todos = enFiltro.filter((d) => d.listas[s] && d.votos_listas).map((d) => ({
            d, nombre: d.nombre, departamento: d.departamento_nombre, x: valorIpm(datos, d.clave, estado.ipm, estado.area),
            y: (100 * d.votos[s]) / d.votos_listas, votos: d.votos[s], puesto: puesto(d, s), motivo: sinIpm(datos, d.clave, estado.area) }));
        puntos = todos.filter((p) => p.x !== null);
        ajuste = tendencia(puntos);
    }

    const columnas = () => [
        { id: 'nombre', titulo: 'Distrito', texto: true, v: (p) => p.nombre },
        { id: 'departamento', titulo: 'Departamento', texto: true, v: (p) => p.departamento },
        { id: 'ipm', titulo: `${ind().nombre}${textoArea(estado.area)}`, v: (p) => p.x, f: (v, p) => (v === null ? p.motivo : formato(v)) },
        { id: 'pct', titulo: `% de ${estado.partido}`, v: (p) => p.y, f: (v) => `${pct.format(v)} %` },
        { id: 'votos', titulo: `Votos de ${estado.partido}`, v: (p) => p.votos },
        { id: 'listas', titulo: 'Votos a listas', v: (p) => p.d.votos_listas },
        { id: 'puesto', titulo: 'Puesto', v: (p) => p.puesto, f: (v) => (v === 1 ? '1.º (la más votada)' : `${fmt.format(v)}.º`) },
    ];
    alOrdenar(tabla, estado, columnas, () => renderTabla());

    function renderTabla() {
        mostradas = renderTablaOrdenable(tabla, columnas(), todos, estado);
        const fuera = todos.length - puntos.length;
        nota.textContent = `${cantidad(todos.length, 'distrito', 'distritos')} con lista propia de ${estado.partido}` +
            (fuera ? `; ${cantidad(fuera, 'queda', 'quedan')} fuera del gráfico por no tener el dato del INE` : '') +
            `. Porcentaje = votos de ${estado.partido} / votos a listas de la Junta Municipal del distrito.`;
    }

    function renderLectura() {
        const p = partido();
        const partes = [el('p', null, `Cada punto es un distrito donde ${p.sigla} (${p.nombre}) presentó lista propia a la Junta Municipal: más a la ` +
            `derecha, mayor ${frase()}; más arriba, mayor porcentaje de ${p.sigla} sobre los votos a listas.`)];
        if (ajuste) {
            partes.push(el('p', null, `La línea es la tendencia lineal: ${ajuste.pendiente >= 0 ? 'sube' : 'baja'} ${pct2.format(Math.abs(ajuste.pendiente))} ` +
                `puntos de ${p.sigla} por cada punto de ${enFrase(datos, estado.ipm)}. Correlación r = ${pct2.format(ajuste.r)}: ${fuerza(ajuste.r)}, ` +
                `con ${cantidad(puntos.length, 'distrito', 'distritos')}. Cada distrito pesa lo mismo, tenga muchos o pocos electores.`));
        } else {
            partes.push(el('p', null, 'Con menos de dos distritos con dato no se calcula la tendencia.'));
        }
        if (sinLista.length) {
            partes.push(el('p', null, `En ${cantidad(sinLista.length, 'distrito', 'distritos')} de la selección ${p.sigla} no presentó lista propia ` +
                '(puede ir dentro de una alianza, con los votos de la alianza): no entran.'));
        }
        const fuera = textoFuera(datos, todos.filter((u) => u.x === null).map((u) => u.d), estado.area);
        if (fuera) partes.push(el('p', null, fuera));
        partes.push(el('p', null, 'Es una comparación entre distritos (agregados): no dice cómo votaron las personas en situación de pobreza ni ningún ' +
            'otro grupo, y una correlación no indica causa. El IPM es del Censo 2022 y los votos, de 2026.'));
        lectura.replaceChildren(...partes);
    }

    async function renderGrafico() {
        const Chart = await cargarChart();
        const c = colores();
        const p = partido();
        const xs = puntos.map((u) => u.x);
        const recta = ajuste && xs.length ? [Math.min(...xs), Math.max(...xs)].map((x) => ({ x, y: ajuste.ordenada + ajuste.pendiente * x })) : [];
        lienzo.setAttribute('aria-label', `Dispersión de ${cantidad(puntos.length, 'distrito', 'distritos')}: ${ind().nombre}${textoArea(estado.area)} ` +
            `frente al porcentaje de ${p.sigla}${ajuste ? `, correlación ${pct2.format(ajuste.r)}` : ''}`);
        grafico?.destroy();
        grafico = new Chart(lienzo, {
            data: { datasets: [
                { type: 'scatter', label: `${p.sigla} · ${p.nombre}`, data: puntos.map((u) => ({ x: u.x, y: u.y, nombre: u.nombre, departamento: u.departamento })),
                  backgroundColor: p.color, borderColor: 'rgba(0, 0, 0, .25)', pointStyle: PUNTO[p.forma] ?? 'circle', pointRadius: 4, pointHoverRadius: 7 },
                { type: 'line', label: 'Tendencia', data: recta, borderColor: c.naranja, borderWidth: 2, pointRadius: 0, borderDash: [6, 4] },
            ] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                scales: {
                    x: { type: 'linear', grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => `${v} %` },
                         title: { display: true, text: `${ind().nombre}${textoArea(estado.area)} (%)`, color: c.suave } },
                    y: { grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => `${v} %` }, suggestedMin: 0,
                         title: { display: true, text: `% de ${p.sigla} (votos a listas)`, color: c.suave } },
                },
                plugins: {
                    legend: { display: true, position: 'bottom', labels: { color: c.texto, boxWidth: 12, usePointStyle: true } },
                    tooltip: { filter: (item) => item.datasetIndex === 0, callbacks: {
                        label: (item) => `${item.raw.nombre} (${item.raw.departamento}): ${p.sigla} ${pct.format(item.raw.y)} % · ${ind().nombre} ${formato(item.raw.x)}` } },
                },
            },
            plugins: [fondo(c)],
        });
    }

    async function render() {
        selector.value = estado.partido;
        marcar();
        calcular();
        renderTabla();
        renderLectura();
        await renderGrafico();
    }

    const nombre = () => nombreArchivo('partido_pobreza_distritos', estado.partido, estado.ipm, estado.area === 'total' ? null : estado.area, ctx.textoFiltro());
    return {
        titulo: 'Votos de un partido y pobreza',
        meta: () => `${estado.partido} y ${ind().nombre}${textoArea(estado.area)} (INE, Censo 2022) por distrito · ${ctx.nombreCargo()} · ${ctx.textoFiltro()}`,
        render,
        alCambiarTema: () => renderGrafico(),
        csv: () => descargarCsv(nombre(), columnas(), mostradas),
        png: () => descargarPng(lienzo, { nombre: nombre(), titulo: `Votos de ${estado.partido} e ${frase()} por distrito · ${ctx.textoFiltro()}`,
                                          fuente: `${ctx.textoFuente()} · IPM: INE, Censo 2022` }),
        estadoEnlace: () => ({ partido: estado.partido === POR_OMISION ? null : estado.partido, ...ipmAlEnlace(estado) }),
        aplicarEnlace(p) {
            Object.assign(estado, ipmDelEnlace(p));
            estado.partido = datos.partidos.has(p.get('partido')) ? p.get('partido') : datos.partidos.has(POR_OMISION) ? POR_OMISION : partidos[0].sigla;
        },
    };
}
