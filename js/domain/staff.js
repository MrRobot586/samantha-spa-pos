/* Personal: lookup y comisiones.
 *
 * La comisión es del ROL: se lee de `settings.stylistCommissionRate` (única
 * para todos los estilistas, editable por el admin desde Configuración). El
 * `commissionRate` por estilista se conserva en el esquema por compatibilidad
 * con datos viejos, pero ya no se usa para calcular la comisión. */

import { getState } from '../core/state.js';

export function findStaff(id, state = getState()) {
    return state.staff.find(s => s.id === id) ?? null;
}

/** Porcentaje vigente del rol estilista (0–100), desde settings. */
export function roleCommissionRate(state = getState()) {
    const rate = Number(state.settings && state.settings.stylistCommissionRate);
    return Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 100) : 0;
}

/** Tasa de comisión vigente del rol (la del estilista ya no se usa). */
export function commissionRateOf(_staff, state = getState()) {
    return roleCommissionRate(state);
}
