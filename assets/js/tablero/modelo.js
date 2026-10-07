// Modelo de una elección y una fuente (TREP u oficial, mismo esquema: datos/LEEME.md): mesas con acta, locales,
// geometría, candidaturas e indicadores por barrio, y sus sumas. No toca el DOM: lo usan el tablero, la vista informe
// y, más adelante, los análisis.
import { cargarEleccion } from '../datos.js';
import { fmt, pct } from './util.js';

// Comparación pedida por el usuario para el margen: Camilo Pérez (ANR) frente a Soledad Núñez (AJA).
export const MARGEN = { cargo: '1', positivo: 'ANR', negativo: 'AJA' };
// Daltonismo: además del color, la forma distingue las listas en los puntos y en sus leyendas. Rojo y verde (ANR y la
// Alianza: AJA en Intendencia, AUA en Junta) son los que más se confunden; las demás listas van en cuadrado.
const FORMAS = { ANR: 'circulo', AJA: 'rombo', AUA: 'rombo' };
export const formaDe = (item) => FORMAS[item?.sigla] ?? 'cuadrado';

// Archivos que usa el tablero: los comunes a las fuentes y los de la fuente elegida.
const ARCHIVOS = { comun: ['locales.json', 'geo.json', 'candidaturas.json', 'indicadores_barrios.json'], fuente: ['resumen.json', 'mesas.json'] };

export function construirModelo(resumen, mesas, locales, geo, cand, ipm) {
    const claveLocal = (z, l) => `${z}-${l}`;
    const listas = {};
    for (const cargo of ['1', '2']) {
        const porNum = Object.fromEntries(cand[cargo].map((x) => [x.numLista, x]));
        listas[cargo] = mesas.cargos[cargo].listas.map((num) => ({ num, ...porNum[num] }));
    }
    const infoLocal = new Map(locales.locales.map((x) => [claveLocal(x.zona, x.local), x]));
    const filas = mesas.mesas.map(([zona, local, mesa], i) => {
        const info = infoLocal.get(claveLocal(zona, local));
        return { i, zona, local, mesa, clave: claveLocal(zona, local), barrio: info.barrio, zonaMunicipal: info.zona_municipal };
    });
    const porLocal = new Map();
    for (const f of filas) {
        if (!porLocal.has(f.clave)) porLocal.set(f.clave, []);
        porLocal.get(f.clave).push(f);
    }
    const indiceMargen = {
        positivo: listas[MARGEN.cargo].findIndex((x) => x.sigla === MARGEN.positivo),
        negativo: listas[MARGEN.cargo].findIndex((x) => x.sigla === MARGEN.negativo),
    };
    const barrioPor = new Map(geo.barrios.map((b) => [b.nombre, b]));
    const zonaMunicipalPor = new Map(geo.zonas_municipales.map((z) => [z.numero, z]));
    // IPM por barrio (INE, Censo 2022), unido a la geometría por la clave del barrio (CLAVE_BAR).
    const ipmPor = new Map(ipm.barrios.map((b) => [b.clave, b]));
    // Mesas sin acta (cobertura): con su local, para contarlas en cada selección.
    const faltantes = resumen.cobertura.faltantes.map((x) => ({ ...x, clave: claveLocal(x.zona, x.local), info: infoLocal.get(claveLocal(x.zona, x.local)) }));

    // Suma de un conjunto de mesas para un cargo: votos por lista, demás campos y electores del padrón.
    function sumar(indices, cargo) {
        const c = mesas.cargos[cargo];
        const total = { votos: new Array(c.listas.length).fill(0), blancos: 0, nulos: 0, nocomputados: 0, emitidos: 0, electores: 0, mesas: indices.length };
        for (const i of indices) {
            c.votos[i].forEach((v, j) => { total.votos[j] += v; });
            total.blancos += c.blancos[i];
            total.nulos += c.nulos[i];
            total.nocomputados += c.nocomputados[i];
            total.emitidos += c.emitidos[i];
            total.electores += mesas.electores[i];
        }
        total.listas = total.votos.reduce((a, b) => a + b, 0);
        return total;
    }

    return { resumen, mesas, geo, cand, ipm, ipmPor, listas, infoLocal, filas, porLocal, faltantes, indiceMargen, claveLocal, barrioPor,
             zonaMunicipalPor, mapas: {}, sumar, mesasDe: (filtro) => filas.filter(filtro).map((f) => f.i) };
}

// Carga la elección del hash (o la primera del manifiesto) y arma el modelo; datos es null si la fuente está pendiente.
export async function cargarModelo(pedido, fuente) {
    const eleccion = await cargarEleccion(pedido, fuente, ARCHIVOS);
    if (!eleccion.datos) return { eleccion, datos: null };
    const d = eleccion.datos;
    const datos = construirModelo(d['resumen.json'], d['mesas.json'], d['locales.json'], d['geo.json'], d['candidaturas.json'],
                                  d['indicadores_barrios.json']);
    datos.contexto = eleccion;
    return { eleccion, datos };
}

export function ganador(votos) {
    const maximo = Math.max(...votos);
    const indices = votos.flatMap((v, j) => (v === maximo ? [j] : []));
    return maximo > 0 && indices.length === 1 ? indices[0] : null;
}

