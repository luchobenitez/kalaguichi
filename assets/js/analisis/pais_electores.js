// Electores por distrito (ADR-025, tarea M29): el mapa de Paraguay con el color de los electores habilitados de cada
// distrito según el padrón, la cantidad de votos posibles (la misma en Intendencia y en Junta), en seis tramos fijos.
// Los electores son las personas habilitadas para votar, no los habitantes.
import { descargarCsv, descargarPng, nombreArchivo, renderTablaOrdenable, alOrdenar } from './exportar.js';
import { crearMapaAnalisis } from './pais_mapa.js';
import { electoresDe, CORTES_ELECTORES, tramoElectores, textoTramo } from './pais_datos.js';
import { itemLeyenda, mezclar, opacidadPaso } from '../tablero/mapa.js';
import { el, fmt, pct, pct2, cantidad, porcentaje } from '../tablero/util.js';

// Un solo tono, de claro a intenso, mezclado con la superficie del tema (como la participación y el IPM del país).
export const ELECTORES_COLOR = '#0891b2';
const TRAMOS = CORTES_ELECTORES.length + 1;
const colorTramo = (k) => mezclar(ELECTORES_COLOR, opacidadPaso(k, TRAMOS));

export function crear(ctx) {
    const { datos } = ctx;
    const estado = { orden: { id: 'electores', dir: -1 } };
    let mostradas = [];

    // Los electores son del padrón: iguales en los dos cargos (la lista de distritos es la del índice).
    const enFiltro = () => datos.distritos.filter(ctx.enFiltro);
    const totalDe = (lista) => lista.reduce((a, d) => a + electoresDe(d), 0);

    const textoDistrito = (clave) => {
        const d = datos.porClave.get(clave);
        if (!d) return null;
        return `${d.nombre} (${d.departamento_nombre}): ${fmt.format(electoresDe(d))} electores habilitados · ` +
            `${pct2.format((100 * electoresDe(d)) / totalDe(datos.distritos))} % del padrón`;
    };
    const mapa = crearMapaAnalisis(ctx, {
        etiqueta: 'Mapa de Paraguay por distrito coloreado según sus electores habilitados (padrón), en seis tramos',
        atribucion: { texto: 'Límites: INE (CNPV 2022) · Electores: padrón',
                      titulo: 'Límites referenciales del INE (CNPV 2022), simplificados. Electores habilitados de cada distrito según el padrón ' +
                              '(recuento por mesa, sin datos de personas). Sin mapa base de calles.' },
        texto: textoDistrito,
        alCambiarTema: () => renderMapa(),
    });

    function leyendaItems() {
        const dentro = enFiltro();
        const total = totalDe(dentro);
        return Array.from({ length: TRAMOS }, (_, k) => {
            const suyos = dentro.filter((d) => tramoElectores(electoresDe(d)) === k);
            return { color: colorTramo(k), texto: `${textoTramo(k, fmt)}: ${cantidad(suyos.length, 'distrito', 'distritos')} (${porcentaje(totalDe(suyos), total)} %)` };
        });
    }

    function renderMapa() {
        mapa.leyenda.replaceChildren(...leyendaItems().map((x) => itemLeyenda(x.color, x.texto)));
        return mapa.pintar(datos.distritos, (d) => ({ color: colorTramo(tramoElectores(electoresDe(d))), atenuado: !ctx.enFiltro(d) }));
    }

    const columnas = () => [
        { id: 'nombre', titulo: 'Distrito', texto: true, v: (d) => d.nombre },
        { id: 'departamento', titulo: 'Departamento', texto: true, v: (d) => d.departamento_nombre },
        { id: 'electores', titulo: 'Electores (padrón)', v: (d) => electoresDe(d) },
        { id: 'parte', titulo: '% del padrón', v: (d) => (100 * electoresDe(d)) / totalDe(datos.distritos), f: (v) => `${pct2.format(v)} %` },
        { id: 'tramo', titulo: 'Tramo', texto: true, v: (d) => textoTramo(tramoElectores(electoresDe(d)), fmt) },
        { id: 'mesas', titulo: 'Mesas', v: (d) => d.mesas.esperadas },
        { id: 'locales', titulo: 'Locales', v: (d) => d.locales },
    ];
    const tabla = el('table', 'tabla');
    const desplazable = el('div', 'tabla-scroll');
    desplazable.append(tabla);
    const nota = el('p', 'nota');
    ctx.tabla.append(desplazable, nota);
    alOrdenar(tabla, estado, columnas, () => renderTabla());

    function renderTabla() {
        const dentro = enFiltro();
        mostradas = renderTablaOrdenable(tabla, columnas(), dentro, estado);
        nota.textContent = `${cantidad(dentro.length, 'distrito', 'distritos')} · ${fmt.format(totalDe(dentro))} electores habilitados según el padrón. ` +
            'El % es sobre el padrón de todo el país.';
    }

    const lectura = el('div');
    ctx.lectura.append(lectura);
    function renderLectura() {
        const dentro = enFiltro();
        const orden = [...dentro].sort((a, b) => electoresDe(a) - electoresDe(b));
        const total = totalDe(dentro);
        const mediana = orden.length ? (orden.length % 2 ? electoresDe(orden[(orden.length - 1) / 2])
            : (electoresDe(orden[orden.length / 2 - 1]) + electoresDe(orden[orden.length / 2])) / 2) : 0;
        const grandes = dentro.filter((d) => tramoElectores(electoresDe(d)) === TRAMOS - 1);
        const partes = [el('p', null, 'Cada distrito con el color de sus electores habilitados según el padrón: la cantidad de votos posibles, la misma ' +
            'para Intendencia y para Junta. Más intenso, más electores; cada tramo incluye su límite inferior.')];
        if (orden.length) {
            partes.push(el('p', null, `${ctx.filtro() ? ctx.textoFiltro() : 'El país'} tiene ${fmt.format(total)} electores en ` +
                `${cantidad(orden.length, 'distrito', 'distritos')}; la mitad de los distritos tiene menos de ${fmt.format(Math.round(mediana))}. ` +
                `El que más tiene es ${orden.at(-1).nombre} (${fmt.format(electoresDe(orden.at(-1)))}) y el que menos, ${orden[0].nombre} ` +
                `(${fmt.format(electoresDe(orden[0]))}).`));
            if (grandes.length) {
                partes.push(el('p', null, `${cantidad(grandes.length, 'distrito tiene', 'distritos tienen')} ${fmt.format(CORTES_ELECTORES.at(-1))} electores o más: ` +
                    `reúnen el ${pct.format((100 * totalDe(grandes)) / total)} % de los electores${ctx.filtro() ? ` de ${ctx.textoFiltro()}` : ' del país'}.`));
            }
        }
        partes.push(el('p', null, 'Los electores habilitados son las personas del padrón que pueden votar en el distrito, no sus habitantes. Es un ' +
            'recuento por mesa, sin datos de personas.'));
        lectura.replaceChildren(...partes);
    }

    async function render() {
        renderTabla();
        renderLectura();
        await renderMapa();
    }

    const nombre = () => nombreArchivo('electores_por_distrito', ctx.textoFiltro());
    const titulo = 'Electores habilitados por distrito (padrón)';
    return {
        titulo: 'Electores por distrito',
        meta: () => `${titulo} · los votos posibles, iguales en Intendencia y Junta · ${ctx.textoFiltro()}`,
        render,
        alCambiarTema: () => {},
        csv: () => descargarCsv(nombre(), columnas(), mostradas),
        async png() {
            const imagen = await mapa.imagen();
            if (!imagen) return;
            descargarPng(imagen.lienzo, { nombre: nombre(), titulo: `${titulo} · ${ctx.textoFiltro()}`, escala: imagen.escala, leyenda: leyendaItems(),
                                          fuente: 'Electores: padrón · Límites: INE (CNPV 2022)' });
        },
        estadoEnlace: () => ({}),
        aplicarEnlace() {},
    };
}
