import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSeedState } from '../js/core/seed.js';
import {
    openCashSession, addWithdrawal, closeCashSession, cashSummary,
    salesByMethod, CashError
} from '../js/domain/cash.js';

// Fecha por defecto = ahora: las ventas caen dentro de la sesión abierta.
const venta = (id, total, method, date = new Date().toISOString()) => ({ id, date, total, method });

test('openCashSession: abre con fondo; reabrir o fondo malo falla', () => {
    const state = createSeedState();
    assert.equal(state.cashSession.open, false, 'la semilla arranca con la caja cerrada');

    const s = openCashSession(50, state);
    assert.equal(s.open, true);
    assert.equal(s.fondoInicial, 50);
    assert.equal(s.withdrawals.length, 0);
    assert.ok(!Number.isNaN(new Date(s.openedAt).getTime()), 'openedAt es una fecha legible');

    assert.throws(() => openCashSession(10, state), CashError, 'no se puede abrir dos veces');
    state.cashSession.open = false;
    assert.throws(() => openCashSession(-1, state), CashError, 'fondo negativo');
});

test('salesByMethod: agrupa por método y respeta la fecha desde', () => {
    const state = createSeedState();
    state.transactions.push(
        venta('TX-1', 10, 'cash'),
        venta('TX-2', 20, 'debit'),
        venta('TX-3', 30, 'other'),
        venta('TX-4', 99, 'cash', '2026-10-05T10:00:00.000Z') // del día anterior
    );

    const todo = salesByMethod(null, state);
    assert.equal(todo.cash, 109);
    assert.equal(todo.debit, 20);
    assert.equal(todo.other, 30);
    assert.equal(todo.count, 4);

    const hoy = salesByMethod('2026-10-06T00:00:00.000Z', state);
    assert.equal(hoy.cash, 10, 'las ventas anteriores al período no cuentan');
    assert.equal(hoy.count, 3);
});

test('salesByMethod: reparte los pagos mixtos entre sus métodos', () => {
    const state = createSeedState();
    state.transactions.push({
        id: 'TX-1',
        date: new Date().toISOString(),
        total: 50,
        method: 'cash',
        payments: [
            { method: 'cash', amountUSD: 20 },
            { method: 'debit', amountUSD: 30 }
        ]
    });

    const s = salesByMethod(null, state);
    assert.equal(s.cash, 20);
    assert.equal(s.debit, 30);
    assert.equal(s.count, 1);
});

test('retiros: solo con caja abierta y montos válidos', () => {
    const state = createSeedState();
    assert.throws(() => addWithdrawal(5, 'x', state), CashError, 'caja cerrada');

    openCashSession(50, state);
    assert.throws(() => addWithdrawal(-5, 'x', state), CashError, 'monto negativo');
    assert.throws(() => addWithdrawal(0, 'x', state), CashError, 'monto cero');

    const w = addWithdrawal(15, 'Banco', state);
    assert.equal(w.amount, 15);
    assert.equal(w.note, 'Banco');
    assert.equal(state.cashSession.withdrawals.length, 1);
});

test('closeCashSession: corte = fondo + dinero físico − retiros y registra la diferencia', () => {
    const state = createSeedState();
    openCashSession(50, state);
    state.transactions.push(
        venta('TX-1', 40, 'cash'),
        venta('TX-2', 30, 'debit'),
        venta('TX-3', 10, 'other')
    );
    addWithdrawal(10, 'Retiro', state);

    const corte = closeCashSession(75, state);

    assert.equal(corte.esperadoUSD, 80, '50 de fondo + 40 físicos − 10 de retiro (débito no entra al cajón)');
    assert.equal(corte.contadoUSD, 75);
    assert.equal(corte.diferenciaUSD, -5, 'faltante de 5 → negativo');
    assert.equal(corte.ventas.cash, 40);
    assert.equal(corte.ventas.debit, 30);
    assert.equal(corte.ventas.other, 10);
    assert.equal(corte.totalUSD, 80);
    assert.equal(corte.retirosUSD, 10);
    assert.equal(corte.txCount, 3);
    assert.equal(state.cashSession.open, false, 'la sesión queda cerrada');
    assert.equal(state.cashSession.withdrawals.length, 0, 'los retiros se congelan en el corte');
    assert.equal(state.closures.length, 1, 'el corte queda en el historial');
    assert.throws(() => closeCashSession(10, state), CashError, 'no se cierra dos veces');
});

test('closeCashSession: la divisa cuenta como dinero físico en el esperado', () => {
    const state = createSeedState();
    openCashSession(20, state);
    state.transactions.push(venta('TX-1', 30, 'divisa'));

    const corte = closeCashSession(50, state);
    assert.equal(corte.esperadoUSD, 50, '20 de fondo + 30 en divisa');
    assert.equal(corte.diferenciaUSD, 0);
});

test('closeCashSession: contado exacto → diferencia 0; contado malo → error', () => {
    const state = createSeedState();
    openCashSession(20, state);
    state.transactions.push(venta('TX-1', 30, 'cash'));

    assert.throws(() => closeCashSession(-1, state), CashError, 'contado negativo');
    const corte = closeCashSession(50, state);
    assert.equal(corte.diferenciaUSD, 0, 'cuadra exacto');
});

test('cashSummary refleja la sesión viva', () => {
    const state = createSeedState();
    openCashSession(20, state);
    state.transactions.push(venta('TX-1', 15, 'cash'));

    const s = cashSummary(state);
    assert.equal(s.open, true);
    assert.equal(s.fondoInicial, 20);
    assert.equal(s.ventas.cash, 15);
    assert.equal(s.retiros, 0);
    assert.equal(s.esperado, 35, '20 + 15 − 0');
});
