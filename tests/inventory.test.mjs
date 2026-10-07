import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSeedState } from '../js/core/seed.js';
import { addProduct, updateProduct, deleteProduct, usagesOfProduct, restock, lowStockProducts, findProduct } from '../js/domain/inventory.js';

const nuevoProducto = (extra = {}) => ({
    name: 'Gel Fijador 500ml',
    type: 'sale',
    unit: 'Unidades',
    stock: 10,
    minStock: 3,
    cost: 7,
    price: 15,
    ...extra
});

test('addProduct agrega con id único y forma correcta', () => {
    const state = createSeedState();
    const prod = addProduct(nuevoProducto(), state);

    assert.ok(prod.id);
    assert.ok(state.products.some(p => p.id === prod.id));

    const otro = addProduct(nuevoProducto({ name: 'Otro' }), state);
    assert.notEqual(prod.id, otro.id);
});

test('addProduct valida nombre, stock, costos y precio de venta', () => {
    const state = createSeedState();

    assert.throws(() => addProduct(nuevoProducto({ name: '   ' }), state), /nombre/);
    assert.throws(() => addProduct(nuevoProducto({ stock: -5 }), state), /stock inicial/);
    assert.throws(() => addProduct(nuevoProducto({ minStock: -1 }), state), /stock mínimo/);
    assert.throws(() => addProduct(nuevoProducto({ cost: 'x' }), state), /costo/);
    assert.throws(() => addProduct(nuevoProducto({ price: -2 }), state), /precio/);
    assert.throws(() => addProduct(nuevoProducto({ price: 0 }), state), /precio/);
    assert.throws(() => addProduct(nuevoProducto({ type: 'otro' }), state), /Tipo/);
    assert.throws(() => addProduct(nuevoProducto({ unit: 'Cajas' }), state), /Unidad/);

    // Un insumo interno no necesita precio de venta
    const interno = addProduct(nuevoProducto({ type: 'internal', price: 0 }), state);
    assert.equal(interno.price, 0);
});

test('restock suma cantidades válidas', () => {
    const state = createSeedState();
    const p3 = findProduct('p3', state); // stock 12

    restock('p3', 8, state);
    assert.equal(p3.stock, 20);

    restock('p3', 0.5, state);
    assert.equal(p3.stock, 20.5);
});

test('restock rechaza cantidades inválidas (el prompt original aceptaba negativos)', () => {
    const state = createSeedState();
    const antes = findProduct('p3', state).stock;

    assert.throws(() => restock('p3', 0, state), /mayor que 0/);
    assert.throws(() => restock('p3', -20, state), /mayor que 0/);
    assert.throws(() => restock('p3', 'cien', state), /mayor que 0/);
    assert.throws(() => restock('no-existe', 5, state), /no encontrado/);

    assert.equal(findProduct('p3', state).stock, antes);
});

test('lowStockProducts detecta los insumos bajo mínimo', () => {
    const state = createSeedState();
    const bajas = lowStockProducts(state).map(p => p.id).sort();

    // Semilla: p4 (3 ≤ 5) y p5 (80 ≤ 150)
    assert.deepEqual(bajas, ['p4', 'p5']);
});

test('updateProduct conserva el id y aplica los campos nuevos', () => {
    const state = createSeedState();
    const actualizado = updateProduct('p3', {
        name: 'Shampoo Reparador 300ml', type: 'sale', unit: 'Unidades',
        stock: 20, minStock: 5, cost: 9, price: 21
    }, state);

    assert.equal(actualizado.id, 'p3');
    assert.equal(actualizado.name, 'Shampoo Reparador 300ml');
    assert.equal(actualizado.stock, 20);
    assert.equal(actualizado.price, 21);
    assert.equal(state.products.filter(p => p.id === 'p3').length, 1, 'no duplica');
});

test('updateProduct: un insumo interno pierde el precio de venta', () => {
    const state = createSeedState();
    const p = updateProduct('p3', {
        name: 'Ahora interno', type: 'internal', unit: 'Gramos',
        stock: 5, minStock: 1, cost: 2, price: 30
    }, state);
    assert.equal(p.price, 0);
});

test('updateProduct valida y exige que el producto exista', () => {
    const state = createSeedState();
    assert.throws(() => updateProduct('no-existe', nuevoProducto(), state), /no encontrado/);
    assert.throws(() => updateProduct('p3', nuevoProducto({ name: '' }), state), /nombre/);
});

test('deleteProduct elimina productos que ninguna receta consume', () => {
    const state = createSeedState();
    const borrado = deleteProduct('p4', state);
    assert.equal(borrado.id, 'p4');
    assert.equal(findProduct('p4', state), null);
    assert.equal(state.products.length, 4);
});

test('deleteProduct bloquea insumos usados por una receta', () => {
    const state = createSeedState();
    assert.deepEqual(usagesOfProduct('p1', state), ['Tinte Completo & Broshing']);
    assert.throws(() => deleteProduct('p1', state), /Tinte Completo & Broshing/);
    assert.ok(findProduct('p1', state), 'el insumo sigue en el inventario');
});

test('deleteProduct exige que el producto exista', () => {
    const state = createSeedState();
    assert.throws(() => deleteProduct('no-existe', state), /no encontrado/);
});
