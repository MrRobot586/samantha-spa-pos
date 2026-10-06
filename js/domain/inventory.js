/* Inventario híbrido: productos de venta retail + insumos de uso interno (BOM).
 * Incluye altas y reposición con validación (los prompts originales acepatan
 * cantidades negativas — bug #9).
 */

import { getState } from '../core/state.js';
import { uid } from '../core/utils.js';

export function findProduct(id, state = getState()) {
    return state.products.find(p => p.id === id) ?? null;
}

/** Productos en o por debajo de su stock mínimo. */
export function lowStockProducts(state = getState()) {
    return state.products.filter(p => p.stock <= p.minStock);
}

const isValidType = t => t === 'retail' || t === 'internal';
const isValidUnit = u => ['Unidades', 'Gramos', 'Mililitros'].includes(u);

/**
 * Alta de producto/insumo. Lanza Error con mensaje en español si algo no
 * cuadra; el llamador lo convierte en toast.
 */
export function addProduct(data, state = getState()) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) throw new Error('El nombre del producto no puede estar vacío.');
    if (!isValidType(data.type)) throw new Error('Tipo de inventario no válido.');
    if (!isValidUnit(data.unit)) throw new Error('Unidad de medida no válida.');

    const stock = Number(data.stock);
    const minStock = Number(data.minStock);
    const cost = Number(data.cost);
    const price = Number(data.price ?? 0);

    if (!Number.isFinite(stock) || stock < 0) throw new Error('El stock inicial debe ser un número mayor o igual a 0.');
    if (!Number.isFinite(minStock) || minStock < 0) throw new Error('El stock mínimo debe ser un número mayor o igual a 0.');
    if (!Number.isFinite(cost) || cost < 0) throw new Error('El costo debe ser un número mayor o igual a 0.');
    if (!Number.isFinite(price) || price < 0) throw new Error('El precio de venta debe ser un número mayor o igual a 0.');
    if (data.type === 'retail' && price === 0) throw new Error('Un producto de venta retail necesita precio.');

    const product = {
        id: uid(),
        name,
        type: data.type,
        unit: data.unit,
        stock,
        minStock,
        cost,
        price: data.type === 'retail' ? price : 0
    };
    state.products.push(product);
    return product;
}

/** Suma stock a un producto. La cantidad debe ser un número > 0. */
export function restock(id, amount, state = getState()) {
    const product = findProduct(id, state);
    if (!product) throw new Error('Producto no encontrado.');

    const qty = Number(amount);
    if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error('La cantidad a reponer debe ser un número mayor que 0.');
    }
    product.stock += qty;
    return product;
}
