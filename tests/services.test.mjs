import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addService, updateService, deleteService, findService, resolveRecipe } from '../js/domain/services.js';
import { createSeedState } from '../js/core/seed.js';

test('addService crea el servicio con receta vacía', () => {
    const state = createSeedState();
    const serv = addService({ name: '  Manicure ', price: 20 }, state);

    assert.equal(serv.name, 'Manicure');
    assert.equal(serv.price, 20);
    assert.deepEqual(serv.recipe, []);
    assert.ok(state.services.some(s => s.id === serv.id));
});

test('addService valida nombre y precio', () => {
    const state = createSeedState();
    assert.throws(() => addService({ name: '', price: 10 }, state), /nombre/);
    assert.throws(() => addService({ name: 'X', price: -1 }, state), /precio/);
    assert.throws(() => addService({ name: 'X', price: 'nope' }, state), /precio/);
});

test('updateService cambia nombre y precio sin tocar la receta', () => {
    const state = createSeedState();
    const antes = resolveRecipe(findService('s1', state), state).length;
    const serv = updateService('s1', { name: 'Tinte & Peinado Premium', price: 80 }, state);

    assert.equal(serv.id, 's1');
    assert.equal(findService('s1', state).name, 'Tinte & Peinado Premium');
    assert.equal(findService('s1', state).price, 80);
    assert.equal(resolveRecipe(serv, state).length, antes, 'la receta no se toca');
});

test('updateService exige que el servicio exista', () => {
    const state = createSeedState();
    assert.throws(() => updateService('no-existe', { name: 'X', price: 1 }, state), /no encontrado/);
});

test('deleteService lo saca del catálogo y del ticket en curso', () => {
    const state = createSeedState();
    state.currentTicket.items = [
        { type: 'service', id: 's3', name: 'Corte', price: 25, qty: 1 },
        { type: 'product', id: 'p3', name: 'Shampoo', price: 18, qty: 1 }
    ];

    const borrado = deleteService('s3', state);
    assert.equal(borrado.id, 's3');
    assert.equal(findService('s3', state), null);
    assert.equal(state.currentTicket.items.length, 1, 'el ítem del servicio se quita del ticket');
    assert.equal(state.currentTicket.items[0].type, 'product');
});

test('deleteService exige que el servicio exista', () => {
    const state = createSeedState();
    assert.throws(() => deleteService('no-existe', state), /no encontrado/);
});