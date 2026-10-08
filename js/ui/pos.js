/* Catálogo del POS, ticket y resumen de pago (pago mixto). Sin lógica de
 * negocio: delega en domain/payments.js y domain/ticket.js. */

import { getState } from '../core/state.js';
import { money, escapeHtml } from '../core/utils.js';
import { toUSD, convert } from '../core/rates.js';
import { ticketTotals, setPaymentAmount, pendingAmountFor } from '../domain/ticket.js';
import { activePaymentMethods, methodLabel, settlePayments } from '../domain/payments.js';

const TYPE_LABELS = { fisico: 'Físico', electronico: 'Electrónico' };

/** Índices marcados en el checklist de la orden (solo UI, no se persiste). */
const selected = new Set();

/** Payload del ítem en curso de arrastre (drag & drop del catálogo → orden). */
let dragData = null;

function clearSelection() {
    selected.clear();
}

function pruneSelection(items) {
    for (const idx of [...selected]) {
        if (idx < 0 || idx >= items.length) selected.delete(idx);
    }
}

export function renderStaffSelect() {
    const state = getState();
    const select = document.getElementById('pos-staff-select');
    select.innerHTML = state.staff
        .map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(s.role)}</option>`)
        .join('');
    select.value = state.currentTicket.staffId;
}

export function renderCatalog() {
    const state = getState();
    const grid = document.getElementById('pos-catalog-grid');
    const search = document.getElementById('pos-search').value.trim().toLowerCase();
    const cat = state.posFilterCategory;
    const matches = name => name.toLowerCase().includes(search);

    let html = '';

    if (cat === 'all' || cat === 'service') {
        for (const s of state.services) {
            if (!matches(s.name)) continue;
            html += `
                <button type="button" data-action="add-item" data-type="service" data-id="${escapeHtml(s.id)}" draggable="true" class="catalog-card">
                    <div>
                        <span class="badge badge--tag badge--service">Servicio</span>
                        <h4 class="catalog-card__name">${escapeHtml(s.name)}</h4>
                    </div>
                    <div class="catalog-card__bottom">
                        <span class="catalog-card__meta">Insumos: ${s.recipe.length}</span>
                        <span class="catalog-card__price">${money(s.price)}</span>
                    </div>
                </button>`;
        }
    }

    if (cat === 'all' || cat === 'sale') {
        for (const p of state.products.filter(p => p.type === 'sale')) {
            if (!matches(p.name)) continue;
            const isLow = p.stock <= p.minStock;
            html += `
                <button type="button" data-action="add-item" data-type="product" data-id="${escapeHtml(p.id)}" draggable="true" class="catalog-card catalog-card--sale">
                    <div>
                        <div class="catalog-card__top">
                            <span class="badge badge--tag badge--sale-tag">Producto</span>
                            <span class="catalog-card__stock ${isLow ? 'catalog-card__stock--low' : ''}">Stock: ${p.stock}</span>
                        </div>
                        <h4 class="catalog-card__name">${escapeHtml(p.name)}</h4>
                    </div>
                    <div class="catalog-card__bottom">
                        <span class="catalog-card__meta">${escapeHtml(p.unit)}</span>
                        <span class="catalog-card__price">${money(p.price)}</span>
                    </div>
                </button>`;
        }
    }

    grid.innerHTML = html ||
        '<p class="empty-cell" style="grid-column: 1 / -1;">No se encontraron ítems.</p>';
}

/**
 * Drag & drop nativo del catálogo → orden (complemento del clic, que sigue
 * siendo la vía accesible). En el drop se reutiliza el clic del botón, así el
 * ítem pasa por el mismo addItem + render + persist que el resto de entradas.
 */
export function initCatalogDrag() {
    const dropZone = document.querySelector('.ticket');
    if (!dropZone) return;

    document.addEventListener('dragstart', (e) => {
        const card = e.target.closest('[data-action="add-item"].catalog-card');
        if (!card) return;
        dragData = { type: card.dataset.type, id: card.dataset.id };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        card.classList.add('is-dragging');
    });

    document.addEventListener('dragend', (e) => {
        const card = e.target.closest('[data-action="add-item"].catalog-card');
        if (card) card.classList.remove('is-dragging');
        dropZone.classList.remove('is-drag-over');
        dragData = null;
    });

    document.addEventListener('dragover', (e) => {
        if (!dragData || !dropZone.contains(e.target)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        dropZone.classList.add('is-drag-over');
    });

    document.addEventListener('dragleave', (e) => {
        if (dropZone.contains(e.target)) return;
        dropZone.classList.remove('is-drag-over');
    });

    document.addEventListener('drop', (e) => {
        if (!dragData || !dropZone.contains(e.target)) return;
        e.preventDefault();
        dropZone.classList.remove('is-drag-over');
        const { type, id } = dragData;
        dragData = null;
        const card = document.querySelector(`[data-action="add-item"][data-type="${type}"][data-id="${id}"]`);
        card?.click();
    });
}

export function renderTicket() {
    const state = getState();
    const container = document.getElementById('ticket-items-container');
    const items = state.currentTicket.items;
    pruneSelection(items);

    if (items.length === 0) {
        clearSelection();
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-basket-shopping"></i>
                <p>El ticket está vacío.</p>
                <p class="empty-state__hint">Haz clic en los ítems del catálogo para agregarlos.</p>
            </div>`;
    } else {
        container.innerHTML = items.map((item, idx) => `
            <div class="ticket-item${selected.has(idx) ? ' is-selected' : ''}">
                <label class="ticket-item__check" title="Seleccionar para acciones masivas">
                    <input type="checkbox" data-action="toggle-item" data-idx="${idx}"
                           aria-label="Seleccionar ${escapeHtml(item.name)}"
                           ${selected.has(idx) ? 'checked' : ''}>
                </label>
                <div class="ticket-item__info">
                    <p class="ticket-item__name">${escapeHtml(item.name)}</p>
                    <p class="ticket-item__unit">${money(item.price)} c/u</p>
                </div>
                <div class="ticket-item__qty">
                    <button type="button" data-action="qty" data-idx="${idx}" data-delta="-1"
                            class="qty-btn qty-btn--minus" aria-label="Quitar uno">−</button>
                    <span>${item.qty}</span>
                    <button type="button" data-action="qty" data-idx="${idx}" data-delta="1"
                            class="qty-btn qty-btn--plus" aria-label="Agregar uno">+</button>
                </div>
                <button type="button" data-action="remove-item" data-idx="${idx}"
                        class="ticket-item__remove" aria-label="Quitar ${escapeHtml(item.name)} del ticket">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>`).join('');
    }

    renderBulk();
    updateTotals();
    // Mantén el stepper al día (habilita/deshabilita el paso 2 según la orden).
    renderPosStep();
}

