// Visor de resultados TREP 2026 de Asunción. Todo número sale de datos/*.json (mismo origen).
// Sin dependencias ni HTML desde datos: el texto se asigna con textContent y los estilos por CSSOM.
// La sección «Intendente vs Junta» vive en su propio módulo y carga Chart.js solo al abrirse.
import { crearIntendenteJunta } from './intendente_junta.js';
const SVG = 'http://www.w3.org/2000/svg';
// Comparación pedida por el usuario para el margen: Camilo Pérez (ANR) frente a Soledad Núñez (AJA).
const MARGEN = { cargo: '1', positivo: 'ANR', negativo: 'AJA' };
const ESPIRAL_M = 34;          // Separación de los puntos de mesa alrededor del local, en metros.
const PUNTO_M = 30;            // Radio de cada punto de mesa, en metros.
// Colores de las zonas TSJE: categóricos y distintos de los de las listas, para no sugerir afinidad.
const COLORES_ZONA = { 1: '#f97316', 2: '#22d3ee', 3: '#a78bfa', 4: '#facc15', 5: '#34d399', 6: '#f472b6' };
const PARTICIPACION_COLOR = '#f97316';
// IPM: tono ámbar, distinto de los colores de las listas que llevan los locales encima.
const IPM_COLOR = '#fbbf24';
// Los mapas coropléticos mezclan el color con el fondo del mapa: la leyenda muestra el mismo tono en ambos temas.
const FONDO_MAPA = [11, 18, 32];
const SIN_DATOS = '#273244';
const fmt = new Intl.NumberFormat('es-PY');
const pct = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct2 = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const $ = (id) => document.getElementById(id);
const base = new URL('./', document.baseURI);

function el(tag, clase, texto) {
    const nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto !== undefined && texto !== null) nodo.textContent = String(texto);
    return nodo;
}

function cantidad(n, singular, plural) {
    return `${fmt.format(n)} ${n === 1 ? singular : plural}`;
}

function svg(tag, atributos = {}) {
    const nodo = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(atributos)) nodo.setAttribute(k, String(v));
    return nodo;
}

function titulo(nodo, texto) {
    const t = svg('title');
    t.textContent = texto;
    nodo.append(t);
    return nodo;
}

