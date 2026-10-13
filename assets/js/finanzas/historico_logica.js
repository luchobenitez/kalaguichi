// Finanzas municipales · Histórico (ADR-044, tarea M56): la lógica de la página /analisis/financiero/historico/, sin el
// DOM. El catálogo del manifiesto, el modelo de un año (los distritos del mapa de ese año, con los creados después dentro
// del distrito del que se separaron; ADR-043), los montos en guaraníes de cada año o de 2025 (IPC del BCP: diciembre para
// los saldos del balance, el promedio del año para los ingresos, los egresos y el resultado), el estado del enlace, el
// filtro, el color de cada distrito con las clases fijas de la página de 2025 (ADR-033), la leyenda, los textos, las filas
// de la tabla y la serie de la evolución de un municipio. Los valores no se recalculan: se leen tal como se prepararon.
// Se prueba con Node (tests/).
import { escalaFija, coloresDeEscala, claseDe, formato, numeroCelda, rotulosEscala, UNIDAD_CORTA, gris, COLOR_CERO, CLASES_FIJAS,
         sinTildes, textoCsv } from './logica.js';

export { formato, numeroCelda, rotulosEscala, coloresDeEscala, UNIDAD_CORTA, gris, sinTildes, textoCsv };
export const POR_PAGINA = 25;
export const MONTOS = ['nominales', 'constantes'];
export const ROTULO_MONTOS = { nominales: 'Guaraníes de cada año', constantes: 'Guaraníes de 2025' };
export const INICIAL = 'pasivo_sobre_activo_pct';
// Las columnas a la vista al abrir la tabla; «Mostrar todas» agrega las demás.
export const RESUMEN = ['activo_total_gs', 'pasivo_total_gs', 'patrimonio_neto_cuenta8_gs', 'ingresos_gestion_gs', 'egresos_gestion_gs',
                        'resultado_contable_gs', 'pasivo_sobre_activo_pct', 'razon_corriente'];
export const GRUPOS = ['Balance', 'Estado de resultados', 'Indicadores calculados'];
export const TEXTO = {
    sinInforme: 'Sin balance en el informe del MEF de ese año',
    noDisponible: 'Dato no disponible',
    noComparable: 'No comparable en el formato de ese año',
    sinDatosAnio: 'El MEF no publicó balances municipales ese año',
    fuera: 'Fuera del filtro',
    nd: 'N/D',
    calculado: 'Indicador calculado sobre datos publicados',
};
const PARAMETROS = ['anio', 'departamento', 'municipio', 'indicador', 'montos', 'serie', 'columnas'];

// --- Catálogo -----------------------------------------------------------------------------------------------------------
// m: manifiesto.json del histórico.
export function crearCatalogo(m) {
    const campos = m.campos.map((c) => ({ ...c, grupo: c.naturaleza === 'calculado' ? 'Indicadores calculados'
        : c.estado === 'resultados' ? 'Estado de resultados' : 'Balance', rotulo: c.naturaleza === 'calculado' ? TEXTO.calculado : 'Cifra publicada por el MEF' }));
    const conDatos = m.anios.filter((a) => a.estado === 'con_datos').map((a) => a.anio);
    return {
        manifiesto: m, campos, porCampo: new Map(campos.map((c) => [c.campo, c])), anios: m.anios,
        porAnio: new Map(m.anios.map((a) => [a.anio, a])), conDatos, ultimo: conDatos[conDatos.length - 1],
        ipc: m.ipc, estados: m.estados, notas: m.notas, textosMotivo: m.textos_motivo, formatos: m.formatos,
    };
}

// El factor que lleva un monto de un año a guaraníes de 2025 (1 en guaraníes de cada año y en porcentajes y razones).
export function factor(cat, campo, anio, montos) {
    const c = cat.porCampo.get(campo);
    if (montos !== 'constantes' || c?.unidad !== 'PYG') return 1;
    const x = cat.ipc.anios[String(anio)];
    return c.tipo === 'flujo' ? x.factor_promedio : x.factor_diciembre;
}

