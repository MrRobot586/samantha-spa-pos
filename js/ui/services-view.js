/* Tarjetas de servicios con su receta. */

import { getState } from '../core/state.js';
import { escapeHtml, money } from '../core/utils.js';
import { resolveRecipe } from '../domain/services.js';

export function renderServicesCards() {
    const state = getState();
    const grid = document.getElementById('services-cards-grid');

    grid.innerHTML = state.services.map(s => {
        const recipe = resolveRecipe(s, state);
        const items = recipe.length
            ? recipe.map(({ product, amount }) => `
                <li class="recipe__item">
                    <span>• ${escapeHtml(product.name)}</span>
                    <span class="recipe__amount">${amount} ${escapeHtml(product.unit)}</span>
                </li>`).join('')
            : '<li class="recipe__empty">Sin insumos registrados.</li>';

        return `
            <article class="card service-card">
                <div>
                    <div class="service-card__head">
                        <h4 class="service-card__name">${escapeHtml(s.name)}</h4>
                        <span class="service-card__price">${money(s.price)}</span>
                    </div>
                    <div class="recipe">
                        <p class="recipe__label">Fórmula / Insumos Consumidos</p>
                        <ul class="recipe__list">${items}</ul>
                    </div>
                </div>
                <div class="row-actions">
                    <button type="button" data-action="edit-service" data-id="${escapeHtml(s.id)}" class="btn btn--mini btn--icon"
                            title="Editar servicio" aria-label="Editar ${escapeHtml(s.name)}">
                        <i class="fa-solid fa-pen" aria-hidden="true"></i>
                    </button>
                    <button type="button" data-action="delete-service" data-id="${escapeHtml(s.id)}"
                            data-title="¿Eliminar servicio?"
                            data-message="Se eliminará &quot;${escapeHtml(s.name)}&quot; del catálogo. El historial de ventas ya cobradas no se altera."
                            class="btn btn--mini btn--mini-danger btn--icon"
                            title="Eliminar servicio" aria-label="Eliminar ${escapeHtml(s.name)}">
                        <i class="fa-solid fa-trash" aria-hidden="true"></i>
                    </button>
                </div>
            </article>`;
    }).join('');
}

/** Rellena el modal de servicio para editar (o lo limpia para crear). */
export function fillServiceForm(id) {
    const serv = id ? getState().services.find(s => s.id === id) : null;
    const form = document.getElementById('form-add-service');
    form.reset();
    document.getElementById('service-id').value = serv ? serv.id : '';
    document.getElementById('serv-name').value = serv ? serv.name : '';
    document.getElementById('serv-price').value = serv ? serv.price : '';
    document.getElementById('modal-service-title').textContent =
        serv ? 'Editar Servicio' : 'Nuevo Servicio';
}
