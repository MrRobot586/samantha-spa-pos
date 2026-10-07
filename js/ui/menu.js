/* Menú desplegable del topbar.
 *
 * El topbar solo enseña título + badge de tasa + badge de caja; el resto
 * (moneda, fuente de tasa, tema, ajustes de impresión, usuarios, fecha,
 * sesión y salir) vive en este panel. Se abre con el botón "⋯" y se cierra
 * con un clic fuera, con ESC o al ejecutar una acción que saca de la barra
 * (cambiar de pestaña, abrir un modal o salir). No hay estado persistido:
 * el menú siempre arranca cerrado. */

/** Abre el panel y refleja el estado en aria-expanded. */
export function openMenu() {
    const panel = document.getElementById('topbar-menu-panel');
    const btn = document.getElementById('btn-menu');
    if (!panel || !btn) return;
    panel.classList.remove('is-hidden');
    btn.setAttribute('aria-expanded', 'true');
}

/** Cierra el panel si está abierto (idempotente: llamarlo desde cualquier
 *  acción que lo deba apagar no requiere comprobar antes). */
export function closeMenu() {
    const panel = document.getElementById('topbar-menu-panel');
    const btn = document.getElementById('btn-menu');
    if (panel) panel.classList.add('is-hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

export function isMenuOpen() {
    const panel = document.getElementById('topbar-menu-panel');
    return Boolean(panel) && !panel.classList.contains('is-hidden');
}

export function toggleMenu() {
    if (isMenuOpen()) closeMenu();
    else openMenu();
}

/** Listeners globales: clic fuera del menú y ESC. */
export function initMenu() {
    document.addEventListener('click', e => {
        if (!isMenuOpen()) return;
        if (e.target.closest('#topbar-menu')) return;
        closeMenu();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && isMenuOpen()) closeMenu();
    });
}
