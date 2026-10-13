// Visualización financiera · Ejercicio 2025 (ADR-035; tarea M46): el modelo de vista de los 14 gráficos, sin DOM. Lo usan la
// página, la tabla, las descargas (PNG, SVG, CSV y la ficha municipal) y el cálculo de cobertura en Node, así que una sola
// regla arma lo que se dibuja y lo que se descarga. Desde M57 (ADR-045) también los años del histórico (2004-2024: los
// cuatro gráficos del balance y del estado de resultados, con las cuentas leídas de los tomos del MEF) y la evolución
// histórica de cada municipalidad, de 2004 a 2025.
// Reglas (prompt, apartados 7 y 8): importes en guaraníes enteros; null es ausencia, nunca cero; padre e hijos no se suman
// como componentes; si el detalle no coincide con el padre se muestran los dos y la diferencia; un Sankey solo con valores
// no negativos y una misma escala de los dos lados; negativos, sobre-ejecución o recaudación superior a la prevista pasan
// a una representación con signo (barras o cascada) avisando el cambio y su causa.
export const METODO = 'vf-1';

const nf = new Intl.NumberFormat('es-PY');
const nf1 = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sinCero = (x) => (Object.is(x, -0) ? 0 : x);
const hay = (x) => x !== null && x !== undefined;

// --- Formatos ------------------------------------------------------------------------------------------------------------
export const ND = 'N/D';
export const entero = (n) => (hay(n) ? nf.format(n) : ND);
export const gs = (n) => (hay(n) ? `Gs. ${nf.format(n)}` : ND);
// Millones para los rótulos de los gráficos (las tablas y las descargas llevan el entero exacto).
export function mm(n) {
    if (!hay(n)) return ND;
    if (n === 0) return '0';
    const m = n / 1e6;
    return `${Math.abs(m) >= 100 ? nf.format(sinCero(Math.round(m))) : nf1.format(sinCero(Math.round(m * 10) / 10))} MM`;
}
export const porciento = (x) => (hay(x) && Number.isFinite(x) ? `${nf1.format(sinCero(Math.round(x * 10) / 10))} %` : ND);
export const veces = (x) => (hay(x) && Number.isFinite(x) ? `${nf2.format(sinCero(x))} veces` : ND);
export const cociente = (a, b) => (hay(a) && hay(b) && b > 0 ? (100 * a) / b : null);
// Las celdas de una fila que «no aplican» («—»): un cociente cuyo denominador es conocido pero cero (o negativo) no se
// calcula, y eso no es un dato ausente (N/D, en rojo, queda para lo que falta en la fuente). pares: [campo, denominador].
export const noAplican = (...pares) => {
    const campos = pares.filter(([, b]) => hay(b) && !(b > 0)).map(([campo]) => campo);
    return campos.length ? campos : undefined;
};

// Búsqueda sin mayúsculas ni acentos; los nombres de la fuente no se tocan.
export const normalizar = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// --- Adaptadores -----------------------------------------------------------------------------------------------------------
export const IMPORTES = ['inicial', 'modificado', 'vigente', 'devengado', 'recaudado', 'obligado', 'pagado', 'pendiente', 'saldo'];

export function objetos(tabla) {
    const { campos, filas } = tabla;
    return filas.map((f) => Object.fromEntries(campos.map((c, k) => [c, f[k]])));
}

const porCodigo = (a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }) || a.fila - b.fila;
// La clave de un renglón conserva tipo de estado, nivel, código, fuente, organismo, departamento y la fila de origen: dos
// renglones con el mismo código y descripción siguen siendo dos (no se deduplica).
const claveRenglon = (r) => [r.tipo, r.nivel, r.codigo, r.detalle ?? '', r.ff ?? '', r.of ?? '', r.dpt ?? '', r.fila].join('|');

// Diferencias entre un padre publicado y la suma de sus hijos, campo por campo (sin redistribuir nada).
function diferencias(padre, campos = IMPORTES) {
    if (!padre.hijos?.length) return {};
    const out = {};
    for (const c of campos) {
        if (!hay(padre[c])) continue;
        const conDato = padre.hijos.filter((h) => hay(h[c]));
        const suma = conDato.reduce((s, h) => s + h[c], 0);
        const sinDato = padre.hijos.length - conDato.length;
        if (suma !== padre[c] || sinDato) out[c] = { padre: padre[c], suma, diferencia: padre[c] - suma, sinDato };
    }
    return out;
}

export function arbolPresupuesto(renglones, tipo) {
    const propios = renglones.filter((r) => r.tipo === tipo);
    const nodo = (r) => ({ ...r, clave: claveRenglon(r), hijos: [] });
    const total = propios.find((r) => r.nivel === 'total') ?? null;
    const grupos = propios.filter((r) => r.nivel === 'grupo').map(nodo).sort(porCodigo);
    const subgrupos = propios.filter((r) => r.nivel === 'subgrupo').map(nodo).sort(porCodigo);
    const huerfanos = [];
    for (const s of subgrupos) (grupos.find((g) => g.codigo[0] === s.codigo[0])?.hijos ?? huerfanos).push(s);
    const detalles = propios.filter((r) => r.nivel === 'detalle').map(nodo);
    for (const d of detalles) (subgrupos.find((s) => s.codigo.slice(0, 2) === d.codigo.slice(0, 2))?.hijos ?? huerfanos).push(d);
    const raiz = { tipo, nivel: 'raiz', codigo: 'TOTAL', descripcion: tipo === 'gastos' ? 'Total del gasto' : 'Total de ingresos',
                   clave: `${tipo}|raiz`, fila: total?.fila ?? null, pagina: total?.pagina ?? null, hijos: grupos };
    for (const c of IMPORTES) raiz[c] = total ? total[c] : null;
    const arbol = { tipo, total, raiz, grupos, huerfanos, diferencias: [] };
    revisar(arbol);
    return arbol;
}

function revisar(arbol) {
    arbol.diferencias = [];
    const visitar = (n) => {
        const d = diferencias(n);
        if (Object.keys(d).length) arbol.diferencias.push({ codigo: n.codigo, nivel: n.nivel, descripcion: n.descripcion, campos: d });
        n.hijos.forEach(visitar);
    };
    visitar(arbol.raiz);
}

// Los objetos del gasto (detalle/<código>.json) se agregan cuando hacen falta: el treemap al abrir un subgrupo.
export function agregarDetalle(M, detalle) {
    if (M.detalleCargado) return M;
    const renglones = objetos(detalle);
    const subgrupos = M.gastos.grupos.flatMap((g) => g.hijos);
    for (const r of renglones) {
        const n = { ...r, clave: claveRenglon(r), hijos: [] };
        (subgrupos.find((s) => s.codigo.slice(0, 2) === r.codigo.slice(0, 2))?.hijos ?? M.gastos.huerfanos).push(n);
    }
    revisar(M.gastos);
    M.detalleCargado = true;
    return M;
}

// Cuentas contables: 2.1.1.04.00.00.000 es de nivel 4 (el último segmento distinto de cero) y su padre es 2.1.1.00.00.00.000.
// Activo (2) y egresos (3) van en la columna izquierda; pasivo (4), patrimonio (8) e ingresos (5), en la derecha.
export function nivelCuenta(codigo) {
    const s = codigo.split('.');
    let n = 0;
    s.forEach((seg, k) => { if (/[1-9]/.test(seg)) n = k + 1; });
    return n;
}

export function padreCuenta(codigo) {
    const s = codigo.split('.');
    const n = nivelCuenta(codigo);
    if (n <= 1) return null;
    s[n - 1] = s[n - 1].replace(/\d/g, '0');
    return s.join('.');
}

const ladoCuenta = (codigo) => ('23'.includes(codigo[0]) ? 'izquierda' : 'derecha');

export function arbolContable(renglones) {
    const nodos = renglones.map((r) => {
        const lado = ladoCuenta(r.codigo);
        const otro = lado === 'izquierda' ? r.derecha : r.izquierda;
        return { ...r, clave: `${r.tipo}|${r.codigo}|${r.fila}`, nivel: nivelCuenta(r.codigo), valor: r[lado], lado,
                 otraColumna: hay(otro) && otro !== 0 ? otro : null, hijos: [] };
    });
    const porCuenta = new Map(nodos.map((n) => [n.codigo, n]));
    const raices = [];
    for (const n of nodos) {
        let p = padreCuenta(n.codigo);
        while (p && !porCuenta.has(p)) p = padreCuenta(p);
        (p ? porCuenta.get(p).hijos : raices).push(n);
    }
    const ordenar = (lista) => { lista.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true })); lista.forEach((n) => ordenar(n.hijos)); };
    ordenar(raices);
    const difs = [];
    const visitar = (n) => {
        const d = diferencias(n, ['valor']);
        if (d.valor) difs.push({ codigo: n.codigo, descripcion: n.descripcion, ...d.valor });
        n.hijos.forEach(visitar);
    };
    raices.forEach(visitar);
    return { raices, porCuenta, diferencias: difs, otraColumna: nodos.filter((n) => n.otraColumna !== null) };
}

export function crearMunicipio(resumen, entrada) {
    const presupuesto = objetos(resumen.presupuesto);
    const contable = objetos(resumen.contable);
    return {
        id: resumen.id, entrada, ejercicio: resumen.ejercicio, corte: resumen.corte, paginas: resumen.paginas, alertas: resumen.alertas,
        estados: resumen.estados, indicadores: resumen.indicadores, prioritarios: resumen.prioritarios, observaciones: resumen.observaciones,
        ingresos: arbolPresupuesto(presupuesto, 'ingresos'),
        gastos: arbolPresupuesto(presupuesto, 'gastos'),
        balance: arbolContable(contable.filter((r) => r.tipo === 'balance')),
        resultado: arbolContable(contable.filter((r) => r.tipo === 'resultado')),
        detalleCargado: false,
    };
}

// --- Años del histórico (M57, ADR-045) -------------------------------------------------------------------------------------
// 2025 tiene los 14 gráficos (paquete del MEF); de 2004 a 2024 hay solo el balance y el estado de resultados de los tomos.
export const EJERCICIO_COMPLETO = 2025;
export const graficosDe = (graficos, ejercicio) => (ejercicio === EJERCICIO_COMPLETO ? graficos
    : graficos.filter((g) => g.historico).map((g) => ({ ...g, ...g.historico })));

// «2.1.1.4» (el código corto de la extracción) → «2.1.1.04.00.00.000», el formato de las cuentas de 2025.
const ANCHOS = [1, 1, 1, 2, 2, 2, 3];
export const codigoLargo = (c) => { const p = String(c).split('.'); return ANCHOS.map((w, k) => (p[k] ?? '0').padStart(w, '0')).join('.'); };

// El catálogo de un año del histórico: las municipalidades con balance ese año, con su distrito de hoy como identificador
// (no es un código del MEF); abarca: las claves de los distritos creados después que ese año eran parte de ella.
export function crearCatalogoHistorico(datos, anio) {
    const nombreDep = new Map(datos.departamentos.map((d) => [d.codigo, d.nombre]));
    const municipios = datos.municipios.filter((m) => m.anios.includes(anio)).map((m) => {
        const nombre = m.nombres?.[anio] ?? m.nombre;
        return { id: m.id, sistema: 'clave_distrito', nombre, nombre_fuente: null, departamento: m.departamento,
                 departamento_nombre: nombreDep.get(m.departamento) ?? '', estado: 'informante', distrito: m.id,
                 abarca: m.abarca?.[anio] ?? null, busqueda: normalizar(`${nombre} ${m.nombre}`) };
    });
    municipios.sort((a, b) => a.departamento - b.departamento || a.nombre.localeCompare(b.nombre, 'es'));
    return { ejercicio: anio, departamentos: datos.departamentos, municipios, porId: new Map(municipios.map((m) => [m.id, m])), nota: datos.nota };
}

// La municipalidad de un catálogo para un distrito de hoy: la suya o, si el distrito todavía no existía, la que lo abarcaba.
export function equivalente(catalogo, distrito) {
    if (!distrito) return null;
    const propia = catalogo.municipios.find((m) => m.distrito === distrito);
    if (propia) return { entrada: propia, abarcaba: false };
    const madre = catalogo.municipios.find((m) => m.abarca?.includes(distrito));
    return madre ? { entrada: madre, abarcaba: true } : null;
}

const ESTADO_CUENTA = { s: 'calculado con los subtotales del propio estado', c: 'calculado: suma del pasivo corriente y el no corriente' };
const INDICADORES_HISTORICOS = ['razon_corriente', 'prueba_acida', 'cobertura_disponible', 'resultado_contable_gs', 'pasivo_sobre_activo_pct'];

