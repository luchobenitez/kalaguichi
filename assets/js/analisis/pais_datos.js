// Ámbito «Paraguay, por distrito» de Análisis (ADR-023, tarea M21): los distritos son las unidades, con la Intendencia y la
// Junta Municipal del índice nacional (distritos.json; ADR-024: porCargo['1'] y porCargo['2'], con los mismos campos), la
// pobreza multidimensional del INE por distrito (indicadores_distritos.json: H, A e
// IPM en el total del distrito o en su área urbana o rural) y los colores de los partidos (colores.json). Asunción no tiene
// IPM distrital (el INE lo publica por barrio): queda fuera de los gráficos, con el motivo en la nota. Sin HTML desde datos.
import { indiceNacional, archivoNacional, normalizarIndice } from '../datos.js';
import { el, pct, pct2 } from '../tablero/util.js';

export const LOCALES = '~locales';
export const NOMBRE_LOCALES = 'Alianzas y movimientos locales';
export const EMPATE = '~empate';
export const COMPONENTES = [['H', 'Incidencia'], ['A', 'Intensidad'], ['IPM', 'IPM']];
export const AREAS = [['total', 'Total'], ['urbana', 'Urbana'], ['rural', 'Rural']];
const EN_AREA = { total: '', urbana: ' (área urbana)', rural: ' (área rural)' };
export const PUNTO = { circulo: 'circle', rombo: 'rectRot', cuadrado: 'rect' };
// Curvas por partido: hasta 8 tramos, con unos 15 distritos por tramo como mínimo.
export const TRAMOS_PAIS = 8;
export const DISTRITOS_POR_TRAMO = 15;
// Las alianzas y los movimientos van juntos («locales») en las municipales y las complementarias (cada uno es de un
// distrito); en las generales son nacionales o departamentales y van cada uno con su sigla (ADR-042).
export const agrupaLocales = (eleccion) => ['municipales', 'complementarias'].includes(eleccion);

export async function cargarPais(eleccion, anio, fuente = null) {
    const [indice, ipm, colores] = await Promise.all([indiceNacional(eleccion, anio, fuente), archivoNacional(eleccion, anio, 'indicadores_distritos.json'),
                                                      archivoNacional(eleccion, anio, 'colores.json')]);
    return armarPais(indice, ipm, colores, { agruparLocales: agrupaLocales(eleccion) });
}

// Los datos del país desde los tres archivos (también para las pruebas, sin fetch). El índice, en la versión 2 (ADR-042:
// un bloque por cargo en cada distrito; el de municipales 2026 se convierte): por cargo, un registro por distrito con los
// mismos campos (votos, listas, ganadora…), los electores (los de las mesas con acta del TREP o el padrón del TSJE) y la
// participación (votos emitidos sobre esos electores). Sin ganadora (un empate en el primer lugar), la lista ficticia del
// empate en el gris de «otro».
export function armarPais(original, ipm, colores, { agruparLocales = true } = {}) {
    const indice = normalizarIndice(original);
    const porCargo = {};
    const cargos = [...new Set(indice.distritos.flatMap((d) => Object.keys(d.cargos ?? {})))].sort((a, b) => Number(a) - Number(b));
    for (const cargo of cargos) {
        const distritos = indice.distritos.filter((d) => d.cargos?.[cargo]).map((d) => {
            const x = d.cargos[cargo];
            const padron = d.electores?.padron ?? 0;
            const enMesas = x.electores_en_mesas_con_acta ?? d.electores?.en_mesas_con_acta ?? padron;
            return { ...d, ...x, nocomputados: x.nocomputados ?? 0, mesas: { esperadas: d.mesas?.esperadas ?? 0, con_acta: x.mesas ?? d.mesas?.con_acta ?? 0 },
                     electores: { padron, en_mesas_con_acta: enMesas ?? 0 }, participacion: x.participacion ?? (enMesas ? x.emitidos / enMesas : null),
                     bancas: x.bancas ?? { total: 0, reparto: {} }, ganadora: x.ganadora ?? EMPATE,
                     gana: x.listas[x.ganadora] ?? { nombre: 'Empate en el primer lugar', color: colores.otro, tipo: 'empate', forma: 'cuadrado' } };
        });
        if (!distritos.length) continue;
        const partidos = new Map();
        for (const d of distritos) {
            for (const [sigla, x] of Object.entries(d.listas)) {
                if (x.tipo !== 'partido' && agruparLocales) continue;
                const p = partidos.get(sigla) ?? { sigla, nombre: x.nombre, color: colores.partidos?.[sigla] ?? x.color, forma: x.forma, distritos: 0 };
                p.distritos += 1;
                partidos.set(sigla, p);
            }
        }
        porCargo[cargo] = { distritos, porClave: new Map(distritos.map((d) => [d.clave, d])), partidos };
    }
    // El cargo por omisión: la Junta Municipal en las municipales; si no, el primero.
    const base = porCargo['2'] ? '2' : Object.keys(porCargo)[0];
    // Los distritos de entonces que abarcaban varios de hoy (ADR-043) no tienen IPM: el del Censo 2022 es por distrito de hoy.
    const abarcan = new Set(indice.distritos.filter((d) => d.abarca).map((d) => d.clave));
    return { pais: true, agruparLocales, indice, departamentos: indice.departamentos, porDep: new Map(indice.departamentos.map((d) => [d.codigo, d])), porCargo,
             distritos: porCargo[base].distritos, porClave: porCargo[base].porClave, partidos: porCargo[base].partidos,
             ipm, ipmPor: new Map(Object.entries(ipm.distritos).filter(([clave]) => !abarcan.has(clave))), abarcan, colores };
}