async function cargar(nombre) {
    const respuesta = await fetch(new URL(`datos/${nombre}`, base), { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!respuesta.ok) throw new Error(`No se pudo leer datos/${nombre}`);
    return respuesta.json();
}

const estado = { cargo: '1', zona: null, zonaMunicipal: null, local: null, barrio: null, vista: 'mapa', colorMapa: 'lista',
                 lista: { 1: null, 2: null }, medida: 'pct', ipm: 'H', tabla: 'local', unidad: 'mesa', binHistograma: null,
                 orden: null, filtro: '' };
let datos;

function construirModelo(resumen, mesas, locales, geo, cand, ipm) {
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
    const indiceMargen = {
        positivo: listas[MARGEN.cargo].findIndex((x) => x.sigla === MARGEN.positivo),
        negativo: listas[MARGEN.cargo].findIndex((x) => x.sigla === MARGEN.negativo),
    };
    const barrioPor = new Map(geo.barrios.map((b) => [b.nombre, b]));
    const zonaMunicipalPor = new Map(geo.zonas_municipales.map((z) => [z.numero, z]));
    // IPM por barrio (INE, Censo 2022), unido a la geometría por la clave del barrio (CLAVE_BAR).
    const ipmPor = new Map(ipm.barrios.map((b) => [b.clave, b]));
    return { resumen, mesas, geo, cand, ipm, ipmPor, listas, infoLocal, filas, indiceMargen, claveLocal, barrioPor, zonaMunicipalPor, mapas: {} };
}

// Suma de un conjunto de mesas para un cargo: votos por lista, demás campos y electores del padrón.
function sumar(indices, cargo) {
    const c = datos.mesas.cargos[cargo];
    const total = { votos: new Array(c.listas.length).fill(0), blancos: 0, nulos: 0, nocomputados: 0, emitidos: 0, electores: 0, mesas: indices.length };
    for (const i of indices) {
        c.votos[i].forEach((v, j) => { total.votos[j] += v; });
        total.blancos += c.blancos[i];
        total.nulos += c.nulos[i];
        total.nocomputados += c.nocomputados[i];
        total.emitidos += c.emitidos[i];
        total.electores += datos.mesas.electores[i];
    }
    total.listas = total.votos.reduce((a, b) => a + b, 0);
    return total;
}

function ganador(votos) {
    const maximo = Math.max(...votos);
    const indices = votos.flatMap((v, j) => (v === maximo ? [j] : []));
    return maximo > 0 && indices.length === 1 ? indices[0] : null;
}

function margen(total) {
    if (estado.cargo !== MARGEN.cargo || !total.listas) return null;
    return (100 * (total.votos[datos.indiceMargen.positivo] - total.votos[datos.indiceMargen.negativo])) / total.listas;
}

function participacion(total) {
    return total.electores ? (100 * total.emitidos) / total.electores : null;
}

function mesasDe(filtro) {
    return datos.filas.filter(filtro).map((f) => f.i);
}

// Filtro de zona activo: electoral (TSJE, de las actas) o municipal (oficial, por la ubicación del local).
function enZona(f) {
    return (estado.zona === null || f.zona === estado.zona) && (estado.zonaMunicipal === null || f.zonaMunicipal === estado.zonaMunicipal);
}

function seleccionActual() {
    if (estado.local) {
        const info = datos.infoLocal.get(estado.local);
        return { titulo: info.nombre, eyebrow: `Local · zona ${info.zona_nombre}`, indices: mesasDe((f) => f.clave === estado.local),
                 meta: [info.direccion, info.barrio ? `barrio ${info.barrio}` : null].filter(Boolean).join(' · ') };
    }
    if (estado.barrio) {
        const b = datos.barrioPor.get(estado.barrio);
        const locales = [...datos.infoLocal.values()].filter((x) => x.barrio === estado.barrio).length;
        return { titulo: estado.barrio, eyebrow: 'Barrio (ubicación de los locales)', indices: mesasDe((f) => f.barrio === estado.barrio),
                 meta: [`${fmt.format(locales)} locales`, b?.poblacion_2022 ? `población 2022: ${fmt.format(b.poblacion_2022)}` : null].filter(Boolean).join(' · ') };
    }
    if (estado.zonaMunicipal !== null) {
        const locales = [...datos.infoLocal.values()].filter((x) => x.zona_municipal === estado.zonaMunicipal).length;
        return { titulo: datos.resumen.zonas_municipales[estado.zonaMunicipal], eyebrow: `Zona municipal ${estado.zonaMunicipal} (oficial)`,
                 indices: mesasDe((f) => f.zonaMunicipal === estado.zonaMunicipal),
                 meta: `${fmt.format(locales)} locales ubicados en la zona` };
    }
    if (estado.zona !== null) {
        return { titulo: datos.resumen.zonas[estado.zona], eyebrow: `Zona TSJE ${estado.zona}`, indices: mesasDe((f) => f.zona === estado.zona), meta: '' };
    }
    return { titulo: 'Asunción', eyebrow: 'Resultado', indices: datos.filas.map((f) => f.i), meta: '' };
}

function colorDe(j, cargo = estado.cargo) {
    return datos.listas[cargo][j].color;
}

function nombreDe(item) {
    return estado.cargo === '1' ? item.nombre : `${item.sigla} · ${item.lista}`;
}

function renderTotales() {
    const sel = seleccionActual();
    const total = sumar(sel.indices, estado.cargo);
    $('eyebrowTotales').textContent = `${sel.eyebrow} · ${datos.resumen.cargos[estado.cargo].nombre}`;
    $('tituloTotales').textContent = sel.titulo;
    $('metaTotales').textContent = [sel.meta, `${fmt.format(total.mesas)} mesas con acta`, `${fmt.format(total.emitidos)} votos emitidos`]
        .filter(Boolean).join(' · ');
    $('limpiarSeleccion').hidden = !estado.local && !estado.barrio && estado.zona === null && estado.zonaMunicipal === null;
    const contenedor = $('listaResultados');
    contenedor.replaceChildren();
    const orden = total.votos.map((v, j) => j).sort((a, b) => total.votos[b] - total.votos[a]);
    for (const j of orden) {
        const item = datos.listas[estado.cargo][j];
        const fila = el('div', 'resultado');
        fila.dataset.lista = item.num;
        const figura = el('span', 'resultado__foto');
        figura.style.borderColor = item.color;
        if (estado.cargo === '1' && item.foto) {
            const img = el('img');
            img.src = item.foto.archivo;
            img.alt = '';
            img.width = 48;
            img.height = 48;
            img.loading = 'lazy';
            figura.append(img);
        } else {
            figura.textContent = item.sigla.slice(0, 5);
            figura.style.background = item.color;
            figura.classList.add('resultado__foto--sigla');
        }
        const cuerpo = el('div', 'resultado__cuerpo');
        const encabezado = el('div', 'resultado__encabezado');
        encabezado.append(el('strong', 'resultado__nombre', nombreDe(item)),
            el('span', 'resultado__votos', `${fmt.format(total.votos[j])} votos`));
        const barra = el('div', 'barra');
        const relleno = el('span', 'barra__relleno');
        relleno.style.width = `${total.listas ? (100 * total.votos[j]) / total.listas : 0}%`;
        relleno.style.background = item.color;
        barra.append(relleno);
        const pie = el('div', 'resultado__pie');
        pie.append(el('span', null, estado.cargo === '1' ? `${item.sigla} · ${item.lista}` : `Lista ${item.num}`),
            el('span', 'resultado__pct', `${total.listas ? pct.format((100 * total.votos[j]) / total.listas) : '0,0'} %`));
        cuerpo.append(encabezado, barra, pie);
        fila.append(figura, cuerpo);
        contenedor.append(fila);
    }
    const part = $('participacion');
    part.replaceChildren();
    const p = participacion(total);
    if (p !== null) {
        part.append(el('span', 'participacion__titulo', 'Participación'),
            el('strong', 'participacion__valor', `${pct.format(p)} %`),
            el('span', 'participacion__detalle', `${fmt.format(total.emitidos)} votos emitidos de ${fmt.format(total.electores)} electores habilitados en las mesas con acta (padrón).`));
    }
    const dif = $('diferencia');
    dif.replaceChildren();
    if (orden.length > 1 && total.listas) {
        const [a, b] = orden;
        const votos = total.votos[a] - total.votos[b];
        dif.append(el('span', 'diferencia__titulo', 'Diferencia entre las dos más votadas'),
            el('strong', 'diferencia__valor', `${fmt.format(votos)} votos · ${pct.format((100 * votos) / total.listas)} puntos`),
            el('span', 'diferencia__detalle', `${nombreDe(datos.listas[estado.cargo][a])} sobre ${nombreDe(datos.listas[estado.cargo][b])}. Porcentajes sobre ${fmt.format(total.listas)} votos a listas.`));
    }
    const otros = $('otrosVotos');
    otros.replaceChildren();
    for (const [etiqueta, valor] of [['Votos a listas', total.listas], ['Blancos', total.blancos], ['Nulos', total.nulos],
        ['No computados', total.nocomputados], ['Emitidos', total.emitidos], ['Electores', total.electores]]) {
        const grupo = el('div');
        grupo.append(el('dt', null, etiqueta), el('dd', null, fmt.format(valor)));
        otros.append(grupo);
    }
}

// --- Bancas de la Junta Municipal (hemiciclo con fotos) -----------------------------------------

// Hemiciclo: filas concéntricas con bancas proporcionales al radio; se ocupan por ángulo, de izquierda a derecha.
function posicionesHemiciclo(total) {
    const filas = Math.max(2, Math.round(Math.sqrt(total / 2.6)));
    const radios = Array.from({ length: filas }, (_, i) => 160 + i * 72);
    const suma = radios.reduce((a, b) => a + b, 0);
    const cantidades = radios.map((r) => Math.max(2, Math.round((total * r) / suma)));
    let diferencia = total - cantidades.reduce((a, b) => a + b, 0);
    for (let i = cantidades.length - 1; diferencia !== 0; i = (i - 1 + cantidades.length) % cantidades.length) {
        cantidades[i] += Math.sign(diferencia);
        diferencia -= Math.sign(diferencia);
    }
    const puestos = [];
    radios.forEach((r, i) => {
        for (let k = 0; k < cantidades[i]; k++) {
            const angulo = Math.PI * (1 - k / (cantidades[i] - 1));
            puestos.push({ angulo, x: 380 + r * Math.cos(angulo), y: 380 - r * Math.sin(angulo), r });
        }
    });
    return puestos.sort((a, b) => b.angulo - a.angulo || a.r - b.r);
}

function renderBancas() {
    const panel = $('panelBancas');
    panel.hidden = estado.cargo !== '2';
    if (panel.hidden || panel.dataset.listo) return;
    const b = datos.cand.bancas;
    const listas = datos.listas['2'];
    const porLista = listas.map((item) => ({ item, electos: b.electos.filter((e) => e.numLista === item.num).sort((x, y) => x.banca - y.banca) }))
        .filter((x) => x.electos.length).sort((x, y) => y.electos.length - x.electos.length);
    $('metaBancas').textContent = `${b.total} bancas · ${porLista.map((x) => `${x.item.sigla} ${x.electos.length}`).join(' · ')} · TREP preliminar`;
    const leyenda = $('bancasLeyenda');
    leyenda.replaceChildren();
    for (const { item, electos } of porLista) {
        const li = el('li', 'bancas__grupo');
        const numero = el('span', 'bancas__numero', electos.length);
        numero.style.background = item.color;
        const texto = el('span', 'bancas__texto');
        texto.append(el('strong', null, item.sigla), el('span', null, item.lista));
        li.append(numero, texto);
        leyenda.append(li);
    }
    const puestos = posicionesHemiciclo(b.total);
    const lienzo = svg('svg', { viewBox: '0 0 760 412', class: 'bancas__svg', role: 'img',
        'aria-label': `Hemiciclo de ${b.total} bancas: ${porLista.map((x) => `${x.item.sigla} ${x.electos.length}`).join(', ')}` });
    const defs = svg('defs');
    lienzo.append(defs);
    let k = 0;
    for (const { item, electos } of porLista) {
        for (const e of electos) {
            const p = puestos[k];
            const grupo = svg('g', { class: 'banca' });
            grupo.dataset.lista = item.num;
            const recorte = svg('clipPath', { id: `banca-${k}` });
            recorte.append(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 24 }));
            defs.append(recorte);
            grupo.append(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 28, fill: item.color, class: 'banca__anillo' }));
            if (e.foto) {
                grupo.append(svg('image', { href: e.foto.archivo, x: (p.x - 24).toFixed(1), y: (p.y - 24).toFixed(1), width: 48, height: 48,
                    preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#banca-${k})` }));
            }
            titulo(grupo, `${e.nombre} · ${item.sigla} · ${fmt.format(e.votos_preferenciales)} votos preferenciales`);
            lienzo.append(grupo);
            k += 1;
        }
    }
    const total = svg('text', { x: 380, y: 352, 'text-anchor': 'middle', class: 'bancas__total' });
    total.textContent = String(b.mayoria);
    const mayoria = svg('text', { x: 380, y: 380, 'text-anchor': 'middle', class: 'bancas__mayoria' });
    mayoria.textContent = 'necesarias para la mayoría';
    lienzo.append(total, mayoria);
    $('bancas').replaceChildren(lienzo);
    const personas = $('bancasPersonas');
    personas.replaceChildren();
    for (const { item, electos } of porLista) {
        const grupo = el('div', 'bancas__lista');
        const encabezado = el('h3', null, `${item.sigla} · ${electos.length} ${electos.length === 1 ? 'banca' : 'bancas'}`);
        encabezado.style.borderColor = item.color;
        const ol = el('ol');
        for (const e of electos) ol.append(el('li', null, `${e.nombre} (${fmt.format(e.votos_preferenciales)} preferenciales)`));
        grupo.append(encabezado, ol);
        personas.append(grupo);
    }
    $('notaBancas').textContent = `${b.metodo}: corte en ${fmt.format(Math.round(b.cociente_de_corte))} votos por banca. ` +
        'Las personas electas dentro de cada lista surgen del voto preferencial, que las actas por mesa no traen: se toman de la ' +
        'referencia y se contrastaron con el reparto propio. TREP preliminar: no es la proclamación oficial.';
    panel.dataset.listo = 'true';
}

// --- Mapas --------------------------------------------------------------------------------------

function anillosDePath(d) {
    return d.split('M').filter((s) => s.trim()).map((s) => {
        const numeros = (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        const puntos = [];
        for (let i = 0; i + 1 < numeros.length; i += 2) puntos.push([numeros[i], numeros[i + 1]]);
        return puntos;
    });
}

function dentroDe(x, y, anillos) {
    let dentro = false;
    for (const a of anillos) {
        for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
            const [xi, yi] = a[i], [xj, yj] = a[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
        }
    }
    return dentro;
}

function distanciaBorde(x, y, anillos) {
    let minimo = Infinity;
    for (const a of anillos) {
        for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
            const [x1, y1] = a[j], [x2, y2] = a[i];
            const dx = x2 - x1, dy = y2 - y1;
            const t = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
            minimo = Math.min(minimo, Math.hypot(x - x1 - t * dx, y - y1 - t * dy));
        }
    }
    return minimo;
}

