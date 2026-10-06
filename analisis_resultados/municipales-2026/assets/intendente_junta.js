// Intendente vs Junta por local de votación (ADR 0006 del módulo): voto cruzado entre Intendencia y Junta Municipal.
// Los números salen de datos/mesas.json y datos/locales.json. Los gráficos usan Chart.js autoalojado
// (ADR-015 del proyecto), que se carga solo al abrir esta sección. El texto se asigna con textContent.
const RUTA_CHART = new URL('../../../assets/vendor/chartjs/chart.umd.min.js', import.meta.url).href;
// En los JSON del TREP la candidatura a Intendente de la Alianza es la lista 4 (AJA): es la «Intendente L3» del pedido.
export const GRUPOS = [
    { id: 'L1', nombre: 'Lista 1', intendencia: ['1'], junta: ['1'], rotuloInt: 'Intendente L1', rotuloJun: 'Junta L1' },
    { id: 'AL', nombre: 'Alianza', intendencia: ['4'], junta: ['2', '3'], rotuloInt: 'Intendente L3', rotuloJun: 'Junta L2 + L3' },
];
const TRAMOS = ['−20 % o menos', '−20 % a −10 %', '−10 % a −5 %', '−5 % a +5 %', '+5 % a +10 %', '+10 % a +20 %', '+20 % o más'];
const LINEAS_PCT = [-20, -10, -5, 5, 10, 20];
const ROJO = '#dc2626';
const VERDE = '#16a34a';
const TOP_AGRUPADAS = 20;
const COLUMNAS_CSV = ['local', 'barrio', 'int_L1', 'junta_L1', 'dif_L1', 'dif_L1_%', 'int_L3', 'junta_L2+L3', 'dif_AL', 'dif_AL_%',
    'grupo con mayor negativo', 'zona_tsje', 'zona_municipal', 'codigo_local', 'mesas', 'emitidos', 'tramo_L1', 'tramo_AL',
    'ambos_negativos', 'grupo con mayor negativo (%)'];
const fmt = new Intl.NumberFormat('es-PY');
const pct1 = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const $ = (id) => document.getElementById(id);

function el(tag, clase, texto) {
    const nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto !== undefined && texto !== null) nodo.textContent = String(texto);
    return nodo;
}

// Tramos sobre la diferencia en %: separaciones de 5, 10 y 20 puntos a cada lado de cero (límites hacia cero).
export function tramo(p) {
    if (p === null || p === undefined) return '';
    if (p <= -20) return TRAMOS[0];
    if (p <= -10) return TRAMOS[1];
    if (p <= -5) return TRAMOS[2];
    if (p < 5) return TRAMOS[3];
    if (p < 10) return TRAMOS[4];
    if (p < 20) return TRAMOS[5];
    return TRAMOS[6];
}

const signo = (n) => `${n > 0 ? '+' : ''}${fmt.format(n)}`;
const signoPct = (p) => (p === null ? '—' : `${p > 0 ? '+' : ''}${pct1.format(p)} %`);
const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function grupoMasNegativo(f, campo) {
    const negativos = GRUPOS.filter((g) => f.grupos[g.id][campo] !== null && f.grupos[g.id][campo] < 0);
    if (!negativos.length) return 'Ninguno';
    if (negativos.length === 1) return negativos[0].nombre;
    const peor = negativos.reduce((a, b) => (f.grupos[b.id][campo] < f.grupos[a.id][campo] ? b : a));
    return `Ambos (más negativo: ${peor.nombre})`;
}

