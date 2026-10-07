/* Catálogo de servicios y sus recetas.
 *
 * Nota: los servicios ya no llevan commissionPercent (decisión del refactor:
 * la comisión la define la tasa del estilista que atiende la venta).
 * La receta se conserva en el modelo —es el corazón del inventario híbrido—
 * aunque la UI actual solo permite leerla; editarla queda fuera del alcance.
 */

import { getState } from '../core/state.js';
import { uid } from '../core/utils.js';

export function findService(id, state = getState()) {
    return state.services.find(s => s.id === id) ?? null;
}

/** Receta de un servicio, resolviendo cada insumo contra el inventario. */
export function resolveRecipe(service, state = getState()) {
    return service.recipe
        .map(r => {
            const product = state.products.find(p => p.id === r.productId);
            return product ? { product, amount: r.amount } : null;
        })
        .filter(Boolean);
}

function validate(data) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) throw new Error('El nombre del servicio no puede estar vacío.');

    const price = Number(data.price);
    if (!Number.isFinite(price) || price < 0) {
        throw new Error('El precio debe ser un número mayor o igual a 0.');
    }
    return { name, price };
}

export function addService(data, state = getState()) {
    const { name, price } = validate(data);
    const service = { id: uid(), name, price, recipe: [] };
    state.services.push(service);
    return service;
}

/** Edición del nombre/precio de un servicio. */
export function updateService(id, data, state = getState()) {
    const service = findService(id, state);
    if (!service) throw new Error('Servicio no encontrado.');

    const { name, price } = validate(data);
    service.name = name;
    service.price = price;
    return service;
}

/**
 * Elimina un servicio del catálogo. Las transacciones ya cobradas guardan
 * su propio snapshot (tipo + cantidad), así que el historial no se rompe.
 */
export function deleteService(id, state = getState()) {
    const service = findService(id, state);
    if (!service) throw new Error('Servicio no encontrado.');

    state.services = state.services.filter(s => s.id !== id);

    // Un servicio fuera del ticket mientras se cobra se quita del ticket.
    state.currentTicket.items = state.currentTicket.items
        .filter(i => !(i.type === 'service' && i.id === id));
    return service;
}