// El modelo de un año del histórico a partir del archivo de su distrito (municipalidad/historico/municipios/<clave>.json):
// las cuentas hasta el tercer nivel con su rótulo impreso, los indicadores con el motivo de cada vacío y las notas; man:
// el manifiesto del histórico (fuente del año y textos de las notas).
export function crearMunicipioHistorico(archivo, anio, entrada, man) {
    const a = archivo?.anios?.[String(anio)];
    if (!a) throw new Error(`No hay cuentas de ${anio} de ${entrada.nombre}.`);
    const filas = a.cuentas.map(([t, codigo, k, valor, est]) => {
        const tipo = t === 'b' ? 'balance' : 'resultado';
        const largo = codigoLargo(codigo);
        const lado = ladoCuenta(largo);
        return { fila: null, tipo, codigo: largo, descripcion: archivo.rotulos[k] || '(sin rótulo en el tomo)',
                 pagina: tipo === 'balance' ? a.paginas.balance : a.paginas.resultados,
                 izquierda: lado === 'izquierda' ? valor : null, derecha: lado === 'derecha' ? valor : null, estadoDato: est ? ESTADO_CUENTA[est] : null };
    });
    const anioMan = man?.anios?.find((x) => x.anio === anio) ?? null;
    const lectura = a.lectura ?? {};
    const observaciones = (a.notas ?? []).map((n) => ({ detalle: man?.notas?.[n] ?? n, fuente: `Informe Financiero ${anio}` }));
    if (Object.values(lectura).includes('rotulos')) observaciones.push({ detalle: man?.lecturas?.rotulos ?? 'Solo se leyeron las cuentas principales.', fuente: 'Lectura del tomo' });
    if (a.omitidas?.length) {
        observaciones.push({ detalle: `No se muestran ${a.omitidas.join(', ')}: leídas por su rótulo, el tomo las imprime dentro de otra cuenta leída y sumarlas ` +
                                      'aparte las contaría dos veces.', fuente: 'Lectura del tomo' });
    }
    if (a.abarca?.length) observaciones.push({ detalle: `En ${anio} su territorio incluía el de ${a.abarca.join(', ')} (distritos creados después): sus cifras lo abarcan.`, fuente: 'Distritos de cada año (ADR-043)' });
    return {
        id: entrada.id, entrada, ejercicio: anio, corte: `${anio}-12-31`, historico: true, nombre_mef: a.nombre_mef, codigo_mef: a.codigo_mef ?? null,
        paginas: a.paginas, lectura, abarca: a.abarca ?? null, fuente: anioMan, alertas: [], estados: {}, observaciones,
        indicadores: Object.fromEntries(INDICADORES_HISTORICOS.map((c) => [c, { valor: a.indicadores?.[c]?.[0] ?? null, motivo: a.indicadores?.[c]?.[1] ?? null }])),
        prioritarios: Object.fromEntries(Object.entries(a.ficha ?? {}).map(([c, v]) => [c, { valor: v, motivo: hay(v) ? null : 'No expuesto en el informe de ese año.' }])),
        ingresos: null, gastos: null,
        balance: arbolContable(filas.filter((r) => r.tipo === 'balance')),
        resultado: arbolContable(filas.filter((r) => r.tipo === 'resultado')),
        detalleCargado: true,
    };
}

// La serie de la evolución histórica: los años de 2004 a 2025 (con y sin datos) del manifiesto del histórico y los puntos
// del distrito (null si no tiene archivo: ningún año con balance).
export function historiaDe(man, archivo) {
    return { anios: man.anios.map((a) => ({ anio: a.anio, estado: a.estado, motivo: a.motivo ?? null, tomo: a.tomo ?? null, escala: a.escala ?? null })),
             serie: archivo?.serie ?? null, campos: man.serie, estados: man.estados, ipc: man.ipc, anteriores: man.anteriores };
}

// --- Catálogo de municipalidades -------------------------------------------------------------------------------------------
export function crearCatalogo(datos) {
    const departamentos = datos.departamentos;
    const nombreDep = new Map(departamentos.map((d) => [d.codigo, d.nombre]));
    const municipios = datos.municipios.map((m) => ({ ...m, departamento_nombre: nombreDep.get(m.departamento) ?? '',
                                                      busqueda: normalizar(`${m.nombre} ${m.nombre_fuente}`) }));
    municipios.sort((a, b) => a.departamento - b.departamento || a.nombre.localeCompare(b.nombre, 'es'));
    return { departamentos, municipios, porId: new Map(municipios.map((m) => [m.id, m])), nota: datos.nota_sin_informe };
}

export function buscar(catalogo, texto, departamento = null) {
    const q = normalizar(texto);
    return catalogo.municipios.filter((m) => (departamento === null || m.departamento === departamento) && (!q || m.busqueda.includes(q)))
        .sort((a, b) => (q ? (a.busqueda.startsWith(q) ? 0 : 1) - (b.busqueda.startsWith(q) ? 0 : 1) : 0) ||
                        a.nombre.localeCompare(b.nombre, 'es'));
}

// --- Estado del enlace -----------------------------------------------------------------------------------------------------
// #ejercicio=2025&departamento=10&municipio=30-150&grafico=03_jerarquia_gasto&apertura=grupo:500&metrica=obligado
// Todo se valida contra el manifiesto, el catálogo y el modelo; nada del enlace se usa para armar una ruta sin validar.
export const PARAMETROS = ['ejercicio', 'departamento', 'municipio', 'grafico', 'apertura', 'metrica'];
export const GRAFICO_INICIAL = '01_origen_asignacion';

export function estadoInicial(ejercicio) {
    return { ejercicio, departamento: null, municipio: null, grafico: GRAFICO_INICIAL, apertura: null, metrica: null };
}

// ctx: { ejercicios, catalogo, graficos } con un solo ejercicio, o (M57) { ejercicios, catalogos: Map ejercicio → catálogo,
// graficosDe: ejercicio → vistas, sinDatos: Map año → motivo }: el municipio y el gráfico se validan contra los del ejercicio.
export function leerEstado(hash, ctx) {
    const { ejercicios } = ctx;
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    const avisos = [];
    const e = estadoInicial(ejercicios[0]);
    const ej = p.get('ejercicio');
    if (ej !== null) {
        if (ejercicios.includes(Number(ej)) && /^\d{4}$/.test(ej)) e.ejercicio = Number(ej);
        else if (/^\d{4}$/.test(ej) && ctx.sinDatos?.has(Number(ej))) avisos.push(`${ctx.sinDatos.get(Number(ej))} (${ej}). Se muestra ${e.ejercicio}.`);
        else avisos.push(`El ejercicio «${ej}» no está disponible: se muestra ${e.ejercicio}.`);
    }
    const catalogo = ctx.catalogos?.get(e.ejercicio) ?? ctx.catalogo;
    const graficos = ctx.graficosDe?.(e.ejercicio) ?? ctx.graficos;
    if (!graficos.some((x) => x.id === e.grafico)) e.grafico = graficos[0].id;
    const dep = p.get('departamento');
    if (dep !== null) {
        if (/^\d{1,2}$/.test(dep) && catalogo.departamentos.some((d) => d.codigo === Number(dep))) e.departamento = Number(dep);
        else avisos.push(`El departamento «${dep}» no existe: se muestran todos.`);
    }
    const mun = p.get('municipio');
    if (mun !== null) {
        let m = catalogo.porId.get(mun);
        if (!m && ctx.catalogos) {
            // Un identificador de otro año (el código del MEF de 2025 o la clave del distrito): la municipalidad de este año.
            const otra = [...ctx.catalogos.values()].map((c) => c.porId.get(mun)).find(Boolean);
            const eq = otra ? equivalente(catalogo, otra.distrito) : null;
            if (eq) {
                m = eq.entrada;
                if (eq.abarcaba) avisos.push(`En ${e.ejercicio} ${otra.nombre} todavía no era municipio: se muestra ${m.nombre}, que abarcaba su territorio.`);
            } else if (otra) {
                avisos.push(`${otra.nombre} no tiene balance en el informe de ${e.ejercicio}: elegí otra municipalidad o cambiá el ejercicio.`);
            }
        }
        if (m) {
            e.municipio = m.id;
            if (e.departamento !== null && e.departamento !== m.departamento) e.departamento = m.departamento;
        } else if (!avisos.some((a) => a.includes('no tiene balance'))) {
            avisos.push(`La municipalidad «${mun}» no está en el catálogo de ${e.ejercicio}: elegí una de la lista.`);
        }
    }
    const g = p.get('grafico');
    if (g !== null) {
        const todos = ctx.graficosDe?.(EJERCICIO_COMPLETO) ?? graficos;
        if (graficos.some((x) => x.id === g)) e.grafico = g;
        else if (todos.some((x) => x.id === g)) {
            avisos.push(`«${todos.find((x) => x.id === g).titulo}» no está en ${e.ejercicio}: de los años anteriores a ${EJERCICIO_COMPLETO} hay solo el ` +
                        `balance y el estado de resultados. Se muestra «${graficos.find((x) => x.id === e.grafico).titulo}».`);
        } else avisos.push(`El gráfico «${g}» no existe: se muestra «${graficos.find((x) => x.id === e.grafico).titulo}».`);
    }
    const ap = p.get('apertura');
    if (ap !== null) e.apertura = /^[a-z]+(:\d{3})?$/.test(ap) ? ap : null;
    if (ap !== null && e.apertura === null) avisos.push(`La apertura «${ap}» no es válida: se muestra la inicial.`);
    const me = p.get('metrica');
    if (me !== null) e.metrica = /^[a-z]+$/.test(me) ? me : null;
    if (me !== null && e.metrica === null) avisos.push(`La métrica «${me}» no es válida: se muestra la inicial.`);
    return { estado: e, avisos };
}

// Solo lo que difiere del inicio; el ejercicio y el gráfico van siempre que haya una municipalidad.
export function textoEstado(e) {
    const p = new URLSearchParams();
    const conMunicipio = e.municipio !== null;
    if (conMunicipio || e.departamento !== null) p.set('ejercicio', String(e.ejercicio));
    if (e.departamento !== null) p.set('departamento', String(e.departamento));
    if (conMunicipio) p.set('municipio', e.municipio);
    if (conMunicipio || e.grafico !== GRAFICO_INICIAL) p.set('grafico', e.grafico);
    if (e.apertura) p.set('apertura', e.apertura);
    if (e.metrica) p.set('metrica', e.metrica);
    return p.toString();
}

// --- Vistas ----------------------------------------------------------------------------------------------------------------
const TOMOS = { 'V-A': 'Tomo V-A — Municipalidades: Situación Financiera', 'V-B': 'Tomo V-B — Municipalidades: Situación Presupuestaria' };

export function fuenteDe(cat, M) {
    if (cat.id === 'evolucion_historica') {
        return 'Ministerio de Economía y Finanzas de Paraguay (MEF), Informes Financieros de 2004 a 2025, tomos de las municipalidades (balance general ' +
               'y estado de resultados); IPC: Banco Central del Paraguay. Serie, unión con los distritos y deflactor: Kalaguichi.';
    }
    if (M?.historico) {
        const pags = [M.paginas?.balance && `balance, p. ${M.paginas.balance}`, M.paginas?.resultados && `estado de resultados, p. ${M.paginas.resultados}`].filter(Boolean);
        return `Ministerio de Economía y Finanzas de Paraguay (MEF), Informe Financiero ${M.ejercicio}: ${M.fuente?.tomo ?? 'tomo de las municipalidades'}` +
               `${pags.length ? ` (${pags.join('; ')})` : ''}.`;
    }
    const partes = [];
    if (cat.tomo.includes('V-B')) partes.push(`${TOMOS['V-B']}, p. ${M?.paginas?.presupuesto ?? '—'}`);
    if (cat.tomo.includes('V-A')) partes.push(`${TOMOS['V-A']}, p. ${M?.paginas?.financieras ?? '—'}`);
    return `Ministerio de Economía y Finanzas de Paraguay (MEF), Informe Financiero 2025: ${partes.join('; ')}.`;
}

function base(cat, M) {
    return { id: cat.id, titulo: cat.titulo, corto: cat.corto, formato: cat.formato, formatoBase: cat.formato, estado: 'disponible', motivo: null,
             causa: null, cambio: null, avisos: [], unidad: cat.unidad, etapas: cat.etapas, denominador: cat.denominador, que_muestra: cat.que_muestra,
             limite: cat.limite, tomo: cat.tomo, fuente: fuenteDe(cat, M), apertura: null, metrica: null, tabla: null, grafico: null, resumen: '',
             requiereDetalle: false };
}

function sinDatos(v, motivo, causa = 'campos') {
    return { ...v, estado: 'sin_datos', motivo, causa, grafico: null, formato: 'sin_datos', cambio: null };
}

function cambiar(v, a, causa) {
    v.cambio = { de: v.formatoBase, a, causa };
    v.formato = a;
    return v;
}

const rotulo = (n) => `${n.codigo} ${n.descripcion}`;
const ROL_GASTO = (codigo) => `gas${codigo[0]}00`;
const ROL_INGRESO = (codigo) => `ing${codigo[0]}00`;
const estadoValor = (x) => (hay(x) ? (x === 0 ? 'cero publicado' : 'publicado') : 'celda vacía en la fuente');

// Columnas de las tablas: tipo importe (entero exacto), pct, veces, texto o codigo.
const COL = {
    lado: { id: 'lado', titulo: 'Lado', tipo: 'texto' },
    nivel: { id: 'nivel', titulo: 'Nivel', tipo: 'texto' },
    codigo: { id: 'codigo', titulo: 'Código', tipo: 'codigo' },
    descripcion: { id: 'descripcion', titulo: 'Descripción (fuente)', tipo: 'texto' },
    pagina: { id: 'pagina', titulo: 'Página', tipo: 'codigo' },
    fila: { id: 'fila', titulo: 'Fila de origen', tipo: 'codigo' },
    estado: { id: 'estado', titulo: 'Estado del dato', tipo: 'texto' },
};
const importe = (id, titulo) => ({ id, titulo, tipo: 'importe' });
const pctCol = (id, titulo) => ({ id, titulo, tipo: 'pct' });
const origenPresupuesto = (n) => (hay(n.fila) ? `ejecucion_detalle.csv:${n.fila}` : '');
const origenContable = (n) => (hay(n.fila) ? `financiero_detalle.csv:${n.fila}` : '');
const NIVELES = { total: 'Total', raiz: 'Total', grupo: 'Grupo', subgrupo: 'Subgrupo', detalle: 'Detalle' };