// --- Un año -------------------------------------------------------------------------------------------------------------
// datos: <año>.json; indice: el índice del país del sitio (municipales 2026: nombres, departamentos y centros de hoy).
// Los distritos del mapa del año son los de hoy, salvo los que todavía no existían: esos van dentro del distrito de
// entonces que los abarcaba (datos.unidos), con el nombre y el centro de ese distrito.
export function crearAnio(cat, datos, indice) {
    const pos = new Map(datos.campos.map((c, k) => [c, k]));
    const cuentas = cat.campos.filter((c) => c.naturaleza === 'publicado').length;
    const dentroDe = new Map();
    for (const [clave, u] of Object.entries(datos.unidos ?? {})) for (const c of u.abarca) if (c !== clave) dentroDe.set(c, clave);
    const municipios = indice.distritos.filter((d) => !dentroDe.has(d.clave)).map((d) => {
        const u = datos.unidos?.[d.clave];
        const r = datos.municipios[d.clave] ?? null;
        return { clave: d.clave, nombre: u?.nombre ?? d.nombre, nombreHoy: d.nombre, departamento: d.departamento,
                 departamento_nombre: d.departamento_nombre, centro: u?.centro ?? d.centro, abarca: u?.abarca ?? null,
                 estado: r ? 'informante' : 'sin_informe', registro: r };
    });
    const porClave = new Map(municipios.map((m) => [m.clave, m]));
    const nombresHoy = new Map(indice.distritos.map((d) => [d.clave, d.nombre]));
    const departamentos = indice.departamentos.map((d) => ({ codigo: d.codigo, nombre: d.nombre, caja: d.caja })).sort((a, b) => a.codigo - b.codigo);
    const escalas = new Map();
    const modelo = {
        anio: datos.anio, formato: datos.formato, fuente: datos.fuente, geometria: datos.geometria, unidos: datos.unidos ?? {}, datos,
        municipios, porClave, departamentos, dentroDe,
        // Los distritos de hoy que un distrito del mapa del año abarcaba (sin él mismo), por nombre.
        abarcados: (clave) => (porClave.get(clave)?.abarca ?? []).filter((c) => c !== clave).map((c) => nombresHoy.get(c) ?? c),
        informantes: municipios.filter((m) => m.estado === 'informante').length,
        // El valor publicado o calculado, en guaraníes de ese año (null: sin informe o no disponible).
        crudo(clave, campo) {
            const r = porClave.get(clave)?.registro;
            const k = pos.get(campo);
            return r && k !== undefined ? r.valores[k] : null;
        },
        valor(clave, campo, montos = 'nominales') {
            const v = modelo.crudo(clave, campo);
            return v === null || v === undefined ? null : v * factor(cat, campo, datos.anio, montos);
        },
        // El estado de una cifra: { codigo, texto }. Cuentas: p (publicado), s (calculado con los subtotales del propio estado),
        // n (no expuesto), f (no comparable en el formato del año), r (sin estado de resultados en el tomo); indicadores: p o
        // el motivo de su ausencia.
        estado(clave, campo) {
            const m = porClave.get(clave);
            if (!m || m.estado !== 'informante') return { codigo: 'sin_informe', texto: TEXTO.sinInforme };
            const k = pos.get(campo);
            if (k < cuentas) {
                const c = m.registro.estados[k];
                return { codigo: c, texto: cat.estados[c] };
            }
            if (m.registro.valores[k] !== null) return { codigo: 'p', texto: TEXTO.calculado };
            const mot = m.registro.motivos?.[campo];
            const texto = mot === undefined ? TEXTO.noDisponible : cat.textosMotivo[mot];
            return { codigo: texto.startsWith('No comparable') ? 'f' : 'n', texto };
        },
        paginas(clave) {
            const r = porClave.get(clave)?.registro;
            return r ? { balance: r.paginas[0], resultados: r.paginas[1] } : null;
        },
        notas(clave) {
            return (porClave.get(clave)?.registro?.notas ?? []).map((n) => cat.notas[n] ?? n);
        },
        // La escala fija del indicador con los valores del año (en los montos pedidos): los negativos deciden «Negativo».
        escala(campo, montos = 'nominales') {
            const llave = `${campo}|${montos}`;
            if (!escalas.has(llave)) {
                const unidad = cat.porCampo.get(campo).unidad;
                escalas.set(llave, escalaFija(unidad, municipios.map((m) => modelo.valor(m.clave, campo, montos))));
            }
            return escalas.get(llave);
        },
    };
    return modelo;
}

// --- Estado del enlace -------------------------------------------------------------------------------------------------
export function estadoInicial(cat) {
    return { anio: cat.ultimo, departamento: null, municipio: null, indicador: INICIAL, montos: 'nominales', serie: 'constantes', columnas: 'resumen' };
}

// El año más cercano con datos, hacia atrás (si no hay, hacia adelante).
export function anioConDatos(cat, anio) {
    const antes = cat.conDatos.filter((a) => a <= anio);
    return antes.length ? antes[antes.length - 1] : cat.conDatos[0];
}