// Lugar del rótulo: punto interior más alejado del borde, buscado en una grilla y refinado una vez.
function lugarRotulo(d) {
    const anillos = anillosDePath(d);
    const todos = anillos.flat();
    let [x0, y0, x1, y1] = [Math.min(...todos.map((p) => p[0])), Math.min(...todos.map((p) => p[1])),
        Math.max(...todos.map((p) => p[0])), Math.max(...todos.map((p) => p[1]))];
    let mejor = null;
    for (let ronda = 0; ronda < 2; ronda++) {
        const n = 24, px = (x1 - x0) / n, py = (y1 - y0) / n;
        for (let i = 0; i <= n; i++) {
            for (let j = 0; j <= n; j++) {
                const x = x0 + i * px, y = y0 + j * py;
                if (!dentroDe(x, y, anillos)) continue;
                const dist = distanciaBorde(x, y, anillos);
                if (!mejor || dist > mejor.dist) mejor = { x, y, dist };
            }
        }
        if (!mejor) break;
        [x0, y0, x1, y1] = [mejor.x - px, mejor.y - py, mejor.x + px, mejor.y + py];
    }
    return mejor ?? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

function lineasRotulo(nombre) {
    if (nombre.length <= 14) return [nombre];
    const medio = nombre.length / 2;
    const espacios = [...nombre.matchAll(/ /g)].map((m) => m.index);
    const corte = espacios.reduce((a, b) => (Math.abs(b - medio) < Math.abs(a - medio) ? b : a), espacios[0]);
    return [nombre.slice(0, corte), nombre.slice(corte + 1)];
}

function crearMapaBase(id, etiqueta) {
    const [x0, y0, ancho, alto] = datos.geo.viewBox;
    const lienzo = svg('svg', { viewBox: `${x0} ${y0} ${ancho} ${alto}`, role: 'img', class: 'mapa__svg', 'aria-label': etiqueta });
    const defs = svg('defs');
    const filtro = svg('filter', { id: `brillo-${id}`, x: '-50%', y: '-50%', width: '200%', height: '200%' });
    filtro.append(svg('feGaussianBlur', { stdDeviation: 22, result: 'difuso' }));
    const mezcla = svg('feMerge');
    mezcla.append(svg('feMergeNode', { in: 'difuso' }), svg('feMergeNode', { in: 'SourceGraphic' }));
    filtro.append(mezcla);
    defs.append(filtro);
    lienzo.append(defs);
    if (datos.geo.rio) lienzo.append(svg('path', { d: datos.geo.rio, class: 'mapa__rio' }));
    lienzo.append(svg('path', { d: datos.geo.distrito, class: 'mapa__distrito' }));
    const barrios = svg('g', { class: 'mapa__barrios' });
    const porNombre = new Map();
    for (const b of datos.geo.barrios) {
        const p = svg('path', { d: b.d, class: 'mapa__barrio', 'fill-rule': 'evenodd' });
        p.dataset.barrio = b.nombre;
        p.dataset.clave = b.clave;
        barrios.append(p);
        porNombre.set(b.nombre, p);
    }
    lienzo.append(barrios);
    $(id).replaceChildren(lienzo);
    return { lienzo, barrios: porNombre, filtro: `url(#brillo-${id})` };
}

// Mapa con las zonas municipales y un punto por mesa alrededor de cada local. Lo usan el mapa de mesas y el de
// voto cruzado de «Intendente vs Junta»; alElegir recibe la clave del local tocado.
function crearMapaConMesas(id, etiqueta, alElegir) {
    const mapa = crearMapaBase(id, etiqueta);
    const zonas = svg('g', { class: 'mapa__zonas' });
    const rotulos = svg('g', { class: 'mapa__rotulos' });
    for (const z of datos.geo.zonas_municipales) {
        const contorno = svg('path', { d: z.d, class: 'mapa__zona', 'fill-rule': 'evenodd' });
        contorno.dataset.zonaMunicipal = z.numero;
        zonas.append(titulo(contorno, `Zona municipal ${z.numero}: ${z.nombre}`));
        const { x, y } = lugarRotulo(z.d);
        const lineas = lineasRotulo(z.nombre);
        const texto = svg('text', { x: Math.round(x), y: Math.round(y - ((lineas.length - 1) * 440) / 2), 'text-anchor': 'middle',
            'dominant-baseline': 'middle', class: 'mapa__rotulo' });
        texto.dataset.zonaMunicipal = z.numero;
        lineas.forEach((linea, k) => {
            const tramo = svg('tspan', { x: Math.round(x), dy: k ? 440 : 0 });
            tramo.textContent = linea;
            texto.append(tramo);
        });
        rotulos.append(texto);
    }
    const halos = svg('g', { class: 'mapa__halos' });
    const puntos = svg('g', { class: 'mapa__puntos', filter: mapa.filtro });
    const toques = svg('g', { class: 'mapa__toques' });
    const porLocal = new Map();
    for (const f of datos.filas) {
        if (!porLocal.has(f.clave)) porLocal.set(f.clave, []);
        porLocal.get(f.clave).push(f);
    }
    mapa.puntos = [];
    mapa.radioLocal = new Map();
    for (const [clave, filas] of porLocal) {
        const info = datos.infoLocal.get(clave);
        filas.forEach((f, k) => {
            const angulo = k * 2.399963;
            const radio = ESPIRAL_M * Math.sqrt(k + 0.5);
            const punto = svg('circle', { cx: Math.round(info.x + radio * Math.cos(angulo)), cy: Math.round(info.y + radio * Math.sin(angulo)),
                r: PUNTO_M, class: 'mapa__mesa' });
            punto.dataset.i = f.i;
            punto.dataset.local = clave;
            punto.dataset.zona = f.zona;
            punto.dataset.zm = f.zonaMunicipal ?? '';
            puntos.append(punto);
            mapa.puntos.push(punto);
        });
        const radio = Math.max(120, ESPIRAL_M * Math.sqrt(filas.length) + PUNTO_M + 40);
        mapa.radioLocal.set(clave, radio);
        // Modo Zona TSJE: el halo lleva el color de la zona y los puntos conservan el de su lista.
        const halo = svg('circle', { cx: info.x, cy: info.y, r: radio, class: 'mapa__halo', fill: COLORES_ZONA[info.zona], stroke: COLORES_ZONA[info.zona] });
        halo.dataset.zona = info.zona;
        halo.dataset.zm = info.zona_municipal ?? '';
        halos.append(halo);
        const toque = svg('circle', { cx: info.x, cy: info.y, r: radio, class: 'mapa__toque' });
        toque.dataset.local = clave;
        toques.append(titulo(toque, `${info.nombre} · ${filas.length} mesas · zona TSJE ${info.zona_nombre}`));
    }
    mapa.lienzo.append(zonas, rotulos, halos, puntos, toques, svg('g', { class: 'mapa__ranking' }));
    mapa.lienzo.addEventListener('click', (evento) => {
        const local = evento.target.closest('[data-local]')?.dataset.local;
        if (local) alElegir(local);
    });
    return mapa;
}

function crearMapaMesas() {
    datos.mapas.mesas = crearMapaConMesas('mapa', 'Mapa de Asunción con las zonas municipales y un punto por mesa alrededor de cada local de votación',
        seleccionarLocal);
    datos.puntos = datos.mapas.mesas.puntos;
}

function encuadre() {
    let xs, ys;
    if (estado.zonaMunicipal !== null) {
        const puntos = anillosDePath(datos.zonaMunicipalPor.get(estado.zonaMunicipal).d).flat();
        xs = puntos.map((p) => p[0]);
        ys = puntos.map((p) => p[1]);
    } else if (estado.zona !== null) {
        const locales = [...datos.infoLocal.values()].filter((x) => x.zona === estado.zona);
        xs = locales.map((x) => x.x);
        ys = locales.map((x) => x.y);
    } else {
        return datos.geo.viewBox;
    }
    const margenM = estado.zonaMunicipal !== null ? 350 : 700;
    let [x0, y0, x1, y1] = [Math.min(...xs) - margenM, Math.min(...ys) - margenM, Math.max(...xs) + margenM, Math.max(...ys) + margenM];
    const [, , ancho, alto] = datos.geo.viewBox;
    const proporcion = ancho / alto;
    if ((x1 - x0) / (y1 - y0) < proporcion) {
        const extra = (y1 - y0) * proporcion - (x1 - x0);
        x0 -= extra / 2; x1 += extra / 2;
    } else {
        const extra = (x1 - x0) / proporcion - (y1 - y0);
        y0 -= extra / 2; y1 += extra / 2;
    }
    return [Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)];
}

function itemLeyenda(color, texto, extra) {
    const li = el('li');
    const muestra = el('span', `leyenda__muestra${extra ? ` ${extra}` : ''}`);
    if (color) muestra.style.background = color;
    li.append(muestra, el('span', null, texto));
    return li;
}

