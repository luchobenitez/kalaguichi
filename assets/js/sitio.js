// Comportamiento común a todas las páginas: tema claro/oscuro y año del pie.
// localStorage guarda solo el tema elegido; ninguna sección guarda allí datos consultados.
(() => {
    'use strict';

    const THEME_KEY = 'kalaguichi_theme';
    const root = document.documentElement;

    let saved = 'light';
    try {
        saved = localStorage.getItem(THEME_KEY) || 'light';
    } catch (_) {
    }
    root.dataset.theme = saved === 'dark' ? 'dark' : 'light';

    const currentYear = document.getElementById('currentYear');
    if (currentYear) {
        currentYear.textContent = String(new Date().getFullYear());
    }

    document.getElementById('themeToggle')?.addEventListener('click', () => {
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        try {
            localStorage.setItem(THEME_KEY, next);
        } catch (_) {
        }
    });
})();
