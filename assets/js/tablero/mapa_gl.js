// Mapa con MapLibre GL JS (ADR-021, etapas 3 y 4) para el tablero y los análisis. Mapa base: un extracto de OpenStreetMap
// de Asunción (PMTiles de Protomaps en datos/mapa_base/) con los estilos claro y oscuro del sitio (assets/mapa/), que siguen
// el tema, o ninguno (solo el distrito y el río). Orden de dibujo: mapa base → relleno temático semitransparente (barrios,
// zonas municipales o halos de la zona TSJE) → límites → calles y nombres del mapa base → puntos de locales o mesas → la
// selección resaltada. En el tablero (puntosPorLocal) los puntos van agrupados por local al alejar y, desde el zoom 14, una
// mesa por punto en espiral alrededor de su local; en los análisis, una mesa por punto siempre. Forma además de color en
// los puntos (daltonismo). Controles propios de
// zoom_mapa.js (acercar, alejar, volver al encuadre y pantalla completa). En las páginas que se desplazan, el mapa se
// mueve con dos dedos (o Ctrl + rueda) para que la página no quede atrapada. MapLibre (1 MB) y pmtiles se cargan solo al
// crear el primer mapa, y todo se pide al mismo origen. Sin HTML desde datos: los textos van con textContent.
import { agregarControles } from './zoom_mapa.js';

const RAIZ = new URL('../../../', import.meta.url);
// Las plantillas de tipografías llevan llaves: se arman como texto (URL() las codificaría).
const absoluta = (ruta) => `${RAIZ.href}${ruta}`;
// Los rellenos y límites propios van antes de la primera capa de calles del estilo: calles y nombres quedan encima.
const ANTES_DE_CALLES = 'roads_minor_service_casing';
// El recuadro del extracto del mapa base (scripts/mapa_base.py): la vista no sale de él, así no hay bordes vacíos.
const LIMITES = [[-57.76, -25.42], [-57.44, -25.16]];
const ESPIRAL_M = 34;            // Separación de las mesas alrededor de su local, en metros (como el mapa SVG).
const ZOOM_MESAS = 14;           // Desde este zoom, una mesa por punto; antes, un punto por local.
// Fondo propio sin mapa base: el distrito y el río, con los grises y el agua del tema.
const SIN_BASE = { claro: { tierra: '#f1f5f9', agua: '#bae6fd' }, oscuro: { tierra: '#111c30', agua: '#1e3a5f' } };
const M_POR_GRADO_LAT = 110574;
const FORMAS = ['circulo', 'rombo', 'cuadrado'];
// Tamaño de los puntos: crece más despacio que el mapa (base 1,32 por nivel de zoom), así se separan al acercar.
const TAMANO_PUNTO = ['interpolate', ['exponential', 1.32], ['zoom'], 11, 0.32, 18, 1.8];
const TEXTOS_MAPLIBRE = {
    'CooperativeGesturesHandler.WindowsHelpText': 'Usá Ctrl + rueda para acercar o alejar el mapa',
    'CooperativeGesturesHandler.MacHelpText': 'Usá ⌘ + rueda para acercar o alejar el mapa',
    'CooperativeGesturesHandler.MobileHelpText': 'Usá dos dedos para mover el mapa',
};

let motor = null;

function cargarScript(src) {
    return new Promise((resolver, rechazar) => {
        const nodo = document.createElement('script');
        nodo.src = src;
        nodo.onload = resolver;
        nodo.onerror = () => rechazar(new Error(`No se pudo cargar ${src}`));
        document.head.append(nodo);
    });
}

// MapLibre (módulo ES, con su worker propio del mismo origen) y pmtiles (script clásico autónomo), una sola vez.
function cargarMotor() {
    motor ??= (async () => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = absoluta('assets/vendor/maplibre/maplibre-gl.css');
        document.head.append(css);
        const [maplibregl] = await Promise.all([import(absoluta('assets/vendor/maplibre/maplibre-gl.mjs')),
                                                cargarScript(absoluta('assets/vendor/pmtiles/pmtiles.js'))]);
        maplibregl.setWorkerUrl(absoluta('assets/vendor/maplibre/maplibre-gl-worker.mjs'));
        maplibregl.addProtocol('pmtiles', new globalThis.pmtiles.Protocol().tile);
        return maplibregl;
    })();
    return motor;
}

