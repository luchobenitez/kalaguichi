// «Acerca de»: el índice de la página queda abierto en pantalla ancha (columna lateral) y plegado en celular y tablet,
// donde elegir un ítem lo vuelve a plegar. La sección que se está leyendo se marca en el índice (aria-current).
// También el índice de las páginas de lectura de Máquina de votación ([data-indice]).
const indice = document.getElementById('indiceAcerca') ?? document.querySelector('[data-indice]');
const ANCHO = matchMedia('(min-width: 1024px)');

if (indice) {
    const ajustar = () => { indice.open = ANCHO.matches; };
    ANCHO.addEventListener('change', ajustar);
    ajustar();
    indice.addEventListener('click', (evento) => {
        if (evento.target.closest('a') && !ANCHO.matches) indice.open = false;
    });
    const enlaces = new Map([...indice.querySelectorAll('a[href^="#"]')].map((a) => [decodeURIComponent(a.getAttribute('href').slice(1)), a]));
    const marcar = (id) => {
        for (const a of enlaces.values()) a.removeAttribute('aria-current');
        enlaces.get(id)?.setAttribute('aria-current', 'true');
    };
    // Sección a la vista: el último título que pasó el tercio superior de la ventana.
    const titulos = [...enlaces.keys()].map((id) => document.getElementById(id)).filter(Boolean);
    const actualizar = () => {
        const limite = innerHeight * 0.33;
        let actual = null;
        for (const t of titulos) if (t.getBoundingClientRect().top <= limite) actual = t;
        // El título elegido en el índice manda mientras siga arriba (o, al final de la página, mientras se vea).
        const alFinal = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
        const pedido = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        const arriba = titulos.includes(pedido) ? pedido.getBoundingClientRect().top : null;
        if (arriba !== null && ((arriba >= -8 && arriba <= limite) || (alFinal && arriba < innerHeight))) actual = pedido;
        marcar(actual?.id ?? null);
    };
    let cuadro = 0;
    addEventListener('scroll', () => {
        if (!cuadro) cuadro = requestAnimationFrame(() => { cuadro = 0; actualizar(); });
    }, { passive: true });
    addEventListener('hashchange', actualizar);
    actualizar();
}
