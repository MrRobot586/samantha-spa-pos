/* Modales: apertura/cierre con foco gestionado, ESC y clic en el fondo
 * (accesibilidad — bug #14; el original solo cerraba con el botón X). */

let lastFocused = null;

export function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    lastFocused = document.activeElement;
    modal.classList.remove('is-hidden');
    const firstField = modal.querySelector('input:not([readonly]), select, button');
    firstField?.focus();
}

export function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal || modal.classList.contains('is-hidden')) return;
    modal.classList.add('is-hidden');
    if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
    }
    lastFocused = null;
}

export function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        if (!modal.classList.contains('is-hidden')) closeModal(modal.id);
    });
}

export function isModalOpen(id) {
    const modal = document.getElementById(id);
    return Boolean(modal) && !modal.classList.contains('is-hidden');
}

export function initModals() {
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeAllModals();
    });

    // Clic directamente sobre el fondo (el <div class="modal">): cierra.
    document.addEventListener('click', e => {
        if (e.target.classList && e.target.classList.contains('modal')) {
            closeModal(e.target.id);
        }
    });
}