function renderMapaMesas() {
    const c = datos.mesas.cargos[estado.cargo];
    const leyenda = $('leyenda');
    leyenda.replaceChildren();
    const conteo = new Map();
    const visibleEn = (nodo) => (estado.zona === null || Number(nodo.dataset.zona) === estado.zona) &&
        (estado.zonaMunicipal === null || nodo.dataset.zm === String(estado.zonaMunicipal));
    const porZona = new Map();
    // Los puntos siempre llevan el color de la lista más votada de su mesa, también en el modo Zona TSJE.
    for (const punto of datos.puntos) {
        const i = Number(punto.dataset.i);
        const j = ganador(c.votos[i]);
        const clave = j === null ? 'empate' : `lista-${j}`;
        const visible = visibleEn(punto);
        punto.setAttribute('fill', j === null ? '#9ca3af' : colorDe(j));
        punto.classList.toggle('es-seleccion', punto.dataset.local === estado.local);
        punto.classList.toggle('es-atenuado', !visible);
        if (visible) {
            conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
            const z = porZona.get(punto.dataset.zona) ?? { mesas: 0, locales: new Set() };
            z.mesas += 1;
            z.locales.add(punto.dataset.local);
            porZona.set(punto.dataset.zona, z);
        }
    }
    const lienzo = datos.mapas.mesas.lienzo;
    lienzo.classList.toggle('es-modo-zona', estado.colorMapa === 'zona');
    for (const halo of lienzo.querySelectorAll('.mapa__halo')) halo.classList.toggle('es-atenuado', !visibleEn(halo));
    for (const nodo of datos.mapas.mesas.lienzo.querySelectorAll('[data-zona-municipal]')) {
        nodo.classList.toggle('es-seleccion', Number(nodo.dataset.zonaMunicipal) === estado.zonaMunicipal);
        nodo.classList.toggle('es-atenuado', estado.zonaMunicipal !== null && Number(nodo.dataset.zonaMunicipal) !== estado.zonaMunicipal);
    }
    datos.mapas.mesas.lienzo.setAttribute('viewBox', encuadre().join(' '));
    datos.listas[estado.cargo].forEach((item, j) => {
        if (conteo.get(`lista-${j}`)) leyenda.append(itemLeyenda(item.color, `${item.sigla}: ${fmt.format(conteo.get(`lista-${j}`))} mesas`));
    });
    if (conteo.get('empate')) leyenda.append(itemLeyenda(null, `Empate: ${fmt.format(conteo.get('empate'))} mesas`, 'leyenda__muestra--empate'));
    if (estado.colorMapa === 'zona') {
        for (const [codigo, nombre] of Object.entries(datos.resumen.zonas)) {
            const z = porZona.get(codigo);
            if (!z) continue;
            const li = itemLeyenda(null, `Zona TSJE ${codigo} · ${nombre}: ${cantidad(z.locales.size, 'local', 'locales')}, ${cantidad(z.mesas, 'mesa', 'mesas')}`,
                'leyenda__muestra--halo');
            li.firstChild.style.borderColor = COLORES_ZONA[codigo];
            leyenda.append(li);
        }
    }
    leyenda.append(itemLeyenda(null, 'Contorno: zonas municipales oficiales', 'leyenda__muestra--zona'));
    $('notaMapa').textContent = 'Cada punto es una mesa, con el color de la lista más votada, dibujada alrededor de su local de votación: los puntos ' +
        'se separan para que se vean y no indican una ubicación propia. ' +
        (estado.colorMapa === 'zona' ? 'El halo de cada local indica su zona electoral del TSJE. ' : '') +
        'Los contornos rotulados son las 6 zonas municipales oficiales (Municipalidad de Asunción), que no coinciden con las 6 zonas ' +
        'electorales del TSJE de las actas: por ejemplo, Zeballos Cué (TSJE) queda dentro de Santísima Trinidad (municipal). Tocá un local para ver sus cifras.';
}

// Agregados por barrio (lugar de los locales) para el cargo elegido.
function agregadosBarrio() {
    const porBarrio = new Map();
    for (const f of datos.filas) {
        if (!f.barrio) continue;
        if (!porBarrio.has(f.barrio)) porBarrio.set(f.barrio, []);
        porBarrio.get(f.barrio).push(f.i);
    }
    return new Map([...porBarrio].map(([b, idx]) => [b, sumar(idx, estado.cargo)]));
}

function mezclar(hex, alfa) {
    const n = parseInt(hex.slice(1), 16);
    const canales = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return `#${canales.map((v, k) => Math.round(FONDO_MAPA[k] + alfa * (v - FONDO_MAPA[k])).toString(16).padStart(2, '0')).join('')}`;
}

function escala(valores, pasos = 5) {
    const min = Math.min(...valores), max = Math.max(...valores);
    const ancho = (max - min) / pasos || 1;
    const cortes = Array.from({ length: pasos + 1 }, (_, i) => min + i * ancho);
    return { cortes, clase: (v) => Math.min(pasos - 1, Math.floor((v - min) / ancho)) };
}

// Quintiles: cinco grupos con (casi) la misma cantidad de barrios; útil para distribuciones muy asimétricas.
function cuantiles(valores, pasos = 5) {
    const orden = [...valores].sort((a, b) => a - b);
    const cortes = Array.from({ length: pasos + 1 }, (_, k) => orden[Math.round((k * (orden.length - 1)) / pasos)]);
    const clase = (v) => {
        let k = 0;
        while (k < pasos - 1 && v > cortes[k + 1]) k += 1;
        return k;
    };
    return { cortes, clase };
}

function opacidadPaso(paso, pasos = 5) {
    return 0.28 + (0.7 * paso) / (pasos - 1);
}

function prepararMapaBarrios(clave, id, etiqueta) {
    if (datos.mapas[clave]) return datos.mapas[clave];
    const mapa = crearMapaBase(id, etiqueta);
    mapa.lienzo.addEventListener('click', (evento) => {
        const barrio = evento.target.closest('[data-barrio]')?.dataset.barrio;
        if (barrio && datos.agregados?.has(barrio)) seleccionarBarrio(barrio);
    });
    datos.mapas[clave] = mapa;
    return mapa;
}

function pintarBarrio(path, nombre, color, opacidad, texto) {
    path.setAttribute('fill', color ? mezclar(color, opacidad) : SIN_DATOS);
    path.classList.toggle('es-seleccion', nombre === estado.barrio);
    path.replaceChildren();
    titulo(path, texto);
}

function textoBarrio(nombre, total) {
    const b = datos.barrioPor.get(nombre);
    const poblacion = b?.poblacion_2022 ? ` · población 2022: ${fmt.format(b.poblacion_2022)}` : '';
    if (!total) return `${nombre}: sin locales de votación${poblacion}`;
    const j = ganador(total.votos);
    const lider = j === null ? 'empate' : `${datos.listas[estado.cargo][j].sigla} ${pct.format((100 * total.votos[j]) / total.listas)} %`;
    return `${nombre}: ${lider} · ${fmt.format(total.emitidos)} emitidos · participación ${pct.format(participacion(total))} %${poblacion}`;
}

function renderMapaBarrios() {
    const mapa = prepararMapaBarrios('barrios', 'mapaBarrios', 'Barrios de Asunción coloreados por la lista más votada en sus locales');
    const conteo = new Map();
    for (const [nombre, path] of mapa.barrios) {
        const total = datos.agregados.get(nombre);
        if (!total) { pintarBarrio(path, nombre, null, 0, textoBarrio(nombre, null)); continue; }
        const j = ganador(total.votos);
        const orden = [...total.votos].sort((a, b) => b - a);
        const ventaja = total.listas ? (100 * (orden[0] - (orden[1] ?? 0))) / total.listas : 0;
        pintarBarrio(path, nombre, j === null ? '#9ca3af' : colorDe(j), 0.35 + 0.6 * Math.min(1, ventaja / 40), textoBarrio(nombre, total));
        const clave = j === null ? 'empate' : j;
        conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
    }
    const leyenda = $('leyendaBarrios');
    leyenda.replaceChildren();
    datos.listas[estado.cargo].forEach((item, j) => {
        if (conteo.get(j)) leyenda.append(itemLeyenda(item.color, `${item.sigla}: ${cantidad(conteo.get(j), 'barrio', 'barrios')}`));
    });
    if (conteo.get('empate')) leyenda.append(itemLeyenda(null, `Empate: ${cantidad(conteo.get('empate'), 'barrio', 'barrios')}`, 'leyenda__muestra--empate'));
    leyenda.append(itemLeyenda(null, `Sin locales de votación: ${cantidad(mapa.barrios.size - datos.agregados.size, 'barrio', 'barrios')}`, 'leyenda__muestra--vacio'));
    $('notaBarrios').textContent = 'Color: lista más votada en los locales de cada barrio; más intenso cuanto mayor la ventaja sobre la segunda. ' +
        'El barrio es la ubicación del local, no la residencia de sus electores. Tocá un barrio para ver sus cifras. Barrios: INE, CNPV 2022.';
}

