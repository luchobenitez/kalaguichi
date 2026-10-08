// Panel de resultados de la selección, bancas de la Junta Municipal y «Fuentes y método»: los usan el tablero y la
// vista informe, con los mismos identificadores en las dos plantillas de la página.
import { urlFoto } from '../datos.js';
import { $, el, fmt, pct, svg, titulo, porcentaje } from './util.js';
import { nombreDe, participacion, dhondt } from './modelo.js';

// sel: { titulo, eyebrow, indices, meta }; hayFiltro muestra «Ver toda Asunción».
export function renderTotales(datos, cargo, sel, { hayFiltro }) {
    const total = datos.sumar(sel.indices, cargo);
    $('eyebrowTotales').textContent = `${sel.eyebrow} · ${datos.resumen.cargos[cargo].nombre}`;
    $('tituloTotales').textContent = sel.titulo;
    $('metaTotales').textContent = [sel.meta, `${fmt.format(total.mesas)} ${total.mesas === 1 ? 'mesa' : 'mesas'} con acta`, `${fmt.format(total.emitidos)} votos emitidos`]
        .filter(Boolean).join(' · ');
    $('limpiarSeleccion').hidden = !hayFiltro;
    const contenedor = $('listaResultados');
    contenedor.replaceChildren();
    const orden = total.votos.map((v, j) => j).sort((a, b) => total.votos[b] - total.votos[a]);
    for (const j of orden) {
        const item = datos.listas[cargo][j];
        const fila = el('div', 'resultado');
        fila.dataset.lista = item.num;
        const figura = el('span', 'resultado__foto');
        figura.style.borderColor = item.color;
        if (cargo === '1' && item.foto) {
            const img = el('img');
            img.src = urlFoto(item.foto, datos.contexto.comun);
            img.alt = '';
            img.width = 48;
            img.height = 48;
            img.loading = 'lazy';
            figura.append(img);
        } else {
            figura.textContent = item.sigla.slice(0, 5);
            figura.style.background = item.color;
            figura.classList.add('resultado__foto--sigla');
        }
        const cuerpo = el('div', 'resultado__cuerpo');
        const encabezado = el('div', 'resultado__encabezado');
        encabezado.append(el('strong', 'resultado__nombre', nombreDe(item, cargo)),
            el('span', 'resultado__votos', `${fmt.format(total.votos[j])} votos`));
        const barra = el('div', 'barra');
        const relleno = el('span', 'barra__relleno');
        relleno.style.width = `${total.listas ? (100 * total.votos[j]) / total.listas : 0}%`;
        relleno.style.background = item.color;
        barra.append(relleno);
        const pie = el('div', 'resultado__pie');
        pie.append(el('span', null, cargo === '1' ? `${item.sigla} · ${item.lista}` : `Lista ${item.num}`),
            el('span', 'resultado__pct', `${porcentaje(total.votos[j], total.listas)} %`));
        cuerpo.append(encabezado, barra, pie);
        fila.append(figura, cuerpo);
        contenedor.append(fila);
    }
    const part = $('participacion');
    part.replaceChildren();
    const p = participacion(total);
    if (p !== null) {
        part.append(el('span', 'participacion__titulo', 'Participación'),
            el('strong', 'participacion__valor', `${pct.format(p)} %`),
            el('span', 'participacion__detalle', `${fmt.format(total.emitidos)} votos emitidos de ${fmt.format(total.electores)} electores habilitados en las mesas con acta (padrón).`));
    }
    const dif = $('diferencia');
    dif.replaceChildren();
    if (orden.length > 1 && total.listas) {
        const [a, b] = orden;
        const votos = total.votos[a] - total.votos[b];
        dif.append(el('span', 'diferencia__titulo', 'Diferencia entre las dos más votadas'),
            el('strong', 'diferencia__valor', `${fmt.format(votos)} votos · ${pct.format((100 * votos) / total.listas)} puntos`),
            el('span', 'diferencia__detalle', `${nombreDe(datos.listas[cargo][a], cargo)} sobre ${nombreDe(datos.listas[cargo][b], cargo)}. Porcentajes sobre ${fmt.format(total.listas)} votos a listas.`));
    }
    const otros = $('otrosVotos');
    otros.replaceChildren();
    for (const [etiqueta, valor] of [['Votos a listas', total.listas], ['Blancos', total.blancos], ['Nulos', total.nulos],
        ['No computados', total.nocomputados], ['Emitidos', total.emitidos], ['Electores', total.electores]]) {
        const grupo = el('div');
        grupo.append(el('dt', null, etiqueta), el('dd', null, fmt.format(valor)));
        otros.append(grupo);
    }
    return total;
}

