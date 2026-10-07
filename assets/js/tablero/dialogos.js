// Diálogos del tablero (etapa 1 de ADR 0010 del módulo): «Fuente» (fuentes y licencias, corte y procedencia SHA-256),
// «Método» (cómo se calcula cada cifra) y «Estadísticas generales» de la selección geográfica y el cargo activos, con
// la estadística descriptiva por mesa. Se arman al abrirse con los datos ya cargados; procedencia.json se lee solo al
// abrir «Fuente». Sin HTML desde datos: el texto va con textContent.
import { crearDialogo } from '../dialogo.js';
import { cargarEleccion, carpeta } from '../datos.js';
import { el, fmt, pct, cantidad, porcentaje } from './util.js';
import { UMBRAL_PRINCIPAL, estadisticas } from './modelo.js';
import { tarjetasNoDisponible } from './panel.js';

// «04/10/2026 23:48» desde «2026-10-04T23:48:02» (hora de Paraguay, sin zona): sin pasar por Date, que la cambiaría.
const fechaLarga = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso ?? '');
    return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : iso ?? '';
};
const HUELLA = /^[0-9a-f]{64}$/;
const NOMBRES_PROCEDENCIA = {
    referencia_mesas: 'Referencia de mesas del TREP', barrios_kml: 'Barrios (KML del INE)', distrito_kml: 'Límite del distrito (KML del INE)',
    catalogo_candidaturas: 'Catálogo de candidaturas', zonas_municipales: 'Zonas municipales (Municipalidad de Asunción)',
    rio_paraguay: 'Río Paraguay (Municipalidad de Asunción)', poblacion_barrios: 'Población por barrio (INE, Censo 2022)',
    ipm_barrios: 'Pobreza multidimensional por barrio (INE, Censo 2022)', catalogo_de_locales: 'Catálogo de locales',
    electores_por_mesa: 'Electores por mesa',
};
const decimal = (v) => (v === null || v === undefined ? '—' : pct.format(v));

function seccion(titulo, ...hijos) {
    const nodo = el('section', 'dialogo__seccion');
    nodo.append(el('h3', null, titulo), ...hijos);
    return nodo;
}

// items: [título, texto o nodos]; los textos van como nodos de texto.
function lista(items) {
    const dl = el('dl', 'fuentes__lista');
    for (const [titulo, contenido] of items) {
        const grupo = el('div');
        const dd = el('dd');
        dd.append(...[contenido].flat());
        grupo.append(el('dt', null, titulo), dd);
        dl.append(grupo);
    }
    return dl;
}

// filas: [encabezado de fila, ...celdas], cada una texto o nodos; columnas: textos del encabezado (el primero, de las filas).
function tabla(titulo, columnas, filas, clase = '') {
    const caja = el('div', 'tabla-compacta__caja');
    const t = el('table', `tabla-compacta ${clase}`.trim());
    t.append(el('caption', null, titulo));
    const cabeza = el('tr');
    for (const texto of columnas) {
        const th = el('th', null, texto);
        th.scope = 'col';
        cabeza.append(th);
    }
    t.createTHead().append(cabeza);
    const cuerpo = t.createTBody();
    const celda = (tag, contenido) => {
        const nodo = el(tag);
        nodo.append(...[contenido].flat());
        return nodo;
    };
    for (const [encabezado, ...celdas] of filas) {
        const tr = el('tr');
        const th = celda('th', encabezado);
        th.scope = 'row';
        tr.append(th, ...celdas.map((c) => celda('td', c)));
        cuerpo.append(tr);
    }
    caja.append(t);
    return caja;
}

const nombreLista = (item, cargo) => (cargo === '1' ? `${item.nombre} (${item.sigla})` : `${item.sigla} (lista ${item.num})`);
const textoSinActa = (f) => `mesa ${f.mesa} de ${f.info ? f.info.nombre : `local ${f.local}`} (zona ${f.zona}), ${f.estado.replaceAll('-', ' ')}`;
// Nombre del cargo como en la barra de contexto (manifiesto); si falta, el de las actas.
function nombreCargo(datos, cargo) {
    const anio = datos.contexto.anio;
    const clave = Object.entries(anio.claves_cargo ?? {}).find(([, v]) => v === cargo)?.[0];
    return anio.nombres_cargo?.[clave] ?? datos.resumen.cargos[cargo].nombre;
}