// Lee el hash. El año, el indicador y los montos se validan contra el catálogo; el departamento y el municipio, después,
// contra el año (ajustarAlAnio). Lo desconocido se resuelve con valores válidos y un aviso.
export function leerEstado(texto, cat) {
    const p = new URLSearchParams(texto);
    const e = estadoInicial(cat);
    const avisos = [];
    const anio = p.get('anio');
    if (anio !== null) {
        const n = /^\d{4}$/.test(anio) ? Number(anio) : NaN;
        if (cat.conDatos.includes(n)) e.anio = n;
        else if (cat.porAnio.has(n)) {
            e.anio = anioConDatos(cat, n);
            avisos.push(`${TEXTO.sinDatosAnio} (${n}): ${cat.porAnio.get(n).motivo} Se muestra ${e.anio}.`);
        } else avisos.push(`El año «${anio}» no está en el histórico (${cat.anios[0].anio}-${cat.anios[cat.anios.length - 1].anio}): se muestra ${e.anio}.`);
    }
    const indicador = p.get('indicador');
    if (indicador !== null) {
        if (cat.porCampo.has(indicador)) e.indicador = indicador;
        else avisos.push(`El indicador «${indicador}» no existe: se muestra «${cat.porCampo.get(INICIAL).nombre}».`);
    }
    for (const clave of ['montos', 'serie']) {
        const v = p.get(clave);
        if (v === null) continue;
        if (MONTOS.includes(v)) e[clave] = v;
        else avisos.push(`«${clave}=${v}» no es un valor válido (${MONTOS.join(' o ')}): se usa ${clave === 'montos' ? 'nominales' : 'constantes'}.`);
    }
    const columnas = p.get('columnas');
    if (columnas !== null) {
        if (columnas === 'todas') e.columnas = 'todas';
        else avisos.push(`«columnas=${columnas}» no es un valor válido: se muestran las columnas iniciales.`);
    }
    const dep = p.get('departamento');
    if (dep !== null) e.departamento = /^\d+$/.test(dep) ? Number(dep) : dep;
    const municipio = p.get('municipio');
    if (municipio !== null) e.municipio = municipio;
    const otros = [...new Set([...p.keys()].filter((k) => !PARAMETROS.includes(k)))];
    if (otros.length) avisos.push(`Se ignoraron parámetros que esta página no usa: ${otros.join(', ')}.`);
    return { estado: e, avisos };
}

// El departamento y el municipio del estado, en el año: un municipio creado después se cambia por el distrito de entonces
// que abarcaba su territorio, con un aviso.
export function ajustarAlAnio(e, am) {
    const avisos = [];
    const nuevo = { ...e };
    if (nuevo.departamento !== null && !am.departamentos.some((d) => d.codigo === nuevo.departamento)) {
        avisos.push(`El departamento «${nuevo.departamento}» no existe: se muestran todos.`);
        nuevo.departamento = null;
    }
    if (nuevo.municipio !== null) {
        const de = am.dentroDe.get(nuevo.municipio);
        if (de) {
            avisos.push(`En ${am.anio} el distrito ${nuevo.municipio} todavía no existía: se eligió ${am.porClave.get(de).nombre}, que abarcaba su territorio.`);
            nuevo.municipio = de;
        }
        const m = am.porClave.get(nuevo.municipio);
        if (!m) {
            avisos.push(`El municipio «${nuevo.municipio}» no existe: se muestran todos.`);
            nuevo.municipio = null;
        } else if (nuevo.departamento !== null && m.departamento !== nuevo.departamento) {
            avisos.push(`${m.nombre} no pertenece a ${am.departamentos.find((d) => d.codigo === nuevo.departamento).nombre}: se quitó la selección del municipio.`);
            nuevo.municipio = null;
        }
    }
    return { estado: nuevo, avisos };
}

// El hash del estado: solo lo que difiere del estado inicial (el año siempre, para que el enlace no cambie de año).
export function textoEstado(e) {
    const p = new URLSearchParams();
    p.set('anio', String(e.anio));
    if (e.departamento !== null) p.set('departamento', String(e.departamento));
    if (e.municipio !== null) p.set('municipio', e.municipio);
    if (e.indicador !== INICIAL) p.set('indicador', e.indicador);
    if (e.montos !== 'nominales') p.set('montos', e.montos);
    if (e.serie !== 'constantes') p.set('serie', e.serie);
    if (e.columnas === 'todas') p.set('columnas', 'todas');
    return p.toString();
}

// --- Filtro y mapa ------------------------------------------------------------------------------------------------------
export function conjunto(am, e) {
    const municipios = am.municipios.filter((m) => e.departamento === null || m.departamento === e.departamento);
    const sinInforme = municipios.filter((m) => m.estado === 'sin_informe').length;
    return { claves: new Set(municipios.map((m) => m.clave)), municipios, informantes: municipios.length - sinInforme, sinInforme };
}