async function leerJson(url) {
    const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error(`No se pudo leer ${url}`);
    return r.json();
}

const temaOscuro = () => document.documentElement.dataset.theme === 'dark';

// Estilo del mapa base con las direcciones absolutas (tipografías, íconos y mosaicos del mismo origen).
const estilos = {};
function estiloBase(oscuro) {
    const nombre = oscuro ? 'oscuro' : 'claro';
    estilos[nombre] ??= leerJson(absoluta(`assets/mapa/estilo-${nombre}.json`)).then((estilo) => {
        estilo.glyphs = absoluta(estilo.glyphs);
        estilo.sprite = absoluta(estilo.sprite);
        for (const fuente of Object.values(estilo.sources)) {
            if (fuente.url?.startsWith('pmtiles://')) fuente.url = `pmtiles://${absoluta(fuente.url.slice('pmtiles://'.length))}`;
        }
        return estilo;
    });
    return estilos[nombre];
}

// Íconos de igual área (círculo, rombo y cuadrado) como campo de distancia (SDF): MapLibre los tiñe con icon-color.
function iconoSdf(forma, lado = 48, radio = 15) {
    const datos = new Uint8ClampedArray(lado * lado * 4);
    const c = lado / 2;
    const rombo = radio * 1.2533, cuadrado = radio * 0.8862;
    for (let y = 0; y < lado; y++) {
        for (let x = 0; x < lado; x++) {
            const dx = x + 0.5 - c, dy = y + 0.5 - c;
            const d = forma === 'rombo' ? (rombo - Math.abs(dx) - Math.abs(dy)) / Math.SQRT2
                : forma === 'cuadrado' ? Math.min(cuadrado - Math.abs(dx), cuadrado - Math.abs(dy)) : radio - Math.hypot(dx, dy);
            const k = (y * lado + x) * 4;
            datos[k] = datos[k + 1] = datos[k + 2] = 255;
            datos[k + 3] = Math.max(0, Math.min(255, Math.round(191 + d * 24)));
        }
    }
    return { width: lado, height: lado, data: datos };
}

const coleccion = (features) => ({ type: 'FeatureCollection', features });
const punto = (lon, lat, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });

// Mesas en espiral (ángulo áureo) alrededor de su local, en metros: lo mismo que el mapa SVG.
function posicionesMesas(datos) {
    const salida = [];
    for (const [clave, filas] of datos.porLocal) {
        const info = datos.infoLocal.get(clave);
        const mPorGradoLon = 111320 * Math.cos((info.lat * Math.PI) / 180);
        filas.forEach((f, k) => {
            const angulo = k * 2.399963, r = ESPIRAL_M * Math.sqrt(k + 0.5);
            salida.push({ i: f.i, clave, lon: info.lon + (r * Math.cos(angulo)) / mPorGradoLon, lat: info.lat - (r * Math.sin(angulo)) / M_POR_GRADO_LAT });
        });
    }
    return salida;
}

// Radio en metros del grupo de mesas de un local (para la marca de la selección y el halo de la zona TSJE).
const radioLocal = (mesas) => Math.max(120, ESPIRAL_M * Math.sqrt(mesas) + 70);
// Metros a píxeles según el zoom, para expresiones de radio. MapLibre mide el zoom con mosaicos de 512 px: en la latitud
// de Asunción, un píxel mide 70 762 / 2^zoom metros.
const metrosAPx = (expresionMetros) => ['interpolate', ['exponential', 2], ['zoom'],
    10, ['*', expresionMetros, 1024 / 70762], 20, ['*', expresionMetros, 1048576 / 70762]];

function cajaDeCoordenadas(coords) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of coords) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return [[x0, y0], [x1, y1]];
}

function coordenadas(geometria) {
    const salida = [];
    const recorrer = (c) => (typeof c[0] === 'number' ? salida.push(c) : c.forEach(recorrer));
    recorrer(geometria.coordinates);
    return salida;
}

