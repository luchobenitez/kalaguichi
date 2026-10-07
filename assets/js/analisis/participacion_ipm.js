// Participación frente a la pobreza multidimensional (IPM del INE, Censo 2022), por barrio: un punto por barrio con locales
// de votación, la recta de tendencia (mínimos cuadrados) y la correlación. Es una comparación entre agregados.
import { cargarChart, colores, fondo, descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { participacion, agregadosBarrio } from '../tablero/modelo.js';
import { IPM_COLOR } from '../tablero/mapa.js';
import { el, fmt, pct, pct2, cantidad } from '../tablero/util.js';

const COMPONENTES = [['H', 'Incidencia'], ['A', 'Intensidad'], ['IPM', 'IPM']];

// Recta por mínimos cuadrados y correlación de Pearson.
export function tendencia(puntos) {
    const n = puntos.length;
    if (n < 2) return null;
    const mx = puntos.reduce((a, p) => a + p.x, 0) / n, my = puntos.reduce((a, p) => a + p.y, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of puntos) {
        sxx += (p.x - mx) ** 2;
        syy += (p.y - my) ** 2;
        sxy += (p.x - mx) * (p.y - my);
    }
    if (!sxx || !syy) return null;
    const pendiente = sxy / sxx;
    return { pendiente, ordenada: my - pendiente * mx, r: sxy / Math.sqrt(sxx * syy) };
}

function fuerza(r) {
    const a = Math.abs(r);
    const grado = a < 0.1 ? 'prácticamente nula' : a < 0.3 ? 'débil' : a < 0.5 ? 'moderada' : 'fuerte';
    return a < 0.1 ? grado : `${grado} y ${r < 0 ? 'negativa' : 'positiva'}`;
}

export function crear(ctx) {
    const { datos } = ctx;
    const estado = { ipm: 'H', orden: { id: 'ipm', dir: -1 } };
    let grafico = null;
    let puntos = [];
    let ajuste = null;
    let mostradas = [];

    const botones = el('div', 'segmentos');
    botones.setAttribute('role', 'group');
    botones.setAttribute('aria-label', 'Componente del IPM');
    for (const [id, nombre] of COMPONENTES) {
        const boton = el('button', null, nombre);
        boton.type = 'button';
        boton.dataset.ipm = id;
        botones.append(boton);
    }
    botones.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-ipm]');
        if (!boton) return;
        estado.ipm = boton.dataset.ipm;
        render();
        ctx.alCambiar();
    });
    ctx.controles.append(botones);
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

    const indicador = () => datos.ipm.indicadores.find((x) => x.id === estado.ipm);
    // Nombre del componente dentro de una frase: sin el paréntesis y en minúscula, salvo una sigla («IPM»).
    const enFrase = () => {
        const base = indicador().nombre.replace(/\s*\(.*\)\s*$/, '');
        return base === base.toUpperCase() ? base : base.toLowerCase();
    };
    const formato = (v) => `${(estado.ipm === 'A' ? pct : pct2).format(v)} %`;
    // Sin dato publicado, o intensidad sin personas pobres (H = 0): el barrio no entra.
    const valorIpm = (b) => (!b || b[estado.ipm] === null || b[estado.ipm] === undefined || (estado.ipm === 'A' && b.H === 0) ? null : b[estado.ipm]);

    // Barrios con locales dentro del filtro de zona; con un barrio elegido, todos los barrios y ese resaltado.
    function calcular() {
        const filtro = ctx.filtro();
        const agregados = agregadosBarrio(datos, ctx.cargo());
        const enZona = new Set(datos.filas.filter((f) => filtro.startsWith('b:') || ctx.enFiltro(f)).map((f) => f.barrio));
        const todos = [...agregados].filter(([nombre]) => enZona.has(nombre)).map(([nombre, total]) => {
            const geo = datos.barrioPor.get(nombre);
            const ind = datos.ipmPor.get(geo?.clave);
            const locales = [...datos.infoLocal.values()].filter((x) => x.barrio === nombre).length;
            return { nombre, total, x: valorIpm(ind), y: participacion(total), locales, nota: ind?.nota ?? null };
        });
        puntos = todos.filter((p) => p.x !== null && p.y !== null);
        ajuste = tendencia(puntos);
        return todos;
    }

    const columnas = () => [
        { id: 'nombre', titulo: 'Barrio', texto: true, v: (p) => p.nombre },
        { id: 'ipm', titulo: indicador().nombre, v: (p) => p.x, f: (v) => (v === null ? 'sin dato' : formato(v)) },
        { id: 'participacion', titulo: 'Participación', v: (p) => p.y, f: (v) => (v === null ? '—' : `${pct.format(v)} %`) },
        { id: 'electores', titulo: 'Electores', v: (p) => p.total.electores },
        { id: 'emitidos', titulo: 'Emitidos', v: (p) => p.total.emitidos },
        { id: 'locales', titulo: 'Locales', v: (p) => p.locales },
    ];
    alOrdenar(tabla, estado, columnas, () => renderTabla(ultimos));
    let ultimos = [];
    const elegido = () => (ctx.filtro().startsWith('b:') ? ctx.filtro().slice(2) : null);

    function renderTabla(todos) {
        ultimos = todos;
        mostradas = renderTablaOrdenable(tabla, columnas(), todos, estado, { elegida: (p) => p.nombre === elegido() });
        const fuera = todos.length - puntos.length;
        nota.textContent = `${cantidad(todos.length, 'barrio con locales', 'barrios con locales')}` +
            (fuera ? `; ${cantidad(fuera, 'queda', 'quedan')} fuera del gráfico por no tener dato del IPM` : '') +
            '. Participación = emitidos / electores habilitados de las mesas con acta.';
    }

    function renderLectura() {
        const ind = indicador();
        const partes = [el('p', null, `Cada punto es un barrio con locales de votación: más a la derecha, mayor ${enFrase()} ` +
            `(${ind.descripcion.replace(/\.$/, '')}); más arriba, mayor participación.`)];
        if (ajuste) {
            partes.push(el('p', null, `La línea es la tendencia lineal: ${ajuste.pendiente >= 0 ? 'sube' : 'baja'} ${pct2.format(Math.abs(ajuste.pendiente))} ` +
                `puntos de participación por cada punto de ${enFrase()}. Correlación r = ${pct2.format(ajuste.r)}: ${fuerza(ajuste.r)}, ` +
                `con ${cantidad(puntos.length, 'barrio', 'barrios')}.`));
        } else {
            partes.push(el('p', null, 'Con menos de dos barrios con dato no se calcula la tendencia.'));
        }
        partes.push(el('p', null, 'Es una comparación entre barrios (agregados): no dice cómo votaron las personas en situación de pobreza ni ningún ' +
            'otro grupo, y una correlación no indica causa. El barrio es la ubicación del local, no necesariamente la residencia de sus electores.'));
        lectura.replaceChildren(...partes);
    }

    async function renderGrafico() {
        const Chart = await cargarChart();
        const c = colores();
        const ind = indicador();
        const marcado = elegido();
        const xs = puntos.map((p) => p.x);
        const recta = ajuste && xs.length ? [Math.min(...xs), Math.max(...xs)].map((x) => ({ x, y: ajuste.ordenada + ajuste.pendiente * x })) : [];
        lienzo.setAttribute('aria-label', `Dispersión de ${cantidad(puntos.length, 'barrio', 'barrios')}: ${ind.nombre} frente a participación` +
            (ajuste ? `, correlación ${pct2.format(ajuste.r)}` : ''));
        if (grafico) grafico.destroy();
        grafico = new Chart(lienzo, {
            data: { datasets: [
                { type: 'scatter', label: 'Barrios', data: puntos.map((p) => ({ x: p.x, y: p.y, nombre: p.nombre })),
                  backgroundColor: puntos.map((p) => (p.nombre === marcado ? c.texto : IPM_COLOR)),
                  borderColor: puntos.map((p) => (p.nombre === marcado ? c.texto : 'rgba(0, 0, 0, .25)')),
                  pointRadius: puntos.map((p) => (p.nombre === marcado ? 8 : 5)), pointHoverRadius: 8 },
                { type: 'line', label: 'Tendencia', data: recta, borderColor: c.naranja, borderWidth: 2, pointRadius: 0, borderDash: [6, 4] },
            ] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                scales: {
                    x: { type: 'linear', grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => `${v} %` },
                         title: { display: true, text: `${ind.nombre} (%)`, color: c.suave } },
                    y: { grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => `${v} %` }, title: { display: true, text: 'Participación (%)', color: c.suave } },
                },
                plugins: {
                    legend: { display: true, position: 'bottom', labels: { color: c.texto, boxWidth: 12 } },
                    tooltip: { filter: (item) => item.datasetIndex === 0, callbacks: {
                        label: (item) => `${item.raw.nombre}: ${ind.nombre} ${formato(item.raw.x)} · participación ${pct.format(item.raw.y)} %` } },
                },
            },
            plugins: [fondo(c)],
        });
    }

    async function render() {
        for (const boton of botones.querySelectorAll('[data-ipm]')) boton.setAttribute('aria-pressed', String(boton.dataset.ipm === estado.ipm));
        const todos = calcular();
        renderTabla(todos);
        renderLectura();
        await renderGrafico();
    }

    return {
        titulo: 'Participación y pobreza',
        meta: () => `${indicador().nombre} (INE, Censo 2022) y participación por barrio · ${ctx.nombreCargo()} · ${ctx.textoFiltro()}`,
        render,
        alCambiarTema: () => renderGrafico(),
        csv: () => descargarCsv(nombreArchivo('participacion_ipm', estado.ipm, ctx.textoFiltro()), columnas(), mostradas),
        png: () => descargarPng(lienzo, { nombre: nombreArchivo('participacion_ipm', estado.ipm, ctx.textoFiltro()),
            titulo: `Participación e ${enFrase()} por barrio · ${ctx.textoFiltro()}`, fuente: `${ctx.textoFuente()} · IPM: INE, Censo 2022` }),
        estadoEnlace: () => ({ ipm: estado.ipm === 'H' ? null : estado.ipm }),
        aplicarEnlace(p) { estado.ipm = COMPONENTES.some(([id]) => id === p.get('ipm')) ? p.get('ipm') : 'H'; },
    };
}
