// Análisis del padrón (ADR-028; ADR 0026 del módulo): los quince segmentos. Cada uno muestra su cifra, la definición, el
// ámbito, la fecha, el origen, la cobertura y su estado, con la tabla y el método al desplegar. Todo sale de los tres
// archivos de datos/padron_analisis/ (los mismos agregados para el gráfico, la tabla y las descargas); lo que no tiene
// datos locales queda a la vista como «no disponible», y un dato que solo existe para el país no se repite en un
// departamento o un distrito («sin desglose para este nivel»).
import { el, fmt, pct, cantidad, porcentaje } from '../tablero/util.js';
import { cargarChart, colores, fondo, descargarCsv, descargarPng, nombreArchivo } from '../analisis/exportar.js';

const ESTADOS = { calculado_local: 'Calculado con datos locales', referencia_externa: 'Referencia externa', no_disponible: 'No disponible',
                  no_aplicable: 'No aplicable', en_conflicto: 'En conflicto' };
const RESERVADO = 'reservado';
const SEXO = { F: 'Mujeres', M: 'Varones', sin_dato: 'Sin dato', fuera_de_catalogo: 'Otro valor' };
const ORDEN_SEXO = ['F', 'M', 'fuera_de_catalogo', 'sin_dato'];
let graficos = [];

// --- Piezas ------------------------------------------------------------------------------------------------------------
const numero = (v) => (v === null || v === undefined ? RESERVADO : fmt.format(v));
// Una celda de texto que una planilla podría tomar por fórmula va con un apóstrofo delante (los números no se tocan).
const sinFormula = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

function cifra(valor, rotulo, detalle) {
    const nodo = el('div', 'cifra');
    nodo.append(el('p', 'cifra__valor', valor), el('p', 'cifra__rotulo', rotulo));
    if (detalle) nodo.append(el('p', 'cifra__detalle', detalle));
    return nodo;
}

function cifras(...items) {
    const nodo = el('div', 'cifras');
    nodo.append(...items.filter(Boolean));
    return nodo;
}

function ficha(ctx, { definicion, origen, cobertura, fecha }) {
    const dl = el('dl', 'segmento__ficha');
    for (const [dt, dd] of [['Qué mide', definicion], ['Ámbito', ctx.textoAmbito], ['Fecha', fecha ?? ctx.textoFecha], ['Origen', origen],
                            ['Cobertura', cobertura]]) {
        if (!dd) continue;
        dl.append(el('dt', null, dt), el('dd', null, dd));
    }
    return dl;
}

function detalle(resumenTexto, ...nodos) {
    const d = el('details', 'segmento__detalle');
    d.append(el('summary', null, resumenTexto), ...nodos.filter(Boolean));
    return d;
}

function sinDesglose(texto = 'Sin desglose para este nivel: este dato solo existe para todo el país.') {
    return el('p', 'segmento__sin-desglose', texto);
}

function noDisponible(ctx, motivo, ids) {
    const nodo = el('div', 'segmento__vacio');
    nodo.append(el('p', null, `No disponible. ${motivo}`));
    for (const d of ctx.manifiesto.dependencias.filter((x) => ids.includes(x.id))) {
        const p = el('p', 'segmento__dependencia');
        p.append(el('strong', null, `Falta (${d.id}): `), `${d.dato} (${d.unidad}, ${d.anio}). ${d.por_que}. Fuente posible: ${d.fuente_posible}.`);
        nodo.append(p);
    }
    return nodo;
}

// columnas: [{ titulo, v: (fila) => valor, f?: (valor) => texto, texto?: true }]
function tabla(titulo, columnas, filas) {
    const t = el('table', 'tabla');
    t.append(el('caption', null, titulo));
    const cabeza = el('tr');
    for (const c of columnas) {
        const th = el('th', c.texto ? 'tabla__texto' : null, c.titulo);
        th.scope = 'col';
        cabeza.append(th);
    }
    t.createTHead().append(cabeza);
    const cuerpo = t.createTBody();
    for (const fila of filas) {
        const tr = el('tr');
        columnas.forEach((c, k) => {
            const v = c.v(fila);
            const texto = c.f ? c.f(v, fila) : typeof v === 'number' || v === null ? numero(v) : v;
            if (k === 0) {
                const th = el('th', 'tabla__texto', texto);
                th.scope = 'row';
                tr.append(th);
            } else {
                tr.append(el('td', c.texto ? 'tabla__texto' : null, texto));
            }
        });
        cuerpo.append(tr);
    }
    const caja = el('div', 'tabla-scroll');
    caja.append(t);
    return caja;
}

