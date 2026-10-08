/* Cobro del ticket: valida stock, exige la referencia/comprobante de los
 * métodos marcados como necesarios, descuenta productos y consume los
 * insumos de cada servicio, acumula la comisión del estilista y registra la
 * venta.
 *
 * La validación ocurre ANTES de cualquier mutación: si algo falta, se lanza
 * CheckoutError y el estado queda intacto (el original podía dejar el stock
 * en negativo). Este módulo no cobra un solo método: delega la liquidación
 * del pago mixto en domain/payments.js (settlePayments).
 */

import { getState } from '../core/state.js';
import { nextTransactionId } from '../core/utils.js';
import { getSnapshot } from '../core/rates.js';
import { settlePayments, primaryMethod, missingReferenceMethods, activePaymentMethods } from './payments.js';
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
 * @param {Array<{method:string, amountUSD:number}>} [opts.payments] pagos
 *        brutos (montos en USD). Si se omite, se cobra el total exacto en
 *        efectivo (compatibilidad).
 * @returns {object} la transacción registrada
 * @throws {CheckoutError} si el ticket está vacío, no hay stock, la caja
 *         está cerrada o los pagos no cubren el total (todo antes de mutar)
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

    // Pagos: los del ticket (pago mixto) o, si no, total exacto en efectivo.
    const rawPayments = Array.isArray(opts.payments) && opts.payments.length > 0
        ? opts.payments
        : [{ method: 'cash', amountUSD: total }];

    // Métodos con mayor cantidad de referencia: exigen número o comprobante.
    const faltanRef = missingReferenceMethods(rawPayments, activePaymentMethods(state));
    if (faltanRef.length > 0) {
        throw new CheckoutError(
            `Falta la referencia de ${faltanRef.join(', ')}: escribe el número de operación o adjunta el comprobante.`);
    }

    let settle;
    try {
        settle = settlePayments(rawPayments, total);
    } catch (err) {
        throw new CheckoutError(err.message);
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
        // Snapshot del ítem (id, nombre y precio del momento): el ticket de
        // canje y el historial no dependen de que el catálogo siga igual.
        items: state.currentTicket.items.map(i => ({
            type: i.type,
            id: i.id,
            name: i.name,
            price: i.price,
            qty: i.qty,
            staffId: state.currentTicket.staffId,
            staffName: staff ? staff.name : 'N/A'
        })),
        subtotal,
        tax,
        total,
        commission,
        // `method` es el método dominante (etiquetas/legado); el detalle del
        // pago mixto vive en `payments`, ya con el vuelto descontado.
        method: primaryMethod(settle.payments),
        payments: settle.payments,
        receivedUSD: settle.paidUSD,
        changeUSD: settle.changeUSD,
        // Tasa BCV del momento: el importe se guarda en USD y este snapshot
        // permite reportar la venta en Bs fieles aunque la tasa cambie.
        rates: (() => {
            const s = getSnapshot();
            return { usdBs: s.usdBs, eurBs: s.eurBs, fecha: s.fecha };
        })()
    };
    state.transactions.unshift(tx);

    state.currentTicket.items = [];
    state.currentTicket.payments = [];
    return tx;
}

/** Comisión que cobraría hoy un estilista dado (helper para reportes/tests). */
export function commissionFor(staff, itemTotal) {
    return itemTotal * (commissionRateOf(staff) / 100);
}