// Grupo de una lista del distrito: su partido o, en las municipales, si es una alianza, un movimiento local o una lista
// solo de Intendencia (cada uno de un solo distrito), todas ellas juntas, en verde; en las generales, cada alianza con su
// sigla. Un empate en el primer lugar, su propio grupo gris.
export function grupoDe(datos, d, sigla = d.ganadora, cargo = '2') {
    const x = d.listas[sigla];
    if (!x) return { id: EMPATE, sigla: 'Empate', nombre: 'Empate en el primer lugar', color: datos.colores.otro, forma: 'cuadrado' };
    if (x.tipo === 'partido' || datos.agruparLocales === false) {
        const p = (datos.porCargo?.[cargo]?.partidos ?? datos.partidos).get(sigla);
        return { id: sigla, sigla, nombre: p?.nombre ?? x.nombre, color: p?.color ?? x.color, forma: p?.forma ?? x.forma };
    }
    return { id: LOCALES, sigla: 'Locales', nombre: NOMBRE_LOCALES, color: datos.colores.verdes[0], forma: datos.colores.formas?.alianza ?? 'rombo' };
}

// Electores habilitados de un distrito según el padrón (ADR-025): los votos posibles, iguales en los dos cargos. No son los
// habitantes: el padrón cuenta a las personas habilitadas para votar.
export const electoresDe = (d) => d.electores.padron;
// «Distritos»: el deslizador va de 0 al múltiplo de PASO_ELECTORES más alto que deja al menos un distrito con más electores.
export const PASO_ELECTORES = 1000;
export const maximoElectores = (distritos) => Math.max(0, Math.floor((Math.max(...distritos.map(electoresDe)) - 1) / PASO_ELECTORES) * PASO_ELECTORES);
// Un distrito se ve con su lista si tiene más electores que el mínimo elegido (con 0, todos).
export const superaMinimo = (d, minimo) => electoresDe(d) > minimo;
// El mínimo pedido en el enlace, en el paso del deslizador y dentro de su rango; si no es un número, 0.
export function minimoDelEnlace(valor, maximo) {
    const n = /^\d+$/.test(valor ?? '') ? Number(valor) : 0;
    return Math.min(maximo, Math.round(n / PASO_ELECTORES) * PASO_ELECTORES);
}
// «Electores por distrito»: tramos fijos (cada uno incluye su límite inferior).
export const CORTES_ELECTORES = [5000, 10000, 20000, 50000, 100000];
export const tramoElectores = (v) => CORTES_ELECTORES.filter((c) => v >= c).length;
export function textoTramo(k, formato = new Intl.NumberFormat('es-PY')) {
    if (k === 0) return `Menos de ${formato.format(CORTES_ELECTORES[0])}`;
    if (k === CORTES_ELECTORES.length) return `${formato.format(CORTES_ELECTORES[k - 1])} o más`;
    return `${formato.format(CORTES_ELECTORES[k - 1])} a ${formato.format(CORTES_ELECTORES[k] - 1)}`;
}

// Votos de una lista en un distrito del cargo (ADR-027): los de un partido (su sigla) o, con LOCALES, la suma de las
// alianzas y los movimientos locales del distrito; null si el distrito no tiene esa lista.
export function votosDeLista(d, id) {
    if (id === LOCALES) {
        const locales = Object.entries(d.listas).filter(([, x]) => x.tipo !== 'partido');
        return locales.length ? locales.reduce((a, [sigla]) => a + (d.votos[sigla] ?? 0), 0) : null;
    }
    return d.listas[id] ? d.votos[id] ?? 0 : null;
}
// Sus votos sobre los votos a listas del distrito, en %; null sin lista.
export function pctDeLista(d, id) {
    const v = votosDeLista(d, id);
    return v === null || !d.votos_listas ? null : (100 * v) / d.votos_listas;
}

// Valor del componente k en el área; sin dato (Asunción, un área sin población) o intensidad sin personas pobres: null.
export function valorIpm(datos, clave, k, area) {
    const x = datos.ipmPor.get(clave);
    const v = x?.[k]?.[area];
    return v === null || v === undefined || (k === 'A' && x.H[area] === 0) ? null : v;
}

// Por qué un distrito no tiene el valor.
export function sinIpm(datos, clave, area) {
    if (datos.abarcan?.has(clave)) return 'abarcaba varios distritos de hoy';
    const x = datos.ipmPor.get(clave);
    if (!x) return 'IPM por barrio';
    return x.H[area] === null ? `sin población ${area}` : 'sin dato';
}