// Suma por local de las mesas con acta: votos del Intendente y de la(s) lista(s) de Junta de cada grupo.
export function construirFilas(datos) {
    const c1 = datos.mesas.cargos['1'], c2 = datos.mesas.cargos['2'];
    const indices = (cargo, numeros) => numeros.map((n) => {
        const i = cargo.listas.indexOf(n);
        if (i < 0) throw new Error(`Lista ${n} ausente en los datos`);
        return i;
    });
    const grupos = GRUPOS.map((g) => {
        const ii = indices(c1, g.intendencia), jj = indices(c2, g.junta);
        return { ...g, ii, jj, candidatura: datos.listas['1'][ii[0]], juntas: jj.map((j) => datos.listas['2'][j]) };
    });
    const porLocal = new Map();
    datos.mesas.mesas.forEach(([zona, local], k) => {
        const clave = `${zona}-${local}`;
        let f = porLocal.get(clave);
        if (!f) {
            const info = datos.infoLocal.get(clave);
            f = { clave, zona, local, nombre: info.nombre, barrio: info.barrio ?? '', zonaMunicipal: info.zona_municipal ?? null,
                  mesas: 0, emitidos: 0, grupos: {} };
            for (const g of grupos) f.grupos[g.id] = { int: 0, jun: 0, porLista: g.jj.map(() => 0) };
            porLocal.set(clave, f);
        }
        f.mesas += 1;
        f.emitidos += c1.emitidos[k];
        for (const g of grupos) {
            const r = f.grupos[g.id];
            for (const i of g.ii) r.int += c1.votos[k][i];
            g.jj.forEach((j, n) => {
                r.porLista[n] += c2.votos[k][j];
                r.jun += c2.votos[k][j];
            });
        }
    });
    const filas = [...porLocal.values()];
    for (const f of filas) {
        for (const g of grupos) {
            const r = f.grupos[g.id];
            r.dif = r.int - r.jun;
            r.pct = r.jun ? (100 * r.dif) / r.jun : null;
            r.tramo = tramo(r.pct);
        }
        f.grupoNegativo = grupoMasNegativo(f, 'dif');
        f.grupoNegativoPct = grupoMasNegativo(f, 'pct');
        f.ambosNegativos = grupos.every((g) => f.grupos[g.id].dif < 0);
    }
    return { grupos, filas };
}

function colores() {
    const css = getComputedStyle(document.documentElement);
    const leer = (nombre, defecto) => css.getPropertyValue(nombre).trim() || defecto;
    return { texto: leer('--text', '#0f172a'), suave: leer('--text-muted', '#64748b'), borde: leer('--border', '#e2e8f0'),
             fondo: leer('--surface-solid', '#ffffff') };
}

const conAlfa = (hex, alfa) => `${hex}${Math.round(alfa * 255).toString(16).padStart(2, '0')}`;

