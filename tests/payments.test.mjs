import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PAYMENT_METHODS, PAYMENT_IDS, CASH_DRAWER_METHODS,
    methodById, methodLabel, isPaymentMethod, isCashDrawerMethod,
    normalizePayments, paymentsOf, primaryMethod, settlePayments, PaymentError,
    activePaymentMethods, cashDrawerMethods
} from '../js/domain/payments.js';

test('catálogo: cuatro métodos, efectivo y divisa en el cajón', () => {
    assert.deepEqual(PAYMENT_IDS, ['cash', 'debit', 'pago_movil', 'divisa']);
    assert.deepEqual(CASH_DRAWER_METHODS, ['cash', 'divisa']);
    assert.equal(methodById('pago_movil').label, 'Pago Móvil');
    assert.equal(isPaymentMethod('divisa'), true);
    assert.equal(isPaymentMethod('card'), false);
    assert.equal(isCashDrawerMethod('debit'), false);
    assert.equal(isCashDrawerMethod('divisa'), true);
});

test('methodLabel: conoce los métodos actuales y los históricos', () => {
    assert.equal(methodLabel('cash'), 'Efectivo');
    assert.equal(methodLabel('card'), 'Tarjeta (histórico)');
    assert.equal(methodLabel('other'), 'Otro (histórico)');
    assert.equal(methodLabel('desconocido'), 'Método desconocido');
    assert.equal(PAYMENT_METHODS.length, 4);
});

test('normalizePayments: limpia, redondea y descarta lo inválido', () => {
    const pagos = normalizePayments([
        { method: 'cash', amountUSD: 10.456 },
        { method: 'card', amountUSD: 5 },
        { method: 'nope', amountUSD: 99 },
        { method: 'debit', amountUSD: 0 },
        { method: 'divisa', amountUSD: 'x' },
        null
    ]);
    assert.deepEqual(pagos, [
        { method: 'cash', amountUSD: 10.46 },
        { method: 'card', amountUSD: 5 }
    ]);
    assert.deepEqual(normalizePayments('no-array'), []);
});

test('paymentsOf: usa el detalle o sintetiza del método y total', () => {
    assert.deepEqual(
        paymentsOf({ payments: [{ method: 'cash', amountUSD: 5 }], method: 'cash', total: 5 }),
        [{ method: 'cash', amountUSD: 5 }]
    );
    assert.deepEqual(
        paymentsOf({ method: 'card', total: 30 }),
        [{ method: 'card', amountUSD: 30 }],
        'venta vieja sin payments → un pago por su método'
    );
    assert.deepEqual(paymentsOf({}), [{ method: 'cash', amountUSD: 0 }]);
});

test('primaryMethod: devuelve el de mayor monto', () => {
    assert.equal(primaryMethod([{ method: 'cash', amountUSD: 5 }, { method: 'debit', amountUSD: 20 }]), 'debit');
    assert.equal(primaryMethod([]), 'cash', 'sin pagos → efectivo por defecto');
});

test('settlePayments: pago exacto sin vuelto', () => {
    const s = settlePayments([{ method: 'debit', amountUSD: 75.4 }], 75.4);
    assert.equal(s.paidUSD, 75.4);
    assert.equal(s.changeUSD, 0);
    assert.deepEqual(s.payments, [{ method: 'debit', amountUSD: 75.4 }]);
});

test('settlePayments: el vuelto sale del efectivo y luego de la divisa', () => {
    const s = settlePayments([
        { method: 'cash', amountUSD: 10 },
        { method: 'divisa', amountUSD: 70 }
    ], 75);
    assert.equal(s.paidUSD, 80);
    assert.equal(s.changeUSD, 5);
    // El efectivo solo tenía 10: aporta 5 al vuelto y quedan 5; la divisa
    // entrega 70 y conserva 70.
    assert.deepEqual(s.payments, [
        { method: 'cash', amountUSD: 5 },
        { method: 'divisa', amountUSD: 70 }
    ]);
});

