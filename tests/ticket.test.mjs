import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSeedState } from '../js/core/seed.js';
import {
    addItem, changeQty, clearTicket, setTicketStaff, setPaymentMethod, ticketTotals
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

test('setPaymentMethod: solo efectivo, tarjeta u otro; vaciar vuelve a efectivo', () => {
    const state = createSeedState();
    setPaymentMethod('card', state);
    assert.equal(state.currentTicket.paymentMethod, 'card');
    setPaymentMethod('other', state);
    assert.equal(state.currentTicket.paymentMethod, 'other');
    assert.throws(() => setPaymentMethod('bitcoin', state), /no válido/);

    clearTicket(state);
    assert.equal(state.currentTicket.paymentMethod, 'cash', 'un ticket nuevo cobra en efectivo');
});

test('ticketTotals: subtotal + IVA 16% + total', () => {
    const state = createSeedState();
    addItem('service', 's1', state); // $65.00

    const totals = ticketTotals(state);
    assert.equal(totals.subtotal, 65);
    assert.equal(totals.tax, 10.4);
    assert.equal(totals.total, 75.4);
});

test('ticketTotals: la comisión usa la tasa del estilista seleccionado', () => {
    const state = createSeedState();
    addItem('service', 's1', state); // $65.00

    // Valeria (st1) = 50%
    assert.equal(ticketTotals(state).commission, 32.5);

    // Sofia (st3) = 40% → la comisión cambia aunque el servicio sea el mismo
    setTicketStaff('st3', state);
    assert.equal(ticketTotals(state).commission, 26);
});

test('ticketTotals: el retail no genera comisión', () => {
    const state = createSeedState();
    addItem('product', 'p3', state); // $18.00 retail

    const totals = ticketTotals(state);
    assert.equal(totals.subtotal, 18);
    assert.equal(totals.commission, 0);
});
