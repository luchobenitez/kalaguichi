// Mapa del país por distrito (ADR-022) con MapLibre: los límites de los distritos y de los departamentos del INE (CNPV
// 2022, simplificados), el relleno de cada distrito (color y atenuado, que pinta pais.js), el mapa base del país encima
// (agua, ríos, arroyos y rutas de OpenStreetMap; ADR-026, base_pais.js), los nombres de los departamentos al alejar y los
// de los distritos al acercar. Mismo motor, worker y tipografías que el mapa de un distrito (mapa_gl.js), con sus
// controles (zoom_mapa.js); todo se pide al mismo origen. Sin HTML desde datos.
import { cargarMotor, absoluta, TEXTOS_MAPLIBRE } from './mapa_gl.js';
import { agregarControles } from './zoom_mapa.js';
import { FUENTE_BASE, fuenteBase, capasBase, aplicarTemaBase, verBase, enlaceOsm } from './base_pais.js';

// La vista no sale de Paraguay y sus alrededores (el país va de -62,6 a -54,3 de longitud y de -27,6 a -19,3 de latitud).
const LIMITES = [[-67.5, -31], [-49.5, -16]];
const ZOOM_NOMBRES = 7;   // Desde este zoom, los nombres de los distritos en lugar de los de los departamentos.
// Fondo, tierra del país, límites y textos de cada tema (las mismas tintas que el mapa sin calles de un distrito).
const TEMAS = {
    claro: { fondo: '#dbe4ee', tierra: '#f1f5f9', distrito: '#ffffff', departamento: '#334155', tinta: '#0f172a', halo: '#ffffff', elegido: '#0f172a' },
    oscuro: { fondo: '#08101e', tierra: '#111c30', distrito: '#0b1220', departamento: '#cbd5e1', tinta: '#f8fafc', halo: '#0f172a', elegido: '#f8fafc' },
};
const temaOscuro = () => document.documentElement.dataset.theme === 'dark';
const coleccion = (features) => ({ type: 'FeatureCollection', features });
const punto = (coordenadas, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coordenadas }, properties });
const caja = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y1]];

