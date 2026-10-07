// Indicador de «hay más contenido a la derecha» en tablas, pestañas y el menú del sitio
// desplazables a lo ancho:
// resultados.css desvanece el borde derecho con mask-image mientras no tengan la clase es-fin, que se pone al
// llegar al final del desplazamiento (o si todo entra). Se actualiza al desplazar, al redimensionar la ventana y
// cuando cambia el contenido o se muestra una vista oculta.
const SELECTOR = '.tabla-scroll, .pestanas, .site-nav';
let vigilando = false;  // Lo usan el menú (shell.js) y el visor: una sola vez por página.

function actualizar(nodo) {
    nodo.classList.toggle('es-fin', nodo.scrollLeft + nodo.clientWidth >= nodo.scrollWidth - 2);
    // Ancho de la barra vertical (si la hay): el desvanecido termina antes para no ocultarla.
    const estilo = getComputedStyle(nodo);
    const barra = nodo.offsetWidth - nodo.clientWidth - parseFloat(estilo.borderLeftWidth) - parseFloat(estilo.borderRightWidth);
    nodo.style.setProperty('--barra', `${Math.max(0, Math.round(barra))}px`);
}

export function vigilarDesplazables(raiz = document.body) {
    if (vigilando) return;
    vigilando = true;
    let pendiente = false;
    const todos = () => {
        if (pendiente) return;
        pendiente = true;
        requestAnimationFrame(() => {
            pendiente = false;
            for (const nodo of raiz.querySelectorAll(SELECTOR)) actualizar(nodo);
        });
    };
    // El evento scroll no burbujea: se escucha en captura, una sola vez para todas las tablas (también las nuevas).
    document.addEventListener('scroll', (evento) => {
        if (evento.target instanceof Element && evento.target.matches(SELECTOR)) actualizar(evento.target);
    }, { capture: true, passive: true });
    window.addEventListener('resize', todos, { passive: true });
    new MutationObserver(todos).observe(raiz, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    todos();
}
