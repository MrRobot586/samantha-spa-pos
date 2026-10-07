import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSeedState } from '../js/core/seed.js';
import { inRange, salesBetween, commissionsBetween, closuresBetween } from '../js/domain/reports.js';
import { buildCsv } from '../js/core/utils.js';

function tx(id, date, { staffId = 'st1', staffName = 'Valeria', total = 100, commission = 50, method = 'cash', subtotal = 100, tax = 0 } = {}) {
    return { id, date, time: '', staffId, staffName, items: [], subtotal, tax, total, commission, method, receivedUSD: total, changeUSD: 0, rates: { usdBs: null, eurBs: null, fecha: null } };
}

function estadoConVentas() {
    const state = createSeedState();
    state.transactions = [
        { ...{}, ...{} },
    ];
    state.transactions = [
        { date: '2026-10-05T14:00:00.000Z', staffId: 'st1', staffName: 'Valeria Gómez', total: 100, commission: 50, subtotal: 100, tax: 0, method: 'cash' },
        { id: 't2', date: '2026-10-06T09:30:00.000Z', staffId: 'st2', staffName: 'Carlos Mendoza', subtotal: 50, tax: 0, total: 50, commission: 20, method: 'debit' },
        { id: 't3', date: '2026-10-06T15:00:00.000Z', staffId: 'st2', staffName: 'Carlos Mendoza', subtotal: 25, tax: 0, total: 25, commission: 10, method: 'cash' }
    ];
    return state;
}

test('inRange es inclusivo por día y admite extremos vacíos', () => {
    assert.equal(inRange('2026-10-06T12:00:00', '2026-10-06', '2026-10-06'), true);
    assert.equal(inRange('2026-10-06T00:00:00', '2026-10-06', ''), true);
    assert.equal(inRange('2026-10-06T23:59:59', '', '2026-10-06'), true);
    assert.equal(inRange('2026-10-07T00:00:00', '2026-10-01', '2026-10-06'), false);
    assert.equal(inRange('2026-10-01T00:00:00', '2026-10-02', ''), false);
    assert.equal(inRange('no-es-fecha', '', ''), false);
});

test('salesBetween suma monto, impuestos y desglose por método', () => {
    const state = createSeedState();
    state.transactions = [
        { date: '2026-10-06T10:00:00', method: 'cash', subtotal: 100, tax: 16, total: 116 },
        { date: '2026-10-06T11:00:00', method: 'debit', subtotal: 50, tax: 8, total: 58 },
        { date: '2026-10-05T11:00:00', method: 'cash', subtotal: 999, tax: 0, total: 999 }
    ];
    const r = salesBetween('2026-10-06', '2026-10-06', state);
    assert.equal(r.count, 2);
    assert.equal(r.totalUSD, 174);
    assert.equal(r.tax, 24);
    assert.equal(r.byMethod.cash, 116);
    assert.equal(r.byMethod.debit, 58);
    assert.equal(r.byMethod.pago_movil, 0);
});

test('salesBetween reparte las ventas de pago mixto por método', () => {
    const state = createSeedState();
    state.transactions = [{
        date: '2026-10-06T10:00:00',
        method: 'cash',
        subtotal: 100, tax: 0, total: 100,
        payments: [
            { method: 'cash', amountUSD: 40 },
            { method: 'divisa', amountUSD: 60 }
        ]
    }];
    const r = salesBetween('2026-10-06', '2026-10-06', state);
    assert.equal(r.byMethod.cash, 40);
    assert.equal(r.byMethod.divisa, 60);
    assert.equal(r.totalUSD, 100);
});

test('commissionsBetween agrupa por estilista y ordena por comisión', () => {
    const state = createSeedState();
    state.transactions = [
        { date: '2026-10-06T10:00:00', staffId: 'st1', staffName: 'Valeria', total: 100, commission: 50 },
        { date: '2026-10-06T11:00:00', staffId: 'st2', staffName: 'Carlos', total: 100, commission: 70 },
        { date: '2026-10-06T12:00:00', staffId: 'st1', staffName: 'Valeria', total: 50, commission: 25 }
    ];
    const rows = commissionsBetween('2026-10-06', '2026-10-06', state);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].staffName, 'Valeria');
    assert.equal(rows[0].sales, 2);
    assert.equal(rows[0].totalUSD, 150);
    assert.equal(rows[0].commissionUSD, 75);
    assert.equal(rows[1].staffName, 'Carlos');
    assert.equal(rows[1].commissionUSD, 70);
});

test('commissionsBetween sin transacciones devuelve lista vacía', () => {
    const state = createSeedState();
    assert.deepEqual(commissionsBetween('2026-10-06', '2026-10-06', state), []);
});

test('closuresBetween filtra por la fecha de cierre', () => {
    const state = createSeedState();
    state.closures = [
        { id: 'c1', closedAt: '2026-10-06T18:00:00', totalUSD: 10 },
        { id: 'c2', closedAt: '2026-10-04T18:00:00', totalUSD: 20 }
    ];
    const rows = closuresBetween('2026-10-05', '2026-10-06', state);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'c1');
    assert.equal(closuresBetween('', '', state).length, 2, 'sin fechas devuelve todo');
});

test('buildCsv cita campos con coma, comilla o salto de línea', () => {
    const csv = buildCsv([
        ['Nombre', 'Nota'],
        ['Shampoo', 'sin problema'],
        ['Gel "fuerte", 500ml', 'línea1\nlínea2'],
        [null, undefined]
    ]);
    const esperado = [
        'Nombre,Nota',
        'Shampoo,sin problema',
        '"Gel ""fuerte"", 500ml","línea1\nlínea2"',
        ','
    ].join('\r\n');
    assert.equal(csv, esperado);
});