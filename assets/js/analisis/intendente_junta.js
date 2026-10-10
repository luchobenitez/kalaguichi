// Intendente vs Junta por local de votación (ADR 0006 del módulo): voto cruzado entre Intendencia y Junta Municipal.
// Los números salen de mesas.json y locales.json de la fuente elegida. Los gráficos usan Chart.js autoalojado
// (ADR-015 del proyecto), que se carga solo al abrir esta sección. El texto se asigna con textContent.
// Lo usan la sección Análisis (con su filtro de zona o barrio, herramientas.idFiltro) y la vista informe del TREP.
import { salirDePantallaCompleta } from '../tablero/zoom_mapa.js';

const RUTA_CHART = new URL('../../vendor/chartjs/chart.umd.min.js', import.meta.url).href;
// En los JSON del TREP la candidatura a Intendente de la Alianza es la lista 4 (AJA): es la «Intendente L3» del pedido.
export const GRUPOS = [
    { id: 'L1', nombre: 'Lista 1', intendencia: ['1'], junta: ['1'], rotuloInt: 'Intendente L1', rotuloJun: 'Junta L1' },
    { id: 'AL', nombre: 'Alianza', intendencia: ['4'], junta: ['2', '3'], rotuloInt: 'Intendente L3', rotuloJun: 'Junta L2 + L3' },
];
const TRAMOS = ['−20 % o menos', '−20 % a −10 %', '−10 % a −5 %', '−5 % a +5 %', '+5 % a +10 %', '+10 % a +20 %', '+20 % o más'];
const LINEAS_PCT = [-20, -10, -5, 5, 10, 20];
const ROJO = '#dc2626';
const VERDE = '#16a34a';
const GRIS = '#4b5563';
const TOP_MAPA = 10;
const ANGOSTO = matchMedia('(max-width: 640px)');
// Rótulo del rojo en el mapa, pedido por el usuario (ADR 0007): diferencia negativa de la lista 1.
const VOTO_CRUZADO = 'Voto cruzado a lista 3';
const TOP_AGRUPADAS = 20;
// Celular: los gráficos muestran por defecto los 20 locales más negativos (la descarga sigue siendo completa).
const TOP_MOVIL = 20;
const COLUMNAS_CSV = ['local', 'barrio', 'int_L1', 'junta_L1', 'dif_L1', 'dif_L1_%', 'int_L3', 'junta_L2+L3', 'dif_AL', 'dif_AL_%',
    'grupo con mayor negativo', 'zona_tsje', 'zona_municipal', 'codigo_local', 'mesas', 'emitidos', 'tramo_L1', 'tramo_AL',
    'ambos_negativos', 'grupo con mayor negativo (%)'];
const fmt = new Intl.NumberFormat('es-PY');
const pct1 = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const $ = (id) => document.getElementById(id);

function el(tag, clase, texto) {
    const nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto !== undefined && texto !== null) nodo.textContent = String(texto);
    return nodo;
}

// Tramos sobre la diferencia en %: separaciones de 5, 10 y 20 puntos a cada lado de cero (límites hacia cero).
export function tramo(p) {
    if (p === null || p === undefined) return '';
    if (p <= -20) return TRAMOS[0];
    if (p <= -10) return TRAMOS[1];
    if (p <= -5) return TRAMOS[2];
    if (p < 5) return TRAMOS[3];
    if (p < 10) return TRAMOS[4];
    if (p < 20) return TRAMOS[5];
    return TRAMOS[6];
}

const signo = (n) => `${n > 0 ? '+' : ''}${fmt.format(n)}`;
const signoPct = (p) => (p === null ? '—' : `${p > 0 ? '+' : ''}${pct1.format(p)} %`);
const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function grupoMasNegativo(f, campo) {
    const negativos = GRUPOS.filter((g) => f.grupos[g.id][campo] !== null && f.grupos[g.id][campo] < 0);
    if (!negativos.length) return 'Ninguno';
    if (negativos.length === 1) return negativos[0].nombre;
    const peor = negativos.reduce((a, b) => (f.grupos[b.id][campo] < f.grupos[a.id][campo] ? b : a));
    return `Ambos (más negativo: ${peor.nombre})`;
}

// Suma por local de las mesas con acta: votos del Intendente y de la(s) lista(s) de Junta de cada grupo.
export function construirFilas(datos) {
    const c1 = datos.mesas.cargos['1'], c2 = datos.mesas.cargos['2'];
    const indices = (cargo, numeros) => numeros.map((n) => {
        const i = cargo.listas.indexOf(n);
        if (i < 0) throw new Error(`Lista ${n} ausente en los datos`);
        return i;
    });
    const grupos = GRUPOS.map((g) => {
        const ii = indices(c1, g.intendencia), jj = indices(c2, g.junta);
        return { ...g, ii, jj, candidatura: datos.listas['1'][ii[0]], juntas: jj.map((j) => datos.listas['2'][j]) };
    });
    const porLocal = new Map();
    datos.mesas.mesas.forEach(([zona, local], k) => {
        const clave = `${zona}-${local}`;
        let f = porLocal.get(clave);
        if (!f) {
            const info = datos.infoLocal.get(clave);
            f = { clave, zona, local, nombre: info.nombre, barrio: info.barrio ?? '', zonaMunicipal: info.zona_municipal ?? null,
                  mesas: 0, emitidos: 0, grupos: {} };
            for (const g of grupos) f.grupos[g.id] = { int: 0, jun: 0, porLista: g.jj.map(() => 0) };
            porLocal.set(clave, f);
        }
        f.mesas += 1;
        f.emitidos += c1.emitidos[k];
        for (const g of grupos) {
            const r = f.grupos[g.id];
            for (const i of g.ii) r.int += c1.votos[k][i];
            g.jj.forEach((j, n) => {
                r.porLista[n] += c2.votos[k][j];
                r.jun += c2.votos[k][j];
            });
        }
    });
    // Por mesa, para el mapa: votos del Intendente y de la Junta de cada grupo, diferencia y %.
    const mesas = {};
    for (const g of grupos) {
        const int = c1.votos.map((v) => g.ii.reduce((a, i) => a + v[i], 0));
        const jun = c2.votos.map((v) => g.jj.reduce((a, j) => a + v[j], 0));
        mesas[g.id] = { int, jun, dif: int.map((x, k) => x - jun[k]), pct: int.map((x, k) => (jun[k] ? (100 * (x - jun[k])) / jun[k] : null)) };
    }
    const filas = [...porLocal.values()];
    for (const f of filas) {
        for (const g of grupos) {
            const r = f.grupos[g.id];
            r.dif = r.int - r.jun;
            r.pct = r.jun ? (100 * r.dif) / r.jun : null;
            r.tramo = tramo(r.pct);
        }
        f.grupoNegativo = grupoMasNegativo(f, 'dif');
        f.grupoNegativoPct = grupoMasNegativo(f, 'pct');
        f.ambosNegativos = grupos.every((g) => f.grupos[g.id].dif < 0);
    }
    return { grupos, filas, mesas };
}

function colores() {
    const css = getComputedStyle(document.documentElement);
    const leer = (nombre, defecto) => css.getPropertyValue(nombre).trim() || defecto;
    return { texto: leer('--text', '#0f172a'), suave: leer('--text-muted', '#64748b'), borde: leer('--border', '#e2e8f0'),
             fondo: leer('--surface-solid', '#ffffff') };
}