function botonCsv(ctx, nombre, columnas, filas) {
    const b = el('button', 'boton-secundario', 'Descargar CSV');
    b.type = 'button';
    b.addEventListener('click', () => descargarCsv(nombreArchivo('padron', nombre, ctx.textoAmbito),
                                                   columnas.map((c) => ({ titulo: c.titulo, v: (f) => sinFormula(c.v(f) ?? RESERVADO) })), filas));
    return b;
}

function acciones(...botones) {
    const nodo = el('div', 'segmento__acciones');
    nodo.append(...botones.filter(Boolean));
    return nodo;
}

const pctDe = (parte, total) => `${porcentaje(parte, total)} %`;

// --- Gráficos ----------------------------------------------------------------------------------------------------------
// Barras horizontales (Chart.js autoalojado): una serie por sexo o el total; el lienzo se descarga como PNG con título,
// leyenda y fuente (evento, fecha etaria, universo).
function grafico(ctx, { etiqueta, rotulos, series, alto, titulo, nombre, logaritmica = false }) {
    const caja = el('div', 'grafico');
    caja.style.height = `${alto}px`;
    const lienzo = el('canvas');
    lienzo.setAttribute('role', 'img');
    lienzo.setAttribute('aria-label', etiqueta);
    caja.append(lienzo);
    const turno = ctx.turno;
    const listo = cargarChart().then((Chart) => {
        if (turno !== ctx.turnoActual() || !lienzo.isConnected) return null;  // un filtro posterior ya cambió la vista
        const c = colores();
        const g = new Chart(lienzo, {
            type: 'bar',
            data: { labels: rotulos, datasets: series.map((s) => ({ label: s.nombre, data: s.datos, backgroundColor: s.color, borderWidth: 0,
                                                                     barPercentage: .9, categoryPercentage: .85 })) },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
                scales: { x: logaritmica
                    ? { type: 'logarithmic', min: 1, ticks: { color: c.suave, callback: (v) => (/^10*$/.test(String(v)) ? fmt.format(v) : '') },
                        grid: { color: c.borde } }
                    : { stacked: series.length > 1, ticks: { color: c.suave, callback: (v) => fmt.format(v) }, grid: { color: c.borde } },
                          y: { stacked: series.length > 1, ticks: { color: c.texto, autoSkip: false }, grid: { display: false } } },
                plugins: { legend: { display: series.length > 1, labels: { color: c.texto } },
                           tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${i.raw === null ? RESERVADO : fmt.format(i.raw)}` } } },
            },
            plugins: [fondo(c)],
        });
        graficos.push(g);
        return g;
    });
    const png = el('button', 'boton-secundario', 'Descargar gráfico (PNG)');
    png.type = 'button';
    png.addEventListener('click', async () => {
        const g = await listo;
        if (!g) return;
        descargarPng(g.canvas, { nombre: nombreArchivo('padron', nombre, ctx.textoAmbito), titulo: `${titulo} · ${ctx.textoAmbito}`,
                                 leyenda: series.map((s) => ({ color: s.color, texto: s.nombre })),
                                 fuente: `${ctx.manifiesto.evento.nombre} · ${ctx.manifiesto.universo.split(':')[0]} · edad al ` +
                                         `${ctx.textoFechaEtaria} · elaboración de Kalaguichi` });
    });
    return { caja, png };
}

export function limpiarGraficos() {
    for (const g of graficos) g.destroy();
    graficos = [];
}

// --- Segmentos ---------------------------------------------------------------------------------------------------------
const S = {};

S.S01 = (ctx) => {
    const r = ctx.resumen.s01;
    if (ctx.nivel === 'pais') {
        return [cifras(cifra(fmt.format(r.registros), 'Registros del padrón'),
                       cifra(fmt.format(r.cargos.intendencias + r.cargos.concejalias_titulares), 'Cargos titulares',
                             `${fmt.format(r.cargos.intendencias)} intendencias y ${fmt.format(r.cargos.concejalias_titulares)} concejalías`),
                       cifra(fmt.format(r.locales.en_el_padron), 'Locales de votación', `${fmt.format(r.locales.con_acta_trep)} con acta en el TREP`),
                       cifra(fmt.format(r.mesas.en_el_padron), 'Mesas', `con acta en el TREP: ${fmt.format(r.mesas.con_acta_trep.intendencia)} de ` +
                             `Intendencia y ${fmt.format(r.mesas.con_acta_trep.junta)} de la Junta`)),
                ficha(ctx, { definicion: 'Registros del padrón 2026, cargos titulares en disputa y locales y mesas por su clave completa ' +
                                         '(departamento, distrito, zona, local y mesa). Una mesa cuenta una vez aunque tenga actas de dos cargos.',
                             origen: 'Padrón 2026; planillas e integración de las juntas del TREP (TSJE).',
                             cobertura: 'Todo el padrón. Los suplentes de las juntas no están en los datos locales.' })];
    }
    const f = ctx.fila;
    return [cifras(cifra(fmt.format(f.registros), 'Registros del padrón'),
                   cifra(fmt.format(f.intendencias + f.concejalias_titulares), 'Cargos titulares',
                         `${cantidad(f.intendencias, 'intendencia', 'intendencias')} y ${cantidad(f.concejalias_titulares, 'concejalía', 'concejalías')}`),
                   cifra(fmt.format(f.locales), 'Locales de votación'), cifra(fmt.format(f.mesas), 'Mesas')),
            ficha(ctx, { definicion: 'Registros del padrón, cargos titulares y locales y mesas del padrón por su clave completa.',
                         origen: 'Padrón 2026; integración de las juntas del TREP (TSJE).',
                         cobertura: 'Las mesas con acta del TREP se informan para todo el país.' })];
};

S.S02 = (ctx) => {
    const r = ctx.resumen.s02;
    const distritos = ctx.nivel === 'pais' ? ctx.resumen.s04.distritos : ctx.nivel === 'departamento'
        ? ctx.resumen.s04.distritos.filter((d) => d.departamento === ctx.dep.codigo) : [ctx.fila];
    const intendencias = distritos.reduce((a, d) => a + d.intendencias, 0);
    const concejalias = distritos.reduce((a, d) => a + d.concejalias_titulares, 0);
    const tamanos = new Map();
    for (const d of distritos) tamanos.set(d.concejalias_titulares, (tamanos.get(d.concejalias_titulares) ?? 0) + 1);
    const filas = [...tamanos].sort((a, b) => a[0] - b[0]).map(([concejalias, n]) => ({ concejalias, distritos: n }));
    const columnas = [{ titulo: 'Concejalías titulares de la junta', v: (f) => f.concejalias }, { titulo: 'Distritos', v: (f) => f.distritos }];
    return [cifras(cifra(fmt.format(intendencias), 'Intendencias'), cifra(fmt.format(concejalias), 'Concejalías titulares'),
                   cifra('No disponible', 'Concejalías suplentes', 'Faltan en los datos locales (D02)')),
            ficha(ctx, { definicion: 'Cargos municipales en disputa: una intendencia por distrito y las concejalías titulares de cada junta. ' +
                                     'No se deducen de la cantidad de candidaturas, de listas ni de actas.',
                         origen: 'Planillas del TREP e integración de las juntas por distrito (TSJE).',
                         cobertura: `${cantidad(distritos.length, 'distrito', 'distritos')}. Son los cargos a elegir, no la adjudicación oficial.` }),
            detalle('Tabla y método', tabla('Juntas por cantidad de concejalías titulares', columnas, filas),
                    acciones(botonCsv(ctx, 'juntas-por-tamano', columnas, filas)),
                    noDisponible(ctx, r.concejalias_suplentes.motivo, ['D02']))];
};

S.S03 = (ctx) => {
    const r = ctx.resumen.s03;
    if (ctx.nivel !== 'pais') return [sinDesglose(), ficha(ctx, { definicion: r.alcance })];
    const filas = [['Junta Municipal', r.junta], ['Intendencia', r.intendencia], ['Cualquiera de los dos cargos', r.cualquier_cargo]]
        .map(([cargo, x]) => ({ cargo, ...x }));
    const columnas = [{ titulo: 'Cargo', texto: true, v: (f) => f.cargo }, { titulo: 'Partidos', v: (f) => f.partidos },
                      { titulo: 'Alianzas', v: (f) => f.alianzas }, { titulo: 'Movimientos', v: (f) => f.movimientos }];
    return [cifras(cifra(fmt.format(r.cualquier_cargo.partidos), 'Partidos'), cifra(fmt.format(r.cualquier_cargo.alianzas), 'Alianzas'),
                   cifra(fmt.format(r.cualquier_cargo.movimientos), 'Movimientos')),
            ficha(ctx, { definicion: `${r.alcance} Una alianza cuenta una vez por distrito, no por sus integrantes ni por cada mesa.`,
                         origen: 'Planillas del TREP (TSJE).', cobertura: 'Organizaciones observadas, no el catálogo completo de habilitadas.' }),
            detalle('Tabla y método', tabla('Organizaciones observadas por cargo', columnas, filas), acciones(botonCsv(ctx, 'organizaciones', columnas, filas)),
                    noDisponible(ctx, r.catalogo_habilitadas.motivo, ['D03']))];
};

S.S04 = (ctx) => {
    const r = ctx.resumen.s04;
    let filas, primera;
    if (ctx.nivel === 'pais') {
        filas = r.departamentos;
        primera = { titulo: 'Departamento', texto: true, v: (f) => f.nombre };
    } else {
        filas = ctx.nivel === 'departamento' ? r.distritos.filter((d) => d.departamento === ctx.dep.codigo) : [ctx.fila];
        primera = { titulo: 'Distrito', texto: true, v: (f) => f.nombre };
    }
    const columnas = [primera, ...(ctx.nivel === 'pais' ? [{ titulo: 'Distritos', v: (f) => f.distritos }] : []),
                      { titulo: 'Registros del padrón', v: (f) => f.registros }, { titulo: 'Locales', v: (f) => f.locales },
                      { titulo: 'Mesas', v: (f) => f.mesas }, { titulo: 'Intendencias', v: (f) => f.intendencias },
                      { titulo: 'Concejalías titulares', v: (f) => f.concejalias_titulares }];
    const total = (k) => filas.reduce((a, f) => a + f[k], 0);
    return [ficha(ctx, { definicion: 'Población electoral (registros del padrón, no habitantes), locales, mesas y cargos por territorio. ' +
                                     'La Capital tiene código 0. Ningún elector sale de multiplicar mesas por su capacidad.',
                         origen: 'Padrón 2026; integración de las juntas del TREP (TSJE).',
                         cobertura: `${fmt.format(total('registros'))} registros en ${cantidad(filas.length, ctx.nivel === 'pais' ? 'departamento' : 'distrito',
                                                                                                  ctx.nivel === 'pais' ? 'departamentos' : 'distritos')}.` }),
            tabla(ctx.nivel === 'pais' ? 'Cuadro por departamento' : `Cuadro por distrito · ${ctx.textoAmbito}`, columnas, filas),
            acciones(botonCsv(ctx, 'cuadro-territorial', columnas, filas))];
};

// Sexo del nivel: el país, el departamento o el distrito tienen el mismo bloque «por_sexo».
const demoDelNivel = (ctx) => (ctx.nivel === 'pais' ? ctx.demografia.pais : ctx.nivel === 'departamento' ? ctx.dep : ctx.dis);
const sexosPresentes = (x) => ORDEN_SEXO.filter((s) => s in x);

S.S05 = (ctx) => {
    const d = demoDelNivel(ctx);
    const total = d.por_sexo.total;
    const filas = sexosPresentes(d.por_sexo).map((s) => ({ sexo: SEXO[s], n: d.por_sexo[s] }));
    const columnas = [{ titulo: 'Sexo registrado', texto: true, v: (f) => f.sexo }, { titulo: 'Registros', v: (f) => f.n },
                      { titulo: '% del total', v: (f) => f.n, f: (v) => pctDe(v, total) }];
    const c = colores();
    const g = grafico(ctx, { etiqueta: `Registros del padrón por sexo, ${ctx.textoAmbito}`, rotulos: filas.map((f) => f.sexo), alto: 150,
                             series: [{ nombre: 'Registros', datos: filas.map((f) => f.n), color: c.naranja }], titulo: 'Registros del padrón por sexo',
                             nombre: 'sexo' });
    return [cifras(...filas.map((f) => cifra(fmt.format(f.n), f.sexo, pctDe(f.n, total)))),
            g.caja,
            ficha(ctx, { definicion: 'Registros por la columna sexo del padrón, con sus categorías de origen (F y M); otro valor o la ' +
                                     'ausencia irían aparte. El porcentaje es sobre todos los registros del ámbito. No se infiere el sexo de ' +
                                     'nombres ni de fotos.', origen: 'Padrón 2026 (columna sexo, solo para contar; ADR 0026).',
                         cobertura: `${fmt.format(total)} registros.` }),
            detalle('Tabla y método', tabla('Registros por sexo', columnas, filas), acciones(g.png, botonCsv(ctx, 'sexo', columnas, filas)))];
};

S.S06 = (ctx) => {
    const d = demoDelNivel(ctx);
    const grupos = ctx.demografia.grupos;
    const conSexo = ctx.nivel !== 'distrito';
    const valor = (g) => (conSexo ? d.grupos[g.id].total : d.grupos[g.id]);
    const total = d.registros;
    const filas = grupos.map((g) => ({ g, total: valor(g), F: conSexo ? d.grupos[g.id].F : null, M: conSexo ? d.grupos[g.id].M : null }));
    const columnas = [{ titulo: 'Grupo', texto: true, v: (f) => f.g.rotulo }, { titulo: 'Registros', v: (f) => f.total },
                      { titulo: '% del total', v: (f) => f.total, f: (v) => pctDe(v, total) },
                      ...(conSexo ? [{ titulo: 'Mujeres', v: (f) => f.F }, { titulo: 'Varones', v: (f) => f.M }] : []),
                      { titulo: 'Frontera', texto: true, v: (f) => (f.g.estado_de_la_frontera.startsWith('corroborado') ? 'verificada (TSJE)' : 'operativa') }];
    const c = colores();
    const g = grafico(ctx, { etiqueta: `Registros por gran grupo de edad, ${ctx.textoAmbito}`, rotulos: grupos.map((x) => x.rotulo), alto: 170,
                             series: conSexo ? [{ nombre: 'Mujeres', datos: filas.map((f) => f.F), color: c.naranja },
                                                { nombre: 'Varones', datos: filas.map((f) => f.M), color: azul() }]
                                             : [{ nombre: 'Registros', datos: filas.map((f) => f.total), color: c.naranja }],
                             titulo: 'Registros por gran grupo de edad', nombre: 'grupos-de-edad' });
    return [cifras(...filas.map((f) => cifra(fmt.format(f.total), f.g.rotulo, pctDe(f.total, total)))),
            g.caja,
            ...(conSexo ? [] : [sinDesglose('Sin desglose por sexo para este nivel.')]),
            ficha(ctx, { definicion: 'Jóvenes de 18 a 29 años (la definición de la nota del TSJE), adultos de 30 a 64 y adultos mayores ' +
                                     'de 65 o más (fronteras operativas de Kalaguichi, a contrastar). Edad cumplida al ' + ctx.textoFechaEtaria + '.',
                         fecha: ctx.textoFechaEdad,
                         origen: 'Padrón 2026 (fecha de nacimiento, solo para contar; ADR 0026).',
                         cobertura: 'Menores de 18 y fechas no evaluables van aparte (en el país: ninguno).' }),
            detalle('Tabla y método', tabla('Registros por gran grupo de edad', columnas, filas), acciones(g.png, botonCsv(ctx, 'grupos-de-edad', columnas, filas)))];
};

const azul = () => getComputedStyle(document.documentElement).getPropertyValue('--blue-600').trim() || '#2563eb';

S.S07 = (ctx) => {
    const D = ctx.demografia;
    if (ctx.nivel === 'distrito') {
        const d = ctx.dis;
        return [cifras(cifra(d.reservado ? 'Reservado' : fmt.format(d.cien_o_mas), '100 años o más',
                             d.reservado ? 'Tiene de 1 a 4 registros o se reserva para que no se deduzca otro dato.' : pctDe(d.cien_o_mas, d.registros))),
                sinDesglose('Sin desglose por bandas para este nivel: en un distrito se publican los tres grandes grupos (S06) y «100 años o más».'),
                ficha(ctx, { definicion: 'Registros de 100 años o más (incluye más de 150) según la fecha de nacimiento del registro.',
                             fecha: ctx.textoFechaEdad,
                             origen: 'Padrón 2026 (fecha de nacimiento, solo para contar; ADR 0026).', cobertura: aviso() })];
    }
    const pais = ctx.nivel === 'pais';
    const nivel = pais ? D.pais : ctx.dep;
    const valor = (id) => (pais ? nivel.bandas[id].total : nivel.bandas[id]);
    const total = nivel.registros;
    const resumida = ctx.vista === 'resumida';
    // La vista resumida de la referencia: las bandas de 18 a 64 y «65 años y más», que es el gran grupo ya publicado (S06).
    const compacta = (r) => {
        if (r.categorias.length > 1) {
            const g = nivel.grupos.adultos_mayores;
            return { rotulo: r.rotulo, total: g.total, F: pais ? g.F : null, M: pais ? g.M : null };
        }
        const id = r.categorias[0];
        return { rotulo: r.rotulo, total: valor(id), F: pais ? nivel.bandas[id].F : null, M: pais ? nivel.bandas[id].M : null };
    };
    const filas = resumida ? D.resumida.map(compacta)
        : D.bandas.map((b) => ({ rotulo: b.rotulo, id: b.id, total: valor(b.id), F: pais ? nivel.bandas[b.id].F : null, M: pais ? nivel.bandas[b.id].M : null }));
    const c = colores();
    const series = pais ? [{ nombre: 'Mujeres', datos: filas.map((f) => f.F), color: c.naranja }, { nombre: 'Varones', datos: filas.map((f) => f.M), color: azul() }]
                        : [{ nombre: 'Registros', datos: filas.map((f) => f.total), color: c.naranja }];
    const g = grafico(ctx, { etiqueta: `Registros por banda de edad, ${ctx.textoAmbito}`, rotulos: filas.map((f) => f.rotulo), alto: resumida ? 320 : 620,
                             series, titulo: resumida ? 'Registros por edad (vista resumida)' : 'Registros por banda de edad, de 18 a 150 años',
                             nombre: resumida ? 'edad-resumida' : 'edad-detallada' });
    // El detalle de 65 o más, con su propia escala logarítmica (el total): ni los jóvenes ni las bandas de 65 a 99 esconden
    // las de pocos registros. Las bandas en 0 o reservadas no tienen barra.
    const mayores = D.bandas.filter((b) => b.min >= 65);
    const filasMayores = mayores.map((b) => ({ rotulo: b.rotulo, total: valor(b.id) }));
    if (pais) filasMayores.push({ rotulo: 'Más de 150 años', total: D.pais.auxiliares.mayor_150.total });
    const gMayores = grafico(ctx, { etiqueta: `Registros de 65 años o más por banda, en escala logarítmica, ${ctx.textoAmbito}`,
                                    rotulos: filasMayores.map((f) => f.rotulo), alto: 440, logaritmica: true,
                                    series: [{ nombre: 'Registros', datos: filasMayores.map((f) => (f.total ? f.total : null)), color: c.naranja }],
                                    titulo: 'Registros de 65 años o más, por banda (escala logarítmica)', nombre: 'edad-65-o-mas' });
    const columnas = [{ titulo: 'Edad', texto: true, v: (f) => f.rotulo }, { titulo: 'Registros', v: (f) => f.total },
                      { titulo: '% del total', v: (f) => f.total, f: (v) => (v === null ? RESERVADO : pctDe(v, total)) },
                      ...(pais ? [{ titulo: 'Mujeres', v: (f) => f.F }, { titulo: 'Varones', v: (f) => f.M }] : [])];
    const vistas = el('div', 'segmentos');
    vistas.setAttribute('role', 'group');
    vistas.setAttribute('aria-label', 'Vista de las edades');
    for (const [id, nombre] of [['desplegada', 'Bandas de 18 a 150'], ['resumida', 'Vista resumida']]) {
        const b = el('button', null, nombre);
        b.type = 'button';
        b.dataset.vista = id;
        b.setAttribute('aria-pressed', String(ctx.vista === id));
        b.addEventListener('click', () => ctx.alCambiarVista(id));
        vistas.append(b);
    }
    const nodos = [vistas, g.caja, el('h3', 'segmento__subtitulo', 'Detalle de 65 años o más, en escala logarítmica'), gMayores.caja,
                   el('p', 'segmento__nota', 'En escala logarítmica cada marca multiplica por diez, para que se vean las bandas con pocos ' +
                                             'registros; las que tienen 0 o están reservadas no llevan barra. Los números están en la tabla.')];
    if (pais) {
        const aux = D.auxiliares.map((a) => ({ rotulo: a.rotulo, total: D.pais.auxiliares[a.id].total }));
        const r = D.pais.reconciliacion;
        nodos.push(el('p', 'segmento__nota', `65 años o más: ${fmt.format(r.total_65_mas)} registros, igual a la suma de las bandas de 65 a 150 ` +
                                             `y los de más de 150 (${fmt.format(r.suma_bandas_65_a_150_y_mas_de_150)}). Todas las categorías suman ` +
                                             `${fmt.format(r.suma_de_bandas_y_auxiliares)}, el total de registros.`),
                   tabla('Categorías fuera de las bandas (no se borran: cuentan en el total)', [{ titulo: 'Categoría', texto: true, v: (f) => f.rotulo },
                         { titulo: 'Registros', v: (f) => f.total }], aux));
    } else {
        nodos.push(sinDesglose('Sin desglose por sexo para este nivel. Las categorías fuera de las bandas se publican para todo el país.'));
        if (ctx.dep.reservadas.length) {
            nodos.push(el('p', 'segmento__nota', `${cantidad(ctx.dep.reservadas.length, 'banda reservada', 'bandas reservadas')}: tiene de 1 a 4 ` +
                                                 'registros o se reserva para que no se deduzca otro dato restando de los totales publicados.'));
        }
    }
    nodos.push(ficha(ctx, { definicion: 'Edad cumplida al ' + ctx.textoFechaEtaria + ' (decisión de Kalaguichi: el día de la elección): 18 a 19 ' +
                                        'años, quinquenios de 20 a 149 y la banda de 150 años; los extremos se incluyen. Más de 150, menores de 18 y ' +
                                        'fechas ausentes, inválidas o posteriores van aparte, sin truncar ni borrar.',
                            fecha: ctx.textoFechaEdad, origen: 'Padrón 2026 (fecha de nacimiento, solo para contar; ADR 0026).', cobertura: aviso() }),
               detalle('Tabla y método', tabla(resumida ? 'Registros por edad (vista resumida)' : 'Registros por banda de edad', columnas, filas),
                       acciones(g.png, gMayores.png, botonCsv(ctx, resumida ? 'edad-resumida' : 'edad-detallada', columnas, filas))));
    return nodos;
};

const aviso = () => 'Una edad registrada muy alta es una característica del registro, para revisión: no prueba vida, fallecimiento, fraude ni ' +
    'identidad falsa. Los 100 años o más se reservan en departamentos y distritos cuando tienen de 1 a 4 registros.';

S.S08 = (ctx) => {
    const r = ctx.resumen.s08;
    const locales = ctx.nivel === 'pais' ? r.locales : ctx.fila.locales;
    const mesas = ctx.nivel === 'pais' ? r.mesas : ctx.fila.mesas;
    return [cifras(cifra(fmt.format(locales), 'Locales'), cifra(fmt.format(mesas), 'Mesas'), cifra('No disponible', 'Máquinas de votación', 'Sin inventario logístico (D08)')),
            ficha(ctx, { definicion: 'Los locales y las mesas son los del resumen (S01), sin otro cálculo. Las máquinas asignadas, de ' +
                                     'capacitación y de reserva necesitan el inventario logístico: no se suponen una por mesa.',
                         origen: 'Padrón 2026.' }),
            noDisponible(ctx, r.maquinas.motivo, ['D08'])];
};

S.S09 = (ctx) => [noDisponible(ctx, ctx.resumen.s09.motivo, ['D09']),
                  ficha(ctx, { definicion: 'Personal electoral por función. No se deduce de las firmas de las actas ni de la cantidad de mesas.' })];

S.S10 = (ctx) => {
    const r = ctx.resumen.s10;
    let sexos;
    if (ctx.nivel === 'pais') sexos = r.intendencia.por_sexo;
    else if (ctx.nivel === 'departamento') sexos = ctx.fila.candidaturas_intendencia;
    if (!sexos) {
        return [sinDesglose('Sin desglose por distrito: los totales por sexo se publican para el país y cada departamento.'),
                noDisponible(ctx, r.junta.motivo, ['D10'])];
    }
    const total = Object.values(sexos).reduce((a, n) => a + n, 0);
    const filas = sexosPresentes(sexos).concat(Object.keys(sexos).filter((s) => !ORDEN_SEXO.includes(s)))
        .map((s) => ({ sexo: SEXO[s] ?? (s === 'en_conflicto' ? 'En conflicto' : s === 'sin_coincidencia' ? 'Sin coincidencia en el padrón' : s), n: sexos[s] }));
    const columnas = [{ titulo: 'Sexo', texto: true, v: (f) => f.sexo }, { titulo: 'Candidaturas', v: (f) => f.n },
                      { titulo: '%', v: (f) => f.n, f: (v) => pctDe(v, total) }];
    return [cifras(cifra(fmt.format(total), 'Candidaturas a Intendencia'), ...filas.map((f) => cifra(fmt.format(f.n), f.sexo, pctDe(f.n, total)))),
            ficha(ctx, { definicion: 'Candidaturas a Intendencia (una por lista y distrito, aunque aparezca en miles de actas) por el sexo ' +
                                     'registrado en el padrón de cada persona candidata, buscada por su cédula (ADR 0026). Solo totales.',
                         origen: 'Planilla de candidaturas a Intendencia del TREP; padrón 2026.',
                         cobertura: 'Junta Municipal: no disponible, no hay catálogo nacional de sus candidaturas.' }),
            detalle('Tabla y método', tabla('Candidaturas a Intendencia por sexo', columnas, filas), acciones(botonCsv(ctx, 'candidaturas-intendencia', columnas, filas)),
                    noDisponible(ctx, r.junta.motivo, ['D10']))];
};

S.S11 = (ctx) => [noDisponible(ctx, ctx.resumen.s11.motivo, ['D11']),
                  ficha(ctx, { definicion: 'Voto domiciliario y mesa accesible, por modalidad y estado (previstos, registrados o atendidos). ' +
                                           'Un elector de la mesa 1 no es por eso beneficiario, y la edad no acredita una discapacidad.' })];
S.S12 = (ctx) => [noDisponible(ctx, ctx.resumen.s12.motivo, ['D12']),
                  ficha(ctx, { definicion: 'Ciudades donde el voto en casa está habilitado (no las ciudades con un beneficiario observado).' })];

S.S13 = (ctx) => {
    const r = ctx.resumen.s13;
    if (ctx.nivel !== 'pais') {
        const enlace = el('a', null, 'la capa de participación del mapa del TREP');
        enlace.href = '../../trep/';
        const p = sinDesglose('Sin desglose para este nivel en esta página. La participación de cada distrito está en ');
        p.append(enlace, '.');
        return [p, noDisponible(ctx, r.serie.motivo, ['D13'])];
    }
    const filas = [['Intendencia', r['2026'].intendencia], ['Junta Municipal', r['2026'].junta]].map(([cargo, x]) => ({ cargo, ...x }));
    const columnas = [{ titulo: 'Cargo', texto: true, v: (f) => f.cargo }, { titulo: 'Boletas', v: (f) => f.boletas },
                      { titulo: 'Registros de las mesas con acta', v: (f) => f.registros_en_mesas_con_acta },
                      { titulo: '%', v: (f) => f.porcentaje, f: (v) => `${pct.format(v)} %` }, { titulo: 'Mesas con acta', v: (f) => f.mesas_con_acta },
                      { titulo: 'Mesas del padrón', v: (f) => f.mesas_del_padron }, { titulo: 'Registros sin acta', v: (f) => f.registros_sin_acta }];
    return [cifras(...filas.map((f) => cifra(`${pct.format(f.porcentaje)} %`, `${f.cargo}, 2026`,
                                             `${fmt.format(f.boletas)} boletas sobre ${fmt.format(f.registros_en_mesas_con_acta)} registros`))),
            ficha(ctx, { definicion: r['2026'].mide + ' No se suman los dos cargos para contar asistentes.',
                         fecha: 'Municipales 2026 · TREP preliminar', origen: 'Planillas del TREP (TSJE); padrón 2026.',
                         cobertura: `Una mesa sin acta no es abstención: ${fmt.format(filas[1].registros_sin_acta)} registros de la Junta quedan sin acta.` }),
            detalle('Tabla y método', tabla('Boletas por cargo, 2026', columnas, filas), acciones(botonCsv(ctx, 'boletas-2026', columnas, filas))),
            noDisponible(ctx, r.serie.motivo, ['D13'])];
};

S.S14 = (ctx) => [noDisponible(ctx, ctx.resumen.s14.motivo, ['D14']),
                  ficha(ctx, { definicion: 'Participación por sexo en comicios anteriores. El sexo del padrón y el total de votos de una mesa no ' +
                                           'dicen cuántas mujeres o cuántos varones votaron: no se reparte en proporción.' })];

S.S15 = (ctx) => {
    const r = ctx.resumen.s15;
    const registros = ctx.nivel === 'pais' ? r['2026'].registros : ctx.fila.registros;
    return [cifras(cifra(fmt.format(registros), 'Registros del padrón, 2026')),
            ficha(ctx, { definicion: 'Un solo corte del padrón: el valor de 2026, sin variación calculable. No se reconstruye el pasado ' +
                                     'filtrando el padrón actual por su fecha de inscripción, porque omitiría bajas y cambios.',
                         origen: 'Padrón 2026.' }),
            noDisponible(ctx, r.serie.motivo, ['D15'])];
};

export function renderizar(ctx, contenedores) {
    limpiarGraficos();
    for (const s of ctx.manifiesto.segmentos) {
        const cuerpo = contenedores.cuerpo(s.id);
        const etiqueta = contenedores.estado(s.id);
        etiqueta.textContent = ESTADOS[s.estado] ?? s.estado;
        etiqueta.dataset.estado = s.estado;
        cuerpo.replaceChildren(...S[s.id](ctx));
    }
}

export function metodo(ctx) {
    const m = ctx.manifiesto;
    const lista = el('dl', 'segmento__ficha');
    const fuentes = el('ul');
    for (const f of m.fuentes) {
        const texto = f.descripcion.replace(/\s*\(https:[^)]+\)/, '');
        const li = el('li');
        const partes = f.id === 'referencia' ? texto.split('Números relevantes') : [texto];
        if (partes.length === 2) {
            const a = el('a', null, 'Números relevantes');
            a.href = 'https://elecciones.gov.py/numeros-relevantes';
            a.rel = 'noopener noreferrer';
            li.append(partes[0], a, partes[1]);
        } else {
            li.append(texto);
        }
        fuentes.append(li);
    }
    for (const [dt, dd] of [['Universo', m.universo], ['Fecha etaria', `${ctx.textoFechaEtaria}. ${m.fecha_etaria.origen} No consta qué fecha usa el TSJE.`],
                            ['Etapa de los resultados', m.evento.etapa_de_resultados],
                            ['Divulgación', `${m.divulgacion.regla} Niveles: país, ${m.divulgacion.niveles.pais}; departamento, ${m.divulgacion.niveles.departamento}; ` +
                                            `distrito, ${m.divulgacion.niveles.distrito}. Celdas reservadas: ${fmt.format(m.divulgacion.celdas_reservadas)}.`],
                            ['Privacidad', 'El padrón se procesa en una computadora local: el navegador solo recibe conteos. Ninguna cédula, nombre, fecha ' +
                                           'de nacimiento ni domicilio llega a esta página, que no tiene enlaces a la consulta individual.']]) {
        lista.append(el('dt', null, dt), el('dd', null, dd));
    }
    lista.append(el('dt', null, 'Fuentes'));
    const dd = el('dd');
    dd.append(fuentes);
    lista.append(dd);
    return lista;
}
