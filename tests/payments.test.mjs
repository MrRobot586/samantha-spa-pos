import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PAYMENT_METHODS, PAYMENT_IDS, CASH_DRAWER_METHODS,
    methodById, methodLabel, isPaymentMethod, isCashDrawerMethod,
    normalizePayments, paymentsOf, primaryMethod, settlePayments, PaymentError,
    activePaymentMethods, cashDrawerMethods, missingReferenceMethods
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
test('normalizePayments: conserva referencia y comprobante válidos, descarta los malformados', () => {
    const adjunto = { name: 'transferencia.png', mime: 'image/png', data: 'data:image/png;base64,QUJD' };
    const pagos = normalizePayments([
        { method: 'pago_movil', amountUSD: 10.5, reference: '  00123456789  ', attachment: adjunto },
        { method: 'cash', amountUSD: 3, reference: '   ', attachment: { name: 'x.png', data: 'no-es-data-url' } },
        { method: 'debit', amountUSD: 7, reference: 42, attachment: 'nope' },
        { method: 'divisa', amountUSD: 2, reference: 'x'.repeat(80) }
    ]);

    assert.deepEqual(pagos[0], { method: 'pago_movil', amountUSD: 10.5, reference: '00123456789', attachment: adjunto },
        'referencia se recorta y el adjunto se conserva tal cual');
    assert.deepEqual(pagos[1], { method: 'cash', amountUSD: 3 }, 'referencia vacía y adjunto sin data URL se descartan');
    assert.deepEqual(pagos[2], { method: 'debit', amountUSD: 7 }, 'tipos no string no rompen el pago');
    assert.equal(pagos[3].reference.length, 60, 'referencia larga se trunca a MAX_REFERENCE');
    assert.equal(pagos[3].attachment, undefined);
});

test('settlePayments: el vuelto ajusta el monto sin borrar la referencia ni el comprobante', () => {
    const adjunto = { name: 'recibo.pdf', mime: 'application/pdf', data: 'data:application/pdf;base64,QUJD' };
    const s = settlePayments([
        { method: 'cash', amountUSD: 150, reference: 'REF-1', attachment: adjunto },
        { method: 'debit', amountUSD: 10 }
    ], 120);

    assert.equal(s.changeUSD, 40);
    assert.equal(s.payments[0].method, 'cash');
    assert.equal(s.payments[0].amountUSD, 110, 'el vuelto descuenta del efectivo');
    assert.equal(s.payments[0].reference, 'REF-1');
    assert.deepEqual(s.payments[0].attachment, adjunto);

    assert.throws(() => settlePayments(
        [{ method: 'cash', amountUSD: 5, reference: 'REF-2' }], 100), /Faltan/,
        'un pago corto sigue fallando aunque lleve referencia');
});

test('activePaymentMethods conserva requiresReference (defecto: opcional)', () => {
    const methods = activePaymentMethods({
        settings: { paymentMethods: [
            { id: 'zelle', label: 'Zelle', type: 'electronico', requiresReference: true },
            { id: 'efecty', label: 'Efecty', type: 'fisico' }
        ] }
    });
    assert.equal(methods.find(m => m.id === 'zelle').requiresReference, true);
    assert.equal(methods.find(m => m.id === 'efecty').requiresReference, false);
    assert.equal(methods.find(m => m.id === 'cash').requiresReference, false, 'los de fábrica arrancan opcionales');
    assert.equal(activePaymentMethods({ settings: {} })[0].requiresReference, false);
});

test('catalogo: los cuatro métodos de fábrica son de referencia opcional', () => {
    assert.equal(PAYMENT_METHODS.every(m => m.requiresReference === false), true);
});

test('missingReferenceMethods: solo cuentan los necesarios con monto y sin ref ni adjunto', () => {
    const methods = [
        { id: 'cash', label: 'Efectivo', type: 'fisico', requiresReference: false },
        { id: 'pago_movil', label: 'Pago Móvil', type: 'electronico', requiresReference: true },
        { id: 'debit', label: 'Débito', type: 'electronico', requiresReference: true }
    ];

    // Sin número ni comprobante: aparecen las etiquetas de los necesarios.
    assert.deepEqual(
        missingReferenceMethods([
            { method: 'cash', amountUSD: 10 },
            { method: 'pago_movil', amountUSD: 40 },
            { method: 'debit', amountUSD: 20 }
        ], methods),
        ['Pago Móvil', 'Débito']);

    // Cumple con referencia sola, con adjunto, o con ambas cosas.
    const adjunto = { name: 'foto.png', data: 'data:image/png;base64,QUJD' };
    assert.deepEqual(
        missingReferenceMethods([
            { method: 'pago_movil', amountUSD: 40, reference: '001234567890' },
            { method: 'debit', amountUSD: 20, attachment: adjunto }
        ], methods),
        []);

    // Monto 0, método desconocido y opcional no se bloquean.
    assert.deepEqual(
        missingReferenceMethods([
            { method: 'pago_movil', amountUSD: 0 },
            { method: 'cash', amountUSD: 75.4 },
            { method: 'zzz', amountUSD: 100 }
        ], methods),
        []);
});
