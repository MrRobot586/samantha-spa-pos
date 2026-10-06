/* Personal: lookup y comisiones. */

import { getState } from '../core/state.js';

export function findStaff(id, state = getState()) {
    return state.staff.find(s => s.id === id) ?? null;
}

/** Tasa de comisión vigente de un estilista (0 si no existe). */
export function commissionRateOf(staff) {
    if (!staff) return 0;
    const rate = Number(staff.commissionRate);
    return Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 100) : 0;
}
