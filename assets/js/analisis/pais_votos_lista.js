// Votos de una lista (ADR-027, tarea M32): el mapa de Paraguay con los votos de la lista elegida en cada distrito, en el
// cargo de la barra (Intendencia o Junta): un partido, donde presentó lista propia, o las alianzas y los movimientos
// locales de cada distrito, juntos. En porcentaje de los votos a listas del distrito (cinco tramos de igual ancho, como la
// capa del mapa del país) o en cantidad de votos (quintiles: los distritos grandes no aplastan a los demás). Con el
// mínimo de electores del padrón de «Distritos»: los que no lo superan, en gris; los que no tienen esa lista, en el gris
// claro de «sin dato». Los tramos salen de los distritos a la vista: al subir el mínimo, se reparten entre los que quedan.
// Estado en el enlace: partido=…, medida=cantidad y electores=….
import { descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { crearMapaAnalisis, crearDeslizador, grisMinimo, textoCuenta } from './pais_mapa.js';
import { LOCALES, NOMBRE_LOCALES, electoresDe, maximoElectores, superaMinimo, minimoDelEnlace, votosDeLista, pctDeLista, segmentos } from './pais_datos.js';
import { itemLeyenda, mezclar, opacidadPaso, escala, cuantiles, paleta } from '../tablero/mapa.js';
import { el, fmt, pct, cantidad } from '../tablero/util.js';

const MEDIDAS = [['porcentaje', 'Porcentaje'], ['cantidad', 'Cantidad']];
const PARTIDO_POR_OMISION = 'ANR';
const PASOS = 5;

export function crear(ctx) {
    const { datos } = ctx;
    const maximo = maximoElectores(datos.distritos);
    const estado = { partido: PARTIDO_POR_OMISION, medida: 'porcentaje', minimo: 0, orden: { id: 'pct', dir: -1 } };
    let mostradas = [];
    let cargoDeLasOpciones = null;

    // Controles: la lista (los partidos del cargo, por cantidad de distritos, y las alianzas y movimientos locales), la
    // medida y el mínimo de electores.
    const campo = el('label', 'campo-select');
    const select = el('select');
    select.id = 'listaVotos';
    campo.append('Lista ', select);
    const medidas = segmentos('Medida', MEDIDAS, 'medida');
    ctx.controles.append(campo, medidas);
    const deslizador = crearDeslizador(ctx.controles, {
        id: 'minimoElectoresLista', maximo,
        alMover: (minimo) => {
            estado.minimo = minimo;
            renderMapa();
            renderResumen();
        },
        alSoltar: () => {
            renderTabla();
            renderLectura();
            ctx.alCambiar();
        },
    });
    select.addEventListener('change', () => {
        estado.partido = select.value;
        render();
        ctx.alCambiar();
    });
    medidas.addEventListener('click', (evento) => {
        const boton = evento.target.closest('[data-medida]');
        if (!boton || boton.dataset.medida === estado.medida) return;
        fijarMedida(boton.dataset.medida);
        render();
        ctx.alCambiar();
    });
    // La tabla, ordenada por la medida del mapa, salvo que se haya elegido otra columna.
    function fijarMedida(medida) {
        estado.medida = medida;
        if (estado.orden.id === 'pct' || estado.orden.id === 'votos') estado.orden = { id: medida === 'cantidad' ? 'votos' : 'pct', dir: -1 };
    }

    const distritos = () => ctx.delCargo().distritos;
    const enFiltro = () => distritos().filter(ctx.enFiltro);
    const aLaVista = () => enFiltro().filter((d) => superaMinimo(d, estado.minimo));
    const esLocales = () => estado.partido === LOCALES;
    const partido = () => ctx.delCargo().partidos.get(estado.partido);
    const etiqueta = () => (esLocales() ? NOMBRE_LOCALES : estado.partido);
    const colorLista = () => (esLocales() ? datos.colores.verdes[0] : partido()?.color ?? '#94a3b8');
    const valorDe = (d) => (estado.medida === 'cantidad' ? votosDeLista(d, estado.partido) : pctDeLista(d, estado.partido));
    const formato = (v) => (estado.medida === 'cantidad' ? fmt.format(Math.round(v)) : `${pct.format(v)} %`);

    // Los partidos con lista propia en el cargo y las alianzas y los movimientos locales (se arman al cambiar de cargo); si
    // la lista elegida no está en el cargo (un partido que solo presentó Junta, por ejemplo, o una del enlace), la primera.
    function armarOpciones() {
        if (cargoDeLasOpciones !== ctx.cargo()) {
            cargoDeLasOpciones = ctx.cargo();
            const partidos = [...ctx.delCargo().partidos.values()].sort((a, b) => b.distritos - a.distritos || a.sigla.localeCompare(b.sigla, 'es'));
            const conLocales = distritos().filter((d) => votosDeLista(d, LOCALES) !== null).length;
            const opciones = [...partidos.map((p) => [p.sigla, `${p.sigla} · ${p.nombre} (${cantidad(p.distritos, 'distrito', 'distritos')})`]),
                              [LOCALES, `${NOMBRE_LOCALES}, juntos (${cantidad(conLocales, 'distrito', 'distritos')})`]];
            select.replaceChildren(...opciones.map(([id, texto]) => new Option(texto, id)));
        }
        if (![...select.options].some((o) => o.value === estado.partido)) estado.partido = select.options[0].value;
        select.value = estado.partido;
    }

    // Los tramos, de los distritos a la vista (del filtro y sobre el mínimo) con la lista; con un solo valor, un tramo.
    function tramos() {
        const valores = aLaVista().map(valorDe).filter((v) => v !== null);
        if (!valores.length) return null;
        if (Math.min(...valores) === Math.max(...valores)) return { unico: true, cortes: [valores[0], valores[0]], clase: () => PASOS - 1 };
        return estado.medida === 'cantidad' ? cuantiles(valores, PASOS) : escala(valores, PASOS);
    }

    // Cómo va un distrito: debajo del mínimo, sin la lista o con su tramo.
    function situacion(d, t) {
        if (!superaMinimo(d, estado.minimo)) return { tipo: 'gris' };
        const v = valorDe(d);
        if (v === null || !t) return { tipo: 'sin' };
        return { tipo: 'tramo', k: Math.max(0, Math.min(PASOS - 1, t.clase(v))), v };
    }

    const textoDistrito = (clave) => {
        const d = ctx.delCargo().porClave.get(clave);
        if (!d) return null;
        const base = `${d.nombre} (${d.departamento_nombre})`;
        const electores = `${fmt.format(electoresDe(d))} electores`;
        const votos = votosDeLista(d, estado.partido);
        const debajo = superaMinimo(d, estado.minimo) || !estado.minimo ? '' : ` (no supera ${fmt.format(estado.minimo)})`;
        if (votos === null) return `${base}: sin lista propia de ${etiqueta()} · ${electores}${debajo}`;
        const candidato = ctx.cargo() === '1' && !esLocales() ? d.listas[estado.partido]?.candidato : null;
        return `${base}: ${etiqueta()}${candidato ? ` (${candidato})` : ''} ${pct.format(pctDeLista(d, estado.partido))} % · ${fmt.format(votos)} votos · ` +
            `${electores}${debajo}`;
    };
    const mapa = crearMapaAnalisis(ctx, {
        etiqueta: 'Mapa de Paraguay por distrito con los votos de la lista elegida; los que no superan el mínimo de electores, en gris',
        atribucion: { texto: 'Límites: INE (CNPV 2022) · Electores: padrón · Resultados: TREP (Justicia Electoral)',
                      titulo: 'Límites referenciales del INE (CNPV 2022), simplificados. Electores habilitados de cada distrito según el padrón. ' +
                              'Resultados preliminares del TREP (Justicia Electoral).' },
        texto: textoDistrito,
        alCambiarTema: () => { renderMapa(); renderResumen(); },
    });

    function leyendaItems() {
        const t = tramos();
        const dentro = enFiltro();
        const cuentas = { tramo: new Array(PASOS).fill(0), sin: 0, gris: 0 };
        for (const d of dentro) {
            const s = situacion(d, t);
            if (s.tipo === 'tramo') cuentas.tramo[s.k] += 1;
            else cuentas[s.tipo] += 1;
        }
        const items = [];
        if (t?.unico) {
            items.push({ color: mezclar(colorLista(), opacidadPaso(PASOS - 1)), texto: `${formato(t.cortes[0])} · ${cantidad(cuentas.tramo[PASOS - 1], 'distrito', 'distritos')}` });
        } else if (t) {
            cuentas.tramo.forEach((n, k) => {
                // Los quintiles de pocos distritos repiten cortes: sin los tramos vacíos de ancho cero.
                if (!n && t.cortes[k] === t.cortes[k + 1]) return;
                items.push({ color: mezclar(colorLista(), opacidadPaso(k)), texto: `${formato(t.cortes[k])} a ${formato(t.cortes[k + 1])} · ${cantidad(n, 'distrito', 'distritos')}` });
            });
        }
        if (cuentas.sin) items.push({ color: paleta().sinDatos, texto: `Sin lista propia de ${etiqueta()}: ${cantidad(cuentas.sin, 'distrito', 'distritos')}` });
        if (cuentas.gris) items.push({ color: grisMinimo(), texto: `Con ${fmt.format(estado.minimo)} electores o menos: ${cantidad(cuentas.gris, 'distrito', 'distritos')}` });
        return items;
    }

    function renderMapa() {
        const t = tramos();
        mapa.leyenda.replaceChildren(...leyendaItems().map((x) => itemLeyenda(x.color, x.texto)));
        return mapa.pintar(distritos(), (d) => {
            const s = situacion(d, t);
            const color = s.tipo === 'gris' ? grisMinimo() : s.tipo === 'sin' ? paleta().sinDatos : mezclar(colorLista(), opacidadPaso(s.k));
            return { color, atenuado: !ctx.enFiltro(d) };
        });
    }

    function renderResumen() {
        const dentro = enFiltro();
        deslizador.mostrar(estado.minimo, textoCuenta(ctx, dentro, dentro.filter((d) => superaMinimo(d, estado.minimo)), electoresDe));
        for (const boton of medidas.querySelectorAll('[data-medida]')) boton.setAttribute('aria-pressed', String(boton.dataset.medida === estado.medida));
    }

    const columnas = () => [
        { id: 'nombre', titulo: 'Distrito', texto: true, v: (f) => f.d.nombre },
        { id: 'departamento', titulo: 'Departamento', texto: true, v: (f) => f.d.departamento_nombre },
        { id: 'electores', titulo: 'Electores (padrón)', v: (f) => electoresDe(f.d) },
        { id: 'votos', titulo: `Votos de ${etiqueta()}`, v: (f) => f.votos },
        { id: 'pct', titulo: '% de los votos a listas', v: (f) => f.pct, f: (v) => (v === null ? '—' : `${pct.format(v)} %`) },
        columnaLista(),
        { id: 'en_el_mapa', titulo: 'En el mapa', texto: true, v: (f) => f.en_el_mapa },
    ].filter(Boolean);
    // La columna de la lista: en Intendencia, la candidatura (con las locales, cada sigla con la suya); en la Junta, las
    // siglas de las locales (la de un partido es la misma lista en todos los distritos).
    function columnaLista() {
        if (ctx.cargo() === '1') return { id: 'lista', titulo: 'Candidatura', texto: true, v: (f) => f.lista };
        return esLocales() ? { id: 'lista', titulo: 'Listas', texto: true, v: (f) => f.lista } : null;
    }
    const tabla = el('table', 'tabla');
    const desplazable = el('div', 'tabla-scroll');
    desplazable.append(tabla);
    const nota = el('p', 'nota');
    ctx.tabla.append(desplazable, nota);
    alOrdenar(tabla, estado, columnas, () => renderTabla());

    function listaDe(d) {
        if (!esLocales()) return d.listas[estado.partido]?.candidato ?? null;
        const locales = Object.entries(d.listas).filter(([, x]) => x.tipo !== 'partido');
        if (!locales.length) return null;
        return ctx.cargo() === '1' ? locales.map(([s, x]) => (x.candidato ? `${s} · ${x.candidato}` : s)).join('; ') : locales.map(([s]) => s).join(', ');
    }

    function renderTabla() {
        const t = tramos();
        const filas = enFiltro().map((d) => {
            const s = situacion(d, t);
            return { d, votos: votosDeLista(d, estado.partido), pct: pctDeLista(d, estado.partido), lista: listaDe(d),
                     en_el_mapa: s.tipo === 'gris' ? 'En gris' : s.tipo === 'sin' ? 'Sin lista propia' : 'Con su color' };
        });
        mostradas = renderTablaOrdenable(tabla, columnas(), filas, estado, { elegida: (f) => f.en_el_mapa === 'Con su color' && estado.minimo > 0 });
        const con = filas.filter((f) => f.votos !== null);
        nota.textContent = `${cantidad(filas.length, 'distrito', 'distritos')}; ${etiqueta()}, con lista en ${con.length}. Votos de ${ctx.nombreCargo()}; ` +
            'el porcentaje es sobre los votos a listas del distrito; electores del padrón.';
    }

    const lectura = el('div');
    ctx.lectura.append(lectura);
    function renderLectura() {
        const dentro = enFiltro();
        const visibles = aLaVista();
        const conLista = (lista) => lista.filter((d) => votosDeLista(d, estado.partido) !== null);
        const cifra = (lista) => {
            const votos = lista.reduce((a, d) => a + votosDeLista(d, estado.partido), 0);
            const aListas = lista.reduce((a, d) => a + d.votos_listas, 0);
            return `${fmt.format(votos)} votos, el ${pct.format(aListas ? (100 * votos) / aListas : 0)} % de los votos a listas`;
        };
        const suma = (lista) => `${cifra(lista)} de ${lista.length === 1 ? 'ese distrito' : 'esos distritos'}`;
        const con = conLista(dentro);
        const conVisibles = conLista(visibles);
        const tuvo = esLocales() ? 'Hubo alianzas o movimientos locales' : `${estado.partido} presentó lista propia`;
        const tiene = esLocales() ? 'alianzas o movimientos locales' : `lista propia de ${estado.partido}`;
        const partes = [el('p', null, `Cada distrito con el color de ${esLocales() ? 'sus alianzas y movimientos locales, juntos' : estado.partido} en ` +
            `${ctx.nombreCargo()}: más intenso, ${estado.medida === 'cantidad' ? 'más votos' : 'más porcentaje de los votos a listas'}. ` +
            (estado.medida === 'cantidad' ? 'Tramos: quintiles, cinco grupos con casi la misma cantidad de distritos a la vista.'
                : 'Tramos: cinco de igual ancho entre el menor y el mayor de los distritos a la vista.') + ' El cargo se cambia en la barra.')];
        const donde = ctx.filtro() ? ` de ${ctx.textoFiltro()}` : '';
        partes.push(el('p', null, con.length ? `${tuvo} en ${con.length} de ${cantidad(dentro.length, 'distrito', 'distritos')}${donde}: ${suma(con)}.`
            : `${esLocales() ? 'No hubo alianzas ni movimientos locales' : `${estado.partido} no presentó lista propia`} en ${cantidad(dentro.length, 'distrito', 'distritos')}${donde}.`));
        // Con el mínimo: cuántos quedan a la vista y qué tuvo la lista en ellos (uno, varios o ninguno).
        if (estado.minimo) {
            const n = visibles.length;
            const k = conVisibles.length;
            const inicio = `Con el mínimo en ${fmt.format(estado.minimo)}, `;
            let enEllos = '';
            if (n && !k) enEllos = n === 1 ? ` No tiene ${tiene.replace(' o ', ' ni ')}.` : ` Ninguno tiene ${tiene.replace(' o ', ' ni ')}.`;
            else if (n === 1) enEllos = ` Allí, ${esLocales() ? 'las alianzas y los movimientos locales sacaron' : `${estado.partido} sacó`} ${cifra(conVisibles)}.`;
            else if (n) enEllos = ` ${k === n ? 'En todos' : `En ${k} de ellos`} hay ${tiene}: ${suma(conVisibles)}.`;
            partes.push(el('p', null, n ? `${inicio}${n === 1 ? 'queda a la vista 1 distrito' : `quedan a la vista ${cantidad(n, 'distrito', 'distritos')}`} con ` +
                `más de ${fmt.format(estado.minimo)} electores habilitados; los demás, en gris.${enEllos}`
                : `${inicio}ningún distrito${donde} tiene más electores habilitados: todos van en gris.`));
        }
        const mayor = [...conVisibles].sort((a, b) => valorDe(b) - valorDe(a))[0];
        if (mayor && conVisibles.length > 1) {
            partes.push(el('p', null, `El distrito ${estado.medida === 'cantidad' ? 'con más votos' : 'con mayor porcentaje'}${estado.minimo ? ' entre los que se ven' : ''} ` +
                `es ${mayor.nombre} (${formato(valorDe(mayor))}).`));
        }
        const sin = visibles.length - conVisibles.length;
        if (sin && !esLocales()) partes.push(el('p', null, `En gris claro, ${cantidad(sin, 'distrito', 'distritos')} sin lista propia de ${estado.partido}: puede ir dentro de una alianza.`));
        partes.push(el('p', null, 'Los electores habilitados son las personas del padrón que pueden votar en el distrito, no sus habitantes. ' +
            'Resultados preliminares del TREP: no reemplazan al cómputo oficial.'));
        lectura.replaceChildren(...partes);
    }

    async function render() {
        armarOpciones();
        renderResumen();
        renderTabla();
        renderLectura();
        await renderMapa();
    }

    const medidaTexto = () => (estado.medida === 'cantidad' ? 'cantidad de votos' : 'porcentaje de los votos a listas');
    const titulo = () => `Votos de ${etiqueta()} por distrito · ${ctx.nombreCargo()} · ${medidaTexto()}` +
        (estado.minimo ? ` · más de ${fmt.format(estado.minimo)} electores` : '');
    const nombre = () => nombreArchivo('votos', esLocales() ? 'locales' : estado.partido, ctx.nombreCargo(), estado.medida,
                                       estado.minimo ? `mas-de-${estado.minimo}` : null, ctx.textoFiltro());
    return {
        titulo: 'Votos de una lista',
        meta: () => `${titulo()} · ${ctx.textoFiltro()}`,
        render,
        alCambiarTema: () => {},
        csv: () => descargarCsv(nombre(), columnas(), mostradas),
        async png() {
            const imagen = await mapa.imagen();
            if (!imagen) return;
            descargarPng(imagen.lienzo, { nombre: nombre(), titulo: `${titulo()} · ${ctx.textoFiltro()}`, escala: imagen.escala, leyenda: leyendaItems(),
                                          fuente: `${ctx.textoFuente()} · Electores: padrón · Límites: INE` });
        },
        estadoEnlace: () => ({ partido: estado.partido === PARTIDO_POR_OMISION ? null : estado.partido, medida: estado.medida === 'porcentaje' ? null : estado.medida,
                               electores: estado.minimo ? String(estado.minimo) : null }),
        aplicarEnlace(p) {
            estado.partido = p.get('partido') || PARTIDO_POR_OMISION;
            fijarMedida(p.get('medida') === 'cantidad' ? 'cantidad' : 'porcentaje');
            estado.minimo = minimoDelEnlace(p.get('electores'), maximo);
        },
    };
}