function filaPresupuesto(n, extra = {}) {
    return { nivel: NIVELES[n.nivel] ?? n.nivel, codigo: n.nivel === 'raiz' ? 'TOTAL' : n.codigo + (hay(n.detalle) ? `-${n.detalle}` : ''),
             descripcion: n.descripcion, ff: n.ff ?? '', of: n.of ?? '', dpt: n.dpt ?? '', pagina: n.pagina ?? '', fila: origenPresupuesto(n), ...extra };
}

function filaContable(n, extra = {}) {
    return { nivel: `Nivel ${n.nivel}`, codigo: n.codigo, descripcion: n.descripcion, valor: n.valor, columna: n.lado === 'izquierda' ? 'Izquierda' : 'Derecha',
             estado: n.estadoDato ?? estadoValor(n.valor), pagina: n.pagina, fila: origenContable(n), ...extra };
}

const NOMBRE_CAMPO = { inicial: 'presupuesto inicial', modificado: 'modificaciones', vigente: 'presupuesto vigente', devengado: 'devengado', recaudado: 'recaudado',
                       obligado: 'obligado', pagado: 'pagado', pendiente: 'pendiente de pago', saldo: 'saldo sin obligar' };

// Dos avisos distintos: el detalle no suma el publicado (se muestran los dos y la diferencia) o, sumando igual, algún
// renglón no tiene dato en la fuente (cobertura parcial: la celda vacía no se toma como cero).
function avisosDiferencias(v, arbol, codigos, campos) {
    for (const d of arbol.diferencias) {
        if (codigos && !codigos.includes(d.codigo)) continue;
        const partida = d.codigo === 'TOTAL' ? 'El total' : `${d.codigo} ${d.descripcion}`;
        for (const [c, x] of Object.entries(d.campos)) {
            if (campos && !campos.includes(c)) continue;
            if (x.diferencia !== 0) {
                v.avisos.push(`${partida}: el ${NOMBRE_CAMPO[c]} publicado (${gs(x.padre)}) y la suma de su detalle (${gs(x.suma)}) difieren en ` +
                              `${gs(x.diferencia)}${x.sinDato ? `; ${x.sinDato} renglón(es) sin dato` : ''}. Se muestran los dos.`);
            } else if (x.sinDato) {
                v.avisos.push(`${partida}: ${x.sinDato} renglón(es) de su detalle sin dato de ${NOMBRE_CAMPO[c]} en la fuente (celda vacía, no cero); ` +
                              'los que tienen dato suman exactamente lo publicado.');
            }
        }
    }
}

// Un Sankey de tres columnas con una misma escala: si un lado no alcanza al centro, la diferencia va como nodo propio
// (rayado); si un lado lo supera, no hay Sankey posible y devuelve null (la vista pasa a barras con signo).
// Un nodo sin dato (celda vacía) no se dibuja ni se toma como cero: queda en sinDato y su importe, dentro de la diferencia.
function sankey(izquierda, centro, derecha, { difIzq = 'Diferencia sin detalle publicado', difDer = 'Diferencia sin detalle publicado' } = {}) {
    if (!hay(centro.valor) || centro.valor <= 0) return null;
    const todos = [...izquierda, ...derecha];
    if (todos.some((n) => hay(n.valor) && n.valor < 0)) return null;
    const sinDato = todos.filter((n) => !hay(n.valor)).map((n) => n.rotulo);
    const izq = izquierda.filter((n) => hay(n.valor) && n.valor > 0);
    const der = derecha.filter((n) => hay(n.valor) && n.valor > 0);
    const sI = izq.reduce((s, n) => s + n.valor, 0);
    const sD = der.reduce((s, n) => s + n.valor, 0);
    if (sI > centro.valor || sD > centro.valor) return null;
    if (sI < centro.valor) izq.push({ id: 'dif-izq', rotulo: difIzq, valor: centro.valor - sI, rol: 'diferencia', patron: 'rayado', diferencia: true });
    if (sD < centro.valor) der.push({ id: 'dif-der', rotulo: difDer, valor: centro.valor - sD, rol: 'diferencia', patron: 'rayado', diferencia: true });
    const enlaces = [...izq.map((n) => ({ de: n.id, a: centro.id, valor: n.valor, rol: n.rol, patron: n.patron })),
                     ...der.map((n) => ({ de: centro.id, a: n.id, valor: n.valor, rol: n.rol, patron: n.patron }))];
    return { tipo: 'sankey', columnas: [izq, [centro], der], enlaces, total: centro.valor, sinDato };
}

// Los nodos sin dato de un Sankey: la vista queda parcial y lo dice.
function marcarSinDato(v) {
    const faltan = v.grafico?.sinDato ?? [];
    if (!faltan.length) return v;
    v.estado = 'parcial';
    v.motivo = `Sin dato en la fuente (celda vacía, no cero): ${faltan.join('; ')}. Su importe queda dentro de la diferencia.`;
    return v;
}

const nodo = (id, texto, valor, rol, extra = {}) => ({ id, rotulo: texto, valor, rol, ...extra });
const segmentosValidos = (lista) => lista.filter((s) => hay(s.valor) && s.valor !== 0);

function resumenTexto(partes) {
    return partes.filter(Boolean).join(' ');
}

// 01 · Origen previsto y asignación del presupuesto
function v01(cat, M, op) {
    const v = base(cat, M);
    const apertura = cat.aperturas.some((a) => a.id === op.apertura) ? op.apertura : 'grupos';
    v.apertura = { actual: apertura, opciones: cat.aperturas };
    const totalI = M.ingresos.raiz.vigente;
    const totalG = M.gastos.raiz.vigente;
    if (!hay(totalI) || !hay(totalG)) return sinDatos(v, 'El cuadro no publica el presupuesto vigente total de ingresos o de gastos.');
    const recursos = apertura === 'subgrupos' ? M.ingresos.grupos.flatMap((g) => (g.hijos.length ? g.hijos : [g])) : M.ingresos.grupos;
    const izq = recursos.map((n) => nodo(n.clave, rotulo(n), n.vigente, ROL_INGRESO(n.codigo), { fila: n.fila }));
    const der = M.gastos.grupos.map((n) => nodo(n.clave, rotulo(n), n.vigente, ROL_GASTO(n.codigo), { fila: n.fila }));
    v.tabla = {
        columnas: [COL.lado, COL.nivel, COL.codigo, COL.descripcion, importe('vigente', 'Presupuesto vigente'), pctCol('pct', '% de su lado'), COL.estado, COL.pagina, COL.fila],
        filas: [...[M.ingresos.raiz, ...recursos].map((n) => filaPresupuesto(n, { lado: 'Ingresos', vigente: n.vigente, pct: cociente(n.vigente, totalI), estado: estadoValor(n.vigente) })),
                ...[M.gastos.raiz, ...M.gastos.grupos].map((n) => filaPresupuesto(n, { lado: 'Gastos', vigente: n.vigente, pct: cociente(n.vigente, totalG), estado: estadoValor(n.vigente) }))],
    };
    avisosDiferencias(v, M.ingresos, apertura === 'subgrupos' ? null : ['TOTAL'], ['vigente']);
    avisosDiferencias(v, M.gastos, ['TOTAL'], ['vigente']);
    if (totalI !== totalG) {
        v.avisos.push(`Los ingresos presupuestados (${gs(totalI)}) y los gastos presupuestados (${gs(totalG)}) no coinciden: se dibujan los dos ` +
                      `totales y la diferencia (${gs(Math.abs(totalI - totalG))}) aparte, sin forzar un total único.`);
    }
    const centroValor = Math.max(totalI, totalG);
    const centro = nodo('centro', 'Presupuesto vigente', centroValor, 'presupuesto');
    const s = sankey(izq, centro, der, { difIzq: totalI < totalG ? 'Gasto presupuestado sin recurso presupuestado (diferencia)' : 'Diferencia sin detalle publicado',
                                         difDer: totalG < totalI ? 'Recurso presupuestado sin gasto asignado (diferencia)' : 'Diferencia sin detalle publicado' });
    if (s) {
        v.grafico = s;
    } else {
        cambiar(v, 'barras_firmadas', 'hay importes negativos o componentes que superan su total: un Sankey no puede dibujar anchos negativos');
        v.grafico = { tipo: 'firmadas', columnas: [
            { id: 'ing', rotulo: 'Recursos presupuestados', total: totalI, segmentos: segmentosValidos(izq) },
            { id: 'gas', rotulo: 'Gastos presupuestados', total: totalG, segmentos: segmentosValidos(der) }] };
    }
    const mayorI = [...izq].sort((a, b) => b.valor - a.valor)[0];
    const mayorG = [...der].sort((a, b) => b.valor - a.valor)[0];
    v.resumen = resumenTexto([`Presupuesto vigente: ${gs(totalG)}.`, mayorI && `El mayor recurso es ${mayorI.rotulo} (${porciento(cociente(mayorI.valor, totalI))}).`,
                              mayorG && `El mayor grupo de gasto es ${mayorG.rotulo} (${porciento(cociente(mayorG.valor, totalG))}).`]);
    return v;
}

// 02 · Presupuesto, obligaciones y pagos (viñetas)
function v02(cat, M, op) {
    const v = base(cat, M);
    const opciones = [{ id: 'grupos', texto: 'Grupos de gasto' },
                      ...M.gastos.grupos.filter((g) => g.hijos.length).map((g) => ({ id: `grupo:${g.codigo}`, texto: `Subgrupos de ${rotulo(g)}` }))];
    const apertura = opciones.some((o) => o.id === op.apertura) ? op.apertura : 'grupos';
    v.apertura = { actual: apertura, opciones };
    const grupo = apertura.startsWith('grupo:') ? M.gastos.grupos.find((g) => g.codigo === apertura.slice(6)) : null;
    const cabeza = grupo ?? M.gastos.raiz;
    const lista = grupo ? grupo.hijos : M.gastos.grupos;
    if (!hay(cabeza.vigente)) return sinDatos(v, 'El cuadro no publica el presupuesto vigente de esta partida.');
    const filas = [cabeza, ...lista].map((n) => {
        const pObl = cociente(n.obligado, n.vigente);
        const pPag = cociente(n.pagado, n.vigente);
        let nd = null;
        let falta = false;
        if (!hay(n.obligado) || !hay(n.pagado)) {
            nd = 'Obligado o pagado sin dato en la fuente (celda vacía, no cero).';
            falta = true;
        } else if (!hay(n.vigente) || n.vigente <= 0) {
            nd = 'Sin cociente: el presupuesto vigente no es positivo; se muestran los importes.';
        }
        return { id: n.clave, rotulo: n.nivel === 'raiz' ? 'Total del gasto' : rotulo(n), esTotal: n === cabeza, vigente: n.vigente, obligado: n.obligado,
                 pagado: n.pagado, pendiente: n.pendiente, saldo: n.saldo, pctObligado: pObl, pctPagado: pPag, nd, falta,
                 rol: n.nivel === 'raiz' ? 'presupuesto' : ROL_GASTO(n.codigo) };
    });
    const maximo = Math.max(100, ...filas.flatMap((f) => [f.pctObligado ?? 0, f.pctPagado ?? 0]));
    v.grafico = { tipo: 'vinetas', filas, escalaMax: Math.ceil(maximo / 10) * 10 };
    if (filas.some((f) => (f.pctObligado ?? 0) > 100)) v.avisos.push('Hay partidas con obligado mayor al presupuesto vigente: la escala se amplía más allá del 100 % y no se recorta.');
    if (filas.some((f) => f.falta)) {
        v.estado = 'parcial';
        v.motivo = `Sin dato de obligado o pagado en la fuente (celda vacía): ${filas.filter((f) => f.falta).map((f) => f.rotulo).join('; ')}.`;
    }
    if (filas.some((f) => f.nd && !f.falta)) v.avisos.push('Las partidas con presupuesto vigente cero o negativo no tienen cociente: se muestran sus importes.');
    v.tabla = {
        columnas: [COL.nivel, COL.codigo, COL.descripcion, importe('vigente', 'Presupuesto vigente'), importe('obligado', 'Obligado'), importe('pagado', 'Pagado'),
                   importe('pendiente', 'Pendiente de pago'), importe('saldo', 'Saldo sin obligar'), pctCol('pctObligado', '% obligado'), pctCol('pctPagado', '% pagado'),
                   { id: 'nota', titulo: 'Nota', tipo: 'texto' }, COL.pagina, COL.fila],
        filas: [cabeza, ...lista].map((n, k) => filaPresupuesto(n, { vigente: n.vigente, obligado: n.obligado, pagado: n.pagado, pendiente: n.pendiente, saldo: n.saldo,
                                                                     pctObligado: filas[k].pctObligado, pctPagado: filas[k].pctPagado, nota: filas[k].nd ?? '',
                                                                     na: noAplican(['pctObligado', n.vigente], ['pctPagado', n.vigente]) })),
    };
    avisosDiferencias(v, M.gastos, [cabeza.codigo], ['vigente', 'obligado', 'pagado']);
    const t = filas[0];
    v.resumen = `${t.rotulo}: presupuesto vigente ${gs(t.vigente)}, obligado ${porciento(t.pctObligado)} y pagado ${porciento(t.pctPagado)} del vigente.`;
    return v;
}