export const indicador = (datos, k) => datos.ipm.indicadores.find((x) => x.id === k);
export const textoArea = (area) => EN_AREA[area];
export const formatoIpm = (k, v) => `${(k === 'A' ? pct : pct2).format(v)} %`;
// Nombre del componente dentro de una frase: sin el paréntesis y en minúscula, salvo una sigla («IPM»).
export function enFrase(datos, k) {
    const base = indicador(datos, k).nombre.replace(/\s*\(.*\)\s*$/, '');
    return base === base.toUpperCase() ? base : base.toLowerCase();
}

// Los distritos ordenados por x (y por nombre, con el mismo valor) en k tramos con la misma cantidad de distritos (o una
// de diferencia): cada uno va al tramo que le toca por su lugar en el orden.
export function tramosDistritos(unidades, k) {
    const orden = [...unidades].sort((a, b) => a.x - b.x || a.nombre.localeCompare(b.nombre, 'es'));
    const grupos = [];
    orden.forEach((u, i) => {
        const g = Math.min(k - 1, Math.floor((i * k) / orden.length));
        (grupos[g] ??= { distritos: [] }).distritos.push(u);
    });
    return grupos.filter(Boolean).map((g) => ({ ...g, x: g.distritos.reduce((a, u) => a + u.x, 0) / g.distritos.length,
                                                desde: g.distritos[0].x, hasta: g.distritos.at(-1).x }));
}
export const cantidadTramosPais = (n) => Math.max(1, Math.min(TRAMOS_PAIS, Math.floor(n / DISTRITOS_POR_TRAMO)));

// Controles del IPM de los análisis del país: el componente y el área, con botones de segmento.
export function segmentos(etiqueta, opciones, atributo) {
    const grupo = el('div', 'segmentos');
    grupo.setAttribute('role', 'group');
    grupo.setAttribute('aria-label', etiqueta);
    for (const [id, nombre] of opciones) {
        const boton = el('button', null, nombre);
        boton.type = 'button';
        boton.dataset[atributo] = id;
        grupo.append(boton);
    }
    return grupo;
}

// Agrega al contenedor los controles del componente y del área; al tocar uno cambia estado.ipm o estado.area y llama a
// alCambiar. Devuelve marcar(), que refleja el estado en los botones.
export function controlesIpm(contenedor, estado, alCambiar) {
    const componentes = segmentos('Componente del IPM', COMPONENTES, 'ipm');
    const areas = segmentos('Área del distrito', AREAS, 'area');
    for (const [grupo, clave] of [[componentes, 'ipm'], [areas, 'area']]) {
        grupo.addEventListener('click', (evento) => {
            const boton = evento.target.closest(`[data-${clave}]`);
            if (!boton || boton.dataset[clave] === estado[clave]) return;
            estado[clave] = boton.dataset[clave];
            alCambiar();
        });
    }
    contenedor.append(componentes, areas);
    return () => {
        for (const b of componentes.querySelectorAll('[data-ipm]')) b.setAttribute('aria-pressed', String(b.dataset.ipm === estado.ipm));
        for (const b of areas.querySelectorAll('[data-area]')) b.setAttribute('aria-pressed', String(b.dataset.area === estado.area));
    };
}

export const ipmDelEnlace = (p) => ({ ipm: COMPONENTES.some(([id]) => id === p.get('ipm')) ? p.get('ipm') : 'H',
                                      area: AREAS.some(([id]) => id === p.get('area')) ? p.get('area') : 'total' });
export const ipmAlEnlace = (estado) => ({ ipm: estado.ipm === 'H' ? null : estado.ipm, area: estado.area === 'total' ? null : estado.area });

// Los distritos que quedan fuera de un gráfico, en una frase: Asunción (IPM por barrio) y los que no tienen el dato del área.
export function textoFuera(datos, distritos, area) {
    const asuncion = distritos.some((d) => !datos.ipmPor.get(d.clave) && !datos.abarcan?.has(d.clave));
    const unidos = distritos.filter((d) => datos.abarcan?.has(d.clave)).length;
    const sinArea = distritos.filter((d) => datos.ipmPor.get(d.clave) && datos.ipmPor.get(d.clave).H[area] === null).length;
    const partes = [];
    if (asuncion) partes.push('Asunción, cuyo IPM el INE publica por barrio (lo usan los análisis de Asunción)');
    if (unidos) partes.push(`${unidos === 1 ? 'un distrito de entonces' : `${unidos} distritos de entonces`} que abarcaba${unidos === 1 ? '' : 'n'} ` +
                            'varios de hoy (el IPM del Censo 2022 es por distrito de hoy)');
    if (sinArea) partes.push(`${sinArea === 1 ? 'un distrito' : `${sinArea} distritos`} sin población ${area}`);
    return partes.length ? `Fuera del gráfico: ${partes.join(' y ')}.` : '';
}