function lineaFuente(datos, fuente) {
    const info = datos.contexto.anio.fuentes?.[fuente] ?? {};
    const momento = info.corte ?? info.fecha;
    const p = el('p');
    p.append(el('strong', null, info.nombre ?? (fuente === 'trep' ? 'TREP preliminar' : 'Cómputo oficial')));
    if (momento) p.append(` · ${fuente === 'trep' ? 'corte' : 'cómputo'} del ${fechaLarga(momento)}`);
    return p;
}

// --- Fuente ---------------------------------------------------------------------------------------------------------

async function contenidoFuente(datos, fuente) {
    const r = datos.resumen;
    const { eleccion, anio } = datos.contexto;
    const info = anio.fuentes?.[fuente] ?? {};
    const cob = r.cobertura;
    const momento = info.corte ?? info.fecha;
    const corte = fuente === 'trep'
        ? `Corte del ${fechaLarga(momento)} (hora de Paraguay).${r.eleccion.corte_base ? ` ${r.eleccion.corte_base}` : ''}`
        : momento ? `Cómputo del ${fechaLarga(momento)}.` : 'Sin fecha de cómputo publicada.';
    const ref = datos.cand.fuente?.nombres_y_fotos;
    const derechos = datos.cand.derechos_fotos ?? {};
    const fotos = datos.listas['1'].filter((x) => x.foto).length + (datos.cand.bancas.electos ?? []).filter((x) => x.foto).length;
    const fuentes = lista([
        ['Resultados por mesa', `${r.eleccion.fuente}. Etapa: ${r.eleccion.etapa}. Territorio: ${r.eleccion.territorio}.`],
        [fuente === 'trep' ? 'Corte del TREP' : 'Fecha del cómputo', `${corte}${r.eleccion.aviso ? ` ${r.eleccion.aviso}` : ''}`],
        ['Cobertura', `${fmt.format(cob.mesas_con_acta)} de ${fmt.format(cob.mesas_esperadas)} mesas con acta por cargo` +
            (datos.faltantes.length ? `. Sin acta: ${datos.faltantes.map(textoSinActa).join('; ')}.` : '.')],
        ['Electores', `${r.electores.fuente}.`],
        ['Locales de votación', 'Nombre, dirección y ubicación de cada local según el catálogo de locales del padrón; sin datos de personas.'],
        ['Mapa base', '© colaboradores de OpenStreetMap, licencia ODbL 1.0: un extracto de Asunción del build de Protomaps del 06/10/2026 ' +
            '(mosaicos vectoriales PMTiles, alojados en este sitio y leídos por partes). Estilos de Protomaps (código BSD-3-Clause, diseño CC0), ' +
            'tipografías Noto Sans (SIL Open Font License) e íconos MIT; el mapa se dibuja con MapLibre GL JS (BSD-3-Clause). Detalle en ' +
            'datos/mapa_base/LEEME.md.'],
        ['Cartografía', `${datos.geo.atribucion} Los límites se usan en coordenadas geográficas (WGS84), generados desde esas mismas fuentes.`],
        ['Pobreza multidimensional', `${datos.ipm.fuente}. Cada barrio se une a su polígono por la clave CLAVE_BAR del INE. ` +
            'Ñu Guasú no tiene población (parque nacional).'],
        ['Candidaturas y fotos', `Listas: ${datos.cand.fuente?.listas ?? 'actas por mesa'}. ${datos.cand.fuente?.nota ?? ''} ` +
            `${derechos.atribucion ?? ''}${ref?.space_id ? ` Referencia: Space ${ref.space_id}${ref.commit_sha ? `, versión ${ref.commit_sha.slice(0, 12)}` : ''}.` : ''} ` +
            `${fmt.format(fotos)} fotos. Derechos de uso de las fotos: ${derechos.estado === 'verificado'
                ? 'verificados según el responsable del sitio (esta página no los comprobó por separado)' : derechos.estado ?? 'sin dato'}.`],
    ]);
    const raiz = el('div', 'dialogo__contenido');
    raiz.append(lineaFuente(datos, fuente), seccion('Fuentes y licencias', fuentes));

    // Procedencia: huella SHA-256 de cada acta y de cada archivo de origen (procedencia.json, leído al abrir).
    const url = new URL('procedencia.json', carpeta(eleccion.id, anio.anio, fuente));
    const procedencia = await cargarEleccion({ eleccion: eleccion.id, anio: anio.anio }, fuente, { fuente: ['procedencia.json'] })
        .then((x) => x.datos?.['procedencia.json'] ?? null).catch(() => null);
    const enlace = el('a', null, 'Descargar procedencia.json');
    enlace.href = url.href;
    enlace.setAttribute('download', '');
    if (!procedencia) {
        raiz.append(seccion('Procedencia (SHA-256)', el('p', null, 'La procedencia de esta fuente no está publicada.')));
    } else {
        const actas = procedencia.actas ?? { filas: [] };
        const intro = el('p');
        intro.append(`Cada acta de mesa (Intendencia y Junta) tiene su huella SHA-256 en procedencia.json: ${cantidad(actas.filas.length, 'mesa', 'mesas')}. ` +
            'Con la huella se puede comprobar que el acta usada es la publicada. ', enlace);
        // Las huellas van en código; los archivos sin huella (el padrón preparado) dicen qué columnas se usaron.
        const filas = Object.entries(procedencia.fuentes ?? {}).map(([clave, valor]) =>
            [NOMBRES_PROCEDENCIA[clave] ?? clave.replaceAll('_', ' '), HUELLA.test(valor) ? el('code', 'huella', valor) : valor]);
        const gen = procedencia.generador;
        const pie = gen ? el('p', 'nota', `Generado por ${gen.script} (SHA-256 ${gen.sha256}) el ${fechaLarga(gen.generado_utc)} UTC.`) : '';
        raiz.append(seccion('Procedencia (SHA-256)', intro,
            tabla('Archivos de origen', ['Archivo', 'SHA-256'], filas, 'tabla-compacta--procedencia'), pie));
    }
    const noDisponible = tarjetasNoDisponible(datos, { nivel: 'h4' });
    if (noDisponible.length) {
        const grilla = el('div', 'info-grid');
        grilla.append(...noDisponible);
        raiz.append(seccion('Datos no disponibles', grilla));
    }
    return raiz;
}

