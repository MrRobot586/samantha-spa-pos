/* Caja: sesión de apertura, retiros, ventas por método y corte.
 *
 * Todo el dinero se guarda en USD (la moneda es solo visual — rates.js):
 * el fondo y el contado llegan en la moneda activa y se traducen antes de
 * persistir. El corte compara lo esperado (fondo + ventas en efectivo −
 * retiros) contra el contado físico y registra la diferencia, que puede
 * ser negativa (faltante). */

import { getState } from '../core/state.js';
import { getCurrentUser } from '../core/auth.js';
import { getSnapshot } from '../core/rates.js';
import { uid } from '../core/utils.js';

export class CashError extends Error {}

const METODOS = ['cash', 'card', 'other'];

/** Ventas por método desde `desde` (ISO); sin fecha, de toda la historia. */
export function salesByMethod(desde, state = getState()) {
    const t0 = desde ? new Date(desde).getTime() : -Infinity;
    const out = { cash: 0, card: 0, other: 0, count: 0 };
    for (const t of state.transactions) {
        const t1 = new Date(t.date).getTime();
        if (Number.isNaN(t1) || t1 < t0) continue;
        const m = METODOS.includes(t.method) ? t.method : 'cash';
        out[m] += t.total;
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

function resumen(state) {
    const s = state.cashSession;
    const ventas = salesByMethod(s.openedAt, state);
    const retiros = s.withdrawals.reduce((a, w) => a + w.amount, 0);
    const esperado = s.fondoInicial + ventas.cash - retiros;
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

    const closure = {
        id: uid(),
        openedAt: s.openedAt,
        closedAt: new Date().toISOString(),
        closedById: user ? user.id : '',
        closedByName: user ? user.name : 'N/A',
        fondoInicial: s.fondoInicial,
        ventas: { cash: ventas.cash, card: ventas.card, other: ventas.other },
        totalUSD: ventas.cash + ventas.card + ventas.other,
        retirosUSD: retiros,
        esperadoUSD: esperado,
        contadoUSD: contado,
        diferenciaUSD: contado - esperado,
        txCount: ventas.count,
        rates: { usdBs: snap.usdBs, eurBs: snap.eurBs, fecha: snap.fecha }
    };
    state.closures.unshift(closure);
    state.cashSession = { open: false, openedAt: null, fondoInicial: 0, withdrawals: [] };
    return closure;
}
