// Redirección de las direcciones viejas del análisis (ADR 0009 del módulo): /analisis_resultados/ y
// /analisis_resultados/municipales-2026/ llevan a la sección nueva conservando el contexto del hash, traducido al
// formato nuevo (#eleccion=…&anio=…&cargo=intendencia|junta&capa=…). El enlace visible de la página es el respaldo.
const enlace = document.getElementById('destino');
// Pestañas de la página vieja (vista) → capas del tablero (ADR-017); «Tablas» abre además la tabla (bandeja, ADR-021).
const CAPAS = { mapa: 'lista', barrios: 'lista', listas: 'listas', participacion: 'participacion', ipm: 'ipm', margen: 'margen', tablas: 'lista' };

// Hash viejo (#cargo=1|2|c&vista=…&local=…) → hash nuevo; las claves que no cambian pasan tal cual. El voto cruzado
// (cargo=c) va a /analisis/ con #analisis=voto-cruzado.
function traducir(hash) {
    const viejo = new URLSearchParams(hash.replace(/^#/, ''));
    if (![...viejo.keys()].length) return '';
    const nuevo = new URLSearchParams({ eleccion: 'municipales', anio: '2026' });
    const cargo = viejo.get('cargo');
    nuevo.set('cargo', cargo === '2' || cargo === 'junta' ? 'junta' : 'intendencia');
    const vista = viejo.get('vista');
    if (cargo === 'c') {
        nuevo.set('analisis', 'voto-cruzado');
    } else if (Object.hasOwn(CAPAS, vista)) {
        nuevo.set('capa', CAPAS[vista]);
        if (vista === 'tablas') nuevo.set('bandeja', 'tabla');
    }
    for (const clave of ['local', 'barrio', 'zona', 'zona_municipal', 'grupo', 'metrica', 'grafico']) {
        if (viejo.has(clave)) nuevo.set(clave, viejo.get(clave));
    }
    return nuevo.toString();
}

if (enlace) {
    const destino = new URL(enlace.getAttribute('href'), location.href);
    destino.hash = traducir(location.hash);
    // El voto cruzado (cargo=c) va a la sección Análisis (ADR-019), hermana de /trep/.
    if (new URLSearchParams(destino.hash.slice(1)).get('analisis') === 'voto-cruzado') destino.pathname = destino.pathname.replace(/trep\/$/, 'analisis/');
    enlace.href = destino.href;
    location.replace(destino.href);
}