/** Barra de acciones masivas del checklist (visible solo con selección). */
export function renderBulk() {
    const bar = document.getElementById('ticket-bulk');
    if (!bar) return;
    const count = selected.size;
    const countEl = document.getElementById('ticket-bulk-count');
    if (countEl) countEl.textContent = `${count} seleccionado${count === 1 ? '' : 's'}`;
    bar.classList.toggle('is-hidden', count === 0);
}

/** Marca/desmarca un ítem del checklist (toggle desde el checkbox). */
export function toggleItem(idx) {
    const items = getState().currentTicket.items;
    if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) return;
    selected.has(idx) ? selected.delete(idx) : selected.add(idx);
    renderTicket();
}

/** Desmarca todos los ítems del checklist (sin borrar nada). */
export function clearSelected() {
    clearSelection();
    renderTicket();
}

/** Elimina los ítems seleccionados (acción masiva) y vuelve a pintar.
 *  Devuelve los índices borrados (para que el llamador los aplique al dominio). */
export function removeSelectedItems() {
    const indices = [...selected];
    clearSelection();
    return indices;
}

export function updateTotals() {
    const { subtotal, tax, total, commission } = ticketTotals();
    document.getElementById('ticket-subtotal').textContent = money(subtotal);
    document.getElementById('ticket-tax').textContent = money(tax);
    document.getElementById('ticket-commission').textContent = money(commission);
    document.getElementById('ticket-total').textContent = money(total);
    renderCheckout({ subtotal, tax, total, commission });
    updatePaymentSummary();
}

