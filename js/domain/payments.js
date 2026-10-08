/* Métodos de pago y liquidación de una venta (100% dominio, sin DOM).
 *
 * Una venta puede cubrirse con varios métodos a la vez (pago mixto). Cada
 * pago se expresa en USD —igual que el resto del estado— y las reglas son:
 *
 *  - Efectivo y Divisa son dinero físico: su excedente produce vuelto y
 *    son los únicos que entran al arqueo del cajón (efectivo esperado).
 *  - Débito y Pago Móvil son electrónicos: deben ir a monto exacto, nunca
 *    por encima del total (el vuelto no se devuelve por el punto de venta).
 *  - El vuelto se descuenta primero de Efectivo y luego de Divisa, para que
 *    los pagos guardados reflejen el dinero neto retenido en caja.
 *
 * Métodos dinámicos: la lista de métodos vigentes vive en
 * `settings.paymentMethods` (admin las edita desde Configuración). Cada
 * método es `{ id, label, icon, type }` con `type` ∈ 'fisico' | 'electronico'.
 * Las reglas se derivan del type: físicos admiten vuelto y entran al arqueo;
 * electrónicos deben ir a monto exacto. Estas funciones aceptan un parámetro
 * `methods` opcional (default = los 4 de fábrica) para no acoplarlas al DOM
 * y poder probarlas en node puro.
 */

import { getState } from '../core/state.js';

export class PaymentError extends Error {}

const FISICO = 'fisico';

export const DEFAULT_PAYMENT_METHODS = [
    { id: 'cash', label: 'Efectivo', icon: 'fa-money-bill-wave', type: FISICO },
    { id: 'debit', label: 'Débito', icon: 'fa-credit-card', type: 'electronico' },
    { id: 'pago_movil', label: 'Pago Móvil', icon: 'fa-mobile-screen', type: 'electronico' },
    { id: 'divisa', label: 'Divisa', icon: 'fa-money-bill', type: FISICO }
];

/** Alias de compatibilidad: la lista de fábrica. */
export const PAYMENT_METHODS = DEFAULT_PAYMENT_METHODS;

export const PAYMENT_IDS = DEFAULT_PAYMENT_METHODS.map(m => m.id);

/** Métodos físicos de fábrica (compat): el arqueo usa la lista activa. */
export const CASH_DRAWER_METHODS = DEFAULT_PAYMENT_METHODS.filter(m => m.type === FISICO).map(m => m.id);

/** Métodos vigentes según settings. Garantiza que `cash` exista siempre:
 *  es el respaldo del cobro y del arqueo del cajón. */
export function activePaymentMethods(state = getState()) {
    const raw = state && state.settings && Array.isArray(state.settings.paymentMethods)
        ? state.settings.paymentMethods
        : DEFAULT_PAYMENT_METHODS;

    const clean = raw
        .filter(m => m && typeof m.id === 'string' && m.id.trim() && typeof m.label === 'string' && m.label.trim())
        .map(m => ({
            id: m.id,
            label: m.label,
            icon: typeof m.icon === 'string' && m.icon.trim() ? m.icon
                : (m.type === FISICO ? 'fa-money-bill' : 'fa-credit-card'),
            type: m.type === FISICO ? FISICO : 'electronico'
        }));

    const unicos = [];
    for (const m of clean) if (!unicos.some(x => x.id === m.id)) unicos.push(m);
    if (!unicos.some(m => m.id === 'cash')) unicos.unshift(DEFAULT_PAYMENT_METHODS[0]);
    return unicos.length > 0 ? unicos : DEFAULT_PAYMENT_METHODS;
}

/** Etiquetas de métodos históricos: ya no se ofrecen, pero el historial
 *  guardado puede contenerlos y deben seguir siendo legibles. */
const LEGACY_LABELS = { card: 'Tarjeta (histórico)', other: 'Otro (histórico)' };

const EPS = 1e-9;
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

export function methodById(id, methods = PAYMENT_METHODS) {
    const list = methods && methods.length > 0 ? methods : PAYMENT_METHODS;
    return list.find(m => m.id === id) || null;
}

export function isPaymentMethod(id, methods = PAYMENT_METHODS) {
    return methodById(id, methods) !== null;
}

export function isLegacyMethod(id) {
    return Object.prototype.hasOwnProperty.call(LEGACY_LABELS, id);
}

/** Etiqueta legible de cualquier código (métodos activos, históricos o
 *  desconocidos). */