function descargar(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const enlace = el('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function crearIntendenteJunta(datos) {
    const modelo = construirFilas(datos);
    const estado = { grupo: 'L1', metrica: 'votos', vista: 'divergentes', filtro: '', busqueda: '', orden: null };
    let graficos = [];
    let turno = 0;
    let preparado = false;

    const grupoPor = (id) => modelo.grupos.find((g) => g.id === id);
    const gruposVista = () => (estado.grupo === 'ambos' ? modelo.grupos : [grupoPor(estado.grupo)]);
    const metrica = (f, g) => (estado.metrica === 'pct' ? f.grupos[g.id].pct : f.grupos[g.id].dif);
    const ascendente = (a, b) => (a === null) - (b === null) || a - b;

    function enFiltro(f) {
        const v = estado.filtro;
        if (!v) return true;
        if (v.startsWith('t')) return String(f.zona) === v.slice(1);
        if (v.startsWith('m')) return String(f.zonaMunicipal) === v.slice(1);
        return f.barrio === v.slice(2);
    }

    const enAmbito = () => modelo.filas.filter(enFiltro);
    const filtradas = () => {
        const buscado = normalizar(estado.busqueda.trim());
        return enAmbito().filter((f) => !buscado || normalizar(f.nombre).includes(buscado));
    };

    // Orden de gráfico y tabla: la diferencia más negativa primero, del grupo elegido o la menor de los dos.
    const clave = (f) => Math.min(...gruposVista().map((g) => metrica(f, g) ?? Infinity));
    const ordenGrafico = (filas) => [...filas].sort((a, b) => ascendente(clave(a), clave(b)));

    function textoAmbito() {
        const opcion = $('filtroIvj').selectedOptions[0];
        return estado.filtro ? opcion.textContent : 'Toda Asunción';
    }

    function preparar() {
        if (preparado) return;
        preparado = true;
        const select = $('filtroIvj');
        const grupo = (etiqueta, opciones) => {
            const og = el('optgroup');
            og.label = etiqueta;
            for (const [valor, texto] of opciones) og.append(new Option(texto, valor));
            select.append(og);
        };
        grupo('Zonas electorales (TSJE)', Object.entries(datos.resumen.zonas).map(([k, n]) => [`t${k}`, `Zona TSJE ${k} · ${n}`]));
        grupo('Zonas municipales (oficiales)', Object.entries(datos.resumen.zonas_municipales).map(([k, n]) => [`m${k}`, `Zona municipal ${k} · ${n}`]));
        grupo('Barrios', [...new Set(modelo.filas.map((f) => f.barrio).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
            .map((b) => [`b:${b}`, b]));
        const segmentos = (atributo, campo) => {
            for (const boton of document.querySelectorAll(`[${atributo}]`)) {
                boton.addEventListener('click', () => {
                    estado[campo] = boton.getAttribute(atributo);
                    estado.orden = null;
                    render();
                });
            }
        };
        segmentos('data-ivj-grupo', 'grupo');
        segmentos('data-ivj-metrica', 'metrica');
        segmentos('data-ivj-vista', 'vista');
        select.addEventListener('change', () => { estado.filtro = select.value; render(); });
        let espera;
        $('buscarIvj').addEventListener('input', (evento) => {
            clearTimeout(espera);
            espera = setTimeout(() => { estado.busqueda = evento.target.value; render(); }, 200);
        });
        $('tablaIvj').addEventListener('click', (evento) => {
            const columna = evento.target.closest('[data-columna]')?.dataset.columna;
            if (!columna) return;
            estado.orden = estado.orden?.id === columna ? { id: columna, dir: -estado.orden.dir } : { id: columna, dir: 1 };
            renderTabla(filtradas());
        });
        $('csvIvj').addEventListener('click', descargarCsv);
        $('pngIvj').addEventListener('click', descargarPng);
        // Al cambiar el tema del sitio, los gráficos se vuelven a dibujar con sus colores.
        new MutationObserver(() => { if (!$('panelIvj').hidden) render(); })
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    function renderTotales(filas) {
        const caja = $('totalesIvj');
        caja.replaceChildren();
        for (const g of modelo.grupos) {
            const int = filas.reduce((a, f) => a + f.grupos[g.id].int, 0);
            const jun = filas.reduce((a, f) => a + f.grupos[g.id].jun, 0);
            const dif = int - jun;
            const negativos = filas.filter((f) => f.grupos[g.id].dif < 0).length;
            const tarjeta = el('div', 'ivj__tarjeta');
            tarjeta.dataset.grupo = g.id;
            const valor = el('strong', `ivj__valor ${dif < 0 ? 'es-negativa' : 'es-positiva'}`, `${signo(dif)} votos`);
            valor.dataset.valor = String(dif);
            tarjeta.append(el('h3', null, `${g.nombre}: ${g.rotuloInt} − ${g.rotuloJun}`), valor,
                el('span', 'ivj__detalle', `${signoPct(jun ? (100 * dif) / jun : null)} sobre la Junta · Intendente ${fmt.format(int)} · Junta ${fmt.format(jun)}`),
                el('span', 'ivj__detalle', `${fmt.format(negativos)} de ${fmt.format(filas.length)} locales con diferencia negativa`));
            caja.append(tarjeta);
        }
        const distrito = el('div', 'ivj__tarjeta');
        distrito.dataset.grupo = 'distrito';
        distrito.append(el('h3', null, textoAmbito()),
            el('strong', 'ivj__valor', `${fmt.format(filas.length)} locales`),
            el('span', 'ivj__detalle', `${fmt.format(filas.reduce((a, f) => a + f.mesas, 0))} mesas con acta · ${fmt.format(filas.reduce((a, f) => a + f.emitidos, 0))} votos emitidos`),
            el('span', 'ivj__detalle', `Locales con los dos grupos negativos: ${fmt.format(filas.filter((f) => f.ambosNegativos).length)}`));
        caja.append(distrito);
    }

    function renderTramos(filas) {
        const tabla = $('tramosIvj');
        tabla.replaceChildren();
        const cabeza = el('tr');
        ['Tramo de la diferencia (%)', ...modelo.grupos.map((g) => `${g.nombre} (locales)`)].forEach((texto, k) => {
            const th = el('th', k ? null : 'tabla__texto', texto);
            th.scope = 'col';
            cabeza.append(th);
        });
        tabla.createTHead().append(cabeza);
        const cuerpo = tabla.createTBody();
        for (const t of TRAMOS) {
            const tr = el('tr');
            const th = el('th', null, t);
            th.scope = 'row';
            tr.append(th, ...modelo.grupos.map((g) => el('td', null, fmt.format(filas.filter((f) => f.grupos[g.id].tramo === t).length))));
            cuerpo.append(tr);
        }
    }

    const COLUMNAS = [
        { id: 'nombre', titulo: 'Local', texto: true, v: (f) => f.nombre },
        { id: 'barrio', titulo: 'Barrio', texto: true, v: (f) => f.barrio },
        ...GRUPOS.flatMap((g) => [
            { id: `int_${g.id}`, titulo: g.id === 'L1' ? 'Int. L1' : 'Int. L3', v: (f) => f.grupos[g.id].int },
            { id: `jun_${g.id}`, titulo: g.id === 'L1' ? 'Junta L1' : 'Junta L2+L3', v: (f) => f.grupos[g.id].jun },
            { id: `dif_${g.id}`, titulo: `Dif. ${g.id}`, v: (f) => f.grupos[g.id].dif, dif: true },
            { id: `pct_${g.id}`, titulo: `Dif. ${g.id} %`, v: (f) => f.grupos[g.id].pct, dif: true, pct: true },
        ]),
        { id: 'grupo', titulo: 'Grupo con mayor negativo', texto: true, v: (f) => f.grupoNegativo },
        ...GRUPOS.map((g) => ({ id: `tramo_${g.id}`, titulo: `Tramo ${g.id}`, texto: true, v: (f) => f.grupos[g.id].tramo })),
    ];

    function ordenadas(filas) {
        if (!estado.orden) return ordenGrafico(filas);
        const col = COLUMNAS.find((c) => c.id === estado.orden.id);
        return [...filas].sort((a, b) => {
            const va = col.v(a), vb = col.v(b);
            return estado.orden.dir * (col.texto ? String(va).localeCompare(String(vb), 'es') : ascendente(va, vb));
        });
    }

    function renderTabla(filas) {
        const tabla = $('tablaIvj');
        const cabeza = el('tr');
        for (const col of COLUMNAS) {
            const th = el('th', col.texto ? 'tabla__texto' : null);
            th.scope = 'col';
            const boton = el('button', 'tabla__orden', col.titulo);
            boton.type = 'button';
            boton.dataset.columna = col.id;
            if (estado.orden?.id === col.id) th.setAttribute('aria-sort', estado.orden.dir > 0 ? 'ascending' : 'descending');
            th.append(boton);
            cabeza.append(th);
        }
        tabla.tHead.replaceChildren(cabeza);
        const fragmento = document.createDocumentFragment();
        for (const f of ordenadas(filas)) {
            const tr = el('tr');
            tr.dataset.local = f.clave;
            for (const col of COLUMNAS) {
                const v = col.v(f);
                const texto = col.pct ? signoPct(v) : col.dif ? signo(v) : typeof v === 'number' ? fmt.format(v) : v;
                const celda = el(col.id === 'nombre' ? 'th' : 'td', [col.texto ? 'tabla__texto' : '', col.dif && v < 0 ? 'es-negativa' : ''].join(' ').trim() || null, texto);
                if (col.id === 'nombre') celda.scope = 'row';
                tr.append(celda);
            }
            fragmento.append(tr);
        }
        tabla.tBodies[0].replaceChildren(fragmento);
        tabla.dataset.filas = String(filas.length);
        $('notaIvj').textContent = `${fmt.format(filas.length)} locales. Diferencias = votos del Intendente − votos de su(s) lista(s) de Junta; ` +
            '% sobre la Junta del grupo. Rojo: diferencia negativa. Tocá un encabezado para ordenar. Es una comparación entre totales de mesa: ' +
            'no identifica cómo votó cada persona.';
    }

    // --- Gráficos (Chart.js) -----------------------------------------------------------------

    async function cargarChart() {
        if (!globalThis.Chart) await import(RUTA_CHART);
        return globalThis.Chart;
    }

    function complementos(c, lineas, rotulo) {
        return [
            { id: 'fondoIvj', beforeDraw(chart) {
                const { ctx, width, height } = chart;
                ctx.save();
                ctx.fillStyle = c.fondo;
                ctx.fillRect(0, 0, width, height);
                ctx.restore();
            } },
            { id: 'lineasIvj', afterDatasetsDraw(chart) {
                const { ctx, chartArea: area, scales: { x } } = chart;
                ctx.save();
                let ultimo = -Infinity;  // Rótulos de tramo sin superponerse: se omite el que cae muy cerca del anterior.
                for (const v of [0, ...lineas]) {
                    if (v < x.min || v > x.max) continue;
                    const px = x.getPixelForValue(v);
                    ctx.strokeStyle = v ? c.suave : c.texto;
                    ctx.lineWidth = v ? 1 : 1.5;
                    ctx.setLineDash(v ? [4, 3] : []);
                    ctx.beginPath();
                    ctx.moveTo(px, area.top);
                    ctx.lineTo(px, area.bottom);
                    ctx.stroke();
                    if (v && Math.abs(px - ultimo) >= 34) {
                        ultimo = px;
                        ctx.fillStyle = c.suave;
                        ctx.font = '600 10px system-ui, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText(`${v > 0 ? '+' : ''}${v} %`, px, area.top - 4);
                    }
                }
                ctx.restore();
            } },
            { id: 'rotulosIvj', afterDatasetsDraw(chart) {
                const { ctx } = chart;
                ctx.save();
                ctx.font = '600 10px system-ui, sans-serif';
                ctx.fillStyle = c.texto;
                ctx.textBaseline = 'middle';
                rotulo(chart, ctx);
                ctx.restore();
            } },
        ];
    }

    const angosto = () => matchMedia('(max-width: 640px)').matches;
    const recortar = (s) => (angosto() && s.length > 24 ? `${s.slice(0, 23)}…` : s);

    const pasoRedondo = (x) => {
        const potencia = 10 ** Math.floor(Math.log10(x || 1));
        const m = x / potencia;
        return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * potencia;
    };

    // Eje con límites redondos, espacio para los rótulos y solo las líneas de tramo del lado donde hay datos.
    function rango(valores, posibles, enPct) {
        const finitos = valores.filter((v) => v !== null);
        const minimo = Math.min(0, ...finitos), maximo = Math.max(0, ...finitos);
        const extension = maximo - minimo || 1;
        const margen = extension * 0.16;
        let min = minimo < 0 ? minimo - margen : 0;
        let max = maximo > 0 ? maximo + margen : 0;
        for (const v of posibles) {
            if (v < 0 && minimo < 0 && v >= minimo - 2 * margen) min = Math.min(min, v - extension * 0.02);
            if (v > 0 && maximo > 0 && v <= maximo + 2 * margen) max = Math.max(max, v + extension * 0.02);
        }
        const paso = enPct ? 5 : pasoRedondo(extension / 6);
        min = Math.floor(min / paso) * paso;
        max = Math.ceil(max / paso) * paso;
        return { min, max, lineas: posibles.filter((v) => (v < 0 ? minimo < 0 : maximo > 0) && v > min && v < max) };
    }

    function divergente(Chart, lienzo, filas, g, c) {
        const valores = filas.map((f) => metrica(f, g));
        const enPct = estado.metrica === 'pct';
        const { min, max, lineas } = rango(valores, enPct ? LINEAS_PCT : [], enPct);
        const formato = (v) => (enPct ? signoPct(v) : signo(v));
        return new Chart(lienzo, {
            type: 'bar',
            data: { labels: filas.map((f) => f.nombre),
                    datasets: [{ label: `${g.rotuloInt} − ${g.rotuloJun}`, data: valores, backgroundColor: valores.map((v) => (v < 0 ? ROJO : VERDE)),
                                 borderWidth: 0, barPercentage: 0.86, categoryPercentage: 0.92 }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
                layout: { padding: { top: enPct ? 14 : 4, right: 8 } },
                scales: {
                    x: { min, max, grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => (enPct ? `${v} %` : fmt.format(v)) },
                         title: { display: true, text: enPct ? 'Diferencia (%)' : 'Diferencia (votos)', color: c.suave } },
                    y: { grid: { display: false }, ticks: { color: c.texto, autoSkip: false, font: { size: angosto() ? 9 : 10 },
                                                          callback: (_, k) => recortar(filas[k].nombre) } },
                },
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: `${g.nombre}: ${g.rotuloInt} − ${g.rotuloJun}`, color: c.texto, font: { size: 13, weight: '700' } },
                    tooltip: { callbacks: {
                        title: (items) => { const f = filas[items[0].dataIndex]; return f.barrio ? `${f.nombre} · ${f.barrio}` : f.nombre; },
                        label: (item) => {
                            const r = filas[item.dataIndex].grupos[g.id];
                            return [`${g.rotuloInt}: ${fmt.format(r.int)} votos`, `${g.rotuloJun}: ${fmt.format(r.jun)} votos`,
                                `Diferencia: ${signo(r.dif)} votos (${signoPct(r.pct)})`];
                        },
                    } },
                },
            },
            plugins: complementos(c, lineas, (chart, ctx) => {
                chart.getDatasetMeta(0).data.forEach((barra, k) => {
                    const v = valores[k];
                    if (v === null) return;
                    ctx.textAlign = v < 0 ? 'right' : 'left';
                    ctx.fillText(formato(v), barra.x + (v < 0 ? -4 : 4), barra.y);
                });
            }),
        });
    }

    function agrupado(Chart, lienzo, filas, g, c) {
        const datasets = [
            { label: `${g.rotuloInt} (${g.candidatura.sigla})`, data: filas.map((f) => f.grupos[g.id].int), backgroundColor: g.candidatura.color, stack: 'int' },
            ...g.juntas.map((x, n) => ({ label: `Junta lista ${x.num} (${x.sigla})`, data: filas.map((f) => f.grupos[g.id].porLista[n]),
                                         backgroundColor: conAlfa(x.color, 0.55), stack: 'jun' })),
        ];
        return new Chart(lienzo, {
            type: 'bar',
            data: { labels: filas.map((f) => f.nombre), datasets },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
                layout: { padding: { right: 8 } },
                scales: {
                    x: { stacked: true, suggestedMax: Math.max(...filas.map((f) => Math.max(f.grupos[g.id].int, f.grupos[g.id].jun))) * 1.3,
                         grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => fmt.format(v) },
                         title: { display: true, text: 'Votos', color: c.suave } },
                    y: { stacked: true, grid: { display: false }, ticks: { color: c.texto, autoSkip: false, font: { size: angosto() ? 9 : 10 },
                                                                         callback: (_, k) => recortar(filas[k].nombre) } },
                },
                plugins: {
                    legend: { display: true, position: 'bottom', labels: { color: c.texto, boxWidth: 12 } },
                    title: { display: true, text: `${g.nombre}: ${cantidadLocales(filas.length)} con la diferencia más negativa`, color: c.texto,
                             font: { size: 13, weight: '700' } },
                    tooltip: { callbacks: {
                        title: (items) => { const f = filas[items[0].dataIndex]; return f.barrio ? `${f.nombre} · ${f.barrio}` : f.nombre; },
                        footer: (items) => { const r = filas[items[0].dataIndex].grupos[g.id]; return `Diferencia: ${signo(r.dif)} votos (${signoPct(r.pct)})`; },
                    } },
                },
            },
            plugins: complementos(c, [], (chart, ctx) => {
                ctx.textAlign = 'left';
                filas.forEach((f, k) => {
                    const fin = Math.max(...chart.data.datasets.map((_, d) => chart.getDatasetMeta(d).data[k]?.x ?? 0));
                    const r = f.grupos[g.id];
                    ctx.fillText(`dif. ${signo(r.dif)} (${signoPct(r.pct)})`, fin + 6, chart.getDatasetMeta(0).data[k].y);
                });
            }),
        });
    }

    const cantidadLocales = (n) => `${fmt.format(n)} ${n === 1 ? 'local' : 'locales'}`;

    async function renderGraficos(filas) {
        const miTurno = ++turno;
        const Chart = await cargarChart();
        if (miTurno !== turno) return;
        for (const g of graficos) g.destroy();
        graficos = [];
        const contenedor = $('graficosIvj');
        contenedor.replaceChildren();
        const vista = gruposVista();
        contenedor.classList.toggle('ivj__graficos--doble', vista.length > 1);
        const leyenda = $('leyendaIvj');
        leyenda.replaceChildren();
        if (!filas.length) {
            contenedor.append(el('p', 'nota', 'Ningún local coincide con el filtro o la búsqueda.'));
            return;
        }
        const c = colores();
        const alto = angosto() ? 17 : 21;
        for (const g of vista) {
            const caja = el('div', 'ivj__grafico');
            const lienzo = el('canvas');
            lienzo.setAttribute('role', 'img');
            caja.append(lienzo);
            contenedor.append(caja);
            if (estado.vista === 'divergentes') {
                const orden = ordenGrafico(filas);
                caja.style.height = `${orden.length * alto + 110}px`;
                lienzo.setAttribute('aria-label', `Barras divergentes de ${g.nombre}: ${cantidadLocales(orden.length)} ordenados por diferencia`);
                graficos.push(divergente(Chart, lienzo, orden, g, c));
            } else {
                const peores = [...filas].sort((a, b) => ascendente(metrica(a, g), metrica(b, g))).slice(0, TOP_AGRUPADAS);
                caja.style.height = `${peores.length * (alto + 16) + 150}px`;
                lienzo.setAttribute('aria-label', `Barras agrupadas de ${g.nombre}: Intendente frente a Junta en ${cantidadLocales(peores.length)}`);
                graficos.push(agrupado(Chart, lienzo, peores, g, c));
            }
        }
        const item = (color, texto) => {
            const li = el('li');
            const muestra = el('span', 'leyenda__muestra');
            muestra.style.background = color;
            li.append(muestra, el('span', null, texto));
            return li;
        };
        if (estado.vista === 'divergentes') {
            leyenda.append(item(ROJO, 'Negativo: el Intendente obtuvo menos votos que su Junta'), item(VERDE, 'Positivo: el Intendente superó a su Junta'));
            if (estado.metrica === 'pct') leyenda.append(item('transparent', 'Líneas punteadas: separaciones de 5 %, 10 % y 20 %'));
        } else {
            leyenda.append(item('transparent', `Los ${TOP_AGRUPADAS} locales con la diferencia más negativa del grupo (en ${estado.metrica === 'pct' ? '%' : 'votos'}); ` +
                'la Junta se apila por lista.'));
        }
    }

    // --- Descargas -----------------------------------------------------------------------------

    function nombreArchivo(extension) {
        const ambito = estado.filtro ? normalizar(textoAmbito()).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'asuncion';
        return `intendente_vs_junta_${estado.grupo}_${estado.metrica}_${ambito}.${extension}`;
    }

    function descargarCsv() {
        const celda = (v) => {
            const s = v === null || v === undefined ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const p2 = (v) => (v === null ? '' : v.toFixed(2));
        const lineas = [COLUMNAS_CSV.map(celda).join(',')];
        for (const f of ordenadas(filtradas())) {
            const a = f.grupos.L1, b = f.grupos.AL;
            lineas.push([f.nombre, f.barrio, a.int, a.jun, a.dif, p2(a.pct), b.int, b.jun, b.dif, p2(b.pct), f.grupoNegativo, f.zona,
                f.zonaMunicipal ?? '', f.clave, f.mesas, f.emitidos, a.tramo, b.tramo, f.ambosNegativos ? 'sí' : 'no', f.grupoNegativoPct].map(celda).join(','));
        }
        descargar(new Blob([`﻿${lineas.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), nombreArchivo('csv'));
    }

    function descargarPng() {
        const lienzos = graficos.map((g) => g.canvas);
        if (!lienzos.length) return;
        const c = colores();
        const escala = window.devicePixelRatio || 1;
        const cabecera = Math.round(64 * escala), separacion = Math.round(16 * escala);
        const ancho = lienzos.reduce((a, l) => a + l.width, 0) + separacion * (lienzos.length + 1);
        const alto = Math.max(...lienzos.map((l) => l.height)) + cabecera + separacion;
        const final = el('canvas');
        final.width = ancho;
        final.height = alto;
        const ctx = final.getContext('2d');
        ctx.fillStyle = c.fondo;
        ctx.fillRect(0, 0, ancho, alto);
        ctx.fillStyle = c.texto;
        ctx.font = `700 ${Math.round(17 * escala)}px system-ui, sans-serif`;
        const grupo = estado.grupo === 'ambos' ? 'Lista 1 y Alianza' : grupoPor(estado.grupo).nombre;
        ctx.fillText(`Intendente vs Junta Municipal · ${grupo} · ${estado.metrica === 'pct' ? 'diferencia en %' : 'diferencia en votos'} · ${textoAmbito()}`,
            separacion, Math.round(28 * escala));
        ctx.fillStyle = c.suave;
        ctx.font = `${Math.round(12 * escala)}px system-ui, sans-serif`;
        ctx.fillText(`Fuente: TSJE, TREP 2026, actas por mesa, corte ${datos.resumen.eleccion.corte}. Kalaguichi.com · descargado el ${new Date().toLocaleDateString('es-PY')}`,
            separacion, Math.round(48 * escala));
        let x = separacion;
        for (const l of lienzos) {
            ctx.drawImage(l, x, cabecera);
            x += l.width + separacion;
        }
        final.toBlob((blob) => descargar(blob, nombreArchivo('png')), 'image/png');
    }

    async function render() {
        preparar();
        for (const [atributo, valor] of [['data-ivj-grupo', estado.grupo], ['data-ivj-metrica', estado.metrica], ['data-ivj-vista', estado.vista]]) {
            for (const boton of document.querySelectorAll(`[${atributo}]`)) boton.setAttribute('aria-pressed', String(boton.getAttribute(atributo) === valor));
        }
        const ambito = enAmbito();
        const filas = filtradas();
        $('metaIvj').textContent = `${textoAmbito()} · ${cantidadLocales(ambito.length)} · TREP preliminar, corte ${datos.resumen.eleccion.corte}`;
        renderTotales(ambito);
        renderTramos(ambito);
        renderTabla(filas);
        await renderGraficos(filas);
        $('panelIvj').dataset.listo = 'true';
    }

    return { render, modelo };
}
