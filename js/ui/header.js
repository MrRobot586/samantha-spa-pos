/* Header: moneda de visualización, badge de tasa BCV y estado de caja.
 *
 * El badge de tasa también abre el panel desplegable con la moneda y la
 * fuente de la tasa (además de su botón de actualización). El badge de caja
 * es solo para quien tiene permiso 'cash' (admin): el icono lee el estado
 * (máquina registradora verde = abierta, candado opaco = cerrada) y la fecha
 * del día dd/mm/aaaa es el texto; al tocar abre la pestaña Caja & Cortes. */

import { getState } from '../core/state.js';
import { getSnapshot, bsRate } from '../core/rates.js';
import { can, getCurrentUser } from '../core/auth.js';
import { shortDate } from '../core/utils.js';
import { closeMenu } from './menu.js';

/** Etiqueta corta de la tasa BCV elegida (Tasa USD / Tasa Euro). */
function rateSourceLabel(source) {
    return source === 'eur' ? 'Tasa Euro' : 'Tasa USD';
}

/** Refleja la tasa BCV elegida en el selector del topbar. */
export function renderRateSource() {
    const sel = document.getElementById('rate-source');
    if (!sel) return;
    const src = getState().settings.rateSource;
    sel.value = src === 'eur' ? 'eur' : 'usd';
}

export function renderCurrency() {
    const actual = getState().settings.currency;
    document.querySelectorAll('[data-action="set-currency"]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.currency === actual);
    });
}

export function renderRateBadge() {
    const badge = document.getElementById('rate-badge');
    if (!badge) return;
    const s = getSnapshot();
    const src = getState().settings.rateSource === 'eur' ? 'eur' : 'usd';
    const tasa = bsRate(src, s);

    if (!tasa) {
        badge.textContent = s.offline ? 'Tasa no disponible' : 'Cargando tasa…';
        badge.title = 'Tasa BCV · tocar para abrir el panel';
        return;
    }

    badge.textContent = `${rateSourceLabel(src)}: ${tasa.toLocaleString('es-VE', { maximumFractionDigits: 2 })} Bs`
        + (s.offline ? ' · sin conexión' : '');
    badge.title = 'Tasa BCV · tocar para abrir el panel';
}

/** Fecha corta dd/mm/aaaa (la lleva el badge de caja). */
function fechaCorta() {
    return shortDate();
}

export function renderCashBadge() {
    const badge = document.getElementById('cash-badge');
    if (!badge) return;

    const user = getCurrentUser(getState());
    const visible = Boolean(user && can(user.role, 'cash'));
    badge.classList.toggle('is-hidden', !visible);
    if (!visible) return;

    const abierta = getState().cashSession.open === true;
    badge.classList.toggle('is-open', abierta);
    badge.title = abierta ? 'Caja abierta · ir a Caja & Cortes' : 'Caja cerrada · ir a Caja & Cortes';

    const icon = document.getElementById('cash-badge-icon');
    if (icon) {
        // Máquina registradora = caja abierta; candado = cerrada.
        icon.className = `fa-solid ${abierta ? 'fa-cash-register' : 'fa-lock'}`;
        icon.setAttribute('aria-hidden', 'true');
    }
    const texto = document.getElementById('cash-badge-text');
    if (texto) texto.textContent = fechaCorta();
}

/** Resuelve el tema efectivo y lo escribe en <html data-theme>.
 *  'auto' sigue al sistema (prefers-color-scheme); dark/light son fijos. */
export function applyTheme() {
    const modo = getState().settings.theme;
    const sistema = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = modo === 'auto' ? sistema : modo;
}

/** Refresca el icono/aria de todos los botones que ciclan el tema. */
export function renderTheme() {
    const modo = getState().settings.theme;
    const ICONOS = { auto: 'fa-desktop', dark: 'fa-moon', light: 'fa-sun' };
    const NOMBRES = { auto: 'Auto (según el sistema)', dark: 'Oscuro', light: 'Claro' };
    document.querySelectorAll('.theme-toggle').forEach(btn => {
        const icon = btn.querySelector('i');
        if (icon) icon.className = `fa-solid ${ICONOS[modo] || ICONOS.auto}`;
        btn.dataset.theme = modo;
        btn.title = `Tema: ${NOMBRES[modo] || NOMBRES.auto} · tocar para cambiar`;
        btn.setAttribute('aria-label', `Tema actual: ${NOMBRES[modo] || NOMBRES.auto}. Tocar para cambiar de tema`);
    });
}

export function renderHeader() {
    renderCurrency();
    renderRateSource();
    renderRateBadge();
    renderCashBadge();
    renderTheme();
}

/* --- Panel desplegable de la tasa -------------------------------------------
   El badge de tasa abre un panel con la moneda de visualización y la fuente
   de la tasa (antes vivían en el menú de sesión) más un botón de
   actualización. Cierra igual que el menú del topbar: clic fuera o ESC. */

export function toggleRateMenu() {
    const panel = document.getElementById('rate-menu-panel');
    const btn = document.getElementById('rate-badge');
    if (!panel || !btn) return;
    const abrir = panel.classList.contains('is-hidden');
    panel.classList.toggle('is-hidden', !abrir);
    btn.setAttribute('aria-expanded', String(abrir));
    if (abrir) closeMenu();
}

export function closeRateMenu() {
    const panel = document.getElementById('rate-menu-panel');
    const btn = document.getElementById('rate-badge');
    if (panel) panel.classList.add('is-hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

export function isRateMenuOpen() {
    const panel = document.getElementById('rate-menu-panel');
    return Boolean(panel) && !panel.classList.contains('is-hidden');
}

/** Listeners globales: clic fuera del panel y ESC. */
export function initRateMenu() {
    document.addEventListener('click', e => {
        if (!isRateMenuOpen()) return;
        if (e.target.closest('#rate-dropdown')) return;
        closeRateMenu();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && isRateMenuOpen()) closeRateMenu();
    });
}
