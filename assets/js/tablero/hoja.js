// Panel de pestañas del tablero (Resultados, D'Hondt, Filtros, Capas y Método) y bandeja de Tabla y Ranking (ADR-021).
// Escritorio y tablet horizontal (≥ 1024 px): el panel es la columna izquierda. Tablet vertical: un cajón lateral que
// se abre y se cierra con un botón y se superpone al mapa sin empujarlo. Celular: hoja inferior de tres alturas (el asa
// se toca, se arrastra o se mueve con las flechas). La bandeja se despliega sobre la parte de abajo del mapa, cerrada
// por omisión; su alto se ajusta con el separador (arrastre, flechas, Inicio y Fin). Las pestañas se recorren con las
// flechas, Inicio y Fin.
const $ = (id) => document.getElementById(id);
const ALTURAS = ['peek', 'medio', 'completo'];
const PASO_PX = 32;
const ANCHO = matchMedia('(min-width: 1024px)');
const CELULAR = matchMedia('(max-width: 640px)');

// Lista de pestañas con activación automática. Una pestaña atenuada recibe el foco con las flechas, pero no se elige
// sola: se elige con un toque, Enter o Espacio.
function pestanas(lista, { alElegir, atenuada = () => false }) {
    const botones = [...lista.querySelectorAll('[role="tab"]')];
    const clave = (b) => b.dataset.panel ?? b.dataset.bandeja;
    lista.addEventListener('click', (evento) => {
        const b = evento.target.closest('[role="tab"]');
        if (b) alElegir(clave(b), { toque: true });
    });
    lista.addEventListener('keydown', (evento) => {
        const visibles = botones.filter((b) => !b.hidden);
        const k = visibles.indexOf(evento.target.closest('[role="tab"]'));
        if (k < 0) return;
        const destino = { ArrowRight: (k + 1) % visibles.length, ArrowLeft: (k - 1 + visibles.length) % visibles.length, Home: 0,
                          End: visibles.length - 1 }[evento.key];
        if (destino === undefined) return;
        evento.preventDefault();
        const b = visibles[destino];
        if (atenuada(clave(b))) b.focus();
        else alElegir(clave(b), { foco: true });
    });
    return {
        marcar(nombre) {
            for (const b of botones) {
                const activa = clave(b) === nombre;
                b.setAttribute('aria-selected', String(activa));
                b.tabIndex = activa ? 0 : -1;
            }
        },
        boton: (nombre) => botones.find((b) => clave(b) === nombre),
    };
}

// Arrastre de un alto (asa de la hoja o separador de la bandeja): el clic que sigue a un arrastre no cuenta.
function arrastrable(nodo, { inicio, mover, fin }) {
    let arrastre = null;
    nodo.addEventListener('pointerdown', (evento) => {
        if (evento.pointerType === 'mouse' && evento.button !== 0) return;
        const alto = inicio?.(evento);
        if (alto === null) return;
        arrastre = { id: evento.pointerId, y: evento.clientY, alto, movido: false };
        delete nodo.dataset.arrastrada;
    });
    nodo.addEventListener('pointermove', (evento) => {
        if (!arrastre || evento.pointerId !== arrastre.id) return;
        const dy = arrastre.y - evento.clientY;
        if (!arrastre.movido && Math.abs(dy) < 6) return;
        if (!arrastre.movido) {
            arrastre.movido = true;
            nodo.setPointerCapture?.(evento.pointerId);
            nodo.classList.add('es-arrastrando');
        }
        mover(arrastre.alto + dy);
    });
    const soltar = (evento) => {
        if (!arrastre || evento.pointerId !== arrastre.id) return;
        const movido = arrastre.movido;
        arrastre = null;
        nodo.classList.remove('es-arrastrando');
        if (!movido) return;
        nodo.dataset.arrastrada = 'true';
        setTimeout(() => { delete nodo.dataset.arrastrada; }, 0);
        fin?.();
    };
    nodo.addEventListener('pointerup', soltar);
    nodo.addEventListener('pointercancel', soltar);
}

