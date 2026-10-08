/* Ticket actual: ítems, cantidades, total y métodos de pago. Sin DOM: se
 * puede probar en node puro.
 *
 * Regla de comisión (decisión del refactor): la comisión de un servicio es
 * la tasa del ESTILISTA SELECCIONADO, no un porcentaje propio del servicio.
 * Los servicios ya no llevan campo commissionPercent.
 *
 * Pago mixto: el ticket guarda una lista `payments` de { method, amountUSD }.
 * La liquidación (vuelto, reglas por método) vive en domain/payments.js.
 */

import { getState } from '../core/state.js';
import { TAX_RATE } from '../core/config.js';
import { isPaymentMethod } from './payments.js';
import { findStaff, roleCommissionRate } from './staff.js';
import { findProduct } from './inventory.js';
import { findService } from './services.js';

/** Agrega un servicio o producto de venta al ticket (qty 1 o +1 si ya existe). */
export function addItem(type, id, state = getState()) {
    if (type !== 'service' && type !== 'product') {
        throw new Error('Tipo de ítem no válido.');
    }

    const item = type === 'service' ? findService(id, state) : findProduct(id, state);
    if (!item) throw new Error('El ítem ya no existe en el catálogo.');

    if (type === 'product' && item.type !== 'sale') {
        throw new Error('Los productos de uso interno no se venden por separado.');
    }

    const existing = state.currentTicket.items.find(i => i.type === type && i.id === id);
    if (existing) {
        existing.qty += 1;
    } else {
        state.currentTicket.items.push({ type, id, name: item.name, price: item.price, qty: 1 });
    }
    return state.currentTicket;
}

/** Cambia la cantidad del ítem en `index`; lo elimina si baja de 1. */
export function changeQty(index, delta, state = getState()) {
    const item = state.currentTicket.items[index];
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
        state.currentTicket.items.splice(index, 1);
    }
}

export function clearTicket(state = getState()) {
    state.currentTicket.items = [];
    state.currentTicket.payments = [];
}

/** Cambia el estilista atribuido al ticket (valida que exista). */
export function setTicketStaff(staffId, state = getState()) {
    if (!findStaff(staffId, state)) {
        throw new Error('Estilista no válido.');
    }
    state.currentTicket.staffId = staffId;
}

/**
 * Fija el monto pagado con un método (pago mixto). Un monto de 0 o vacío
 * quita ese método del ticket.
 */
export function setPaymentAmount(method, amountUSD, state = getState()) {
    if (!isPaymentMethod(method)) throw new Error('Método de pago no válido.');

    const amount = Number(amountUSD);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('El monto del pago no es válido.');
    }

    const list = state.currentTicket.payments;
    const idx = list.findIndex(p => p.method === method);
    if (amount <= 0) {
        if (idx >= 0) list.splice(idx, 1);
        return state.currentTicket;
    }
    if (idx >= 0) list[idx].amountUSD = amount;
    else list.push({ method, amountUSD: amount });
    return state.currentTicket;
}

/**
 * Subtotal, IVA, total y comisión estimada del ticket actual.
 * Comisión: solo sobre servicios, con la tasa del rol (settings), y solo si
 * hay un estilista seleccionado (sin estilista no hay a quién acreditarla).
 */
export function ticketTotals(state = getState()) {
    const staff = findStaff(state.currentTicket.staffId, state);
    const rate = staff ? roleCommissionRate(state) : 0;

    let subtotal = 0;
    let commission = 0;

    for (const item of state.currentTicket.items) {
        const itemTotal = item.price * item.qty;
        subtotal += itemTotal;
        if (item.type === 'service') {
            commission += itemTotal * (rate / 100);
        }
    }

    const tax = subtotal * TAX_RATE;
    return { subtotal, tax, total: subtotal + tax, commission };
}