test('settlePayments: el vuelto puede consumir todo un método', () => {
    const s = settlePayments([
        { method: 'cash', amountUSD: 3 },
        { method: 'divisa', amountUSD: 100 }
    ], 100);
    assert.equal(s.changeUSD, 3);
    assert.deepEqual(s.payments, [{ method: 'divisa', amountUSD: 100 }], 'el efectivo quedó en 0 y se omite');
});

test('settlePayments: errores de faltante y de exceso electrónico', () => {
    assert.throws(() => settlePayments([], 10), PaymentError);
    assert.throws(() => settlePayments([{ method: 'cash', amountUSD: 5 }], 10), /Faltan/);
    assert.throws(
        () => settlePayments([{ method: 'pago_movil', amountUSD: 20 }], 10),
        /no pueden superar el total/
    );
});

test('settlePayments: el efectivo puede exceder el total (da vuelto)', () => {
    const s = settlePayments([{ method: 'cash', amountUSD: 100 }], 75.4);
    assert.equal(s.changeUSD, 24.6);
    assert.deepEqual(s.payments, [{ method: 'cash', amountUSD: 75.4 }]);
});

test('activePaymentMethods: lee settings, garantiza cash y descarta basura', () => {
    // Un método custom electrónico: cash sigue presente como respaldo.
    const methods = activePaymentMethods({
        settings: { paymentMethods: [{ id: 'zelle', label: 'Zelle', type: 'electronico' }] }
    });
    assert.deepEqual(methods.map(m => m.id), ['cash', 'zelle']);
    assert.equal(methods.find(m => m.id === 'zelle').type, 'electronico');
    assert.equal(methods.find(m => m.id === 'zelle').icon, 'fa-credit-card');

    // Sin settings no-array → los de fábrica.
    assert.deepEqual(activePaymentMethods({ settings: {} }), PAYMENT_METHODS);

    // Duplicados y sin etiqueta se descartan.
    const dedup = activePaymentMethods({
        settings: { paymentMethods: [
            { id: 'cash', label: 'Efectivo', type: 'fisico' },
            { id: 'cash', label: 'Efectivo de nuevo', type: 'fisico' },
            { id: 'x', label: '', type: 'fisico' }
        ] }
    });
    assert.deepEqual(dedup.map(m => m.id), ['cash']);
});

test('métodos custom: aplican en etiquetas, vuelto y arqueo', () => {
    const methods = [
        { id: 'cash', label: 'Efectivo', icon: 'fa-money-bill-wave', type: 'fisico' },
        { id: 'efecty', label: 'Efecty', icon: 'fa-money-bill', type: 'fisico' },
        { id: 'zelle', label: 'Zelle', icon: 'fa-mobile-screen', type: 'electronico' }
    ];

    assert.equal(methodById('zelle', methods).label, 'Zelle');
    assert.equal(methodLabel('efecty', methods), 'Efecty');
    assert.equal(isPaymentMethod('zelle', methods), true);
    assert.equal(isCashDrawerMethod('efecty', methods), true, 'físico custom entra al arqueo');
    assert.equal(isCashDrawerMethod('zelle', methods), false);
    assert.deepEqual(cashDrawerMethods(methods), ['cash', 'efecty']);
    assert.deepEqual(normalizePayments([{ method: 'zelle', amountUSD: 12.345 }], methods),
        [{ method: 'zelle', amountUSD: 12.35 }]);

    // Físico custom da vuelto; electrónico custom no puede exceder el total.
    const conVuelto = settlePayments([{ method: 'efecty', amountUSD: 100 }], 75, methods);
    assert.equal(conVuelto.changeUSD, 25);
    assert.deepEqual(conVuelto.payments, [{ method: 'efecty', amountUSD: 75 }]);
    assert.throws(() => settlePayments([{ method: 'zelle', amountUSD: 20 }], 10, methods),
        /no pueden superar el total/);
});