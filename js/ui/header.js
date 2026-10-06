/* Header: moneda de visualización, badge de tasa BCV y estado de caja.
 *
 * El toggle solo cambia settings.currency (persistido); el badge de tasa
 * muestra la tasa vigente con su fecha y funciona como botón de
 * actualización manual. El badge de caja es solo para quien tiene
 * permiso 'cash' (admin): abre la pestaña Caja & Cortes. */

import { getState } from '../core/state.js';
import { getSnapshot } from '../core/rates.js';
import { can, getCurrentUser } from '../core/auth.js';

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

    if (!s.usdBs) {
        badge.textContent = s.offline ? 'Tasa no disponible' : 'Cargando tasa…';
        badge.title = 'Sin respuesta de ve.dolarapi.com: toca para reintentar';
        return;
    }

    const fecha = s.fecha && !Number.isNaN(new Date(s.fecha).getTime())
        ? new Date(s.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' })
        : '';
    badge.textContent = `1 USD = ${s.usdBs.toLocaleString('es-VE', { maximumFractionDigits: 2 })} Bs`
        + (fecha ? ` · ${fecha}` : '')
        + (s.offline ? ' · sin conexión' : '');
    badge.title = s.offline
        ? 'Tasa guardada (sin conexión): toca para reintentar'
        : 'Tocar para actualizar la tasa';
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
    document.getElementById('cash-badge-text').textContent = abierta
        ? 'Caja abierta'
        : 'Caja cerrada';
    badge.title = abierta ? 'Caja abierta · ir a Caja & Cortes' : 'Caja cerrada · ir a Caja & Cortes';
}

/** Resuelve el tema efectivo y lo escribe en <html data-theme>.
 *  'auto' sigue al sistema (prefers-color-scheme); dark/light son fijos. */
export function applyTheme() {
    const modo = getState().settings.theme;
    const sistema = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = modo === 'auto' ? sistema : modo;
}

/** Refresca el icono/aria del botón que cicla el tema. */
export function renderTheme() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const modo = getState().settings.theme;
    const ICONOS = { auto: 'fa-desktop', dark: 'fa-moon', light: 'fa-sun' };
    const NOMBRES = { auto: 'Auto (según el sistema)', dark: 'Oscuro', light: 'Claro' };
    const icon = btn.querySelector('i');
    if (icon) icon.className = `fa-solid ${ICONOS[modo] || ICONOS.auto}`;
    btn.dataset.theme = modo;
    btn.title = `Tema: ${NOMBRES[modo] || NOMBRES.auto} · tocar para cambiar`;
    btn.setAttribute('aria-label', `Tema actual: ${NOMBRES[modo] || NOMBRES.auto}. Tocar para cambiar de tema`);
}

export function renderHeader() {
    renderCurrency();
    renderRateBadge();
    renderCashBadge();
    renderTheme();
}