function renderMapaListas() {
    const mapa = prepararMapaBarrios('listas', 'mapaListas', 'Barrios de Asunción coloreados por el porcentaje de la lista elegida');
    const listas = datos.listas[estado.cargo];
    if (estado.lista[estado.cargo] === null || estado.lista[estado.cargo] >= listas.length) {
        const total = sumar(datos.filas.map((f) => f.i), estado.cargo);
        estado.lista[estado.cargo] = ganador(total.votos) ?? 0;
    }
    const j = estado.lista[estado.cargo];
    const selector = $('selectorLista');
    if (selector.dataset.cargo !== estado.cargo) {
        selector.replaceChildren();
        listas.forEach((item, k) => {
            const boton = el('button', null, item.sigla);
            boton.type = 'button';
            boton.dataset.lista = String(k);
            selector.append(boton);
        });
        selector.dataset.cargo = estado.cargo;
    }
    for (const boton of selector.querySelectorAll('button')) boton.setAttribute('aria-pressed', String(Number(boton.dataset.lista) === j));
    for (const boton of document.querySelectorAll('[data-medida]')) boton.setAttribute('aria-pressed', String(boton.dataset.medida === estado.medida));
    const enPct = estado.medida === 'pct';
    const medir = (t) => (enPct ? (100 * t.votos[j]) / t.listas : t.votos[j]);
    const rotular = (v) => (enPct ? `${pct.format(v)} %` : `${fmt.format(Math.round(v))} votos`);
    const valores = [...datos.agregados.values()].filter((t) => t.listas).map(medir);
    const { cortes, clase } = escala(valores);
    for (const [nombre, path] of mapa.barrios) {
        const total = datos.agregados.get(nombre);
        if (!total || !total.listas) { pintarBarrio(path, nombre, null, 0, textoBarrio(nombre, null)); continue; }
        pintarBarrio(path, nombre, listas[j].color, opacidadPaso(clase(medir(total))),
            `${nombre}: ${listas[j].sigla} ${fmt.format(total.votos[j])} votos (${pct.format((100 * total.votos[j]) / total.listas)} % de los votos a listas)`);
    }
    const leyenda = $('leyendaListas');
    leyenda.replaceChildren();
    for (let k = 0; k < cortes.length - 1; k++) {
        leyenda.append(itemLeyenda(mezclar(listas[j].color, opacidadPaso(k)), `${rotular(cortes[k])} a ${rotular(cortes[k + 1])}`));
    }
    $('notaListas').textContent = (enPct
        ? `Porcentaje de ${listas[j].sigla} (${listas[j].lista}) sobre los votos a listas de los locales de cada barrio`
        : `Votos de ${listas[j].sigla} (${listas[j].lista}) en los locales de cada barrio; depende de cuántas mesas hay en el barrio`) +
        ', en 5 tramos iguales entre el mínimo y el máximo. Elegí otra lista o medida con los botones. El barrio es la ubicación del local.';
}

function renderMapaParticipacion() {
    const mapa = prepararMapaBarrios('participacion', 'mapaParticipacion', 'Barrios de Asunción coloreados por la participación');
    const valores = [...datos.agregados.values()].filter((t) => t.electores).map((t) => participacion(t));
    const { cortes, clase } = escala(valores);
    for (const [nombre, path] of mapa.barrios) {
        const total = datos.agregados.get(nombre);
        if (!total || !total.electores) { pintarBarrio(path, nombre, null, 0, textoBarrio(nombre, null)); continue; }
        const v = participacion(total);
        pintarBarrio(path, nombre, PARTICIPACION_COLOR, opacidadPaso(clase(v)),
            `${nombre}: participación ${pct.format(v)} % (${fmt.format(total.emitidos)} de ${fmt.format(total.electores)} electores)`);
    }
    const leyenda = $('leyendaParticipacion');
    leyenda.replaceChildren();
    for (let k = 0; k < cortes.length - 1; k++) {
        leyenda.append(itemLeyenda(mezclar(PARTICIPACION_COLOR, opacidadPaso(k)), `${pct.format(cortes[k])} a ${pct.format(cortes[k + 1])} %`));
    }
    const r = datos.resumen.electores;
    $('notaParticipacion').textContent = `Votos emitidos sobre electores habilitados de las mesas con acta, por barrio de los locales. ` +
        `Electores: recuento agregado del padrón por mesa (${fmt.format(r.en_mesas_con_acta)} en las mesas con acta, ${fmt.format(r.padron_total)} en total). ` +
        `${fmt.format(r.mesas_con_mas_emitidos_que_electores)} mesas tienen más votos que electores: se muestran tal cual, sin interpretarlas.`;
}

// Locales de votación encima del mapa del IPM: color de la lista más votada, tamaño según electores.
function prepararLocalesIpm(mapa) {
    if (mapa.locales) return;
    const porLocal = new Map();
    for (const f of datos.filas) {
        if (!porLocal.has(f.clave)) porLocal.set(f.clave, []);
        porLocal.get(f.clave).push(f.i);
    }
    // Los locales grandes van primero para que los chicos queden visibles encima.
    const ordenados = [...porLocal].map(([clave, indices]) => ({ clave, indices, info: datos.infoLocal.get(clave) }))
        .sort((a, b) => b.info.electores - a.info.electores);
    const capa = svg('g', { class: 'mapa__locales' });
    mapa.locales = ordenados.map((l) => {
        const nodo = svg('circle', { cx: l.info.x, cy: l.info.y, r: Math.round(50 + 2.4 * Math.sqrt(l.info.electores)), class: 'mapa__local' });
        nodo.dataset.local = l.clave;
        capa.append(nodo);
        return { ...l, nodo };
    });
    mapa.lienzo.append(capa);
    mapa.lienzo.addEventListener('click', (evento) => {
        const local = evento.target.closest('[data-local]')?.dataset.local;
        if (local) seleccionarLocal(local);
    });
}

function renderMapaIpm() {
    const mapa = prepararMapaBarrios('ipm', 'mapaIpm', 'Barrios de Asunción coloreados por un componente del IPM, con los locales de votación encima');
    prepararLocalesIpm(mapa);
    for (const boton of document.querySelectorAll('[data-ipm]')) boton.setAttribute('aria-pressed', String(boton.dataset.ipm === estado.ipm));
    const ind = datos.ipm.indicadores.find((x) => x.id === estado.ipm);
    const formato = estado.ipm === 'A' ? pct : pct2;
    // Sin dato publicado, o intensidad sin personas pobres (H = 0): no se colorea.
    const valorDe = (b) => (!b || b[estado.ipm] === null || (estado.ipm === 'A' && b.H === 0) ? null : b[estado.ipm]);
    const motivo = (b) => (!b ? 'sin dato' : b.nota ?? 'sin dato');
    const valores = datos.geo.barrios.map((b) => valorDe(datos.ipmPor.get(b.clave))).filter((v) => v !== null);
    const { cortes, clase } = cuantiles(valores);
    const conteo = new Array(5).fill(0);
    for (const [nombre, path] of mapa.barrios) {
        const b = datos.ipmPor.get(path.dataset.clave);
        const v = valorDe(b);
        if (v === null) {
            pintarBarrio(path, nombre, null, 0, `${nombre}: ${motivo(b)}`);
            continue;
        }
        const k = clase(v);
        conteo[k] += 1;
        pintarBarrio(path, nombre, IPM_COLOR, opacidadPaso(k), `${nombre}: ${ind.nombre} ${formato.format(v)} %`);
    }
    const leyenda = $('leyendaIpm');
    leyenda.replaceChildren();
    for (let k = 0; k < 5; k++) {
        leyenda.append(itemLeyenda(mezclar(IPM_COLOR, opacidadPaso(k)),
            `${formato.format(cortes[k])} a ${formato.format(cortes[k + 1])} % · ${cantidad(conteo[k], 'barrio', 'barrios')}`));
    }
    const sinColor = mapa.barrios.size - conteo.reduce((a, b) => a + b, 0);
    if (sinColor) leyenda.append(itemLeyenda(null, `Sin dato o no aplica: ${cantidad(sinColor, 'barrio', 'barrios')}`, 'leyenda__muestra--vacio'));
    const ganados = new Map();
    for (const l of mapa.locales) {
        const total = sumar(l.indices, estado.cargo);
        const j = ganador(total.votos);
        l.nodo.setAttribute('fill', j === null ? '#9ca3af' : colorDe(j));
        l.nodo.classList.toggle('es-seleccion', l.clave === estado.local);
        ganados.set(j ?? 'empate', (ganados.get(j ?? 'empate') ?? 0) + 1);
        const delBarrio = datos.ipmPor.get(datos.barrioPor.get(l.info.barrio)?.clave);
        const vb = valorDe(delBarrio);
        const lider = j === null ? 'empate' : `${datos.listas[estado.cargo][j].sigla} ${pct.format((100 * total.votos[j]) / total.listas)} %`;
        l.nodo.replaceChildren();
        titulo(l.nodo, `${l.info.nombre} · ${lider} · ${fmt.format(l.info.electores)} electores · barrio ${l.info.barrio}: ` +
            `${ind.nombre} ${vb === null ? motivo(delBarrio) : `${formato.format(vb)} %`}`);
    }
    const leyendaLocales = $('leyendaIpmLocales');
    leyendaLocales.replaceChildren();
    datos.listas[estado.cargo].forEach((item, j) => {
        if (ganados.get(j)) leyendaLocales.append(itemLeyenda(item.color, `Locales con ${item.sigla} más votada: ${fmt.format(ganados.get(j))}`, 'leyenda__muestra--local'));
    });
    if (ganados.get('empate')) leyendaLocales.append(itemLeyenda(null, `Locales con empate: ${fmt.format(ganados.get('empate'))}`, 'leyenda__muestra--empate'));
    $('notaIpm').textContent = `${ind.nombre}: ${ind.descripcion} Barrios en quintiles, cinco grupos con casi la misma cantidad de barrios ` +
        `(INE, Censo 2022). Círculos: los ${fmt.format(mapa.locales.length)} locales de votación, con el color de la lista más votada en ` +
        `${estado.cargo === '1' ? 'Intendencia' : 'Junta Municipal'} y tamaño según sus electores. Es una comparación entre agregados: no muestra ` +
        'cómo votaron las personas en situación de pobreza ni ningún otro grupo, y el barrio del local no es necesariamente el de residencia de sus electores.';
}