// geo: { distritos, departamentos } (GeoJSON con clave/nombre y departamento/nombre); etiquetas: { distritos: [{ clave,
// nombre, centro }], departamentos: [{ codigo, nombre, centro }] }. opciones: etiqueta (texto accesible), atribucion (nodo),
// pais (caja [x0, y0, x1, y1]), alTocar(clave), texto(clave) (globo al pasar el puntero), alCambiarTema(), margen() y
// controles (opciones de agregarControles).
export function crearMapaPais(geo, etiquetas, contenedor, opciones = {}) {
    const estado = { pintura: new Map(), elegido: null, hover: null, opacidad: 0.85,
                     elementos: { departamentos: true, distritos: true, nombres: true, base: true } };
    let map = null;
    const api = { map: null, contenedor };

    const atribucion = opciones.atribucion ?? Object.assign(document.createElement('p'), { className: 'mapa__atribucion' });
    if (!opciones.atribucion) contenedor.append(atribucion);
    atribucion.replaceChildren(enlaceOsm(), ' (ODbL) · Protomaps · Límites: INE (CNPV 2022) · Resultados: TREP (Justicia Electoral)');
    atribucion.title = 'Mapa base: rutas, ríos y arroyos de OpenStreetMap (ODbL), del build de Protomaps. Límites referenciales de los distritos ' +
        'y los departamentos: INE, Cartografía digital del CNPV 2022, simplificados. Resultados preliminares del TREP (Justicia Electoral).';

    const globo = document.createElement('div');
    globo.className = 'mapa__globo';
    globo.hidden = true;
    contenedor.append(globo);

    const tema = () => TEMAS[temaOscuro() ? 'oscuro' : 'claro'];
    const ver = (id, visible) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');

    function estilo() {
        const t = tema();
        const base = capasBase(temaOscuro());
        return {
            version: 8,
            glyphs: absoluta('assets/vendor/mapa/fonts/{fontstack}/{range}.pbf'),
            sources: {
                'k-distritos': { type: 'geojson', data: geo.distritos, promoteId: 'clave' },
                'k-departamentos': { type: 'geojson', data: geo.departamentos },
                'k-nombres-distritos': { type: 'geojson', data: coleccion(etiquetas.distritos.map((d) => punto(d.centro, { nombre: d.nombre, clave: d.clave }))) },
                'k-nombres-departamentos': { type: 'geojson', data: coleccion(etiquetas.departamentos.map((d) => punto(d.centro, { nombre: d.nombre }))) },
                [FUENTE_BASE]: fuenteBase(absoluta),
            },
            layers: [
                { id: 'k-fondo', type: 'background', paint: { 'background-color': t.fondo } },
                { id: 'k-tierra', type: 'fill', source: 'k-departamentos', paint: { 'fill-color': t.tierra } },
                { id: 'k-relleno', type: 'fill', source: 'k-distritos',
                  paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], t.tierra],
                           'fill-opacity': ['case', ['boolean', ['feature-state', 'atenuado'], false], estado.opacidad * 0.22, estado.opacidad] } },
                // El mapa base sobre el relleno, como referencia: agua, ríos, arroyos y rutas (debajo de los límites).
                ...base.lineas,
                { id: 'k-distritos-borde', type: 'line', source: 'k-distritos',
                  paint: { 'line-color': t.distrito, 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.25, 8, 0.8, 11, 1.4] } },
                { id: 'k-departamentos-borde', type: 'line', source: 'k-departamentos', layout: { 'line-join': 'round' },
                  paint: { 'line-color': t.departamento, 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 8, 1.6, 11, 2.4] } },
                { id: 'k-hover', type: 'line', source: 'k-distritos',
                  paint: { 'line-color': t.elegido, 'line-width': 1.6, 'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0] } },
                { id: 'k-elegido', type: 'line', source: 'k-distritos', layout: { 'line-join': 'round' },
                  paint: { 'line-color': t.elegido, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 3.5],
                           'line-opacity': ['case', ['boolean', ['feature-state', 'elegido'], false], 1, 0] } },
                // Los nombres de los ríos y los números de ruta, al acercar (los de los distritos van encima).
                ...base.rotulos,
                { id: 'k-nombres-departamentos', type: 'symbol', source: 'k-nombres-departamentos', maxzoom: ZOOM_NOMBRES,
                  layout: { 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Medium'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 7, 13],
                            'text-transform': 'uppercase', 'text-letter-spacing': 0.06, 'text-max-width': 8, 'text-padding': 4 },
                  paint: { 'text-color': t.tinta, 'text-halo-color': t.halo, 'text-halo-width': 1.6, 'text-opacity': 0.9 } },
                { id: 'k-nombres-distritos', type: 'symbol', source: 'k-nombres-distritos', minzoom: ZOOM_NOMBRES,
                  layout: { 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10.5, 10, 13],
                            'text-max-width': 7, 'text-padding': 3 },
                  paint: { 'text-color': t.tinta, 'text-halo-color': t.halo, 'text-halo-width': 1.6 } },
            ],
        };
    }

    // Relleno, atenuado y elegido: estado por distrito (feature-state), sin volver a leer la geometría.
    function aplicar() {
        if (!map?.getSource('k-distritos')) return;
        for (const [clave, p] of estado.pintura) {
            map.setFeatureState({ source: 'k-distritos', id: clave }, { color: p.color ?? null, atenuado: Boolean(p.atenuado), elegido: clave === estado.elegido });
        }
        aplicarAspecto();
    }

    function aplicarAspecto() {
        if (!map?.getLayer('k-relleno')) return;
        const o = estado.opacidad;
        map.setPaintProperty('k-relleno', 'fill-opacity', ['case', ['boolean', ['feature-state', 'atenuado'], false], o * 0.22, o]);
        const e = estado.elementos;
        ver('k-departamentos-borde', e.departamentos);
        ver('k-distritos-borde', e.distritos);
        ver('k-nombres-departamentos', e.nombres);
        ver('k-nombres-distritos', e.nombres);
        verBase(map, e.base);
    }

    function aplicarTema() {
        if (!map?.getLayer('k-relleno')) return;
        const t = tema();
        map.setPaintProperty('k-fondo', 'background-color', t.fondo);
        map.setPaintProperty('k-tierra', 'fill-color', t.tierra);
        map.setPaintProperty('k-relleno', 'fill-color', ['coalesce', ['feature-state', 'color'], t.tierra]);
        map.setPaintProperty('k-distritos-borde', 'line-color', t.distrito);
        map.setPaintProperty('k-departamentos-borde', 'line-color', t.departamento);
        for (const id of ['k-hover', 'k-elegido']) map.setPaintProperty(id, 'line-color', t.elegido);
        for (const id of ['k-nombres-departamentos', 'k-nombres-distritos']) {
            map.setPaintProperty(id, 'text-color', t.tinta);
            map.setPaintProperty(id, 'text-halo-color', t.halo);
        }
        aplicarTemaBase(map, temaOscuro());
        opciones.alCambiarTema?.();
    }

    function distritoEn(puntoPantalla) {
        return map.queryRenderedFeatures(puntoPantalla, { layers: ['k-relleno'] })[0]?.properties.clave ?? null;
    }

    function marcarHover(clave) {
        if (clave === estado.hover) return;
        if (estado.hover) map.setFeatureState({ source: 'k-distritos', id: estado.hover }, { hover: false });
        estado.hover = clave;
        if (clave) map.setFeatureState({ source: 'k-distritos', id: clave }, { hover: true });
    }

    function mostrarGlobo(evento) {
        const clave = distritoEn(evento.point);
        marcarHover(clave);
        map.getCanvas().style.cursor = clave ? 'pointer' : '';
        const texto = clave ? opciones.texto?.(clave) : null;
        if (!texto) {
            globo.hidden = true;
            return;
        }
        globo.textContent = texto;
        globo.hidden = false;
        const ancho = contenedor.clientWidth, alto = contenedor.clientHeight;
        const izquierda = Math.min(ancho - globo.offsetWidth - 8, Math.max(8, evento.point.x + 14));
        const arriba = evento.point.y + 14 + globo.offsetHeight > alto ? evento.point.y - globo.offsetHeight - 10 : evento.point.y + 14;
        globo.style.transform = `translate(${Math.round(izquierda)}px, ${Math.round(arriba)}px)`;
    }

    api.listo = (async () => {
        const maplibregl = await cargarMotor();
        map = new maplibregl.Map({
            container: contenedor, style: estilo(), bounds: caja(opciones.pais), fitBoundsOptions: { padding: 16 }, maxBounds: LIMITES,
            minZoom: 4, maxZoom: 12, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
            locale: { ...TEXTOS_MAPLIBRE, 'Map.Title': opciones.etiqueta ?? 'Mapa de Paraguay por distrito' },
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        api.map = map;
        contenedor.mapaKalaguichi = api;   // Para las pruebas y la depuración.
        await new Promise((resolver, rechazar) => {
            map.once('load', resolver);
            map.once('error', (e) => (map.loaded() ? null : rechazar(e.error ?? e)));
        });
        aplicar();
        map.on('click', (evento) => {
            const clave = distritoEn(evento.point);
            if (clave) opciones.alTocar?.(clave);
        });
        // El globo es para el puntero: un toque (que el navegador también avisa como movimiento del ratón) no lo deja abierto.
        map.on('mousemove', (evento) => { if (matchMedia('(hover: hover)').matches) mostrarGlobo(evento); });
        map.on('mouseout', () => { globo.hidden = true; marcarHover(null); });
        map.on('movestart', () => { globo.hidden = true; });
        new MutationObserver(aplicarTema).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        await new Promise((resolver) => {
            map.once('idle', resolver);
            map.triggerRepaint();
        });
        return api;
    })();

    const zoom = {
        acercar: () => map?.zoomIn(),
        alejar: () => map?.zoomOut(),
        reiniciar: () => map && map.fitBounds(api.encuadreActual ?? caja(opciones.pais), { padding: api.margen() }),
    };
    api.controles = agregarControles(contenedor, zoom, opciones.leyendas ?? (() => []), opciones.controles ?? {});

    // fn(clave) → { color, atenuado }: el relleno de cada distrito.
    api.pintar = (claves, fn) => {
        estado.pintura = new Map(claves.map((clave) => [clave, fn(clave)]));
        aplicar();
    };
    api.elegir = (clave) => {
        const antes = estado.elegido;
        estado.elegido = clave ?? null;
        if (!map?.getSource('k-distritos')) return;
        if (antes) map.setFeatureState({ source: 'k-distritos', id: antes }, { elegido: false });
        if (clave) map.setFeatureState({ source: 'k-distritos', id: clave }, { elegido: true });
    };
    api.fijarOpacidad = (valor) => {
        estado.opacidad = Math.max(0, Math.min(1, valor));
        aplicarAspecto();
    };
    api.fijarElementos = (elementos) => {
        Object.assign(estado.elementos, elementos);
        aplicarAspecto();
    };
    api.margen = opciones.margen ?? (() => 16);
    // Encuadre de una caja [x0, y0, x1, y1] (un departamento o un distrito); null: el país.
    api.encuadrar = (cajaPedida, { animar = false, maxZoom = 10 } = {}) => {
        api.encuadreActual = cajaPedida ? caja(cajaPedida) : null;
        return api.listo.then(() => map.fitBounds(api.encuadreActual ?? caja(opciones.pais), { padding: api.margen(), maxZoom, duration: animar ? 350 : 0 }));
    };
    api.vista = () => (map ? { centro: map.getCenter().toArray(), zoom: map.getZoom() } : null);
    // Lo pintado, para las pruebas.
    api.leer = () => ({ pintura: Object.fromEntries([...estado.pintura].map(([k, p]) => [k, { color: p.color ?? null, atenuado: Boolean(p.atenuado) }])),
                        elegido: estado.elegido, opacidad: estado.opacidad, elementos: { ...estado.elementos } });
    // Punto de la pantalla (relativo a la ventana) del rótulo de un distrito, para las pruebas.
    api.proyectar = (lonLat) => {
        if (!map) return null;
        const p = map.project(lonLat);
        const r = contenedor.getBoundingClientRect();
        return [r.left + p.x, r.top + p.y];
    };
    return api;
}
