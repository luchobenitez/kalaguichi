// Estructura común de las cinco secciones (ADR-016): estado compartido de la página leído y escrito en el hash,
// menú que conserva el contexto, botón de compartir y barra de contexto (Elección › Año › Cargo y estado de la
// fuente) en TREP, Resultados oficiales y Análisis. El tema y el año del pie siguen en sitio.js.
import { vigilarDesplazables } from './desplazables.js';

const PRIMERAS = ['eleccion', 'anio', 'cargo'];
// Secciones que comparten el contexto: sus enlaces del menú llevan el hash de la página actual.
const CON_CONTEXTO = new Set(['trep', 'oficiales', 'analisis']);
const MEMORIA = 'kalaguichi_contexto';
const $ = (id) => document.getElementById(id);

// --- Estado compartido --------------------------------------------------------------------------------------------
// Un solo objeto de estado por página: cualquier panel lo lee, lo cambia y se suscribe a sus cambios. Se guarda en el
// hash con history.replaceState (sin entradas nuevas en el historial).
let valores = leerHash();
const suscriptores = new Set();

function leerHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    return new Map([...p].filter(([, v]) => v !== ''));
}

function textoHash() {
    const orden = [...PRIMERAS.filter((k) => valores.has(k)), ...[...valores.keys()].filter((k) => !PRIMERAS.includes(k))];
    return new URLSearchParams(orden.map((k) => [k, valores.get(k)])).toString();
}

function escribir() {
    const hash = textoHash();
    if (`#${hash}` !== location.hash && (hash || location.hash)) {
        history.replaceState(null, '', `${location.pathname}${location.search}${hash ? `#${hash}` : ''}`);
    }
    recordar();
    actualizarMenu();
}

function avisar(cambiadas, origen) {
    for (const fn of suscriptores) fn({ cambiadas, origen });
}

export const estado = {
    obtener: (clave) => valores.get(clave) ?? null,
    todos: () => Object.fromEntries(valores),
    // cambios: {clave: valor}; null o '' quitan la clave. forzar avisa aunque el valor no cambie (un cargo elegido de nuevo).
    cambiar(cambios, { origen = 'pagina', forzar = false } = {}) {
        const cambiadas = new Set();
        for (const [clave, valor] of Object.entries(cambios)) {
            const nuevo = valor === null || valor === undefined || valor === '' ? null : String(valor);
            if ((valores.get(clave) ?? null) === nuevo) continue;
            if (nuevo === null) valores.delete(clave);
            else valores.set(clave, nuevo);
            cambiadas.add(clave);
        }
        if (cambiadas.size) escribir();
        if (cambiadas.size || forzar) avisar(forzar ? new Set([...cambiadas, ...Object.keys(cambios)]) : cambiadas, origen);
    },
    // El estado completo de una vista (por ejemplo, el del visor): las claves que no figuran se quitan.
    reemplazar(objeto, origen = 'pagina') {
        const nuevo = new Map(Object.entries(objeto).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
        const cambiadas = new Set([...valores.keys(), ...nuevo.keys()].filter((k) => valores.get(k) !== nuevo.get(k)));
        if (!cambiadas.size) return;
        valores = nuevo;
        escribir();
        avisar(cambiadas, origen);
    },
    suscribir(fn) {
        suscriptores.add(fn);
        return () => suscriptores.delete(fn);
    },
};

window.addEventListener('hashchange', () => {
    const antes = valores;
    valores = leerHash();
    recordar();
    actualizarMenu();
    avisar(new Set([...antes.keys(), ...valores.keys()].filter((k) => antes.get(k) !== valores.get(k))), 'hash');
});

// --- Menú con el contexto -----------------------------------------------------------------------------------------
const seccionActual = document.querySelector('.site-nav [aria-current="page"]')?.dataset.seccion ?? null;

function recordar() {
    if (!CON_CONTEXTO.has(seccionActual)) return;
    try {
        sessionStorage.setItem(MEMORIA, textoHash());
    } catch (_) {
        // Sin almacenamiento de sesión, el menú lleva solo el hash de la página actual.
    }
}

function contextoRecordado() {
    if (CON_CONTEXTO.has(seccionActual)) return textoHash();
    try {
        return sessionStorage.getItem(MEMORIA) ?? '';
    } catch (_) {
        return '';
    }
}

// Claves de una vista o de una página que el menú no lleva a otra sección (ADR 0011 del módulo): «TREP» abre siempre el
// tablero, no la vista informe (modo) ni vuelve a Análisis por el análisis elegido allí (analisis=voto-cruzado).
const NO_SE_LLEVAN = { trep: ['modo', 'analisis'], oficiales: ['modo', 'analisis'], analisis: ['modo'] };

function actualizarMenu() {
    const hash = contextoRecordado();
    for (const enlace of document.querySelectorAll('.site-nav a[data-seccion]')) {
        if (!CON_CONTEXTO.has(enlace.dataset.seccion)) continue;
        const contexto = new URLSearchParams(hash);
        for (const clave of NO_SE_LLEVAN[enlace.dataset.seccion] ?? []) contexto.delete(clave);
        const url = new URL(enlace.getAttribute('href'), location.href);
        url.hash = contexto.toString();
        enlace.href = url.href;
    }
}

// --- «Más» (celular): despliega Máquina de votación y Acerca de encima de la barra inferior --------------------------
function menuMas() {
    const boton = document.querySelector('.site-nav__mas');
    const grupo = $('menuMas');
    if (!boton || !grupo) return;
    const abierto = () => grupo.classList.contains('abierto');
    const abrir = (si, { foco = false } = {}) => {
        grupo.classList.toggle('abierto', si);
        boton.setAttribute('aria-expanded', String(si));
        if (si && foco) grupo.querySelector('a')?.focus();
    };
    boton.addEventListener('click', () => abrir(!abierto(), { foco: true }));
    document.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Escape' || !abierto()) return;
        abrir(false);
        boton.focus();
    });
    document.addEventListener('click', (evento) => {
        if (abierto() && !grupo.contains(evento.target) && !boton.contains(evento.target)) abrir(false);
    });
    grupo.addEventListener('focusout', (evento) => {
        if (abierto() && evento.relatedTarget && !grupo.contains(evento.relatedTarget) && evento.relatedTarget !== boton) abrir(false);
    });
    // En pantallas más anchas los dos enlaces vuelven a la fila del menú.
    matchMedia('(min-width: 641px)').addEventListener('change', (consulta) => { if (consulta.matches) abrir(false); });
}

