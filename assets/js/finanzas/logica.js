// Finanzas municipales · Ejercicio 2025 (ADR-029; ADR 0027 del módulo): la lógica de la página, sin el DOM. El estado del
// enlace (con avisos para los parámetros desconocidos o incompatibles), el conjunto de municipios del filtro, el estado de
// cada municipio en el mapa (el color de su clase fija, el gris de «sin informe», el gris tramado de «no disponible»,
// el punteado de una correspondencia pendiente, solo el borde fuera del filtro), la leyenda, los textos, las filas de la
// tabla y el CSV. Los valores no se recalculan: se leen tal como se prepararon. Se prueba con Node (tests/).

export const CARGOS = ['intendencia', 'junta'];
export const ROTULO_CARGO = { intendencia: 'Intendencia', junta: 'Junta Municipal' };
export const VISTAS = ['presupuesto', 'balance'];
export const ROTULO_VISTA = { presupuesto: 'Presupuesto', balance: 'Balance' };
export const TOMO_VISTA = { presupuesto: 'V-B', balance: 'V-A' };
export const POR_PAGINA = 25;
export const TEXTO = {
    sinInforme: 'Sin informe presupuestario/financiero incorporado al corte MEF 2025',
    noDisponible: 'Indicador no disponible',
    pendiente: 'Correspondencia territorial pendiente',
    fuera: 'Fuera del filtro',
    nd: 'N/D',
    calculado: 'Indicador calculado sobre datos publicados',
};
// Las columnas a la vista al abrir cada tabla; el selector agrega o quita las demás. En Presupuesto, primero las cuatro del
// «Presupuesto anual» (ADR 0028: Total e Inversiones Físicas, que ya son columnas de la hoja; Salarios, con el objeto 111
// al lado, y el % de transferencias intergubernamentales).
export const RESUMEN = {
    presupuesto: ['presupuesto_vigente_gastos_gs', 'inversion_fisica_presupuesto_gs', 'presupuesto_servicios_personales_gs', 'presupuesto_sueldos_111_gs',
                  'transferencias_intergubernamentales_sobre_presupuesto_pct', 'presupuesto_vigente_ingresos_gs', 'ingresos_recaudados_gs',
                  'gasto_obligado_gs', 'gasto_pagado_gs', 'obligaciones_pendientes_pago_gs', 'personal_gs', 'inversion_fisica_gs'],
    balance: ['activo_total_gs', 'activo_corriente_gs', 'disponible_gs', 'pasivo_total_gs', 'pasivo_corriente_gs', 'patrimonio_neto_cuenta8_gs',
              'ingresos_gestion_gs', 'egresos_gestion_gs'],
};
const PARAMETROS = ['cargo', 'departamento', 'municipio', 'listas', 'indicador', 'vista', 'columnas'];

// --- Colores ------------------------------------------------------------------------------------------------------------
// ADR-033: de verde (lo más bajo) a amarillo y a rojo (lo más alto), como un mapa de calor; los negativos, en el verde más
// oscuro. Es una escala de magnitud: no califica un valor como bueno o malo, y los colores son financieros, nunca
// partidarios. El gris es la falta de datos: liso, «sin informe»; tramado, el dato no disponible (el mismo gris de los
// análisis del país). COLOR_CERO queda para un valor sin clase.
export const CALOR = ['#1a9850', '#91cf60', '#d9ef8b', '#fee08b', '#fc8d59', '#d73027'];
export const NEGATIVO = '#00592f';
export const COLOR_CERO = '#ece7dc';
const GRIS = { claro: '#9ca3af', oscuro: '#4b5563' };
export const gris = (oscuro) => GRIS[oscuro ? 'oscuro' : 'claro'];

