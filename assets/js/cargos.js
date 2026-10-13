// Cargos de un año del manifiesto (ADR-042). Cada cargo tiene la clave de sus datos ('1', '2'…: el número de candidatura
// del TSJE de ese año), la del hash (intendencia, junta, presidencia, senado…), su nombre, su etiqueta corta, cómo se
// nombra en una frase («de la Junta»), si es uninominal y dónde reparte bancas: en el distrito (la Junta Municipal, con
// D'Hondt en el tablero), en el departamento o en el país. Municipales 2026 declara intendencia ('1') y junta ('2').
const FRASES = { intendencia: 'de la Intendencia', junta: 'de la Junta', presidencia: 'de la Presidencia', vicepresidencia: 'de la Vicepresidencia',
                 senado: 'del Senado', parlasur: 'del Parlasur', diputados: 'de Diputados', gobernacion: 'de la Gobernación',
                 'junta-departamental': 'de la Junta departamental', consejo: 'del Consejo de la Magistratura' };
const UNINOMINALES = ['intendencia', 'presidencia', 'vicepresidencia', 'gobernacion'];

// { dato: { dato, clave, nombre, etiqueta, de, tipo, bancas } } en el orden del manifiesto.
export function cargosDe(anio) {
    const salida = {};
    for (const clave of anio?.cargos ?? []) {
        const dato = String(anio.claves_cargo?.[clave] ?? clave);
        const nombre = anio.nombres_cargo?.[clave] ?? clave;
        salida[dato] = { dato, clave, nombre, etiqueta: anio.etiquetas_cargo?.[clave] ?? nombre, de: FRASES[clave] ?? `de ${nombre}`,
                         tipo: anio.tipos_cargo?.[clave] ?? (UNINOMINALES.includes(clave) ? 'uninominal' : 'plurinominal'),
                         bancas: anio.bancas_cargo?.[clave] ?? (clave === 'junta' ? 'distrito' : null) };
    }
    return salida;
}

// La clave de los datos de un cargo pedido por su clave del hash o por la de sus datos (los enlaces de antes traen 1 o 2);
// null si el año no lo tiene.
export function datoDe(anio, pedido) {
    if (pedido === null || pedido === undefined) return null;
    const cargos = cargosDe(anio);
    if (cargos[String(pedido)]) return String(pedido);
    return Object.values(cargos).find((c) => c.clave === pedido)?.dato ?? null;
}

// La clave del hash de un cargo (por la de sus datos o la del hash).
export const claveDe = (anio, pedido) => cargosDe(anio)[datoDe(anio, pedido)]?.clave ?? null;

// El cargo que reparte bancas en el distrito (la Junta Municipal), si el año lo tiene.
export const cargoConBancas = (anio) => Object.values(cargosDe(anio)).find((c) => c.bancas === 'distrito')?.dato ?? null;
