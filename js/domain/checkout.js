/* Cobro del ticket: valida stock, descuenta retail y BOM, acumula la
 * comisión del estilista y registra la transacción.
 *
 * La validación ocurre ANTES de cualquier mutación: si algo falta, se lanza
 * CheckoutError y el estado queda intacto (el original podía dejar el stock
 * en negativo — bug #4).
 */

import { getState } from '../core/state.js';
import { nextTransactionId } from '../core/utils.js';
import { getSnapshot } from '../core/rates.js';
import { findStaff, commissionRateOf } from './staff.js';
import { findProduct } from './inventory.js';
import { findService } from './services.js';
import { ticketTotals } from './ticket.js';

export class CheckoutError extends Error {}

function checkStock(state) {
    const problems = [];

    for (const item of state.currentTicket.items) {
        if (item.type === 'product') {
            const prod = findProduct(item.id, state);
            if (!prod) {
                problems.push(`${item.name} (ya no está en el catálogo)`);
                continue;
            }
            if (prod.stock < item.qty) {
                problems.push(`${prod.name}: pide ${item.qty}, hay ${prod.stock}`);
            }
        } else {
            const serv = findService(item.id, state);
            if (!serv) {
                problems.push(`${item.name} (ya no está en el catálogo)`);
                continue;
            }
            for (const ing of serv.recipe) {
                const raw = findProduct(ing.productId, state);
                if (!raw) continue;
                const needed = ing.amount * item.qty;
                if (raw.stock < needed) {
                    problems.push(`${raw.name}: faltan ${needed - raw.stock} ${raw.unit.toLowerCase()} (hay ${raw.stock})`);
                }
            }
        }
    }
    return problems;
}

function applyDeductions(state) {
    for (const item of state.currentTicket.items) {
        if (item.type === 'product') {
            const prod = findProduct(item.id, state);
            prod.stock -= item.qty;
        } else {
            const serv = findService(item.id, state);
            if (!serv) continue;
            for (const ing of serv.recipe) {
                const raw = findProduct(ing.productId, state);
                if (raw) raw.stock -= ing.amount * item.qty;
            }
        }
    }
}

/**
 * Procesa el cobro del ticket actual.
 * @param {object} [opts]
 * @param {'cash'|'card'|'other'} [opts.method] método de pago (default 'cash')
 * @param {number} [opts.receivedUSD] efectivo recibido en USD; en efectivo se
 *        valida contra el total y de ahí sale el cambio. Si se omite se
 *        asume pago exacto.
 * @returns {object} la transacción registrada
 * @throws {CheckoutError} si el ticket está vacío, no hay stock o el
 *         recibido es menor que el total (antes de cualquier mutación)
 */
export function processPayment(state = getState(), opts = {}) {
    if (state.currentTicket.items.length === 0) {
        throw new CheckoutError('Agrega al menos un ítem al ticket antes de cobrar.');
    }

    if (!state.cashSession || state.cashSession.open !== true) {
        throw new CheckoutError('La caja está cerrada: ábrela para poder cobrar.');
    }

    const problems = checkStock(state);
    if (problems.length > 0) {
        throw new CheckoutError('Stock insuficiente: ' + problems.join(' · '));
    }

    const staff = findStaff(state.currentTicket.staffId, state);
    const { subtotal, tax, total, commission } = ticketTotals(state);

    const method = ['cash', 'card', 'other'].includes(opts.method)
        ? opts.method
        : 'cash';

    let receivedUSD = total;
    let changeUSD = 0;
    if (method === 'cash') {
        receivedUSD = Number.isFinite(opts.receivedUSD) ? opts.receivedUSD : total;
        if (receivedUSD + 1e-9 < total) {
            throw new CheckoutError('El monto recibido es menor al total a cobrar.');
        }
        changeUSD = receivedUSD - total;
        if (changeUSD < 1e-9) changeUSD = 0;
    }

    applyDeductions(state);

    if (staff) {
        staff.totalCommissions += commission;
        staff.salesCount += 1;
    }

    const now = new Date();
    const tx = {
        id: nextTransactionId(),
        date: now.toISOString(),
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        staffId: state.currentTicket.staffId,
        staffName: staff ? staff.name : 'N/A',
        items: state.currentTicket.items.map(i => ({ type: i.type, qty: i.qty })),
        subtotal,
        tax,
        total,
        commission,
        method,
        receivedUSD,
        changeUSD,
        // Tasa BCV del momento: el importe se guarda en USD y este snapshot
        // permite reportar la venta en Bs fieles aunque la tasa cambie.
        rates: (() => {
            const s = getSnapshot();
            return { usdBs: s.usdBs, eurBs: s.eurBs, fecha: s.fecha };
        })()
    };
    state.transactions.unshift(tx);

    state.currentTicket.items = [];
    state.currentTicket.paymentMethod = 'cash';
    return tx;
}

/** Comisión que cobraría hoy un estilista dado (helper para reportes/tests). */
export function commissionFor(staff, itemTotal) {
    return itemTotal * (commissionRateOf(staff) / 100);
}