// alElegir(nombre, { toque, foco }): la pestaña pedida (el tablero decide, por ejemplo, cambiar a la Junta para D'Hondt).
// alCambiarModo(): el tamaño de pantalla cambió de modo (columna, cajón u hoja).
export function crearPanel({ alElegir, atenuada, alCambiarModo }) {
    const raiz = $('hoja');
    const contenedor = raiz.parentElement;
    const asa = $('asaHoja');
    // Las pestañas de la plantilla y sus paneles (aria-controls): las del tablero de un distrito o las del mapa del país.
    const paneles = Object.fromEntries([...$('pestanasTablero').querySelectorAll('[role="tab"]')]
        .map((b) => [b.dataset.panel, $(b.getAttribute('aria-controls'))]));
    const lista = pestanas($('pestanasTablero'), { alElegir, atenuada });
    let elegido = 'resultados';
    let altura = raiz.dataset.altura;
    const cajon = () => !ANCHO.matches && !CELULAR.matches;

    function fijarAltura(nueva) {
        altura = nueva;
        raiz.dataset.altura = nueva;
        raiz.style.removeProperty('--alto-arrastre');
        asa.setAttribute('aria-expanded', String(nueva !== 'peek'));
        asa.setAttribute('aria-label', nueva === 'completo' ? 'Achicar el panel' : 'Agrandar el panel');
    }

    // En celular, elegir una pestaña con la hoja asomada la abre a media altura (salvo que se pida otra).
    function elegir(nombre, { foco = false, altura: pedida = null } = {}) {
        elegido = Object.hasOwn(paneles, nombre) ? nombre : 'resultados';
        lista.marcar(elegido);
        for (const [n, nodo] of Object.entries(paneles)) nodo.hidden = n !== elegido;
        raiz.dataset.panel = elegido;
        if (pedida) fijarAltura(pedida);
        else if (CELULAR.matches && altura === 'peek') fijarAltura('medio');
        if (foco) lista.boton(elegido)?.focus();
    }

    // --- Tablet vertical: cajón lateral superpuesto al mapa ----------------------------------------------------------
    function abrir(abierto, { foco = false } = {}) {
        raiz.classList.toggle('es-abierto', abierto);
        $('botonPanel').setAttribute('aria-expanded', String(abierto));
        if (!foco) return;
        if (abierto) lista.boton(elegido)?.focus();
        else $('botonPanel').focus();
    }
    raiz.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Escape' || evento.defaultPrevented || !cajon() || !raiz.classList.contains('es-abierto')) return;
        evento.preventDefault();
        abrir(false, { foco: true });
    });

    // --- Celular: asa de la hoja --------------------------------------------------------------------------------------
    asa.addEventListener('click', () => {
        if (asa.dataset.arrastrada) return;
        fijarAltura(ALTURAS[(ALTURAS.indexOf(altura) + 1) % ALTURAS.length]);
    });
    asa.addEventListener('keydown', (evento) => {
        const k = ALTURAS.indexOf(altura);
        const destino = { ArrowUp: Math.min(k + 1, 2), ArrowDown: Math.max(k - 1, 0), Home: 0, End: 2 }[evento.key];
        if (destino === undefined) return;
        evento.preventDefault();
        fijarAltura(ALTURAS[destino]);
    });
    arrastrable(asa, {
        inicio: () => (CELULAR.matches ? raiz.getBoundingClientRect().height : null),
        mover: (px) => {
            raiz.classList.add('es-arrastrando');
            const maximo = contenedor.getBoundingClientRect().height;
            raiz.style.setProperty('--alto-arrastre', `${Math.round(Math.min(maximo, Math.max(48, px)))}px`);
        },
        fin: () => {
            raiz.classList.remove('es-arrastrando');
            const fraccion = raiz.getBoundingClientRect().height / contenedor.getBoundingClientRect().height;
            fijarAltura(fraccion < 0.33 ? 'peek' : fraccion < 0.78 ? 'medio' : 'completo');
        },
    });
    // Alto visible de la hoja (celular): la atribución del mapa queda justo encima.
    new ResizeObserver(() => {
        contenedor.style.setProperty('--alto-hoja-actual', `${Math.ceil(raiz.getBoundingClientRect().height)}px`);
    }).observe(raiz);

    const reacomodar = () => {
        if (!cajon()) abrir(false);
        alCambiarModo?.();
    };
    ANCHO.addEventListener('change', reacomodar);
    CELULAR.addEventListener('change', reacomodar);
    fijarAltura(altura);
    elegir(elegido);

    return { elegir, panel: () => elegido, altura: () => altura, fijarAltura, abrir, abierto: () => raiz.classList.contains('es-abierto'),
             celular: () => CELULAR.matches, ancho: () => ANCHO.matches, cajon, boton: (nombre) => lista.boton(nombre) };
}