// Las clases fijas de cada unidad (ADR-033): cada clase incluye su límite inferior y llega hasta el siguiente. Si el
// indicador tiene negativos en el país, van en «Negativo» y la primera clase empieza en 0.
const MM = 1e6;
export const CLASES_FIJAS = {
    PYG: { cortes: [15000, 30000, 60000, 120000, 300000].map((x) => x * MM), desdeCero: 'Entre 0 y 15.000MM', texto: 'en millones de guaraníes (MM)',
           rotulos: ['Menos de 15.000MM', 'Entre 15.000MM y 30.000MM', 'Entre 30.000MM y 60.000MM', 'Entre 60.000MM y 120.000MM',
                     'Entre 120.000MM y 300.000MM', 'Más de 300.000MM'] },
    '%': { cortes: [10, 25, 50, 75, 90], desdeCero: 'Entre 0 y 10 %', texto: 'en porcentaje',
           rotulos: ['Menos del 10 %', 'Entre 10 y 25 %', 'Entre 25 y 50 %', 'Entre 50 y 75 %', 'Entre 75 y 90 %', 'Más del 90 %'] },
    veces: { cortes: [0.5, 1, 2, 5, 10], desdeCero: 'Entre 0 y 0,5', texto: 'en veces',
             rotulos: ['Menos de 0,5', 'Entre 0,5 y 1', 'Entre 1 y 2', 'Entre 2 y 5', 'Entre 5 y 10', 'Más de 10'] },
};

// La escala fija de una unidad para los valores del país; null si la unidad no tiene clases fijas.
export function escalaFija(unidad, valores) {
    const fija = CLASES_FIJAS[unidad];
    if (!fija) return null;
    const conDato = valores.filter((v) => v !== null && v !== undefined);
    if (!conDato.length) return { tipo: 'sin_valores', clases: [] };
    const negativos = conDato.some((v) => v < 0);
    const bordes = [negativos ? 0 : -Infinity, ...fija.cortes, Infinity];
    const clases = fija.rotulos.map((rotulo, k) => ({ desde: bordes[k], hasta: bordes[k + 1], tramo: 'fija',
                                                       rotulo: k === 0 && negativos ? fija.desdeCero : rotulo }));
    if (negativos) clases.unshift({ desde: -Infinity, hasta: 0, tramo: 'negativo', rotulo: 'Negativo' });
    return { tipo: 'fija', unidad, clases };
}

// n posiciones repartidas en una paleta de largo dado (una sola: la del medio).
function repartir(n, largo) {
    if (n <= 0) return [];
    if (n === 1) return [Math.floor((largo - 1) / 2)];
    return Array.from({ length: n }, (_, i) => Math.round((i * (largo - 1)) / (n - 1)));
}

// El color de cada clase de una escala, en el orden de sus clases: en la fija, el de su lugar en CALOR («Negativo», el
// verde más oscuro); en una del paquete (cuantiles, para una unidad sin clases fijas), repartidos del verde al rojo.
export function coloresDeEscala(escala) {
    if (escala.tipo === 'fija') {
        const corrida = escala.clases[0]?.tramo === 'negativo' ? 1 : 0;
        return escala.clases.map((c, k) => (c.tramo === 'negativo' ? NEGATIVO : CALOR[k - corrida]));
    }
    if (escala.tipo !== 'secuencial' && escala.tipo !== 'divergente') return [];
    return repartir(escala.clases.length, CALOR.length).map((i) => CALOR[i]);
}

// La clase de un valor: la primera de su tramo cuyo «hasta» lo alcanza (las clases van en orden creciente; en la
// divergente un valor nunca cruza el cero). Fuera de los extremos, la del extremo. null si la escala no tiene su tramo.
export function claseDe(escala, v) {
    if (v === null || v === undefined || !escala?.clases?.length) return null;
    if (escala.tipo === 'fija') {
        const k = escala.clases.findIndex((c) => v >= c.desde && v < c.hasta);
        return k < 0 ? null : k;
    }
    const indices = escala.clases.map((c, k) => k).filter((k) => escala.tipo !== 'divergente'
        || escala.clases[k].tramo === (v < 0 ? 'negativo' : v > 0 ? 'positivo' : 'cero'));
    if (!indices.length) return null;
    return indices.find((k) => v <= escala.clases[k].hasta) ?? indices[indices.length - 1];
}

// --- Formatos (solo para mostrar; el CSV lleva el valor exacto) --------------------------------------------------------
const ENTERO = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 });
const DECIMALES = new Map();
const conDecimales = (d) => {
    if (!DECIMALES.has(d)) DECIMALES.set(d, new Intl.NumberFormat('es-PY', { minimumFractionDigits: d, maximumFractionDigits: d }));
    return DECIMALES.get(d);
};
export const UNIDAD_CORTA = { PYG: 'Gs.', '%': '%', veces: 'veces', personas: 'personas' };