// 03 · Apertura del gasto (treemap): un nivel por vez, con migas.
export const CLASES_EJECUCION = [
    { id: 'ej0', hasta: 25, texto: 'Menos del 25 % obligado' }, { id: 'ej1', hasta: 50, texto: 'Del 25 al 50 %' },
    { id: 'ej2', hasta: 75, texto: 'Del 50 al 75 %' }, { id: 'ej3', hasta: 90, texto: 'Del 75 al 90 %' },
    { id: 'ej4', hasta: 100.0000001, texto: 'Del 90 al 100 %' }, { id: 'ej5', hasta: Infinity, texto: 'Más del 100 % (sobre el vigente)' },
];
export const claseEjecucion = (pct) => (hay(pct) ? CLASES_EJECUCION.find((c) => pct < c.hasta).id : 'ejnd');

function v03(cat, M, op) {
    const v = base(cat, M);
    const metrica = cat.metricas.some((m) => m.id === op.metrica) ? op.metrica : 'vigente';
    v.metrica = { actual: metrica, opciones: cat.metricas };
    const g = /^grupo:(\d{3})$/.exec(op.apertura ?? '');
    const s = /^subgrupo:(\d{3})$/.exec(op.apertura ?? '');
    let padre = M.gastos.raiz;
    const migas = [{ id: 'todo', texto: 'Todo el gasto' }];
    let apertura = 'todo';
    const grupo = g ? M.gastos.grupos.find((x) => x.codigo === g[1]) : s ? M.gastos.grupos.find((x) => x.codigo[0] === s[1][0]) : null;
    const sub = s && grupo ? grupo.hijos.find((x) => x.codigo === s[1]) : null;
    if (grupo) {
        padre = grupo;
        apertura = `grupo:${grupo.codigo}`;
        migas.push({ id: apertura, texto: rotulo(grupo) });
    }
    if (sub) {
        padre = sub;
        apertura = `subgrupo:${sub.codigo}`;
        migas.push({ id: apertura, texto: rotulo(sub) });
    }
    v.apertura = { actual: apertura, migas, opciones: null };
    if (sub && !M.detalleCargado) return { ...v, requiereDetalle: true, estado: 'cargando', motivo: 'Cargando los objetos del gasto…', formato: 'treemap' };
    const hijos = padre.hijos;
    const total = padre[metrica];
    if (!hay(total)) return sinDatos(v, `La partida no publica el ${metrica === 'vigente' ? 'presupuesto vigente' : 'gasto obligado'}.`);
    const items = hijos.map((h) => {
        const ejecucion = cociente(h.obligado, h.vigente);
        const abrible = h.nivel === 'grupo' ? h.hijos.length > 0 : h.nivel === 'subgrupo';
        const destino = h.nivel === 'grupo' ? `grupo:${h.codigo}` : h.nivel === 'subgrupo' ? `subgrupo:${h.codigo}` : null;
        const extra = h.nivel === 'detalle' ? [h.ff && `FF ${h.ff}`, h.of && `OF ${h.of}`, h.dpt && `DPT ${h.dpt}`].filter(Boolean).join(' · ') : '';
        return { id: h.clave, rotulo: rotulo(h), extra, valor: h[metrica], vigente: h.vigente, obligado: h.obligado, pagado: h.pagado, ejecucion,
                 rol: claseEjecucion(ejecucion), abrible: abrible && hay(h[metrica]) && h[metrica] > 0, destino, nivel: h.nivel };
    });
    const positivos = items.filter((i) => hay(i.valor) && i.valor > 0);
    const basePositiva = positivos.reduce((t, i) => t + i.valor, 0);
    if (!positivos.length) return { ...sinDatos(v, 'Ninguna rama de esta partida tiene un importe positivo para dibujar; los importes están en la tabla.'), tabla: tablaTreemap(padre, hijos, metrica) };
    const sinArea = items.length - positivos.length;
    if (basePositiva !== total) {
        v.avisos.push(`El área se reparte sobre los importes positivos expuestos (${gs(basePositiva)}), que difieren del total publicado de la partida ` +
                      `(${gs(total)}) en ${gs(total - basePositiva)}.`);
    }
    if (sinArea) v.avisos.push(`${sinArea} rama(s) con importe cero, negativo o sin dato quedan sin área; están en la tabla.`);
    v.grafico = { tipo: 'treemap', items: positivos, total: basePositiva, metrica };
    v.tabla = tablaTreemap(padre, hijos, metrica);
    const mayor = [...positivos].sort((a, b) => b.valor - a.valor)[0];
    v.resumen = `${migas.at(-1).texto}: ${gs(total)} (${metrica === 'vigente' ? 'presupuesto vigente' : 'obligado'}); la rama mayor es ${mayor.rotulo} con ` +
                `${porciento(cociente(mayor.valor, basePositiva))}.`;
    return v;
}

function tablaTreemap(padre, hijos, metrica) {
    return {
        columnas: [COL.nivel, COL.codigo, COL.descripcion, { id: 'ff', titulo: 'FF', tipo: 'codigo' }, { id: 'of', titulo: 'OF', tipo: 'codigo' },
                   { id: 'dpt', titulo: 'DPT', tipo: 'codigo' }, importe('vigente', 'Presupuesto vigente'), importe('obligado', 'Obligado'), importe('pagado', 'Pagado'),
                   pctCol('ejecucion', '% obligado del vigente'), pctCol('participacion', `% del total (${metrica})`), COL.estado, COL.pagina, COL.fila],
        filas: [padre, ...hijos].map((n) => filaPresupuesto(n, { vigente: n.vigente, obligado: n.obligado, pagado: n.pagado, ejecucion: cociente(n.obligado, n.vigente),
                                                                participacion: cociente(n[metrica], padre[metrica]), estado: estadoValor(n[metrica]),
                                                                na: noAplican(['ejecucion', n.vigente], ['participacion', padre[metrica]]) })),
    };
}

// Cascada genérica: pasos {tipo: 'total'|'delta'}; el último total se compara con la suma de lo anterior.
function cascadaCerrada(pasos, finalPublicado, rotuloDif = 'Diferencia aritmética no explicada') {
    let corriente = 0;
    const out = [];
    for (const p of pasos) {
        if (p.tipo === 'total') corriente = p.valor;
        else corriente += p.valor;
        out.push(p);
    }
    if (hay(finalPublicado) && corriente !== finalPublicado.valor) {
        out.push({ id: 'dif', tipo: 'delta', rotulo: rotuloDif, valor: finalPublicado.valor - corriente, rol: 'diferencia', patron: 'rayado' });
    }
    if (finalPublicado) out.push(finalPublicado);
    return out;
}

// 04 · Formación del presupuesto vigente
function v04(cat, M, op) {
    const v = base(cat, M);
    const apertura = cat.aperturas.some((a) => a.id === op.apertura) ? op.apertura : 'total';
    v.apertura = { actual: apertura, opciones: cat.aperturas };
    const t = M.gastos.raiz;
    if (!hay(t.inicial) || !hay(t.vigente)) return sinDatos(v, 'El cuadro no publica el presupuesto inicial o el vigente de gastos.');
    const inicial = { id: 'inicial', tipo: 'total', rotulo: 'Presupuesto inicial de gastos', valor: t.inicial, rol: 'inicial' };
    const vigente = { id: 'vigente', tipo: 'total', rotulo: 'Presupuesto vigente', valor: t.vigente, rol: 'presupuesto' };
    let deltas;
    if (apertura === 'grupos') {
        deltas = M.gastos.grupos.filter((g) => hay(g.modificado) && g.modificado !== 0)
            .map((g) => ({ id: g.clave, tipo: 'delta', rotulo: rotulo(g), valor: g.modificado, rol: g.modificado > 0 ? 'aumento' : 'reduccion' }));
        if (M.gastos.grupos.some((g) => !hay(g.modificado))) v.avisos.push('Hay grupos sin dato de modificaciones en la fuente (celda vacía); no se cuentan como cero.');
    } else {
        deltas = hay(t.modificado) ? [{ id: 'mod', tipo: 'delta', rotulo: 'Modificaciones netas', valor: t.modificado, rol: t.modificado >= 0 ? 'aumento' : 'reduccion' }] : [];
        if (!hay(t.modificado)) v.avisos.push('Las modificaciones netas no tienen dato en la fuente.');
    }
    v.grafico = { tipo: 'cascada', pasos: cascadaCerrada([inicial, ...deltas], vigente, 'Diferencia entre el inicial más las modificaciones y el vigente') };
    if (v.grafico.pasos.some((p) => p.id === 'dif')) v.avisos.push('El inicial más las modificaciones publicadas no da el vigente: la diferencia se muestra aparte.');
    const lista = apertura === 'grupos' ? M.gastos.grupos : [];
    v.tabla = {
        columnas: [COL.nivel, COL.codigo, COL.descripcion, importe('inicial', 'Presupuesto inicial'), importe('modificado', 'Modificaciones netas'),
                   importe('vigente', 'Presupuesto vigente'), pctCol('variacion', 'Variación sobre el inicial'), COL.estado, COL.pagina, COL.fila],
        filas: [t, ...lista].map((n) => filaPresupuesto(n, { inicial: n.inicial, modificado: n.modificado, vigente: n.vigente,
                                                            variacion: cociente(n.modificado, n.inicial), estado: estadoValor(n.modificado),
                                                            na: noAplican(['variacion', n.inicial]) })),
    };
    v.resumen = `Presupuesto inicial de gastos ${gs(t.inicial)}; modificaciones netas ${gs(t.modificado)}; presupuesto vigente ${gs(t.vigente)}` +
                ` (${porciento(cociente(t.modificado, t.inicial))} sobre el inicial).`;
    return v;
}

const cuenta = (arbol, codigo) => arbol.porCuenta.get(codigo) ?? null;
const RAICES = { activo: '2.0.0.00.00.00.000', egresos: '3.0.0.00.00.00.000', pasivo: '4.0.0.00.00.00.000', ingresos: '5.0.0.00.00.00.000', patrimonio: '8.0.0.00.00.00.000' };

// Los años cuyo tomo no trae los códigos del plan de cuentas (2005 y de 2008 a 2011, M57): se leyeron solo las cuentas
// principales por su rótulo, así que lo que falta para llegar a un total es detalle impreso que no se leyó, no una cuenta
// que falte en el tomo; se rotula así y no se comparan los padres con la suma de sus subcuentas.
export const NO_LEIDAS = 'Detalle del tomo no leído (sin códigos)';
const porRotulos = (M, estado) => M?.lectura?.[estado] === 'rotulos';
// Los rubros de una cuenta principal; sin ninguno con importe (un patrimonio sin sus partes leídas), la cuenta misma: así no
// aparece entera como «diferencia».
const rubros = (raiz) => (raiz?.hijos.some((h) => hay(h.valor) && h.valor !== 0) ? raiz.hijos : raiz ? [raiz] : []);
const rotuloCuenta = (h, largo = 3) => (h.nivel <= 1 ? h.descripcion : `${h.codigo.slice(0, largo)} ${h.descripcion}`);
const textoDif = (M, estado, texto) => (porRotulos(M, estado) ? NO_LEIDAS : texto);
function avisosCuentas(v, M, arbol, estado) {
    if (porRotulos(M, estado)) {
        v.avisos.push(`En ${M.ejercicio} el tomo no trae los códigos del plan de cuentas: se leyeron solo las cuentas principales por su rótulo; lo que ` +
                      'falte para llegar a un total (rayado) es el resto del detalle impreso, que no se leyó, no una cuenta que falte en el tomo.');
        return;
    }
    for (const d of arbol.diferencias) v.avisos.push(`${d.codigo} ${d.descripcion}: la cuenta (${gs(d.padre)}) y la suma de sus subcuentas (${gs(d.suma)}) difieren en ${gs(d.diferencia)}.`);
}

// 05 · Formación del resultado contable
function v05(cat, M, op) {
    const v = base(cat, M);
    const apertura = cat.aperturas.some((a) => a.id === op.apertura) ? op.apertura : 'total';
    v.apertura = { actual: apertura, opciones: cat.aperturas };
    const ing = cuenta(M.resultado, RAICES.ingresos);
    const egr = cuenta(M.resultado, RAICES.egresos);
    if (!ing || !egr || !hay(ing.valor) || !hay(egr.valor)) return sinDatos(v, 'El estado de resultados no expone los ingresos o los egresos de gestión.');
    const resultado = ing.valor - egr.valor;
    const fin = { id: 'resultado', tipo: 'total', rotulo: 'Resultado contable', valor: resultado, rol: resultado >= 0 ? 'resultado_pos' : 'resultado_neg' };
    let pasos;
    if (apertura === 'rubros') {
        const pI = rubros(ing).filter((h) => hay(h.valor) && h.valor !== 0).map((h) => ({ id: h.clave, tipo: 'delta', rotulo: rotuloCuenta(h), valor: h.valor, rol: 'ingreso_gestion' }));
        const pE = rubros(egr).filter((h) => hay(h.valor) && h.valor !== 0).map((h) => ({ id: h.clave, tipo: 'delta', rotulo: rotuloCuenta(h), valor: -h.valor, rol: 'egreso_gestion' }));
        const subtotal = { id: 'ingresos', tipo: 'total', rotulo: 'Ingresos de gestión', valor: ing.valor, rol: 'ingreso_gestion' };
        pasos = [...cascadaCerrada([{ id: 'cero', tipo: 'total', valor: 0, rotulo: '', oculto: true }, ...pI], subtotal,
                                   textoDif(M, 'resultados', 'Diferencia de ingresos sin rubro publicado')).slice(1),
                 ...cascadaCerrada([subtotal, ...pE], fin, textoDif(M, 'resultados', 'Diferencia de egresos sin rubro publicado')).slice(1)];
    } else {
        pasos = cascadaCerrada([{ id: 'ingresos', tipo: 'total', rotulo: 'Ingresos de gestión', valor: ing.valor, rol: 'ingreso_gestion' },
                                { id: 'egresos', tipo: 'delta', rotulo: 'Egresos de gestión', valor: -egr.valor, rol: 'egreso_gestion' }], fin);
    }
    v.grafico = { tipo: 'cascada', pasos };
    const indicador = M.indicadores?.resultado_contable_gs?.valor;
    if (hay(indicador) && indicador !== resultado) v.avisos.push(`El indicador publicado del resultado contable (${gs(indicador)}) difiere de ingresos − egresos (${gs(resultado)}).`);
    if (apertura === 'rubros' || !porRotulos(M, 'resultados')) avisosCuentas(v, M, M.resultado, 'resultados');
    v.tabla = {
        columnas: [COL.nivel, COL.codigo, COL.descripcion, importe('valor', 'Importe'), { id: 'columna', titulo: 'Columna de la fuente', tipo: 'texto' }, COL.estado, COL.pagina, COL.fila],
        filas: [ing, ...(apertura === 'rubros' ? ing.hijos : []), egr, ...(apertura === 'rubros' ? egr.hijos : [])].map((n) => filaContable(n))
            .concat([{ nivel: 'Calculado', codigo: '5 − 3', descripcion: 'Resultado contable (ingresos − egresos de gestión)', valor: resultado, columna: '', estado: 'calculado', pagina: '', fila: '' }]),
    };
    v.resumen = `Ingresos de gestión ${gs(ing.valor)} menos egresos de gestión ${gs(egr.valor)}: resultado contable ${gs(resultado)} (${resultado >= 0 ? 'positivo' : 'negativo'}).`;
    return v;
}

