// Distritos (ADR-025, tarea M29): el mapa de Paraguay con la lista más votada de cada distrito en el cargo de la barra
// (Intendencia o Junta) y un mínimo de electores: los distritos con más electores habilitados que el mínimo llevan el
// color de su lista y los demás van en gris. Los electores son los del padrón (las personas habilitadas para votar), no
// los habitantes. El deslizador va de 0 al máximo de un distrito; el mínimo va en el enlace (electores=…).
import { descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { crearMapaAnalisis, crearDeslizador, grisMinimo as gris, textoCuenta } from './pais_mapa.js';
import { grupoDe, LOCALES, electoresDe, maximoElectores, superaMinimo, minimoDelEnlace } from './pais_datos.js';
import { itemLeyenda } from '../tablero/mapa.js';
import { el, fmt, pct, cantidad } from '../tablero/util.js';

const EN_LEYENDA_LOCALES = 'Alianza o movimiento local';

export function crear(ctx) {
    const { datos } = ctx;
    const maximo = maximoElectores(datos.distritos);
    const estado = { minimo: 0, orden: { id: 'electores', dir: -1 } };
    let filas = [];
    let mostradas = [];

    // El mínimo de electores: deslizador de 0 al máximo, con el valor y la cuenta a la vista (pais_mapa.js).
    const deslizador = crearDeslizador(ctx.controles, {
        id: 'minimoElectores', maximo,
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

    const textoDistrito = (clave) => {
        const d = ctx.delCargo().porClave.get(clave);
        if (!d) return null;
        const supera = superaMinimo(d, estado.minimo);
        return `${d.nombre} (${d.departamento_nombre}): ${d.ganadora} más votada, ${pct.format(d.pct_ganadora)} % · ${fmt.format(electoresDe(d))} electores` +
            (supera || !estado.minimo ? '' : ` (no supera ${fmt.format(estado.minimo)})`);
    };
    const mapa = crearMapaAnalisis(ctx, {
        etiqueta: 'Mapa de Paraguay por distrito con la lista más votada de los distritos que superan el mínimo de electores; los demás, en gris',
        atribucion: { texto: 'Límites: INE (CNPV 2022) · Electores: padrón · Resultados: TREP (Justicia Electoral)',
                      titulo: 'Límites referenciales del INE (CNPV 2022), simplificados. Electores habilitados de cada distrito según el padrón. ' +
                              'Resultados preliminares del TREP (Justicia Electoral).' },
        texto: textoDistrito,
        alCambiarTema: () => { renderMapa(); renderResumen(); },
    });

    const distritos = () => ctx.delCargo().distritos;
    const enFiltro = () => distritos().filter(ctx.enFiltro);

    // Grupos de la leyenda: cada partido con su color y las alianzas y los movimientos locales juntos (en verde).
    function grupos(lista) {
        const por = new Map();
        for (const d of lista) {
            const g = grupoDe(datos, d, d.ganadora, ctx.cargo());
            const r = por.get(g.id) ?? { ...g, n: 0 };
            r.n += 1;
            por.set(g.id, r);
        }
        return [...por.values()].sort((a, b) => b.n - a.n || a.sigla.localeCompare(b.sigla, 'es'));
    }

    function leyendaItems() {
        const dentro = enFiltro();
        const visibles = dentro.filter((d) => superaMinimo(d, estado.minimo));
        const items = grupos(visibles).map((g) => ({ color: g.color, forma: g.forma,
                                                      texto: `${g.id === LOCALES ? EN_LEYENDA_LOCALES : `${g.sigla} más votada`}: ${cantidad(g.n, 'distrito', 'distritos')}` }));
        const fuera = dentro.length - visibles.length;
        if (fuera) items.push({ color: gris(), texto: `Con ${fmt.format(estado.minimo)} electores o menos: ${cantidad(fuera, 'distrito', 'distritos')}` });
        return items;
    }

    function renderMapa() {
        mapa.pintar(distritos(), (d) => ({ color: superaMinimo(d, estado.minimo) ? d.gana.color : gris(), atenuado: !ctx.enFiltro(d) }));
        mapa.leyenda.replaceChildren(...leyendaItems().map((x) => itemLeyenda(x.color, x.texto, null, x.forma)));
    }

    function renderResumen() {
        const dentro = enFiltro();
        deslizador.mostrar(estado.minimo, textoCuenta(ctx, dentro, dentro.filter((d) => superaMinimo(d, estado.minimo)), electoresDe));
    }

    const columnas = () => [
        { id: 'nombre', titulo: 'Distrito', texto: true, v: (f) => f.d.nombre },
        { id: 'departamento', titulo: 'Departamento', texto: true, v: (f) => f.d.departamento_nombre },
        { id: 'electores', titulo: 'Electores (padrón)', v: (f) => electoresDe(f.d) },
        { id: 'ganadora', titulo: 'Lista más votada', texto: true, v: (f) => `${f.d.ganadora} · ${f.d.gana.nombre}` },
        { id: 'pct', titulo: '% de la más votada', v: (f) => f.d.pct_ganadora, f: (v) => `${pct.format(v)} %` },
        { id: 'en_el_mapa', titulo: 'En el mapa', texto: true, v: (f) => (f.supera ? 'Con su color' : 'En gris') },
    ];
    const tabla = el('table', 'tabla');
    const desplazable = el('div', 'tabla-scroll');
    desplazable.append(tabla);
    const nota = el('p', 'nota');
    ctx.tabla.append(desplazable, nota);
    alOrdenar(tabla, estado, columnas, () => renderTabla());

    function renderTabla() {
        filas = enFiltro().map((d) => ({ d, supera: superaMinimo(d, estado.minimo) }));
        mostradas = renderTablaOrdenable(tabla, columnas(), filas, estado, { elegida: (f) => f.supera && estado.minimo > 0 });
        nota.textContent = `${cantidad(filas.length, 'distrito', 'distritos')}; ${filas.filter((f) => f.supera).length} con más de ` +
            `${fmt.format(estado.minimo)} electores habilitados. Lista más votada de ${ctx.nombreCargo()}; electores del padrón.`;
    }

    const lectura = el('div');
    ctx.lectura.append(lectura);
    function renderLectura() {
        const dentro = enFiltro();
        const visibles = dentro.filter((d) => superaMinimo(d, estado.minimo));
        const mayor = [...dentro].sort((a, b) => electoresDe(b) - electoresDe(a))[0];
        const partes = [el('p', null, `Cada distrito lleva el color de su lista más votada en ${ctx.nombreCargo()}; el cargo se cambia en la barra ` +
            '(Intendencia o Junta). Las alianzas y los movimientos locales van en verde.')];
        partes.push(el('p', null, estado.minimo
            ? `Con el mínimo en ${fmt.format(estado.minimo)}, se ven con su color ${cantidad(visibles.length, 'distrito', 'distritos')} con más de ` +
              `${fmt.format(estado.minimo)} electores habilitados; ${cantidad(dentro.length - visibles.length, 'otro va', 'otros van')} en gris.`
            : `Con el mínimo en 0, se ven los ${cantidad(dentro.length, 'distrito', 'distritos')} con su color. Al mover el deslizador, los que no superan ` +
              'el mínimo quedan en gris.'));
        if (estado.minimo && visibles.length) partes.push(el('p', null, 'Los distritos con más electores suelen ser ciudades, chicas en el mapa del país: ' +
            'acercá el mapa (botón +) o mirá la tabla, que los ordena por electores.'));
        if (mayor) partes.push(el('p', null, `Los electores habilitados son las personas del padrón que pueden votar en el distrito, no sus habitantes. ` +
            `El que más tiene es ${mayor.nombre}: ${fmt.format(electoresDe(mayor))}.`));
        partes.push(el('p', null, 'Resultados preliminares del TREP: no reemplazan al cómputo oficial.'));
        lectura.replaceChildren(...partes);
    }

    async function render() {
        renderResumen();
        renderTabla();
        renderLectura();
        await renderMapa();
    }

    const nombre = () => nombreArchivo('distritos', ctx.nombreCargo(), estado.minimo ? `mas-de-${estado.minimo}` : null, ctx.textoFiltro());
    const titulo = () => `Lista más votada por distrito · ${ctx.nombreCargo()} · ${estado.minimo ? `más de ${fmt.format(estado.minimo)} electores` : 'todos los distritos'}`;
    return {
        titulo: 'Distritos',
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
        estadoEnlace: () => ({ electores: estado.minimo ? String(estado.minimo) : null }),
        aplicarEnlace(p) { estado.minimo = minimoDelEnlace(p.get('electores'), maximo); },
    };
}
