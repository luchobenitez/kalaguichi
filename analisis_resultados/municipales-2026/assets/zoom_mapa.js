// Zoom y desplazamiento de los mapas SVG: solo cambia el atributo viewBox. Rueda del mouse, doble clic o doble
// toque, arrastre con un puntero y pellizco con dos (Pointer Events). Límites: no se aleja más allá del encuadre
// base ni se acerca más de 12 veces. Un arrastre de más de 6 px no cuenta como clic (no elige un local).
// En la vista normal un dedo sigue desplazando la página: el arrastre y el pellizco táctiles solo actúan con el
// mapa en pantalla completa (.mapa--pantalla), donde el SVG lleva touch-action: none.
const MAXIMO = 12;
const UMBRAL_PX = 6;
const DOBLE_MS = 320;
const DOBLE_PX = 24;
const PASO = 1.6;
const SVG = 'http://www.w3.org/2000/svg';

// Encuadre con la proporción del lienzo: en pantalla completa el mapa usa todo el alto (o el ancho) disponible.
function conAspecto([x, y, ancho, alto], aspecto) {
    if (!aspecto) return [x, y, ancho, alto];
    if (ancho / alto < aspecto) {
        const nuevo = alto * aspecto;
        return [x - (nuevo - ancho) / 2, y, nuevo, alto];
    }
    const nuevo = ancho / aspecto;
    return [x, y - (nuevo - alto) / 2, ancho, nuevo];
}

const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