// --- Grupo «Máquina de votación» (escritorio y tablet): el botón despliega sus páginas debajo de él -------------------
// La lista tiene posición fija (el menú de la tablet se desplaza a lo ancho y la recortaría); se ubica al abrirla y se
// cierra con Escape, con un clic afuera, al salir el foco, al desplazar o al cambiar el tamaño. En el celular el botón no
// se ve: las páginas aparecen dentro de «Más».
function grupos() {
    for (const boton of document.querySelectorAll('.site-nav__grupo-boton')) {
        const lista = $(boton.getAttribute('aria-controls'));
        if (!lista) continue;
        const abierto = () => lista.classList.contains('abierto');
        const abrir = (si, { foco = false } = {}) => {
            lista.classList.toggle('abierto', si);
            boton.setAttribute('aria-expanded', String(si));
            if (!si) return;
            const r = boton.getBoundingClientRect();
            lista.style.top = `${Math.round(r.bottom + 6)}px`;
            lista.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - lista.offsetWidth - 8)))}px`;
            if (foco) lista.querySelector('a')?.focus();
        };
        boton.addEventListener('click', (evento) => abrir(!abierto(), { foco: evento.detail === 0 }));
        boton.addEventListener('keydown', (evento) => {
            if (evento.key === 'ArrowDown') {
                evento.preventDefault();
                abrir(true, { foco: true });
            }
        });
        lista.addEventListener('keydown', (evento) => {
            const enlaces = [...lista.querySelectorAll('a')];
            const k = enlaces.indexOf(document.activeElement);
            if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
                evento.preventDefault();
                enlaces[(k + (evento.key === 'ArrowDown' ? 1 : enlaces.length - 1)) % enlaces.length]?.focus();
            }
        });
        document.addEventListener('keydown', (evento) => {
            if (evento.key !== 'Escape' || !abierto()) return;
            abrir(false);
            boton.focus();
        });
        document.addEventListener('click', (evento) => {
            if (abierto() && !lista.contains(evento.target) && !boton.contains(evento.target)) abrir(false);
        });
        lista.addEventListener('focusout', (evento) => {
            if (abierto() && evento.relatedTarget && !lista.contains(evento.relatedTarget) && evento.relatedTarget !== boton) abrir(false);
        });
        for (const nodo of [window, boton.closest('.site-nav')]) nodo?.addEventListener('scroll', () => { if (abierto()) abrir(false); }, { passive: true });
        addEventListener('resize', () => { if (abierto()) abrir(false); });
    }
}

// --- Compartir --------------------------------------------------------------------------------------------------------
function aviso(texto) {
    let nodo = $('avisoGlobal');
    if (!nodo) {
        nodo = document.createElement('p');
        nodo.id = 'avisoGlobal';
        nodo.className = 'aviso-global';
        nodo.setAttribute('role', 'status');
        nodo.setAttribute('aria-live', 'polite');
        document.body.append(nodo);
    }
    nodo.textContent = texto;
    nodo.hidden = !texto;
    clearTimeout(nodo.espera);
    if (texto) nodo.espera = setTimeout(() => { nodo.textContent = ''; nodo.hidden = true; }, 5000);
}

async function compartir() {
    const enlace = location.href;
    if (navigator.share) {
        try {
            await navigator.share({ title: document.title, url: enlace });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }
    }
    try {
        await navigator.clipboard.writeText(enlace);
        aviso('Enlace copiado');
    } catch {
        aviso(`Copiá este enlace: ${enlace}`);
    }
}

// --- Barra de contexto: Elección › Año › Cargo y estado de la fuente -----------------------------------------------
const fmt = new Intl.NumberFormat('es-PY');
// «04/10 23:48» desde «2026-10-04T23:48:02» (hora de Paraguay, sin zona): sin pasar por Date, que la cambiaría.
const fecha = (iso) => {
    const m = /^\d{4}-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
    return m ? `${m[2]}/${m[1]}${m[3] ? ` ${m[3]}:${m[4]}` : ''}` : iso;
};

let contextoActual = null;

// Contexto vigente (elección, año, cargo y fuente) para los módulos de la página.
export const contexto = () => contextoActual;

function cargoElegido(anio) {
    const pedido = estado.obtener('cargo');
    return anio.cargos.includes(pedido) ? pedido : anio.cargos[0];
}

function marcarCargo(anio) {
    const cargo = cargoElegido(anio);
    for (const boton of document.querySelectorAll('#selectorCargo [role="tab"]')) {
        const activo = boton.dataset.cargo === cargo;
        boton.setAttribute('aria-selected', String(activo));
        boton.tabIndex = activo ? 0 : -1;
    }
    if (contextoActual) contextoActual.cargo = cargo;
}

function selectorFijo(contenedor, etiqueta, opciones, actual, alElegir) {
    contenedor.replaceChildren();
    if (opciones.length === 1) {
        contenedor.textContent = opciones[0].texto;
        contenedor.title = etiqueta;
        return;
    }
    const select = document.createElement('select');
    select.setAttribute('aria-label', etiqueta);
    for (const o of opciones) select.append(new Option(o.texto, o.valor, false, o.valor === actual));
    select.addEventListener('change', () => alElegir(select.value));
    contenedor.append(select);
}

async function barraDeContexto(barra) {
    const { manifiesto, elegir, cargarEleccion } = await import('./datos.js');
    const m = await manifiesto();
    const { eleccion, anio } = elegir(m, { eleccion: estado.obtener('eleccion'), anio: estado.obtener('anio') });
    // «elegible» (Análisis): la fuente del hash (fuente=oficial) si está publicada; si no, el TREP.
    const fuente = barra.dataset.fuente === 'elegible'
        ? (estado.obtener('fuente') === 'oficial' && anio.fuentes?.oficial?.estado === 'publicado' ? 'oficial' : 'trep')
        : barra.dataset.fuente || 'trep';
    contextoActual = { eleccion, anio, fuente, cargo: null, manifiesto: m };
    selectorFijo(barra.querySelector('[data-contexto="eleccion"]'), 'Elección',
        m.elecciones.map((e) => ({ valor: e.id, texto: e.nombre })), eleccion.id,
        (valor) => { estado.cambiar({ eleccion: valor, anio: null }, { origen: 'barra' }); location.reload(); });
    selectorFijo(barra.querySelector('[data-contexto="anio"]'), 'Año',
        eleccion.anios.map((a) => ({ valor: String(a.anio), texto: String(a.anio) })), String(anio.anio),
        (valor) => { estado.cambiar({ anio: valor }, { origen: 'barra' }); location.reload(); });
    const selector = $('selectorCargo');
    selector.replaceChildren(...anio.cargos.map((cargo) => {
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.setAttribute('role', 'tab');
        boton.id = `cargo-${anio.claves_cargo?.[cargo] ?? cargo}`;
        boton.dataset.cargo = cargo;
        boton.setAttribute('aria-controls', document.querySelector('main')?.id || 'contenido');
        boton.textContent = anio.etiquetas_cargo?.[cargo] ?? anio.nombres_cargo?.[cargo] ?? cargo;
        boton.title = anio.nombres_cargo?.[cargo] ?? boton.textContent;
        return boton;
    }));
    marcarCargo(anio);
    selector.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-cargo]');
        if (!boton) return;
        estado.cambiar({ cargo: boton.dataset.cargo }, { origen: 'barra', forzar: true });
    });
    // Flechas, Inicio y Fin mueven el foco y eligen el cargo (activación automática).
    selector.addEventListener('keydown', (evento) => {
        const todas = [...selector.querySelectorAll('[role="tab"]')];
        const k = todas.indexOf(evento.target.closest('[role="tab"]'));
        if (k < 0) return;
        const destino = { ArrowRight: (k + 1) % todas.length, ArrowLeft: (k - 1 + todas.length) % todas.length, Home: 0, End: todas.length - 1 }[evento.key];
        if (destino === undefined) return;
        evento.preventDefault();
        todas[destino].focus();
        todas[destino].click();
    });
    estado.suscribir(({ cambiadas }) => { if (cambiadas.has('cargo')) marcarCargo(anio); });
    // Estado de la fuente en una línea: TREP con actas y corte, o cómputo oficial con su fecha o pendiente; el aviso de
    // la fuente (resultados preliminares) va al final de esa misma línea.
    const info = anio.fuentes?.[fuente] ?? { estado: 'pendiente' };
    const linea = $('estadoFuente');
    linea.replaceChildren();
    const nombre = document.createElement('strong');
    nombre.textContent = info.nombre ?? (fuente === 'trep' ? 'TREP preliminar' : 'Cómputo oficial');
    linea.append(nombre);
    if (info.estado !== 'publicado') {
        linea.append(' · aún no publicado');
    } else {
        const cargado = await cargarEleccion({ eleccion: eleccion.id, anio: anio.anio }, fuente, { fuente: ['resumen.json'] });
        const resumen = cargado.datos['resumen.json'];
        const cob = resumen.cobertura;
        // Las actas no entran en el celular (shell.css): allí las muestra el panel de resultados.
        const actas = document.createElement('span');
        actas.className = 'barra-contexto__actas';
        actas.textContent = ` · ${fmt.format(cob.mesas_con_acta)}/${fmt.format(cob.mesas_esperadas)} actas`;
        linea.append(actas);
        const momento = info.corte ?? info.fecha;
        if (momento) linea.append(` · ${fuente === 'trep' ? 'corte' : 'cómputo'} ${fecha(momento)}`);
        if (resumen.eleccion.aviso) {
            const aviso = document.createElement('span');
            aviso.className = 'barra-contexto__aviso';
            aviso.id = 'avisoFuente';
            aviso.textContent = resumen.eleccion.aviso;
            linea.append(' · ', aviso);
        }
    }
    // Alto de la barra (fija en celular y tablet): las pestañas y los destinos de salto quedan debajo de ella.
    new ResizeObserver(() => {
        document.documentElement.style.setProperty('--alto-barra', `${Math.ceil(barra.getBoundingClientRect().height)}px`);
    }).observe(barra);
    barra.dataset.listo = 'true';
}

// --- Arranque -------------------------------------------------------------------------------------------------------
$('compartir')?.addEventListener('click', compartir);
menuMas();
grupos();
recordar();
actualizarMenu();
vigilarDesplazables();
const barra = $('barraContexto');
// listo: los módulos de la página esperan la barra (cargos y fuente) antes de marcarse listos.
export const listo = barra ? barraDeContexto(barra).catch((error) => { console.error(error); }) : Promise.resolve();