// --- Bancas de la Junta Municipal (hemiciclo con fotos) -----------------------------------------

// Hemiciclo: filas concéntricas con bancas proporcionales al radio; se ocupan por ángulo, de izquierda a derecha.
function posicionesHemiciclo(total) {
    const filas = Math.max(2, Math.round(Math.sqrt(total / 2.6)));
    const radios = Array.from({ length: filas }, (_, i) => 160 + i * 72);
    const suma = radios.reduce((a, b) => a + b, 0);
    const cantidades = radios.map((r) => Math.max(2, Math.round((total * r) / suma)));
    let diferencia = total - cantidades.reduce((a, b) => a + b, 0);
    for (let i = cantidades.length - 1; diferencia !== 0; i = (i - 1 + cantidades.length) % cantidades.length) {
        cantidades[i] += Math.sign(diferencia);
        diferencia -= Math.sign(diferencia);
    }
    const puestos = [];
    radios.forEach((r, i) => {
        for (let k = 0; k < cantidades[i]; k++) {
            const angulo = Math.PI * (1 - k / (cantidades[i] - 1));
            puestos.push({ angulo, x: 380 + r * Math.cos(angulo), y: 380 - r * Math.sin(angulo), r });
        }
    });
    return puestos.sort((a, b) => b.angulo - a.angulo || a.r - b.r);
}