// 06 · Composición de ingresos del ejercicio
export const COMPONENTES_INGRESO = { propio: ['110', '130', '140', '160'], transferencia: ['150', '220'] };
const categoriaIngreso = (codigo) => (COMPONENTES_INGRESO.propio.includes(codigo) ? 'propio' : COMPONENTES_INGRESO.transferencia.includes(codigo) ? 'transferencia' : 'otro_ingreso');
const TEXTO_CATEGORIA = { propio: 'Ingresos propios identificados', transferencia: 'Transferencias', otro_ingreso: 'Otros componentes documentados' };

function v06(cat, M, op) {
    const v = base(cat, M);
    const metrica = cat.metricas.some((m) => m.id === op.metrica) ? op.metrica : 'recaudado';
    v.metrica = { actual: metrica, opciones: cat.metricas };
    const grupos = M.ingresos.grupos.filter((g) => g.codigo === '100' || g.codigo === '200');
    const financiamiento = M.ingresos.grupos.find((g) => g.codigo === '300') ?? null;
    if (!grupos.length || grupos.some((g) => !hay(g[metrica]))) return sinDatos(v, 'El cuadro de ingresos no publica los grupos 100 y 200 en esta etapa.');
    const denominador = grupos.reduce((s, g) => s + g[metrica], 0);
    if (denominador <= 0) return sinDatos(v, 'El denominador (ingresos sin financiamiento) no es positivo: no hay composición porcentual.', 'denominador');
    const orden = { propio: 0, transferencia: 1, otro_ingreso: 2 };
    const componentes = grupos.flatMap((g) => g.hijos).sort((a, b) => orden[categoriaIngreso(a.codigo)] - orden[categoriaIngreso(b.codigo)] || porCodigo(a, b));
    const segmentos = componentes.map((c) => ({ id: c.clave, rotulo: rotulo(c), valor: c[metrica], rol: categoriaIngreso(c.codigo), categoria: categoriaIngreso(c.codigo),
                                                pct: cociente(c[metrica], denominador) }));
    const suma = segmentos.reduce((s, x) => s + (x.valor ?? 0), 0);
    if (suma !== denominador) {
        segmentos.push({ id: 'dif', rotulo: 'Diferencia entre los grupos y sus subgrupos', valor: denominador - suma, rol: 'diferencia', patron: 'rayado', categoria: 'diferencia',
                         pct: cociente(denominador - suma, denominador) });
        v.avisos.push('Los subgrupos no suman el total de los grupos 100 y 200: la diferencia se muestra aparte.');
    }
    const porCategoria = Object.fromEntries(Object.keys(TEXTO_CATEGORIA).map((k) => [k, segmentos.filter((x) => x.categoria === k).reduce((s, x) => s + (x.valor ?? 0), 0)]));
    if (segmentos.some((x) => (x.valor ?? 0) < 0)) {
        cambiar(v, 'barras_firmadas', 'hay componentes negativos: una barra apilada al 100 % no puede mostrarlos');
        v.grafico = { tipo: 'firmadas', columnas: [{ id: 'ing', rotulo: 'Ingresos sin financiamiento', total: denominador, segmentos: segmentosValidos(segmentos) }] };
    } else {
        v.grafico = { tipo: 'apilada', segmentos: segmentos.filter((x) => (x.valor ?? 0) > 0), total: denominador,
                      categorias: Object.entries(TEXTO_CATEGORIA).map(([id, texto]) => ({ id, texto, valor: porCategoria[id], pct: cociente(porCategoria[id], denominador) })) };
    }
    if (segmentos.some((x) => !hay(x.valor))) {
        v.estado = 'parcial';
        v.motivo = 'Algún subgrupo no tiene dato en esta etapa (celda vacía); no se cuenta como cero.';
    }
    v.tabla = {
        columnas: [{ id: 'categoria', titulo: 'Componente', tipo: 'texto' }, COL.codigo, COL.descripcion, importe('valor', metrica === 'recaudado' ? 'Recaudado' : 'Presupuesto vigente'),
                   pctCol('pct', '% de los ingresos sin financiamiento'), COL.estado, COL.pagina, COL.fila],
        filas: [...componentes.map((c) => filaPresupuesto(c, { categoria: TEXTO_CATEGORIA[categoriaIngreso(c.codigo)], valor: c[metrica], pct: cociente(c[metrica], denominador), estado: estadoValor(c[metrica]) })),
                ...grupos.map((g) => filaPresupuesto(g, { categoria: 'Denominador (grupo)', valor: g[metrica], pct: cociente(g[metrica], denominador), estado: estadoValor(g[metrica]) })),
                ...(financiamiento ? [filaPresupuesto(financiamiento, { categoria: 'Fuera del denominador', valor: financiamiento[metrica], pct: null, na: ['pct'], estado: estadoValor(financiamiento[metrica]) })] : [])],
    };
    v.financiamiento = financiamiento ? financiamiento[metrica] : null;
    v.resumen = `Sobre ${gs(denominador)} de ingresos sin financiamiento (${metrica}): ingresos propios identificados ${porciento(cociente(porCategoria.propio, denominador))}, ` +
                `transferencias ${porciento(cociente(porCategoria.transferencia, denominador))} y otros componentes ${porciento(cociente(porCategoria.otro_ingreso, denominador))}.`;
    return v;
}

// 07 · Tres lecturas de la liquidez
export const RAZONES = [
    { id: 'razon_corriente', rotulo: 'Razón corriente', formula: 'Activo corriente / pasivo corriente' },
    { id: 'prueba_acida', rotulo: 'Prueba ácida', formula: '(Disponible + cuentas a cobrar + inversiones de corto plazo) / pasivo corriente' },
    { id: 'cobertura_disponible', rotulo: 'Cobertura con disponible', formula: 'Disponible / pasivo corriente' },
];
const CUENTAS_LIQUIDEZ = [['2.1.0.00.00.00.000', 'Activo corriente'], ['2.1.1.00.00.00.000', 'Disponible'], ['2.1.3.00.00.00.000', 'Cuentas a cobrar'],
                          ['2.1.4.00.00.00.000', 'Inversiones de corto plazo'], ['4.1.0.00.00.00.000', 'Pasivo corriente']];

function v07(cat, M) {
    const v = base(cat, M);
    const barras = RAZONES.map((r) => ({ ...r, valor: M.indicadores?.[r.id]?.valor ?? null, motivo: M.indicadores?.[r.id]?.motivo ?? null, rol: 'liquidez' }));
    const calculables = barras.filter((b) => hay(b.valor));
    v.tabla = {
        columnas: [{ id: 'concepto', titulo: 'Concepto', tipo: 'texto' }, COL.codigo, importe('valor', 'Saldo'), { id: 'razon', titulo: 'Razón', tipo: 'veces' },
                   { id: 'formula', titulo: 'Fórmula', tipo: 'texto' }, COL.estado, COL.pagina, COL.fila],
        filas: [...barras.map((b) => ({ concepto: b.rotulo, codigo: '', valor: null, na: ['valor'], razon: b.valor, formula: b.formula, estado: hay(b.valor) ? 'calculado' : (b.motivo ?? 'no calculable'), pagina: '', fila: '' })),
                ...CUENTAS_LIQUIDEZ.map(([codigo, texto]) => {
                    const n = cuenta(M.balance, codigo);
                    return { concepto: texto, codigo, valor: n?.valor ?? null, razon: null, na: ['razon'], formula: '', estado: n ? estadoValor(n.valor) : 'no expuesto en el balance',
                             pagina: n?.pagina ?? '', fila: n ? origenContable(n) : '' };
                })],
    };
    if (!calculables.length) {
        const r = sinDatos(v, `No se puede calcular ninguna razón: ${barras[0].motivo ?? 'falta el pasivo corriente expuesto'}`);
        r.tabla = v.tabla;
        return r;
    }
    if (calculables.length < barras.length) {
        v.estado = 'parcial';
        v.motivo = barras.filter((b) => !hay(b.valor)).map((b) => `${b.rotulo}: ${b.motivo ?? 'no calculable'}`).join(' ');
    }
    v.grafico = { tipo: 'barras', barras, referencia: { valor: 1, texto: '1 = cubre el pasivo corriente' } };
    v.resumen = barras.map((b) => `${b.rotulo}: ${hay(b.valor) ? veces(b.valor) : 'no calculable'}.`).join(' ');
    return v;
}

// Barras con signo de un estado contable: una columna por lado.
function columnaContable(id, texto, raiz, rol, signo = 1) {
    const segmentos = (raiz?.hijos ?? []).filter((h) => hay(h.valor) && h.valor !== 0)
        .map((h) => ({ id: h.clave, rotulo: `${h.codigo.slice(0, 3)} ${h.descripcion}`, valor: signo * h.valor, rol, fila: h.fila }));
    return { id, rotulo: texto, total: raiz && hay(raiz.valor) ? signo * raiz.valor : null, segmentos };
}

// 08 · Ingresos y egresos de gestión
function v08(cat, M) {
    const v = base(cat, M);
    const ing = cuenta(M.resultado, RAICES.ingresos);
    const egr = cuenta(M.resultado, RAICES.egresos);
    if (!ing || !egr || !hay(ing.valor) || !hay(egr.valor)) return sinDatos(v, 'El estado de resultados no expone los ingresos o los egresos de gestión.');
    const resultado = ing.valor - egr.valor;
    const izq = rubros(ing).map((h) => nodo(h.clave, rotuloCuenta(h), h.valor, 'ingreso_gestion'));
    const der = rubros(egr).map((h) => nodo(h.clave, rotuloCuenta(h), h.valor, 'egreso_gestion'));
    const sumaE = der.reduce((s, n) => s + (n.valor ?? 0), 0);
    if (sumaE !== egr.valor && sumaE < egr.valor) der.push(nodo('dif-egr', textoDif(M, 'resultados', 'Egresos sin rubro publicado (diferencia)'), egr.valor - sumaE, 'diferencia', { patron: 'rayado' }));
    let s = null;
    if (resultado >= 0) {
        s = sankey(izq, nodo('centro', 'Ingresos de gestión', ing.valor, 'ingreso_gestion'), [...der, nodo('resultado', 'Resultado contable (positivo)', resultado, 'resultado_pos', { separado: true })],
                   { difIzq: textoDif(M, 'resultados', 'Diferencia sin detalle publicado'), difDer: textoDif(M, 'resultados', 'Diferencia sin detalle publicado') });
    }
    if (s) {
        v.grafico = s;
    } else {
        cambiar(v, 'barras_firmadas', resultado < 0 ? 'el resultado es negativo (los egresos superan a los ingresos): un Sankey no puede dibujar un ancho negativo'
            : 'hay rubros negativos o que superan su total');
        v.grafico = { tipo: 'firmadas', columnas: [columnaContable('ing', 'Ingresos de gestión', ing, 'ingreso_gestion'), columnaContable('egr', 'Egresos de gestión', egr, 'egreso_gestion'),
                                                   { id: 'res', rotulo: 'Resultado contable', total: resultado, segmentos: [{ id: 'resultado', rotulo: 'Resultado contable', valor: resultado,
                                                                                                                           rol: resultado >= 0 ? 'resultado_pos' : 'resultado_neg' }] }] };
    }
    v.tabla = {
        columnas: [COL.lado, COL.nivel, COL.codigo, COL.descripcion, importe('valor', 'Importe'), pctCol('pct', '% de los ingresos de gestión'), COL.estado, COL.pagina, COL.fila],
        filas: [...[ing, ...ing.hijos].map((n) => ({ lado: 'Ingresos', ...filaContable(n), pct: cociente(n.valor, ing.valor) })),
                ...[egr, ...egr.hijos].map((n) => ({ lado: 'Egresos', ...filaContable(n), pct: cociente(n.valor, ing.valor) })),
                { lado: 'Resultado', nivel: 'Calculado', codigo: '5 − 3', descripcion: 'Resultado contable', valor: resultado, pct: cociente(resultado, ing.valor), estado: 'calculado', pagina: '', fila: '' }],
    };
    avisosCuentas(v, M, M.resultado, 'resultados');
    v.resumen = `Ingresos de gestión ${gs(ing.valor)}; egresos de gestión ${gs(egr.valor)} (${porciento(cociente(egr.valor, ing.valor))} de los ingresos); resultado ${gs(resultado)}.`;
    return v;
}

