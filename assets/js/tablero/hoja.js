// Bandeja del tablero con las pestañas Resultados | Tabla | Ranking. En escritorio y tablet horizontal el panel de
// resultados queda siempre a la vista (columna derecha) y la bandeja muestra Tabla o Ranking; su alto se ajusta con
// el separador (arrastre, flechas, Inicio y Fin), igual que en tablet vertical. En celular es una hoja inferior con
// tres alturas: asomada (indicadores de la selección), media (resultados) y completa (tabla); se cambia con el asa,
// tocándola, arrastrándola o con las flechas.
const $ = (id) => document.getElementById(id);
const ALTURAS = ['peek', 'medio', 'completo'];
const PASO_PX = 32;

export function crearHoja({ alElegirPanel, alMostrar }) {
    const raiz = $('hoja');
    const contenedor = raiz.parentElement;
    const asa = $('asaHoja');
    const separador = $('separador');
    const lista = $('pestanasTablero');
    const pestanas = [...lista.querySelectorAll('[role="tab"]')];
    const paneles = { resultados: $('panelResultados'), tabla: $('panelTabla'), ranking: $('panelRanking') };
    const ANCHO = matchMedia('(min-width: 1024px)');
    const CELULAR = matchMedia('(max-width: 640px)');
    let elegido = 'resultados';
    let altura = raiz.dataset.altura;

    // En pantalla ancha el panel de resultados no es una pestaña: la bandeja muestra la tabla en su lugar.
    const efectivo = () => (ANCHO.matches && elegido === 'resultados' ? 'tabla' : elegido);

    // Devuelve si cambió el panel a la vista (por ejemplo, al girar la tablet).
    function mostrar() {
        const antes = raiz.dataset.panel;
        const actual = efectivo();
        const conPestana = !ANCHO.matches;
        const resultados = paneles.resultados;
        $('pestana-resultados').hidden = !conPestana;
        if (conPestana) {
            resultados.setAttribute('role', 'tabpanel');
            resultados.setAttribute('aria-labelledby', 'pestana-resultados');
        } else {
            resultados.removeAttribute('role');
            resultados.setAttribute('aria-labelledby', 'tituloTotales');
        }
        for (const boton of pestanas) {
            const activa = boton.dataset.panel === actual;
            boton.setAttribute('aria-selected', String(activa));
            boton.tabIndex = activa ? 0 : -1;
        }
        for (const [nombre, nodo] of Object.entries(paneles)) {
            nodo.hidden = nombre === 'resultados' ? conPestana && actual !== 'resultados' : nombre !== actual;
        }
        raiz.dataset.panel = actual;
        return antes !== actual;
    }

    function fijarAltura(nueva) {
        altura = nueva;
        raiz.dataset.altura = nueva;
        raiz.style.removeProperty('--alto-arrastre');
        asa.setAttribute('aria-expanded', String(nueva !== 'peek'));
        asa.setAttribute('aria-label', nueva === 'completo' ? 'Achicar el panel' : 'Agrandar el panel');
    }

    // panel: resultados, tabla o ranking. En celular cada uno abre la hoja a su altura (media o completa), salvo que
    // se pida otra.
    function elegirPanel(nombre, { foco = false, avisar = true, altura: pedida = null } = {}) {
        elegido = nombre;
        mostrar();
        if (pedida) fijarAltura(pedida);
        else if (CELULAR.matches) fijarAltura(efectivo() === 'resultados' ? (altura === 'completo' ? 'completo' : 'medio') : 'completo');
        if (foco) pestanas.find((b) => b.dataset.panel === efectivo())?.focus();
        if (avisar) alElegirPanel?.(elegido);
    }

    lista.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[role="tab"]');
        if (boton) elegirPanel(boton.dataset.panel);
    });
    // Flechas, Inicio y Fin mueven el foco entre las pestañas visibles y las eligen (activación automática).
    lista.addEventListener('keydown', (evento) => {
        const visibles = pestanas.filter((b) => !b.hidden);
        const k = visibles.indexOf(evento.target.closest('[role="tab"]'));
        if (k < 0) return;
        const destino = { ArrowRight: (k + 1) % visibles.length, ArrowLeft: (k - 1 + visibles.length) % visibles.length, Home: 0,
                          End: visibles.length - 1 }[evento.key];
        if (destino === undefined) return;
        evento.preventDefault();
        elegirPanel(visibles[destino].dataset.panel, { foco: true });
    });

    // --- Celular: asa de la hoja ---------------------------------------------------------------------------------
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
    let arrastre = null;
    asa.addEventListener('pointerdown', (evento) => {
        if (!CELULAR.matches || (evento.pointerType === 'mouse' && evento.button !== 0)) return;
        arrastre = { id: evento.pointerId, y: evento.clientY, alto: raiz.getBoundingClientRect().height, movido: false };
        delete asa.dataset.arrastrada;
    });
    asa.addEventListener('pointermove', (evento) => {
        if (!arrastre || evento.pointerId !== arrastre.id) return;
        const dy = arrastre.y - evento.clientY;
        if (!arrastre.movido && Math.abs(dy) < 6) return;
        if (!arrastre.movido) {
            arrastre.movido = true;
            asa.setPointerCapture?.(evento.pointerId);
            raiz.classList.add('es-arrastrando');
        }
        const maximo = contenedor.getBoundingClientRect().height;
        raiz.style.setProperty('--alto-arrastre', `${Math.round(Math.min(maximo, Math.max(48, arrastre.alto + dy)))}px`);
    });
    const soltar = (evento) => {
        if (!arrastre || evento.pointerId !== arrastre.id) return;
        const movido = arrastre.movido;
        arrastre = null;
        raiz.classList.remove('es-arrastrando');
        if (!movido) return;
        // Se queda en la altura más cercana; el clic que sigue al arrastre no la cambia otra vez.
        asa.dataset.arrastrada = 'true';
        setTimeout(() => { delete asa.dataset.arrastrada; }, 0);
        const fraccion = raiz.getBoundingClientRect().height / contenedor.getBoundingClientRect().height;
        fijarAltura(fraccion < 0.33 ? 'peek' : fraccion < 0.78 ? 'medio' : 'completo');
    };
    asa.addEventListener('pointerup', soltar);
    asa.addEventListener('pointercancel', soltar);

    // --- Tablet y escritorio: separador de la bandeja ---------------------------------------------------------------
    const limites = () => {
        const alto = contenedor.getBoundingClientRect().height;
        return { min: 128, max: Math.max(160, Math.round(alto - 300)) };
    };
    const altoBandeja = () => Math.round((paneles.tabla.hidden ? paneles.ranking : paneles.tabla).getBoundingClientRect().height);
    function fijarBandeja(px) {
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
        const actual = altoBandeja();
        const destino = { ArrowUp: actual + PASO_PX, ArrowDown: actual - PASO_PX, Home: min, End: max }[evento.key];
        if (destino === undefined) return;
        evento.preventDefault();
        fijarBandeja(destino);
    });
    let tirando = null;
    separador.addEventListener('pointerdown', (evento) => {
        if (evento.pointerType === 'mouse' && evento.button !== 0) return;
        tirando = { id: evento.pointerId, y: evento.clientY, alto: altoBandeja() };
        separador.setPointerCapture?.(evento.pointerId);
        separador.classList.add('es-arrastrando');
        evento.preventDefault();
    });
    separador.addEventListener('pointermove', (evento) => {
        if (tirando && evento.pointerId === tirando.id) fijarBandeja(tirando.alto + tirando.y - evento.clientY);
    });
    const terminar = (evento) => {
        if (!tirando || evento.pointerId !== tirando.id) return;
        tirando = null;
        separador.classList.remove('es-arrastrando');
    };
    separador.addEventListener('pointerup', terminar);
    separador.addEventListener('pointercancel', terminar);

    // Al cambiar de tamaño (giro de la tablet, ventana que se agranda) se reacomodan las pestañas; el alto elegido
    // para la bandeja se vuelve a medir con los nuevos límites.
    const reacomodar = () => {
        if (mostrar()) alMostrar?.(efectivo());
        if (contenedor.style.getPropertyValue('--alto-bandeja')) fijarBandeja(altoBandeja());
    };
    ANCHO.addEventListener('change', reacomodar);
    CELULAR.addEventListener('change', reacomodar);
    // En pantalla ancha las pestañas comparten renglón con los controles del panel: estos dejan su ancho libre.
    new ResizeObserver(() => {
        contenedor.style.setProperty('--ancho-pestanas', `${Math.ceil(lista.getBoundingClientRect().width)}px`);
    }).observe(lista);
    fijarAltura(altura);
    mostrar();

    return { elegirPanel, panel: () => elegido, visible: () => efectivo(), altura: () => altura, fijarAltura,
             celular: () => CELULAR.matches, ancho: () => ANCHO.matches };
}