const conAlfa = (hex, alfa) => `${hex}${Math.round(alfa * 255).toString(16).padStart(2, '0')}`;

function descargar(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const enlace = el('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Encabezado de fila: el nombre va en un span para poder cortarlo en dos renglones en pantallas angostas.
function celdaNombre(texto, clase) {
    const th = el('th', clase);
    th.scope = 'row';
    th.append(el('span', 'tabla__nombre', texto));
    return th;
}

// forma: la del símbolo de los puntos del mapa (rombo: diferencia positiva; cuadrado: sin diferencia).
function itemLeyenda(color, texto, clase, forma) {
    const li = el('li', clase);
    const muestra = el('span', `leyenda__muestra${forma && forma !== 'circulo' ? ` leyenda__muestra--${forma}` : ''}`);
    if (color) muestra.style.background = color;
    li.append(muestra, el('span', null, texto));
    return li;
}

export function crearIntendenteJunta(datos, herramientas) {
    const modelo = construirFilas(datos);
    // Filtro de zona o barrio: el propio (vista informe) o el de la página que lo contiene (Análisis), que lo aplica
    // con aplicarEnlace. Fuente: nombre y momento para los textos y la descarga.
    const idFiltro = herramientas.idFiltro ?? 'filtroIvj';
    const filtroExterno = Boolean(herramientas.idFiltro);
    const fuente = herramientas.fuente ?? { nombre: 'TREP preliminar', momento: `corte ${datos.resumen.eleccion.corte}` };
    const estado = { grupo: 'L1', metrica: 'votos', vista: 'divergentes', filtro: '', busqueda: '', orden: null, local: null,
                     todos: false, ambos: 'L1', minEmitidos: 0, mapaGrupo: 'L1' };
    let mapa = null;
    // El mapa en Análisis (ADR-032): sigue al grupo elegido (con «ambos», la Lista 1 o la Alianza con su botón) y tiene un
    // deslizador de votos emitidos por mesa que quita del mapa las mesas con menos votos. La vista informe del TREP no pasa
    // estas opciones: conserva el mapa de la lista 1 sin deslizador.
    const mapaPorGrupo = Boolean(herramientas.mapaPorGrupo);
    const conDeslizador = Boolean(herramientas.deslizadorEmitidos);
    const emitidosMesa = datos.mesas.cargos['1'].emitidos;
    const maxEmitidos = emitidosMesa.reduce((m, v) => (v !== null && v > m ? v : m), 0);
    let controlesMapa = null;
    let graficos = [];
    let turno = 0;
    let preparado = false;

    const grupoPor = (id) => modelo.grupos.find((g) => g.id === id);
    const grupoDelMapa = () => (!mapaPorGrupo ? 'L1' : estado.grupo === 'ambos' ? estado.mapaGrupo : estado.grupo);
    // El rojo del mapa: en la lista 1, el «voto cruzado a lista 3» (ADR 0007); en la Alianza, su diferencia negativa.
    const rojoDe = (id) => (id === 'L1' ? { titulo: VOTO_CRUZADO, texto: VOTO_CRUZADO.toLowerCase() }
        : { titulo: 'Diferencia negativa de la Alianza', texto: 'diferencia negativa de la Alianza' });
    const gruposVista = () => (estado.grupo === 'ambos' ? modelo.grupos : [grupoPor(estado.grupo)]);
    const metrica = (f, g) => (estado.metrica === 'pct' ? f.grupos[g.id].pct : f.grupos[g.id].dif);
    const ascendente = (a, b) => (a === null) - (b === null) || a - b;

    function enFiltro(f) {
        const v = estado.filtro;
        if (!v) return true;
        if (v.startsWith('t')) return String(f.zona) === v.slice(1);
        if (v.startsWith('m')) return String(f.zonaMunicipal) === v.slice(1);
        return f.barrio === v.slice(2);
    }

    const enAmbito = () => modelo.filas.filter(enFiltro);
    const filtradas = () => {
        const buscado = normalizar(estado.busqueda.trim());
        return enAmbito().filter((f) => !buscado || normalizar(f.nombre).includes(buscado));
    };

    // Orden de gráfico y tabla: la diferencia más negativa primero, del grupo elegido o la menor de los dos.
    const clave = (f) => Math.min(...gruposVista().map((g) => metrica(f, g) ?? Infinity));
    const ordenGrafico = (filas) => [...filas].sort((a, b) => ascendente(clave(a), clave(b)));

    function textoAmbito() {
        const opcion = $(idFiltro).selectedOptions[0];
        return estado.filtro && opcion ? opcion.textContent : 'Toda Asunción';
    }

    function preparar() {
        if (preparado) return;
        preparado = true;
        const select = $(idFiltro);
        const grupo = (etiqueta, opciones) => {
            const og = el('optgroup');
            og.label = etiqueta;
            for (const [valor, texto] of opciones) og.append(new Option(texto, valor));
            select.append(og);
        };
        if (!filtroExterno) {
            grupo('Zonas electorales (TSJE)', Object.entries(datos.resumen.zonas).map(([k, n]) => [`t${k}`, `Zona TSJE ${k} · ${n}`]));
            grupo('Zonas municipales (oficiales)', Object.entries(datos.resumen.zonas_municipales).map(([k, n]) => [`m${k}`, `Zona municipal ${k} · ${n}`]));
            grupo('Barrios', [...new Set(modelo.filas.map((f) => f.barrio).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
                .map((b) => [`b:${b}`, b]));
        }
        const segmentos = (atributo, campo) => {
            for (const boton of document.querySelectorAll(`[${atributo}]`)) {
                boton.addEventListener('click', () => {
                    estado[campo] = boton.getAttribute(atributo);
                    estado.orden = null;
                    render();
                    herramientas.alCambiar?.();  // Solo los cambios del usuario van al hash; la carga no lo escribe.
                });
            }
        };
        segmentos('data-ivj-grupo', 'grupo');
        segmentos('data-ivj-metrica', 'metrica');
        segmentos('data-ivj-vista', 'vista');
        // Solo en celular: un gráfico por vez en «Ambos» y el paso entre los 20 más negativos y todos los locales.
        for (const boton of document.querySelectorAll('[data-ivj-ambos]')) {
            boton.addEventListener('click', () => { estado.ambos = boton.dataset.ivjAmbos; renderGraficos(filtradas()); });
        }
        $('ivjTodos').addEventListener('click', () => { estado.todos = !estado.todos; renderGraficos(filtradas()); });
        ANGOSTO.addEventListener('change', () => { if (!$('panelIvj').hidden) renderGraficos(filtradas()); });
        if (!filtroExterno) select.addEventListener('change', () => { estado.filtro = select.value; render(); });
        let espera;
        $('buscarIvj').addEventListener('input', (evento) => {
            clearTimeout(espera);
            espera = setTimeout(() => { estado.busqueda = evento.target.value; render(); }, 200);
        });
        $('tablaIvj').addEventListener('click', (evento) => {
            const columna = evento.target.closest('[data-columna]')?.dataset.columna;
            if (!columna) return;
            estado.orden = estado.orden?.id === columna ? { id: columna, dir: -estado.orden.dir } : { id: columna, dir: 1 };
            renderTabla(filtradas());
        });
        $('rankingIvj').addEventListener('click', (evento) => {
            const local = evento.target.closest('[data-local]')?.dataset.local;
            if (local) elegirLocal(local);
        });
        $('mesasIvj').addEventListener('click', (evento) => {
            if (evento.target.closest('[data-cerrar]')) elegirLocal(null);
        });
        $('csvIvj').addEventListener('click', descargarCsv);
        $('pngIvj').addEventListener('click', descargarPng);
        // Al cambiar el tema del sitio, los gráficos se vuelven a dibujar con sus colores.
        new MutationObserver(() => { if (!$('panelIvj').hidden) render(); })
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    function renderTotales(filas) {
        const caja = $('totalesIvj');
        caja.replaceChildren();
        for (const g of modelo.grupos) {
            const int = filas.reduce((a, f) => a + f.grupos[g.id].int, 0);
            const jun = filas.reduce((a, f) => a + f.grupos[g.id].jun, 0);
            const dif = int - jun;
            const negativos = filas.filter((f) => f.grupos[g.id].dif < 0).length;
            const tarjeta = el('div', 'ivj__tarjeta');
            tarjeta.dataset.grupo = g.id;
            const valor = el('strong', `ivj__valor ${dif < 0 ? 'es-negativa' : 'es-positiva'}`, `${signo(dif)} votos`);
            valor.dataset.valor = String(dif);
            tarjeta.append(el('h3', null, `${g.nombre}: ${g.rotuloInt} − ${g.rotuloJun}`), valor,
                el('span', 'ivj__detalle', `${signoPct(jun ? (100 * dif) / jun : null)} sobre la Junta · Intendente ${fmt.format(int)} · Junta ${fmt.format(jun)}`),
                el('span', 'ivj__detalle', `${fmt.format(negativos)} de ${fmt.format(filas.length)} locales con diferencia negativa`));
            caja.append(tarjeta);
        }
        const distrito = el('div', 'ivj__tarjeta');
        distrito.dataset.grupo = 'distrito';
        distrito.append(el('h3', null, textoAmbito()),
            el('strong', 'ivj__valor', `${fmt.format(filas.length)} locales`),
            el('span', 'ivj__detalle', `${fmt.format(filas.reduce((a, f) => a + f.mesas, 0))} mesas con acta · ${fmt.format(filas.reduce((a, f) => a + f.emitidos, 0))} votos emitidos`),
            el('span', 'ivj__detalle', `Locales con los dos grupos negativos: ${fmt.format(filas.filter((f) => f.ambosNegativos).length)}`));
        caja.append(distrito);
    }

    function renderTramos(filas) {
        const tabla = $('tramosIvj');
        tabla.replaceChildren();
        const cabeza = el('tr');
        ['Tramo de la diferencia (%)', ...modelo.grupos.map((g) => `${g.nombre} (locales)`)].forEach((texto, k) => {
            const th = el('th', k ? null : 'tabla__texto', texto);
            th.scope = 'col';
            cabeza.append(th);
        });
        tabla.createTHead().append(cabeza);
        const cuerpo = tabla.createTBody();
        for (const t of TRAMOS) {
            const tr = el('tr');
            tr.append(celdaNombre(t), ...modelo.grupos.map((g) => el('td', null, fmt.format(filas.filter((f) => f.grupos[g.id].tramo === t).length))));
            cuerpo.append(tr);
        }
    }

    const COLUMNAS = [
        { id: 'nombre', titulo: 'Local', texto: true, v: (f) => f.nombre },
        { id: 'barrio', titulo: 'Barrio', texto: true, v: (f) => f.barrio },
        ...GRUPOS.flatMap((g) => [
            { id: `int_${g.id}`, titulo: g.id === 'L1' ? 'Int. L1' : 'Int. L3', v: (f) => f.grupos[g.id].int },
            { id: `jun_${g.id}`, titulo: g.id === 'L1' ? 'Junta L1' : 'Junta L2+L3', v: (f) => f.grupos[g.id].jun },
            { id: `dif_${g.id}`, titulo: `Dif. ${g.id}`, v: (f) => f.grupos[g.id].dif, dif: true },
            { id: `pct_${g.id}`, titulo: `Dif. ${g.id} %`, v: (f) => f.grupos[g.id].pct, dif: true, pct: true },
        ]),
        { id: 'grupo', titulo: 'Grupo con mayor negativo', texto: true, v: (f) => f.grupoNegativo },
        ...GRUPOS.map((g) => ({ id: `tramo_${g.id}`, titulo: `Tramo ${g.id}`, texto: true, v: (f) => f.grupos[g.id].tramo })),
    ];

    function ordenadas(filas) {
        if (!estado.orden) return ordenGrafico(filas);
        const col = COLUMNAS.find((c) => c.id === estado.orden.id);
        return [...filas].sort((a, b) => {
            const va = col.v(a), vb = col.v(b);
            return estado.orden.dir * (col.texto ? String(va).localeCompare(String(vb), 'es') : ascendente(va, vb));
        });
    }

    function renderTabla(filas) {
        const tabla = $('tablaIvj');
        const cabeza = el('tr');
        for (const col of COLUMNAS) {
            const th = el('th', col.texto ? 'tabla__texto' : null);
            th.scope = 'col';
            const boton = el('button', 'tabla__orden', col.titulo);
            boton.type = 'button';
            boton.dataset.columna = col.id;
            if (estado.orden?.id === col.id) th.setAttribute('aria-sort', estado.orden.dir > 0 ? 'ascending' : 'descending');
            th.append(boton);
            cabeza.append(th);
        }
        tabla.tHead.replaceChildren(cabeza);
        const fragmento = document.createDocumentFragment();
        for (const f of ordenadas(filas)) {
            const tr = el('tr');
            tr.dataset.local = f.clave;
            for (const col of COLUMNAS) {
                const v = col.v(f);
                const texto = col.pct ? signoPct(v) : col.dif ? signo(v) : typeof v === 'number' ? fmt.format(v) : v;
                const clase = [col.texto ? 'tabla__texto' : '', col.dif && v < 0 ? 'es-negativa' : ''].join(' ').trim() || null;
                tr.append(col.id === 'nombre' ? celdaNombre(texto, clase) : el('td', clase, texto));
            }
            fragmento.append(tr);
        }
        tabla.tBodies[0].replaceChildren(fragmento);
        tabla.dataset.filas = String(filas.length);
        $('notaIvj').textContent = `${fmt.format(filas.length)} locales. Diferencias = votos del Intendente − votos de su(s) lista(s) de Junta; ` +
            '% sobre la Junta del grupo. Rojo: diferencia negativa. Tocá un encabezado para ordenar. Es una comparación entre totales de mesa: ' +
            'no identifica cómo votó cada persona.';
    }

    // --- Mapa de voto cruzado (lista 1) ------------------------------------------------------

    function elegirLocal(clave) {
        estado.local = estado.local === clave ? null : clave;
        renderMapa(filtradas());
        renderMesasLocal();
        sincronizarFicha(true);
        herramientas.alCambiar?.();
    }

    // Enlace compartible (lo arma la página): grupo, métrica, tipo de gráfico y local elegido; con filtro externo, también él.
    const estadoEnlace = () => ({ grupo: estado.grupo, metrica: estado.metrica, grafico: estado.vista, local: estado.local,
                                  emitidos: estado.minEmitidos, grupoMapa: estado.mapaGrupo });

    function aplicarEnlace({ grupo, metrica, grafico, local, filtro, emitidos, grupoMapa }) {
        if (filtroExterno) estado.filtro = filtro ?? '';
        estado.grupo = ['L1', 'AL', 'ambos'].includes(grupo) ? grupo : 'L1';
        estado.metrica = ['votos', 'pct'].includes(metrica) ? metrica : 'votos';
        estado.vista = ['divergentes', 'agrupadas'].includes(grafico) ? grafico : 'divergentes';
        estado.local = local && modelo.filas.some((f) => f.clave === local) ? local : null;
        // El mínimo de votos emitidos: un entero entre 0 y el máximo de una mesa (lo demás vuelve a 0).
        const minimo = Number(emitidos);
        estado.minEmitidos = conDeslizador && Number.isInteger(minimo) && minimo > 0 ? Math.min(minimo, maxEmitidos) : 0;
        estado.mapaGrupo = grupoMapa === 'AL' ? 'AL' : 'L1';
        estado.orden = null;
    }

    // Sobre el mapa (la caja está en la plantilla de Análisis): los botones del grupo del mapa (solo con «ambos») y el
    // deslizador de votos emitidos por mesa.
    function armarControlesMapa() {
        const caja = $('controlesMapaIvj');
        if (controlesMapa || !caja || !(conDeslizador || mapaPorGrupo)) return;
        if (mapaPorGrupo) {
            const grupo = el('div', 'segmentos ivj__mapa-grupo');
            grupo.id = 'mapaGrupoIvj';
            grupo.setAttribute('role', 'group');
            grupo.setAttribute('aria-label', 'Grupo que muestra el mapa');
            for (const g of modelo.grupos) {
                const boton = el('button', null, `Mapa: ${g.nombre}`);
                boton.type = 'button';
                boton.dataset.ivjMapa = g.id;
                boton.addEventListener('click', () => {
                    estado.mapaGrupo = g.id;
                    renderMapa(filtradas());
                    herramientas.alCambiar?.();
                });
                grupo.append(boton);
            }
            caja.append(grupo);
        }
        if (conDeslizador) {
            const control = el('div', 'deslizador ivj__deslizador');
            const etiqueta = el('label', 'deslizador__etiqueta');
            const rango = el('input', 'deslizador__rango');
            rango.type = 'range';
            rango.id = 'minEmitidosIvj';
            rango.min = '0';
            rango.max = String(maxEmitidos);
            rango.step = '1';
            etiqueta.htmlFor = rango.id;
            const valor = el('output', 'deslizador__valor');
            valor.id = 'valorMinEmitidosIvj';
            valor.setAttribute('for', rango.id);
            etiqueta.append('Mesas con al menos ', valor, ' votos emitidos');
            const extremos = el('p', 'deslizador__extremos');
            extremos.append(el('span', null, '0'), el('span', null, fmt.format(maxEmitidos)));
            const cuenta = el('p', 'deslizador__cuenta');
            cuenta.id = 'cuentaMinEmitidosIvj';
            cuenta.setAttribute('aria-live', 'polite');
            control.append(etiqueta, rango, extremos, cuenta);
            // Mientras se arrastra, el mapa se vuelve a pintar una vez por cuadro; al soltar, el valor va al enlace.
            let cuadro = 0;
            rango.addEventListener('input', () => {
                estado.minEmitidos = Number(rango.value);
                cuadro ||= requestAnimationFrame(() => { cuadro = 0; renderMapa(filtradas()); });
            });
            rango.addEventListener('change', () => herramientas.alCambiar?.());
            caja.append(control);
        }
        controlesMapa = caja;
    }

    // Ficha inferior (celular, tablet, mapa en pantalla completa): diferencias del local sin mover la página.
    function contenidoFicha(f) {
        const info = datos.infoLocal.get(f.clave);
        const cuerpo = el('dl', 'ficha__resumen');
        for (const g of modelo.grupos) {
            const r = f.grupos[g.id];
            const grupo = el('div');
            grupo.dataset.grupo = g.id;
            const valor = el('dd');
            valor.append(el('strong', r.dif < 0 ? 'es-negativa' : r.dif > 0 ? 'es-positiva' : null, `${signo(r.dif)} votos (${signoPct(r.pct)})`),
                ` · ${g.rotuloInt} ${fmt.format(r.int)} · ${g.rotuloJun} ${fmt.format(r.jun)}`);
            grupo.append(el('dt', null, g.id === 'L1' && r.dif < 0 ? `${g.nombre}: ${VOTO_CRUZADO.toLowerCase()}` : `${g.nombre}: ${g.rotuloInt} − ${g.rotuloJun}`), valor);
            cuerpo.append(grupo);
        }
        return {
            eyebrow: 'Intendente vs Junta · local de votación', titulo: f.nombre,
            meta: [f.barrio ? `Barrio ${f.barrio}` : null, `Zona TSJE ${f.zona} (${info.zona_nombre})`,
                f.zonaMunicipal === null ? null : `Zona municipal ${f.zonaMunicipal} (${datos.resumen.zonas_municipales[f.zonaMunicipal]})`,
                `${fmt.format(f.mesas)} ${f.mesas === 1 ? 'mesa' : 'mesas'} · ${fmt.format(f.emitidos)} votos emitidos`].filter(Boolean).join(' · '),
            cuerpo,
            detalle: () => {
                salirDePantallaCompleta();
                $('mesasIvj').scrollIntoView({ block: 'start', behavior: herramientas.movimiento() });
            },
        };
    }

    // abrir: el local se acaba de tocar. Sin abrir, solo se actualiza (o se cierra) la ficha que esta sección ya abrió.
    function sincronizarFicha(abrir = false) {
        const { ficha, usarFicha } = herramientas;
        const propia = ficha.abierta() && ficha.propietario() === 'ivj';
        const f = modelo.filas.find((x) => x.clave === estado.local);
        if (f && ((abrir && usarFicha()) || propia)) ficha.abrir(contenidoFicha(f), 'ivj');
        else if (propia) ficha.cerrar({ devolverFoco: false });
    }

    // Encuadre: los locales del filtro o de la búsqueda; sin filtro, el distrito.
    function localesEncuadre(filas) {
        return (!estado.filtro && !estado.busqueda.trim()) || !filas.length ? null : filas.map((f) => f.clave);
    }

    function renderMapa(filas) {
        if (!mapa) {
            mapa = herramientas.crearMapa('mapaIvj', mapaPorGrupo ? 'Mapa de Asunción: diferencia entre el Intendente y la Junta del grupo elegido, por mesa'
                : `Mapa de Asunción: ${VOTO_CRUZADO.toLowerCase()} por mesa (diferencia negativa de la lista 1)`, elegirLocal);
            armarControlesMapa();
        }
        const idMapa = grupoDelMapa();
        const g = grupoPor(idMapa);
        const rojo = rojoDe(idMapa);
        if (mapaPorGrupo) {
            $('tituloMapaIvj').textContent = idMapa === 'L1' ? 'Mapa: voto cruzado de la lista 1 a la lista 3'
                : `Mapa: ${g.rotuloInt} frente a la ${g.rotuloJun} (Alianza)`;
        }
        const enPct = estado.metrica === 'pct';
        const porMesa = modelo.mesas[idMapa];
        const valorMesa = (i) => (enPct ? porMesa.pct[i] : porMesa.dif[i]);
        const formato = (v) => (enPct ? signoPct(v) : `${signo(v)} votos`);
        const visibles = new Set(filas.map((f) => f.clave));
        // Las mesas con menos votos emitidos que el mínimo del deslizador no se dibujan ni cuentan en la leyenda. Los quintiles
        // salen de todas las mesas del filtro: al mover el deslizador los colores no cambian, solo se quitan puntos.
        const minimo = conDeslizador ? estado.minEmitidos : 0;
        const alcanza = (i) => !minimo || (emitidosMesa[i] ?? 0) >= minimo;
        const negativos = datos.filas.filter((f) => visibles.has(f.clave)).map((f) => valorMesa(f.i))
            .filter((v) => v !== null && v < 0).map((v) => -v);
        const { cortes, clase } = negativos.length ? herramientas.cuantiles(negativos) : { cortes: [], clase: () => 0 };
        const conteo = new Array(5).fill(0);
        let positivas = 0, ceros = 0;
        const porClave = new Map(modelo.filas.map((f) => [f.clave, f]));
        const textoLocal = new Map([...porClave].map(([clave, f]) => {
            const r = f.grupos[idMapa];
            return [clave, `${f.nombre} · ${r.dif < 0 ? rojo.texto : `diferencia de ${idMapa === 'L1' ? 'la lista 1' : 'la Alianza'}`}: ` +
                `${signo(r.dif)} votos (${signoPct(r.pct)}) · ${g.rotuloInt} ${fmt.format(r.int)} · ${g.rotuloJun} ${fmt.format(r.jun)}`];
        }));
        let mesasFiltro = 0, mesasOcultas = 0;
        mapa.pintarMesas(({ i, clave }) => {
            const visible = visibles.has(clave);
            if (visible) mesasFiltro += 1;
            if (!alcanza(i)) {
                if (visible) mesasOcultas += 1;
                return null;
            }
            const v = valorMesa(i);
            if (visible) {
                if (v !== null && v < 0) conteo[clase(-v)] += 1;
                else if (v > 0) positivas += 1;
                else ceros += 1;
            }
            // Daltonismo: rojo y verde se distinguen también por la forma.
            return { color: v !== null && v < 0 ? herramientas.mezclar(ROJO, herramientas.opacidadPaso(clase(-v))) : v > 0 ? VERDE : GRIS,
                     forma: v !== null && v < 0 ? 'circulo' : v > 0 ? 'rombo' : 'cuadrado', atenuado: !visible,
                     seleccionada: clave === estado.local, texto: textoLocal.get(clave) };
        });
        mapa.marcar?.(estado.local);
        mapa.encuadrarLocales(localesEncuadre(filas));
        // Locales con mayor diferencia negativa dentro del filtro y la búsqueda, numerados (con todas sus mesas).
        const valorLocal = (f) => (enPct ? f.grupos[idMapa].pct : f.grupos[idMapa].dif);
        const ranking = filas.filter((f) => valorLocal(f) !== null && valorLocal(f) < 0)
            .sort((a, b) => valorLocal(a) - valorLocal(b)).slice(0, TOP_MAPA);
        mapa.pintarRanking(ranking.map((f, k) => ({ clave: f.clave, puesto: k + 1, texto: `${k + 1}. ${f.nombre}: ${formato(valorLocal(f))}` })));
        const leyenda = $('leyendaMapaIvj');
        leyenda.replaceChildren(itemLeyenda(ROJO, `${rojo.titulo}: el ${g.rotuloInt} obtuvo menos votos que la ${g.rotuloJun}`, 'leyenda__titulo'));
        for (let k = 0; k < (negativos.length ? 5 : 0); k++) {
            const rango = enPct ? `${signoPct(-cortes[k])} a ${signoPct(-cortes[k + 1])}` : `${signo(-cortes[k])} a ${signo(-cortes[k + 1])} votos`;
            leyenda.append(itemLeyenda(herramientas.mezclar(ROJO, herramientas.opacidadPaso(k)), `${rango} · ${fmt.format(conteo[k])} ${conteo[k] === 1 ? 'mesa' : 'mesas'}`));
        }
        if (positivas) leyenda.append(itemLeyenda(VERDE, `Diferencia positiva (el ${g.rotuloInt} superó a su Junta) · ${fmt.format(positivas)} ${positivas === 1 ? 'mesa' : 'mesas'}`, null, 'rombo'));
        if (ceros) leyenda.append(itemLeyenda(GRIS, `Sin diferencia · ${fmt.format(ceros)} ${ceros === 1 ? 'mesa' : 'mesas'}`, null, 'cuadrado'));
        if (ranking.length) leyenda.append(itemLeyenda(null, `Círculo numerado: ${cantidadLocales(ranking.length)} con más ${rojo.texto}`, 'leyenda__anillo'));
        leyenda.append(itemLeyenda(null, 'Contorno: zonas municipales oficiales', 'leyenda__contorno'));
        const caja = $('rankingIvj');
        caja.replaceChildren(el('h3', null, `Locales con más ${rojo.texto}`));
        if (ranking.length) {
            const ol = el('ol');
            for (const f of ranking) {
                const boton = el('button', 'ranking__boton');
                boton.type = 'button';
                boton.dataset.local = f.clave;
                boton.dataset.valor = String(valorLocal(f));
                boton.title = `${g.rotuloInt}: ${fmt.format(f.grupos[idMapa].int)} · ${g.rotuloJun}: ${fmt.format(f.grupos[idMapa].jun)}`;
                boton.append(el('span', 'ranking__nombre', f.nombre), el('span', 'ranking__valor', formato(valorLocal(f))));
                const li = el('li');
                li.append(boton);
                ol.append(li);
            }
            caja.append(ol);
        } else {
            caja.append(el('p', 'nota', `No hay locales con ${rojo.texto} en el filtro o la búsqueda.`));
        }
        // Los controles de arriba del mapa: el grupo (solo con «ambos») y el deslizador con la cuenta de las mesas que quedan.
        if (controlesMapa) {
            const botones = $('mapaGrupoIvj');
            if (botones) {
                botones.hidden = estado.grupo !== 'ambos';
                for (const b of botones.querySelectorAll('[data-ivj-mapa]')) b.setAttribute('aria-pressed', String(b.dataset.ivjMapa === idMapa));
            }
            const rango = $('minEmitidosIvj');
            if (rango) {
                rango.value = String(minimo);
                $('valorMinEmitidosIvj').value = fmt.format(minimo);
                rango.setAttribute('aria-valuetext', `al menos ${fmt.format(minimo)} votos emitidos`);
                const donde = estado.busqueda.trim() ? ' del filtro y la búsqueda' : estado.filtro ? ' del filtro' : '';
                $('cuentaMinEmitidosIvj').textContent = `Se ven ${fmt.format(mesasFiltro - mesasOcultas)} de ${fmt.format(mesasFiltro)} mesas${donde}` +
                    (mesasOcultas ? `; ${fmt.format(mesasOcultas)} con menos de ${fmt.format(minimo)} votos emitidos no se muestran.` : '.');
            }
        }
        $('notaMapaIvj').textContent = `Cada punto es una mesa, dibujada alrededor de su local. Rojo: ${rojo.texto}, es decir, mesas donde el ` +
            `${g.rotuloInt} obtuvo menos votos que la ${g.rotuloJun}; más intenso, mayor diferencia (${enPct ? 'en %' : 'en votos'}, quintiles). ` +
            'Es una lectura de la diferencia: las actas no dicen a qué candidatura fue cada voto, y parte puede haber ido a otras listas o a ' +
            'votos en blanco o nulos. Las mesas con diferencia positiva van en rombo y las sin diferencia en cuadrado. Los círculos numerados marcan ' +
            'los locales con mayor diferencia negativa dentro del filtro. Tocá un local para ver sus mesas.' +
            (minimo ? ` Con el deslizador solo se dibujan las mesas con al menos ${fmt.format(minimo)} votos emitidos (los colores siguen siendo ` +
                'los de todas las mesas del filtro); los gráficos, la tabla y el ranking de locales siguen con todas las mesas.' : '');
    }

    function renderMesasLocal() {
        const caja = $('mesasIvj');
        caja.replaceChildren();
        const f = modelo.filas.find((x) => x.clave === estado.local);
        caja.hidden = !f;
        if (!f) return;
        const cabecera = el('div', 'histograma__detalle-cabecera');
        cabecera.append(el('h4', null, `Mesas de ${f.nombre}${f.barrio ? ` · ${f.barrio}` : ''}`));
        const cerrar = el('button', 'boton-tabla', 'Cerrar');
        cerrar.type = 'button';
        cerrar.dataset.cerrar = 'true';
        cabecera.append(cerrar);
        const tabla = el('table', 'tabla');
        const encabezado = el('tr');
        ['Mesa', 'Int. L1', 'Junta L1', 'Dif. L1', 'Dif. L1 %', 'Int. L3', 'Junta L2+L3', 'Dif. AL', 'Dif. AL %'].forEach((texto, k) => {
            const th = el('th', k ? null : 'tabla__texto', texto);
            th.scope = 'col';
            encabezado.append(th);
        });
        tabla.createTHead().append(encabezado);
        const cuerpo = tabla.createTBody();
        for (const fila of datos.filas.filter((x) => x.clave === f.clave)) {
            const tr = el('tr');
            tr.append(celdaNombre(`Mesa ${fila.mesa}`));
            for (const g of modelo.grupos) {
                const m = modelo.mesas[g.id];
                const dif = m.dif[fila.i], p = m.pct[fila.i];
                tr.append(el('td', null, fmt.format(m.int[fila.i])), el('td', null, fmt.format(m.jun[fila.i])),
                    el('td', dif < 0 ? 'es-negativa' : null, signo(dif)), el('td', p !== null && p < 0 ? 'es-negativa' : null, signoPct(p)));
            }
            cuerpo.append(tr);
        }
        const desplazable = el('div', 'tabla-scroll tabla-scroll--detalle');
        desplazable.append(tabla);
        caja.append(cabecera, desplazable);
    }

    // --- Gráficos (Chart.js) -----------------------------------------------------------------

    async function cargarChart() {
        if (!globalThis.Chart) await import(RUTA_CHART);
        return globalThis.Chart;
    }

    function complementos(c, lineas, rotulo) {
        return [
            { id: 'fondoIvj', beforeDraw(chart) {
                const { ctx, width, height } = chart;
                ctx.save();
                ctx.fillStyle = c.fondo;
                ctx.fillRect(0, 0, width, height);
                ctx.restore();
            } },
            { id: 'lineasIvj', afterDatasetsDraw(chart) {
                const { ctx, chartArea: area, scales: { x } } = chart;
                ctx.save();
                let ultimo = -Infinity;  // Rótulos de tramo sin superponerse: se omite el que cae muy cerca del anterior.
                for (const v of [0, ...lineas]) {
                    if (v < x.min || v > x.max) continue;
                    const px = x.getPixelForValue(v);
                    ctx.strokeStyle = v ? c.suave : c.texto;
                    ctx.lineWidth = v ? 1 : 1.5;
                    ctx.setLineDash(v ? [4, 3] : []);
                    ctx.beginPath();
                    ctx.moveTo(px, area.top);
                    ctx.lineTo(px, area.bottom);
                    ctx.stroke();
                    if (v && Math.abs(px - ultimo) >= 34) {
                        ultimo = px;
                        ctx.fillStyle = c.suave;
                        ctx.font = '600 10px system-ui, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText(`${v > 0 ? '+' : ''}${v} %`, px, area.top - 4);
                    }
                }
                ctx.restore();
            } },
            { id: 'rotulosIvj', afterDatasetsDraw(chart) {
                const { ctx } = chart;
                ctx.save();
                ctx.font = '600 10px system-ui, sans-serif';
                ctx.fillStyle = c.texto;
                ctx.textBaseline = 'middle';
                rotulo(chart, ctx);
                ctx.restore();
            } },
        ];
    }

    const angosto = () => ANGOSTO.matches;
    const recortar = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    // Celular: el nombre del local en hasta dos renglones de 22 caracteres; el nombre completo va en el tooltip.
    function dosRenglones(nombre) {
        if (nombre.length <= 22) return nombre;
        const espacios = [...nombre.matchAll(/[ .-]/g)].map((m) => m.index + 1).filter((i) => i > 4 && i < nombre.length - 3);
        const corte = espacios.length ? espacios.reduce((a, b) => (Math.abs(b - nombre.length / 2) < Math.abs(a - nombre.length / 2) ? b : a)) : 22;
        return [recortar(nombre.slice(0, corte).trim(), 22), recortar(nombre.slice(corte).trim(), 22)];
    }
    // Rótulo del eje: en dos renglones en celular; completo en escritorio y en la descarga.
    const rotuloEje = (nombre, modo) => (modo.compacto ? dosRenglones(nombre) : nombre);

    const pasoRedondo = (x) => {
        const potencia = 10 ** Math.floor(Math.log10(x || 1));
        const m = x / potencia;
        return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * potencia;
    };

    // Eje con límites redondos, espacio para los rótulos y solo las líneas de tramo del lado donde hay datos.
    function rango(valores, posibles, enPct) {
        const finitos = valores.filter((v) => v !== null);
        const minimo = Math.min(0, ...finitos), maximo = Math.max(0, ...finitos);
        const extension = maximo - minimo || 1;
        const margen = extension * 0.16;
        let min = minimo < 0 ? minimo - margen : 0;
        let max = maximo > 0 ? maximo + margen : 0;
        for (const v of posibles) {
            if (v < 0 && minimo < 0 && v >= minimo - 2 * margen) min = Math.min(min, v - extension * 0.02);
            if (v > 0 && maximo > 0 && v <= maximo + 2 * margen) max = Math.max(max, v + extension * 0.02);
        }
        const paso = enPct ? 5 : pasoRedondo(extension / 6);
        min = Math.floor(min / paso) * paso;
        max = Math.ceil(max / paso) * paso;
        return { min, max, lineas: posibles.filter((v) => (v < 0 ? minimo < 0 : maximo > 0) && v > min && v < max) };
    }

    function divergente(Chart, lienzo, filas, g, c, modo = {}) {
        const valores = filas.map((f) => metrica(f, g));
        const enPct = estado.metrica === 'pct';
        const { min, max, lineas } = rango(valores, enPct ? LINEAS_PCT : [], enPct);
        const formato = (v) => (enPct ? signoPct(v) : signo(v));
        const titulo = `${g.nombre}: ${g.rotuloInt} − ${g.rotuloJun}`;
        return new Chart(lienzo, {
            type: 'bar',
            data: { labels: filas.map((f) => f.nombre),
                    datasets: [{ label: `${g.rotuloInt} − ${g.rotuloJun}`, data: valores, backgroundColor: valores.map((v) => (v < 0 ? ROJO : VERDE)),
                                 borderWidth: 0, barPercentage: 0.86, categoryPercentage: 0.92 }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
                ...(modo.exportar ? { devicePixelRatio: 2 } : {}),
                layout: { padding: { top: enPct ? 14 : 4, right: 8 } },
                scales: {
                    x: { min, max, grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => (enPct ? `${v} %` : fmt.format(v)) },
                         title: { display: true, text: enPct ? 'Diferencia (%)' : 'Diferencia (votos)', color: c.suave } },
                    y: { grid: { display: false }, ticks: { color: c.texto, autoSkip: false, font: { size: modo.compacto ? 11 : 10 },
                                                          callback: (_, k) => rotuloEje(filas[k].nombre, modo) } },
                },
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: modo.subtitulo ? [titulo, modo.subtitulo] : titulo, color: c.texto, font: { size: 13, weight: '700' } },
                    tooltip: { callbacks: {
                        title: (items) => { const f = filas[items[0].dataIndex]; return f.barrio ? `${f.nombre} · ${f.barrio}` : f.nombre; },
                        label: (item) => {
                            const r = filas[item.dataIndex].grupos[g.id];
                            return [`${g.rotuloInt}: ${fmt.format(r.int)} votos`, `${g.rotuloJun}: ${fmt.format(r.jun)} votos`,
                                `Diferencia: ${signo(r.dif)} votos (${signoPct(r.pct)})`];
                        },
                    } },
                },
            },
            plugins: complementos(c, lineas, (chart, ctx) => {
                chart.getDatasetMeta(0).data.forEach((barra, k) => {
                    const v = valores[k];
                    if (v === null) return;
                    ctx.textAlign = v < 0 ? 'right' : 'left';
                    ctx.fillText(formato(v), barra.x + (v < 0 ? -4 : 4), barra.y);
                });
            }),
        });
    }

    function agrupado(Chart, lienzo, filas, g, c, modo = {}) {
        const datasets = [
            { label: `${g.rotuloInt} (${g.candidatura.sigla})`, data: filas.map((f) => f.grupos[g.id].int), backgroundColor: g.candidatura.color, stack: 'int' },
            ...g.juntas.map((x, n) => ({ label: `Junta lista ${x.num} (${x.sigla})`, data: filas.map((f) => f.grupos[g.id].porLista[n]),
                                         backgroundColor: conAlfa(x.color, 0.55), stack: 'jun' })),
        ];
        return new Chart(lienzo, {
            type: 'bar',
            data: { labels: filas.map((f) => f.nombre), datasets },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
                ...(modo.exportar ? { devicePixelRatio: 2 } : {}),
                layout: { padding: { right: 8 } },
                scales: {
                    x: { stacked: true, suggestedMax: Math.max(...filas.map((f) => Math.max(f.grupos[g.id].int, f.grupos[g.id].jun))) * 1.3,
                         grid: { color: c.borde }, ticks: { color: c.suave, callback: (v) => fmt.format(v) },
                         title: { display: true, text: 'Votos', color: c.suave } },
                    y: { stacked: true, grid: { display: false }, ticks: { color: c.texto, autoSkip: false,
                                                                         font: { size: modo.compacto ? 11 : 10 },
                                                                         callback: (_, k) => rotuloEje(filas[k].nombre, modo) } },
                },
                plugins: {
                    legend: { display: true, position: 'bottom', labels: { color: c.texto, boxWidth: 12 } },
                    title: { display: true, text: `${g.nombre}: ${cantidadLocales(filas.length)} con la diferencia más negativa`, color: c.texto,
                             font: { size: 13, weight: '700' } },
                    tooltip: { callbacks: {
                        title: (items) => { const f = filas[items[0].dataIndex]; return f.barrio ? `${f.nombre} · ${f.barrio}` : f.nombre; },
                        footer: (items) => { const r = filas[items[0].dataIndex].grupos[g.id]; return `Diferencia: ${signo(r.dif)} votos (${signoPct(r.pct)})`; },
                    } },
                },
            },
            plugins: complementos(c, [], (chart, ctx) => {
                ctx.textAlign = 'left';
                filas.forEach((f, k) => {
                    const fin = Math.max(...chart.data.datasets.map((_, d) => chart.getDatasetMeta(d).data[k]?.x ?? 0));
                    const r = f.grupos[g.id];
                    ctx.fillText(`dif. ${signo(r.dif)} (${signoPct(r.pct)})`, fin + 6, chart.getDatasetMeta(0).data[k].y);
                });
            }),
        });
    }

    const cantidadLocales = (n) => `${fmt.format(n)} ${n === 1 ? 'local' : 'locales'}`;

    // Locales de cada gráfico. Escritorio (y la descarga): divergentes con todos, agrupadas con los 20 más negativos.
    // Celular: los 20 más negativos del grupo y la métrica elegidos en las dos vistas, o todos con «Ver los N locales».
    function filasGrafico(filas, g, compacto) {
        const orden = estado.vista === 'divergentes' && !(compacto && estado.grupo === 'ambos')
            ? ordenGrafico(filas)
            : [...filas].sort((a, b) => ascendente(metrica(a, g), metrica(b, g)));
        if (compacto) return estado.todos ? orden : orden.slice(0, TOP_MOVIL);
        return estado.vista === 'divergentes' ? orden : orden.slice(0, TOP_AGRUPADAS);
    }

    function dibujar(Chart, caja, lienzo, filas, g, c, modo) {
        const alto = modo.compacto ? 28 : 21;
        if (estado.vista === 'divergentes') {
            caja.style.height = `${filas.length * alto + (modo.subtitulo ? 128 : 110)}px`;
            lienzo.setAttribute('aria-label', `Barras divergentes de ${g.nombre}: ${cantidadLocales(filas.length)} ordenados por diferencia`);
            return divergente(Chart, lienzo, filas, g, c, modo);
        }
        caja.style.height = `${filas.length * (alto + 16) + 150}px`;
        lienzo.setAttribute('aria-label', `Barras agrupadas de ${g.nombre}: Intendente frente a Junta en ${cantidadLocales(filas.length)}`);
        return agrupado(Chart, lienzo, filas, g, c, modo);
    }

    function renderControlesMovil(filas) {
        const compacto = angosto();
        $('ivjMovil').hidden = !compacto;
        const ambos = compacto && estado.grupo === 'ambos';
        $('ivjAmbos').hidden = !ambos;
        for (const boton of document.querySelectorAll('[data-ivj-ambos]')) boton.setAttribute('aria-pressed', String(boton.dataset.ivjAmbos === estado.ambos));
        const boton = $('ivjTodos');
        boton.hidden = filas.length <= TOP_MOVIL;
        boton.setAttribute('aria-pressed', String(estado.todos));
        boton.textContent = estado.todos ? `Ver solo los ${TOP_MOVIL} más negativos` : `Ver los ${fmt.format(filas.length)} locales`;
        return { compacto, ambos };
    }

    async function renderGraficos(filas) {
        const miTurno = ++turno;
        const Chart = await cargarChart();
        if (miTurno !== turno) return;
        for (const g of graficos) g.destroy();
        graficos = [];
        const contenedor = $('graficosIvj');
        contenedor.replaceChildren();
        const { compacto, ambos } = renderControlesMovil(filas);
        // En celular, «Ambos» muestra un gráfico por vez, el del grupo elegido con «Lista 1» o «Alianza».
        const vista = ambos ? [grupoPor(estado.ambos)] : gruposVista();
        contenedor.classList.toggle('ivj__graficos--doble', vista.length > 1);
        const leyenda = $('leyendaIvj');
        leyenda.replaceChildren();
        if (!filas.length) {
            contenedor.append(el('p', 'nota', 'Ningún local coincide con el filtro o la búsqueda.'));
            return;
        }
        const c = colores();
        for (const g of vista) {
            const caja = el('div', 'ivj__grafico');
            const lienzo = el('canvas');
            lienzo.setAttribute('role', 'img');
            caja.append(lienzo);
            contenedor.append(caja);
            const propias = filasGrafico(filas, g, compacto);
            const subtitulo = compacto && estado.vista === 'divergentes' && propias.length < filas.length
                ? `${fmt.format(propias.length)} de ${cantidadLocales(filas.length)}, los más negativos` : null;
            graficos.push(dibujar(Chart, caja, lienzo, propias, g, c, { compacto, subtitulo }));
        }
        const item = (color, texto) => {
            const li = el('li');
            const muestra = el('span', 'leyenda__muestra');
            muestra.style.background = color;
            li.append(muestra, el('span', null, texto));
            return li;
        };
        if (estado.vista === 'divergentes') {
            leyenda.append(item(ROJO, 'Negativo: el Intendente obtuvo menos votos que su Junta'), item(VERDE, 'Positivo: el Intendente superó a su Junta'));
            if (estado.metrica === 'pct') leyenda.append(item('transparent', 'Líneas punteadas: separaciones de 5 %, 10 % y 20 %'));
        } else {
            const cuantos = compacto && estado.todos ? `Los ${cantidadLocales(filas.length)}, ordenados por` : `Los ${TOP_AGRUPADAS} locales con`;
            leyenda.append(item('transparent', `${cuantos} la diferencia más negativa del grupo (en ${estado.metrica === 'pct' ? '%' : 'votos'}); ` +
                'la Junta se apila por lista.'));
        }
        if (compacto) leyenda.append(item('transparent', 'Tocá una barra para ver el nombre completo, los votos del Intendente y de la Junta y la diferencia.'));
    }

    // --- Descargas -----------------------------------------------------------------------------

    function nombreArchivo(extension) {
        const ambito = estado.filtro ? normalizar(textoAmbito()).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'asuncion';
        return `intendente_vs_junta_${estado.grupo}_${estado.metrica}_${ambito}.${extension}`;
    }

    function descargarCsv() {
        const celda = (v) => {
            const s = v === null || v === undefined ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const p2 = (v) => (v === null ? '' : v.toFixed(2));
        const lineas = [COLUMNAS_CSV.map(celda).join(',')];
        for (const f of ordenadas(filtradas())) {
            const a = f.grupos.L1, b = f.grupos.AL;
            lineas.push([f.nombre, f.barrio, a.int, a.jun, a.dif, p2(a.pct), b.int, b.jun, b.dif, p2(b.pct), f.grupoNegativo, f.zona,
                f.zonaMunicipal ?? '', f.clave, f.mesas, f.emitidos, a.tramo, b.tramo, f.ambosNegativos ? 'sí' : 'no', f.grupoNegativoPct].map(celda).join(','));
        }
        descargar(new Blob([`﻿${lineas.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), nombreArchivo('csv'));
    }

    // Lienzos para la descarga: en escritorio, los de la pantalla (como antes). En celular, que muestra menos, se dibujan
    // fuera de la pantalla los mismos gráficos que en escritorio: todos los locales filtrados y los dos grupos en «Ambos».
    async function lienzosDescarga() {
        if (!angosto()) return { lienzos: graficos.map((g) => g.canvas), limpiar: () => {} };
        const Chart = await cargarChart();
        const c = colores();
        const filas = filtradas();
        const fuera = el('div', 'ivj__exportacion');
        fuera.setAttribute('aria-hidden', 'true');
        document.body.append(fuera);
        const creados = gruposVista().map((g) => {
            const caja = el('div', 'ivj__grafico');
            const lienzo = el('canvas');
            caja.append(lienzo);
            fuera.append(caja);
            return dibujar(Chart, caja, lienzo, filasGrafico(filas, g, false), g, c, { exportar: true });
        });
        await new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo)));
        return { lienzos: creados.map((g) => g.canvas), limpiar: () => { for (const g of creados) g.destroy(); fuera.remove(); } };
    }

    async function descargarPng() {
        if (!graficos.length) return;
        const { lienzos, limpiar } = await lienzosDescarga();
        const c = colores();
        const escala = window.devicePixelRatio || 1;
        const cabecera = Math.round(64 * escala), separacion = Math.round(16 * escala);
        const ancho = lienzos.reduce((a, l) => a + l.width, 0) + separacion * (lienzos.length + 1);
        const alto = Math.max(...lienzos.map((l) => l.height)) + cabecera + separacion;
        const final = el('canvas');
        final.width = ancho;
        final.height = alto;
        const ctx = final.getContext('2d');
        ctx.fillStyle = c.fondo;
        ctx.fillRect(0, 0, ancho, alto);
        ctx.fillStyle = c.texto;
        ctx.font = `700 ${Math.round(17 * escala)}px system-ui, sans-serif`;
        const grupo = estado.grupo === 'ambos' ? 'Lista 1 y Alianza' : grupoPor(estado.grupo).nombre;
        ctx.fillText(`Intendente vs Junta Municipal · ${grupo} · ${estado.metrica === 'pct' ? 'diferencia en %' : 'diferencia en votos'} · ${textoAmbito()}`,
            separacion, Math.round(28 * escala));
        ctx.fillStyle = c.suave;
        ctx.font = `${Math.round(12 * escala)}px system-ui, sans-serif`;
        ctx.fillText(`Fuente: TSJE, ${fuente.nombre}, actas por mesa, ${fuente.momento}. Kalaguichi.com · descargado el ${new Date().toLocaleDateString('es-PY')}`,
            separacion, Math.round(48 * escala));
        let x = separacion;
        for (const l of lienzos) {
            ctx.drawImage(l, x, cabecera);
            x += l.width + separacion;
        }
        limpiar();
        final.toBlob((blob) => descargar(blob, nombreArchivo('png')), 'image/png');
    }

    async function render() {
        preparar();
        for (const [atributo, valor] of [['data-ivj-grupo', estado.grupo], ['data-ivj-metrica', estado.metrica], ['data-ivj-vista', estado.vista]]) {
            for (const boton of document.querySelectorAll(`[${atributo}]`)) boton.setAttribute('aria-pressed', String(boton.getAttribute(atributo) === valor));
        }
        const ambito = enAmbito();
        const filas = filtradas();
        $('metaIvj').textContent = `${textoAmbito()} · ${cantidadLocales(ambito.length)} · ${fuente.nombre}, ${fuente.momento}`;
        renderTotales(ambito);
        renderTramos(ambito);
        renderTabla(filas);
        renderMapa(filas);
        renderMesasLocal();
        sincronizarFicha();
        await renderGraficos(filas);
        $('panelIvj').dataset.listo = 'true';
    }

    return { render, modelo, estadoEnlace, aplicarEnlace };
}