// El color de cada distrito: gris liso sin informe; dentro del filtro, el color de su clase, el gris tramado si el dato
// no está y el punteado si la cuenta no es comparable en el formato del año; fuera, solo el borde.
export function pintura(cat, am, e, claves, oscuro) {
    const escala = am.escala(e.indicador, e.montos);
    const colores = coloresDeEscala(escala);
    const filtro = e.departamento !== null;
    return (clave) => {
        const m = am.porClave.get(clave);
        if (!m) return { color: null, categoria: 'fuera' };
        const dentro = claves.has(clave);
        const marcado = filtro && dentro;
        if (m.estado === 'sin_informe') return { color: gris(oscuro), marcado, categoria: 'sin_informe' };
        if (!dentro) return { color: null, categoria: 'fuera' };
        const v = am.valor(clave, e.indicador, e.montos);
        if (v === null) {
            return am.estado(clave, e.indicador).codigo === 'f' ? { color: null, pendiente: true, marcado, categoria: 'no_comparable' }
                : { color: gris(oscuro), tramado: true, marcado, categoria: 'no_disponible' };
        }
        const k = claseDe(escala, v);
        return { color: k === null ? COLOR_CERO : colores[k], marcado, categoria: 'valor', clase: k };
    };
}

export function leyenda(cat, am, e, info, oscuro) {
    const metrica = cat.porCampo.get(e.indicador);
    const escala = am.escala(e.indicador, e.montos);
    const pintar = pintura(cat, am, e, info.claves, oscuro);
    const categorias = am.municipios.map((m) => pintar(m.clave));
    const cuenta = (categoria) => categorias.filter((c) => c.categoria === categoria).length;
    const colores = coloresDeEscala(escala);
    const rotulos = escala.clases.length ? rotulosEscala(escala, metrica.unidad) : [];
    const items = escala.clases.map((c, k) => ({ tipo: 'clase', color: colores[k], texto: rotulos[k], n: categorias.filter((x) => x.categoria === 'valor' && x.clase === k).length }));
    const sinInforme = cuenta('sin_informe');
    if (sinInforme) items.push({ tipo: 'sin_informe', color: gris(oscuro), texto: TEXTO.sinInforme, n: sinInforme });
    const noDisponible = cuenta('no_disponible');
    if (noDisponible) items.push({ tipo: 'no_disponible', texto: TEXTO.noDisponible, n: noDisponible });
    const noComparable = cuenta('no_comparable');
    if (noComparable) items.push({ tipo: 'pendiente', texto: TEXTO.noComparable, n: noComparable });
    if (e.departamento !== null) {
        items.push({ tipo: 'marcado', texto: 'Con contorno: en el filtro', n: info.municipios.length });
        const fuera = cuenta('fuera');
        if (fuera) items.push({ tipo: 'fuera', texto: `${TEXTO.fuera}: solo el borde`, n: fuera });
    }
    const fija = escala.tipo === 'fija';
    const montos = metrica.unidad === 'PYG' ? `; ${ROTULO_MONTOS[e.montos].toLowerCase()}` : '';
    return {
        titulo: `${metrica.nombre} (${UNIDAD_CORTA[metrica.unidad] ?? metrica.unidad}${metrica.unidad === 'PYG' ? '; MM = millones' : ''}${montos}) · ${am.anio}`,
        nota: !escala.clases.length ? `Ningún municipio tiene este dato en ${am.anio}.`
            : fija ? `Las clases fijas de la página de 2025, ${CLASES_FIJAS[metrica.unidad].texto}: de verde (lo más bajo) a amarillo y a rojo (lo más alto); ` +
                     'gris, sin datos. No califican un valor como bueno o malo.' : '',
        items,
    };
}

// --- Textos de un municipio ---------------------------------------------------------------------------------------------
// [antes, falta, después]: la falta (sin informe, no disponible, no comparable) va en rojo y negrita en la página (ADR-033).
export function partesFinancieras(cat, am, e, clave) {
    const m = am.porClave.get(clave);
    const metrica = cat.porCampo.get(e.indicador);
    if (m.estado === 'sin_informe') return ['', TEXTO.sinInforme, ''];
    const v = am.valor(clave, e.indicador, e.montos);
    if (v === null) {
        const est = am.estado(clave, e.indicador);
        return [`${metrica.nombre}: `, est.codigo === 'f' ? TEXTO.noComparable : TEXTO.noDisponible, est.texto && est.texto !== TEXTO.noDisponible ? `. ${est.texto}` : ''];
    }
    const montos = metrica.unidad === 'PYG' && e.montos === 'constantes' ? ' (guaraníes de 2025)' : '';
    return [`${metrica.nombre}: ${formato(v, metrica.unidad)}${montos}`, null, ''];
}

