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
    commissions: '<i class="fa-solid fa-user-tag"></i> Reporte de Comisiones',
    settings: '<i class="fa-solid fa-gear"></i> Configuración'
};

function currentRole() {
    const user = getCurrentUser(getState());
    return user ? user.role : null;
}

/** Oculta/muestra los botones del nav según el rol. La Configuración ya no
 *  vive en la sidebar sino en el menú de sesión, así que renderNav también
 *  alterna su acceso. El resto de utilidades (usuarios, Restaurar demo,
 *  impresión) viven dentro de la pestaña Configuración. */
export function renderNav(role) {
    for (const t of TABS) {
        document.getElementById(`nav-${t}`)?.classList.toggle('is-hidden', !can(role, t));
    }
    document.getElementById('menu-settings')?.classList.toggle('is-hidden', !can(role, 'settings'));
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