/**
 * Pinta el cobro: un select + «Agregar» elige qué métodos se usan; solo los
 * agregados tienen fila con su monto (ya no se fijan todos en la UI). Los
 * slots son únicamente UI y además cargan la referencia y el comprobante
 * del método; los montos se persisten en `currentTicket.payments`.
 */
const slots = [];

/** Slot del método agregado (o undefined si no está en el cobro). */
function slotOf(method) {
    return slots.find(s => s.method === method);
}

export function resetPaymentSlots() {
    slots.length = 0;
}

/** Agrega el método elegido en el select al cobro (una fila para su monto). */
export function addPaymentSlot() {
    const select = document.getElementById('payment-select');
    const id = select?.value;
    if (!id || slotOf(id)) return;
    // Si ese pago ya traía referencia/comprobante (F5 en pleno cobro), lo
    // recupera del ticket en vez de empezar de cero.
    const pago = getState().currentTicket.payments.find(p => p.method === id);
    slots.push({
        method: id,
        reference: (pago && pago.reference) || '',
        attachment: (pago && pago.attachment) || null
    });
    renderPayment();
}

/** Quita un método del cobro y limpia su monto en el ticket. */
export function removePaymentSlot(id) {
    const idx = slots.findIndex(s => s.method === id);
    if (idx < 0) return;
    slots.splice(idx, 1);
    try {
        setPaymentAmount(id, 0);
    } catch {
        /* No era un pago registrado: no hay nada que limpiar. */
    }
    renderPayment();
}

/** Guarda la referencia/número de operación del método en su slot. */
export function setSlotReference(method, reference) {
    const slot = slotOf(method);
    if (!slot) return;
    slot.reference = String(reference ?? '');
}

/** Adjunta el comprobante (data URL) al método y repinta la fila. */
export function setSlotAttachment(method, attachment) {
    const slot = slotOf(method);
    if (!slot) return;
    slot.attachment = attachment;
    renderPayment();
}

/** Quita el comprobante adjunto del método y repinta la fila. */
export function removeSlotAttachment(method) {
    const slot = slotOf(method);
    if (!slot) return;
    slot.attachment = null;
    renderPayment();
}

/**
 * Escribe en la casilla de monto de `method` lo que falta por cubrir con ese
 * método (el total si nadie pagó; la falta si otros métodos ya aportaron) y
 * dispara el mismo evento `input` que usaría el cajero.
 */
