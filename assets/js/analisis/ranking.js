// Ranking de locales y barrios según el voto de una lista del cargo elegido: el gráfico muestra los 20 primeros (o los
// 20 últimos) por porcentaje de los votos a listas y la tabla, todas las unidades del filtro.
import { cargarChart, colores, fondo, descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { unidades, ganador } from '../tablero/modelo.js';
import { el, fmt, pct, cantidad } from '../tablero/util.js';

const TOPE = 20;
const NOMBRES = { local: ['local', 'locales'], barrio: ['barrio', 'barrios'] };

export function crear(ctx) {
    const { datos } = ctx;
    const estado = { lista: { 1: null, 2: null }, unidad: 'local', sentido: 'desc', orden: null };
    let grafico = null;
    let filas = [];
    let mostradas = [];

    const selector = el('select');
    selector.id = 'listaRanking';
    const etiqueta = el('label', 'campo-select', 'Lista ');
    etiqueta.htmlFor = 'listaRanking';
    etiqueta.append(selector);
    const segmentos = (aria, pares, campo) => {
        const g = el('div', 'segmentos');
        g.setAttribute('role', 'group');
        g.setAttribute('aria-label', aria);
        for (const [valor, texto] of pares) {
            const b = el('button', null, texto);
            b.type = 'button';
            b.dataset[campo] = valor;
            g.append(b);
        }
        return g;
    };
    const unidad = segmentos('Unidad', [['local', 'Locales'], ['barrio', 'Barrios']], 'unidad');
    const sentido = segmentos('Orden', [['desc', 'Mayor %'], ['asc', 'Menor %']], 'sentido');
    ctx.controles.append(etiqueta, unidad, sentido);
    selector.addEventListener('change', () => { estado.lista[ctx.cargo()] = Number(selector.value); estado.orden = null; render(); ctx.alCambiar(); });
    unidad.addEventListener('click', (e) => { const b = e.target.closest('[data-unidad]'); if (b) { estado.unidad = b.dataset.unidad; estado.orden = null; render(); ctx.alCambiar(); } });
    sentido.addEventListener('click', (e) => { const b = e.target.closest('[data-sentido]'); if (b) { estado.sentido = b.dataset.sentido; estado.orden = null; render(); ctx.alCambiar(); } });

    const caja = el('div', 'analisis__lienzo');
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

    const listas = () => datos.listas[ctx.cargo()];
    function elegida() {
        const cargo = ctx.cargo();
        const j = estado.lista[cargo];
        if (j !== null && j < listas().length) return j;
        estado.lista[cargo] = ganador(datos.sumar(datos.filas.map((f) => f.i), cargo).votos) ?? 0;
        return estado.lista[cargo];
    }
    const nombreLista = (item) => (ctx.cargo() === '1' ? `${item.sigla} · ${item.nombre}` : `${item.sigla} · lista ${item.num}`);

    function calcular() {
        const j = elegida();
        const dir = estado.sentido === 'asc' ? 1 : -1;
        filas = unidades(datos, estado.unidad, ctx.cargo(), ctx.enFiltro)
            .map((u) => ({ u, votos: u.total.votos[j], pct: u.total.listas ? (100 * u.total.votos[j]) / u.total.listas : null }))
            .filter((f) => f.pct !== null)
            .sort((a, b) => dir * (a.pct - b.pct) || a.u.nombre.localeCompare(b.u.nombre, 'es'));
        filas.forEach((f, k) => { f.puesto = k + 1; });
    }

    const columnas = () => [
        { id: 'nombre', titulo: estado.unidad === 'local' ? 'Local' : 'Barrio', texto: true, v: (f) => f.u.nombre },
        { id: 'puesto', titulo: 'Puesto', v: (f) => f.puesto },
        ...(estado.unidad === 'local' ? [{ id: 'barrio', titulo: 'Barrio', texto: true, v: (f) => f.u.barrio ?? '' }] : []),
        { id: 'pct', titulo: `% de ${listas()[elegida()].sigla}`, v: (f) => f.pct, f: (v) => `${pct.format(v)} %` },
        { id: 'votos', titulo: `Votos de ${listas()[elegida()].sigla}`, v: (f) => f.votos },
        { id: 'listas', titulo: 'Votos a listas', v: (f) => f.u.total.listas },
        { id: 'emitidos', titulo: 'Emitidos', v: (f) => f.u.total.emitidos },
    ];
    alOrdenar(tabla, estado, columnas, () => renderTabla());

    function renderTabla() {
        mostradas = renderTablaOrdenable(tabla, columnas(), filas, estado);
        const [singular, plural] = NOMBRES[estado.unidad];
        nota.textContent = `${cantidad(filas.length, singular, plural)} ordenados por el porcentaje de ${listas()[elegida()].sigla} sobre sus votos a listas.`;
    }

    function renderLectura() {
        const item = listas()[elegida()];
        const [, plural] = NOMBRES[estado.unidad];
        const valores = filas.map((f) => f.pct);
        const partes = [el('p', null, `Cada barra es el porcentaje de ${nombreLista(item)} sobre los votos a listas de ${ctx.nombreCargo()} en cada uno ` +
            `de los ${TOPE} ${plural} con ${estado.sentido === 'asc' ? 'menor' : 'mayor'} porcentaje. La tabla tiene todos los ${plural} del filtro.`)];
        if (valores.length) {
            const max = Math.max(...valores), min = Math.min(...valores);
            partes.push(el('p', null, `Va de ${pct.format(min)} % a ${pct.format(max)} % entre ${cantidad(valores.length, NOMBRES[estado.unidad][0], plural)}: ` +
                `una diferencia de ${pct.format(max - min)} puntos.`));
        }
        partes.push(el('p', null, 'Un porcentaje alto en un local con pocas mesas pesa menos que en uno grande: mirá también los votos. ' +
            'El barrio es la ubicación del local, no la residencia de sus electores.'));
        lectura.replaceChildren(...partes);
    }

    async function renderGrafico() {
        const Chart = await cargarChart();
        const c = colores();
        const item = listas()[elegida()];
        const tope = filas.slice(0, TOPE);
        caja.style.height = `${Math.max(240, tope.length * 26 + 70)}px`;
        lienzo.setAttribute('aria-label', `Barras de ${tope.length} ${NOMBRES[estado.unidad][1]} por porcentaje de ${item.sigla}`);
        if (grafico) grafico.destroy();
        grafico = new Chart(lienzo, {
            type: 'bar',
            data: { labels: tope.map((f) => f.u.nombre), datasets: [{ label: `% de ${item.sigla}`, data: tope.map((f) => f.pct), backgroundColor: item.color, borderWidth: 0 }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
                layout: { padding: { right: 48 } },
                scales: {
                    x: { beginAtZero: true, grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => `${v} %` } },
                    y: { grid: { display: false }, ticks: { color: c.texto, autoSkip: false, font: { size: 10 },
                                                          callback: (_, k) => (tope[k].u.nombre.length > 34 ? `${tope[k].u.nombre.slice(0, 33)}…` : tope[k].u.nombre) } },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (it) => `${pct.format(tope[it.dataIndex].pct)} % · ${fmt.format(tope[it.dataIndex].votos)} de ${fmt.format(tope[it.dataIndex].u.total.listas)} votos a listas` } },
                },
            },
            plugins: [fondo(c), { id: 'rotulosRanking', afterDatasetsDraw(chart) {
                const { ctx: g } = chart;
                g.save();
                g.font = '600 10px system-ui, sans-serif';
                g.fillStyle = c.texto;
                g.textBaseline = 'middle';
                chart.getDatasetMeta(0).data.forEach((barra, k) => g.fillText(`${pct.format(tope[k].pct)} %`, barra.x + 4, barra.y));
                g.restore();
            } }],
        });
    }

    async function render() {
        const cargo = ctx.cargo();
        if (selector.dataset.cargo !== cargo) {
            selector.replaceChildren(...listas().map((item, j) => new Option(nombreLista(item), String(j))));
            selector.dataset.cargo = cargo;
        }
        selector.value = String(elegida());
        for (const b of unidad.querySelectorAll('[data-unidad]')) b.setAttribute('aria-pressed', String(b.dataset.unidad === estado.unidad));
        for (const b of sentido.querySelectorAll('[data-sentido]')) b.setAttribute('aria-pressed', String(b.dataset.sentido === estado.sentido));
        calcular();
        renderTabla();
        renderLectura();
        await renderGrafico();
    }

    return {
        titulo: 'Ranking por lista',
        meta: () => `${nombreLista(listas()[elegida()])} · ${ctx.nombreCargo()} · por ${NOMBRES[estado.unidad][0]} · ${ctx.textoFiltro()}`,
        render,
        alCambiarTema: () => renderGrafico(),
        csv: () => descargarCsv(nombreArchivo('ranking', listas()[elegida()].sigla, estado.unidad, ctx.textoFiltro()), columnas(), mostradas),
        png: () => descargarPng(lienzo, { nombre: nombreArchivo('ranking', listas()[elegida()].sigla, estado.unidad, ctx.textoFiltro()),
            titulo: `${estado.sentido === 'asc' ? 'Menor' : 'Mayor'} % de ${listas()[elegida()].sigla} por ${NOMBRES[estado.unidad][0]} · ${ctx.textoFiltro()}`,
            fuente: ctx.textoFuente() }),
        estadoEnlace: () => ({ lista: listas()[elegida()].num, unidad: estado.unidad === 'local' ? null : estado.unidad, orden: estado.sentido === 'desc' ? null : 'asc' }),
        aplicarEnlace(p) {
            const j = listas().findIndex((x) => x.num === p.get('lista'));
            if (j >= 0) estado.lista[ctx.cargo()] = j;
            estado.unidad = Object.hasOwn(NOMBRES, p.get('unidad') ?? '') ? p.get('unidad') : 'local';
            estado.sentido = p.get('orden') === 'asc' ? 'asc' : 'desc';
        },
    };
}