// Partición del vigente de un nivel (total o grupo): pagado + pendiente + saldo sin obligar.
function particion(n) {
    const partes = [n.pagado, n.pendiente, n.saldo];
    if (partes.some((x) => !hay(x)) || !hay(n.vigente)) return { ok: false, causa: 'faltan componentes de la ejecución (celdas vacías en la fuente)' };
    if (partes.some((x) => x < 0)) return { ok: false, causa: 'hay un componente negativo (sobre-ejecución u obligado mayor al vigente)' };
    if (partes[0] + partes[1] + partes[2] !== n.vigente) return { ok: false, causa: 'pagado + pendiente + saldo no concilian con el vigente' };
    if (hay(n.obligado) && n.obligado !== n.pagado + n.pendiente) return { ok: false, causa: 'pagado + pendiente no concilian con el obligado' };
    return { ok: true };
}

const nodosEjecucion = (n) => [nodo('pagado', 'Pagado', n.pagado, 'pagado'), nodo('pendiente', 'Obligado pendiente de pago', n.pendiente, 'pendiente', { patron: 'pendiente' }),
                               nodo('saldo', 'Saldo sin obligar', n.saldo, 'saldo')];

function tablaEjecucion(n, lista = []) {
    return {
        columnas: [COL.nivel, COL.codigo, COL.descripcion, importe('inicial', 'Presupuesto inicial'), importe('modificado', 'Modificaciones'), importe('vigente', 'Presupuesto vigente'),
                   importe('obligado', 'Obligado'), importe('pagado', 'Pagado'), importe('pendiente', 'Pendiente de pago'), importe('saldo', 'Saldo sin obligar'),
                   pctCol('pctPagado', '% pagado del vigente'), COL.estado, COL.pagina, COL.fila],
        filas: [n, ...lista].map((x) => filaPresupuesto(x, { inicial: x.inicial, modificado: x.modificado, vigente: x.vigente, obligado: x.obligado, pagado: x.pagado,
                                                            pendiente: x.pendiente, saldo: x.saldo, pctPagado: cociente(x.pagado, x.vigente), estado: estadoValor(x.vigente),
                                                            na: noAplican(['pctPagado', x.vigente]) })),
    };
}

// 09 · Del presupuesto inicial a la ejecución
function v09(cat, M) {
    const v = base(cat, M);
    const t = M.gastos.raiz;
    if (!hay(t.vigente) || !hay(t.inicial)) return sinDatos(v, 'El cuadro no publica el presupuesto inicial o el vigente de gastos.');
    v.tabla = tablaEjecucion(t);
    const part = particion(t);
    const mod = t.modificado;
    if (hay(mod) && t.inicial + mod !== t.vigente) v.avisos.push(`El inicial más las modificaciones (${gs(t.inicial + mod)}) no da el vigente publicado (${gs(t.vigente)}).`);
    if (part.ok && hay(mod) && mod >= 0 && t.inicial + mod === t.vigente) {
        const izq = [nodo('inicial', 'Presupuesto inicial', t.inicial, 'inicial'), nodo('mod', 'Modificaciones netas', mod, 'aumento')];
        v.grafico = sankey(izq, nodo('centro', 'Presupuesto vigente', t.vigente, 'presupuesto'), nodosEjecucion(t));
    }
    if (!v.grafico) {
        const causa = !part.ok ? part.causa : !hay(mod) ? 'las modificaciones no tienen dato' : mod < 0 ? 'las modificaciones netas son negativas' : 'el inicial más las modificaciones no da el vigente';
        cambiar(v, 'cascada', `${causa}: se muestra una cascada con signo`);
        const pasos = [{ id: 'inicial', tipo: 'total', rotulo: 'Presupuesto inicial', valor: t.inicial, rol: 'inicial' }];
        if (hay(mod)) pasos.push({ id: 'mod', tipo: 'delta', rotulo: 'Modificaciones netas', valor: mod, rol: mod >= 0 ? 'aumento' : 'reduccion' });
        const vig = { id: 'vigente', tipo: 'total', rotulo: 'Presupuesto vigente', valor: t.vigente, rol: 'presupuesto' };
        const cerrada = cascadaCerrada(pasos, vig, 'Diferencia con el vigente publicado');
        if (part.ok) {
            cerrada.push({ id: 'saldo', tipo: 'delta', rotulo: 'Saldo sin obligar', valor: -t.saldo, rol: 'saldo' },
                         { id: 'obligado', tipo: 'total', rotulo: 'Gasto obligado', valor: t.obligado ?? t.pagado + t.pendiente, rol: 'obligado' },
                         { id: 'pendiente', tipo: 'delta', rotulo: 'Pendiente de pago', valor: -t.pendiente, rol: 'pendiente', patron: 'pendiente' },
                         { id: 'pagado', tipo: 'total', rotulo: 'Pagado', valor: t.pagado, rol: 'pagado' });
        } else {
            v.avisos.push(`No se divide el vigente en pagado, pendiente y saldo: ${part.causa}.`);
            v.estado = 'parcial';
            v.motivo = `La ejecución no se puede dividir: ${part.causa}.`;
        }
        v.grafico = { tipo: 'cascada', pasos: cerrada };
    }
    v.resumen = `Presupuesto inicial ${gs(t.inicial)}, modificaciones ${gs(mod)}, vigente ${gs(t.vigente)}; pagado ${gs(t.pagado)}, pendiente de pago ${gs(t.pendiente)} ` +
                `y saldo sin obligar ${gs(t.saldo)}.`;
    return v;
}

// 10 y 11 · Inversión física (grupo 500) y servicios personales (grupo 100)
function vGrupo(cat, M, codigo) {
    const v = base(cat, M);
    const g = M.gastos.grupos.find((x) => x.codigo === codigo);
    if (!g) return sinDatos(v, `El cuadro de gastos no tiene el grupo ${codigo}.`, 'no_expuesto');
    v.tabla = tablaEjecucion(g, g.hijos);
    if (!hay(g.vigente)) return { ...sinDatos(v, `El grupo ${codigo} no publica su presupuesto vigente.`), tabla: v.tabla };
    if (g.vigente === 0) return { ...sinDatos(v, `El presupuesto vigente del grupo ${codigo} es cero: no hay composición que dibujar.`, 'cero'), tabla: v.tabla };
    avisosDiferencias(v, M.gastos, [codigo], ['vigente', 'obligado', 'pagado']);
    const part = particion(g);
    const izq = g.hijos.map((h) => nodo(h.clave, rotulo(h), h.vigente, ROL_GASTO(codigo)));
    if (part.ok) v.grafico = sankey(izq, nodo('centro', rotulo(g), g.vigente, ROL_GASTO(codigo)), nodosEjecucion(g));
    if (!v.grafico) {
        cambiar(v, 'barras_firmadas', part.ok ? 'los subgrupos superan el total del grupo o hay importes negativos' : part.causa);
        v.grafico = { tipo: 'firmadas', columnas: [
            { id: 'vig', rotulo: 'Presupuesto vigente', total: g.vigente, segmentos: segmentosValidos(izq) },
            { id: 'eje', rotulo: 'Ejecución', total: hay(g.saldo) && hay(g.obligado) ? g.obligado + g.saldo : null,
              segmentos: segmentosValidos(nodosEjecucion(g)) }] };
        if (!part.ok && part.causa.startsWith('faltan')) {
            v.estado = 'parcial';
            v.motivo = `La ejecución no se puede dividir: ${part.causa}.`;
        }
    }
    v.resumen = `${rotulo(g)}: presupuesto vigente ${gs(g.vigente)}; pagado ${gs(g.pagado)} (${porciento(cociente(g.pagado, g.vigente))}), pendiente de pago ${gs(g.pendiente)} ` +
                `y saldo sin obligar ${gs(g.saldo)}.`;
    return v;
}

// 12 · Transferencias previstas y recaudadas
function emisorDe(descripcion, emisores) {
    const n = normalizar(descripcion);
    const e = (emisores ?? []).find((x) => normalizar(x.descripcion) === n);
    return e ? (e.clase === 'intergubernamental' ? `Intergubernamental: ${e.emisor}` : `Sin clasificar: ${e.emisor}`) : 'Sin clasificar en Financiero';
}

function v12(cat, M, op, ctx) {
    const v = base(cat, M);
    const subs = M.ingresos.grupos.flatMap((g) => g.hijos).filter((s) => COMPONENTES_INGRESO.transferencia.includes(s.codigo));
    if (!subs.length) return sinDatos(v, 'El cuadro de ingresos no tiene transferencias (subgrupos 150 y 220).', 'no_expuesto');
    const previsto = subs.reduce((s, x) => s + (x.vigente ?? 0), 0);
    const recaudado = subs.reduce((s, x) => s + (x.recaudado ?? 0), 0);
    const lineas = subs.flatMap((s) => s.hijos);
    const repetidas = new Map();
    for (const l of lineas) {
        const k = `${l.codigo}|${l.detalle}|${l.descripcion}`;
        repetidas.set(k, [...(repetidas.get(k) ?? []), l]);
    }
    const texto = (l) => {
        const grupo = repetidas.get(`${l.codigo}|${l.detalle}|${l.descripcion}`);
        return `${l.codigo}-${l.detalle ?? ''} ${l.descripcion}${grupo.length > 1 ? ` (renglón ${grupo.indexOf(l) + 1} de ${grupo.length})` : ''}`;
    };
    v.tabla = {
        columnas: [COL.nivel, COL.codigo, COL.descripcion, { id: 'ff', titulo: 'FF', tipo: 'codigo' }, importe('vigente', 'Previsto (vigente)'), importe('recaudado', 'Recaudado'),
                   importe('diferencia', 'Previsto − recaudado'), pctCol('pct', '% recaudado del previsto'), { id: 'emisor', titulo: 'Emisor (clasificación de Financiero)', tipo: 'texto' },
                   COL.pagina, COL.fila],
        filas: [...subs.flatMap((s) => [s, ...s.hijos]).map((n) => filaPresupuesto(n, {
            descripcion: n.nivel === 'detalle' ? texto(n).replace(/^\S+ /, '') : n.descripcion, vigente: n.vigente, recaudado: n.recaudado,
            diferencia: hay(n.vigente) && hay(n.recaudado) ? n.vigente - n.recaudado : null, pct: cociente(n.recaudado, n.vigente),
            emisor: n.nivel === 'detalle' ? emisorDe(n.descripcion, ctx?.emisores) : '', na: noAplican(['pct', n.vigente]) }))],
    };
    if (previsto === 0 && recaudado === 0) return { ...sinDatos(v, 'No hay transferencias previstas ni recaudadas en el ejercicio.', 'cero'), tabla: v.tabla };
    avisosDiferencias(v, M.ingresos, subs.map((s) => s.codigo), ['vigente', 'recaudado']);
    const lineasPos = lineas.map((l) => nodo(l.clave, texto(l), l.vigente, 'transferencia'));
    const centro = nodo('centro', 'Transferencias previstas', previsto, 'transferencia');
    const sobre = lineas.filter((l) => hay(l.recaudado) && hay(l.vigente) && l.recaudado > l.vigente).length;
    if (recaudado <= previsto) {
        v.grafico = sankey(lineasPos, centro, [nodo('recaudado', 'Recaudado', recaudado, 'recaudado'),
                                               nodo('no_recaudado', 'Previsto no recaudado (diferencia)', previsto - recaudado, 'diferencia', { patron: 'rayado' })]);
    }
    if (!v.grafico) {
        cambiar(v, 'barras_firmadas', recaudado > previsto ? 'la recaudación supera a lo previsto: la diferencia es negativa y un Sankey no puede dibujarla'
            : 'los renglones superan al total previsto o hay importes negativos');
        v.grafico = { tipo: 'firmadas', columnas: [
            { id: 'prev', rotulo: 'Previstas', total: previsto, segmentos: segmentosValidos(subs.map((s) => nodo(`p${s.codigo}`, rotulo(s), s.vigente, 'transferencia'))) },
            { id: 'rec', rotulo: 'Recaudadas', total: recaudado, segmentos: segmentosValidos(subs.map((s) => nodo(`r${s.codigo}`, rotulo(s), s.recaudado, 'recaudado'))) },
            { id: 'dif', rotulo: 'Previsto − recaudado', total: previsto - recaudado, segmentos: [nodo('dif', 'Diferencia (previsto − recaudado)', previsto - recaudado, 'diferencia', { patron: 'rayado' })] }] };
    }
    if (sobre) v.avisos.push(`${sobre} renglón(es) recaudaron más de lo previsto: su diferencia es negativa en la tabla.`);
    v.resumen = `Transferencias previstas ${gs(previsto)}; recaudado ${gs(recaudado)} (${porciento(cociente(recaudado, previsto))}); diferencia ${gs(previsto - recaudado)}.`;
    return v;
}

