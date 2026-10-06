/** Reglas puras compartidas por la interfaz y las pruebas; no acceden a red ni DOM. */
export function normalizeCedula(value) {
    const text = String(value ?? '').trim();
    if (!/^\d{1,10}$/.test(text)) throw new Error('Ingresá una cédula de 1 a 10 dígitos, sin puntos.');
    const normalized = text.replace(/^0+(?=\d)/, '');
    if (normalized === '0') throw new Error('La cédula no puede ser cero.');
    return normalized;
}

export function validISODate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** Desconocido no equivale a false. Se aceptan booleanos y sus textos exactos. */
export function triState(value) {
    if (value === true || value === false) return value;
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        if (!text) return null;
        if (text === 'true') return true;
        if (text === 'false') return false;
    }
    throw new Error('Estado booleano inválido en los datos.');
}

export function stateDescription(field, value) {
    const state = triState(value);
    if (field === 'voto') return state === true
        ? { text: 'Sí votó · según el registro', tone: 'yes' }
        : state === false
            ? { text: 'No votó · según el registro', tone: 'no' }
            : { text: 'Voto: sin información', tone: 'unknown' };
    if (field === 'fallecido') return state === true
        ? { text: 'Figura como fallecido/a', tone: 'recorded' }
        : state === false
            ? { text: 'No figura como fallecido/a', tone: 'not-recorded' }
            : { text: 'Fallecimiento: sin información', tone: 'unknown' };
    throw new Error('Campo de estado no admitido.');
}

export function lookupMessage(manifest, cedula, nacimiento) {
    return JSON.stringify(['kalaguichi.com', 'lookup-v1', manifest.dataset_id,
        manifest.eleccion_id, normalizeCedula(cedula), nacimiento]);
}

export function associatedData(manifest, lookupId) {
    // v3 (ADR-011): la ficha posicional queda atada al orden de sus campos y al hash del catálogo.
    if (manifest.schema_version === 3) return JSON.stringify(['kalaguichi.com', 'ficha-v3', manifest.dataset_id,
        manifest.eleccion_id, manifest.key_id, manifest.ficha.join(','), manifest.catalogo.sha256, lookupId]);
    return JSON.stringify(['kalaguichi.com', 'ficha-v1', manifest.dataset_id,
        manifest.eleccion_id, manifest.key_id, lookupId]);
}
