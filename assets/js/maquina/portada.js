// Portada de «Máquina de votación» (ADR 0011 del módulo): la página de vulnerabilidades vivía antes en esta dirección;
// sus enlaces llevan el estado en el hash (filtros o el detalle abierto) y se redirigen a su ruta nueva con el mismo hash.
// También si el hash cambia con la portada abierta (un enlace pegado en la barra de direcciones).
function redirigir() {
    const pedido = new URLSearchParams(location.hash.slice(1));
    if (['software', 'categoria', 'severidad', 'q'].some((clave) => pedido.has(clave))) {
        location.replace(`vulnerabilidades/${location.hash}`);
    }
}

redirigir();
addEventListener('hashchange', redirigir);
