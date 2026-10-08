// Mapa base del país (ADR-026; ADR 0024 del módulo): las rutas, los ríos, los arroyos, los espejos de agua y los nombres de
// lugares de datos/mapa_base/pais.pmtiles (OpenStreetMap, por partes con HTTP Range), con colores parecidos a los de
// OpenStreetMap en cada tema. Lo usan el mapa del país (mapa_pais.js), el tablero de un distrito fuera de Asunción
// (mapa_gl.js) y los mapas del país de Análisis. Las capas van sobre el relleno de los distritos, como referencia.

export const FUENTE_BASE = 'k-base';
const COLORES = {
    claro: { agua: '#aad3df', rio: '#5b9bd5', arroyo: '#8fbfe0', casco: '#8f8f8f', autopista: '#e892a2', troncal: '#f9b29c', primaria: '#fcd6a4',
             secundaria: '#f7fabf', menor: '#ffffff', tinta: '#0f172a', tintaRio: '#2f6fa8', halo: '#ffffff' },
    oscuro: { agua: '#1d3a5c', rio: '#3f78b5', arroyo: '#2f5f8f', casco: '#0b1220', autopista: '#c9788c', troncal: '#c98d6f', primaria: '#b69766',
              secundaria: '#a3a37a', menor: '#6b7689', tinta: '#e2e8f0', tintaRio: '#93c5fd', halo: '#0f172a' },
};
export const coloresBase = (oscuro) => COLORES[oscuro ? 'oscuro' : 'claro'];
// La fuente: el archivo del mismo origen (absoluta(ruta) da la dirección desde la raíz del sitio).
export const fuenteBase = (absoluta) => ({ type: 'vector', url: `pmtiles://${absoluta('datos/mapa_base/pais.pmtiles')}` });

const ancho = (pares) => ['interpolate', ['exponential', 1.5], ['zoom'], ...pares];
const clase = (...clases) => ['in', ['get', 'clase'], ['literal', clases]];
const PRINCIPALES = ['autopista', 'troncal', 'primaria', 'secundaria'];
const MENORES = ['terciaria', 'local', 'calle'];
const colorRuta = (c) => ['match', ['get', 'clase'], 'autopista', c.autopista, 'troncal', c.troncal, 'primaria', c.primaria, c.secundaria];

// Las capas de la base: lineas (agua, ríos, arroyos y rutas, debajo de los límites) y rotulos (nombres de ríos, números de
// ruta y, con lugares, los nombres de las localidades y los barrios; debajo de los rótulos propios).
export function capasBase(oscuro, { lugares = false } = {}) {
    const c = coloresBase(oscuro);
    const base = { source: FUENTE_BASE };
    const lineas = [
        { id: 'kb-agua', type: 'fill', ...base, 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': c.agua } },
        { id: 'kb-arroyos', type: 'line', ...base, 'source-layer': 'water', filter: clase('arroyo', 'canal'), layout: { 'line-cap': 'round' },
          paint: { 'line-color': c.arroyo, 'line-width': ancho([10, 0.4, 14, 1.4]) } },
        { id: 'kb-rios', type: 'line', ...base, 'source-layer': 'water', filter: clase('rio'), layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': c.rio, 'line-width': ancho([4, 0.6, 6, 0.9, 8, 1.2, 12, 2.2, 14, 3.5]) } },
        { id: 'kb-menores-casco', type: 'line', ...base, 'source-layer': 'roads', filter: clase(...MENORES), minzoom: 11, layout: { 'line-join': 'round' },
          paint: { 'line-color': c.casco, 'line-width': ancho([11, 0.6, 14, 4.5]) } },
        { id: 'kb-menores', type: 'line', ...base, 'source-layer': 'roads', filter: clase(...MENORES), layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': c.menor, 'line-width': ancho([9, 0.4, 14, 3.4]) } },
        { id: 'kb-principales-casco', type: 'line', ...base, 'source-layer': 'roads', filter: clase(...PRINCIPALES), minzoom: 7, layout: { 'line-join': 'round' },
          paint: { 'line-color': c.casco, 'line-width': ancho([7, 1.4, 10, 3, 14, 8]) } },
        { id: 'kb-principales', type: 'line', ...base, 'source-layer': 'roads', filter: clase(...PRINCIPALES), layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': colorRuta(c), 'line-width': ancho([4, 0.8, 6, 1.1, 8, 1.5, 10, 2.2, 14, 6]) } },
    ];
    const halo = { 'text-halo-color': c.halo, 'text-halo-width': 1.5 };
    const rotulos = [
        { id: 'kb-nombres-rios', type: 'symbol', ...base, 'source-layer': 'water', filter: ['all', clase('rio', 'arroyo'), ['has', 'nombre']], minzoom: 9,
          layout: { 'symbol-placement': 'line', 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-letter-spacing': 0.04 },
          paint: { 'text-color': c.tintaRio, ...halo } },
        { id: 'kb-refs', type: 'symbol', ...base, 'source-layer': 'roads', filter: ['has', 'ref'], minzoom: 8,
          layout: { 'symbol-placement': 'line', 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Medium'], 'text-size': 10, 'symbol-spacing': 320 },
          paint: { 'text-color': c.tinta, ...halo } },
    ];
    if (lugares) {
        rotulos.push({ id: 'kb-lugares', type: 'symbol', ...base, 'source-layer': 'places', minzoom: 10,
                       layout: { 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Regular'], 'text-max-width': 8,
                                 'text-size': ['match', ['get', 'clase'], 'ciudad', 13, 'pueblo', 12, 'barrio', 10.5, 11] },
                       paint: { 'text-color': c.tinta, 'text-opacity': 0.8, ...halo } });
    }
    return { lineas, rotulos };
}

// Los colores del tema en las capas de la base que ya están en el mapa.
export function aplicarTemaBase(map, oscuro) {
    const c = coloresBase(oscuro);
    const pintar = (id, propiedad, valor) => map.getLayer(id) && map.setPaintProperty(id, propiedad, valor);
    pintar('kb-agua', 'fill-color', c.agua);
    pintar('kb-arroyos', 'line-color', c.arroyo);
    pintar('kb-rios', 'line-color', c.rio);
    for (const id of ['kb-menores-casco', 'kb-principales-casco']) pintar(id, 'line-color', c.casco);
    pintar('kb-menores', 'line-color', c.menor);
    pintar('kb-principales', 'line-color', colorRuta(c));
    pintar('kb-nombres-rios', 'text-color', c.tintaRio);
    for (const id of ['kb-refs', 'kb-lugares']) pintar(id, 'text-color', c.tinta);
    for (const id of ['kb-nombres-rios', 'kb-refs', 'kb-lugares']) pintar(id, 'text-halo-color', c.halo);
}

// Mostrar u ocultar la base (las capas de su fuente).
export function verBase(map, visible) {
    for (const capa of map.getStyle()?.layers ?? []) {
        if (capa.source === FUENTE_BASE) map.setLayoutProperty(capa.id, 'visibility', visible ? 'visible' : 'none');
    }
}

// La atribución obligatoria de los datos de OpenStreetMap (ODbL), con el enlace a su página de derechos.
export function enlaceOsm() {
    const a = document.createElement('a');
    a.href = 'https://www.openstreetmap.org/copyright';
    a.textContent = '© colaboradores de OpenStreetMap';
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    return a;
}