export function participacion(total) {
    return total.electores ? (100 * total.emitidos) / total.electores : null;
}

// Margen en puntos (ANR − AJA sobre votos a listas de Intendencia); null en otro cargo o sin votos a listas.
export function margenDe(datos, total, cargo) {
    if (cargo !== MARGEN.cargo || !total.listas) return null;
    return (100 * (total.votos[datos.indiceMargen.positivo] - total.votos[datos.indiceMargen.negativo])) / total.listas;
}

export function nombreDe(item, cargo) {
    return cargo === '1' ? item.nombre : `${item.sigla} · ${item.lista}`;
}

// Agregados por barrio (lugar de los locales) para un cargo.
export function agregadosBarrio(datos, cargo) {
    const porBarrio = new Map();
    for (const f of datos.filas) {
        if (!f.barrio) continue;
        if (!porBarrio.has(f.barrio)) porBarrio.set(f.barrio, []);
        porBarrio.get(f.barrio).push(f.i);
    }
    return new Map([...porBarrio].map(([b, idx]) => [b, datos.sumar(idx, cargo)]));
}

// Unidades para histograma, tabla y ranking (incluir: filtro de mesas); el margen se calcula con sumas de votos.
export function unidades(datos, tipo, cargo, incluir = () => true) {
    const grupos = new Map();
    const agregar = (clave, fila, datosGrupo) => {
        if (!grupos.has(clave)) grupos.set(clave, { clave, ...datosGrupo, indices: [] });
        grupos.get(clave).indices.push(fila.i);
    };
    for (const f of datos.filas) {
        if (!incluir(f)) continue;
        const info = datos.infoLocal.get(f.clave);
        if (tipo === 'mesa') agregar(`${f.clave}-${f.mesa}`, f, { nombre: `${info.nombre} · mesa ${f.mesa}`, zona: f.zona, local: f.clave, mesa: f.mesa, barrio: info.barrio });
        if (tipo === 'local') agregar(f.clave, f, { nombre: info.nombre, zona: f.zona, local: f.clave, barrio: info.barrio });
        if (tipo === 'barrio') agregar(info.barrio ?? 'Sin barrio', f, { nombre: info.barrio ?? 'Sin barrio', barrioClave: info.barrio });
        if (tipo === 'zona') agregar(String(f.zona), f, { nombre: datos.resumen.zonas[f.zona], zona: f.zona });
        if (tipo === 'zona_municipal') agregar(String(f.zonaMunicipal), f, { nombre: datos.resumen.zonas_municipales[f.zonaMunicipal] ?? 'Sin zona', zonaMunicipal: f.zonaMunicipal });
    }
    return [...grupos.values()].map((g) => ({ ...g, total: datos.sumar(g.indices, cargo) }));
}

// Reparto D'Hondt de `bancas` entre las listas (votos por lista, en el orden de las listas): los mayores cocientes
// v/1 … v/bancas; un empate en el cociente lo gana la lista con más votos. corte: el último cociente que obtiene banca.
export function dhondt(votos, bancas) {
    const cocientes = [];
    votos.forEach((v, j) => { for (let d = 1; d <= bancas; d++) cocientes.push({ j, q: v / d, v }); });
    cocientes.sort((a, b) => b.q - a.q || b.v - a.v || a.j - b.j);
    const reparto = new Array(votos.length).fill(0);
    for (const c of cocientes.slice(0, bancas)) reparto[c.j] += 1;
    return { reparto, corte: cocientes[bancas - 1]?.q ?? 0 };
}

// Mesas que están en una fuente y no en la otra. Las dos fuentes comparten las mesas esperadas y cada una lista las
// que no tienen acta (cobertura.faltantes): soloAqui son las mesas con acta aquí y sin acta en la otra fuente; soloAlla,
// las que aquí no tienen acta y en la otra sí.
export function compararFuentes(datos, resumenOtra) {
    if (!resumenOtra) return null;
    const clave = (x) => `${x.zona}-${x.local}-${x.mesa}`;
    const faltanAlla = new Set(resumenOtra.cobertura.faltantes.map(clave));
    const soloAqui = new Set(datos.filas.map((f) => `${f.clave}-${f.mesa}`).filter((k) => faltanAlla.has(k)));
    const soloAlla = datos.faltantes.filter((x) => !faltanAlla.has(clave(x)));
    return { soloAqui, soloAlla };
}

// Texto de un barrio para el mapa: lista más votada, emitidos, participación y población.
export function textoBarrio(datos, nombre, total, cargo) {
    const b = datos.barrioPor.get(nombre);
    const poblacion = b?.poblacion_2022 ? ` · población 2022: ${fmt.format(b.poblacion_2022)}` : '';
    if (!total) return `${nombre}: sin locales de votación${poblacion}`;
    const j = ganador(total.votos);
    const lider = j === null ? 'empate' : `${datos.listas[cargo][j].sigla} ${pct.format((100 * total.votos[j]) / total.listas)} %`;
    return `${nombre}: ${lider} · ${fmt.format(total.emitidos)} emitidos · participación ${pct.format(participacion(total))} %${poblacion}`;
}
