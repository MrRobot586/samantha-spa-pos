import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSeedState } from '../js/core/seed.js';
import { addItem, ticketTotals } from '../js/domain/ticket.js';
import { processPayment, CheckoutError } from '../js/domain/checkout.js';
import { openCashSession } from '../js/domain/cash.js';

test('cobro exitoso: descuenta productos y recetas, paga comisión y registra la transacción', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state); // receta: 60g p1 + 90ml p2, $65
    addItem('product', 'p3', state); // venta $18, stock 12

    const tx = processPayment(state);

    // Inventario
    assert.equal(state.products.find(p => p.id === 'p3').stock, 11);
    assert.equal(state.products.find(p => p.id === 'p1').stock, 440);
    assert.equal(state.products.find(p => p.id === 'p2').stock, 1410);

    // Comisión al estilista del ticket (st1 = 50% de 65 = 32.50; el producto no suma)
    const valeria = state.staff.find(s => s.id === 'st1');
    assert.equal(valeria.totalCommissions, 32.5);
    assert.equal(valeria.salesCount, 1);

    // Transacción: total = (65 + 18) × 1.16
    assert.equal(tx.subtotal, 83);
    assert.equal(tx.total, 96.28);
    assert.equal(tx.commission, 32.5);
    assert.deepEqual(tx.items, [
        { type: 'service', id: 's1', name: 'Tinte Completo & Broshing', price: 65, qty: 1, staffId: 'st1', staffName: 'Valeria Gómez' },
        { type: 'product', id: 'p3', name: 'Shampoo Post-Color 250ml', price: 18, qty: 1, staffId: 'st1', staffName: 'Valeria Gómez' }
    ]);
    assert.ok(tx.id.startsWith('TX-'));
    assert.ok(state.transactions.includes(tx));

    // Ticket limpio para la siguiente venta
    assert.equal(state.currentTicket.items.length, 0);
});

test('stock de un producto de venta insuficiente: lanza CheckoutError y NO muta el estado', () => {
    const state = createSeedState();
    openCashSession(0, state);
    const producto = state.products.find(p => p.id === 'p3');
    producto.stock = 0;

    addItem('product', 'p3', state);
    const antes = JSON.stringify(state);

    assert.throws(() => processPayment(state), CheckoutError);
    assert.throws(() => processPayment(state), /Stock insuficiente/);
    assert.equal(JSON.stringify(state), antes, 'el estado no debe cambiar si el cobro falla');
});

test('insumo de receta insuficiente: el cobro se bloquea antes de tocar nada', () => {
    const state = createSeedState();
    openCashSession(0, state);
    state.products.find(p => p.id === 'p1').stock = 10; // la receta pide 60

    addItem('service', 's1', state);
    const antes = JSON.stringify(state);

    assert.throws(() => processPayment(state), err => {
        assert.ok(err instanceof CheckoutError);
        assert.match(err.message, /Tinte Rubio Ceniza/);
        assert.match(err.message, /faltan/);
        return true;
    });
    assert.equal(JSON.stringify(state), antes);
});

test('ticket vacío: CheckoutError con mensaje claro', () => {
    const state = createSeedState();
    openCashSession(0, state);
    assert.throws(() => processPayment(state), CheckoutError);
    assert.throws(() => processPayment(state), /al menos un ítem/);
});

test('varias unidades consumen insumos multiplicados', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state);
    addItem('service', 's1', state); // qty 2 → 120g de tinte y 180ml de peróxido

    processPayment(state);
    assert.equal(state.products.find(p => p.id === 'p1').stock, 380);
    assert.equal(state.products.find(p => p.id === 'p2').stock, 1320);
});