// opciones: etiqueta (texto accesible), gestosCooperativos (páginas que se desplazan), atribucion (nodo donde va la
// atribución; si falta, se crea en el mapa), alTocarLocal(clave), alTocarBarrio(nombre), alCambiarEstilo() (repintar
// después de cambiar el tema) y controles (opciones de agregarControles).
export function crearMapaGL(datos, contenedor, opciones = {}) {
    const estado = { mesas: null, barrios: null, zonas: null, locales: null, halos: null, marca: null, ranking: null, visibles: {},
                     base: true, opacidad: 0.45, elementos: { limites: true, nombres: true, puntos: true, manzanas: false } };
    let manzanas = null;  // GeoJSON de las manzanas, a pedido (1,9 MB).
    let pidiendoManzanas = null;
    let baseAplicada = null;  // Las capas del mapa base se recorren solo cuando cambia la opción (o el estilo).
    const mesas = posicionesMesas(datos);
    const geoBase = new URL('geo/', datos.contexto.comun);
    let map = null;
    let caja = null;     // Encuadre del distrito.
    const api = { map: null, mesas, contenedor };

    // La atribución obligatoria del mapa base, más las fuentes de la cartografía propia (siempre a la vista).
    const atribucion = opciones.atribucion ?? Object.assign(document.createElement('p'), { className: 'mapa__atribucion' });
    if (!opciones.atribucion) contenedor.append(atribucion);
    const osm = document.createElement('a');
    osm.href = 'https://www.openstreetmap.org/copyright';
    osm.textContent = '© colaboradores de OpenStreetMap';
    osm.rel = 'noopener noreferrer';
    osm.target = '_blank';
    atribucion.replaceChildren(osm, ' (ODbL) · Protomaps · INE · Municipalidad de Asunción');
    atribucion.title = 'Mapa base: © colaboradores de OpenStreetMap (ODbL), con el esquema y el estilo de Protomaps. Barrios y límite: ' +
        'INE (CNPV 2022). Zonas municipales, río, manzanas y cauces: Municipalidad de Asunción.';

    // Globo de ayuda al pasar el puntero (texto plano).
    const globo = document.createElement('div');
    globo.className = 'mapa__globo';
    globo.hidden = true;
    contenedor.append(globo);

    function aplicar() {
        if (!map?.getSource('k-mesas')) return;
        if (estado.mesas) map.getSource('k-mesas').setData(coleccion(estado.mesas));
        if (estado.barrios) map.getSource('k-barrios').setData(estado.barrios);
        if (estado.zonas) map.getSource('k-zonas').setData(estado.zonas);
        map.getSource('k-locales').setData(coleccion(estado.locales ?? []));
        map.getSource('k-halos').setData(coleccion(estado.halos ?? []));
        map.getSource('k-marca').setData(coleccion(estado.marca ? [estado.marca] : []));
        map.getSource('k-ranking').setData(coleccion(estado.ranking ?? []));
        for (const [capa, visible] of Object.entries(estado.visibles)) {
            if (map.getLayer(capa)) map.setLayoutProperty(capa, 'visibility', visible ? 'visible' : 'none');
        }
        aplicarAspecto();
    }

    const ver = (id, visible) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    // Mapa base, opacidad temática y elementos visibles.
    function aplicarAspecto() {
        if (!map?.getLayer('k-barrios-relleno')) return;
        if (baseAplicada !== estado.base) {
            baseAplicada = estado.base;
            for (const capa of map.getStyle().layers) {
                if (capa.source === 'protomaps') map.setLayoutProperty(capa.id, 'visibility', estado.base ? 'visible' : 'none');
            }
        }
        ver('k-distrito-relleno', !estado.base);
        ver('k-rio', !estado.base);
        // Los nombres de barrios del mapa base no se repiten con los propios (INE).
        ver('places_subplace', false);
        const o = estado.opacidad;
        map.setPaintProperty('k-barrios-relleno', 'fill-opacity', ['case', ['to-boolean', ['get', 'color']], o, 0]);
        map.setPaintProperty('k-zonas-relleno', 'fill-opacity', ['case', ['to-boolean', ['get', 'color']], o, 0]);
        map.setPaintProperty('k-halos', 'circle-opacity', ['case', ['==', ['get', 'atenuado'], true], o * 0.15, o * 0.45]);
        map.setPaintProperty('k-halos', 'circle-stroke-opacity', ['case', ['==', ['get', 'atenuado'], true], o * 0.3, o]);
        const e = estado.elementos;
        ver('k-barrios-borde', e.limites);
        ver('k-etiquetas-barrios', e.nombres);
        const puntos = e.puntos && estado.visibles['k-mesas'] !== false;
        ver('k-mesas', puntos);
        ver('k-locales', puntos);
        if (e.manzanas && manzanas && !map.getSource('k-manzanas')) agregarManzanas();
        ver('k-manzanas', e.manzanas);
    }

    function agregarManzanas() {
        const oscuro = temaOscuro();
        map.addSource('k-manzanas', { type: 'geojson', data: manzanas });
        map.addLayer({ id: 'k-manzanas', type: 'line', source: 'k-manzanas', minzoom: 13,
                       paint: { 'line-color': oscuro ? '#64748b' : '#94a3b8', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.3, 17, 1], 'line-opacity': 0.8 } },
        map.getLayer(ANTES_DE_CALLES) ? ANTES_DE_CALLES : undefined);
    }

    // Capas propias sobre un estilo del mapa base (al crear el mapa y al cambiar de tema).
    function agregarCapas(geo) {
        const oscuro = temaOscuro();
        const tinta = oscuro ? '#f8fafc' : '#0f172a';
        const halo = oscuro ? '#0f172a' : '#ffffff';
        for (const forma of FORMAS) if (!map.hasImage(`k-${forma}`)) map.addImage(`k-${forma}`, iconoSdf(forma), { sdf: true, pixelRatio: 2 });
        baseAplicada = null;
        map.addSource('k-rio', { type: 'geojson', data: geo.rio });
        map.addSource('k-barrios', { type: 'geojson', data: estado.barrios ?? geo.barrios });
        map.addSource('k-zonas', { type: 'geojson', data: estado.zonas ?? geo.zonas });
        map.addSource('k-distrito', { type: 'geojson', data: geo.distrito });
        map.addSource('k-etiquetas', { type: 'geojson', data: geo.etiquetas });
        map.addSource('k-halos', { type: 'geojson', data: coleccion([]) });
        map.addSource('k-mesas', { type: 'geojson', data: coleccion(estado.mesas ?? []) });
        map.addSource('k-locales', { type: 'geojson', data: coleccion([]) });
        map.addSource('k-marca', { type: 'geojson', data: coleccion([]) });
        const antes = map.getLayer(ANTES_DE_CALLES) ? ANTES_DE_CALLES : undefined;
        const fondo = SIN_BASE[oscuro ? 'oscuro' : 'claro'];
        // Sin mapa base: el distrito y el río como fondo propio.
        map.addLayer({ id: 'k-distrito-relleno', type: 'fill', source: 'k-distrito', layout: { visibility: 'none' }, paint: { 'fill-color': fondo.tierra } }, antes);
        map.addLayer({ id: 'k-rio', type: 'fill', source: 'k-rio', layout: { visibility: 'none' }, paint: { 'fill-color': fondo.agua } }, antes);
        // Relleno temático semitransparente (barrios, zonas municipales o halos de la zona TSJE) y límites, debajo de las
        // calles y sus nombres.
        map.addLayer({ id: 'k-barrios-relleno', type: 'fill', source: 'k-barrios',
                       paint: { 'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'], 'fill-opacity': 0 } }, antes);
        map.addLayer({ id: 'k-zonas-relleno', type: 'fill', source: 'k-zonas',
                       paint: { 'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'], 'fill-opacity': 0 } }, antes);
        map.addLayer({ id: 'k-halos', type: 'circle', source: 'k-halos',
                       paint: { 'circle-color': ['get', 'color'], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.5,
                                'circle-radius': metrosAPx(['get', 'radio_m']) } }, antes);
        map.addLayer({ id: 'k-barrios-borde', type: 'line', source: 'k-barrios',
                       paint: { 'line-color': oscuro ? '#94a3b8' : '#64748b', 'line-opacity': 0.55,
                                'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 1.4] } }, antes);
        map.addLayer({ id: 'k-zonas-borde', type: 'line', source: 'k-zonas',
                       paint: { 'line-color': '#f97316', 'line-dasharray': [3, 2],
                                'line-opacity': ['case', ['==', ['get', 'atenuada'], true], 0.35, 0.9],
                                'line-width': ['case', ['==', ['get', 'seleccion'], true], 3.5, 1.6] } }, antes);
        map.addLayer({ id: 'k-distrito-borde', type: 'line', source: 'k-distrito',
                       paint: { 'line-color': oscuro ? '#cbd5e1' : '#334155', 'line-width': 1.6, 'line-opacity': 0.8 } }, antes);
        // Nombres: las zonas municipales al alejar, los barrios al acercar (los del mapa base no se repiten).
        if (map.getLayer('places_subplace')) map.setLayoutProperty('places_subplace', 'visibility', 'none');
        const texto = { 'text-font': ['Noto Sans Medium'], 'text-field': ['get', 'nombre'], 'text-max-width': 8, 'text-transform': 'uppercase',
                        'text-letter-spacing': 0.04 };
        map.addLayer({ id: 'k-etiquetas-zonas', type: 'symbol', source: 'k-etiquetas', maxzoom: 13.2, filter: ['==', ['get', 'tipo'], 'zona_municipal'],
                       layout: { ...texto, 'text-size': 13 }, paint: { 'text-color': oscuro ? '#cbd5e1' : '#475569', 'text-halo-color': halo, 'text-halo-width': 1.5 } });
        map.addLayer({ id: 'k-etiquetas-barrios', type: 'symbol', source: 'k-etiquetas', minzoom: 13.2, filter: ['==', ['get', 'tipo'], 'barrio'],
                       layout: { ...texto, 'text-size': 11 }, paint: { 'text-color': oscuro ? '#cbd5e1' : '#475569', 'text-halo-color': halo, 'text-halo-width': 1.5 } });
        // Arriba de todo: los puntos (locales al alejar, mesas al acercar) y la selección.
        const simbolo = (tamano) => ({ 'icon-image': ['concat', 'k-', ['get', 'forma']], 'icon-size': tamano, 'icon-allow-overlap': true,
                                       'icon-ignore-placement': true });
        // La mesa elegida (o las del local elegido, en los análisis) lleva un borde del color del texto.
        const elegida = ['==', ['get', 'seleccionada'], true];
        // Con puntosPorLocal (tablero): un punto por local al alejar y uno por mesa desde ZOOM_MESAS; si no, mesas siempre.
        const porLocal = Boolean(opciones.puntosPorLocal);
        map.addLayer({ id: 'k-mesas', type: 'symbol', source: 'k-mesas', minzoom: porLocal ? ZOOM_MESAS : 0, layout: simbolo(TAMANO_PUNTO),
                       paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': ['case', elegida, tinta, halo],
                                'icon-halo-width': ['case', elegida, 2, 0.6],
                                'icon-opacity': ['case', ['==', ['get', 'atenuado'], true], 0.22, 1] } });
        map.addLayer({ id: 'k-locales', type: 'symbol', source: 'k-locales', maxzoom: porLocal ? ZOOM_MESAS : 24,
                       layout: simbolo(['interpolate', ['exponential', 1.32], ['zoom'], 11, ['*', ['get', 'escala'], 0.5], 18, ['*', ['get', 'escala'], 2.6]]),
                       paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': halo, 'icon-halo-width': 1,
                                'icon-opacity': ['case', ['==', ['get', 'atenuado'], true], 0.2, 0.95] } });
        map.addLayer({ id: 'k-barrios-seleccion', type: 'line', source: 'k-barrios', filter: ['==', ['get', 'seleccion'], true],
                       paint: { 'line-color': tinta, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 3.5] } });
        map.addLayer({ id: 'k-marca', type: 'circle', source: 'k-marca',
                       paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': tinta, 'circle-stroke-width': 2.5, 'circle-radius': metrosAPx(['get', 'radio_m']) } });
        // Ranking numerado (análisis): un anillo por local y su puesto arriba.
        map.addSource('k-ranking', { type: 'geojson', data: coleccion([]) });
        map.addLayer({ id: 'k-ranking-anillo', type: 'circle', source: 'k-ranking',
                       paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': tinta, 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.75,
                                'circle-radius': metrosAPx(['get', 'radio_m']) } });
        map.addLayer({ id: 'k-ranking-puesto', type: 'symbol', source: 'k-ranking',
                       layout: { 'text-field': ['to-string', ['get', 'puesto']], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-allow-overlap': true,
                                 'text-anchor': 'bottom', 'text-offset': [0, -0.9] },
                       paint: { 'text-color': tinta, 'text-halo-color': halo, 'text-halo-width': 2 } });
        aplicar();
    }

    async function cambiarTema() {
        if (!map) return;
        const estilo = await estiloBase(temaOscuro());
        const geo = api.geo;
        map.setStyle(estilo, { diff: false });
        map.once('style.load', () => {
            agregarCapas(geo);
            opciones.alCambiarEstilo?.();
        });
    }

    // Toque: el punto más cercano en 10 px a la redonda (los símbolos son chicos), si no, el barrio.
    function tocar(evento) {
        const { x, y } = evento.point;
        const capas = ['k-mesas', 'k-locales'].filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
        const cerca = capas.length ? map.queryRenderedFeatures([[x - 10, y - 10], [x + 10, y + 10]], { layers: capas }) : [];
        if (cerca.length) {
            const d = (f) => {
                const p = map.project(f.geometry.coordinates);
                return Math.hypot(p.x - x, p.y - y);
            };
            const elegido = cerca.reduce((a, b) => (d(b) < d(a) ? b : a));
            opciones.alTocarLocal?.(elegido.properties.clave);
            return;
        }
        const barrio = map.queryRenderedFeatures(evento.point, { layers: ['k-barrios-relleno'] })[0];
        if (barrio) opciones.alTocarBarrio?.(barrio.properties.nombre);
        else {
            const zona = map.queryRenderedFeatures(evento.point, { layers: ['k-zonas-relleno'] })[0];
            if (zona) opciones.alTocarZona?.(zona.properties.numero);
        }
    }

    function mostrarGlobo(evento) {
        const capas = ['k-mesas', 'k-locales', 'k-barrios-relleno', 'k-zonas-relleno'].filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
        const f = map.queryRenderedFeatures([[evento.point.x - 6, evento.point.y - 6], [evento.point.x + 6, evento.point.y + 6]], { layers: capas })
            .find((x) => x.properties.texto);
        map.getCanvas().style.cursor = f ? 'pointer' : '';
        if (!f) {
            globo.hidden = true;
            return;
        }
        globo.textContent = f.properties.texto;
        globo.hidden = false;
        const ancho = contenedor.clientWidth, alto = contenedor.clientHeight;
        const izquierda = Math.min(ancho - globo.offsetWidth - 8, Math.max(8, evento.point.x + 14));
        const arriba = evento.point.y + 14 + globo.offsetHeight > alto ? evento.point.y - globo.offsetHeight - 10 : evento.point.y + 14;
        globo.style.transform = `translate(${Math.round(izquierda)}px, ${Math.round(arriba)}px)`;
    }

    api.listo = (async () => {
        const [maplibregl, estilo, distrito, barrios, zonas, etiquetas, rio] = await Promise.all([
            cargarMotor(), estiloBase(temaOscuro()),
            ...['distrito', 'barrios', 'zonas_municipales', 'etiquetas', 'rio'].map((n) => leerJson(new URL(`${n}.geojson`, geoBase)))]);
        api.geo = { distrito, barrios, zonas, etiquetas, rio };
        caja = cajaDeCoordenadas(coordenadas(distrito.features[0].geometry));
        map = new maplibregl.Map({
            container: contenedor, style: estilo, bounds: caja, fitBoundsOptions: { padding: 16 }, maxBounds: LIMITES, minZoom: 10, maxZoom: 18.5,
            attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, cooperativeGestures: Boolean(opciones.gestosCooperativos),
            locale: { ...TEXTOS_MAPLIBRE, 'Map.Title': opciones.etiqueta ?? 'Mapa de Asunción' },
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        api.map = map;
        contenedor.mapaKalaguichi = api;   // Para las pruebas y la depuración.
        await new Promise((resolver, rechazar) => {
            map.once('load', resolver);
            map.once('error', (e) => (map.loaded() ? null : rechazar(e.error ?? e)));
        });
        agregarCapas(api.geo);
        map.on('click', tocar);
        map.on('mousemove', mostrarGlobo);
        map.on('mouseout', () => { globo.hidden = true; });
        map.on('movestart', () => { globo.hidden = true; });
        // Pantalla completa: sin gestos cooperativos (la página ya no se desplaza).
        if (opciones.gestosCooperativos) {
            new MutationObserver(() => {
                if (contenedor.classList.contains('mapa--pantalla')) map.cooperativeGestures.disable();
                else map.cooperativeGestures.enable();
            }).observe(contenedor, { attributes: true, attributeFilter: ['class'] });
        }
        new MutationObserver(cambiarTema).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        // Listo cuando terminó de dibujar: el estilo, los mosaicos a la vista y las capas propias.
        await new Promise((resolver) => {
            map.once('idle', resolver);
            map.triggerRepaint();
        });
        return api;
    })();

    const zoom = {
        acercar: () => map?.zoomIn(),
        alejar: () => map?.zoomOut(),
        reiniciar: () => map && caja && map.fitBounds(api.encuadreActual ?? caja, { padding: api.margen?.() ?? 16 }),
    };
    api.controles = agregarControles(contenedor, zoom, opciones.leyendas ?? (() => []), opciones.controles ?? {});

    // --- Pintar: cada llamada guarda el estado y lo aplica cuando el mapa está listo -----------------------------------

    // fn(mesa) → { color, forma, atenuado, texto }; null las oculta.
    api.pintarMesas = (fn) => {
        estado.mesas = fn ? mesas.map((m) => punto(m.lon, m.lat, { i: m.i, clave: m.clave, ...fn(m) })) : [];
        aplicar();
    };
    // fn(barrio) → { color, opacidad, texto, seleccion }; color null: solo el contorno.
    api.pintarBarrios = (fn) => {
        const base = api.geo?.barrios;
        if (!base) return api.listo.then(() => api.pintarBarrios(fn));
        estado.barrios = { ...base, features: base.features.map((f) => ({ ...f, properties: { ...f.properties, ...fn(f.properties) } })) };
        aplicar();
    };
    // fn(zona) → { seleccion, atenuada }.
    api.pintarZonas = (fn) => {
        const base = api.geo?.zonas;
        if (!base) return api.listo.then(() => api.pintarZonas(fn));
        estado.zonas = { ...base, features: base.features.map((f) => ({ ...f, properties: { ...f.properties, ...fn(f.properties) } })) };
        aplicar();
    };
    // Locales encima (capa del IPM): fn(clave, info) → { color, forma, escala, atenuado, texto }; null los quita.
    api.pintarLocales = (fn) => {
        estado.locales = fn ? [...datos.infoLocal.entries()].map(([clave, info]) => punto(info.lon, info.lat, { clave, ...fn(clave, info) })) : null;
        aplicar();
    };
    // Halos de la zona TSJE: fn(clave, info) → { color, atenuado }; null los quita.
    api.pintarHalos = (fn) => {
        estado.halos = fn ? [...datos.porLocal.entries()].map(([clave, filas]) => {
            const info = datos.infoLocal.get(clave);
            return punto(info.lon, info.lat, { clave, radio_m: radioLocal(filas.length), ...fn(clave, info) });
        }) : null;
        aplicar();
    };
    api.marcar = (clave) => {
        const info = clave && datos.infoLocal.get(clave);
        estado.marca = info ? punto(info.lon, info.lat, { clave, radio_m: radioLocal(datos.porLocal.get(clave)?.length ?? 1) + 40 }) : null;
        aplicar();
    };
    // Mapa base (calles) o ninguno; opacidad de la capa temática (0 a 1); elementos visibles.
    api.fijarBase = (conBase) => {
        estado.base = Boolean(conBase);
        if (map) aplicarAspecto();
    };
    api.fijarOpacidad = (valor) => {
        estado.opacidad = Math.max(0, Math.min(1, valor));
        if (map) aplicarAspecto();
    };
    api.fijarElementos = (elementos) => {
        Object.assign(estado.elementos, elementos);
        // Una sola descarga, aunque el tablero se vuelva a dibujar mientras llega.
        if (estado.elementos.manzanas && !manzanas && !pidiendoManzanas) {
            pidiendoManzanas = leerJson(new URL('manzanas.geojson', geoBase)).then((datosManzanas) => {
                manzanas = datosManzanas;
                if (map) aplicarAspecto();
            }).catch((error) => {
                pidiendoManzanas = null;
                console.warn(error);
            });
        }
        if (map) aplicarAspecto();
    };
    api.manzanasListas = () => Boolean(map?.getSource('k-manzanas'));
    // items: [{ clave, puesto, texto }] → anillo numerado por local; [] los quita.
    api.pintarRanking = (items) => {
        estado.ranking = items.map(({ clave, puesto, texto }) => {
            const info = datos.infoLocal.get(clave);
            return punto(info.lon, info.lat, { clave, puesto, texto, radio_m: radioLocal(datos.porLocal.get(clave)?.length ?? 1) + 60 });
        });
        aplicar();
    };
    api.mostrar = (capas) => {
        Object.assign(estado.visibles, capas);
        aplicar();
    };
    // Lo pintado, para las pruebas: propiedades de mesas, barrios, locales, halos, marca y ranking, y las capas visibles.
    api.leer = () => ({
        mesas: (estado.mesas ?? []).map((f) => f.properties), barrios: (estado.barrios?.features ?? []).map((f) => f.properties),
        locales: (estado.locales ?? []).map((f) => f.properties), halos: (estado.halos ?? []).map((f) => f.properties),
        marca: estado.marca?.properties ?? null, ranking: (estado.ranking ?? []).map((f) => f.properties), visibles: { ...estado.visibles },
        zonas: (estado.zonas?.features ?? []).map((f) => f.properties), base: estado.base, opacidad: estado.opacidad, elementos: { ...estado.elementos },
    });

    // --- Encuadres --------------------------------------------------------------------------------------------------
    // margen(): píxeles que tapan la hoja, la bandeja o el cajón ({ top, right, bottom, left }).
    api.margen = opciones.margen ?? (() => 16);
    api.encuadrar = (caja2) => {
        api.encuadreActual = caja2;
        return api.listo.then(() => map.fitBounds(caja2 ?? caja, { padding: api.margen(), duration: 0 }));
    };
    api.cajaDistrito = () => caja;
    api.cajaZonaMunicipal = (numero) => {
        const f = api.geo?.zonas.features.find((z) => z.properties.numero === numero);
        return f ? cajaDeCoordenadas(coordenadas(f.geometry)) : null;
    };
    api.cajaBarrio = (nombre) => {
        const f = api.geo?.barrios.features.find((b) => b.properties.nombre === nombre);
        return f ? cajaDeCoordenadas(coordenadas(f.geometry)) : null;
    };
    api.cajaLocales = (claves) => {
        const coords = claves.map((k) => datos.infoLocal.get(k)).filter(Boolean).map((x) => [x.lon, x.lat]);
        if (!coords.length) return null;
        const [[x0, y0], [x1, y1]] = cajaDeCoordenadas(coords);
        return [[x0 - 0.006, y0 - 0.006], [x1 + 0.006, y1 + 0.006]];
    };
    // Lleva un local a la vista: conserva un acercamiento mayor si ya lo había (zoom 15 como mínimo: unos 2 m por píxel).
    api.enfocarLocal = (clave) => {
        const info = datos.infoLocal.get(clave);
        if (!info || !map) return;
        map.easeTo({ center: [info.lon, info.lat], zoom: Math.max(map.getZoom(), 15), padding: api.margen(), duration: 350 });
    };
    api.enfocarCaja = (caja2) => {
        if (!caja2 || !map) return;
        map.fitBounds(caja2, { padding: api.margen(), maxZoom: 16, duration: 350 });
    };
    // Encuadre de un grupo de locales (filtro de un análisis); sin locales, el distrito. Solo cambia si cambió el grupo.
    let grupoEncuadrado = null;
    api.encuadrarLocales = (claves) => {
        const firma = claves ? [...claves].sort().join('|') : '';
        if (firma === grupoEncuadrado) return api.listo;
        grupoEncuadrado = firma;
        return api.encuadrar(claves?.length ? api.cajaLocales(claves) : null);
    };
    api.vista = () => (map ? { centro: map.getCenter().toArray(), zoom: map.getZoom() } : null);
    // Punto de la pantalla (relativo a la ventana) de un local, para las pruebas.
    api.proyectar = (clave) => {
        const info = datos.infoLocal.get(clave);
        if (!info || !map) return null;
        const p = map.project([info.lon, info.lat]);
        const r = contenedor.getBoundingClientRect();
        return [r.left + p.x, r.top + p.y];
    };
    return api;
}
