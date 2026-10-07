/* Reportes por rango de fechas (100% dominio, sin DOM → testeable en node).
 *
 * Los rangos llegan como fechas locales 'YYYY-MM-DD' (de un <input type="date">)
 * y son inclusivos por día: desde las 00:00 del inicio hasta las 23:59:59.999
 * del fin. Un extremo vacío significa "sin límite" por ese lado.
 */

import { getState } from '../core/state.js';

function dayBounds(desde, hasta) {
    const start = desde ? new Date(`${desde}T00:00:00`) : null;
    const end = hasta ? new Date(`${hasta}T23:59:59.999`) : null;
    return {
        start: start && !Number.isNaN(start.getTime()) ? start.getTime() : null,
        end: end && !Number.isNaN(end.getTime()) ? end.getTime() : null
    };
}

/** ¿La fecha ISO cae dentro del rango (inclusivo)? */
export function inRange(iso, desde, hasta) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    const { start, end } = dayBounds(desde, hasta);
    if (start !== null && t < start) return false;
    if (end !== null && t > end) return false;
    return true;
}

/** Totales de ventas del período: monto, impuestos y desglose por método. */
export function salesBetween(desde, hasta, state = getState()) {
    const res = { count: 0, subtotal: 0, tax: 0, totalUSD: 0, byMethod: { cash: 0, card: 0, other: 0 } };
    for (const tx of state.transactions) {
        if (!inRange(tx.date, desde, hasta)) continue;
        res.count += 1;
        res.subtotal += tx.subtotal;
        res.tax += tx.tax;
        res.totalUSD += tx.total;
        res.byMethod[tx.method] = (res.byMethod[tx.method] || 0) + tx.total;
    }
    return res;
}

/**
 * Comisiones por estilista en el período: ventas atendidas, monto vendido y
 * comisión acumulada (según el snapshot guardado en cada transacción).
 */
export function commissionsBetween(desde, hasta, state = getState()) {
    const map = new Map();
    for (const tx of state.transactions) {
        if (!inRange(tx.date, desde, hasta)) continue;
        const key = tx.staffId || '—';
        if (!map.has(key)) {
            map.set(key, { staffId: key, staffName: tx.staffName || 'N/A', sales: 0, totalUSD: 0, commissionUSD: 0 });
        }
        const row = map.get(key);
        row.sales += 1;
        row.totalUSD += tx.total;
        row.commissionUSD += tx.commission;
    }
    return [...map.values()].sort((a, b) => b.commissionUSD - a.commissionUSD);
}

/** Cortes de caja cuyo cierre cae dentro del rango. */
export function closuresBetween(desde, hasta, state = getState()) {
    return state.closures.filter(c => inRange(c.closedAt, desde, hasta));
}