export function habilitarZoom(lienzo, obtenerEncuadre) {
    let vista = null;            // viewBox actual: [x, y, ancho, alto]
    let factor = 1;              // ancho del encuadre base / ancho de la vista
    let centro = null;           // centro de la vista, en coordenadas del mapa
    const punteros = new Map();  // pointerId → posición en pantalla
    let gesto = null;            // { vista, puntos, movido }
    let ultimo = null;           // último toque o clic, para el doble toque
    let silenciar = false;       // el clic que sigue a un arrastre con mouse no elige nada
    let rueda = 0;
    let cuadro = 0;

    const enPantalla = () => Boolean(lienzo.closest('.mapa--pantalla'));
    const aspecto = () => {
        const r = lienzo.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r.width / r.height : null;
    };
    const base = () => conAspecto(obtenerEncuadre(), aspecto());

    function avisar() {
        if (cuadro) return;
        cuadro = requestAnimationFrame(() => {
            cuadro = 0;
            lienzo.dispatchEvent(new CustomEvent('zoommapa', { detail: { factor } }));
        });
    }

    function aplicar([x, y, ancho]) {
        const b = base();
        const w = limitar(ancho, b[2] / MAXIMO, b[2]);
        const h = (w * b[3]) / b[2];
        const nueva = [limitar(x, b[0], b[0] + b[2] - w), limitar(y, b[1], b[1] + b[3] - h), w, h];
        vista = nueva;
        factor = b[2] / w;
        centro = [nueva[0] + w / 2, nueva[1] + h / 2];
        lienzo.setAttribute('viewBox', nueva.map((v) => Math.round(v * 10) / 10).join(' '));
        // Rótulos y líneas compensan el zoom en resultados.css; los puntos, en el módulo que los dibuja (evento zoommapa).
        lienzo.style.setProperty('--zoom', String(Math.round(factor * 1000) / 1000));
        lienzo.style.setProperty('--zoom-raiz', String(Math.round(Math.sqrt(factor) * 1000) / 1000));
        avisar();
    }

    // Punto de la pantalla en coordenadas del mapa, con la vista actual.
    function enMapa(cx, cy) {
        const r = lienzo.getBoundingClientRect();
        if (!vista || !r.width) return null;
        return [vista[0] + ((cx - r.left) * vista[2]) / r.width, vista[1] + ((cy - r.top) * vista[3]) / r.height];
    }

    function zoomEn(f, cx, cy) {
        if (!vista) aplicar(base());
        const p = enMapa(cx, cy) ?? centro;
        const w = vista[2] / f, h = vista[3] / f;
        aplicar([p[0] - (p[0] - vista[0]) / f, p[1] - (p[1] - vista[1]) / f, w, h]);
    }

    function zoomCentro(f) {
        const r = lienzo.getBoundingClientRect();
        zoomEn(f, r.left + r.width / 2, r.top + r.height / 2);
    }

    const reiniciar = () => aplicar(base());
    const enBase = () => factor <= 1.0001;
    const enMaximo = () => factor >= MAXIMO - 0.001;

    // Cambio de tamaño (pantalla completa, giro, ventana): se conservan el centro y el zoom.
    new ResizeObserver(() => {
        if (!vista || !aspecto()) return;
        const b = base();
        const w = b[2] / factor, h = b[3] / factor;
        aplicar([centro[0] - w / 2, centro[1] - h / 2, w, h]);
    }).observe(lienzo);

    lienzo.addEventListener('wheel', (evento) => {
        const escala = evento.deltaMode === 1 ? 16 : evento.deltaMode === 2 ? 400 : 1;
        const f = Math.exp((-evento.deltaY * escala) / 600);
        // Alejar en el encuadre base o acercar en el máximo no cambia nada: la rueda sigue desplazando la página.
        if ((f < 1 && enBase()) || (f > 1 && enMaximo())) return;
        evento.preventDefault();
        lienzo.classList.add('es-moviendo');
        clearTimeout(rueda);
        rueda = setTimeout(() => lienzo.classList.remove('es-moviendo'), 160);
        zoomEn(f, evento.clientX, evento.clientY);
    }, { passive: false });

    const instantanea = () => ({ vista: [...vista], puntos: new Map([...punteros].map(([k, p]) => [k, { ...p }])), movido: gesto?.movido ?? false });

    lienzo.addEventListener('pointerdown', (evento) => {
        if (evento.pointerType === 'mouse' && evento.button !== 0) return;
        if (!vista) aplicar(base());
        punteros.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
        gesto = instantanea();
    });

    function mover() {
        if (!gesto) return;
        const r = lienzo.getBoundingClientRect();
        const ids = [...gesto.puntos.keys()].filter((k) => punteros.has(k));
        const v0 = gesto.vista;
        const k0 = v0[2] / r.width;
        if (ids.length >= 2) {
            // Pellizco: zoom con la distancia entre los dedos y desplazamiento con su punto medio.
            const [a0, b0] = ids.slice(0, 2).map((k) => gesto.puntos.get(k));
            const [a1, b1] = ids.slice(0, 2).map((k) => punteros.get(k));
            const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
            if (!d0 || !d1) return;
            const m0 = [(a0.x + b0.x) / 2 - r.left, (a0.y + b0.y) / 2 - r.top];
            const m1 = [(a1.x + b1.x) / 2 - r.left, (a1.y + b1.y) / 2 - r.top];
            const f = d1 / d0;
            const p = [v0[0] + m0[0] * k0, v0[1] + m0[1] * k0];
            const w = v0[2] / f, k = w / r.width;
            aplicar([p[0] - m1[0] * k, p[1] - m1[1] * k, w, v0[3] / f]);
        } else if (ids.length === 1) {
            const p0 = gesto.puntos.get(ids[0]), p1 = punteros.get(ids[0]);
            aplicar([v0[0] - (p1.x - p0.x) * k0, v0[1] - (p1.y - p0.y) * k0, v0[2], v0[3]]);
        }
    }

    lienzo.addEventListener('pointermove', (evento) => {
        const p = punteros.get(evento.pointerId);
        if (!p || !gesto) return;
        p.x = evento.clientX;
        p.y = evento.clientY;
        if (evento.pointerType === 'touch' && !enPantalla()) return;
        if (!gesto.movido) {
            const p0 = gesto.puntos.get(evento.pointerId);
            if (punteros.size < 2 && (!p0 || Math.hypot(p.x - p0.x, p.y - p0.y) < UMBRAL_PX)) return;
            gesto.movido = true;
            // Recién al confirmar el arrastre se captura el puntero: antes, el clic debe llegar al local tocado.
            for (const id of punteros.keys()) lienzo.setPointerCapture?.(id);
            lienzo.classList.add('es-moviendo');
        }
        mover();
    });

    function terminar(evento) {
        if (!punteros.has(evento.pointerId)) return;
        punteros.delete(evento.pointerId);
        const movido = gesto?.movido;
        if (punteros.size) {
            gesto = instantanea();
            return;
        }
        gesto = null;
        lienzo.classList.remove('es-moviendo');
        if (movido) {
            // Con mouse o lápiz, el navegador emite un clic justo después de soltar (en la misma tarea): se descarta solo
            // ese. Un arrastre táctil no produce clic, así que el próximo toque cuenta.
            if (evento.pointerType !== 'touch') {
                silenciar = true;
                setTimeout(() => { silenciar = false; }, 0);
            }
            ultimo = null;
            return;
        }
        if (evento.type === 'pointercancel') return;
        // Doble clic o doble toque: acerca al doble en ese punto.
        const ahora = performance.now();
        if (ultimo && ahora - ultimo.t < DOBLE_MS && Math.hypot(evento.clientX - ultimo.x, evento.clientY - ultimo.y) < DOBLE_PX) {
            ultimo = null;
            zoomEn(2, evento.clientX, evento.clientY);
        } else {
            ultimo = { t: ahora, x: evento.clientX, y: evento.clientY };
        }
    }

    lienzo.addEventListener('pointerup', terminar);
    lienzo.addEventListener('pointercancel', terminar);
    // En captura sobre el propio SVG: el clic que cierra un arrastre no llega al local ni cierra la ficha.
    lienzo.addEventListener('click', (evento) => {
        if (silenciar) {
            silenciar = false;
            evento.stopPropagation();
            evento.preventDefault();
        }
    }, true);

    aplicar(base());
    return { acercar: () => zoomCentro(PASO), alejar: () => zoomCentro(1 / PASO), reiniciar, factor: () => factor };
}

