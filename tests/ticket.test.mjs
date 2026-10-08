import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSeedState } from '../js/core/seed.js';
import {
    addItem, changeQty, clearTicket, setTicketStaff, setPaymentAmount, ticketTotals
} from '../js/domain/ticket.js';

test('addItem agrega un servicio con qty 1 y acumula los clics siguientes', () => {
    const state = createSeedState();

    addItem('service', 's1', state);
    assert.equal(state.currentTicket.items.length, 1);
    assert.equal(state.currentTicket.items[0].qty, 1);

    addItem('service', 's1', state);
    assert.equal(state.currentTicket.items.length, 1);
    assert.equal(state.currentTicket.items[0].qty, 2);
});

test('addItem rechaza insumos de uso interno y ids inexistentes', () => {
    const state = createSeedState();

    assert.throws(() => addItem('product', 'p1', state), /uso interno/);
    assert.throws(() => addItem('service', 'no-existe', state), /catálogo/);
    assert.throws(() => addItem('otra-cosa', 's1', state), /no válido/);
    assert.equal(state.currentTicket.items.length, 0);
});

test('changeQty incrementa, decrementa y elimina al bajar de 1', () => {
    const state = createSeedState();
    addItem('product', 'p3', state);

    changeQty(0, 1, state);
    assert.equal(state.currentTicket.items[0].qty, 2);

    changeQty(0, -1, state);
    assert.equal(state.currentTicket.items[0].qty, 1);

    changeQty(0, -1, state);
    assert.equal(state.currentTicket.items.length, 0);

    // índice fuera de rango: no debe explotar
    assert.doesNotThrow(() => changeQty(5, -1, state));
});

test('clearTicket vacía la orden', () => {
    const state = createSeedState();
    addItem('service', 's1', state);
    addItem('product', 'p3', state);
    clearTicket(state);
    assert.equal(state.currentTicket.items.length, 0);
});

test('setTicketStaff solo acepta estilistas existentes', () => {
    const state = createSeedState();
    setTicketStaff('st3', state);
    assert.equal(state.currentTicket.staffId, 'st3');
    assert.throws(() => setTicketStaff('st99', state), /no válido/);
});

test('setPaymentAmount acumula pagos por método y limpia al bajar a 0', () => {
    const state = createSeedState();
    setPaymentAmount('cash', 10, state);
    setPaymentAmount('divisa', 5.5, state);
    assert.deepEqual(state.currentTicket.payments, [
        { method: 'cash', amountUSD: 10 },
        { method: 'divisa', amountUSD: 5.5 }
    ]);

    // Volver a fijar el mismo método reemplaza el monto, no lo duplica.
    setPaymentAmount('cash', 3, state);
    assert.deepEqual(state.currentTicket.payments, [
        { method: 'cash', amountUSD: 3 },
        { method: 'divisa', amountUSD: 5.5 }
    ]);

    // 0 elimina el pago del método.
    setPaymentAmount('cash', 0, state);
    assert.deepEqual(state.currentTicket.payments, [{ method: 'divisa', amountUSD: 5.5 }]);

    assert.throws(() => setPaymentAmount('bitcoin', 1, state), /no válido/);
    assert.throws(() => setPaymentAmount('cash', -1, state), /monto del pago no es válido/);

    clearTicket(state);
    assert.deepEqual(state.currentTicket.payments, [], 'un ticket nuevo no arrastra pagos');
});

test('ticketTotals: subtotal + IVA 16% + total', () => {
    const state = createSeedState();
    addItem('service', 's1', state); // $65.00

    const totals = ticketTotals(state);
    assert.equal(totals.subtotal, 65);
    assert.equal(totals.tax, 10.4);
    assert.equal(totals.total, 75.4);
});

test('ticketTotals: la comisión usa la tasa global del rol (settings)', () => {
    const state = createSeedState();
    addItem('service', 's1', state); // $65.00

    // Default de fábrica: 45% de 65 = 29.25
    assert.equal(ticketTotals(state).commission, 29.25);

    // El admin sube la tasa del rol → la comisión cambia para todos
    state.settings.stylistCommissionRate = 50;
    assert.equal(ticketTotals(state).commission, 32.5);

    // Cambiar de estilista ya NO cambia la tasa: es del rol
    setTicketStaff('st3', state);
    assert.equal(ticketTotals(state).commission, 32.5);

    // Sin estilista seleccionado no se acredita comisión a nadie
    state.currentTicket.staffId = '';
    assert.equal(ticketTotals(state).commission, 0);
});

test('ticketTotals: el producto de venta no genera comisión', () => {
    const state = createSeedState();
    addItem('product', 'p3', state); // $18.00 de venta

    const totals = ticketTotals(state);
    assert.equal(totals.subtotal, 18);
    assert.equal(totals.commission, 0);
});