// 13 · Recursos registrados y gasto obligado
function v13(cat, M) {
    const v = base(cat, M);
    const rec = M.ingresos.raiz.recaudado;
    const obl = M.gastos.raiz.obligado;
    if (!hay(rec) || !hay(obl)) return sinDatos(v, 'El cuadro no publica el total recaudado o el total obligado.');
    const izq = M.ingresos.grupos.map((g) => nodo(g.clave, rotulo(g), g.recaudado, ROL_INGRESO(g.codigo)));
    const dif = rec - obl;
    v.tabla = {
        columnas: [COL.lado, COL.nivel, COL.codigo, COL.descripcion, importe('valor', 'Importe'), pctCol('pct', '% de lo recaudado'), COL.estado, COL.pagina, COL.fila],
        filas: [...[M.ingresos.raiz, ...M.ingresos.grupos].map((n) => filaPresupuesto(n, { lado: 'Recursos recaudados', valor: n.recaudado, pct: cociente(n.recaudado, rec), estado: estadoValor(n.recaudado) })),
                filaPresupuesto(M.gastos.raiz, { lado: 'Gasto obligado', valor: obl, pct: cociente(obl, rec), estado: estadoValor(obl) }),
                { lado: 'Diferencia', nivel: 'Calculado', codigo: '', descripcion: 'Diferencia aritmética (recaudado − obligado)', valor: dif, pct: cociente(dif, rec), estado: 'calculado', pagina: '', fila: '' }],
    };
    avisosDiferencias(v, M.ingresos, ['TOTAL'], ['recaudado']);
    if (dif >= 0) v.grafico = sankey(izq, nodo('centro', 'Recursos recaudados', rec, 'recaudado'),
                                     [nodo('obligado', 'Gasto obligado', obl, 'obligado'), nodo('diferencia', 'Diferencia aritmética (recaudado − obligado)', dif, 'diferencia', { patron: 'rayado', separado: true })]);
    if (!v.grafico) {
        cambiar(v, 'barras_firmadas', dif < 0 ? 'el gasto obligado supera a los recursos recaudados: la diferencia es negativa' : 'hay importes negativos o los grupos superan el total');
        v.grafico = { tipo: 'firmadas', columnas: [
            { id: 'rec', rotulo: 'Recursos recaudados', total: rec, segmentos: segmentosValidos(izq) },
            { id: 'obl', rotulo: 'Gasto obligado', total: obl, segmentos: [nodo('obligado', 'Gasto obligado', obl, 'obligado')] },
            { id: 'dif', rotulo: 'Diferencia aritmética', total: dif, segmentos: [nodo('diferencia', 'Recaudado − obligado', dif, 'diferencia', { patron: 'rayado' })] }] };
    }
    const fin = M.ingresos.grupos.find((g) => g.codigo === '300');
    if (fin && (fin.recaudado ?? 0) > 0) v.avisos.push(`Los recursos incluyen ${gs(fin.recaudado)} de financiamiento (endeudamiento y saldo inicial de caja).`);
    v.resumen = `Recursos recaudados ${gs(rec)}; gasto obligado ${gs(obl)}; diferencia aritmética ${gs(dif)}.`;
    return v;
}

// 14 · Activos, pasivos y patrimonio
function v14(cat, M, op) {
    const v = base(cat, M);
    const apertura = cat.aperturas.some((a) => a.id === op.apertura) ? op.apertura : 'rubros';
    v.apertura = { actual: apertura, opciones: cat.aperturas };
    const activo = cuenta(M.balance, RAICES.activo);
    const pasivo = cuenta(M.balance, RAICES.pasivo);
    const patrimonio = cuenta(M.balance, RAICES.patrimonio);
    const ing = cuenta(M.resultado, RAICES.ingresos);
    const egr = cuenta(M.resultado, RAICES.egresos);
    if (!activo || !hay(activo.valor) || !patrimonio) return sinDatos(v, 'El balance no expone el activo total o el patrimonio neto.');
    const resultado = ing && egr && hay(ing.valor) && hay(egr.valor) ? ing.valor - egr.valor : null;
    const partes = (raiz, rol) => (apertura === 'cuentas' ? rubros(raiz).flatMap((h) => (h.hijos.length ? h.hijos : [h])) : rubros(raiz))
        .filter((h) => hay(h.valor) && h.valor !== 0).map((h) => ({ id: h.clave, rotulo: rotuloCuenta(h, apertura === 'cuentas' ? 5 : 3), valor: h.valor, rol }));
    const izq = partes(activo, 'activo');
    const der = [...partes(pasivo, 'pasivo'), ...partes(patrimonio, 'patrimonio')];
    if (hay(resultado) && resultado !== 0) der.push({ id: 'resultado', rotulo: 'Resultado del ejercicio (expuesto aparte de la cuenta 8)', valor: resultado, rol: resultado >= 0 ? 'resultado_pos' : 'resultado_neg' });
    const sumaDer = (pasivo?.valor ?? 0) + (patrimonio.valor ?? 0) + (resultado ?? 0);
    const cuadra = sumaDer === activo.valor;
    const sumaPartes = (lista) => lista.reduce((s, x) => s + x.valor, 0);
    if (sumaPartes(izq) !== activo.valor) izq.push({ id: 'dif-act', rotulo: textoDif(M, 'balance', 'Diferencia sin cuenta publicada'), valor: activo.valor - sumaPartes(izq), rol: 'diferencia', patron: 'rayado' });
    if (sumaPartes(der) !== sumaDer) der.push({ id: 'dif-pas', rotulo: textoDif(M, 'balance', 'Diferencia sin cuenta publicada'), valor: sumaDer - sumaPartes(der), rol: 'diferencia', patron: 'rayado' });
    if (porRotulos(M, 'balance')) avisosCuentas(v, M, M.balance, 'balance');
    v.grafico = { tipo: 'firmadas', composicion: true, columnas: [
        { id: 'activo', rotulo: 'Activo', total: activo.valor, segmentos: izq },
        { id: 'pasivo', rotulo: 'Pasivo, patrimonio y resultado', total: sumaDer, segmentos: der }] };
    if (!pasivo) {
        v.estado = 'parcial';
        v.motivo = 'El cuadro no tiene renglón de pasivo total: se dibuja sin pasivo, lo que no significa pasivo cero.';
    }
    if (!cuadra) v.avisos.push(`Activo (${gs(activo.valor)}) y pasivo + patrimonio + resultado (${gs(sumaDer)}) difieren en ${gs(activo.valor - sumaDer)}.`);
    else v.avisos.push('El activo concilia con el pasivo, el patrimonio neto (cuenta 8) y el resultado del ejercicio, como en el formato de la fuente.');
    if ([...izq, ...der].some((x) => x.valor < 0)) v.avisos.push('Hay saldos negativos (por ejemplo, resultados acumulados): se dibujan debajo del eje.');
    const filas = [];
    for (const [lado, raiz] of [['Activo', activo], ['Pasivo', pasivo], ['Patrimonio neto', patrimonio]]) {
        if (!raiz) {
            filas.push({ lado, nivel: '', codigo: RAICES.pasivo, descripcion: 'PASIVO', valor: null, columna: '', estado: 'no expuesto en el balance', pagina: '', fila: '' });
            continue;
        }
        const lista = apertura === 'cuentas' ? [raiz, ...raiz.hijos.flatMap((h) => [h, ...h.hijos])] : [raiz, ...raiz.hijos];
        filas.push(...lista.map((n) => ({ lado, ...filaContable(n) })));
    }
    filas.push({ lado: 'Resultado', nivel: 'Calculado', codigo: '5 − 3', descripcion: 'Resultado del ejercicio (ingresos − egresos de gestión)', valor: resultado, columna: '',
                 estado: hay(resultado) ? 'calculado' : 'no calculable', pagina: '', fila: '' });
    v.tabla = { columnas: [COL.lado, COL.nivel, COL.codigo, COL.descripcion, importe('valor', 'Saldo'), { id: 'columna', titulo: 'Columna de la fuente', tipo: 'texto' }, COL.estado, COL.pagina, COL.fila], filas };
    v.resumen = `Activo ${gs(activo.valor)}; pasivo ${pasivo ? gs(pasivo.valor) : 'sin renglón en el cuadro'}; patrimonio neto (cuenta 8) ${gs(patrimonio.valor)}; ` +
                `resultado del ejercicio ${gs(resultado)}.`;
    return v;
}

// Evolución histórica (M57): la serie del distrito de 2004 a 2025 en líneas, con los años sin dato como huecos (nunca ceros).
export const SERIES_EVOLUCION = {
    balance: { campos: [['activo_total_gs', 'activo'], ['pasivo_total_gs', 'pasivo'], ['patrimonio_neto_cuenta8_gs', 'patrimonio']], unidad: 'gs' },
    resultados: { campos: [['ingresos_gestion_gs', 'ingreso_gestion'], ['egresos_gestion_gs', 'egreso_gestion'], ['resultado_contable_gs', 'resultado']], unidad: 'gs' },
    liquidez: { campos: [['razon_corriente', 'razon_corriente'], ['prueba_acida', 'prueba_acida'], ['cobertura_disponible', 'cobertura_disponible']], unidad: 'veces',
                referencia: { valor: 1, texto: '1 = cubre el pasivo corriente' } },
    endeudamiento: { campos: [['pasivo_sobre_activo_pct', 'endeudamiento']], unidad: 'pct', referencia: { valor: 100, texto: '100 % = el pasivo iguala al activo' } },
};
const PUBLICADOS_SERIE = ['activo_total_gs', 'pasivo_total_gs', 'patrimonio_neto_cuenta8_gs', 'ingresos_gestion_gs', 'egresos_gestion_gs'];
export const formatoSerie = (x, unidad) => (unidad === 'veces' ? veces(x) : unidad === 'pct' ? porciento(x) : gs(x));
const listaAnios = (anios) => {
    const tramos = [];
    for (const a of anios) {
        const t = tramos[tramos.length - 1];
        if (t && a === t[1] + 1) t[1] = a; else tramos.push([a, a]);
    }
    const textos = tramos.map(([d, h]) => (d === h ? String(d) : `${d}-${h}`));
    return textos.length > 1 ? `${textos.slice(0, -1).join(', ')} y ${textos[textos.length - 1]}` : textos[0] ?? '';
};

// Un punto de la serie: el valor del año (en guaraníes de 2025 si metrica es «constantes»: diciembre para los saldos, el
// promedio del año para los flujos) o el motivo de su ausencia.
function puntoSerie(a, h, meta, k, metrica) {
    const base = { anio: a.anio, valor: null, nominal: null, factor: null, abarca: null, calculado: false };
    if (a.estado !== 'con_datos') return { ...base, estado: 'sin_datos_anio', texto: `Sin balances municipales publicados: ${a.motivo}` };
    const p = h.serie?.[String(a.anio)];
    if (!p || p.e === 'sin_informe') return { ...base, estado: 'sin_informe', texto: 'La municipalidad no figura en el tomo de ese año.' };
    if (p.e === 'parte_de') return { ...base, estado: 'parte_de', texto: `Todavía no era municipio: su territorio estaba en ${p.nombre}.` };
    const nominal = p.v[k];
    const publicado = PUBLICADOS_SERIE.indexOf(meta.campo);
    const codigo = publicado >= 0 ? p.s?.[publicado] : null;
    if (!hay(nominal)) {
        const texto = p.m?.[meta.campo] ?? (codigo ? h.estados[codigo] : null) ?? 'No expuesto en el informe.';
        return { ...base, estado: 'sin_dato', texto: texto.charAt(0).toUpperCase() + texto.slice(1) };
    }
    const deflactar = metrica === 'constantes' && (meta.tipo === 'saldo' || meta.tipo === 'flujo');
    const factor = deflactar ? h.ipc.anios[String(a.anio)]?.[meta.tipo === 'saldo' ? 'factor_diciembre' : 'factor_promedio'] ?? null : null;
    const valor = deflactar ? (hay(factor) ? Math.round(nominal * factor) : null) : nominal;
    const notas = [codigo === 's' ? 'calculado con los subtotales del propio estado' : 'publicado'];
    if (p.a?.length) notas.push(`incluía el territorio de ${p.a.join(', ')}`);
    return { ...base, valor, nominal, factor, estado: 'valor', abarca: p.a ?? null, calculado: codigo === 's',
             texto: notas.join('; ').replace(/^./, (c) => c.toUpperCase()) };
}