// Unidades para histograma y tabla; el margen se calcula con sumas de votos, no con promedios.
function unidades(tipo) {
    const grupos = new Map();
    const agregar = (clave, fila, datosGrupo) => {
        if (!grupos.has(clave)) grupos.set(clave, { ...datosGrupo, indices: [] });
        grupos.get(clave).indices.push(fila.i);
    };
    for (const f of datos.filas) {
        if (!enZona(f)) continue;
        const info = datos.infoLocal.get(f.clave);
        if (tipo === 'mesa') agregar(`${f.clave}-${f.mesa}`, f, { nombre: `${info.nombre} · mesa ${f.mesa}`, zona: f.zona, local: f.clave, barrio: info.barrio });
        if (tipo === 'local') agregar(f.clave, f, { nombre: info.nombre, zona: f.zona, local: f.clave, barrio: info.barrio });
        if (tipo === 'barrio') agregar(info.barrio ?? 'Sin barrio', f, { nombre: info.barrio ?? 'Sin barrio', barrioClave: info.barrio });
        if (tipo === 'zona') agregar(String(f.zona), f, { nombre: datos.resumen.zonas[f.zona], zona: f.zona });
        if (tipo === 'zona_municipal') agregar(String(f.zonaMunicipal), f, { nombre: datos.resumen.zonas_municipales[f.zonaMunicipal] ?? 'Sin zona' });
    }
    return [...grupos.values()].map((g) => ({ ...g, total: sumar(g.indices, estado.cargo) }));
}

const NOMBRES_UNIDAD = { mesa: ['mesa', 'mesas'], local: ['local', 'locales'], barrio: ['barrio', 'barrios'] };

function rangoBin(b) {
    const desde = b < 20 ? -100 + b * 5 : (b - 20) * 5;
    return `${desde} a ${desde + 5} puntos`;
}

function renderDetalleHistograma() {
    const caja = $('detalleHistograma');
    const h = datos.histograma;
    const b = estado.binHistograma;
    for (const barra of document.querySelectorAll('.histograma__barra')) barra.classList.toggle('es-seleccion', Number(barra.dataset.bin) === b);
    caja.replaceChildren();
    if (b === null || !h || !h.porBin[b].length) {
        caja.hidden = true;
        return;
    }
    const filas = [...h.porBin[b]].sort((x, y) => x.m - y.m);
    const [singular, plural] = NOMBRES_UNIDAD[h.unidad];
    const cabecera = el('div', 'histograma__detalle-cabecera');
    cabecera.append(el('h4', null, `${rangoBin(b)} · ${(b < 20 ? h.neg : h.pos).nombre} adelante · ${cantidad(filas.length, singular, plural)}`));
    const cerrar = el('button', 'boton-tabla', 'Cerrar');
    cerrar.type = 'button';
    cerrar.dataset.cerrarDetalle = 'true';
    cabecera.append(cerrar);
    const tabla = el('table', 'tabla');
    const encabezado = el('tr');
    const columnas = [singular[0].toUpperCase() + singular.slice(1), ...(h.unidad === 'barrio' ? [] : ['Barrio']), 'Margen', 'Emitidos', 'Mesas'];
    columnas.forEach((texto, k) => {
        const th = el('th', k === 0 || (k === 1 && h.unidad !== 'barrio') ? 'tabla__texto' : null, texto);
        th.scope = 'col';
        encabezado.append(th);
    });
    tabla.createTHead().append(encabezado);
    const cuerpo = tabla.createTBody();
    for (const { u, m } of filas) {
        const tr = el('tr');
        const nombre = el('th', null, u.nombre);
        nombre.scope = 'row';
        tr.append(nombre);
        if (h.unidad !== 'barrio') tr.append(el('td', 'tabla__texto', u.barrio ?? '—'));
        tr.append(el('td', null, `${m > 0 ? '+' : ''}${pct.format(m)}`), el('td', null, fmt.format(u.total.emitidos)), el('td', null, fmt.format(u.total.mesas)));
        cuerpo.append(tr);
    }
    const desplazable = el('div', 'tabla-scroll tabla-scroll--detalle');
    desplazable.append(tabla);
    caja.append(cabecera, desplazable);
    caja.dataset.filas = String(filas.length);
    caja.hidden = false;
}

function renderHistograma() {
    const contenedor = $('histograma');
    contenedor.replaceChildren();
    const nota = $('notaHistograma');
    const botones = $('unidadHistograma');
    if (estado.cargo !== MARGEN.cargo) {
        botones.hidden = true;
        datos.histograma = null;
        renderDetalleHistograma();
        nota.textContent = 'El margen compara las dos candidaturas a Intendencia pedidas para este análisis; no se aplica a la Junta Municipal.';
        contenedor.append(el('p', 'histograma__vacio', 'Elegí Intendencia para ver la distribución del margen.'));
        return;
    }
    botones.hidden = false;
    const pos = datos.listas[MARGEN.cargo][datos.indiceMargen.positivo];
    const neg = datos.listas[MARGEN.cargo][datos.indiceMargen.negativo];
    const conteo = new Array(40).fill(0);
    const porBin = Array.from({ length: 40 }, () => []);
    let empates = 0, sinVotos = 0, terceros = 0;
    const lista = unidades(estado.unidad);
    const [singular, plural] = NOMBRES_UNIDAD[estado.unidad];
    for (const u of lista) {
        const m = margen(u.total);
        if (m === null) { sinVotos += 1; continue; }
        const g = ganador(u.total.votos);
        if (g !== null && g !== datos.indiceMargen.positivo && g !== datos.indiceMargen.negativo) terceros += 1;
        if (m === 0) { empates += 1; continue; }
        const k = Math.min(20, Math.ceil(Math.abs(m) / 5));
        const b = m > 0 ? 19 + k : 20 - k;
        conteo[b] += 1;
        porBin[b].push({ u, m });
    }
    datos.histograma = { porBin, unidad: estado.unidad, pos, neg };
    const maximo = Math.max(1, ...conteo);
    // Franja superior reservada a los rótulos y margen lateral para las etiquetas extremas del eje.
    const ancho = 800, alto = 290, arriba = 40, abajo = 34, izquierda = 40, derecha = 40;
    const g = svg('svg', { viewBox: `0 0 ${ancho} ${alto}`, class: 'histograma__svg', role: 'img',
        'aria-label': `Histograma del margen por ${estado.unidad}: ${lista.length} unidades` });
    const paso = (ancho - izquierda - derecha) / 40;
    conteo.forEach((n, b) => {
        const h = ((alto - abajo - arriba) * n) / maximo;
        const x = izquierda + b * paso;
        const barra = svg('rect', { x: x + 1, y: alto - abajo - h, width: Math.max(1, paso - 2), height: h,
            fill: b < 20 ? neg.color : pos.color, class: 'histograma__barra' });
        barra.dataset.bin = b;
        barra.dataset.n = n;
        const resumen = `${rangoBin(b)}, ${(b < 20 ? neg : pos).nombre} adelante: ${cantidad(n, singular, plural)}`;
        if (n) {
            // Cada barra lleva su conteo; el detalle del tramo se abre al tocarla o con Enter.
            const nombres = porBin[b].map((x) => x.u.nombre);
            barra.setAttribute('tabindex', '0');
            barra.setAttribute('role', 'button');
            barra.setAttribute('aria-label', `${resumen}. Ver el detalle.`);
            g.append(titulo(barra, `${resumen}\n${nombres.slice(0, 12).join(' · ')}${nombres.length > 12 ? ` y ${fmt.format(nombres.length - 12)} más` : ''}`));
            const valor = svg('text', { x: x + paso / 2, y: alto - abajo - h - 4, 'text-anchor': 'middle', class: 'histograma__valor' });
            valor.textContent = fmt.format(n);
            g.append(valor);
        } else {
            g.append(titulo(barra, resumen));
        }
    });
    for (const valor of [-100, -50, 0, 50, 100]) {
        const x = izquierda + ((valor + 100) / 5) * paso;
        g.append(svg('line', { x1: x, x2: x, y1: alto - abajo, y2: alto - abajo + 6, class: 'histograma__eje' }));
        const etiqueta = svg('text', { x, y: alto - 10, 'text-anchor': 'middle', class: 'histograma__texto' });
        etiqueta.textContent = valor > 0 ? `+${valor}` : String(valor);
        g.append(etiqueta);
    }
    g.append(svg('line', { x1: izquierda, x2: ancho - derecha, y1: alto - abajo, y2: alto - abajo, class: 'histograma__eje' }));
    const centroX = izquierda + 20 * paso;
    g.append(svg('line', { x1: centroX, x2: centroX, y1: arriba - 6, y2: alto - abajo, class: 'histograma__centro' }));
    const izq = svg('text', { x: centroX - 8, y: 20, 'text-anchor': 'end', class: 'histograma__texto' });
    izq.textContent = `← ${neg.nombre} adelante`;
    const der = svg('text', { x: centroX + 8, y: 20, class: 'histograma__texto' });
    der.textContent = `${pos.nombre} adelante →`;
    g.append(izq, der);
    contenedor.append(g);
    const unidadTexto = { mesa: 'mesas', local: 'locales', barrio: 'barrios' }[estado.unidad];
    nota.textContent = `Margen = 100 × (${pos.sigla} − ${neg.sigla}) / votos a listas de Intendencia, en puntos; tramos de 5 puntos. ` +
        `${fmt.format(lista.length)} ${unidadTexto}` + (empates ? `; ${fmt.format(empates)} con empate exacto, fuera de las barras` : '') +
        (sinVotos ? `; ${fmt.format(sinVotos)} sin votos a listas` : '') +
        (terceros ? `; en ${fmt.format(terceros)} ganó otra lista` : '') +
        '. Tocá una barra para ver sus datos. Barrio = ubicación del local, no residencia de sus electores.';
    contenedor.dataset.total = String(conteo.reduce((a, b) => a + b, 0) + empates);
    renderDetalleHistograma();
}