// alElegir(nombre): Tabla o Ranking; alCambiar(abierta): la bandeja se abrió o se cerró.
export function crearBandeja({ alElegir, alCambiar }) {
    const raiz = $('bandeja');
    const contenedor = raiz.parentElement;
    const separador = $('separador');
    const boton = $('botonTabla');
    const paneles = Object.fromEntries([...$('pestanasBandeja').querySelectorAll('[role="tab"]')]
        .map((b) => [b.dataset.bandeja, $(b.getAttribute('aria-controls'))]));
    let elegido = 'tabla';
    const lista = pestanas($('pestanasBandeja'), { alElegir: (nombre, { foco = false } = {}) => { elegir(nombre, { foco }); alElegir?.(nombre); } });

    function elegir(nombre, { foco = false } = {}) {
        elegido = Object.hasOwn(paneles, nombre) ? nombre : 'tabla';
        lista.marcar(elegido);
        for (const [n, nodo] of Object.entries(paneles)) nodo.hidden = n !== elegido;
        for (const controles of raiz.querySelectorAll('[data-para]')) controles.hidden = controles.dataset.para !== elegido;
        raiz.dataset.panel = elegido;
        if (foco) lista.boton(elegido)?.focus();
    }

    function abrir(abierta, { foco = false } = {}) {
        if (abierta === !raiz.hidden) return;
        raiz.hidden = !abierta;
        contenedor.classList.toggle('con-bandeja', abierta);
        boton.setAttribute('aria-expanded', String(abierta));
        if (abierta && contenedor.style.getPropertyValue('--alto-bandeja')) fijarAlto(altoActual());
        if (foco) (abierta ? lista.boton(elegido) : boton)?.focus();
        alCambiar?.(abierta);
    }
    $('cerrarBandeja').addEventListener('click', () => abrir(false, { foco: true }));
    // Escape cierra la bandeja (en el filtro con texto, primero lo borra el navegador).
    raiz.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Escape' || evento.defaultPrevented || (evento.target.type === 'search' && evento.target.value)) return;
        evento.preventDefault();
        abrir(false, { foco: true });
    });

    // Alto: entre 128 px y lo que deje 96 px de mapa a la vista.
    const limites = () => ({ min: 128, max: Math.max(160, Math.round(contenedor.getBoundingClientRect().height - 96)) });
    const altoActual = () => Math.round(raiz.getBoundingClientRect().height);
    function fijarAlto(px) {
        const { min, max } = limites();
        const valor = Math.round(Math.min(max, Math.max(min, px)));
        contenedor.style.setProperty('--alto-bandeja', `${valor}px`);
        separador.setAttribute('aria-valuemin', String(min));
        separador.setAttribute('aria-valuemax', String(max));
        separador.setAttribute('aria-valuenow', String(valor));
        separador.setAttribute('aria-valuetext', `${valor} píxeles`);
    }
    separador.addEventListener('keydown', (evento) => {
        const { min, max } = limites();
        const destino = { ArrowUp: altoActual() + PASO_PX, ArrowDown: altoActual() - PASO_PX, Home: min, End: max }[evento.key];
        if (destino === undefined) return;
        evento.preventDefault();
        fijarAlto(destino);
    });
    arrastrable(separador, { inicio: () => altoActual(), mover: fijarAlto });
    new ResizeObserver(() => {
        if (!raiz.hidden && contenedor.style.getPropertyValue('--alto-bandeja')) fijarAlto(altoActual());
    }).observe(contenedor);
    elegir(elegido);

    return { elegir, abrir, abierta: () => !raiz.hidden, panel: () => elegido, visible: () => (raiz.hidden ? null : elegido) };
}