function vEvolucion(cat, M, op, ctx) {
    const v = base(cat, M);
    const apertura = cat.aperturas.some((a) => a.id === op.apertura) ? op.apertura : cat.aperturas[0].id;
    v.apertura = { actual: apertura, opciones: cat.aperturas };
    const def = SERIES_EVOLUCION[apertura];
    const montos = def.unidad === 'gs';
    const metrica = montos ? (cat.metricas.some((m) => m.id === op.metrica) ? op.metrica : cat.metricas[0].id) : null;
    if (montos) v.metrica = { actual: metrica, opciones: cat.metricas };
    v.unidad = montos ? (metrica === 'constantes' ? 'Gs. de 2025 (IPC del BCP)' : 'Gs. de cada año (nominales)') : def.unidad === 'veces' ? 'veces' : '% del activo';
    const h = ctx.historia;
    const nombre = M?.entrada?.nombre ?? ctx.nombre ?? 'Esta municipalidad';
    if (!h) return sinDatos(v, 'No se pudo leer la serie histórica de esta municipalidad.');
    if (!h.serie) return sinDatos(v, `${nombre} no tiene balance en ninguno de los informes de ${h.anios[0].anio} a ${h.anios[h.anios.length - 1].anio}.`);
    const pos = new Map(h.campos.map((c, k) => [c.campo, k]));
    const series = def.campos.map(([campo, rol]) => {
        const meta = h.campos[pos.get(campo)];
        return { id: campo, rotulo: meta.nombre, rol, puntos: h.anios.map((a) => puntoSerie(a, h, meta, pos.get(campo), metrica)) };
    });
    const anios = h.anios.map((a) => a.anio);
    const conDato = anios.filter((a, k) => series.some((s) => hay(s.puntos[k].valor)));
    const sinPublicar = h.anios.filter((a) => a.estado !== 'con_datos').map((a) => a.anio);
    v.avisos.push(`Sin balances municipales publicados por el MEF: ${h.anteriores.desde}-${h.anteriores.hasta}${sinPublicar.length ? ` y ${listaAnios(sinPublicar)}` : ''}; ` +
                  'esos años y los que la municipalidad no figura en el tomo quedan sin punto.');
    if (montos && metrica === 'constantes') {
        v.avisos.push(`${h.ipc.metodo} Factores de cada año en la tabla.`);
    }
    const millones = h.anios.filter((a) => a.escala === 'millones de guaraníes' && conDato.includes(a.anio)).map((a) => a.anio);
    if (montos && millones.length) v.avisos.push(`${listaAnios(millones)}: el tomo publica en millones de guaraníes, así que esos montos están redondeados al millón.`);
    const abarcando = series[0].puntos.filter((p) => p.abarca?.length);
    if (abarcando.length) v.avisos.push(`En ${listaAnios(abarcando.map((p) => p.anio))} su territorio incluía el de distritos creados después (${[...new Set(abarcando.flatMap((p) => p.abarca))].join(', ')}): esos puntos los abarcan.`);
    const tieneFactor = montos && metrica === 'constantes';
    v.tabla = {
        columnas: [{ id: 'anio', titulo: 'Año', tipo: 'codigo' },
                   ...series.map((s) => ({ id: s.id, titulo: s.rotulo, tipo: montos ? 'importe' : def.unidad })),
                   { id: 'estado', titulo: 'Estado del dato', tipo: 'texto' },
                   ...(tieneFactor ? [{ id: 'factor_saldos', titulo: 'Factor IPC (saldos, diciembre)', tipo: 'factor' }, { id: 'factor_flujos', titulo: 'Factor IPC (flujos, promedio)', tipo: 'factor' }] : []),
                   { id: 'fuente', titulo: 'Fuente del año', tipo: 'texto' }],
        // Un año sin balance (no publicado, sin informe o antes de que el distrito existiera): «—» con el motivo; un campo
        // que falta en un año con balance: N/D con el suyo.
        filas: h.anios.map((a, k) => {
            const puntos = series.map((s) => s.puntos[k]);
            const fila = { anio: String(a.anio), fuente: a.estado === 'con_datos' ? a.tomo ?? '' : '' };
            const ausencia = puntos.find((p) => ['sin_datos_anio', 'sin_informe', 'parte_de'].includes(p.estado));
            if (tieneFactor && !ausencia) {
                const f = h.ipc.anios[String(a.anio)];
                fila.factor_saldos = f?.factor_diciembre ?? null;
                fila.factor_flujos = f?.factor_promedio ?? null;
            }
            if (ausencia) {
                fila.estado = ausencia.texto;
                fila.na = [...series.map((s) => s.id), ...(tieneFactor ? ['factor_saldos', 'factor_flujos'] : [])];
                return fila;
            }
            series.forEach((s, j) => { fila[s.id] = puntos[j].valor; });
            const conValor = puntos.find((p) => p.estado === 'valor');
            const faltan = series.filter((s, j) => puntos[j].estado === 'sin_dato').map((s) => `${s.rotulo}: ${s.puntos[k].texto}`);
            fila.estado = [conValor?.texto, ...faltan].filter(Boolean).join('. ');
            return fila;
        }),
    };
    if (!conDato.length) {
        const r = sinDatos(v, `Ningún año de la serie tiene ${apertura === 'liquidez' ? 'razones de liquidez calculables' : 'dato para esta vista'}: los motivos, en la tabla.`);
        return { ...r, tabla: v.tabla, avisos: v.avisos };
    }
    if (conDato.length === 1) {
        v.estado = 'parcial';
        v.motivo = `Solo ${conDato[0]} tiene dato: no hay evolución que dibujar, solo ese punto.`;
    }
    v.grafico = { tipo: 'lineas', anios, unidad: def.unidad, series, referencia: def.referencia ?? null };
    const primero = conDato[0];
    const ultimo = conDato[conDato.length - 1];
    const k0 = anios.indexOf(primero);
    const k1 = anios.indexOf(ultimo);
    v.resumen = `${nombre}, ${conDato.length} de ${anios.length} años con dato (${primero} a ${ultimo}, ${v.unidad}). ` +
        series.map((s) => `${s.rotulo}: ${formatoSerie(s.puntos[k0].valor, def.unidad)} en ${primero} y ${formatoSerie(s.puntos[k1].valor, def.unidad)} en ${ultimo}`).join('; ') + '.';
    return v;
}

function vacio(g) {
    if (g.tipo === 'firmadas') return g.columnas.every((c) => !c.segmentos.some((s) => hay(s.valor) && s.valor !== 0));
    if (g.tipo === 'apilada') return !g.segmentos.length;
    if (g.tipo === 'cascada') return g.pasos.every((p) => !hay(p.valor) || p.valor === 0);
    if (g.tipo === 'vinetas') return g.filas.every((f) => f.pctObligado === null && f.pctPagado === null && !f.vigente && !f.obligado && !f.pagado);
    if (g.tipo === 'lineas') return g.series.every((s) => s.puntos.every((p) => !hay(p.valor)));
    return false;
}

const CONSTRUCTORES = {
    '01_origen_asignacion': v01, '02_ejecucion_partidas': v02, '03_jerarquia_gasto': v03, '04_formacion_presupuesto': v04, '05_resultado_contable': v05,
    '06_composicion_ingresos': v06, '07_liquidez': v07, '08_ingresos_egresos': v08, '09_presupuesto_ejecucion': v09,
    '10_inversion_fisica': (c, M) => vGrupo(c, M, '500'), '11_servicios_personales': (c, M) => vGrupo(c, M, '100'), '12_transferencias': v12,
    '13_recursos_obligaciones': v13, '14_balance': v14, evolucion_historica: vEvolucion,
};

// La vista de un gráfico para una municipalidad (M null: sin informe). Un error del armado no deja cifras: estado «error».
// La evolución histórica de una municipalidad sin informe en 2025 se arma igual con los años anteriores (contexto.historia).
export function construirVista(cat, M, entrada, opciones = {}, contexto = {}) {
    if (cat.id === 'evolucion_historica' && entrada && !M && contexto.historia) {
        try {
            return vEvolucion(cat, null, opciones, { ...contexto, nombre: entrada.nombre });
        } catch (error) {
            return { ...base(cat, null), estado: 'error', causa: 'tecnico', formato: 'error', motivo: `No se pudo armar el gráfico: ${error.message}`, grafico: null, tabla: null };
        }
    }
    if (!entrada || entrada.estado === 'sin_informe') {
        const v = base(cat, null);
        return { ...sinDatos(v, `${entrada?.nombre ?? 'Esta municipalidad'} no presentó informe en el corte del 31/12/2025 (MEF, V-A y V-B p.11): no hay ` +
                               'cifras que dibujar, y eso no afirma un incumplimiento actual ni una deuda cero.', 'sin_informe'), fuente: 'Ministerio de Economía y Finanzas de Paraguay (MEF), Informe Financiero 2025, V-A y V-B p.11 (nota de municipalidades sin informe).' };
    }
    const fn = CONSTRUCTORES[cat.id];
    try {
        if (!fn) throw new Error(`Gráfico desconocido: ${cat.id}`);
        const v = fn(cat, M, opciones, contexto);
        // Nada de gráficos aparentemente vacíos (ejes y ceros): sin un importe distinto de cero, la vista queda sin datos.
        if (v.grafico && vacio(v.grafico)) {
            return { ...sinDatos(v, 'Todos los importes de esta vista son cero publicado o no tienen dato: no hay nada que dibujar (las cifras están en la tabla).', 'cero'),
                     tabla: v.tabla, avisos: v.avisos };
        }
        return v.grafico?.tipo === 'sankey' ? marcarSinDato(v) : v;
    } catch (error) {
        return { ...base(cat, M), estado: 'error', causa: 'tecnico', formato: 'error', motivo: `No se pudo armar el gráfico: ${error.message}`, grafico: null, tabla: null };
    }
}

// --- Ficha municipal -------------------------------------------------------------------------------------------------------
export const PRIORITARIOS = [
    { campo: 'presupuesto_vigente_gastos_gs', texto: 'Presupuesto total anual vigente', alcance: 'Presupuesto vigente de gastos al 31/12/2025.' },
    { campo: 'inversion_fisica_presupuesto_gs', texto: 'Presupuesto de inversión física', alcance: 'Grupo 500 del gasto, presupuesto vigente.' },
    { campo: 'presupuesto_servicios_personales_gs', texto: 'Presupuesto de servicios personales',
      alcance: 'Grupo 100 completo (remuneraciones, personal contratado, aportes y otros), no solo sueldos.' },
    { campo: 'transferencias_intergubernamentales_sobre_presupuesto_pct', texto: '% presupuestado de transferencias intergubernamentales',
      alcance: 'Renglones de 150 y 220 con emisor gubernamental sobre el presupuesto vigente de ingresos; N/D si la clasificación está incompleta.', unidad: '%' },
];

// En los años del histórico no hay presupuesto: la ficha lleva las cuentas principales del balance y el resultado (M57).
export const PRIORITARIOS_HISTORICO = [
    { campo: 'activo_total_gs', texto: 'Activo total', alcance: 'Cuenta 2 del balance, al 31 de diciembre.' },
    { campo: 'pasivo_total_gs', texto: 'Pasivo total', alcance: 'Cuenta 4 del balance, al 31 de diciembre.' },
    { campo: 'patrimonio_neto_cuenta8_gs', texto: 'Patrimonio neto (cuenta 8)', alcance: 'Sin el resultado del ejercicio, que el balance expone aparte.' },
    { campo: 'resultado_contable_gs', texto: 'Resultado contable del ejercicio', alcance: 'Ingresos de gestión (cuenta 5) menos egresos de gestión (cuenta 3).' },
];

export function ficha(M) {
    return (M.historico ? PRIORITARIOS_HISTORICO : PRIORITARIOS).map((p) => {
        const x = M.prioritarios?.[p.campo] ?? { valor: null, motivo: 'No disponible en los datos publicados.' };
        return { ...p, valor: x.valor, motivo: hay(x.valor) ? null : (x.motivo ?? 'No disponible.'),
                 texto_valor: hay(x.valor) ? (p.unidad === '%' ? porciento(x.valor) : gs(x.valor)) : ND };
    });
}

// --- CSV -------------------------------------------------------------------------------------------------------------------
// UTF-8 (con BOM al descargar), separador coma. Los importes van enteros y exactos; los porcentajes y las razones, con
// punto decimal. Los textos que una planilla tomaría como fórmula (=, +, -, @, tabulador o retorno al empezar) llevan un
// apóstrofo; los números negativos no se tocan.
export const protegerTexto = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

function celdaCsv(valor, tipo) {
    let s;
    if (!hay(valor)) s = '';
    else if (typeof valor === 'number') s = tipo === 'importe' || Number.isInteger(valor) ? String(valor) : String(Math.round(valor * 1e8) / 1e8);
    else s = protegerTexto(String(valor));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvDeVista(v, entrada, meta) {
    if (!v.tabla) return null;
    const identificador = { codigo_mef: 'codigo_mef', clave_distrito: 'clave_distrito' }[entrada.sistema] ?? 'clave_interna';
    const fijas = [['ejercicio', meta.ejercicio], ['corte', meta.corte], ['municipio', entrada.nombre], ['nombre_en_la_fuente', entrada.nombre_fuente ?? ''],
                   [identificador, entrada.id], ['departamento', entrada.departamento_nombre],
                   ['grafico', v.id], ['formato', v.formato], ['apertura', v.apertura?.actual ?? ''], ['metrica', v.metrica?.actual ?? ''],
                   ['unidad', v.unidad], ['etapas', v.etapas]];
    const finales = [['estado_de_la_vista', v.estado], ['fuente', v.fuente], ['version_datos', meta.version], ['metodo', METODO]];
    const titulos = [...fijas.map(([k]) => k), ...v.tabla.columnas.map((c) => c.id), ...finales.map(([k]) => k)];
    const lineas = [titulos.map((t) => celdaCsv(t)).join(',')];
    for (const f of v.tabla.filas) {
        lineas.push([...fijas.map(([, x]) => celdaCsv(x)), ...v.tabla.columnas.map((c) => celdaCsv(f[c.id], c.tipo)), ...finales.map(([, x]) => celdaCsv(x))].join(','));
    }
    return `${lineas.join('\r\n')}\r\n`;
}

// --- Cobertura -------------------------------------------------------------------------------------------------------------
export function coberturaDe(catalogoGraficos, M, entrada, contexto) {
    const out = {};
    for (const cat of catalogoGraficos) {
        const v = construirVista(cat, M, entrada, {}, contexto);
        out[cat.id] = { estado: v.estado, formato: v.formato, cambio: v.cambio?.causa ?? null, motivo: v.motivo ?? null };
    }
    return out;
}