export function methodLabel(id, methods) {
    const m = methodById(id, methods);
    if (m) return m.label;
    return LEGACY_LABELS[id] || 'Método desconocido';
}

export function isCashDrawerMethod(id, methods = PAYMENT_METHODS) {
    const m = methodById(id, methods);
    return Boolean(m && m.type === FISICO);
}

/** Ids de los métodos físicos de una lista (dinero que entra al arqueo). */
export function cashDrawerMethods(methods = PAYMENT_METHODS) {
    return methods.filter(m => m.type === FISICO).map(m => m.id);
}

/**
 * Limpia una lista de pagos: solo montos > 0 con método conocido o histórico.
 * @returns {Array<{method: string, amountUSD: number}>}
 */
export function normalizePayments(payments, methods = PAYMENT_METHODS) {
    if (!Array.isArray(payments)) return [];
    return payments
        .filter(p => p && typeof p.method === 'string'
            && (isPaymentMethod(p.method, methods) || isLegacyMethod(p.method)))
        .map(p => ({ method: p.method, amountUSD: Number(p.amountUSD) }))
        .filter(p => Number.isFinite(p.amountUSD) && p.amountUSD > EPS)
        .map(p => ({ method: p.method, amountUSD: round2(p.amountUSD) }));
}

/** Pagos de una transacción ya cobrada; las ventas viejas se tratan como un
 *  único pago por su método dominante. */
export function paymentsOf(tx, methods = PAYMENT_METHODS) {
    const directos = normalizePayments(tx && tx.payments, methods);
    if (directos.length > 0) return directos;
    const method = tx && (isPaymentMethod(tx.method, methods) || isLegacyMethod(tx.method)) ? tx.method : 'cash';
    const total = tx && Number.isFinite(tx.total) ? tx.total : 0;
    return [{ method, amountUSD: total }];
}

/** Método con el mayor monto de la venta (para etiquetas y compatibilidad). */
export function primaryMethod(payments, methods = PAYMENT_METHODS) {
    const list = normalizePayments(payments, methods);
    if (list.length === 0) return 'cash';
    return list.reduce((a, b) => (b.amountUSD > a.amountUSD ? b : a)).method;
}

/**
 * Liquida una venta: valida los pagos contra el total y calcula el vuelto.
 * @param {Array<{method:string, amountUSD:number}>} rawPayments pagos brutos
 * @param {number} total total de la venta en USD
 * @param {Array} methods lista de métodos vigentes (default: los de fábrica)
 * @returns {{ paidUSD:number, changeUSD:number, payments:Array<{method:string, amountUSD:number}> }}
 *          `payments` son los montos netos ya descontado el vuelto (lo que
 *          realmente queda en caja), y `paidUSD` el bruto entregado.
 * @throws {PaymentError}
 */
export function settlePayments(rawPayments, total, methods = PAYMENT_METHODS) {
    const totalUSD = Number.isFinite(total) ? total : 0;
    const payments = normalizePayments(rawPayments, methods);
    if (payments.length === 0) {
        throw new PaymentError('Selecciona al menos un método de pago con un monto mayor a 0.');
    }

    const paidUSD = payments.reduce((a, p) => a + p.amountUSD, 0);
    const electronic = payments
        .filter(p => !isCashDrawerMethod(p.method, methods))
        .reduce((a, p) => a + p.amountUSD, 0);

    if (electronic - EPS > totalUSD) {
        throw new PaymentError('Los métodos electrónicos no pueden superar el total: el vuelto se entrega en efectivo o divisa.');
    }
    if (paidUSD + EPS < totalUSD) {
        throw new PaymentError(`Faltan ${round2(totalUSD - paidUSD).toFixed(2)} por cubrir.`);
    }

    const changeUSD = round2(Math.max(0, paidUSD - totalUSD));

    // El vuelto sale primero del efectivo y luego de la divisa.
    const netos = payments.map(p => ({ ...p }));
    let restante = changeUSD;
    for (const p of netos) {
        if (restante <= EPS) break;
        if (!isCashDrawerMethod(p.method, methods)) continue;
        const descuento = Math.min(p.amountUSD, restante);
        p.amountUSD = round2(p.amountUSD - descuento);
        restante = round2(restante - descuento);
    }

    return {
        paidUSD: round2(paidUSD),
        changeUSD,
        payments: netos.filter(p => p.amountUSD > EPS)
    };
}