// Bancas de la Junta. Con el TREP: el reparto y las personas electas de candidaturas.json, con sus fotos; en los demás
// distritos (ADR-022), la integración oficial por lista, sin personas, contrastada con el D'Hondt propio. Con el cómputo
// oficial: el reparto D'Hondt sobre los votos oficiales por lista, calculado aquí; las personas electas solo si la
// fuente las trae (resumen.bancas.electos), porque las actas por mesa no tienen el voto preferencial.
export function renderBancas(datos, cargo, { fuente = 'trep', nombreFuente = 'TREP preliminar' } = {}) {
    const panel = $('panelBancas');
    panel.hidden = cargo !== '2';
    if (panel.hidden || panel.dataset.listo) return;
    const b = datos.cand.bancas;
    const listas = datos.listas['2'];
    const ordenar = (electos) => [...electos].sort((x, y) => x.banca - y.banca);
    let porLista, corte, metodo, conPersonas;
    let coincide = null;  // Integración oficial frente al D'Hondt propio (distritos sin personas electas).
    if (fuente === 'trep' && !b.electos) {
        const propio = dhondt(datos.sumar(datos.filas.map((f) => f.i), '2').votos, b.total);
        porLista = listas.map((item, j) => ({ item, n: b.reparto?.[item.num] ?? 0, electos: [] }));
        coincide = listas.every((item, j) => (b.reparto?.[item.num] ?? 0) === propio.reparto[j]);
        [corte, metodo, conPersonas] = [b.cociente_de_corte ?? propio.corte, b.metodo, false];
    } else if (fuente === 'trep') {
        porLista = listas.map((item) => {
            const electos = ordenar(b.electos.filter((e) => e.numLista === item.num));
            return { item, n: electos.length, electos };
        });
        [corte, metodo, conPersonas] = [b.cociente_de_corte, b.metodo, true];
    } else {
        const votos = datos.sumar(datos.filas.map((f) => f.i), '2').votos;
        const reparto = dhondt(votos, b.total);
        const electos = datos.resumen.bancas?.electos ?? [];
        porLista = listas.map((item, j) => ({ item, n: reparto.reparto[j], electos: ordenar(electos.filter((e) => e.numLista === item.num)) }));
        [corte, metodo, conPersonas] = [reparto.corte, "D'Hondt sobre los votos oficiales por lista", electos.length > 0];
    }
    porLista = porLista.filter((x) => x.n).sort((x, y) => y.n - x.n);
    const resumen = porLista.map((x) => `${x.item.sigla} ${x.n}`);
    $('metaBancas').textContent = `${b.total} bancas · ${resumen.join(' · ')} · ${nombreFuente}`;
    const leyenda = $('bancasLeyenda');
    leyenda.replaceChildren();
    for (const { item, n } of porLista) {
        const li = el('li', 'bancas__grupo');
        const numero = el('span', 'bancas__numero', n);
        numero.style.background = item.color;
        const texto = el('span', 'bancas__texto');
        texto.append(el('strong', null, item.sigla), el('span', null, item.lista));
        li.append(numero, texto);
        leyenda.append(li);
    }
    const puestos = posicionesHemiciclo(b.total);
    const lienzo = svg('svg', { viewBox: '0 0 760 412', class: 'bancas__svg', role: 'img', 'aria-label': `Hemiciclo de ${b.total} bancas: ${resumen.join(', ')}` });
    const defs = svg('defs');
    lienzo.append(defs);
    let k = 0;
    for (const { item, n, electos } of porLista) {
        for (let banca = 0; banca < n; banca++) {
            const p = puestos[k];
            const e = electos[banca];
            const grupo = svg('g', { class: 'banca' });
            grupo.dataset.lista = item.num;
            grupo.append(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 28, fill: item.color, class: 'banca__anillo' }));
            if (e?.foto) {
                const recorte = svg('clipPath', { id: `banca-${k}` });
                recorte.append(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 24 }));
                defs.append(recorte);
                grupo.append(svg('image', { href: urlFoto(e.foto, datos.contexto.comun), x: (p.x - 24).toFixed(1), y: (p.y - 24).toFixed(1), width: 48, height: 48,
                    preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#banca-${k})` }));
            }
            titulo(grupo, e ? `${e.nombre} · ${item.sigla}${e.votos_preferenciales ? ` · ${fmt.format(e.votos_preferenciales)} votos preferenciales` : ''}`
                : `${item.sigla} · ${item.lista} · banca ${banca + 1} de ${n}`);
            lienzo.append(grupo);
            k += 1;
        }
    }
    const total = svg('text', { x: 380, y: 352, 'text-anchor': 'middle', class: 'bancas__total' });
    total.textContent = String(b.mayoria);
    const mayoria = svg('text', { x: 380, y: 380, 'text-anchor': 'middle', class: 'bancas__mayoria' });
    mayoria.textContent = 'necesarias para la mayoría';
    lienzo.append(total, mayoria);
    $('bancas').replaceChildren(lienzo);
    const personas = $('bancasPersonas');
    personas.replaceChildren();
    if (conPersonas) {
        for (const { item, electos } of porLista) {
            if (!electos.length) continue;
            const grupo = el('div', 'bancas__lista');
            const encabezado = el('h3', null, `${item.sigla} · ${electos.length} ${electos.length === 1 ? 'banca' : 'bancas'}`);
            encabezado.style.borderColor = item.color;
            const ol = el('ol');
            for (const e of electos) ol.append(el('li', null, e.votos_preferenciales ? `${e.nombre} (${fmt.format(e.votos_preferenciales)} preferenciales)` : e.nombre));
            grupo.append(encabezado, ol);
            personas.append(grupo);
        }
    }
    $('notaBancas').textContent = coincide !== null
        ? `Integración oficial de la Junta según el TREP, con corte en ${fmt.format(Math.round(corte))} votos por banca. ` +
          (coincide ? "Comprobado en esta página: el D'Hondt sobre los votos por lista da el mismo reparto, banca por banca. "
              : "El D'Hondt calculado en esta página sobre los votos por lista no da el mismo reparto: se muestra la integración oficial. ") +
          'Las personas electas surgen del voto preferencial, que las planillas por mesa no traen: no se incluyen. TREP preliminar: no es la ' +
          'proclamación oficial.'
        : fuente === 'trep'
        ? `${metodo}: corte en ${fmt.format(Math.round(corte))} votos por banca. Las personas electas dentro de cada lista surgen del voto ` +
          'preferencial, que las actas por mesa no traen: se toman de la referencia y se contrastaron con el reparto propio. TREP preliminar: ' +
          'no es la proclamación oficial.'
        : `${metodo}: corte en ${fmt.format(Math.round(corte))} votos por banca, calculado en este sitio. Las personas electas dentro de cada ` +
          `lista surgen del voto preferencial, que las actas por mesa no traen: ${conPersonas ? 'se toman de la fuente oficial.' : 'se mostrarán cuando la fuente oficial las publique.'}`;
    panel.dataset.listo = 'true';
}

