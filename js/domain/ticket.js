/* Lógica del ticket en curso: agregar ítems, cantidades y cálculo del
 * total. Sin DOM: se puede probar en node puro.
 *
 * Regla de comisión (decisión del refactor): la comisión de un servicio es
 * la tasa del ESTILISTA SELECCIONADO, no un porcentaje propio del servicio
 * (el original calculaba con el % del servicio e ignoraba al estilista —
 * bug #3). Los servicios ya no llevan campo commissionPercent.
 */

import { getState } from '../core/state.js';
import { TAX_RATE } from '../core/config.js';
import { findStaff } from './staff.js';
import { findProduct } from './inventory.js';
import { findService } from './services.js';

/** Agrega un servicio o producto retail al ticket (qty 1 o +1 si ya existe). */
export function addItem(type, id, state = getState()) {
    if (type !== 'service' && type !== 'product') {
        throw new Error('Tipo de ítem no válido.');
    }

    const item = type === 'service' ? findService(id, state) : findProduct(id, state);
    if (!item) throw new Error('El ítem ya no existe en el catálogo.');

    if (type === 'product' && item.type !== 'retail') {
        throw new Error('Los insumos de uso interno no se venden por separado.');
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
    state.currentTicket.paymentMethod = 'cash';
}

/** Cambia el estilista atribuido al ticket (valida que exista). */
export function setTicketStaff(staffId, state = getState()) {
    if (!findStaff(staffId, state)) {
        throw new Error('Estilista no válido.');
    }
    state.currentTicket.staffId = staffId;
}

export const PAYMENT_METHODS = ['cash', 'card', 'other'];

/** Método de pago del ticket: cash (efectivo), card (tarjeta) u otro. */
export function setPaymentMethod(method, state = getState()) {
    if (!PAYMENT_METHODS.includes(method)) {
        throw new Error('Método de pago no válido.');
    }
    state.currentTicket.paymentMethod = method;
}

/**
 * Subtotal, IVA, total y comisión estimada del ticket actual.
 * Comisión: solo sobre servicios, con la tasa del estilista del ticket.
 */
export function ticketTotals(state = getState()) {
    const staff = findStaff(state.currentTicket.staffId, state);
    const rate = staff ? staff.commissionRate : 0;

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