export function fillPaymentAmount(method) {
    const input = [...document.querySelectorAll('#payment-list [data-action="payment-amount"]')]
        .find(i => i.dataset.method === method);
    if (!input) return;
    const pendiente = pendingAmountFor(method);
    input.value = String(Number(convert(pendiente, getState().settings.currency).toFixed(2)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function renderPayment() {
    const state = getState();
    const list = document.getElementById('payment-list');
    const select = document.getElementById('payment-select');
    if (!list || !select) return;

    const methods = activePaymentMethods(state);
    if (slots.length === 0) {
        // Rehidrata los métodos del ticket (p. ej. tras un F5 a mitad de cobro).
        for (const p of state.currentTicket.payments) {
            if (methods.some(m => m.id === p.method)) {
                slots.push({
                    method: p.method,
                    reference: p.reference || '',
                    attachment: p.attachment || null
                });
            }
        }
    }

    const elegidos = slots.map(s => s.method);
    const restantes = methods.filter(m => !elegidos.includes(m.id));
    select.innerHTML = restantes.length
        ? restantes.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('')
        : '<option value="" disabled>Sin métodos disponibles</option>';
    select.value = restantes[0]?.id ?? '';

    list.innerHTML = slots.map(slot => {
        const m = methods.find(x => x.id === slot.method);
        if (!m) return '';
        const pago = state.currentTicket.payments.find(p => p.method === slot.method);
        const valor = pago ? String(Number(convert(pago.amountUSD, state.settings.currency).toFixed(2))) : '';
        const adjunto = slot.attachment;
        return `
            <div class="payment-row">
                <label class="payment-row__label" for="pay-${escapeHtml(m.id)}">
                    <i class="fa-solid ${escapeHtml(m.icon || 'fa-credit-card')}" aria-hidden="true"></i>
                    <span>${escapeHtml(m.label)}</span>
                    <span class="badge badge--tag badge--${escapeHtml(m.type)}">${escapeHtml(TYPE_LABELS[m.type] || m.type)}</span>
                    ${m.requiresReference ? '<span class="badge badge--tag badge--required">Ref. obligatoria</span>' : ''}
                </label>
                <input type="number" id="pay-${escapeHtml(m.id)}" min="0" step="0.01" inputmode="decimal"
                       placeholder="0.00" value="${escapeHtml(valor)}" data-action="payment-amount" data-method="${escapeHtml(m.id)}"
                       class="input ticket__received" aria-label="Monto de ${escapeHtml(m.label)}">
                <button type="button" data-action="fill-payment-amount" data-method="${escapeHtml(m.id)}"
                        class="btn btn--neutral btn--icon" title="Completar con el total pendiente"
                        aria-label="Completar el monto de ${escapeHtml(m.label)} con el total pendiente">
                    <i class="fa-solid fa-bullseye" aria-hidden="true"></i>
                </button>
                <button type="button" data-action="remove-payment-method" data-method="${escapeHtml(m.id)}"
                        class="btn btn--danger btn--ghost btn--icon" title="Quitar ${escapeHtml(m.label)} del cobro"
                        aria-label="Quitar ${escapeHtml(m.label)} del cobro">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
                <div class="payment-ref">
                    <input type="text" id="ref-${escapeHtml(m.id)}" maxlength="60" autocomplete="off"
                           data-action="payment-reference" data-method="${escapeHtml(m.id)}"
                           class="input payment-ref__input"
                           placeholder="${m.requiresReference ? 'Nro. de referencia o comprobante (obligatorio)' : 'Nro. de referencia / comprobante (opcional)'}"
                           value="${escapeHtml(slot.reference)}" aria-label="Referencia de ${escapeHtml(m.label)}">
                    <input type="file" accept="image/*,application/pdf" class="payment-ref__file"
                           data-action="payment-attachment" data-method="${escapeHtml(m.id)}"
                           aria-hidden="true" tabindex="-1">
                    <button type="button" data-action="pick-payment-attachment" data-method="${escapeHtml(m.id)}"
                            class="btn btn--neutral btn--icon" title="Adjuntar comprobante (imagen o PDF)"
                            aria-label="Adjuntar comprobante de ${escapeHtml(m.label)}">
                        <i class="fa-solid fa-paperclip" aria-hidden="true"></i>
                    </button>
                    ${adjunto ? `
                    <a class="payment-ref__chip" href="${escapeHtml(adjunto.data)}" target="_blank" rel="noopener"
                       title="Ver comprobante en una pestaña nueva">
                        <i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i>
                        <span>${escapeHtml(adjunto.name)}</span>
                    </a>
                    <button type="button" data-action="remove-payment-attachment" data-method="${escapeHtml(m.id)}"
                            class="btn btn--danger btn--ghost btn--icon" title="Quitar comprobante"
                            aria-label="Quitar comprobante de ${escapeHtml(m.label)}">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>` : ''}
                </div>
            </div>`;
    }).join('') || '<p class="payment-empty">Elige un método y toca Agregar.</p>';

    updatePaymentSummary();
}

/**
 * Lee los inputs del cobro (solo los métodos agregados), actualiza el ticket
 * (en USD) y devuelve una copia de los pagos. Un campo vacío o ilegible
 * cuenta como 0 (método sin usar). La referencia y el comprobante del slot
 * viajan con el pago, siempre que este tenga monto.
 */
export function collectPayments() {
    const state = getState();
    document.querySelectorAll('#payment-list [data-action="payment-amount"]').forEach(input => {
        const crudo = input.value.trim();
        const n = Number(crudo);
        const usd = crudo === '' || !Number.isFinite(n) || n <= 0
            ? 0
            : toUSD(n, state.settings.currency);
        setPaymentAmount(input.dataset.method, usd);
    });

    for (const slot of slots) {
        const pago = state.currentTicket.payments.find(p => p.method === slot.method);
        if (!pago) continue;
        if (slot.reference) pago.reference = slot.reference;
        else delete pago.reference;
        if (slot.attachment) pago.attachment = slot.attachment;
        else delete pago.attachment;
    }

    return state.currentTicket.payments.map(p => ({ ...p }));
}

/** Resumen Pagado / Falta / Vuelto en la moneda activa. */
export function updatePaymentSummary() {
    const state = getState();
    const { total } = ticketTotals();
    const paid = state.currentTicket.payments.reduce((a, p) => a + p.amountUSD, 0);
    const due = Math.max(total - paid, 0);

    let change = 0;
    try {
        change = settlePayments(state.currentTicket.payments, total, activePaymentMethods(state)).changeUSD;
    } catch {
        change = 0;
    }

    document.getElementById('ticket-paid').textContent = money(paid);
    document.getElementById('ticket-due').textContent = money(due);
    document.getElementById('ticket-change').textContent = money(change);
    document.getElementById('ticket-due-row').classList.toggle('is-hidden', due <= 0.0001);
}

/** Resumen de la venta para el modal de confirmación. */
export function renderSaleConfirm() {
    const state = getState();
    const { subtotal, tax, total } = ticketTotals();
    const staff = state.staff.find(s => s.id === state.currentTicket.staffId);
    const pagos = state.currentTicket.payments;
    const methods = activePaymentMethods(state);

    let change = 0;
    try {
        change = settlePayments(pagos, total, methods).changeUSD;
    } catch {
        change = 0;
    }

    const filasPago = pagos.length > 0
        ? pagos.map(p => {
            const meta = [
                p.reference ? `Ref. ${escapeHtml(p.reference)}` : '',
                p.attachment
                    ? `<a class="sale-confirm__ref-link" href="${escapeHtml(p.attachment.data)}" target="_blank" rel="noopener">Ver comprobante</a>`
                    : ''
            ].filter(Boolean).join(' · ');
            return `
            <div class="sale-confirm__row">
                <span>${escapeHtml(methodLabel(p.method, methods))}${meta ? `<small class="sale-confirm__meta">${meta}</small>` : ''}</span>
                <span>${money(p.amountUSD)}</span>
            </div>`;
        }).join('')
        : '<div class="sale-confirm__row"><span>Sin pagos registrados</span><span>—</span></div>';

    document.getElementById('sale-confirm-preview').innerHTML = `
        <div class="sale-confirm__row">
            <span>Artículos</span>
            <span>${state.currentTicket.items.reduce((a, i) => a + i.qty, 0)}</span>
        </div>
        <div class="sale-confirm__row">
            <span>Estilista</span>
            <span>${escapeHtml(staff ? staff.name : 'N/A')}</span>
        </div>
        <div class="sale-confirm__row">
            <span>Subtotal</span>
            <span>${money(subtotal)}</span>
        </div>
        <div class="sale-confirm__row">
            <span>IVA (16%)</span>
            <span>${money(tax)}</span>
        </div>
        <div class="sale-confirm__row sale-confirm__row--total">
            <span>Total</span>
            <span>${money(total)}</span>
        </div>
        <div class="sale-confirm__sep"></div>
        ${filasPago}
        <div class="sale-confirm__row">
            <span>Vuelto</span>
            <span>${money(change)}</span>
        </div>`;
}

/* --- Wizard de cobro: 1 Orden → 2 Cobro → 3 Cierre -------------------------------
 * El paso vive en memoria (no se persiste): si la pestaña recarga, la orden
 * recupera sus ítems pero el usuario vuelve al paso 1. El paso 3 solo se
 * alcanza al concretar la venta. */
let posStep = 1;

export function getPosStep() {
    return posStep;
}

/**
 * Navega entre pasos con validación estricta:
 *  - 1 siempre se puede (volver o empezar de nuevo);
 *  - 2 exige al menos un ítem en la orden;
 *  - 3 no se puede elegir: solo se llega a él al concretar la venta.
 * Devuelve false si la transición no está permitida.
 */
export function goToPosStep(paso) {
    if (paso === 1) {
        posStep = 1;
        return true;
    }
    if (paso === 2) {
        if (getState().currentTicket.items.length === 0) return false;
        posStep = 2;
        return true;
    }
    // El cierre solo existe después de que la venta se haya concretado.
    return paso === 3 && posStep === 3;
}

/** Marca el paso 3: lo llama el cobro exitoso justo antes de repintar. */
export function completePosStep() {
    posStep = 3;
}

/** Muestra el panel del paso activo y sincroniza el stepper. */
export function renderPosStep() {
    const layout = document.querySelector('#tab-pos .pos-layout');
    const checkout = document.getElementById('pos-checkout');
    const done = document.getElementById('pos-done');
    if (!layout || !checkout || !done) return;

    const conItems = getState().currentTicket.items.length > 0;
    // Si la orden se quedó sin ítems estando en el cobro, volvemos a 1.
    if (posStep === 2 && !conItems) posStep = 1;

    layout.classList.toggle('is-hidden', posStep !== 1);
    checkout.classList.toggle('is-hidden', posStep !== 2);
    done.classList.toggle('is-hidden', posStep !== 3);

    document.querySelectorAll('[data-action="pos-step"]').forEach(btn => {
        const destino = Number(btn.dataset.step);
        btn.disabled = (destino === 2 && !conItems) || (destino === 3 && posStep !== 3);
        if (!btn.classList.contains('pos-step')) return;
        const activo = destino === posStep;
        btn.classList.toggle('is-active', activo);
        if (activo) btn.setAttribute('aria-current', 'step');
        else btn.removeAttribute('aria-current');
    });

    if (posStep === 2) renderCheckout();
}

/** Resumen del paso 2: ítems, estilista y totales de la orden. */
export function renderCheckout(totals) {
    const state = getState();
    const cont = document.getElementById('checkout-items');
    if (!cont) return;

    const { subtotal, tax, total, commission } = totals || ticketTotals();
    const staff = state.staff.find(s => s.id === state.currentTicket.staffId);

    cont.innerHTML = state.currentTicket.items.map(item => `
        <div class="checkout-item">
            <div class="checkout-item__info">
                <p class="checkout-item__name">${escapeHtml(item.name)}</p>
                <p class="checkout-item__unit">${money(item.price)} c/u</p>
            </div>
            <span class="checkout-item__qty">× ${item.qty}</span>
            <span class="checkout-item__price">${money(item.price * item.qty)}</span>
        </div>`).join('') || '<p class="empty-cell">La orden está vacía.</p>';

    const staffEl = document.getElementById('checkout-staff');
    if (staffEl) staffEl.textContent = staff ? staff.name : 'N/A';

    const put = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    };
    put('ck-subtotal', money(subtotal));
    put('ck-tax', money(tax));
    put('ck-commission', money(commission));
    put('ck-total', money(total));
}

/** Actualiza los botones de filtro del catálogo según la categoría activa. */
export function renderFilters() {
    const cat = getState().posFilterCategory;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.cat === cat);
    });
}