// --- Fuentes y método y vistas no disponibles ---------------------------------------------------

export function renderFuentes(datos, { fuente = 'trep' } = {}) {
    const r = datos.resumen;
    const faltan = datos.faltantes.map((f) => `mesa ${f.mesa} de ${f.info ? f.info.nombre : `local ${f.local}`} (zona ${f.zona}), ${f.estado}`);
    const fotos = datos.listas['1'].filter((x) => x.foto).length + datos.cand.bancas.electos.filter((e) => e.foto).length;
    const items = [
        ['Votos', `${r.eleccion.fuente}. Etapa ${r.eleccion.etapa}, corte ${r.eleccion.corte}. ${r.eleccion.corte_base}`],
        ['Cobertura', `${fmt.format(r.cobertura.mesas_con_acta)} de ${fmt.format(r.cobertura.mesas_esperadas)} mesas por cargo` + (faltan.length ? `. Sin acta: ${faltan.join('; ')}.` : '.')],
        ['Electores', `${r.electores.fuente}. ${r.electores.nota}`],
        ['Locales', 'Nombre, dirección y ubicación de cada local según el catálogo de locales del padrón; sin datos de personas.'],
        ['Mapas', datos.geo.atribucion],
        ['Bancas', fuente === 'trep' ? `${datos.cand.bancas.metodo}. ${datos.cand.bancas.nota}`
            : `D'Hondt sobre los votos oficiales por lista de las ${fmt.format(r.cobertura.mesas_con_acta)} mesas con acta, calculado en este sitio ` +
              `(${datos.cand.bancas.total} bancas). Las personas electas solo se muestran si la fuente oficial las publica.`],
        ['Pobreza multidimensional', `${datos.ipm.fuente}. Cada barrio se une a su polígono por la clave CLAVE_BAR del INE. ` +
            'Ñu Guasú no tiene población (parque nacional).'],
        ['Candidaturas', `Listas según las actas; nombres en boleta, personas electas y ${fotos} fotos de una referencia pública. ` +
            `${datos.cand.derechos_fotos.atribucion ?? ''} Derechos: ${datos.cand.derechos_fotos.base ?? datos.cand.derechos_fotos.estado}`],
        ['Cálculo', 'Emitidos = votos a listas + blancos + nulos + no computados, verificado en cada acta. Los cargos no se suman entre sí.'],
        ['Procedencia', `SHA-256 de cada acta en datos/procedencia.json. Generado ${r.eleccion.generado_utc}.`],
    ];
    const dl = el('dl', 'fuentes__lista');
    for (const [tituloItem, texto] of items) {
        const grupo = el('div');
        grupo.append(el('dt', null, tituloItem), el('dd', null, texto));
        dl.append(grupo);
    }
    $('fuentes').replaceChildren(dl);
}

// Vistas que los datos declaran no disponibles (y por qué), como tarjetas plegables (vista informe y diálogo «Fuente»).
export function tarjetasNoDisponible(datos, { nivel = 'h2' } = {}) {
    const titulos = { pobreza_monetaria_por_barrio: 'Pobreza monetaria por barrio', historial_2021: 'Comparación histórica',
                      intendencia: 'Intendencia por mesa', pobreza_por_barrio: 'Pobreza multidimensional por barrio' };
    return Object.entries(datos.resumen.no_disponible).map(([clave, motivo]) => {
        const card = el('details', 'info-card info-card--no-disponible plegable');
        card.dataset.vista = clave;
        const resumen = el('summary');
        resumen.append(el('span', 'info-card__estado', 'No disponible'), el(nivel, null, titulos[clave] ?? clave));
        card.append(resumen, el('p', null, motivo));
        return card;
    });
}

export function renderNoDisponible(datos) {
    $('noDisponible').append(...tarjetasNoDisponible(datos));
}
