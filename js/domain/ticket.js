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
import { isPaymentMethod, activePaymentMethods } from './payments.js';
import { findStaff, roleCommissionRate } from './staff.js';
import { findProduct } from './inventory.js';
import { findService } from './services.js';

/**
 * Agrega un servicio o producto de venta al ticket (qty 1 o +1 si ya existe).
 * Un producto de venta se limita al stock disponible: no se puede pedir más.
 */
export function addItem(type, id, state = getState()) {
    if (type !== 'service' && type !== 'product') {
        throw new Error('Tipo de ítem no válido.');
    }

    const item = type === 'service' ? findService(id, state) : findProduct(id, state);
    if (!item) throw new Error('El ítem ya no existe en el catálogo.');

    if (type === 'product' && item.type !== 'sale') {
        throw new Error('Los productos de uso interno no se venden por separado.');
    }

    const disponible = type === 'product' ? Math.max(0, Number(item.stock) || 0) : Infinity;
    if (disponible === 0) {
        throw new Error(`No queda stock de "${item.name}".`);
    }

    const existing = state.currentTicket.items.find(i => i.type === type && i.id === id);
    if (existing) {
        if (existing.qty + 1 > disponible) {
            throw new Error(`Solo hay ${disponible} disponible(s) de "${item.name}".`);
        }
        existing.qty += 1;
    } else {
        state.currentTicket.items.push({ type, id, name: item.name, price: item.price, qty: 1 });
    }
    return state.currentTicket;
}

/**
 * Cambia la cantidad del ítem en `index`; lo elimina si baja de 1. Subir a un
 * producto de venta no puede pasar del stock disponible.
 */
export function changeQty(index, delta, state = getState()) {
    const item = state.currentTicket.items[index];
    if (!item) return;
    if (delta > 0 && item.type === 'product') {
        const product = findProduct(item.id, state);
        const disponible = Math.max(0, Number(product?.stock) || 0);
        if (item.qty + delta > disponible) {
            throw new Error(`Solo hay ${disponible} disponible(s) de "${item.name}".`);
        }
    }
    item.qty += delta;
    if (item.qty <= 0) {
        state.currentTicket.items.splice(index, 1);
    }
}

/** Quita el ítem en `index` del ticket (adelgaza la lista, no el catálogo). */
export function removeItem(index, state = getState()) {
    if (!Number.isInteger(index) || index < 0 || index >= state.currentTicket.items.length) return;
    state.currentTicket.items.splice(index, 1);
}

/** Quita varios ítems de una vez (acción masiva del checklist). */
export function removeItems(indices, state = getState()) {
    const set = new Set(indices.filter(Number.isInteger));
    if (set.size === 0) return;
    state.currentTicket.items = state.currentTicket.items.filter((_, i) => !set.has(i));
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
    if (!isPaymentMethod(method, activePaymentMethods(state))) {
        throw new Error('Método de pago no válido.');
    }

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
 * Cuánto falta por cubrir con `method` (en USD): el total del ticket menos lo
 * que ya aportaron los demás métodos. Si nadie ha pagado es el total; nunca
 * baja de 0. Es lo que el cajero suele querer tildar en una fila de cobro.
 */
export function pendingAmountFor(method, state = getState()) {
    const { total } = ticketTotals(state);
    const pagadoOtros = state.currentTicket.payments
        .filter(p => p.method !== method)
        .reduce((suma, p) => suma + (Number(p.amountUSD) || 0), 0);
    return Math.max(Math.round((total - pagadoOtros) * 100) / 100, 0);
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