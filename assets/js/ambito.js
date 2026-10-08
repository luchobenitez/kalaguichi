// Ámbito de las secciones de resultados (ADR-022): el país (el mapa por distrito) o un distrito. El hash lo dice con
// distrito=<dep>-<dis> (códigos del TSJE; 0-0 es Asunción) y, en el país, departamento=<código> lo acota a un
// departamento. Sin distrito, los enlaces de antes con claves del tablero de Asunción (capa, zona, local, la vista
// informe, el cargo Intendencia…) abren Asunción, como antes; el resto abre el país.
export const ASUNCION = '0-0';
// Cada distrito tiene su tablero (etapa M16); en false, la clave de un distrito distinto de Asunción abre el país con ese
// distrito elegido.
export const TABLERO_DE_DISTRITO = true;
const CLAVE = /^\d{1,2}-\d{1,3}$/;
// Claves que solo usan el tablero de un distrito y la vista informe.
const DEL_TABLERO = ['capa', 'zona', 'zona_municipal', 'barrio', 'local', 'mesa', 'lista', 'medida', 'ipm', 'opacidad', 'base', 'ver',
                     'tabla', 'modo', 'vista'];
// Claves de la vista del país: no se llevan a un distrito.
export const DEL_PAIS = ['departamento', 'elegido', 'mapa', 'partido', 'orden'];

// { distrito: '<dep>-<dis>' | null, departamento: número | null }. La clave del distrito se valida después contra la
// lista de distritos (lista.json): una que no existe abre el país.
export function ambitoDe(hash = location.hash) {
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    const distrito = p.get('distrito');
    if (distrito !== null && CLAVE.test(distrito)) return { distrito, departamento: Number(distrito.split('-')[0]) };
    if (DEL_TABLERO.some((k) => p.has(k)) || ['intendencia', '1'].includes(p.get('cargo'))) return { distrito: ASUNCION, departamento: 0 };
    const dep = p.get('departamento');
    return { distrito: null, departamento: /^\d{1,2}$/.test(dep ?? '') ? Number(dep) : null };
}

// Hash para abrir un ámbito desde otro: conserva la elección, el año (los del contexto, si se pasan; si no, los del hash)
// y el cargo (Junta si el destino no tiene el pedido); el resto de las claves son de la vista que se deja.
// conservar: claves de la vista que siguen (en Análisis, el análisis elegido).
export function hashDe({ distrito = null, departamento = null } = {}, { cargoDisponible = (c) => c === 'junta', eleccion = null, anio = null, conservar = [] } = {}) {
    const actual = new URLSearchParams(location.hash.slice(1));
    const p = new URLSearchParams();
    const contexto = { eleccion: eleccion ?? actual.get('eleccion'), anio: anio ?? actual.get('anio') };
    for (const k of ['eleccion', 'anio']) if (contexto[k]) p.set(k, String(contexto[k]));
    const cargo = actual.get('cargo') === 'intendencia' || actual.get('cargo') === '1' ? 'intendencia' : 'junta';
    p.set('cargo', cargoDisponible(cargo) ? cargo : 'junta');
    if (distrito) p.set('distrito', distrito);
    else if (departamento !== null && departamento !== undefined && departamento !== '') p.set('departamento', String(departamento));
    for (const k of conservar) if (actual.get(k)) p.set(k, actual.get(k));
    return `#${p}`;
}
