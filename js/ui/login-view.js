/* Pantalla de login: selector de usuarios activos + PIN.
 *
 * El body arranca con la clase is-logged-out (puesta en el HTML): hasta que
 * no hay sesión, la app entera está oculta desde CSS — así no se llega a
 * pintar un dashboard ajeno mientras se carga el módulo. */

import { getState } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';

const byId = id => document.getElementById(id);

export function showLogin() {
    renderLoginOptions();
    document.body.classList.add('is-logged-out');
    byId('login-screen')?.classList.remove('is-hidden');
    const pin = byId('login-pin');
    if (pin) {
        pin.value = '';
        showLoginError('');
        pin.focus();
    }
}

export function showApp() {
    document.body.classList.remove('is-logged-out');
    byId('login-screen')?.classList.add('is-hidden');
}

export function renderLoginOptions() {
    const select = byId('login-user');
    if (!select) return;
    select.innerHTML = getState().users
        .filter(u => u.active)
        .map(u => `<option value="${escapeHtml(u.username)}">${escapeHtml(u.name)} — ${u.role === 'admin' ? 'Administrador' : 'Estilista'}</option>`)
        .join('');
}

export function showLoginError(message) {
    const el = byId('login-error');
    if (el) el.textContent = message;
}
