// Diálogo modal reutilizable (<dialog>): título, botón «Cerrar», cierre con Escape y con un clic fuera del recuadro.
// Mientras está abierto el resto de la página queda inerte y Tab recorre solo el diálogo (del último control vuelve al
// primero); al cerrarlo, el foco vuelve al control que lo abrió. El cuerpo se desplaza por dentro, con ancho de lectura;
// en celular ocupa toda la pantalla (shell.css). El contenido se arma al abrir (puede ser asíncrono) y se escribe con
// nodos, sin HTML desde datos.
const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
                   'summary, [tabindex]:not([tabindex="-1"])';
let contador = 0;

function nodo(tag, clase, texto) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined) n.textContent = texto;
    return n;
}

// contenido(): devuelve un nodo (o una promesa de un nodo) con el cuerpo del diálogo.
export function crearDialogo({ titulo, contenido, clase = '' }) {
    const id = `dialogo-${++contador}`;
    const dialogo = nodo('dialog', `dialogo ${clase}`.trim());
    dialogo.id = id;
    dialogo.setAttribute('aria-labelledby', `${id}-titulo`);
    const cabecera = nodo('div', 'dialogo__cabecera');
    const encabezado = nodo('h2', null, titulo);
    encabezado.id = `${id}-titulo`;
    const cerrar = nodo('button', 'boton-secundario dialogo__cerrar', 'Cerrar');
    cerrar.type = 'button';
    cabecera.append(encabezado, cerrar);
    // El cuerpo es enfocable: con el teclado se desplaza aunque no tenga controles.
    const cuerpo = nodo('div', 'dialogo__cuerpo');
    cuerpo.tabIndex = 0;
    cuerpo.setAttribute('role', 'region');
    cuerpo.setAttribute('aria-labelledby', `${id}-titulo`);
    dialogo.append(cabecera, cuerpo);
    document.body.append(dialogo);
    let abridor = null;
    let turno = 0;

    cerrar.addEventListener('click', () => dialogo.close());
    // Un clic en el fondo llega al propio <dialog>: se cierra solo si cae fuera del recuadro.
    dialogo.addEventListener('click', (evento) => {
        if (evento.target !== dialogo) return;
        const r = dialogo.getBoundingClientRect();
        if (evento.clientX < r.left || evento.clientX > r.right || evento.clientY < r.top || evento.clientY > r.bottom) dialogo.close();
    });
    dialogo.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Tab') return;
        const nodos = [...dialogo.querySelectorAll(ENFOCABLES)].filter((n) => n.getClientRects().length && !n.closest('[hidden]'));
        if (!nodos.length) return;
        const primero = nodos[0], ultimo = nodos[nodos.length - 1];
        if (evento.shiftKey ? document.activeElement === primero || !dialogo.contains(document.activeElement) : document.activeElement === ultimo) {
            evento.preventDefault();
            (evento.shiftKey ? ultimo : primero).focus();
        }
    });
    dialogo.addEventListener('close', () => {
        document.documentElement.classList.remove('con-dialogo');
        if (abridor?.isConnected) abridor.focus({ preventScroll: true });
        abridor = null;
    });

    async function abrir(origen = document.activeElement) {
        const miTurno = ++turno;
        abridor = origen instanceof HTMLElement && origen !== document.body ? origen : null;
        dialogo.dataset.listo = 'false';
        cuerpo.replaceChildren(nodo('p', 'nota', 'Cargando…'));
        if (!dialogo.open) dialogo.showModal();
        document.documentElement.classList.add('con-dialogo');
        cerrar.focus();
        try {
            const contenidoNuevo = await contenido();
            if (miTurno !== turno) return;
            cuerpo.replaceChildren(contenidoNuevo);
        } catch (error) {
            cuerpo.replaceChildren(nodo('p', 'nota', 'No se pudo armar este contenido.'));
            console.error(error);
        }
        cuerpo.scrollTop = 0;
        dialogo.dataset.listo = 'true';
    }

    return { abrir, cerrar: () => dialogo.close(), elemento: dialogo, abierto: () => dialogo.open };
}