// --- Botones y pantalla completa -------------------------------------------------------------------

let enUso = null;  // mapa en pantalla completa: { salir }

export function salirDePantallaCompleta() {
    enUso?.salir();
}

function icono(d) {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    s.append(p);
    return s;
}

function boton(clase, etiqueta, contenido) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `mapa__boton ${clase}`;
    b.setAttribute('aria-label', etiqueta);
    b.title = etiqueta;
    b.append(contenido);
    return b;
}

const ICONOS = {
    mas: 'M12 5v14M5 12h14',
    menos: 'M5 12h14',
    reiniciar: 'M4 12a8 8 0 1 0 2.35-5.65M4 4v4h4',
    ampliar: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    cerrar: 'M6 6l12 12M18 6L6 18',
};

// Botones superpuestos (+, −, reiniciar y «Ampliar mapa») y modo de pantalla completa del contenedor .mapa.
// leyendas(): las listas de leyenda del mapa; en pantalla completa se muestran superpuestas en un panel plegable.
export function agregarControles(contenedor, zoom, leyendas = () => []) {
    const zoomBotones = document.createElement('div');
    zoomBotones.className = 'mapa__controles';
    const mas = boton('mapa__boton--icono', 'Acercar', icono(ICONOS.mas));
    const menos = boton('mapa__boton--icono', 'Alejar', icono(ICONOS.menos));
    const volver = boton('mapa__boton--icono', 'Volver al encuadre del mapa', icono(ICONOS.reiniciar));
    mas.addEventListener('click', zoom.acercar);
    menos.addEventListener('click', zoom.alejar);
    volver.addEventListener('click', zoom.reiniciar);
    zoomBotones.append(mas, menos, volver);
    const ampliar = boton('mapa__ampliar', 'Ampliar mapa', icono(ICONOS.ampliar));
    const texto = document.createElement('span');
    texto.textContent = 'Ampliar mapa';
    ampliar.append(texto);
    ampliar.setAttribute('aria-pressed', 'false');
    const panel = document.createElement('details');
    panel.className = 'mapa__leyenda';
    panel.open = true;
    const resumen = document.createElement('summary');
    resumen.textContent = 'Leyenda';
    panel.append(resumen);
    panel.hidden = true;
    contenedor.append(zoomBotones, ampliar, panel);
    let movidas = [];

    function entrar() {
        enUso?.salir();
        contenedor.classList.add('mapa--pantalla');
        document.documentElement.classList.add('es-mapa-pantalla');
        // Las leyendas se mueven (no se copian): siguen actualizándose con el mapa y vuelven a su lugar al salir.
        movidas = leyendas().filter(Boolean).map((nodo) => ({ nodo, padre: nodo.parentNode, siguiente: nodo.nextSibling }));
        for (const { nodo } of movidas) panel.append(nodo);
        panel.hidden = !movidas.length;
        texto.textContent = 'Cerrar';
        ampliar.replaceChild(icono(ICONOS.cerrar), ampliar.firstChild);
        ampliar.setAttribute('aria-label', 'Cerrar la pantalla completa');
        ampliar.title = 'Cerrar la pantalla completa (Escape)';
        ampliar.setAttribute('aria-pressed', 'true');
        enUso = { salir };
        ampliar.focus({ preventScroll: true });
    }

    function salir() {
        if (!contenedor.classList.contains('mapa--pantalla')) return;
        contenedor.classList.remove('mapa--pantalla');
        document.documentElement.classList.remove('es-mapa-pantalla');
        for (const { nodo, padre, siguiente } of movidas) padre.insertBefore(nodo, siguiente?.parentNode === padre ? siguiente : null);
        movidas = [];
        panel.hidden = true;
        texto.textContent = 'Ampliar mapa';
        ampliar.replaceChild(icono(ICONOS.ampliar), ampliar.firstChild);
        ampliar.setAttribute('aria-label', 'Ampliar mapa');
        ampliar.title = 'Ampliar mapa';
        ampliar.setAttribute('aria-pressed', 'false');
        if (enUso?.salir === salir) enUso = null;
        ampliar.focus({ preventScroll: true });
    }

    ampliar.addEventListener('click', () => (contenedor.classList.contains('mapa--pantalla') ? salir() : entrar()));
    // Escape: si la ficha estaba abierta, ya la cerró ella (preventDefault); si no, sale de la pantalla completa.
    document.addEventListener('keydown', (evento) => {
        if (evento.key === 'Escape' && !evento.defaultPrevented && contenedor.classList.contains('mapa--pantalla')) {
            evento.preventDefault();
            salir();
        }
    });
    return { entrar, salir };
}