test('efectivo: recibido mayor al total guarda el vuelto', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state); // total = 65 × 1.16 = 75.40

    const tx = processPayment(state, { payments: [{ method: 'cash', amountUSD: 100 }] });

    assert.equal(tx.method, 'cash');
    assert.equal(tx.receivedUSD, 100);
    assert.ok(Math.abs(tx.changeUSD - (100 - tx.total)) < 1e-9, 'vuelto = recibido − total');
    assert.deepEqual(tx.payments, [{ method: 'cash', amountUSD: tx.total }], 'solo queda el neto en caja');
    assert.deepEqual(state.currentTicket.payments, [], 'el siguiente ticket no arrastra pagos');
});

test('efectivo: recibido menor al total → CheckoutError y el estado no cambia', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state);
    const antes = JSON.stringify(state);

    assert.throws(() => processPayment(state, { payments: [{ method: 'cash', amountUSD: 10 }] }), CheckoutError);
    assert.throws(() => processPayment(state, { payments: [{ method: 'cash', amountUSD: 10 }] }), /Faltan/);
    assert.equal(JSON.stringify(state), antes, 'nada de stock ni comisión si no alcanza el efectivo');
});

test('débito: pago exacto, vuelto 0 y método guardado en la venta', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state);
    const { total } = ticketTotals(state);

    const tx = processPayment(state, { payments: [{ method: 'debit', amountUSD: total }] });

    assert.equal(tx.method, 'debit');
    assert.equal(tx.receivedUSD, total, 'el electrónico se considera pagado al total');
    assert.equal(tx.changeUSD, 0);
});

test('débito por encima del total → CheckoutError (no hay vuelto electrónico)', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state);
    const { total } = ticketTotals(state);
    const antes = JSON.stringify(state);

    assert.throws(
        () => processPayment(state, { payments: [{ method: 'debit', amountUSD: total + 5 }] }),
        /no pueden superar el total/
    );
    assert.equal(JSON.stringify(state), antes);
});

test('pago mixto: efectivo + débito + divisa cubren el total', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state); // total 75.40
    const { total } = ticketTotals(state);

    const tx = processPayment(state, {
        payments: [
            { method: 'cash', amountUSD: 30 },
            { method: 'debit', amountUSD: 20 },
            { method: 'divisa', amountUSD: 30 }
        ]
    });

    assert.equal(tx.receivedUSD, 80);
    assert.ok(Math.abs(tx.changeUSD - (80 - total)) < 1e-9);
    // El vuelto sale primero del efectivo y luego de la divisa.
    const cash = tx.payments.find(p => p.method === 'cash');
    const divisa = tx.payments.find(p => p.method === 'divisa');
    assert.ok(cash.amountUSD < 30, 'el efectivo absorbe parte del vuelto');
    assert.ok(divisa.amountUSD <= 30);
    assert.equal(tx.method, 'divisa', 'la divisa quedó como método dominante');
    assert.ok(Math.abs(tx.payments.reduce((a, p) => a + p.amountUSD, 0) - total) < 1e-9);
});

test('pago exacto: total cubierto, vuelto 0', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state);
    const { total } = ticketTotals(state);

    const tx = processPayment(state, { payments: [{ method: 'cash', amountUSD: total }] });

    assert.equal(tx.receivedUSD, total);
    assert.equal(tx.changeUSD, 0);
});

test('sin pagos: se cobra el total exacto en efectivo (compatibilidad)', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state);
    const { total } = ticketTotals(state);

    const tx = processPayment(state);

    assert.equal(tx.method, 'cash');
    assert.equal(tx.receivedUSD, total);
    assert.equal(tx.changeUSD, 0);
});

test('caja cerrada: el cobro se bloquea antes de tocar nada', () => {
    const state = createSeedState(); // semilla: caja cerrada
    addItem('service', 's1', state);
    const antes = JSON.stringify(state);

    assert.throws(() => processPayment(state), CheckoutError);
    assert.throws(() => processPayment(state), /caja está cerrada/);
    assert.equal(JSON.stringify(state), antes, 'sin caja abierta no se descuenta stock ni comisión');
});
