// «Promedios» (ADR-046, tarea M58): dos gráficos, como el ejemplo del usuario, uno de la Junta Municipal (municipales) y
// otro de Diputados (generales), con todos los años de elección en el eje (los de la otra elección quedan vacíos, para
// leerlos en orden en el tiempo). En cada año, las listas con su color (las que llegan al umbral del padrón en alguna
// elección del lugar; las demás, juntas en «Otras listas»), los votos en blanco, los nulos y quienes no fueron a votar,
// todo sobre el padrón («de cada 100 electores»). La línea punteada de 2019 (Ley 6318: listas cerradas y desbloqueadas,
// desde las municipales de 2021) separa dos promedios de la lista elegida en cada cargo: el de las elecciones con lista
// bloqueada y el de las desbloqueadas, dibujados como una banda sobre el gráfico. Cada lista es un partido con sus
// alianzas (la alianza cuenta para el partido cuyo número de lista lleva; Ganar 2018, con el PLRA). Sirve en un distrito,
// en el país y en el departamento del filtro (suma los distritos). Datos: datos/promedios/promedios.json
// (analisis_resultados/promedios/procesamiento/preparar.py). Sin HTML desde datos.
import { cargarChart, colores, fondo, descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { el, fmt, pct, cantidad } from '../tablero/util.js';

const URL_DATOS = new URL('../../../datos/promedios/promedios.json', import.meta.url);
export const LOCALES = '~locales';
export const DEMAS = '~demas';
export const OTRAS = '~otras';
export const BLANCOS = '~blancos';
export const NULOS = '~nulos';
export const NO_VOTO = '~novoto';
// [clave, nombre, corto, elección]
export const CARGOS = [['junta', 'Junta Municipal', 'Junta', 'Elecciones municipales'], ['diputados', 'Diputados', 'Dip.', 'Elecciones generales']];
export const PERIODOS = ['antes', 'despues'];
// Desde qué porcentaje del padrón (en alguna elección del lugar) una lista tiene su barra; el mínimo es el de los datos.
export const UMBRALES = [1, 2, 5, 10];
export const UMBRAL = 5;
// Las alianzas y los movimientos sin partido de un distrito: un verde para cada uno, como en los mapas del sitio.
export const VERDES = ['#16A34A', '#4ADE80', '#166534', '#86EFAC', '#15803D', '#22C55E'];
const signo = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${pct.format(Math.abs(v))}`;
const conAlfa = (hex, alfa) => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${Math.round(alfa * 255).toString(16).padStart(2, '0')}` : hex);

let enCurso = null;
export function cargarPromedios() {
    enCurso ??= fetch(URL_DATOS, { credentials: 'omit', referrerPolicy: 'no-referrer' }).then((r) => {
        if (!r.ok) throw new Error(`No se pudo leer ${URL_DATOS.pathname}`);
        return r.json();
    });
    return enCurso;
}

// Los años del eje: todos los años con elección (municipal o general), en orden.
export const aniosDe = (datos) => [...new Set(datos.elecciones.map((e) => e.anio))].sort((a, b) => a - b);

const votosDe = (v) => (Array.isArray(v) ? v[0] : v);
const siglasDe = (v) => (Array.isArray(v) && v[1] ? v[1].split('+') : []);

// El lugar: { tipo: 'pais' } | { tipo: 'departamento', codigo } | { tipo: 'distrito', clave }.
// Por elección, la suma de los distritos del lugar: padrón, emitidos, blancos, nulos, votos a listas y, por familia, sus
// votos, los distritos donde fue y las siglas de las listas que no son el partido mismo (con sus distritos). En el país y
// en un departamento, las alianzas y los movimientos sin partido de cada distrito van juntos (LOCALES); en un distrito,
// cada uno con su clave (x1, x2…) y el resto sumado (DEMAS).
export function agregar(datos, lugar) {
    const distritos = lugar.tipo === 'distrito' ? datos.distritos.filter((d) => d.clave === lugar.clave)
        : lugar.tipo === 'departamento' ? datos.distritos.filter((d) => d.departamento === lugar.codigo) : datos.distritos;
    const porEleccion = datos.elecciones.map((e) => ({ eleccion: e, p: 0, v: 0, b: 0, n: 0, vl: 0, distritos: 0, sin: [], familias: new Map() }));
    for (const d of distritos) {
        datos.elecciones.forEach((e, k) => {
            const x = d.e[e.id];
            const a = porEleccion[k];
            if (!x) return;
            if (x.sin) {
                a.sin.push({ clave: d.clave, nombre: d.nombre, motivo: x.sin });
                return;
            }
            a.p += x.p;
            a.v += x.v;
            a.b += x.b;
            a.n += x.n;
            a.distritos += 1;
            for (const [clave, valor] of Object.entries(x.l)) {
                const fid = !clave.startsWith('x') ? clave : lugar.tipo !== 'distrito' ? LOCALES : clave === 'x' ? DEMAS : clave;
                const f = a.familias.get(fid) ?? { votos: 0, distritos: 0, siglas: new Map() };
                const v = votosDe(valor);
                f.votos += v;
                f.distritos += 1;
                for (const s of siglasDe(valor)) f.siglas.set(s, (f.siglas.get(s) ?? 0) + 1);
                a.familias.set(fid, f);
                a.vl += v;
            }
        });
    }
    return { lugar, distritos, porEleccion };
}