// --- Método ---------------------------------------------------------------------------------------------------------

function contenidoMetodo(datos, fuente) {
    const r = datos.resumen;
    const b = datos.cand.bancas;
    const ipm = datos.ipm.indicadores.map((x) => `${x.nombre}: ${x.descripcion.replace(/\.$/, '')}`).join('. ');
    const zonasMunicipales = Object.keys(r.zonas_municipales).length;
    const raiz = el('div', 'dialogo__contenido');
    raiz.append(lista([
        ['Participación', `${r.electores.nota} Electores: recuento agregado del padrón por mesa, sin datos de personas.`],
        ['Votos y porcentajes', 'Emitidos = votos a listas + blancos + nulos + no computados, verificado en cada acta. El porcentaje de cada lista ' +
            'se calcula sobre los votos a listas; el de blancos y nulos, sobre los votos emitidos. Los cargos (Intendencia y Junta Municipal) no se ' +
            'suman entre sí.'],
        ['Ventaja del primero', 'Diferencia entre las dos listas más votadas de la selección, en votos y en puntos porcentuales sobre los votos a ' +
            'listas. El orden se calcula en cada selección: la lista que va primera puede cambiar entre zonas, barrios, locales o mesas.'],
        ['Margen entre el primero y el segundo (capa del mapa)', '100 × (votos del primero − votos del segundo) / votos a listas, en ' +
            'puntos, en los locales de cada barrio y para el cargo elegido. El color es el de la lista que va primera en ese barrio (puede no ' +
            'ser la misma en todos), más intenso cuanto mayor la ventaja: menos de 10, de 10 a 25 y 25 puntos o más.'],
        ['Mapa base y coordenadas', 'Un extracto fijo de OpenStreetMap (06/10/2026) servido desde este sitio y leído por partes: solo se ' +
            'descargan los mosaicos que se ven, y no cambia hasta que se regenere. El distrito y los barrios (INE) y las zonas municipales, el ' +
            'río, las manzanas y los cauces (Municipalidad de Asunción) se regeneraron en coordenadas geográficas (WGS84); los locales van ' +
            'con su latitud y longitud.'],
        ['Capas del mapa', 'Una capa temática a la vez, semitransparente sobre el mapa base (opacidad elegible, 45 % por omisión) para que ' +
            'las calles y sus nombres se vean debajo. Los puntos llevan el color y la forma (círculo o rombo) de la lista más votada: un ' +
            'punto por local al alejar y uno por mesa al acercar.'],
        ["Bancas de la Junta (D'Hondt)", `Las ${b.total} bancas se reparten con el sistema D'Hondt: los votos de cada lista se dividen por 1, 2, 3… ` +
            `y las bancas van a los ${b.total} cocientes más altos; un empate en el cociente lo gana la lista con más votos. La mayoría es de ` +
            `${b.mayoria} bancas. ` + (fuente === 'trep' ? b.nota : 'Se calcula en este sitio sobre los votos oficiales por lista de las mesas con ' +
            'acta; las personas electas solo se muestran si la fuente oficial las publica.')],
        ['Pobreza multidimensional (IPM)', `${ipm}. En el mapa, los barrios se agrupan en quintiles (cinco grupos con la misma cantidad de ` +
            'barrios). Es una comparación entre agregados: no muestra cómo votaron las personas en situación de pobreza ni ningún otro grupo.'],
        ['Cobertura', 'Actas computadas = mesas con acta / mesas esperadas de la selección. Las mesas sin acta no se estiman ni se reparten: se ' +
            'informan aparte y ninguna suma las incluye.'],
        ['Barrios y zonas', 'El barrio y la zona municipal son los de la ubicación del local de votación, no los del domicilio de sus electores. ' +
            `Las zonas electorales del TSJE vienen de las actas y no coinciden con las ${zonasMunicipales} zonas municipales oficiales.`],
        ['Estadística por mesa', 'Media, mediana, desvío estándar poblacional (sobre todas las mesas con acta de la selección), mínimo y máximo ' +
            'de los porcentajes de cada mesa. Cada mesa pesa lo mismo, tenga muchos o pocos electores: por eso la media por mesa puede no ' +
            `coincidir con el porcentaje del total. Listas principales: las que reúnen al menos el ${UMBRAL_PRINCIPAL} % de los votos a listas ` +
            'de la selección, y siempre las dos más votadas.'],
    ]));
    return raiz;
}

