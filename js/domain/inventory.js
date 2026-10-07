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

/** Valida campos compartidos entre alta y edición; devuelve los limpios. */
function validate(data) {
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

    return { name, type: data.type, unit: data.unit, stock, minStock, cost, price };
}

/**
 * Alta de producto/insumo. Lanza Error con mensaje en español si algo no
 * cuadra; el llamador lo convierte en toast.
 */
export function addProduct(data, state = getState()) {
    const p = validate(data);
    const product = {
        id: uid(),
        name: p.name,
        type: p.type,
        unit: p.unit,
        stock: p.stock,
        minStock: p.minStock,
        cost: p.cost,
        price: p.type === 'retail' ? p.price : 0
    };
    state.products.push(product);
    return product;
}

/** Edición de los campos de un producto/insumo (el stock se mueve con
 *  actualizar stock / reponer, no aquí). */
export function updateProduct(id, data, state = getState()) {
    const product = findProduct(id, state);
    if (!product) throw new Error('Producto no encontrado.');

    const p = validate(data);
    product.name = p.name;
    product.type = p.type;
    product.unit = p.unit;
    product.stock = p.stock;
    product.minStock = p.minStock;
    product.cost = p.cost;
    product.price = p.type === 'retail' ? p.price : 0;
    return product;
}

/** Servicios (o insumos de su receta) que referencian un producto. */
export function usagesOfProduct(productId, state = getState()) {
    return state.services
        .filter(s => s.recipe.some(r => r.productId === productId))
        .map(s => s.name);
}

/**
 * Elimina un producto salvo que alguna receta lo consuma (ahí se bloquea:
 * borrarlo a ciegas rompería la fórmula de un servicio).
 */
export function deleteProduct(id, state = getState()) {
    const product = findProduct(id, state);
    if (!product) throw new Error('Producto no encontrado.');

    const usages = usagesOfProduct(id, state);
    if (usages.length > 0) {
        throw new Error(`No se puede borrar "${product.name}": lo consumen ${usages.join(', ')}.`);
    }

    state.products = state.products.filter(p => p.id !== id);
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
