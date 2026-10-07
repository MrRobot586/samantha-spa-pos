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
 */

export class PaymentError extends Error {}

export const PAYMENT_METHODS = [
    { id: 'cash', label: 'Efectivo', icon: 'fa-money-bill-wave', cashDrawer: true },
    { id: 'debit', label: 'Débito', icon: 'fa-credit-card', cashDrawer: false },
    { id: 'pago_movil', label: 'Pago Móvil', icon: 'fa-mobile-screen', cashDrawer: false },
    { id: 'divisa', label: 'Divisa', icon: 'fa-money-bill', cashDrawer: true }
];

export const PAYMENT_IDS = PAYMENT_METHODS.map(m => m.id);

/** Métodos que se cuentan como dinero físico al cerrar la caja. */
export const CASH_DRAWER_METHODS = PAYMENT_METHODS.filter(m => m.cashDrawer).map(m => m.id);

/** Etiquetas de métodos históricos: ya no se ofrecen, pero el historial
 *  guardado puede contenerlos y deben seguir siendo legibles. */
const LEGACY_LABELS = { card: 'Tarjeta (histórico)', other: 'Otro (histórico)' };

const EPS = 1e-9;
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

export function methodById(id) {
    return PAYMENT_METHODS.find(m => m.id === id) || null;
}

export function isPaymentMethod(id) {
    return PAYMENT_IDS.includes(id);
}

export function isLegacyMethod(id) {
    return Object.prototype.hasOwnProperty.call(LEGACY_LABELS, id);
}

/** Etiqueta legible de cualquier código (incluidos los históricos). */
export function methodLabel(id) {
    const m = methodById(id);
    if (m) return m.label;
    return LEGACY_LABELS[id] || 'Método desconocido';
}

export function isCashDrawerMethod(id) {
    return CASH_DRAWER_METHODS.includes(id);
}

/**
 * Limpia una lista de pagos: solo montos > 0 con método conocido o histórico.
 * @returns {Array<{method: string, amountUSD: number}>}
 */
export function normalizePayments(payments) {
    if (!Array.isArray(payments)) return [];
    return payments
        .filter(p => p && typeof p.method === 'string' && (isPaymentMethod(p.method) || isLegacyMethod(p.method)))
        .map(p => ({ method: p.method, amountUSD: Number(p.amountUSD) }))
        .filter(p => Number.isFinite(p.amountUSD) && p.amountUSD > EPS)
        .map(p => ({ method: p.method, amountUSD: round2(p.amountUSD) }));
}

/** Pagos de una transacción ya cobrada; las ventas viejas se tratan como un
 *  único pago por su método dominante. */
export function paymentsOf(tx) {
    const directos = normalizePayments(tx && tx.payments);
    if (directos.length > 0) return directos;
    const method = tx && (isPaymentMethod(tx.method) || isLegacyMethod(tx.method)) ? tx.method : 'cash';
    const total = tx && Number.isFinite(tx.total) ? tx.total : 0;
    return [{ method, amountUSD: total }];
}

/** Método con el mayor monto de la venta (para etiquetas y compatibilidad). */
export function primaryMethod(payments) {
    const list = normalizePayments(payments);
    if (list.length === 0) return 'cash';
    return list.reduce((a, b) => (b.amountUSD > a.amountUSD ? b : a)).method;
}

/**
 * Liquida una venta: valida los pagos contra el total y calcula el vuelto.
 * @param {Array<{method:string, amountUSD:number}>} rawPayments pagos brutos
 * @param {number} total total de la venta en USD
 * @returns {{ paidUSD:number, changeUSD:number, payments:Array<{method:string, amountUSD:number}> }}
 *          `payments` son los montos netos ya descontado el vuelto (lo que
 *          realmente queda en caja), y `paidUSD` el bruto entregado.
 * @throws {PaymentError}
 */
export function settlePayments(rawPayments, total) {
    const totalUSD = Number.isFinite(total) ? total : 0;
    const payments = normalizePayments(rawPayments);
    if (payments.length === 0) {
        throw new PaymentError('Selecciona al menos un método de pago con un monto mayor a 0.');
    }

    const paidUSD = payments.reduce((a, p) => a + p.amountUSD, 0);
    const electronic = payments
        .filter(p => !isCashDrawerMethod(p.method))
        .reduce((a, p) => a + p.amountUSD, 0);

    if (electronic - EPS > totalUSD) {
        throw new PaymentError('Débito y Pago Móvil no pueden superar el total: el vuelto se entrega en efectivo o divisa.');
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
        if (!isCashDrawerMethod(p.method)) continue;
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