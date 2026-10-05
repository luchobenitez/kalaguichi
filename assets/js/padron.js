import { normalizeCedula, validISODate, triState, stateDescription } from './domain.js';
import { ElectoralRepository } from './repository.js';

(() => {
    'use strict';

    // No se consultan JSON nominales ni se publican cédulas en rutas de red.
    let requestNumber = 0;
    let activeRequest = null;

    const form = document.getElementById('consultaForm');
    const cedulaInput = document.getElementById('cedula');
    const nacimientoInput = document.getElementById('nacimiento');
    const clearButton = document.getElementById('clearButton');
    nacimientoInput.max = new Date().toISOString().slice(0, 10);
    const resultContainer = document.getElementById('resultadoConsulta');
    const submitButton = document.getElementById('submitButton');
    const searchIcon = document.getElementById('searchIcon');
    const loadingIcon = document.getElementById('loadingIcon');
    const buttonText = document.getElementById('buttonText');
    const themeToggle = document.getElementById('themeToggle');
    const currentYear = document.getElementById('currentYear');

    if (currentYear) {
        currentYear.textContent = String(new Date().getFullYear());
    }

    initTheme();
    describeDataset();

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const current =
                document.documentElement.dataset.theme === 'dark'
                    ? 'dark'
                    : 'light';

            const next = current === 'dark' ? 'light' : 'dark';

            document.documentElement.dataset.theme = next;

            try {
                localStorage.setItem('padron_theme', next);
            } catch (_) {
            }
        });
    }

    function invalidateQuery() {
        requestNumber += 1;
        activeRequest?.abort();
        activeRequest = null;
        setLoading(false);
        clearResult();
    }
    cedulaInput.addEventListener('input', invalidateQuery);
    nacimientoInput.addEventListener('input', invalidateQuery);
    clearButton.addEventListener('click', () => {
        invalidateQuery(); form.reset(); cedulaInput.focus();
    });
    window.addEventListener('pagehide', () => { invalidateQuery(); form.reset(); });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        invalidateQuery();
        let cedula;
        try { cedula = normalizeCedula(cedulaInput.value); }
        catch (error) { showError(error.message); return; }
        const nacimiento = nacimientoInput.value;
        if (!validISODate(nacimiento) || nacimiento > nacimientoInput.max) {
            showError('Ingresá una fecha de nacimiento válida, no futura.'); return;
        }
        const token = requestNumber;
        const controller = new AbortController();
        activeRequest = controller;
        const timeout = setTimeout(() => controller.abort(), 20000);
        const repository = new ElectoralRepository();
        setLoading(true);
        try {
            const registros = await repository.lookup(cedula, nacimiento, controller.signal);
            if (token !== requestNumber) return;
            if (!registros.length) showNotFound();
            else renderResults(registros, cedula, repository.nominal === true);
            resultContainer.focus({ preventScroll: true });
        } catch (error) {
            if (token !== requestNumber) return;
            showError(error.name === 'AbortError'
                ? 'La consulta superó el tiempo de espera. Volvé a intentarlo.'
                : 'No fue posible leer o verificar los datos. Revisá la configuración y el servidor local.');
        } finally {
            clearTimeout(timeout);
            repository.clear();
            if (token === requestNumber) { activeRequest = null; setLoading(false); }
        }
    });

    function initTheme() {

        let saved = 'light';

        try {

            saved =
                localStorage.getItem('padron_theme') ||
                'light';

        } catch (_) {
        }

        document.documentElement.dataset.theme =
            saved === 'dark'
                ? 'dark'
                : 'light';
    }

    // El aviso estático describe la demo sintética; se corrige si se sirve el padrón cifrado local.
    async function describeDataset() {
        try {
            const response = await fetch('config/app.json', { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
            const config = response.ok ? await response.json() : null;
            const banner = document.querySelector('.demo-banner');
            if (config?.mode !== 'nominal-local' || !banner) return;
            banner.querySelector('strong').textContent = 'ENTORNO DE PRUEBA LOCAL · PADRÓN CIFRADO';
            banner.querySelector('span').textContent = 'No es un sitio oficial ni una consulta privada. La clave se sirve junto con los datos: no ofrece confidencialidad.';
        } catch (_) {
        }
    }

    function setLoading(loading) {

        submitButton.disabled = loading;
        form.setAttribute('aria-busy', String(loading));

        searchIcon?.classList.toggle(
            'is-hidden',
            loading
        );

        loadingIcon?.classList.toggle(
            'is-hidden',
            !loading
        );

        buttonText.textContent =
            loading
                ? 'Consultando...'
                : 'Consultar padrón';
    }

    function clearResult() {

        resultContainer.replaceChildren();
        delete resultContainer.dataset.electorCarousel;
        delete resultContainer.dataset.electorCount;

        resultContainer.className = '';
    }

    function showNotFound() {

        showError(
            'No se encontraron registros para la combinación de cédula y fecha de nacimiento. No indica si la cédula existe por separado.'
        );
    }

    function showError(message) {

        resultContainer.className =
            'error-card';

        resultContainer.innerHTML = `
            <span class="error-card__icon">

                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >

                    <circle
                        cx="12"
                        cy="12"
                        r="9"
                    ></circle>

                    <path
                        stroke-linecap="round"
                        d="M12 8v5M12 16h.01"
                    ></path>

                </svg>

            </span>

            <div>

                <strong>
                    No pudimos completar la consulta
                </strong>

                <p>
                    ${escapeHtml(message)}
                </p>

            </div>
        `;
    }

    function renderResults(
        registros,
        cedulaNumero,
        nominal
    ) {

        const resultados =
            registros.map(
                (registro) =>
                    normalizeRecord(
                        registro,
                        cedulaNumero
                    )
            );

        const cantidad =
            resultados.length;

        resultContainer.className =
            'result-carousel';

        resultContainer.dataset.electorCarousel =
            '';

        resultContainer.dataset.electorCount =
            String(cantidad);

        const toolbar =
            cantidad > 1
                ? `
            <div class="result-carousel__toolbar">

                <div class="result-carousel__summary">

                    <span
                        class="result-carousel__summary-icon"
                        aria-hidden="true"
                    >

                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.9"
                        >

                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
                            ></path>

                            <circle
                                cx="9"
                                cy="7"
                                r="4"
                            ></circle>

                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M22 21v-2a4 4 0 0 0-3-3.87"
                            ></path>

                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M16 3.13a4 4 0 0 1 0 7.75"
                            ></path>

                        </svg>

                    </span>

                    <div>

                        <strong>
                            ${cantidad} registros coincidentes
                        </strong>

                        <span>
                            Coincidencias de cédula y nacimiento; no se unifican automáticamente.
                        </span>

                    </div>

                </div>

                <div
                    class="result-carousel__navigation"
                    aria-label="Navegación entre registros coincidentes"
                >

                    <button
                        type="button"
                        class="result-carousel__arrow"
                        data-elector-prev
                        aria-label="Mostrar registro anterior"
                        title="Registro anterior"
                        disabled
                    >

                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >

                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="m15 18-6-6 6-6"
                            ></path>

                        </svg>

                    </button>

                    <span class="result-carousel__counter">

                        <strong data-elector-current>
                            1
                        </strong>

                        <span>
                            de
                        </span>

                        <strong>
                            ${cantidad}
                        </strong>

                    </span>

                    <button
                        type="button"
                        class="result-carousel__arrow"
                        data-elector-next
                        aria-label="Mostrar siguiente elector"
                        title="Siguiente elector"
                    >

                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >

                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="m9 18 6-6-6-6"
                            ></path>

                        </svg>

                    </button>

                </div>

            </div>
        `
                : '';

        const slides =
            resultados
                .map(
                    (resultado, index) =>
                        renderSlide(
                            resultado,
                            index,
                            cantidad,
                            nominal
                        )
                )
                .join('');

        resultContainer.innerHTML = `

            ${toolbar}

            <div
                class="result-carousel__viewport"
                data-elector-viewport
            >

                <div
                    class="result-carousel__track"
                    data-elector-track
                >

                    ${slides}

                </div>

            </div>
        `;

        if (cantidad > 1) {

            initCarousel(
                resultContainer,
                cantidad
            );
        }
    }

    function normalizeRecord(
        registro,
        cedulaNumero
    ) {

        return {
            voto: triState(registro.voto),
            fallecido: triState(registro.fallecido),
            fuente_voto: registro.fuente_voto ?? null,
            fuente_fallecido: registro.fuente_fallecido ?? null,
            fecha_corte_voto: registro.fecha_corte_voto ?? null,
            fecha_corte_fallecido: registro.fecha_corte_fallecido ?? null,

            cedula:
                registro.cedula ??
                cedulaNumero,

            nombre:
                registro.nombres ??
                '',

            apellido:
                registro.apellidos ??
                '',

            sexo:
                registro.sexo ??
                null,

            fecha_nacimiento:
                registro.nacimiento ??
                null,

            fecha_inscripcion:
                registro.inscripcion ??
                null,

            tipo:
                registro.tipo_inscripcion ??
                null,

            nacionalidad: {

                codigo:
                    registro.nacionalidad ??
                    null

            },

            departamento: {

                codigo:
                    registro.codigo_departamento ??
                    null,

                descripcion:
                    registro.departamento ??
                    null

            },

            distrito: {

                codigo:
                    registro.codigo_distrito ??
                    null,

                descripcion:
                    registro.distrito ??
                    null

            },

            zona: {

                codigo:
                    registro.codigo_zona ??
                    null,

                descripcion:
                    registro.zona ??
                    null

            },

            local: {

                codigo:
                    registro.codigo_local ??
                    null,

                descripcion:
                    registro.local_votacion ??
                    null,

                direccion:
                    registro.direccion_local ??
                    null,

                latitud:
                    registro.latitud ??
                    null,

                longitud:
                    registro.longitud ??
                    null

            },

            mesa:
                registro.mesa ??
                null,

            orden:
                registro.orden ??
                null,

            tipo_voto: {

                codigo:
                    Number(
                        registro.tipo_mesa ??
                        0
                    ),

                descripcion:
                    registro.descripcion_mesa ??
                    'MESA NORMAL'

            },

            // ind puede llegar como texto ("true"/"false") o como booleano.
            es_indigena:
                String(
                    registro.ind
                ).toLowerCase() === 'true',

            codigo_pueblo:
                registro.cp ??
                null,

            codigo_comunidad:
                registro.cc ??
                null,

            edad_padron:
                registro.e ??
                null
        };
    }

    function renderSlide(
        resultado,
        index,
        cantidad,
        nominal
    ) {

        const tipoVotoCodigo =
            Number(
                resultado.tipo_voto?.codigo ??
                0
            );

        const tipoVotoTexto =
            String(
                resultado.tipo_voto?.descripcion ??
                'MESA NORMAL'
            );

        let tipoVotoClase =
            'vote-type--normal';

        if (tipoVotoCodigo === 1) {

            tipoVotoClase =
                'vote-type--accessible';
        }

        if (tipoVotoCodigo === 2) {

            tipoVotoClase =
                'vote-type--home';
        }

        const direccion =
            String(
                resultado.local?.direccion ??
                ''
            ).trim();

        const lat =
            parseCoordinate(
                resultado.local?.latitud
            );

        const lng =
            parseCoordinate(
                resultado.local?.longitud
            );

        // 0,0 se toma como "sin coordenadas".
        const tieneGeo =
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            !(lat === 0 && lng === 0) &&
            lat >= -90 &&
            lat <= 90 &&
            lng >= -180 &&
            lng <= 180;

        const mapsUrl =
            tieneGeo
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
                : null;

        const nombreCompleto =
            `${resultado.nombre ?? ''} ${resultado.apellido ?? ''}`.trim();

        return `

            <section

                class="result-card result-card--success result-carousel__slide${index === 0 ? ' is-active' : ''}"

                data-elector-slide

                data-elector-index="${index}"

                aria-hidden="${index === 0 ? 'false' : 'true'}"

                ${index === 0 ? '' : 'hidden'}

            >

                <div class="result-card__header">

                    <div class="result-card__identity">

                        <span class="result-card__status-icon">

                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                aria-hidden="true"
                            >

                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="m5 12 4 4L19 6"
                                ></path>

                            </svg>

                        </span>

                        <div>

                            <p class="result-card__eyebrow">

                                ${
                                    cantidad > 1
                                        ? `Registro ${index + 1} de ${cantidad}`
                                        : nominal ? 'Registro del padrón' : 'Registro de demostración'
                                }

                            </p>

                            <h3>
                                ${escapeHtml(nombreCompleto)}
                            </h3>

                            <p class="result-card__cedula">

                                C.I. Nº
                                ${escapeHtml(resultado.cedula)}

                            </p>

                        </div>

                    </div>

                </div>

                <div class="result-card__body">

                    ${renderStateCards(resultado)}

                    <div class="polling-place">

                        <div class="polling-place__label">

                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.9"
                                aria-hidden="true"
                            >

                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M12 21s7-5.33 7-12A7 7 0 1 0 5 9c0 6.67 7 12 7 12Z"
                                ></path>

                                <circle
                                    cx="12"
                                    cy="9"
                                    r="2.5"
                                ></circle>

                            </svg>

                            <span>
                                Local asignado de votación
                            </span>

                        </div>

                        <p class="polling-place__name">

                            ${
                                escapeHtml(
                                    resultado.local?.descripcion ??
                                    'Sin descripción'
                                )
                            }

                        </p>

                        ${
                            direccion
                                ? `
                            <div class="polling-place__address">

                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.9"
                                    aria-hidden="true"
                                >

                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        d="M4 10.5 12 4l8 6.5M6.5 9.5V20h11V9.5M9.5 20v-6h5v6"
                                    ></path>

                                </svg>

                                <span>
                                    ${escapeHtml(direccion)}
                                </span>

                            </div>
                        `
                                : ''
                        }

                        ${
                            mapsUrl
                                ? `
                            <a
                                href="${escapeHtml(mapsUrl)}"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="maps-button"
                            >

                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.9"
                                    aria-hidden="true"
                                >

                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        d="M12 21s7-5.33 7-12A7 7 0 1 0 5 9c0 6.67 7 12 7 12Z"
                                    ></path>

                                    <circle
                                        cx="12"
                                        cy="9"
                                        r="2.5"
                                    ></circle>

                                </svg>

                                Ver local en Google Maps

                            </a>
                        `
                                : ''
                        }

                        <div class="table-order-grid">

                            <div class="number-card">

                                <p>
                                    Mesa
                                </p>

                                <strong>
                                    ${escapeHtml(resultado.mesa ?? '-')}
                                </strong>

                            </div>

                            <div class="number-card">

                                <p>
                                    Orden
                                </p>

                                <strong>
                                    ${escapeHtml(resultado.orden ?? '-')}
                                </strong>

                            </div>

                        </div>

                    </div>

                    <div class="location-grid">

                        <div class="location-card">

                            <p>
                                Departamento
                            </p>

                            <strong>

                                ${
                                    escapeHtml(
                                        resultado.departamento?.descripcion ??
                                        '-'
                                    )
                                }

                            </strong>

                        </div>

                        <div class="location-card">

                            <p>
                                Distrito
                            </p>

                            <strong>

                                ${
                                    escapeHtml(
                                        resultado.distrito?.descripcion ??
                                        '-'
                                    )
                                }

                            </strong>

                        </div>

                        <div class="location-card">

                            <p>
                                Zona
                            </p>

                            <strong>

                                ${
                                    escapeHtml(
                                        resultado.zona?.descripcion ??
                                        '-'
                                    )
                                }

                            </strong>

                        </div>

                    </div>

                    <div class="result-badges">

                        <span
                            class="vote-type ${escapeHtml(tipoVotoClase)}"
                        >

                            ${escapeHtml(tipoVotoTexto)}

                        </span>

                        ${
                            resultado.es_indigena
                                ? `
                                    <span class="indigenous-badge">
                                        Elector indígena
                                    </span>
                                `
                                : ''
                        }

                    </div>

                </div>

            </section>
        `;
    }

    function renderStateCards(record) {
        const vote = stateDescription('voto', record.voto);
        const death = stateDescription('fallecido', record.fallecido);
        const source = (name, date) => name
            ? `Fuente: ${escapeHtml(name)}${date ? ` · Corte: ${escapeHtml(date)}` : ' · Sin fecha de corte'}`
            : 'Sin fuente informada';
        return `<div class="electoral-states">
            <section class="electoral-state electoral-state--${vote.tone}" data-status="voto">
                <p>Participación electoral</p><strong>${escapeHtml(vote.text)}</strong>
                <small>${source(record.fuente_voto, record.fecha_corte_voto)}</small>
            </section>
            <section class="electoral-state electoral-state--${death.tone}" data-status="fallecido">
                <p>Registro de fallecimiento</p><strong>${escapeHtml(death.text)}</strong>
                <small>${source(record.fuente_fallecido, record.fecha_corte_fallecido)}</small>
            </section>
        </div>${record.voto === true && record.fallecido === true
            ? '<p class="review-note">Ambos estados figuran en este registro. Sin cronología y evidencia no corresponde concluir una irregularidad.</p>' : ''}`;
    }

    function initCarousel(
        root,
        cantidad
    ) {

        const slides =
            Array.from(
                root.querySelectorAll(
                    '[data-elector-slide]'
                )
            );

        const prev =
            root.querySelector(
                '[data-elector-prev]'
            );

        const next =
            root.querySelector(
                '[data-elector-next]'
            );

        const current =
            root.querySelector(
                '[data-elector-current]'
            );

        let index = 0;

        const show = (newIndex) => {

            index =
                Math.max(
                    0,
                    Math.min(
                        cantidad - 1,
                        newIndex
                    )
                );

            slides.forEach(
                (slide, i) => {

                    const active =
                        i === index;

                    slide.hidden =
                        !active;

                    slide.classList.toggle(
                        'is-active',
                        active
                    );

                    slide.setAttribute(
                        'aria-hidden',
                        active
                            ? 'false'
                            : 'true'
                    );
                }
            );

            current.textContent =
                String(index + 1);

            prev.disabled =
                index === 0;

            next.disabled =
                index === cantidad - 1;
        };

        prev.addEventListener(
            'click',
            () =>
                show(index - 1)
        );

        next.addEventListener(
            'click',
            () =>
                show(index + 1)
        );

        show(0);
    }

    // Vacío o null -> NaN (sin coordenada); Number('') y Number(null) darían 0.
    function parseCoordinate(value) {

        if (
            value === null ||
            value === undefined ||
            String(value).trim() === ''
        ) {

            return NaN;
        }

        return Number(value);
    }

    function escapeHtml(value) {

        return String(value ?? '')

            .replaceAll(
                '&',
                '&amp;'
            )

            .replaceAll(
                '<',
                '&lt;'
            )

            .replaceAll(
                '>',
                '&gt;'
            )

            .replaceAll(
                '"',
                '&quot;'
            )

            .replaceAll(
                "'",
                '&#039;'
            );
    }

})();