export function textoPaginas(am, clave) {
    const p = am.paginas(clave);
    if (!p) return null;
    const rango = (lista) => (lista.length ? (lista.length === 1 ? `pág. ${lista[0]}` : `págs. ${lista[0]}-${lista[lista.length - 1]}`) : null);
    const partes = [p.balance.length ? `balance: ${rango(p.balance)}` : null, p.resultados.length ? `resultados: ${rango(p.resultados)}` : null].filter(Boolean);
    return partes.length ? `Informe Financiero ${am.anio} del MEF (${am.fuente.tomo}): ${partes.join('; ')}` : null;
}

export function lineasMunicipio(cat, am, e, info, clave) {
    const m = am.porClave.get(clave);
    if (!m) return null;
    const fuera = info.claves.has(clave) ? '' : ` (${TEXTO.fuera.toLowerCase()})`;
    const lineas = [[`${m.nombre} · ${m.departamento_nombre}${fuera}`], partesFinancieras(cat, am, e, clave)];
    if (m.abarca) lineas.push([`En ${am.anio} abarcaba también el territorio de ${am.abarcados(clave).join(', ')} (creados después)`]);
    const paginas = textoPaginas(am, clave);
    if (paginas) lineas.push([paginas]);
    return lineas;
}

// --- Tabla --------------------------------------------------------------------------------------------------------------
export function columnas(cat, e) {
    return e.columnas === 'todas' ? cat.campos : RESUMEN.map((c) => cat.porCampo.get(c));
}

export function filasTabla(am, e, info, { busqueda = '', orden = null, valor = null } = {}) {
    let filas = e.municipio !== null ? info.municipios.filter((m) => m.clave === e.municipio) : info.municipios;
    const q = sinTildes(busqueda.trim());
    if (q) filas = filas.filter((m) => sinTildes(m.nombre).includes(q) || sinTildes(m.departamento_nombre).includes(q));
    if (orden && valor) {
        filas = [...filas].sort((a, b) => {
            const va = valor(a, orden.id), vb = valor(b, orden.id);
            if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
            if (vb === null || vb === undefined) return -1;
            return orden.dir * (typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb);
        });
    }
    return filas;
}

// --- Evolución ----------------------------------------------------------------------------------------------------------
// La serie de un distrito de hoy en todos los años del histórico: anios es un Map año → modelo del año (los que ya se
// leyeron). Cada punto: { anio, valor, estado, texto }; estado: valor, sin_datos_anio, cargando, parte_de, sin_informe,
// no_disponible o no_comparable. Con «abarca», el distrito incluía ese año el territorio de otros creados después.
export function serie(cat, anios, clave, campo, montos) {
    const metrica = cat.porCampo.get(campo);
    return cat.anios.map((a) => {
        if (a.estado !== 'con_datos') return { anio: a.anio, valor: null, estado: 'sin_datos_anio', texto: a.motivo };
        const am = anios.get(a.anio);
        if (!am) return { anio: a.anio, valor: null, estado: 'cargando', texto: 'Cargando…' };
        const de = am.dentroDe.get(clave);
        if (de) return { anio: a.anio, valor: null, estado: 'parte_de', texto: `Todavía no era municipio: su territorio estaba en ${am.porClave.get(de).nombre}` };
        const m = am.porClave.get(clave);
        if (!m) return { anio: a.anio, valor: null, estado: 'sin_informe', texto: TEXTO.sinInforme };
        if (m.estado === 'sin_informe') return { anio: a.anio, valor: null, estado: 'sin_informe', texto: TEXTO.sinInforme };
        const v = am.valor(clave, campo, montos);
        if (v === null) {
            const est = am.estado(clave, campo);
            return { anio: a.anio, valor: null, estado: est.codigo === 'f' ? 'no_comparable' : 'no_disponible', texto: est.texto };
        }
        const abarca = m.abarca ? m.abarca.filter((c) => c !== clave) : [];
        return { anio: a.anio, valor: v, estado: 'valor', texto: formato(v, metrica.unidad), abarca, codigo: am.estado(clave, campo).codigo };
    });
}

// Los años del eje de la evolución: desde el primero con datos hasta el último (los de antes no tienen balances municipales).
export function aniosDelEje(cat) {
    return cat.anios.filter((a) => a.anio >= cat.conDatos[0]).map((a) => a.anio);
}