function renderTabla() {
    const listas = datos.listas[estado.cargo];
    const titulos = { mesa: 'Mesa', local: 'Local', barrio: 'Barrio', zona: 'Zona TSJE', zona_municipal: 'Zona municipal' };
    const columnas = [{ id: 'nombre', titulo: titulos[estado.tabla], texto: true }];
    if (estado.tabla === 'mesa' || estado.tabla === 'local') columnas.push({ id: 'zona', titulo: 'Zona' });
    if (estado.tabla === 'local') columnas.push({ id: 'barrio', titulo: 'Barrio', texto: true });
    if (estado.tabla !== 'mesa') columnas.push({ id: 'mesas', titulo: 'Mesas' });
    columnas.push({ id: 'electores', titulo: 'Electores' }, { id: 'emitidos', titulo: 'Emitidos' }, { id: 'participacion', titulo: 'Particip.' });
    listas.forEach((item, j) => columnas.push({ id: `lista-${j}`, titulo: item.sigla, lista: j }));
    if (estado.cargo === MARGEN.cargo) columnas.push({ id: 'margen', titulo: 'Margen' });
    const filtro = estado.filtro.trim().toLocaleLowerCase('es');
    let filas = unidades(estado.tabla).filter((u) => !filtro || u.nombre.toLocaleLowerCase('es').includes(filtro) ||
        (u.barrio ?? '').toLocaleLowerCase('es').includes(filtro));
    const valor = (u, col) => {
        if (col.lista !== undefined) return u.total.votos[col.lista];
        if (col.id === 'nombre') return u.nombre;
        if (col.id === 'zona') return u.zona;
        if (col.id === 'barrio') return u.barrio ?? '';
        if (col.id === 'mesas') return u.total.mesas;
        if (col.id === 'electores') return u.total.electores;
        if (col.id === 'emitidos') return u.total.emitidos;
        if (col.id === 'participacion') return participacion(u.total) ?? -Infinity;
        if (col.id === 'margen') return margen(u.total) ?? -Infinity;
        return 0;
    };
    if (estado.orden) {
        const col = columnas.find((x) => x.id === estado.orden.id);
        if (col) {
            filas = filas.sort((a, b) => {
                const va = valor(a, col), vb = valor(b, col);
                const r = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
                return estado.orden.dir * r;
            });
        }
    }
    const tr = el('tr');
    for (const col of columnas) {
        const th = el('th', col.texto ? 'tabla__texto' : null);
        th.scope = 'col';
        const boton = el('button', 'tabla__orden', col.titulo);
        boton.type = 'button';
        boton.dataset.columna = col.id;
        if (estado.orden?.id === col.id) th.setAttribute('aria-sort', estado.orden.dir > 0 ? 'ascending' : 'descending');
        th.append(boton);
        tr.append(th);
    }
    if (estado.tabla === 'local') tr.append(el('th', null, ''));
    $('tabla').tHead.replaceChildren(tr);
    const fragmento = document.createDocumentFragment();
    for (const u of filas) {
        const fila = el('tr');
        if (u.local && estado.local === u.local) fila.classList.add('es-seleccion');
        for (const col of columnas) {
            const v = valor(u, col);
            let texto = v;
            if (col.lista !== undefined) texto = `${fmt.format(v)} (${u.total.listas ? pct.format((100 * v) / u.total.listas) : '0,0'} %)`;
            else if (col.id === 'margen') texto = v === -Infinity ? '—' : `${v > 0 ? '+' : ''}${pct.format(v)}`;
            else if (col.id === 'participacion') texto = v === -Infinity ? '—' : `${pct.format(v)} %`;
            else if (typeof v === 'number') texto = fmt.format(v);
            // Solo el nombre de la unidad encabeza la fila; las demás columnas de texto se alinean a la izquierda.
            const celda = el(col.id === 'nombre' ? 'th' : 'td', col.texto ? 'tabla__texto' : null, texto);
            if (col.id === 'nombre') celda.scope = 'row';
            fila.append(celda);
        }
        if (estado.tabla === 'local') {
            const celda = el('td');
            const boton = el('button', 'boton-tabla', 'Ver');
            boton.type = 'button';
            boton.dataset.local = u.local;
            boton.setAttribute('aria-label', `Ver ${u.nombre} en el panel de resultados y en el mapa de mesas`);
            celda.append(boton);
            fila.append(celda);
        }
        fragmento.append(fila);
    }
    $('tabla').tBodies[0].replaceChildren(fragmento);
    $('tabla').dataset.filas = String(filas.length);
    $('notaTabla').textContent = `${fmt.format(filas.length)} filas. Porcentajes sobre votos a listas de cada unidad; participación = emitidos / electores` +
        (estado.cargo === MARGEN.cargo ? '; margen en puntos, positivo = ' + datos.listas[MARGEN.cargo][datos.indiceMargen.positivo].sigla + ' adelante.' : '.') +
        (estado.tabla === 'zona_municipal' ? ' Zona municipal según la ubicación del local.' : '');
}

function renderVista() {
    for (const boton of document.querySelectorAll('#pestanas [data-vista]')) {
        const activa = boton.dataset.vista === estado.vista;
        boton.setAttribute('aria-selected', String(activa));
        $(`vista-${boton.dataset.vista}`).hidden = !activa;
    }
    const render = { mapa: renderMapaMesas, barrios: renderMapaBarrios, listas: renderMapaListas, participacion: renderMapaParticipacion,
                     ipm: renderMapaIpm, margen: renderHistograma, tablas: renderTabla }[estado.vista];
    render();
}

function renderTodo() {
    for (const boton of document.querySelectorAll('[data-cargo]')) boton.setAttribute('aria-selected', String(boton.dataset.cargo === estado.cargo));
    // «Intendente vs Junta» reemplaza al panel de resultado y a los gráficos mientras está elegida.
    const intendenteJunta = estado.cargo === 'c';
    $('panelIvj').hidden = !intendenteJunta;
    $('panelTotales').hidden = intendenteJunta;
    $('panelGraficos').hidden = intendenteJunta;
    if (intendenteJunta) {
        renderBancas();
        datos.ivj.render();
        return;
    }
    for (const boton of document.querySelectorAll('[data-tabla]')) boton.setAttribute('aria-pressed', String(boton.dataset.tabla === estado.tabla));
    for (const boton of document.querySelectorAll('[data-unidad]')) boton.setAttribute('aria-pressed', String(boton.dataset.unidad === estado.unidad));
    for (const boton of document.querySelectorAll('[data-color]')) boton.setAttribute('aria-pressed', String(boton.dataset.color === estado.colorMapa));
    datos.agregados = agregadosBarrio();
    renderTotales();
    renderBancas();
    renderVista();
}

