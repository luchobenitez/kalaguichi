// Ámbito «Paraguay, por distrito» de Análisis (ADR-023, tarea M21): los distritos son las unidades, con la Junta Municipal
// del índice nacional (distritos.json), la pobreza multidimensional del INE por distrito (indicadores_distritos.json: H, A e
// IPM en el total del distrito o en su área urbana o rural) y los colores de los partidos (colores.json). Asunción no tiene
// IPM distrital (el INE lo publica por barrio): queda fuera de los gráficos, con el motivo en la nota. Sin HTML desde datos.
import { indiceNacional, archivoNacional } from '../datos.js';
import { el, pct, pct2 } from '../tablero/util.js';

export const LOCALES = '~locales';
export const NOMBRE_LOCALES = 'Alianzas y movimientos locales';
export const COMPONENTES = [['H', 'Incidencia'], ['A', 'Intensidad'], ['IPM', 'IPM']];
export const AREAS = [['total', 'Total'], ['urbana', 'Urbana'], ['rural', 'Rural']];
const EN_AREA = { total: '', urbana: ' (área urbana)', rural: ' (área rural)' };
export const PUNTO = { circulo: 'circle', rombo: 'rectRot', cuadrado: 'rect' };
// Curvas por partido: hasta 8 tramos, con unos 15 distritos por tramo como mínimo.
export const TRAMOS_PAIS = 8;
export const DISTRITOS_POR_TRAMO = 15;

export async function cargarPais(eleccion, anio) {
    const [indice, ipm, colores] = await Promise.all([indiceNacional(eleccion, anio), archivoNacional(eleccion, anio, 'indicadores_distritos.json'),
                                                      archivoNacional(eleccion, anio, 'colores.json')]);
    return armarPais(indice, ipm, colores);
}

// Los datos del país desde los tres archivos (también para las pruebas, sin fetch).
export function armarPais(indice, ipm, colores) {
    const distritos = indice.distritos.map((d) => ({ ...d, gana: d.listas[d.ganadora] }));
    const partidos = new Map();
    for (const d of distritos) {
        for (const [sigla, x] of Object.entries(d.listas)) {
            if (x.tipo !== 'partido') continue;
            const p = partidos.get(sigla) ?? { sigla, nombre: x.nombre, color: colores.partidos?.[sigla] ?? x.color, forma: x.forma, distritos: 0 };
            p.distritos += 1;
            partidos.set(sigla, p);
        }
    }
    return { pais: true, indice, departamentos: indice.departamentos, porDep: new Map(indice.departamentos.map((d) => [d.codigo, d])), distritos,
             porClave: new Map(distritos.map((d) => [d.clave, d])), ipm, ipmPor: new Map(Object.entries(ipm.distritos)), colores, partidos };
}

// Grupo de una lista del distrito: su partido o, si es una alianza o un movimiento local (cada uno de un solo distrito),
// todas ellas juntas, en verde.
export function grupoDe(datos, d, sigla = d.ganadora) {
    const x = d.listas[sigla];
    if (x.tipo === 'partido') {
        const p = datos.partidos.get(sigla);
        return { id: sigla, sigla, nombre: p.nombre, color: p.color, forma: p.forma };
    }
    return { id: LOCALES, sigla: 'Locales', nombre: NOMBRE_LOCALES, color: datos.colores.verdes[0], forma: datos.colores.formas?.alianza ?? 'rombo' };
}

// Valor del componente k en el área; sin dato (Asunción, un área sin población) o intensidad sin personas pobres: null.
export function valorIpm(datos, clave, k, area) {
    const x = datos.ipmPor.get(clave);
    const v = x?.[k]?.[area];
    return v === null || v === undefined || (k === 'A' && x.H[area] === 0) ? null : v;
}

// Por qué un distrito no tiene el valor.
export function sinIpm(datos, clave, area) {
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
    const asuncion = distritos.some((d) => !datos.ipmPor.get(d.clave));
    const sinArea = distritos.filter((d) => datos.ipmPor.get(d.clave) && datos.ipmPor.get(d.clave).H[area] === null).length;
    const partes = [];
    if (asuncion) partes.push('Asunción, cuyo IPM el INE publica por barrio (lo usan los análisis de Asunción)');
    if (sinArea) partes.push(`${sinArea === 1 ? 'un distrito' : `${sinArea} distritos`} sin población ${area}`);
    return partes.length ? `Fuera del gráfico: ${partes.join(' y ')}.` : '';
}