// La información de una familia para mostrarla: número, sigla, nombre y color (las propias de un distrito, de «propias»).
export function infoFamilia(datos, fid, distrito = null) {
    const propia = distrito?.propias?.[fid];
    if (propia) {
        const numeros = Object.entries(propia.numeros ?? {});
        const k = Object.keys(distrito.propias).indexOf(fid);
        return { id: fid, numero: numeros.at(-1)?.[1] ?? null, sigla: propia.sigla, nombre: propia.nombre, color: VERDES[k % VERDES.length], propia: true };
    }
    const f = datos.familias[fid] ?? { numero: null, sigla: fid, nombre: fid, color: datos.familias[DEMAS].color };
    return { id: fid, ...f };
}

// Una familia en cada elección, en % del padrón; null si no fue con lista en el lugar (o el lugar no votó).
export function serie(agr, fid) {
    return agr.porEleccion.map((a) => {
        const f = a.familias.get(fid);
        return f && a.p ? (100 * f.votos) / a.p : null;
    });
}

// El promedio simple de los valores de las elecciones de un cargo y un período (las que tienen valor); null si no hay.
export function promedio(datos, valores, cargo, periodo) {
    const vals = datos.elecciones.map((e, k) => (e.cargo === cargo && e.periodo === periodo ? valores[k] : null)).filter((v) => v !== null);
    return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
}

export function promedios(datos, valores) {
    return Object.fromEntries(CARGOS.map(([cargo]) => [cargo, Object.fromEntries(PERIODOS.map((p) => [p, promedio(datos, valores, cargo, p)]))]));
}

const numeroOrden = (f) => (f.numero && /^\d+$/.test(f.numero) ? Number(f.numero) : Infinity);

// Las series de los dos gráficos, en el orden de la leyenda: las listas con barra propia (las que llegan al umbral del
// padrón en alguna elección del lugar), por número de lista; «Otras listas» (todas las demás juntas, con las alianzas y
// los movimientos sin partido del país); los votos en blanco, los nulos y quienes no fueron a votar (el padrón menos los
// votos emitidos). Cada una con sus valores por elección, en % del padrón.
export function series(datos, agr, umbral = UMBRAL) {
    const distrito = agr.lugar.tipo === 'distrito' ? agr.distritos[0] : null;
    const todas = new Set(agr.porEleccion.flatMap((a) => [...a.familias.keys()]));
    const propias = [], resto = [];
    for (const fid of todas) {
        const maximo = Math.max(...serie(agr, fid).map((v) => v ?? 0));
        (fid !== LOCALES && fid !== DEMAS && maximo >= umbral ? propias : resto).push(fid);
    }
    const listas = propias.map((fid) => ({ ...infoFamilia(datos, fid, distrito), tipo: 'lista', valores: serie(agr, fid) }))
        .sort((a, b) => numeroOrden(a) - numeroOrden(b) || a.sigla.localeCompare(b.sigla, 'es'));
    const sobrePadron = (f) => agr.porEleccion.map((a) => (a.p ? (100 * f(a)) / a.p : null));
    const otras = agr.porEleccion.map((a) => {
        const juntas = resto.map((fid) => a.familias.get(fid)).filter(Boolean);
        return a.p && juntas.length ? (100 * juntas.reduce((s, f) => s + f.votos, 0)) / a.p : null;
    });
    return [
        ...listas,
        ...(otras.some((v) => v) ? [{ id: OTRAS, tipo: 'otras', numero: null, sigla: 'Otras listas', nombre: 'Las demás listas, juntas', valores: otras, resto: resto.length }] : []),
        { id: BLANCOS, tipo: 'blancos', numero: null, sigla: 'Votos en blanco', nombre: 'Votos en blanco', valores: sobrePadron((a) => a.b) },
        { id: NULOS, tipo: 'nulos', numero: null, sigla: 'Votos nulos', nombre: 'Votos nulos', valores: sobrePadron((a) => a.n) },
        { id: NO_VOTO, tipo: 'novoto', numero: null, sigla: 'No fue a votar', nombre: 'Electores del padrón que no votaron', valores: sobrePadron((a) => a.p - a.v) },
    ];
}

export const titulo = (s) => (s.tipo === 'lista' && s.numero ? `Lista ${s.numero} · ${s.sigla}` : s.sigla);