// Un valor con su unidad: guaraníes enteros con separador de miles, porcentajes y razones con dos decimales; null: «N/D».
export function formato(v, unidad) {
    if (v === null || v === undefined) return TEXTO.nd;
    if (unidad === 'PYG') return `Gs. ${ENTERO.format(v)}`;
    if (unidad === '%') return `${conDecimales(2).format(v)} %`;
    if (unidad === 'veces') return `${conDecimales(2).format(v)} veces`;
    return ENTERO.format(v);
}

// El número de una celda de la tabla (la unidad va en el encabezado).
export function numeroCelda(v, unidad) {
    if (v === null || v === undefined) return TEXTO.nd;
    return unidad === '%' || unidad === 'veces' ? conDecimales(2).format(v) : ENTERO.format(v);
}

// Corto, para la leyenda: guaraníes en millones (M) desde un millón; extra agrega decimales.
export function formatoCorto(v, unidad, extra = 0) {
    if (unidad === 'PYG') {
        if (Math.abs(v) >= 1e6) return `${conDecimales((Math.abs(v) >= 1e8 ? 0 : 1) + extra).format(v / 1e6)} M`;
        return ENTERO.format(v);
    }
    if (unidad === '%') return `${conDecimales(1 + extra).format(v)} %`;
    if (unidad === 'veces') return conDecimales(2 + extra).format(v);
    return ENTERO.format(v);
}

// Los rótulos de los intervalos, con los decimales necesarios para que dos límites seguidos no se lean iguales.
export function rotulosEscala(escala, unidad) {
    if (escala.tipo === 'fija') return escala.clases.map((c) => c.rotulo);
    const clases = escala.clases;
    for (let extra = 0; ; extra += 1) {
        const f = (v) => formatoCorto(v, unidad, extra);
        const distintos = clases.every((c, k) => k === 0 || f(clases[k - 1].hasta) !== f(c.desde));
        if (distintos || extra >= 4) return clases.map((c) => (c.desde === c.hasta ? f(c.desde) : `${f(c.desde)} a ${f(c.hasta)}`));
    }
}

