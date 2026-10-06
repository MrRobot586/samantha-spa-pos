import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSeedState } from '../js/core/seed.js';
import { addItem, ticketTotals } from '../js/domain/ticket.js';
import { processPayment, CheckoutError } from '../js/domain/checkout.js';
import { openCashSession } from '../js/domain/cash.js';

test('cobro exitoso: descuenta retail y BOM, paga comisión y registra la transacción', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state); // BOM: 60g p1 + 90ml p2, $65
    addItem('product', 'p3', state); // retail $18, stock 12

    const tx = processPayment(state);

    // Inventario
    assert.equal(state.products.find(p => p.id === 'p3').stock, 11);
    assert.equal(state.products.find(p => p.id === 'p1').stock, 440);
    assert.equal(state.products.find(p => p.id === 'p2').stock, 1410);

    // Comisión al estilista del ticket (st1 = 50% de 65 = 32.50; retail no suma)
    const valeria = state.staff.find(s => s.id === 'st1');
    assert.equal(valeria.totalCommissions, 32.5);
    assert.equal(valeria.salesCount, 1);

    // Transacción: total = (65 + 18) × 1.16
    assert.equal(tx.subtotal, 83);
    assert.equal(tx.total, 96.28);
    assert.equal(tx.commission, 32.5);
    assert.deepEqual(tx.items, [
        { type: 'service', qty: 1 },
        { type: 'product', qty: 1 }
    ]);
    assert.ok(tx.id.startsWith('TX-'));
    assert.ok(state.transactions.includes(tx));

    // Ticket limpio para la siguiente venta
    assert.equal(state.currentTicket.items.length, 0);
});

test('stock retail insuficiente: lanza CheckoutError y NO muta el estado', () => {
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

test('insumo BOM insuficiente: el cobro se bloquea antes de tocar nada', () => {
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

test('varias unidades consumen BOM multiplicado', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state);
    addItem('service', 's1', state); // qty 2 → 120g de tinte y 180ml de peróxido

    processPayment(state);
    assert.equal(state.products.find(p => p.id === 'p1').stock, 380);
    assert.equal(state.products.find(p => p.id === 'p2').stock, 1320);
});

test('efectivo: recibido mayor al total guarda el cambio', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state); // total = 65 × 1.16 = 75.40

    const tx = processPayment(state, { method: 'cash', receivedUSD: 100 });

    assert.equal(tx.method, 'cash');
    assert.equal(tx.receivedUSD, 100);
    assert.ok(Math.abs(tx.changeUSD - (100 - tx.total)) < 1e-9, 'cambio = recibido − total');
    assert.equal(state.currentTicket.paymentMethod, 'cash', 'el siguiente ticket vuelve a efectivo');
});

test('efectivo: recibido menor al total → CheckoutError y el estado no cambia', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state);
    const antes = JSON.stringify(state);

    assert.throws(() => processPayment(state, { method: 'cash', receivedUSD: 10 }), CheckoutError);
    assert.throws(() => processPayment(state, { method: 'cash', receivedUSD: 10 }), /recibido es menor/);
    assert.equal(JSON.stringify(state), antes, 'nada de stock ni comisión si no alcanza el efectivo');
});

test('tarjeta: sin recibido, cambio 0 y método guardado en la venta', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state);
    state.currentTicket.paymentMethod = 'card';

    const tx = processPayment(state, { method: 'card' });

    assert.equal(tx.method, 'card');
    assert.equal(tx.receivedUSD, tx.total, 'tarjeta se considera pagado al total');
    assert.equal(tx.changeUSD, 0);
});

test('pago exacto: recibido = total → cambio 0', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state);
    const { total } = ticketTotals(state);

    const tx = processPayment(state, { method: 'cash', receivedUSD: total });

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