// --- Estadísticas generales ---------------------------------------------------------------------------------------

function contenidoEstadisticas(datos, fuente, { cargo, seleccion, ruta, sinActa }) {
    const c = cargo();
    const sel = seleccion();
    const faltan = sinActa();
    const e = estadisticas(datos, sel.indices, c, faltan.length);
    const t = e.total;
    const listas = datos.listas[c];
    const raiz = el('div', 'dialogo__contenido estadisticas');
    const contexto = el('div', 'estadisticas__contexto');
    const linea = lineaFuente(datos, fuente);
    linea.append(` · ${nombreCargo(datos, c)}`);
    contexto.append(linea, el('p', null, `Selección: ${ruta().join(' › ')}`));
    raiz.append(contexto);

    const p = t.electores ? (100 * t.emitidos) / t.electores : null;
    const v = e.ventaja;
    const ventaja = !v ? ['—', 'Sin votos a listas en la selección']
        : v.empate ? ['Empate', `entre ${nombreLista(listas[v.primero], c)} y ${nombreLista(listas[v.segundo], c)}`]
            : [`${fmt.format(v.votos)} votos · ${pct.format(v.puntos)} puntos`,
                `${nombreLista(listas[v.primero], c)} sobre ${nombreLista(listas[v.segundo], c)}, sobre ${fmt.format(t.listas)} votos a listas`];
    const bn = t.blancos + t.nulos;
    const a = e.actas;
    raiz.append(tabla('Resumen de la selección', ['Indicador', 'Valor', 'Detalle'], [
        ['Participación', p === null ? '—' : `${pct.format(p)} %`, `${fmt.format(t.emitidos)} votos emitidos de ${fmt.format(t.electores)} electores habilitados`],
        ['Ventaja del primero', ...ventaja],
        ['Votos emitidos', fmt.format(t.emitidos), `en ${cantidad(t.mesas, 'mesa', 'mesas')} con acta` +
            (t.nocomputados ? `; incluye ${fmt.format(t.nocomputados)} no computados` : '')],
        ['Votos en blanco', fmt.format(t.blancos), `${porcentaje(t.blancos, t.emitidos)} % de los emitidos`],
        ['Votos nulos', fmt.format(t.nulos), `${porcentaje(t.nulos, t.emitidos)} % de los emitidos`],
        ['Blancos y nulos', fmt.format(bn), `${porcentaje(bn, t.emitidos)} % de los emitidos`],
        ['Actas computadas', `${fmt.format(a.computadas)} de ${fmt.format(a.esperadas)}`, `${porcentaje(a.computadas, a.esperadas)} % de las mesas esperadas`],
        ['Mesas sin acta', fmt.format(a.sinActa), a.sinActa ? faltan.map(textoSinActa).join('; ') : 'Todas las mesas esperadas de la selección tienen acta'],
    ], 'tabla-compacta--resumen'));

    const d = e.porMesa;
    const fila = (encabezado, x) => [encabezado, decimal(x.media), decimal(x.mediana), decimal(x.desvio), decimal(x.minimo), decimal(x.maximo)];
    const conNombre = (texto, nombre) => {
        const nodo = el('span', null, texto);
        nodo.title = nombre;
        return [nodo, el('span', 'visualmente-oculto', ` (${nombre})`)];
    };
    raiz.append(tabla(`Estadística por mesa · ${cantidad(d.n, 'mesa con acta', 'mesas con acta')}`,
        ['Medida', 'Media', 'Mediana', 'Desvío', 'Mín.', 'Máx.'], [
            fila('Participación (%)', d.participacion),
            ...d.listas.map((x) => fila(conNombre(`% ${listas[x.j].sigla}`, nombreLista(listas[x.j], c)), x)),
            fila('% blancos', d.blancos),
            fila('% nulos', d.nulos),
            fila('% blancos y nulos', d.blancosNulos),
        ], 'tabla-compacta--mesas'));
    raiz.append(el('p', 'nota', `Mesas con participación mayor a 100 %: ${fmt.format(d.sobre100)}. Porcentajes de cada mesa: las listas, sobre sus ` +
        'votos a listas; blancos y nulos, sobre sus emitidos. Desvío estándar poblacional, en puntos porcentuales. Listas principales: al menos ' +
        `${UMBRAL_PRINCIPAL} % de los votos a listas de la selección, y siempre las dos más votadas.`));
    return raiz;
}

// cargo, seleccion, ruta y sinActa son funciones: el diálogo se arma con la selección vigente al abrirlo.
export function crearDialogos({ datos, fuente, cargo, seleccion, ruta, sinActa }) {
    return {
        fuente: crearDialogo({ titulo: 'Fuente', contenido: () => contenidoFuente(datos, fuente) }),
        metodo: crearDialogo({ titulo: 'Método', contenido: () => contenidoMetodo(datos, fuente) }),
        estadisticas: crearDialogo({ titulo: 'Estadísticas generales', clase: 'dialogo--estadisticas',
                                     contenido: () => contenidoEstadisticas(datos, fuente, { cargo, seleccion, ruta, sinActa }) }),
    };
}
