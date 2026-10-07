import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSeedState } from '../js/core/seed.js';
import { addItem } from '../js/domain/ticket.js';
import { openCashSession } from '../js/domain/cash.js';
import { processPayment } from '../js/domain/checkout.js';
import { hasServices, redeemCode, receiptTicketData, ticketSettings } from '../js/domain/receipt.js';

test('ticketSettings: aplica defaults y valida ancho', () => {
    assert.deepEqual(ticketSettings({}), {
        printerWidth: 58,
        businessName: 'Samantha Spa',
        businessLine: 'Sucursal Principal',
        footer: '¡Gracias por su preferencia!',
        showPrices: true
    });

    const cfg = ticketSettings({
        ticket: {
            printerWidth: 80,
            businessName: '  Spa & Estilo  ',
            businessLine: '  Av. Principal  ',
            footer: '  Gracias por visitarnos!  ',
            showPrices: false
        }
    });
    assert.equal(cfg.printerWidth, 80);
    assert.equal(cfg.businessName, 'Spa & Estilo');
    assert.equal(cfg.businessLine, 'Av. Principal');
    assert.equal(cfg.footer, 'Gracias por visitarnos!');
    assert.equal(cfg.showPrices, false);

    assert.equal(ticketSettings({ ticket: { printerWidth: 100 } }).printerWidth, 58);
    assert.equal(ticketSettings({ ticket: 'basura' }).printerWidth, 58);
});

test('redeemCode: determinista y acotado a los 6 últimos caracteres', () => {
assert.equal(redeemCode('TX-Z3V-1'), 'C-TXZ3V1');
assert.equal(redeemCode('TX-A7F9XK-15'), 'C-F9XK15');
assert.equal(redeemCode('TX-TXZ-5'), 'C-TXTXZ5');
assert.equal(redeemCode('TX-'), 'C----TX');
assert.equal(redeemCode(null), 'C-------');
});

test('hasServices detecta solo servicios', () => {
    const state = createSeedState();
    assert.equal(hasServices(state.transactions[0]), false);

    const tx = {
        id: 'TX-1',
        date: new Date().toISOString(),
        time: '10:00',
        staffName: 'Valeria',
        items: [{ type: 'product', qty: 1 }]
    };
    assert.equal(hasServices(tx), false);

    tx.items.push({ type: 'service', qty: 2 });
    assert.equal(hasServices(tx), true);
});

test('receiptTicketData: solo servicios, agrupados por estilista, con totales', () => {
    const state = createSeedState();
    openCashSession(0, state);
    addItem('service', 's1', state); // Tinte Completo & Broshing $65
    addItem('service', 's3', state); // Corte $25
    addItem('product', 'p3', state); // Producto (no debe salir)

    const tx = processPayment(state);
    const data = receiptTicketData(tx, state.settings);

    assert.ok(data, 'debe generar data para imprimir');
    assert.equal(data.id, tx.id);
    assert.equal(data.code, redeemCode(tx.id));
    assert.equal(data.date, new Date(tx.date).toLocaleDateString('es-ES'));
    assert.equal(data.time, tx.time);
    assert.equal(data.widthMM, 58);
    assert.equal(data.showPrices, true);
    assert.equal(data.business.name, 'Samantha Spa');
    assert.equal(data.groups.length, 1, 'una venta con un estilista → un grupo');

    const grupo = data.groups[0];
    assert.equal(grupo.staffName, 'Valeria Gómez');
    assert.equal(grupo.services.length, 2);
    assert.equal(grupo.services[0].name, 'Tinte Completo & Broshing');
    assert.equal(grupo.services[0].price, 65);
    assert.equal(grupo.services[0].qty, 1);
    assert.equal(grupo.services[0].lineTotal, 65);
    assert.equal(grupo.services[1].name, 'Corte Estilo & Peinado');
    assert.equal(grupo.services[1].price, 25);
    assert.equal(grupo.services[1].lineTotal, 25);
    assert.equal(grupo.subtotal, 90);
    assert.equal(data.totalServices, 90);

    // Productos NO aparecen
    const hasProduct = data.groups.some(g => g.services.some(s => s.name === 'Shampoo Post-Color 250ml'));
    assert.equal(hasProduct, false);
});

test('receiptTicketData: datos antiguos sin name/price → fallback', () => {
    const tx = {
        id: 'TX-VIEJA-5',
        date: '2026-09-01T10:00:00.000Z',
        time: '10:00',
        staffId: 'st1',
        staffName: 'Valeria Gómez',
        items: [
            { type: 'service', qty: 1 },
            { type: 'service', name: null, price: null, qty: 2 }
        ]
    };
    const data = receiptTicketData(tx, {
        ticket: { printerWidth: 80, footer: 'Gracias', showPrices: true }
    });
    assert.ok(data);
    assert.equal(data.widthMM, 80);
    assert.equal(data.groups[0].services[0].name, 'Servicio');
    assert.equal(data.groups[0].services[0].price, null);
    assert.equal(data.groups[0].services[0].lineTotal, null);
    assert.equal(data.groups[0].subtotal, null);
    assert.equal(data.totalServices, null);
});