// --- La vista -------------------------------------------------------------------------------------------------------

export function crear(ctx) {
    const estado = { lista: null, umbral: UMBRAL, orden: null };
    let datos = null, agr = null, lista = [], anios = [];
    const graficos = new Map();

    const selector = el('select');
    selector.id = 'listaPromedios';
    const campoLista = el('label', 'campo-select', 'Promedio de ');
    campoLista.htmlFor = 'listaPromedios';
    campoLista.append(selector);
    selector.addEventListener('change', () => elegir(selector.value));
    const umbrales = el('select');
    umbrales.id = 'umbralPromedios';
    for (const u of UMBRALES) umbrales.append(new Option(`${fmt.format(u)} % del padrón`, String(u)));
    const campoUmbral = el('label', 'campo-select', 'Barra propia desde ');
    campoUmbral.htmlFor = 'umbralPromedios';
    campoUmbral.append(umbrales);
    umbrales.addEventListener('change', () => {
        estado.umbral = Number(umbrales.value);
        render();
        ctx.alCambiar();
    });
    ctx.controles.append(campoLista, campoUmbral);

    const cabecera = el('div', 'promedios__cabecera');
    const subtitulo = el('p', 'promedios__subtitulo');
    const leyenda = el('ul', 'promedios__leyenda');
    leyenda.setAttribute('aria-label', 'Listas: tocá una para ver su promedio');
    leyenda.addEventListener('click', (evento) => {
        const b = evento.target.closest('[data-serie]');
        if (b) elegir(b.dataset.serie);
    });
    cabecera.append(subtitulo, leyenda);
    const vacio = el('p', 'analisis__vacio', 'No hay datos de este lugar.');
    vacio.hidden = true;
    const tarjetas = {};
    const cuerpo = el('div', 'promedios__graficos');
    for (const [cargo, nombre, , eleccion] of CARGOS) {
        const art = el('article', 'promedios__cargo');
        art.dataset.cargo = cargo;
        const h = el('h3', 'promedios__cargo-titulo', `${eleccion} — ${nombre}`);
        const prom = el('p', 'promedios__promedio');
        const desplazable = el('div', 'promedios__desplazable tabla-scroll');
        desplazable.tabIndex = 0;
        desplazable.setAttribute('aria-label', `Gráfico de ${nombre}: se desplaza a lo ancho`);
        const caja = el('div', 'promedios__lienzo');
        const canvas = el('canvas');
        canvas.setAttribute('role', 'img');
        caja.append(canvas);
        desplazable.append(caja);
        art.append(h, prom, desplazable);
        cuerpo.append(art);
        tarjetas[cargo] = { art, prom, canvas };
    }
    ctx.cuerpo.append(cabecera, vacio, cuerpo);
    const tabla = el('table', 'tabla');
    const desplazableTabla = el('div', 'tabla-scroll');
    desplazableTabla.append(tabla);
    const nota = el('p', 'nota');
    ctx.tabla.append(desplazableTabla, nota);
    const lectura = el('div');
    ctx.lectura.append(lectura);

    function elegir(id) {
        if (!lista.some((s) => s.id === id) || id === estado.lista) return;
        estado.lista = id;
        render();
        ctx.alCambiar();
    }

    // El lugar de la barra: un distrito, o el país con el departamento del filtro.
    function lugar() {
        if (!ctx.datos.pais) return { tipo: 'distrito', clave: ctx.datos.lugar.clave, nombre: ctx.lugar() };
        const f = ctx.filtro();
        if (f?.startsWith('d')) {
            const codigo = Number(f.slice(1));
            return { tipo: 'departamento', codigo, nombre: datos?.departamentos.find((d) => d.codigo === codigo)?.nombre ?? ctx.textoFiltro() };
        }
        return { tipo: 'pais', nombre: 'Paraguay' };
    }
    const elegida = () => lista.find((s) => s.id === estado.lista) ?? null;
    const fuente = () => {
        const trep = datos.elecciones.find((e) => e.fuente === 'trep');
        const corte = trep?.corte ? `, corte ${trep.corte.slice(8, 10)}/${trep.corte.slice(5, 7)}/${trep.corte.slice(0, 4)} ${trep.corte.slice(11, 16)}` : '';
        return `TSJE · cómputo oficial ${datos.elecciones[0].anio}-${datos.elecciones.filter((e) => e.fuente === 'oficial').at(-1).anio}` +
            (trep ? ` y ${trep.nombre_fuente} ${trep.anio}${corte}` : '');
    };

    // Los colores del tema: los de las listas vienen en los datos; blancos, nulos, no votantes y otras, de analisis.css.
    function paleta() {
        const css = getComputedStyle(document.documentElement);
        const leer = (nombre, defecto) => css.getPropertyValue(nombre).trim() || defecto;
        return { ...colores(), rojo: leer('--promedios-ley', '#b91c1c'), tenue: leer('--promedios-tenue', '#cbd5e1'),
                 [OTRAS]: leer('--promedios-otras', '#3e9b5a'), [BLANCOS]: leer('--promedios-blancos', '#8f8f8f'),
                 [NULOS]: leer('--promedios-nulos', '#c8c8c8'), [NO_VOTO]: leer('--promedios-novoto', '#3a3a36') };
    }
    const colorDe = (s, c) => c[s.id] ?? s.color;
    // «Otras listas» se pinta rayada: es un grupo, no una lista, y no se confunde con las alianzas (verdes).
    function rayas(color) {
        const t = el('canvas');
        t.width = t.height = 8;
        const g = t.getContext('2d');
        g.fillStyle = conAlfa(color, 0.3);
        g.fillRect(0, 0, 8, 8);
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        for (const [a, b, d, e] of [[0, 8, 8, 0], [-2, 2, 2, -2], [6, 10, 10, 6]]) {
            g.moveTo(a, b);
            g.lineTo(d, e);
        }
        g.stroke();
        return g.createPattern(t, 'repeat');
    }
    const rellenoDe = (s, c) => (s.id === OTRAS ? rayas(colorDe(s, c)) : colorDe(s, c));

    // «Promedio · ANR: 22,6 con lista bloqueada → 28,4 con lista desbloqueada» (— sin elecciones en el período).
    function textoPromedio(s, cargo) {
        if (!s) return '';
        const p = promedios(datos, s.valores)[cargo];
        if (p.antes === null && p.despues === null) return `Promedio · ${titulo(s)}: sin datos en esta elección`;
        const v = (x) => (x === null ? '—' : pct.format(x));
        return `Promedio · ${titulo(s)}: ${v(p.antes)} con lista bloqueada → ${v(p.despues)} con lista desbloqueada`;
    }

    // El plugin de cada gráfico: la banda del promedio de la lista elegida (detrás de las barras), la línea punteada de la
    // ley, los valores sobre las barras (todos si entran; si no, los de la lista elegida y los de quienes no votaron) y,
    // en un distrito creado después de 2001, el aviso en los años sin datos.
    const PLUGIN = {
        id: 'promediosKg',
        beforeDatasetsDraw(chart, _args, op) {
            const { ctx: g, chartArea: area, scales: { x, y } } = chart;
            const mitad = (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2;
            const xl = posicionLey(x, op);
            g.save();
            for (const periodo of PERIODOS) {
                const v = op.promedio[periodo];
                if (v === null || v === undefined) continue;
                const desde = periodo === 'antes' ? x.getPixelForValue(op.primera) - mitad : xl;
                const hasta = periodo === 'antes' ? xl : area.right;
                if (hasta <= desde) continue;
                const yv = y.getPixelForValue(v);
                g.fillStyle = conAlfa(op.color, 0.13);
                g.fillRect(desde, yv, hasta - desde, area.bottom - yv);
                g.strokeStyle = op.color;
                g.lineWidth = 2;
                g.beginPath();
                g.moveTo(desde, yv);
                g.lineTo(hasta, yv);
                g.stroke();
            }
            g.restore();
        },
        afterDatasetsDraw(chart, _args, op) {
            const { ctx: g, chartArea: area, scales: { x, y } } = chart;
            const c = op.colores;
            const angosto = area.right - area.left < 520;
            const mitad = (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2;
            g.save();
            leyDibujada(chart, op, c, angosto);
            // Los valores: con halo del fondo para que se lean sobre la banda y sobre la línea de la ley.
            let ancho = Infinity;
            chart.data.datasets.forEach((_, i) => {
                for (const b of chart.getDatasetMeta(i).data) if (Number.isFinite(b.width) && b.width > 0) ancho = Math.min(ancho, b.width);
            });
            const todos = ancho >= 18;
            g.textAlign = 'center';
            g.textBaseline = 'bottom';
            g.lineJoin = 'round';
            chart.data.datasets.forEach((dataset, i) => {
                const id = op.ids[i];
                if (!todos && id !== op.elegida && id !== NO_VOTO) return;
                chart.getDatasetMeta(i).data.forEach((barra, j) => {
                    const v = dataset.data[j];
                    if (v === null || v === undefined) return;
                    const texto = pct.format(v);
                    g.font = `${id === op.elegida ? 700 : 600} ${angosto ? 9 : 10.5}px system-ui, sans-serif`;
                    g.strokeStyle = c.fondo;
                    g.lineWidth = 3;
                    g.strokeText(texto, barra.x, barra.y - 3);
                    g.fillStyle = c.texto;
                    g.fillText(texto, barra.x, barra.y - 3);
                });
            });
            // El aviso de un distrito creado después: en el medio de los años sin datos del principio.
            if (op.aviso) {
                const izq = x.getPixelForValue(0) - mitad, der = x.getPixelForValue(op.aviso.hasta) + mitad;
                g.fillStyle = c.suave;
                g.font = `italic ${angosto ? 10 : 12}px system-ui, sans-serif`;
                g.textAlign = 'center';
                g.textBaseline = 'middle';
                g.fillText(op.aviso.texto, (izq + der) / 2, (area.top + area.bottom) / 2, der - izq - 8);
            }
            g.restore();
        },
    };
    // La ley: línea punteada en 2019, entre las elecciones de 2018 y 2021, con su rótulo arriba a la derecha (en una línea
    // si entra; si no, en dos y, si tampoco, el corto).
    function leyDibujada(chart, op, c, angosto) {
        const { ctx: g, chartArea: area, scales: { x } } = chart;
        const xl = posicionLey(x, op);
        g.save();
        g.strokeStyle = c.rojo;
        g.lineWidth = 1.75;
        g.setLineDash([7, 5]);
        g.beginPath();
        g.moveTo(xl, area.top);
        g.lineTo(xl, area.bottom);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = c.rojo;
        g.font = `700 ${angosto ? 10 : 12}px system-ui, sans-serif`;
        g.textAlign = 'left';
        g.textBaseline = 'top';
        const lugar = area.right - xl - 8;
        const largo = `${op.ley.anio}: Ley ${op.ley.numero}, listas desbloqueadas →`;
        const partes = [`${op.ley.anio}: Ley ${op.ley.numero}`, 'listas desbloqueadas →'];
        const lineas = g.measureText(largo).width <= lugar ? [largo]
            : Math.max(...partes.map((t) => g.measureText(t).width)) <= lugar ? partes : [`${op.ley.anio}: desbloqueo →`];
        lineas.forEach((linea, k) => g.fillText(linea, xl + 5, area.top + 2 + k * (angosto ? 12 : 15)));
        g.restore();
    }
    // La ley: entre la columna de la última elección antes de su año (2018) y la de la primera después (2021), en el borde
    // de las dos, para no cruzar sus barras (como en el ejemplo).
    function posicionLey(x, op) {
        const antes = op.anios.filter((a) => a < op.ley.anio).length - 1;
        if (antes < 0 || antes + 1 >= op.anios.length) return x.getPixelForValue(Math.max(0, antes));
        return (x.getPixelForValue(antes) + x.getPixelForValue(antes + 1)) / 2;
    }

    async function renderGrafico(cargo, nombre) {
        const Chart = await cargarChart();
        const c = paleta();
        const { canvas } = tarjetas[cargo];
        const indice = anios.map((anio) => datos.elecciones.findIndex((e) => e.anio === anio && e.cargo === cargo));
        // El lugar tiene datos de ese año (en un distrito creado después, no antes de su primera elección).
        const conDatos = indice.map((k) => k >= 0 && agr.porEleccion[k].p > 0);
        const primera = Math.max(0, conDatos.indexOf(true));
        const s = elegida();
        const creado = agr.lugar.tipo === 'distrito' ? agr.distritos[0]?.creado : null;
        const vacios = indice.findIndex((k, i) => k >= 0 && conDatos[i]);
        const aviso = creado && vacios > 0
            ? { hasta: vacios - 1, texto: `${agr.distritos[0].nombre} se creó en ${creado.fecha.slice(0, 4)}` +
                (creado.nombre_principal ? `: antes votaba en ${creado.nombre_principal}` : '') }
            : null;
        const opciones = { colores: c, anios, ley: datos.ley, primera, aviso, ids: lista.map((x) => x.id), elegida: s?.id,
                           color: s ? colorDe(s, c) : c.texto, promedio: s ? promedios(datos, s.valores)[cargo] : {} };
        const maximo = Math.max(...lista.flatMap((x) => indice.map((k) => (k >= 0 ? x.valores[k] ?? 0 : 0))));
        const config = {
            type: 'bar',
            data: {
                labels: anios.map(String),
                datasets: lista.map((x) => ({
                    label: x.sigla, data: indice.map((k) => (k >= 0 ? x.valores[k] : null)), skipNull: true,
                    backgroundColor: rellenoDe(x, c), borderColor: c.texto, borderWidth: x.id === s?.id ? 1.5 : 0,
                    barPercentage: 0.94, categoryPercentage: 0.9,
                })),
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                layout: { padding: { top: 18, right: 14 } },
                interaction: { mode: 'index', intersect: false },
                // Tocar una barra elige esa lista para el promedio (la barra misma, no toda la columna del año).
                onClick: (evento, _, grafico) => {
                    const [e] = grafico.getElementsAtEventForMode(evento, 'nearest', { intersect: true }, false);
                    if (e) elegir(lista[e.datasetIndex].id);
                },
                scales: {
                    // Los años sin esta elección, en un gris tenue: el eje sigue el tiempo.
                    x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false, color: (t) => (indice[t.index] >= 0 ? c.texto : c.tenue),
                                                             font: (t) => ({ weight: indice[t.index] >= 0 ? '700' : '400', size: 12 }) } },
                    y: { beginAtZero: true, suggestedMax: Math.max(10, maximo * 1.12), grid: { color: c.borde },
                         ticks: { color: c.suave, callback: (v) => `${fmt.format(v)} %` },
                         title: { display: true, text: '% del padrón', color: c.suave } },
                },
                plugins: {
                    legend: { display: false },
                    promediosKg: opciones,
                    tooltip: {
                        filter: (item) => item.raw !== null && item.raw !== undefined,
                        callbacks: {
                            title: (items) => `${items[0].label} · ${nombre}`,
                            label: (item) => `${lista[item.datasetIndex].sigla}: ${pct.format(item.raw)} %`,
                        },
                    },
                },
            },
            plugins: [fondo(c), PLUGIN],
        };
        const viejo = graficos.get(cargo);
        if (viejo) {
            viejo.data = config.data;
            viejo.options = config.options;
            viejo.update('none');
            return viejo;
        }
        const grafico = new Chart(canvas, config);
        graficos.set(cargo, grafico);
        return grafico;
    }

    function renderLeyenda(c) {
        leyenda.replaceChildren(...lista.map((s) => {
            const li = el('li');
            const b = el('button', 'promedios__muestra');
            b.type = 'button';
            b.dataset.serie = s.id;
            b.setAttribute('aria-pressed', String(s.id === estado.lista));
            b.title = `Ver el promedio de ${titulo(s)}`;
            const marca = el('span', `promedios__marca${s.id === OTRAS ? ' promedios__marca--rayas' : ''}`);
            marca.style.setProperty('--color-serie', colorDe(s, c));
            b.append(marca, el('span', null, titulo(s)));
            li.append(b);
            return li;
        }));
    }

    function renderSelector() {
        const opciones = lista.map((s) => new Option(titulo(s), s.id));
        selector.replaceChildren(...opciones);
        selector.value = estado.lista ?? '';
        umbrales.value = String(estado.umbral);
    }

    const columnas = () => [
        { id: 'lista', titulo: 'Lista', texto: true, v: (s) => titulo(s) },
        { id: 'nombre', titulo: 'Partido o lista', texto: true, v: (s) => s.nombre ?? '' },
        ...datos.elecciones.map((e, k) => ({ id: e.id, titulo: `${e.anio} ${e.cargo === 'junta' ? 'Junta' : 'Dip.'}`, v: (s) => s.valores[k],
                                              f: (v) => (v === null ? '—' : pct.format(v)) })),
        ...CARGOS.flatMap(([cargo, , corto]) => {
            const anios_ = (p) => datos.elecciones.filter((e) => e.cargo === cargo && e.periodo === p).map((e) => e.anio);
            const rango = (p) => (anios_(p).length > 1 ? `${anios_(p)[0]}-${anios_(p).at(-1)}` : String(anios_(p)[0]));
            const prom = (s, p) => promedios(datos, s.valores)[cargo][p];
            return [
                { id: `${cargo}_antes`, titulo: `Promedio ${corto} ${rango('antes')}`, v: (s) => prom(s, 'antes'), f: (v) => (v === null ? '—' : pct.format(v)) },
                { id: `${cargo}_despues`, titulo: `Promedio ${corto} ${rango('despues')}`, v: (s) => prom(s, 'despues'), f: (v) => (v === null ? '—' : pct.format(v)) },
                { id: `${cargo}_cambio`, titulo: `Cambio ${corto} (puntos)`, v: (s) => (prom(s, 'antes') === null || prom(s, 'despues') === null ? null : prom(s, 'despues') - prom(s, 'antes')),
                  f: (v) => (v === null ? '—' : signo(v)), clase: (v) => (v !== null && v < 0 ? 'es-negativa' : null) },
            ];
        }),
    ];
    alOrdenar(tabla, estado, columnas, () => renderTabla());
    let mostradas = [];

    function renderTabla() {
        mostradas = renderTablaOrdenable(tabla, columnas(), lista, estado, { elegida: (s) => s.id === estado.lista });
        const padrones = agr.porEleccion.filter((a) => a.p).map((a) => `${a.eleccion.anio}: ${fmt.format(a.p)}`);
        nota.textContent = `${cantidad(lista.length, 'fila', 'filas')}, en % del padrón. Electores del padrón en ${agr.lugar.nombre}: ${padrones.join(' · ')}.`;
    }

    // Lo que hay que saber del lugar: distritos creados después, los que abarcaban otros, los que no votaron.
    function notasDelLugar() {
        const notas = [];
        if (agr.lugar.tipo === 'distrito') {
            const d = agr.distritos[0];
            const faltan = datos.elecciones.filter((e) => !d.e[e.id]).map((e) => e.anio);
            if (d.creado) {
                notas.push(`${d.nombre} se creó el ${d.creado.fecha.split('-').reverse().join('/')}${d.creado.ley ? ` (Ley ${d.creado.ley})` : ''}` +
                           (faltan.length ? `: en ${faltan.join(', ')} sus electores votaban en ${d.creado.nombre_principal ?? 'el distrito del que se separó'} y aquí no hay barras.` : '.'));
            } else if (faltan.length) {
                notas.push(`Sin datos de ${d.nombre} en ${faltan.join(', ')}.`);
            }
            const abarca = datos.elecciones.filter((e) => d.e[e.id]?.abarca?.length);
            if (abarca.length) {
                const nombres = [...new Set(abarca.flatMap((e) => d.e[e.id].abarca))].map((c) => datos.distritos.find((x) => x.clave === c)?.nombre ?? c);
                notas.push(`Hasta ${abarca.at(-1).anio}, ${d.nombre} incluía distritos creados después (${nombres.join(', ')}): sus barras de esos años cuentan también ` +
                           'a esos electores; el porcentaje sobre el padrón se puede comparar igual.');
            }
            for (const e of datos.elecciones) if (d.e[e.id]?.sin) notas.push(`${e.anio}: ${d.e[e.id].sin}`);
        } else {
            const sin = agr.porEleccion.flatMap((a) => a.sin.map((s) => `${s.nombre} (${a.eleccion.anio})`));
            if (sin.length) notas.push(`No votaron en esa elección (eligieron sus autoridades en elecciones complementarias): ${sin.join(', ')}.`);
        }
        return notas;
    }

    function renderLectura() {
        const trep = datos.elecciones.find((e) => e.fuente === 'trep');
        const junta = datos.elecciones.filter((e) => e.cargo === 'junta'), dip = datos.elecciones.filter((e) => e.cargo === 'diputados');
        const parrafos = [
            `Dos gráficos, como el ejemplo: la Junta Municipal (municipales ${junta.map((e) => e.anio).join(', ')}) y Diputados (generales ` +
            `${dip.map((e) => e.anio).join(', ')}), en ${agr.lugar.nombre}. El eje tiene todos los años con elección, en orden: los de la otra ` +
            'elección quedan vacíos (en 2018 no hubo municipales; en 2021, generales).',
            'En cada año, de cada 100 electores del padrón: cuántos votaron a cada lista, en blanco o nulo, y cuántos no fueron a votar (el padrón ' +
            `menos los votos emitidos). Cada lista es un partido con sus alianzas (una alianza cuenta para el partido cuyo número de lista lleva; la ` +
            `Alianza Ganar de 2018 va con el PLRA). Tienen barra propia las que llegaron al ${fmt.format(estado.umbral)} % del padrón en alguna ` +
            'elección (se puede elegir 1, 2, 5 o 10 %); las demás van juntas en «Otras listas»' +
            (agr.lugar.tipo === 'distrito' ? '.' : ', con las alianzas y los movimientos sin partido de cada distrito.'),
            `La línea punteada marca ${datos.ley.anio}, el año de la ${datos.ley.nombre}: ${datos.ley.texto} La banda es el promedio de la lista ` +
            'elegida (en «Promedio de», en la leyenda o tocando una barra) en ese cargo: a la izquierda, el de las elecciones con lista ' +
            'bloqueada; a la derecha, el de las desbloqueadas. Es el promedio simple de los porcentajes de las elecciones en que la lista se ' +
            'presentó; la tabla trae los de todas y el cambio en puntos.',
            `Datos: cómputo oficial del TSJE (${datos.elecciones[0].anio}-${dip.at(-1).anio}, por distrito)` +
            (trep ? ` y el ${trep.nombre_fuente} de ${trep.anio} (${fmt.format(trep.mesas.con_acta)} de ${fmt.format(trep.mesas.esperadas)} mesas: quienes ` +
                    'votaron en las mesas sin acta cuentan como no votantes), hasta que se publique el cómputo oficial' : '') +
            '. Diputados, sin el exterior (allí no se vota a Diputados).' +
            (agr.lugar.tipo === 'distrito' && !ctx.datos.pais ? ' El filtro de zona o barrio no cambia este análisis: el histórico es por distrito.' : ''),
            ...notasDelLugar(),
        ];
        lectura.replaceChildren(...parrafos.map((t) => el('p', null, t)));
    }

    async function render() {
        datos ??= await cargarPromedios();
        const l = lugar();
        agr = agregar(datos, l);
        agr.lugar.nombre = l.nombre;
        anios = aniosDe(datos);
        lista = agr.distritos.length ? series(datos, agr, Math.max(estado.umbral, datos.umbral)) : [];
        if (!lista.some((s) => s.id === estado.lista)) estado.lista = lista.find((s) => s.tipo === 'lista')?.id ?? lista[0]?.id ?? null;
        vacio.hidden = lista.length > 0;
        cuerpo.hidden = lista.length === 0;
        subtitulo.textContent = `De cada 100 electores del padrón de ${l.nombre}, cuántos votaron a cada lista, en blanco o nulo, y cuántos no fueron a votar`;
        const c = paleta();
        renderSelector();
        renderLeyenda(c);
        for (const [cargo, nombre] of CARGOS) {
            const t = tarjetas[cargo];
            const s = elegida();
            t.prom.textContent = textoPromedio(s, cargo);
            t.prom.style.setProperty('--color-serie', s ? colorDe(s, c) : '');
            t.canvas.setAttribute('aria-label', textoAria(cargo, nombre));
            if (lista.length) await renderGrafico(cargo, nombre);
        }
        renderTabla();
        renderLectura();
    }

    function textoAria(cargo, nombre) {
        const s = elegida();
        const partes = datos.elecciones.filter((e) => e.cargo === cargo).map((e) => {
            const k = datos.elecciones.indexOf(e);
            const valores = lista.filter((x) => x.valores[k] !== null).map((x) => `${x.sigla} ${pct.format(x.valores[k])} %`);
            return `${e.anio}: ${valores.join(', ')}`;
        });
        return `${nombre}, de cada 100 electores del padrón. ${partes.join('. ')}. ${s ? textoPromedio(s, cargo) : ''}`;
    }

    // El PNG: los dos gráficos, uno debajo del otro, con su título y el promedio; la leyenda, abajo.
    function png() {
        const c = paleta();
        const lienzos = CARGOS.map(([cargo]) => graficos.get(cargo)?.canvas).filter(Boolean);
        if (lienzos.length !== CARGOS.length) return;
        const escala = lienzos[0].width / (lienzos[0].clientWidth || lienzos[0].width);
        const s = (n) => Math.round(n * escala);
        const ancho = Math.max(...lienzos.map((x) => x.width));
        const altoDe = (x) => s(52) + x.height + s(16);
        const final = el('canvas');
        final.width = ancho;
        final.height = lienzos.reduce((a, x) => a + altoDe(x), 0);
        const g = final.getContext('2d');
        g.fillStyle = c.fondo;
        g.fillRect(0, 0, final.width, final.height);
        let y = 0;
        const elegidaS = elegida();
        CARGOS.forEach(([cargo, nombre, , eleccion], k) => {
            const x = lienzos[k];
            g.fillStyle = c.texto;
            g.font = `700 ${s(15)}px system-ui, sans-serif`;
            g.fillText(`${eleccion} — ${nombre}`, 0, y + s(18));
            g.fillStyle = elegidaS ? colorDe(elegidaS, c) : c.rojo;
            g.font = `600 ${s(11.5)}px system-ui, sans-serif`;
            g.fillText(textoPromedio(elegidaS, cargo), 0, y + s(40));
            g.drawImage(x, 0, y + s(50));
            y += altoDe(x);
        });
        descargarPng(final, { nombre: nombreArchivo('promedios', agr.lugar.nombre, elegidaS?.sigla), escala,
                              titulo: `Las listas antes y después del desbloqueo (${datos.ley.anio}) · ${agr.lugar.nombre} · de cada 100 electores del padrón`,
                              fuente: fuente(), leyenda: lista.map((x) => ({ color: colorDe(x, c), texto: titulo(x) })) });
    }

    return {
        titulo: 'Promedios',
        meta: () => (datos && agr ? `${agr.lugar.nombre} · Junta Municipal ${datos.elecciones.find((e) => e.cargo === 'junta').anio}-${datos.elecciones.filter((e) => e.cargo === 'junta').at(-1).anio}` +
            ` y Diputados ${datos.elecciones.find((e) => e.cargo === 'diputados').anio}-${datos.elecciones.filter((e) => e.cargo === 'diputados').at(-1).anio} · % del padrón` +
            (elegida() ? ` · promedio de ${titulo(elegida())}` : '') : ''),
        render,
        alCambiarTema: () => {
            for (const g of graficos.values()) g.destroy();
            graficos.clear();
            return render();
        },
        csv: () => descargarCsv(nombreArchivo('promedios', agr.lugar.nombre), columnas(), mostradas),
        png,
        estadoEnlace: () => ({ lista: estado.lista, umbral: estado.umbral === UMBRAL ? null : String(estado.umbral) }),
        aplicarEnlace(p) {
            const pedida = p.get('lista');
            estado.lista = pedida && /^[\w~:+-]{1,40}$/.test(pedida) ? pedida : null;
            const u = p.get('umbral');
            estado.umbral = /^\d+$/.test(u ?? '') && UMBRALES.includes(Number(u)) ? Number(u) : UMBRAL;
        },
    };
}
