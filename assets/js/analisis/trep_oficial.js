// TREP frente al cómputo oficial, por mesa y por local: diferencia = oficial − TREP de los emitidos o de los votos de una
// lista del cargo elegido. Solo con las dos fuentes publicadas; la otra fuente se carga al abrir este análisis.
import { cargarChart, colores, fondo, descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { cargarEleccion } from '../datos.js';
import { el, fmt, cantidad } from '../tablero/util.js';

const TOPE = 20;
const signo = (v) => `${v > 0 ? '+' : ''}${fmt.format(v)}`;

export function crear(ctx) {
    const { datos } = ctx;
    const estado = { unidad: 'mesa', metrica: 'emitidos', orden: { id: 'abs', dir: -1 } };
    let otra = null;
    let grafico = null;
    let filas = [];
    let mostradas = [];

    const metrica = el('select');
    metrica.id = 'metricaTrepOficial';
    const etiqueta = el('label', 'campo-select', 'Comparar ');
    etiqueta.htmlFor = metrica.id;
    etiqueta.append(metrica);
    const unidad = el('div', 'segmentos');
    unidad.setAttribute('role', 'group');
    unidad.setAttribute('aria-label', 'Unidad');
    for (const [valor, texto] of [['mesa', 'Mesa'], ['local', 'Local']]) {
        const b = el('button', null, texto);
        b.type = 'button';
        b.dataset.unidad = valor;
        unidad.append(b);
    }
    ctx.controles.append(etiqueta, unidad);
    metrica.addEventListener('change', () => { estado.metrica = metrica.value; render(); ctx.alCambiar(); });
    unidad.addEventListener('click', (e) => { const b = e.target.closest('[data-unidad]'); if (b) { estado.unidad = b.dataset.unidad; render(); ctx.alCambiar(); } });

    const vacio = el('p', 'nota analisis__vacio');
    const caja = el('div', 'analisis__lienzo');
    const lienzo = el('canvas');
    lienzo.setAttribute('role', 'img');
    caja.append(lienzo);
    ctx.cuerpo.append(vacio, caja);
    const tabla = el('table', 'tabla');
    const desplazable = el('div', 'tabla-scroll');
    desplazable.append(tabla);
    const nota = el('p', 'nota');
    ctx.tabla.append(desplazable, nota);
    const lectura = el('div');
    ctx.lectura.append(lectura);

    async function cargar() {
        if (otra) return;
        const fuente = ctx.fuente === 'trep' ? 'oficial' : 'trep';
        const r = await cargarEleccion(ctx.pedido, fuente, { fuente: ['mesas.json'] });
        otra = { fuente, mesas: r.datos['mesas.json'] };
    }

    const porFuente = () => (ctx.fuente === 'trep' ? { trep: datos.mesas, oficial: otra.mesas } : { trep: otra.mesas, oficial: datos.mesas });
    const indice = (m) => new Map(m.mesas.map(([z, l, n], i) => [`${z}-${l}-${n}`, i]));
    // Valor de la métrica en una fuente: emitidos o votos de una lista (por su número, por si el orden cambiara).
    function lector(m, cargo) {
        const c = m.cargos[cargo];
        if (estado.metrica === 'emitidos') return (i) => c.emitidos[i];
        const j = c.listas.indexOf(estado.metrica.slice(6));
        return (i) => (j < 0 ? null : c.votos[i][j]);
    }

    function calcular() {
        const cargo = ctx.cargo();
        const { trep, oficial } = porFuente();
        const it = indice(trep), io = indice(oficial);
        const vt = lector(trep, cargo), vo = lector(oficial, cargo);
        const porMesa = [...new Set([...it.keys(), ...io.keys()])].map((clave) => {
            const [zona, local, mesa] = clave.split('-').map(Number);
            const info = datos.infoLocal.get(`${zona}-${local}`);
            const t = it.has(clave) ? vt(it.get(clave)) : null, o = io.has(clave) ? vo(io.get(clave)) : null;
            return { clave, local: `${zona}-${local}`, nombre: `${info?.nombre ?? `Local ${local}`} · mesa ${mesa}`, barrio: info?.barrio ?? '',
                     zona, zonaMunicipal: info?.zona_municipal ?? null, trep: t, oficial: o, dif: t !== null && o !== null ? o - t : null,
                     solo: t === null ? 'oficial' : o === null ? 'trep' : null };
        }).filter((f) => ctx.enFiltro(f));
        if (estado.unidad === 'mesa') return porMesa;
        const locales = new Map();
        for (const f of porMesa) {
            const l = locales.get(f.local) ?? { clave: f.local, nombre: datos.infoLocal.get(f.local)?.nombre ?? f.local, barrio: f.barrio, trep: 0, oficial: 0,
                                                 dif: 0, soloTrep: 0, soloOficial: 0, mesas: 0 };
            if (f.solo === 'trep') l.soloTrep += 1;
            else if (f.solo === 'oficial') l.soloOficial += 1;
            else { l.trep += f.trep; l.oficial += f.oficial; l.dif += f.dif; l.mesas += 1; }
            locales.set(f.local, l);
        }
        return [...locales.values()].map((l) => ({ ...l, solo: l.soloTrep || l.soloOficial ? [l.soloTrep ? `${cantidad(l.soloTrep, 'mesa', 'mesas')} solo en el TREP` : null,
            l.soloOficial ? `${cantidad(l.soloOficial, 'mesa', 'mesas')} solo en el cómputo oficial` : null].filter(Boolean).join(' · ') : null }));
    }

    const textoSolo = (s) => (s === 'trep' ? 'Solo en el TREP' : s === 'oficial' ? 'Solo en el cómputo oficial' : s ?? '');
    const columnas = () => [
        { id: 'nombre', titulo: estado.unidad === 'mesa' ? 'Mesa' : 'Local', texto: true, v: (f) => f.nombre },
        { id: 'barrio', titulo: 'Barrio', texto: true, v: (f) => f.barrio },
        { id: 'trep', titulo: 'TREP', v: (f) => f.trep, f: (v) => (v === null ? '—' : fmt.format(v)) },
        { id: 'oficial', titulo: 'Oficial', v: (f) => f.oficial, f: (v) => (v === null ? '—' : fmt.format(v)) },
        { id: 'dif', titulo: 'Diferencia', v: (f) => f.dif, f: (v) => (v === null ? '—' : signo(v)), clase: (v) => (v < 0 ? 'es-negativa' : null) },
        { id: 'abs', titulo: '|Dif.|', v: (f) => (f.dif === null ? null : Math.abs(f.dif)) },
        { id: 'estado', titulo: 'Fuentes', texto: true, v: (f) => textoSolo(f.solo) },
    ];
    alOrdenar(tabla, estado, columnas, () => renderTabla());

    function renderTabla() {
        const distintas = filas.filter((f) => (f.dif !== null && f.dif !== 0) || f.solo);
        mostradas = renderTablaOrdenable(tabla, columnas(), distintas, estado);
        nota.textContent = `${cantidad(distintas.length, estado.unidad === 'mesa' ? 'mesa con diferencias' : 'local con diferencias',
            estado.unidad === 'mesa' ? 'mesas con diferencias' : 'locales con diferencias')} de ${fmt.format(filas.length)} comparadas. ` +
            'Diferencia = cómputo oficial − TREP.';
    }

    function textoMetrica() {
        if (estado.metrica === 'emitidos') return 'votos emitidos';
        const item = datos.listas[ctx.cargo()].find((x) => x.num === estado.metrica.slice(6));
        return `votos de ${item ? item.sigla : 'la lista'}`;
    }

    function renderLectura() {
        const conDif = filas.filter((f) => f.dif);
        const suma = conDif.reduce((a, f) => a + f.dif, 0);
        lectura.replaceChildren(
            el('p', null, `Compara los ${textoMetrica()} de ${ctx.nombreCargo()} en el cómputo oficial y en el TREP, ${estado.unidad === 'mesa' ? 'mesa por mesa' : 'por local'}. ` +
                'Diferencia = oficial − TREP: positiva si el cómputo oficial tiene más.'),
            el('p', null, conDif.length ? `${cantidad(conDif.length, estado.unidad, estado.unidad === 'mesa' ? 'mesas' : 'locales')} con diferencia; en conjunto suman ` +
                `${signo(suma)} ${textoMetrica()}. El gráfico muestra las ${Math.min(TOPE, conDif.length)} de mayor diferencia absoluta.` :
                `Las dos fuentes coinciden en los ${textoMetrica()} de todas las ${estado.unidad === 'mesa' ? 'mesas' : 'locales'} que tienen en común.`),
            el('p', null, 'Las mesas que están en una sola fuente se listan aparte en la tabla. Las diferencias pueden venir de actas corregidas, ' +
                'recibidas después del corte del TREP o no transmitidas: este análisis las muestra, no las explica.'));
    }

    async function renderGrafico() {
        const c = colores();
        const tope = filas.filter((f) => f.dif).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)).slice(0, TOPE);
        vacio.hidden = tope.length > 0;
        caja.hidden = !tope.length;
        vacio.textContent = 'Sin diferencias entre las dos fuentes en esta selección.';
        if (grafico) { grafico.destroy(); grafico = null; }
        if (!tope.length) return;
        const Chart = await cargarChart();
        caja.style.height = `${Math.max(220, tope.length * 26 + 70)}px`;
        lienzo.setAttribute('aria-label', `Barras de las ${tope.length} diferencias mayores, oficial menos TREP`);
        grafico = new Chart(lienzo, {
            type: 'bar',
            data: { labels: tope.map((f) => f.nombre), datasets: [{ label: 'Oficial − TREP', data: tope.map((f) => f.dif), borderWidth: 0,
                                                                     backgroundColor: tope.map((f) => (f.dif > 0 ? c.verde : c.rojo)) }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
                scales: { x: { grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => fmt.format(v) }, title: { display: true, text: `Oficial − TREP (${textoMetrica()})`, color: c.suave } },
                          y: { grid: { display: false }, ticks: { color: c.texto, autoSkip: false, font: { size: 10 } } } },
                plugins: { legend: { display: false },
                           tooltip: { callbacks: { label: (it) => `TREP ${fmt.format(tope[it.dataIndex].trep)} · oficial ${fmt.format(tope[it.dataIndex].oficial)} · ${signo(tope[it.dataIndex].dif)}` } } },
            },
            plugins: [fondo(c)],
        });
    }

    async function render() {
        const cargo = ctx.cargo();
        if (metrica.dataset.cargo !== cargo) {
            metrica.replaceChildren(new Option('Votos emitidos', 'emitidos'),
                ...datos.listas[cargo].map((item) => new Option(`Votos de ${item.sigla} (lista ${item.num})`, `lista:${item.num}`)));
            metrica.dataset.cargo = cargo;
            if (![...metrica.options].some((o) => o.value === estado.metrica)) estado.metrica = 'emitidos';
        }
        metrica.value = estado.metrica;
        for (const b of unidad.querySelectorAll('[data-unidad]')) b.setAttribute('aria-pressed', String(b.dataset.unidad === estado.unidad));
        await cargar();
        filas = calcular();
        renderTabla();
        renderLectura();
        await renderGrafico();
    }

    return {
        titulo: 'TREP vs oficial',
        meta: () => `Cómputo oficial − TREP · ${textoMetrica()} · ${ctx.nombreCargo()} · por ${estado.unidad} · ${ctx.textoFiltro()}`,
        render,
        alCambiarTema: () => renderGrafico(),
        csv: () => descargarCsv(nombreArchivo('trep_vs_oficial', estado.metrica, estado.unidad, ctx.textoFiltro()), columnas(), mostradas),
        png: () => (grafico ? descargarPng(lienzo, { nombre: nombreArchivo('trep_vs_oficial', estado.metrica, estado.unidad, ctx.textoFiltro()),
            titulo: `Cómputo oficial − TREP · ${textoMetrica()} por ${estado.unidad} · ${ctx.textoFiltro()}`, fuente: 'TSJE: TREP preliminar y cómputo oficial' }) : null),
        estadoEnlace: () => ({ metrica: estado.metrica === 'emitidos' ? null : estado.metrica, unidad: estado.unidad === 'mesa' ? null : estado.unidad }),
        aplicarEnlace(p) {
            estado.metrica = /^(emitidos|lista:\d+)$/.test(p.get('metrica') ?? '') ? p.get('metrica') : 'emitidos';
            estado.unidad = p.get('unidad') === 'local' ? 'local' : 'mesa';
        },
    };
}