function seleccionarLocal(clave) {
    estado.local = clave;
    estado.barrio = null;
    renderTodo();
    $('tituloTotales').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function seleccionarBarrio(nombre) {
    estado.barrio = nombre;
    estado.local = null;
    renderTodo();
    $('tituloTotales').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function renderFijos() {
    const r = datos.resumen;
    const faltan = r.cobertura.faltantes.map((f) => {
        const info = datos.infoLocal.get(datos.claveLocal(f.zona, f.local));
        return `mesa ${f.mesa} de ${info ? info.nombre : `local ${f.local}`} (zona ${f.zona}), ${f.estado}`;
    });
    $('resumenLead').textContent = `Corte del ${new Date(`${r.eleccion.corte}T12:00:00`).toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' })}. ` +
        `${fmt.format(r.cobertura.mesas_con_acta)} de ${fmt.format(r.cobertura.mesas_esperadas)} mesas con acta en ${fmt.format(datos.infoLocal.size)} locales de votación. ` +
        `Participación: ${pct.format(100 * r.electores.participacion)} %.`;
    $('avisoTrep').textContent = r.eleccion.aviso;
    for (const [codigo, nombre] of Object.entries(r.zonas_municipales)) $('opcionesMunicipales').append(new Option(`${codigo} · ${nombre}`, `m${codigo}`));
    for (const [codigo, nombre] of Object.entries(r.zonas)) $('opcionesTsje').append(new Option(`${codigo} · ${nombre}`, `t${codigo}`));
    const noDisponible = $('noDisponible');
    const titulos = { pobreza_monetaria_por_barrio: 'Pobreza monetaria por barrio', historial_2021: 'Comparación histórica' };
    for (const [clave, motivo] of Object.entries(r.no_disponible)) {
        const card = el('article', 'info-card info-card--no-disponible');
        card.dataset.vista = clave;
        card.append(el('p', 'info-card__estado', 'No disponible'), el('h2', null, titulos[clave] ?? clave), el('p', null, motivo));
        noDisponible.append(card);
    }
    const fotos = datos.listas['1'].filter((x) => x.foto).length + datos.cand.bancas.electos.filter((e) => e.foto).length;
    const items = [
        ['Votos', `${r.eleccion.fuente}. Etapa ${r.eleccion.etapa}, corte ${r.eleccion.corte}. ${r.eleccion.corte_base}`],
        ['Cobertura', `${fmt.format(r.cobertura.mesas_con_acta)} de ${fmt.format(r.cobertura.mesas_esperadas)} mesas por cargo` + (faltan.length ? `. Sin acta: ${faltan.join('; ')}.` : '.')],
        ['Electores', `${r.electores.fuente}. ${r.electores.nota}`],
        ['Locales', 'Nombre, dirección y ubicación de cada local según el catálogo de locales del padrón; sin datos de personas.'],
        ['Mapas', datos.geo.atribucion],
        ['Bancas', `${datos.cand.bancas.metodo}. ${datos.cand.bancas.nota}`],
        ['Pobreza multidimensional', `${datos.ipm.fuente}. Cada barrio se une a su polígono por la clave CLAVE_BAR del INE. ` +
            'Ñu Guasú no tiene población (parque nacional).'],
        ['Candidaturas', `Listas según las actas; nombres en boleta, personas electas y ${fotos} fotos de una referencia pública. ` +
            `${datos.cand.derechos_fotos.atribucion ?? ''} Derechos: ${datos.cand.derechos_fotos.base ?? datos.cand.derechos_fotos.estado}`],
        ['Cálculo', 'Emitidos = votos a listas + blancos + nulos + no computados, verificado en cada acta. Los cargos no se suman entre sí.'],
        ['Procedencia', `SHA-256 de cada acta en datos/procedencia.json. Generado ${r.eleccion.generado_utc}.`],
    ];
    const dl = el('dl', 'fuentes__lista');
    for (const [tituloItem, texto] of items) {
        const grupo = el('div');
        grupo.append(el('dt', null, tituloItem), el('dd', null, texto));
        dl.append(grupo);
    }
    $('fuentes').replaceChildren(dl);
}

function eventos() {
    for (const boton of document.querySelectorAll('[data-cargo]')) {
        boton.addEventListener('click', () => { estado.cargo = boton.dataset.cargo; estado.orden = null; renderTodo(); });
    }
    for (const boton of document.querySelectorAll('#pestanas [data-vista]')) {
        boton.addEventListener('click', () => { estado.vista = boton.dataset.vista; renderVista(); });
    }
    for (const boton of document.querySelectorAll('[data-tabla]')) {
        boton.addEventListener('click', () => { estado.tabla = boton.dataset.tabla; estado.orden = null; renderTodo(); });
    }
    for (const boton of document.querySelectorAll('[data-unidad]')) {
        boton.addEventListener('click', () => { estado.unidad = boton.dataset.unidad; renderTodo(); });
    }
    for (const boton of document.querySelectorAll('[data-color]')) {
        boton.addEventListener('click', () => { estado.colorMapa = boton.dataset.color; renderTodo(); });
    }
    for (const boton of document.querySelectorAll('[data-ipm]')) {
        boton.addEventListener('click', () => { estado.ipm = boton.dataset.ipm; renderVista(); });
    }
    for (const boton of document.querySelectorAll('[data-medida]')) {
        boton.addEventListener('click', () => { estado.medida = boton.dataset.medida; renderVista(); });
    }
    const elegirBarra = (barra) => {
        const b = Number(barra.dataset.bin);
        estado.binHistograma = estado.binHistograma === b ? null : b;
        renderDetalleHistograma();
    };
    $('histograma').addEventListener('click', (evento) => {
        const barra = evento.target.closest('.histograma__barra');
        if (barra && Number(barra.dataset.n)) elegirBarra(barra);
    });
    $('histograma').addEventListener('keydown', (evento) => {
        const barra = evento.target.closest('.histograma__barra');
        if (barra && (evento.key === 'Enter' || evento.key === ' ')) {
            evento.preventDefault();
            elegirBarra(barra);
        }
    });
    $('detalleHistograma').addEventListener('click', (evento) => {
        if (evento.target.closest('[data-cerrar-detalle]')) {
            estado.binHistograma = null;
            renderDetalleHistograma();
        }
    });
    $('selectorLista').addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-lista]');
        if (!boton) return;
        estado.lista[estado.cargo] = Number(boton.dataset.lista);
        renderVista();
    });
    $('filtroZona').addEventListener('change', (evento) => {
        const valor = evento.target.value;
        estado.zona = valor.startsWith('t') ? Number(valor.slice(1)) : null;
        estado.zonaMunicipal = valor.startsWith('m') ? Number(valor.slice(1)) : null;
        estado.local = null;
        estado.barrio = null;
        renderTodo();
    });
    $('limpiarSeleccion').addEventListener('click', () => {
        estado.local = null;
        estado.barrio = null;
        estado.zona = null;
        estado.zonaMunicipal = null;
        $('filtroZona').value = '';
        renderTodo();
    });
    $('filtroTabla').addEventListener('input', (evento) => { estado.filtro = evento.target.value; renderTabla(); });
    $('tabla').addEventListener('click', (evento) => {
        const local = evento.target.closest('[data-local]')?.dataset.local;
        if (local) { seleccionarLocal(local); return; }
        const columna = evento.target.closest('[data-columna]')?.dataset.columna;
        if (!columna) return;
        estado.orden = estado.orden?.id === columna ? { id: columna, dir: -estado.orden.dir } : { id: columna, dir: columna === 'nombre' ? 1 : -1 };
        renderTabla();
    });
}

async function iniciar() {
    const visor = $('visor');
    try {
        const [resumen, mesas, locales, geo, cand, ipm] = await Promise.all(
            ['resumen.json', 'mesas.json', 'locales.json', 'geo.json', 'candidaturas.json', 'indicadores_barrios.json'].map(cargar));
        datos = construirModelo(resumen, mesas, locales, geo, cand, ipm);
        datos.ivj = crearIntendenteJunta(datos, { crearMapa: crearMapaConMesas, mezclar, cuantiles, opacidadPaso });
        renderFijos();
        crearMapaMesas();
        eventos();
        renderTodo();
        visor.dataset.listo = 'true';
    } catch (error) {
        const aviso = $('errorCarga');
        aviso.hidden = false;
        aviso.textContent = 'No fue posible leer los datos del análisis. Revisá la conexión o el servidor local.';
        $('resumenLead').textContent = '';
        console.error(error);
    } finally {
        visor.setAttribute('aria-busy', 'false');
    }
}

iniciar();
