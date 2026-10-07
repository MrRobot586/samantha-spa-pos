/* Caja: sesión de apertura, retiros, ventas por método y corte.
 *
 * Todo el dinero se guarda en USD (la moneda es solo visual — rates.js):
 * el fondo y el contado llegan en la moneda activa y se traducen antes de
 * persistir. El corte compara lo esperado contra el contado físico y
 * registra la diferencia, que puede ser negativa (faltante).
 *
 * Dinero físico: solo Efectivo y Divisa entran al arqueo del cajón; Débito
 * y Pago Móvil son electrónicos y se reportan como ventas pero no como
 * efectivo esperado.
 */

import { getState } from '../core/state.js';
import { getCurrentUser } from '../core/auth.js';
import { getSnapshot } from '../core/rates.js';
import { uid } from '../core/utils.js';
import { PAYMENT_IDS, CASH_DRAWER_METHODS, paymentsOf } from './payments.js';

export class CashError extends Error {}

/** Ventas por método desde `desde` (ISO); sin fecha, de toda la historia.
 *  Devuelve un objeto con una clave por método (incluidos los históricos que
 *  aparezcan) más `count` con el número de transacciones. */
export function salesByMethod(desde, state = getState()) {
    const t0 = desde ? new Date(desde).getTime() : -Infinity;
    const out = { count: 0 };
    for (const id of PAYMENT_IDS) out[id] = 0;

    for (const t of state.transactions) {
        const t1 = new Date(t.date).getTime();
        if (Number.isNaN(t1) || t1 < t0) continue;
        for (const pago of paymentsOf(t)) {
            out[pago.method] = (out[pago.method] || 0) + pago.amountUSD;
        }
        out.count += 1;
    }
    return out;
}

export function openCashSession(fondoInicial, state = getState()) {
    if (state.cashSession.open) {
        throw new CashError('La caja ya está abierta.');
    }
    if (!Number.isFinite(fondoInicial) || fondoInicial < 0) {
        throw new CashError('El fondo inicial no es válido.');
    }
    state.cashSession = {
        open: true,
        openedAt: new Date().toISOString(),
        fondoInicial,
        withdrawals: []
    };
    return state.cashSession;
}

export function addWithdrawal(amount, note, state = getState()) {
    const s = state.cashSession;
    if (!s.open) throw new CashError('La caja está cerrada.');
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new CashError('El monto del retiro no es válido.');
    }
    const user = getCurrentUser(state);
    const w = {
        amount,
        note: String(note || '').trim(),
        at: new Date().toISOString(),
        by: user ? user.username : 'N/A'
    };
    s.withdrawals.push(w);
    return w;
}

/** Ventas en dinero físico (efectivo + divisa) de un desglose por método. */
function fisicoDe(ventas) {
    return CASH_DRAWER_METHODS.reduce((a, m) => a + (ventas[m] || 0), 0);
}

function resumen(state) {
    const s = state.cashSession;
    const ventas = salesByMethod(s.openedAt, state);
    const retiros = s.withdrawals.reduce((a, w) => a + w.amount, 0);
    const esperado = s.fondoInicial + fisicoDe(ventas) - retiros;
    return { ventas, retiros, esperado };
}

/** Estado vivo de la caja (sesión actual) para la vista y los modales. */
export function cashSummary(state = getState()) {
    const s = state.cashSession;
    const { ventas, retiros, esperado } = resumen(state);
    return {
        open: s.open,
        openedAt: s.openedAt,
        fondoInicial: s.fondoInicial,
        withdrawals: s.withdrawals,
        ventas,
        retiros,
        esperado
    };
}

export function closeCashSession(contado, state = getState()) {
    const s = state.cashSession;
    if (!s.open) throw new CashError('La caja ya está cerrada.');
    if (!Number.isFinite(contado) || contado < 0) {
        throw new CashError('El contado no es válido.');
    }

    const { ventas, retiros, esperado } = resumen(state);
    const user = getCurrentUser(state);
    const snap = getSnapshot();

    const { count, ...porMetodo } = ventas;
    const totalUSD = Object.values(porMetodo).reduce((a, v) => a + v, 0);

    const closure = {
        id: uid(),
        openedAt: s.openedAt,
        closedAt: new Date().toISOString(),
        closedById: user ? user.id : '',
        closedByName: user ? user.name : 'N/A',
        fondoInicial: s.fondoInicial,
        ventas: { ...porMetodo },
        totalUSD,
        retirosUSD: retiros,
        esperadoUSD: esperado,
        contadoUSD: contado,
        diferenciaUSD: contado - esperado,
        txCount: count,
        rates: { usdBs: snap.usdBs, eurBs: snap.eurBs, fecha: snap.fecha }
    };
    state.closures.unshift(closure);
    state.cashSession = { open: false, openedAt: null, fondoInicial: 0, withdrawals: [] };
    return closure;
}