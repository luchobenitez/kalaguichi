// Distribución del margen ANR − AJA (Intendencia) por mesa, local o barrio, en tramos de 5 puntos. El margen se calcula
// con sumas de votos de cada unidad, no con promedios. Tocar una barra deja en la tabla solo las unidades de ese tramo.
import { cargarChart, colores, fondo, descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { MARGEN, unidades, margenDe, ganador } from '../tablero/modelo.js';
import { el, fmt, pct, cantidad } from '../tablero/util.js';

const NOMBRES = { mesa: ['mesa', 'mesas'], local: ['local', 'locales'], barrio: ['barrio', 'barrios'] };
const conAlfa = (hex, alfa) => `${hex}${Math.round(alfa * 255).toString(16).padStart(2, '0')}`;
const signo = (v) => `${v > 0 ? '+' : ''}${pct.format(v)}`;

function rangoBin(b) {
    const desde = b < 20 ? -100 + b * 5 : (b - 20) * 5;
    return `${desde} a ${desde + 5}`;
}

export function crear(ctx) {
    const { datos } = ctx;
    const estado = { unidad: 'mesa', tramo: null, orden: { id: 'margen', dir: 1 } };
    const pos = datos.listas[MARGEN.cargo][datos.indiceMargen.positivo];
    const neg = datos.listas[MARGEN.cargo][datos.indiceMargen.negativo];
    let grafico = null;
    let calculo = null;
    let mostradas = [];

    const unidadesBotones = el('div', 'segmentos');
    unidadesBotones.setAttribute('role', 'group');
    unidadesBotones.setAttribute('aria-label', 'Unidad');
    for (const [id, [singular]] of Object.entries(NOMBRES)) {
        const boton = el('button', null, singular[0].toUpperCase() + singular.slice(1));
        boton.type = 'button';
        boton.dataset.unidad = id;
        unidadesBotones.append(boton);
    }
    unidadesBotones.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-unidad]');
        if (!boton) return;
        estado.unidad = boton.dataset.unidad;
        estado.tramo = null;
        render();
        ctx.alCambiar();
    });
    const quitarTramo = el('button', 'boton-secundario', 'Ver todos los tramos');
    quitarTramo.type = 'button';
    quitarTramo.hidden = true;
    quitarTramo.addEventListener('click', () => { estado.tramo = null; render(); ctx.alCambiar(); });
    ctx.controles.append(unidadesBotones, quitarTramo);

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

    function calcular() {
        const lista = unidades(datos, estado.unidad, MARGEN.cargo, ctx.enFiltro);
        const conteo = new Array(40).fill(0);
        const porBin = Array.from({ length: 40 }, () => []);
        let empates = 0, sinVotos = 0, terceros = 0;
        const filas = [];
        for (const u of lista) {
            const m = margenDe(datos, u.total, MARGEN.cargo);
            const fila = { u, m, bin: null };
            filas.push(fila);
            if (m === null) { sinVotos += 1; continue; }
            const g = ganador(u.total.votos);
            if (g !== null && g !== datos.indiceMargen.positivo && g !== datos.indiceMargen.negativo) terceros += 1;
            if (m === 0) { empates += 1; continue; }
            const k = Math.min(20, Math.ceil(Math.abs(m) / 5));
            fila.bin = m > 0 ? 19 + k : 20 - k;
            conteo[fila.bin] += 1;
            porBin[fila.bin].push(fila);
        }
        return { lista, filas, conteo, porBin, empates, sinVotos, terceros };
    }

    const columnas = () => [
        { id: 'nombre', titulo: NOMBRES[estado.unidad][0][0].toUpperCase() + NOMBRES[estado.unidad][0].slice(1), texto: true, v: (f) => f.u.nombre },
        ...(estado.unidad === 'barrio' ? [] : [{ id: 'barrio', titulo: 'Barrio', texto: true, v: (f) => f.u.barrio ?? '' }]),
        { id: 'margen', titulo: 'Margen (puntos)', v: (f) => f.m, f: (v) => (v === null ? '—' : signo(v)), clase: (v) => (v !== null && v < 0 ? 'es-negativa' : null) },
        { id: 'pos', titulo: `${pos.sigla} %`, v: (f) => (f.u.total.listas ? (100 * f.u.total.votos[datos.indiceMargen.positivo]) / f.u.total.listas : null), f: (v) => (v === null ? '—' : `${pct.format(v)} %`) },
        { id: 'neg', titulo: `${neg.sigla} %`, v: (f) => (f.u.total.listas ? (100 * f.u.total.votos[datos.indiceMargen.negativo]) / f.u.total.listas : null), f: (v) => (v === null ? '—' : `${pct.format(v)} %`) },
        { id: 'emitidos', titulo: 'Emitidos', v: (f) => f.u.total.emitidos },
        ...(estado.unidad === 'mesa' ? [] : [{ id: 'mesas', titulo: 'Mesas', v: (f) => f.u.total.mesas }]),
    ];
    alOrdenar(tabla, estado, columnas, () => renderTabla());

    const filasTabla = () => (estado.tramo === null ? calculo.filas : calculo.porBin[estado.tramo]);

    function renderTabla() {
        const filas = renderTablaOrdenable(tabla, columnas(), filasTabla(), estado);
        mostradas = filas;
        const [singular, plural] = NOMBRES[estado.unidad];
        nota.textContent = estado.tramo === null
            ? `${cantidad(filas.length, singular, plural)}. Tocá una barra del gráfico para ver solo las de ese tramo.`
            : `${cantidad(filas.length, singular, plural)} con margen de ${rangoBin(estado.tramo)} puntos (${(estado.tramo < 20 ? neg : pos).sigla} adelante).`;
    }

    function renderLectura() {
        const { filas, empates, sinVotos, terceros } = calculo;
        const [singular, plural] = NOMBRES[estado.unidad];
        const con = filas.filter((f) => f.m !== null);
        const adelante = con.filter((f) => f.m > 0).length, atras = con.filter((f) => f.m < 0).length;
        const orden = con.map((f) => f.m).sort((a, b) => a - b);
        const mediana = orden.length ? (orden.length % 2 ? orden[(orden.length - 1) / 2] : (orden[orden.length / 2 - 1] + orden[orden.length / 2]) / 2) : null;
        lectura.replaceChildren(
            el('p', null, `El margen es la diferencia entre ${pos.sigla} y ${neg.sigla} en puntos de los votos a listas de Intendencia: +10 quiere decir ` +
                `que ${pos.sigla} sacó 10 puntos más que ${neg.sigla}. Se calcula con la suma de votos de cada ${singular}.`),
            el('p', null, `Cada barra cuenta ${plural} cuyo margen cae en un tramo de 5 puntos: a la izquierda (color de ${neg.sigla}), ${neg.sigla} ` +
                `quedó adelante; a la derecha (color de ${pos.sigla}), ${pos.sigla}.`),
            el('p', null, `${cantidad(con.length, singular, plural)} con votos: ${pos.sigla} adelante en ${fmt.format(adelante)}` +
                ` (${con.length ? pct.format((100 * adelante) / con.length) : '0,0'} %), ${neg.sigla} en ${fmt.format(atras)}` +
                (empates ? `, empate exacto en ${fmt.format(empates)}` : '') + (mediana === null ? '.' : `. Mediana: ${signo(mediana)} puntos.`) +
                (sinVotos ? ` ${cantidad(sinVotos, `${singular} sin votos a listas`, `${plural} sin votos a listas`)}.` : '') +
                (terceros ? ` En ${fmt.format(terceros)} la más votada fue otra lista: el margen igual compara solo ${pos.sigla} y ${neg.sigla}.` : '')),
            el('p', null, 'Con pocas mesas por unidad los márgenes extremos son más frecuentes. El barrio es la ubicación del local, no la residencia de sus electores. ' +
                'El cargo de la barra de contexto no cambia este análisis: siempre usa Intendencia.'));
    }

    async function renderGrafico() {
        const Chart = await cargarChart();
        const c = colores();
        const { conteo, lista } = calculo;
        const base = Array.from({ length: 40 }, (_, b) => (b < 20 ? neg.color : pos.color));
        const colorBarra = base.map((col, b) => (estado.tramo === null || estado.tramo === b ? col : conAlfa(col, 0.25)));
        const [, plural] = NOMBRES[estado.unidad];
        lienzo.setAttribute('aria-label', `Histograma del margen por ${NOMBRES[estado.unidad][0]}: ${fmt.format(lista.length)} ${plural}`);
        const datosGrafico = { labels: conteo.map((_, b) => rangoBin(b)), datasets: [{ label: plural, data: conteo, backgroundColor: colorBarra, borderWidth: 0,
                                                                                      barPercentage: 0.96, categoryPercentage: 1 }] };
        if (grafico) {
            grafico.data = datosGrafico;
            grafico.update('none');
            return;
        }
        grafico = new Chart(lienzo, {
            type: 'bar',
            data: datosGrafico,
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                onClick: (_, elementos) => {
                    const b = elementos[0]?.index;
                    if (b === undefined || !calculo.conteo[b]) return;
                    estado.tramo = estado.tramo === b ? null : b;
                    render();
                    ctx.alCambiar();
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: c.suave, autoSkip: true, maxRotation: 0, callback: (_, k) => (k % 4 === 0 ? (k < 20 ? `${-100 + k * 5}` : `+${(k - 20) * 5}`) : '') },
                         title: { display: true, text: `← ${neg.sigla} adelante · margen en puntos · ${pos.sigla} adelante →`, color: c.suave } },
                    y: { beginAtZero: true, grid: { color: c.borde }, ticks: { color: c.suave, precision: 0 }, title: { display: true, text: plural, color: c.suave } },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { title: (items) => `${items[0].label} puntos`, label: (item) => cantidad(item.raw, NOMBRES[estado.unidad][0], NOMBRES[estado.unidad][1]) } },
                },
            },
            plugins: [fondo(c)],
        });
    }

    async function render() {
        calculo = calcular();
        for (const boton of unidadesBotones.querySelectorAll('[data-unidad]')) boton.setAttribute('aria-pressed', String(boton.dataset.unidad === estado.unidad));
        quitarTramo.hidden = estado.tramo === null;
        renderTabla();
        renderLectura();
        await renderGrafico();
    }

    return {
        titulo: 'Distribución del margen',
        meta: () => `${pos.sigla} − ${neg.sigla} · Intendencia · por ${NOMBRES[estado.unidad][0]} · ${ctx.textoFiltro()}`,
        render,
        alCambiarTema: () => { grafico?.destroy(); grafico = null; return renderGrafico(); },
        csv: () => descargarCsv(nombreArchivo('margen', estado.unidad, ctx.textoFiltro(), estado.tramo === null ? null : `tramo ${rangoBin(estado.tramo)}`),
            columnas(), mostradas),
        png: () => descargarPng(lienzo, { nombre: nombreArchivo('margen', estado.unidad, ctx.textoFiltro()),
            titulo: `Distribución del margen ${pos.sigla} − ${neg.sigla} por ${NOMBRES[estado.unidad][0]} · ${ctx.textoFiltro()}`, fuente: ctx.textoFuente() }),
        estadoEnlace: () => ({ unidad: estado.unidad === 'mesa' ? null : estado.unidad, tramo: estado.tramo === null ? null : String(estado.tramo) }),
        aplicarEnlace(p) {
            estado.unidad = Object.hasOwn(NOMBRES, p.get('unidad') ?? '') ? p.get('unidad') : 'mesa';
            const tramo = Number(p.get('tramo'));
            estado.tramo = /^\d+$/.test(p.get('tramo') ?? '') && tramo < 40 ? tramo : null;
        },
    };
}
