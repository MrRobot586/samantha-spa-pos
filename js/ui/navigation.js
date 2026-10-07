/* Cambio de pestañas. Los títulos son HTML estático (nada de usuario):
 * se inyectan con innerHTML de forma segura.
 *
 * La navegación es dinámica según el rol: renderNav() oculta los botones
 * que el rol no puede ver y switchTab() además rechaza cualquier intento
 * de entrar a una pestaña no permitida (aunque el botón esté oculto). */

import { TABS } from '../core/config.js';
import { can, getCurrentUser } from '../core/auth.js';
import { getState } from '../core/state.js';

const TITLES = {
    dashboard: '<i class="fa-solid fa-chart-pie"></i> Dashboard General',
    pos: '<i class="fa-solid fa-cash-register"></i> Punto de Venta / Caja',
    ventas: '<i class="fa-solid fa-receipt"></i> Ventas & Tickets',
    cash: '<i class="fa-solid fa-vault"></i> Caja & Cortes',
    services: '<i class="fa-solid fa-wand-magic-sparkles"></i> Servicios & Receta Técnica',
    inventory: '<i class="fa-solid fa-boxes-stacked"></i> Productos e Insumos',
    commissions: '<i class="fa-solid fa-user-tag"></i> Reporte de Comisiones'
};

function currentRole() {
    const user = getCurrentUser(getState());
    return user ? user.role : null;
}

/** Oculta/muestra los botones del nav (y de Usuarios) según el rol. */
export function renderNav(role) {
    for (const t of TABS) {
        document.getElementById(`nav-${t}`)?.classList.toggle('is-hidden', !can(role, t));
    }
    document.getElementById('btn-users')?.classList.toggle('is-hidden', !can(role, 'users'));
    document.getElementById('btn-print-settings')?.classList.toggle('is-hidden', !can(role, 'users'));
    // Ambos botones comparten el permiso 'users': si el rol no lo tiene, la
    // sección entera (incluida su etiqueta "Herramientas") desaparece.
    document.getElementById('menu-group-tools')?.classList.toggle('is-hidden', !can(role, 'users'));
}

export function switchTab(tabName) {
    const role = currentRole();
    const target = TABS.includes(tabName) && can(role, tabName) ? tabName : 'dashboard';

    for (const t of TABS) {
        document.getElementById(`tab-${t}`).classList.toggle('is-hidden', t !== target);
        document.getElementById(`nav-${t}`)?.classList.toggle('is-active', t === target);
    }
    document.getElementById('page-title').innerHTML = TITLES[target];
}

/** Si la pestaña visible ya no corresponde al rol (p. ej. el admin se
 *  degradó a estilista en caliente), vuelve al dashboard. */
export function ensureAllowedTab() {
    const activa = TABS.find(t => !document.getElementById(`tab-${t}`)?.classList.contains('is-hidden'));
    if (!activa || !can(currentRole(), activa)) switchTab('dashboard');
}
