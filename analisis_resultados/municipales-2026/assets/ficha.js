// Ficha inferior del local o barrio tocado (celular, tablet y mapa en pantalla completa): muestra sus cifras sin
// mover la página. Es un diálogo no modal: la página sigue usable y tocar otro local la actualiza. Se cierra con
// «Cerrar», con Escape o tocando fuera; al abrir, el foco va a «Cerrar» y al cerrar vuelve a donde estaba.
const $ = (id) => document.getElementById(id);

export function crearFicha() {
    const raiz = $('ficha');
    const cerrarBoton = $('fichaCerrar');
    let anterior = null;
    let alVerDetalle = null;
    let duena = null;  // Quién la abrió: el visor o «Intendente vs Junta»; cada uno la actualiza o la cierra.
    // Abierta o actualizada durante el evento en curso: el mismo toque que la abrió no la cierra al llegar al documento.
    let recien = false;

    function abrir({ eyebrow, titulo, meta, cuerpo, detalle }, propietario) {
        duena = propietario;
        $('fichaEyebrow').textContent = eyebrow ?? '';
        $('fichaTitulo').textContent = titulo;
        $('fichaMeta').textContent = meta ?? '';
        $('fichaCuerpo').replaceChildren(...(cuerpo ? [cuerpo] : []));
        alVerDetalle = detalle ?? null;
        $('fichaDetalle').hidden = !detalle;
        recien = true;
        setTimeout(() => { recien = false; }, 0);
        if (!raiz.hidden) return;
        const activo = document.activeElement;
        anterior = activo instanceof HTMLElement && activo !== document.body ? activo : null;
        raiz.hidden = false;
        raiz.scrollTop = 0;
        cerrarBoton.focus({ preventScroll: true });
    }

    function cerrar({ devolverFoco = true } = {}) {
        if (raiz.hidden) return;
        raiz.hidden = true;
        alVerDetalle = null;
        duena = null;
        if (devolverFoco && anterior?.isConnected) anterior.focus({ preventScroll: true });
        anterior = null;
    }

    cerrarBoton.addEventListener('click', () => cerrar());
    $('fichaDetalle').addEventListener('click', () => {
        const accion = alVerDetalle;
        cerrar({ devolverFoco: false });
        accion?.();
    });
    // Escape cierra primero la ficha; preventDefault avisa al mapa en pantalla completa que ya se usó.
    document.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Escape' || raiz.hidden || evento.defaultPrevented) return;
        evento.preventDefault();
        cerrar();
    });
    // Tocar fuera la cierra. Va en la fase de burbuja: un arrastre del mapa no produce clic y no la cierra.
    // Los botones de zoom tampoco: se puede acercar el mapa sin perder la ficha.
    document.addEventListener('click', (evento) => {
        if (raiz.hidden || recien || raiz.contains(evento.target) || evento.target.closest?.('.mapa__controles')) return;
        cerrar({ devolverFoco: false });
    });

    return { abrir, cerrar, abierta: () => !raiz.hidden, propietario: () => duena };
}