const y = (partes) => (partes.length < 2 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`);
export const sinTildes = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// --- Modelo -------------------------------------------------------------------------------------------------------------
// datos: los archivos de sitio/datos/finanzas/municipalidad/2025/ (manifiesto, catálogo, municipios, indicadores,
// electoral y presupuesto; balance y calidad se agregan al leerlos).
export function crearModelo(datos) {
    const { catalogo, municipios, indicadores, electoral } = datos;
    const lista = municipios.municipios;
    const porClave = new Map(lista.map((m) => [m.clave, m]));
    const departamentos = [...new Map(lista.map((m) => [m.departamento, { codigo: m.departamento, nombre: m.departamento_nombre }])).values()]
        .sort((a, b) => a.codigo - b.codigo);
    const posicion = new Map(indicadores.campos.map((c, k) => [c, k]));
    // La ampliación (presupuesto_anual.json, ADR 0028) va primero: sus cuatro opciones, en el grupo «Presupuesto anual».
    const ampliacion = datos.presupuesto_anual ?? null;
    const posAmp = new Map((ampliacion?.campos ?? []).map((c, k) => [c, k]));
    const metricas = [...(ampliacion?.metricas ?? []).map((x) => ({ ...x, ampliacion: true })),
                      ...catalogo.indicadores.map((x) => ({ ...x, grupo: 'Indicadores calculados', rotulo: TEXTO.calculado }))];
    const modelo = {
        datos, catalogo, electoral, municipios: lista, porClave, departamentos, metricas, ampliacion,
        porCampo: new Map(metricas.map((x) => [x.campo, x])),
        inicial: catalogo.indicador_inicial,
        hojas: {},
        // El valor de una métrica en un municipio (null: no disponible o sin informe).
        valor(clave, campo) {
            if (posAmp.has(campo)) return ampliacion.valores[clave]?.[posAmp.get(campo)] ?? null;
            const fila = indicadores.valores[clave];
            const k = posicion.get(campo);
            return fila && k !== undefined ? fila[k] : null;
        },
        motivo(clave, campo) {
            if (posAmp.has(campo)) return ampliacion.motivos?.[clave]?.[campo] ?? null;
            const k = indicadores.motivos?.[clave]?.[campo];
            return k === undefined ? null : indicadores.textos_motivo[k];
        },
    };
    // La escala de cada métrica (ADR-033): las clases fijas de su unidad con los valores del país (los negativos deciden
    // la clase «Negativo»); una unidad sin clases fijas conserva la del paquete (cuantiles).
    for (const x of metricas) x.escala = escalaFija(x.unidad, lista.map((m) => modelo.valor(m.clave, x.campo))) ?? x.escala;
    for (const vista of VISTAS) if (datos[vista]) agregarHoja(modelo, vista, datos[vista]);
    return modelo;
}

// Una hoja (Presupuesto o Balance): sus columnas del catálogo y, por municipio, los valores, los estados y las páginas. En
// Presupuesto, con la ampliación (ADR 0028), las columnas del «Presupuesto anual» van primero: Total e Inversiones Físicas
// (de la hoja, con el nombre de su opción al lado) y las nuevas, marcadas como ampliación; después, el resto de la hoja.
export function agregarHoja(modelo, vista, hoja) {
    const amp = vista === 'presupuesto' ? modelo.ampliacion : null;
    const opciones = new Map((amp?.metricas ?? []).map((m) => [m.campo, m]));
    const delCatalogo = modelo.catalogo[vista].map((c) => (opciones.has(c.campo) ? { ...c, opcion: opciones.get(c.campo).nombre } : c));
    const nuevas = (amp?.columnas ?? []).map((c) => ({ ...c, opcion: opciones.get(c.campo)?.nombre ?? null }));
    const primeras = delCatalogo.filter((c) => c.opcion);
    const columnas = amp ? [...primeras, ...nuevas, ...delCatalogo.filter((c) => !c.opcion)] : delCatalogo;
    const posicion = new Map(hoja.campos.map((c, k) => [c, k]));
    const deLaAmpliacion = new Set(nuevas.map((c) => c.campo));
    const base36 = '0123456789abcdefghijklmnopqrstuvwxyz';
    modelo.hojas[vista] = {
        columnas,
        // El orden de la hoja original (para el CSV): sus columnas y, al final, las de la ampliación.
        columnasHoja: [...delCatalogo, ...nuevas],
        valor: (clave, campo) => (deLaAmpliacion.has(campo) ? modelo.valor(clave, campo) : hoja.valores[clave]?.[posicion.get(campo)] ?? null),
        estado: (clave, campo) => {
            if (deLaAmpliacion.has(campo)) {
                const motivo = modelo.motivo(clave, campo);
                return { id: motivo ? 'no_disponible' : 'ampliacion', texto: motivo ?? 'ampliación: seleccionado o calculado del detalle del tomo V-B' };
            }
            const codigo = hoja.estados?.[clave]?.[posicion.get(campo)];
            return codigo ? modelo.catalogo.estados[codigo] : null;
        },
        pagina: (clave, campo) => {
            if (deLaAmpliacion.has(campo)) return null;
            const [inicio, desplazamientos] = hoja.paginas?.[clave] ?? [null, ''];
            const c = desplazamientos[posicion.get(campo)];
            return c && c !== '.' && inicio !== null ? inicio + base36.indexOf(c) : null;
        },
    };
}

// --- Contexto electoral ------------------------------------------------------------------------------------------------
const registroListas = (modelo, cargo) => modelo.electoral.listas[cargo] ?? {};
const electoralDe = (modelo, clave, cargo) => modelo.electoral.distritos[clave]?.[cargo] ?? null;

export function rotuloLista(modelo, l) {
    const numero = l.numeros?.length ? `Lista ${l.numeros.join(' / ')}` : null;
    const nombre = l.denominaciones?.length ? l.denominaciones.join(' / ') : null;
    const lugar = l.ambito && l.ambito !== 'nacional' ? modelo.porClave.get(l.ambito) : null;
    return [l.sigla, numero, nombre].filter(Boolean).join(' · ') + (lugar ? ` — ${lugar.nombre} (${lugar.departamento_nombre})` : '');
}

// Las listas del filtro para un cargo: las ganadoras (la más votada o la de más bancas) de al menos un municipio, con
// los municipios únicos del país y del departamento elegido (los empates aparte, no como victorias exclusivas).
export function opcionesListas(modelo, cargo, departamento = null) {
    const registro = registroListas(modelo, cargo);
    const cuentas = new Map();
    for (const m of modelo.municipios) {
        const x = electoralDe(modelo, m.clave, cargo);
        for (const g of x?.ganadoras ?? []) {
            const c = cuentas.get(g.id) ?? { pais: 0, paisEmpates: 0, departamento: 0, departamentoEmpates: 0 };
            c.pais += 1;
            if (x.empate) c.paisEmpates += 1;
            if (departamento !== null && m.departamento === departamento) {
                c.departamento += 1;
                if (x.empate) c.departamentoEmpates += 1;
            }
            cuentas.set(g.id, c);
        }
    }
    return [...cuentas].map(([id, c]) => {
        const l = registro[id] ?? { id, sigla: id };
        return { ...l, id, ...c, rotulo: rotuloLista(modelo, l) };
    }).sort((a, b) => (departamento !== null ? b.departamento - a.departamento : 0) || b.pais - a.pais || a.sigla.localeCompare(b.sigla, 'es'));
}

// El contexto electoral de un municipio en un cargo, en una línea: la lista más votada según el TREP (Intendencia) o la
// de más bancas (Junta), los empates como empates y el resultado parcial si faltan actas.
export function textoElectoral(modelo, clave, cargo) {
    const x = electoralDe(modelo, clave, cargo);
    const rotulo = ROTULO_CARGO[cargo];
    if (!x || x.estado !== 'con_resultado' || !x.ganadoras.length) return `${rotulo}: sin datos electorales`;
    const registro = registroListas(modelo, cargo);
    const nombre = (g) => `${registro[g.id]?.sigla ?? g.id}${g.numero ? ` (Lista ${g.numero})` : ''}`;
    let texto;
    if (cargo === 'junta') {
        texto = x.empate ? `empate en bancas entre ${y(x.ganadoras.map(nombre))}, con ${x.ganadoras[0].bancas} de ${x.bancas_total} cada una`
            : `${nombre(x.ganadoras[0])}, lista con más bancas: ${x.ganadoras[0].bancas} de ${x.bancas_total}`;
    } else {
        texto = x.empate ? `empate en el primer lugar entre ${y(x.ganadoras.map(nombre))}` : `${nombre(x.ganadoras[0])}, la más votada según el TREP`;
    }
    const parcial = x.parcial ? ` (resultado parcial: ${ENTERO.format(x.mesas.con_acta)} de ${ENTERO.format(x.mesas.esperadas)} mesas con acta)` : '';
    return `${rotulo}: ${texto}${parcial}`;
}

// --- Estado del enlace -------------------------------------------------------------------------------------------------
export function estadoInicial(modelo) {
    return { cargo: 'intendencia', departamento: null, municipio: null, listas: [], indicador: modelo.inicial, vista: 'presupuesto', columnas: 'resumen' };
}

const nombreDepartamento = (modelo, codigo) => modelo.departamentos.find((d) => d.codigo === codigo)?.nombre ?? String(codigo);

// Lee el hash; lo desconocido o incompatible se resuelve con valores válidos y un aviso (nunca una página vacía).
export function leerEstado(texto, modelo) {
    const p = new URLSearchParams(texto);
    const e = estadoInicial(modelo);
    const avisos = [];
    const cargo = p.get('cargo');
    if (cargo !== null) {
        if (CARGOS.includes(cargo)) e.cargo = cargo;
        else avisos.push(`El cargo «${cargo}» no existe en esta página: se muestra Intendencia.`);
    }
    const dep = p.get('departamento');
    if (dep !== null) {
        const codigo = /^\d+$/.test(dep) ? Number(dep) : NaN;
        if (modelo.departamentos.some((d) => d.codigo === codigo)) e.departamento = codigo;
        else avisos.push(`El departamento «${dep}» no existe: se muestran todos.`);
    }
    const indicador = p.get('indicador');
    if (indicador !== null) {
        if (modelo.porCampo.has(indicador)) e.indicador = indicador;
        else avisos.push(`El indicador «${indicador}» no existe: se muestra «${modelo.porCampo.get(modelo.inicial).nombre}».`);
    }
    const vista = p.get('vista');
    if (vista !== null) {
        if (VISTAS.includes(vista)) e.vista = vista;
        else avisos.push(`La vista «${vista}» no existe: se muestra Presupuesto.`);
    }
    const columnas = p.get('columnas');
    if (columnas !== null) {
        if (columnas === 'todas') e.columnas = 'todas';
        else avisos.push(`«columnas=${columnas}» no es un valor válido: se muestran las columnas iniciales.`);
    }
    const listas = p.get('listas');
    if (listas !== null) {
        const pedidas = [...new Set(listas.split(',').filter(Boolean))];
        const validas = new Set(opcionesListas(modelo, e.cargo).map((o) => o.id));
        e.listas = pedidas.filter((id) => validas.has(id));
        const quitadas = pedidas.filter((id) => !validas.has(id));
        if (quitadas.length) avisos.push(`Se ${quitadas.length === 1 ? 'quitó una lista que no figura' : `quitaron ${quitadas.length} listas que no figuran`} entre las ganadoras de ${ROTULO_CARGO[e.cargo]}: ${quitadas.join(', ')}.`);
    }
    const municipio = p.get('municipio');
    if (municipio !== null) {
        const m = modelo.porClave.get(municipio);
        if (!m) avisos.push(`El municipio «${municipio}» no existe: se muestran todos.`);
        else if (e.departamento !== null && m.departamento !== e.departamento) {
            avisos.push(`${m.nombre} no pertenece a ${nombreDepartamento(modelo, e.departamento)}: se quitó la selección del municipio.`);
        } else if (!conjunto(modelo, e).claves.has(municipio)) {
            avisos.push(`${m.nombre} no está entre los municipios de las listas elegidas: se quitó la selección del municipio.`);
        } else e.municipio = municipio;
    }
    const otros = [...new Set([...p.keys()].filter((k) => !PARAMETROS.includes(k)))];
    if (otros.length) avisos.push(`Se ignoraron parámetros que esta página no usa: ${otros.join(', ')}.`);
    return { estado: e, avisos };
}

// El hash del estado: solo lo que difiere del estado inicial.
export function textoEstado(e, modelo) {
    const p = new URLSearchParams();
    if (e.cargo !== 'intendencia') p.set('cargo', e.cargo);
    if (e.departamento !== null) p.set('departamento', String(e.departamento));
    if (e.municipio !== null) p.set('municipio', e.municipio);
    if (e.listas.length) p.set('listas', e.listas.join(','));
    if (e.indicador !== modelo.inicial) p.set('indicador', e.indicador);
    if (e.vista !== 'presupuesto') p.set('vista', e.vista);
    if (e.columnas === 'todas') p.set('columnas', 'todas');
    return p.toString();
}

// Al cambiar de cargo se conservan solo las listas que también son ganadoras en el nuevo; devuelve las quitadas.
export function cambiarCargo(modelo, e, cargo) {
    const validas = new Set(opcionesListas(modelo, cargo).map((o) => o.id));
    const quitadas = e.listas.filter((id) => !validas.has(id));
    const nuevo = { ...e, cargo, listas: e.listas.filter((id) => validas.has(id)) };
    if (nuevo.municipio !== null && !conjunto(modelo, nuevo).claves.has(nuevo.municipio)) nuevo.municipio = null;
    return { estado: nuevo, quitadas, municipioQuitado: e.municipio !== null && nuevo.municipio === null };
}

// --- Conjunto del filtro -----------------------------------------------------------------------------------------------
export const hayFiltro = (e) => e.departamento !== null || e.listas.length > 0;

// Los municipios del filtro: departamento ∩ listas (varias listas se unen). Sin filtro de listas entran también los que no
// tienen datos electorales. Los recuentos son de municipios únicos (un empate entre dos listas elegidas cuenta una vez).
export function conjunto(modelo, e) {
    const elegidas = new Set(e.listas);
    const municipios = [];
    let empates = 0;
    for (const m of modelo.municipios) {
        if (e.departamento !== null && m.departamento !== e.departamento) continue;
        if (elegidas.size) {
            const x = electoralDe(modelo, m.clave, e.cargo);
            if (!(x?.ganadoras ?? []).some((g) => elegidas.has(g.id))) continue;
            if (x.empate) empates += 1;
        }
        municipios.push(m);
    }
    const sinInforme = municipios.filter((m) => m.estado === 'sin_informe').length;
    return { claves: new Set(municipios.map((m) => m.clave)), municipios, empates, exclusivas: elegidas.size ? municipios.length - empates : null,
             informantes: municipios.length - sinInforme, sinInforme };
}

// --- Mapa ---------------------------------------------------------------------------------------------------------------
// El estado de cada municipio: el gris de «sin informe» y el punteado de una correspondencia pendiente no dependen del
// filtro (son señales documentales); dentro del filtro, el color de su clase o el gris tramado si el indicador no está
// disponible; fuera, solo el borde. Con un filtro activo, los del filtro llevan además un contorno (marcado).
export function pintura(modelo, e, claves, oscuro) {
    const metrica = modelo.porCampo.get(e.indicador);
    const colores = coloresDeEscala(metrica.escala);
    const filtro = hayFiltro(e);
    return (clave) => {
        const m = modelo.porClave.get(clave);
        const dentro = claves.has(clave);
        const marcado = filtro && dentro;
        if (!m) return { color: null, categoria: 'fuera' };
        if (m.estado === 'sin_informe') return { color: gris(oscuro), marcado, categoria: 'sin_informe' };
        if (m.union?.estado !== 'unida') return { color: null, pendiente: true, marcado, categoria: 'pendiente' };
        if (!dentro) return { color: null, categoria: 'fuera' };
        const v = modelo.valor(clave, metrica.campo);
        if (v === null) return { color: gris(oscuro), tramado: true, marcado, categoria: 'no_disponible' };
        const k = claseDe(metrica.escala, v);
        return { color: k === null ? COLOR_CERO : colores[k], marcado, categoria: 'valor', clase: k };
    };
}

// La leyenda: el título (indicador, unidad y alcance de la escala), una entrada por clase con los municipios del filtro
// que caen en ella y, fuera de la escala, las categorías de ausencia y de filtro.
export function leyenda(modelo, e, info, oscuro) {
    const metrica = modelo.porCampo.get(e.indicador);
    const escala = metrica.escala;
    const pintar = pintura(modelo, e, info.claves, oscuro);
    const categorias = modelo.municipios.map((m) => pintar(m.clave));
    const enClase = (k) => categorias.filter((c) => c.categoria === 'valor' && c.clase === k).length;
    const cuenta = (categoria) => categorias.filter((c) => c.categoria === categoria).length;
    const colores = coloresDeEscala(escala);
    const rotulos = escala.clases.length ? rotulosEscala(escala, metrica.unidad) : [];
    const fija = escala.tipo === 'fija';
    const millones = metrica.unidad === 'PYG' && (fija || escala.clases.some((c) => Math.abs(c.desde) >= 1e6 || Math.abs(c.hasta) >= 1e6));
    const tipo = escala.tipo === 'divergente' ? 'divergente alrededor de cero' : escala.tipo === 'secuencial' ? 'secuencial' : 'sin valores';
    const items = escala.clases.map((c, k) => ({ tipo: 'clase', color: colores[k], texto: rotulos[k], n: enClase(k), tramo: c.tramo }));
    const sinInforme = cuenta('sin_informe');
    if (sinInforme) items.push({ tipo: 'sin_informe', color: gris(oscuro), texto: TEXTO.sinInforme, n: sinInforme });
    const noDisponible = cuenta('no_disponible');
    if (noDisponible) items.push({ tipo: 'no_disponible', texto: TEXTO.noDisponible, n: noDisponible });
    const pendiente = cuenta('pendiente');
    if (pendiente) items.push({ tipo: 'pendiente', texto: TEXTO.pendiente, n: pendiente });
    if (hayFiltro(e)) {
        items.push({ tipo: 'marcado', texto: 'Con contorno: en el filtro', n: info.municipios.length });
        const fuera = cuenta('fuera');
        if (fuera) items.push({ tipo: 'fuera', texto: `${TEXTO.fuera}: solo el borde`, n: fuera });
    }
    return {
        titulo: `${metrica.nombre} (${UNIDAD_CORTA[metrica.unidad] ?? metrica.unidad}${millones ? `; ${fija ? 'MM' : 'M'} = millones` : ''})`,
        nota: !escala.clases.length ? 'Ningún municipio tiene este indicador.'
            : fija ? `Escala nacional fija, con clases fijas ${CLASES_FIJAS[metrica.unidad].texto}: de verde (lo más bajo) a amarillo y a rojo ` +
                     '(lo más alto); gris, sin datos. No cambia al filtrar.'
                : `Escala nacional fija (${tipo}, por cuantiles de los ${metrica.cobertura} municipios con dato): no cambia al filtrar.`,
        items,
    };
}

// --- Textos de un municipio -----------------------------------------------------------------------------------------------
// El estado financiero de un municipio para la métrica activa: su valor, «no disponible» con su motivo, «sin informe» o
// la correspondencia pendiente. En partes [antes, falta, después]: la falta («sin informe» o el dato no disponible) va en
// rojo y negrita en la página (ADR-033); null si no falta nada.
export function partesFinancieras(modelo, clave, campo) {
    const m = modelo.porClave.get(clave);
    const metrica = modelo.porCampo.get(campo);
    if (m.estado === 'sin_informe') return ['', TEXTO.sinInforme, ''];
    if (m.union?.estado !== 'unida') return [TEXTO.pendiente, null, ''];
    const v = modelo.valor(clave, campo);
    if (v === null) {
        const motivo = modelo.motivo(clave, campo);
        return [`${metrica.nombre}: `, metrica.ampliacion ? 'dato no disponible' : TEXTO.noDisponible, motivo ? `. ${motivo}` : ''];
    }
    return [`${metrica.nombre}: ${formato(v, metrica.unidad)}`, null, ''];
}

export function textoFinanciero(modelo, clave, campo) {
    return partesFinancieras(modelo, clave, campo).filter(Boolean).join('');
}

// Las páginas del informe de un municipio (presupuesto en el tomo V-B; estados financieros en el V-A).
export function textoPaginas(m) {
    if (m.estado !== 'informante') return m.sin_informe?.fuente ? `Nota del MEF: ${m.sin_informe.fuente}` : null;
    const partes = [];
    if (m.fuente?.paginas_presupuesto) partes.push(`presupuesto: tomo V-B, págs. ${m.fuente.paginas_presupuesto}`);
    if (m.fuente?.paginas_financieras) partes.push(`balance: tomo V-A, págs. ${m.fuente.paginas_financieras}`);
    return partes.length ? `Informe Financiero 2025: ${partes.join('; ')}` : null;
}

// El globo del mapa (y el dato al tocar): municipio y departamento, indicador y valor o su estado, contexto electoral y
// páginas; una línea por tema.
// En líneas de partes (la financiera, con su falta en el medio: ver partesFinancieras), para la página.
export function lineasMunicipio(modelo, e, info, clave) {
    const m = modelo.porClave.get(clave);
    if (!m) return null;
    const lineas = [[`${m.nombre} · ${m.departamento_nombre}${info.claves.has(clave) ? '' : ` (${TEXTO.fuera.toLowerCase()})`}`],
                    partesFinancieras(modelo, clave, e.indicador), [textoElectoral(modelo, clave, e.cargo)]];
    const paginas = textoPaginas(m);
    if (paginas) lineas.push([paginas]);
    return lineas;
}

export function textoMunicipio(modelo, e, info, clave) {
    const lineas = lineasMunicipio(modelo, e, info, clave);
    return lineas ? lineas.map((partes) => partes.filter(Boolean).join('')).join('\n') : null;
}

// --- Tabla ----------------------------------------------------------------------------------------------------------------
// Las filas de la tabla: el municipio elegido o los del filtro, con la búsqueda (sin tildes, por municipio o
// departamento) y el orden pedido (los N/D al final en los dos sentidos).
export function filasTabla(modelo, e, info, { busqueda = '', orden = null, valor = null } = {}) {
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

// Una celda de CSV: los números exactos (enteros tal cual; decimales con toda su precisión y punto); vacío = no
// disponible, como en los CSV del MEF; un texto que empieza como fórmula se neutraliza.
export function celdaCsv(v) {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v) : /^[=+\-@\t\r]/.test(String(v)) ? `'${v}` : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// El CSV: columnas [{ titulo, v(fila) }], en UTF-8 con BOM y fin de línea CRLF (lo abre bien una planilla).
export function textoCsv(columnas, filas) {
    const lineas = [columnas.map((c) => celdaCsv(c.titulo)).join(','), ...filas.map((f) => columnas.map((c) => celdaCsv(c.v(f))).join(','))];
    return `﻿${lineas.join('\r\n')}\r\n`;
}

// Las métricas cuyo rótulo (con su unidad) o subtítulo contiene el texto buscado, sin tildes ni mayúsculas, en el orden del
// selector: el «Presupuesto anual» primero.
export function buscarMetricas(modelo, texto) {
    const q = sinTildes(texto.trim());
    if (!q) return [];
    return modelo.metricas.filter((m) => sinTildes(`${m.nombre} (${UNIDAD_CORTA[m.unidad] ?? m.unidad}) ${m.subtitulo ?? ''}`).includes(q));
}
