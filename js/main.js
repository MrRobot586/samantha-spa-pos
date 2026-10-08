/* Punto de entrada.
 *
 * Arranque: 1) cargar y normalizar el estado de localStorage;
 * 2) pintar todo; 3) delegar los eventos del HTML, que — igual que en
 * DuoTracker — ya no llevan manejadores en línea: todo pasa por
 * data-action + listeners en document.
 */

import { getState, replaceState } from './core/state.js';
import { loadState, saveState, restoreDemo } from './core/storage.js';
import { login, logout, getCurrentUser } from './core/auth.js';
import { loadRatesCache, refreshRates, isStale, toUSD } from './core/rates.js';
import { CURRENCIES, THEMES, RATE_SOURCES, SESSION_IDLE_MS, IDLE_CHECK_MS } from './core/config.js';
import { money, shortDate } from './core/utils.js';

import { switchTab, renderNav, ensureAllowedTab } from './ui/navigation.js';
import { showLogin, showApp, showLoginError } from './ui/login-view.js';
import { renderHeader, applyTheme, initRateMenu, toggleRateMenu } from './ui/header.js';
import { renderUsersList, fillUserForm, resetUserForm } from './ui/users-view.js';
import { toast, toastSuccess, toastError } from './ui/dialogs.js';
import { openModal, closeModal, initModals } from './ui/modals.js';
import { toggleMenu, closeMenu, initMenu } from './ui/menu.js';
import { renderStaffSelect, renderCatalog, renderTicket, renderFilters, updateTotals, renderPayment, renderSaleConfirm, collectPayments, updatePaymentSummary, renderPosStep, goToPosStep, completePosStep, toggleItem, removeSelectedItems, clearSelected, initCatalogDrag, addPaymentSlot, removePaymentSlot, resetPaymentSlots, fillPaymentAmount, setSlotReference, setSlotAttachment, removeSlotAttachment } from './ui/pos.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderServicesCards, fillServiceForm } from './ui/services-view.js';
import { renderInventoryTable, fillProductForm } from './ui/inventory-view.js';
import { renderCommissions, renderCommissionsReport } from './ui/commissions-view.js';
import { renderCash, fillCashClosePreview } from './ui/cash-view.js';
import { renderSales } from './ui/sales-view.js';
import { renderSettings, saveMethod, deleteMethod, fillMethodForm, resetMethodForm } from './ui/settings-view.js';

import { addItem, changeQty, clearTicket, setTicketStaff, setPaymentAmount, ticketTotals, removeItem, removeItems } from './domain/ticket.js';
import { processPayment } from './domain/checkout.js';
import { addProduct, updateProduct, deleteProduct, restock, findProduct } from './domain/inventory.js';
import { addService, updateService, deleteService } from './domain/services.js';
import { createUser, updateUser, deleteUser } from './domain/users.js';
import { openCashSession, addWithdrawal, closeCashSession } from './domain/cash.js';
import { commissionsBetween, closuresBetween } from './domain/reports.js';
import { receiptTicketData, hasServices } from './domain/receipt.js';
import { renderReceiptHtml } from './ui/receipt.js';
import { downloadCsv } from './ui/csv-export.js';

const persist = () => saveState(getState());

/** Revisión de staleness para sesiones largas (la tasa vive en memoria). */
const STALE_CHECK_MS = 10 * 60 * 1000;

/* Marca de la última actividad del usuario; el temporizador de inactividad
 * la compara contra SESSION_IDLE_MS para cerrar la sesión sola. */
let lastActivity = Date.now();
const touchActivity = () => { lastActivity = Date.now(); };

function renderAll() {
    renderHeader();
    renderDashboard();
    renderCatalog();
    renderTicket();
    renderPayment();
    renderServicesCards();
    renderInventoryTable();
    renderCommissions();
    renderCommissionsReport();
    renderCash();
    renderUsersList();
    renderSales();
    renderSettings();
    renderPosStep();
}

/** Chip del usuario en el topbar + nav filtrada por rol. */
function renderSessionChrome() {
    const user = getCurrentUser(getState());
    if (!user) return;

    const iniciales = user.name.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    document.getElementById('user-initials').textContent = iniciales;
    document.getElementById('user-chip-name').textContent = user.name;
    document.getElementById('user-chip').title =
        `${user.name} · ${user.role === 'admin' ? 'Administrador' : 'Estilista'}`;
    const topbarNombre = document.getElementById('topbar-user-name');
    if (topbarNombre) topbarNombre.textContent = user.name;
    renderNav(user.role);
}

/** Fecha corta dd/mm/aaaa en el grupo "Sesión" del menú y en el badge de caja. */
function renderCurrentDate() {
    const fecha = shortDate();
    const menu = document.getElementById('menu-date');
    if (menu) menu.textContent = fecha;
}

/* -------------------------------------------------------- confirmaciones -- */

/** Abre el modal genérico con la acción pendiente y su copy. */
function openConfirm(el, op) {
    pendingConfirm = { op, id: el.dataset.id || null };
    document.getElementById('modal-confirm-title').textContent = el.dataset.title || '¿Confirmar?';
    document.getElementById('modal-confirm-message').textContent = el.dataset.message || '';
    openModal('modal-confirm');
}

function handleConfirm({ op, id }) {
    closeModal('modal-confirm');

    if (op === 'reset-demo') {
        replaceState(restoreDemo());
        applyTheme();
        renderAll();
        if (getCurrentUser(getState())) {
            renderSessionChrome();
            ensureAllowedTab();
            toastSuccess('Datos restaurados a la demo de fábrica. El respaldo quedó guardado.');
        } else {
            logout();
            showLogin();
            toastSuccess('Datos restaurados a la demo de fábrica.');
        }
        return;
    }

    if (op === 'delete-product') {
        try {
            const p = deleteProduct(id);
            toastSuccess(`Producto "${p.name}" eliminado.`);
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (op === 'delete-service') {
        try {
            const s = deleteService(id);
            toastSuccess(`Servicio "${s.name}" eliminado.`);
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (op === 'delete-method') {
        try {
            const m = deleteMethod(id);
            renderAll();
            persist();
            toastSuccess(`Método "${m.label}" eliminado: el POS, la caja y los reportes ya no lo usan.`);
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (op === 'delete-user') {
        try {
            const u = deleteUser(id);
            toastSuccess(`Usuario "${u.name}" eliminado.`);
            renderAll();
            persist();
            if (getCurrentUser(getState())) {
                renderSessionChrome();
                ensureAllowedTab();
            } else {
                logout();
                showLogin();
            }
        } catch (err) {
            toastError(err.message);
        }
    }
}

/* -------------------------------------------------------------- acciones -- */

let restockTargetId = null;

/** Operación pendiente del modal de confirmación genérico. */
let pendingConfirm = null;

/** Id de la última venta concretada (para imprimir su ticket de canje). */
let lastSaleTxId = null;

function handleAction(el, action) {
    switch (action) {
        case 'switch-tab':
            closeMenu();
            switchTab(el.dataset.tab);
            break;

        case 'toggle-menu':
            toggleMenu();
            break;

        case 'toggle-rate-menu':
            toggleRateMenu();
            break;

        case 'filter-cat': {
            const cat = el.dataset.cat;
            if (!['all', 'service', 'sale'].includes(cat)) return;
            getState().posFilterCategory = cat;
            renderFilters();
            renderCatalog();
            persist();
            break;
        }

        case 'add-item':
            try {
                addItem(el.dataset.type, el.dataset.id);
                renderTicket();
                persist();
            } catch (err) {
                toastError(err.message);
            }
            break;

        case 'qty':
            try {
                changeQty(Number(el.dataset.idx), Number(el.dataset.delta));
            } catch (err) {
                toastError(err.message);
                break;
            }
            renderTicket();
            persist();
            break;

        case 'clear-ticket':
            clearTicket();
            resetPaymentSlots();
            renderTicket();
            renderPayment();
            persist();
            break;

        case 'remove-item':
            removeItem(Number(el.dataset.idx));
            renderTicket();
            persist();
            break;

        case 'bulk-remove': {
            const indices = removeSelectedItems();
            if (indices.length > 0) {
                removeItems(indices);
                renderTicket();
                persist();
                toastSuccess(`${indices.length} ítem${indices.length > 1 ? 's' : ''} eliminado${indices.length > 1 ? 's' : ''} de la orden.`);
            }
            break;
        }

        case 'bulk-clear':
            clearSelected();
            break;

        case 'pay': {
            try {
                // Sin montos: se precarga el total en efectivo (lo habitual).
                if (collectPayments().length === 0) {
                    const { total } = ticketTotals();
                    setPaymentAmount('cash', total);
                    renderPayment();
                    // Vuelve a colectar: así el pago recién creado hereda la
                    // referencia y el comprobante del efectivo.
                    collectPayments();
                }
                renderSaleConfirm();
                openModal('modal-sale-confirm');
            } catch (err) {
                toastError(err.message);
            }
            break;
        }

        case 'confirm-sale': {
            try {
                const state = getState();
                const payments = collectPayments();
                const tx = processPayment(state, { payments });
                closeModal('modal-sale-confirm');
                renderPayment();
                lastSaleTxId = tx.id;
                document.getElementById('sale-done-preview').innerHTML = `
                    <div class="sale-confirm__row"><span>Venta</span><span>${tx.id}</span></div>
                    <div class="sale-confirm__row"><span>Total</span><span>${money(tx.total)}</span></div>
                    <div class="sale-confirm__row"><span>Servicios</span><span>${tx.items.filter(i => i.type === 'service').reduce((a,i)=>a+i.qty,0)}</span></div>`;
                // La venta se concretó: recién ahora existe el paso 3 (Cierre).
                completePosStep();
                toastSuccess(tx.changeUSD > 0
                    ? `Venta de ${money(tx.total)} concretada · vuelto ${money(tx.changeUSD)}.`
                    : `Venta de ${money(tx.total)} concretada: inventario descontado y comisión asignada.`);
                renderAll();
                persist();
            } catch (err) {
                toastError(err.message);
                closeModal('modal-sale-confirm');
            }
            break;
        }

        case 'pos-step': {
            const paso = Number(el.dataset.step);
            if (!goToPosStep(paso)) {
                toastError(paso === 2
                    ? 'El pedido está vacío: agrega al menos un ítem antes de ir al cobro.'
                    : 'Ese paso solo se alcanza al concretar la venta.');
                break;
            }
            renderPosStep();
            break;
        }

        case 'add-payment-method':
            addPaymentSlot();
            break;

        case 'remove-payment-method':
            removePaymentSlot(el.dataset.method);
            // Se persiste para que el método no vuelva con su monto, su
            // referencia y su comprobante después de un F5.
            collectPayments();
            persist();
            break;

        case 'fill-payment-amount':
            fillPaymentAmount(el.dataset.method);
            break;

        case 'pick-payment-attachment':
            el.closest('.payment-row')?.querySelector('[data-action="payment-attachment"]')?.click();
            break;

        case 'remove-payment-attachment':
            removeSlotAttachment(el.dataset.method);
            collectPayments();
            persist();
            break;

        case 'pos-new-sale':
            goToPosStep(1);
            resetPaymentSlots();
            renderTicket();
            renderPayment();
            renderPosStep();
            break;


        case 'print-ticket': {
            const txId = el.dataset.txId;
            if (!txId) break;
            const tx = getState().transactions.find(t => t.id === txId);
            if (!tx) { toastError('Venta no encontrada.'); break; }
            printTicket(tx);
            break;
        }
        case 'print-last-ticket': {
            if (!lastSaleTxId) break;
            const tx = getState().transactions.find(t => t.id === lastSaleTxId);
            if (!tx) { toastError('Venta no encontrada.'); break; }
            printTicket(tx);
            break;
        }
        case 'report-sales': {
            renderSales();
            break;
        }
        case 'open-modal': {
            const target = el.dataset.target;
            closeMenu();
            openModal(target);
            break;
        }

        case 'close-modal':
            closeModal(el.dataset.target);
            break;

        case 'open-confirm':
            openConfirm(el, el.dataset.op);
            break;

        case 'confirm-action':
            if (!pendingConfirm) { closeModal('modal-confirm'); break; }
            handleConfirm(pendingConfirm);
            pendingConfirm = null;
            break;

        case 'filter-closures':
            renderCash();
            break;

        case 'export-closures': {
            const from = document.getElementById('closure-from').value;
            const to = document.getElementById('closure-to').value;
            const rows = closuresBetween(from, to).map(c => [
                c.closedAt, c.closedByName, c.txCount,
                c.ventas.cash, c.ventas.debit, c.ventas.pago_movil,
                c.ventas.divisa, c.ventas.other,
                c.totalUSD, c.esperadoUSD, c.contadoUSD, c.diferenciaUSD
            ]);
            rows.unshift(['Fecha', 'Cerrado por', 'Ventas (nº)', 'Efectivo USD', 'Débito USD',
                'Pago Móvil USD', 'Divisa USD', 'Otro USD', 'Total USD', 'Esperado USD',
                'Contado USD', 'Diferencia USD']);
            downloadCsv('cortes.csv', rows);
            toastSuccess(`CSV exportado (${rows.length - 1} cortes).`);
            break;
        }

        case 'report-commissions':
            renderCommissionsReport(
                document.getElementById('comm-from').value,
                document.getElementById('comm-to').value
            );
            break;

        case 'export-commissions': {
            const from = document.getElementById('comm-from').value;
            const to = document.getElementById('comm-to').value;
            const rows = commissionsBetween(from, to).map(r =>
                [r.staffName, r.sales, r.totalUSD, r.commissionUSD]);
            rows.unshift(['Estilista', 'Ventas', 'Vendido USD', 'Comisión USD']);
            downloadCsv('comisiones.csv', rows);
            toastSuccess(`CSV exportado (${rows.length - 1} estilistas).`);
            break;
        }

        case 'logout':
            closeMenu();
            logout();
            showLogin();
            break;

        case 'set-currency': {
            const cur = el.dataset.currency;
            if (!CURRENCIES.includes(cur)) return;
            getState().settings.currency = cur;
            renderAll();
            persist();
            break;
        }

        case 'set-theme': {
            const actual = getState().settings.theme;
            const siguiente = THEMES[(THEMES.indexOf(actual) + 1) % THEMES.length] || 'auto';
            getState().settings.theme = siguiente;
            applyTheme();
            renderHeader();
            persist();
            break;
        }

        case 'refresh-rates':
            refreshRates().then(actualizada => {
                if (actualizada) {
                    renderAll();
                } else {
                    renderHeader();
                    toastError('No se pudo actualizar la tasa de cambio (sin conexión).');
                }
            });
            break;

        case 'edit-user':
            fillUserForm(el.dataset.id);
            break;

        case 'new-user':
            resetUserForm();
            document.getElementById('user-name')?.focus();
            break;

        case 'new-product':
            fillProductForm();
            openModal('modal-product');
            document.getElementById('prod-name')?.focus();
            break;

        case 'edit-product':
            fillProductForm(el.dataset.id);
            openModal('modal-product');
            break;

        case 'new-service':
            fillServiceForm('');
            openModal('modal-service');
            document.getElementById('serv-name')?.focus();
            break;

        case 'edit-service':
            fillServiceForm(el.dataset.id);
            openModal('modal-service');
            break;

        case 'edit-method':
            try {
                fillMethodForm(el.dataset.id);
            } catch (err) {
                toastError(err.message);
            }
            break;

        case 'reset-method-form':
            resetMethodForm();
            break;

        case 'delete-method':
            openConfirm(el, 'delete-method');
            break;

        case 'delete-product':
        case 'delete-service':
        case 'delete-user':
            openConfirm(el, el.dataset.action);
            break;

        case 'restock': {
            const prod = findProduct(el.dataset.id);
            if (!prod) {
                toastError('Producto no encontrado.');
                return;
            }
            restockTargetId = prod.id;
            document.getElementById('restock-name').value = prod.name;
            document.getElementById('restock-amount').value = '10';
            openModal('modal-restock');
            break;
        }

        case 'cash-open-modal':
            document.getElementById('cash-open-fondo').value = '';
            openModal('modal-cash-open');
            document.getElementById('cash-open-fondo').focus();
            break;

        case 'cash-withdraw-modal':
            document.getElementById('cash-withdraw-amount').value = '';
            document.getElementById('cash-withdraw-note').value = '';
            openModal('modal-cash-withdraw');
            document.getElementById('cash-withdraw-amount').focus();
            break;

        case 'cash-close-modal':
            fillCashClosePreview();
            document.getElementById('cash-close-contado').value = '';
            openModal('modal-cash-close');
            document.getElementById('cash-close-contado').focus();
            break;
    }
}

function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    handleAction(el, el.dataset.action);
}

/* --- Comprobantes de pago (adjuntos) ------------------------------
 * Imágenes: se reducen a 1280px de lado y JPEG 0.75 para que la cuota de
 * localStorage no se llene con fotos del teléfono. PDF: se adjunta tal cual
 * (con tope); si no entra, queda el número de referencia. */
const MAX_PDF_BYTES = 1_000_000;
const MAX_ATTACHMENT_DATA = 1.6e6; // alineado a domain/payments.js

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        reader.readAsDataURL(file);
    });
}

function compressImage(file) {
    return fileToDataURL(file).then(url => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const MAX = 1280;
            const escala = Math.min(1, MAX / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * escala));
            const h = Math.max(1, Math.round(img.height * escala));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            // Fondo blanco: sin él, una PNG con transparencia sale negra al
            // convertirse a JPEG.
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const tipo = (file.type === 'image/png' || file.type === 'image/webp')
                ? 'image/jpeg'
                : file.type;
            resolve(canvas.toDataURL(tipo, 0.75));
        };
        img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        img.src = url;
    }));
}

async function readAttachment(file) {
    const esImagen = typeof file.type === 'string' && file.type.startsWith('image/');
    const esPdf = file.type === 'application/pdf';
    if (!esImagen && !esPdf) {
        throw new Error('Adjunta una imagen o un PDF.');
    }
    if (esPdf && file.size > MAX_PDF_BYTES) {
        throw new Error('El PDF supera 1 MB: usa una foto reducida o solo el número de referencia.');
    }

    const data = esImagen ? await compressImage(file) : await fileToDataURL(file);
    if (data.length > MAX_ATTACHMENT_DATA) {
        throw new Error('El archivo sigue pesando demasiado: usa el número de referencia.');
    }
    return {
        name: String(file.name || 'comprobante').slice(0, 80),
        mime: esPdf ? 'application/pdf' : data.slice(5, data.indexOf(';')),
        data
    };
}

function onChange(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'staff-change') {
        try {
            setTicketStaff(el.value);
            updateTotals();
            persist();
        } catch (err) {
            toastError(err.message);
        }
    } else if (el.dataset.action === 'toggle-item') {
        toggleItem(Number(el.dataset.idx));
    } else if (el.dataset.action === 'set-rate-source') {
        const src = el.value === 'eur' ? 'eur' : 'usd';
        if (!RATE_SOURCES.includes(src)) {
            renderHeader();
            return;
        }
        if (getState().settings.rateSource === src) return;
        getState().settings.rateSource = src;
        persist();
        // Toda la UI muestra dinero: repintado completo (badge + montos).
        renderAll();
        toastSuccess(src === 'eur'
            ? 'La tasa de referencia es ahora la del euro (BCV).'
            : 'La tasa de referencia es ahora la del dólar (BCV).');
    } else if (el.dataset.action === 'payment-reference') {
        // Al salir del campo se fija lo escrito y se persiste junto con los
        // montos que ya estaban cobrados.
        setSlotReference(el.dataset.method, el.value);
        collectPayments();
        persist();
    } else if (el.dataset.action === 'payment-attachment') {
        const file = el.files && el.files[0];
        if (!file) return;
        readAttachment(file)
            .then(att => {
                setSlotAttachment(el.dataset.method, att);
                collectPayments();
                persist();
                el.value = '';
                toastSuccess(`Comprobante "${att.name}" adjunto.`);
            })
            .catch(err => toastError(err.message));
    }
}

function onInput(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'pos-search') {
        renderCatalog();
    } else if (el.dataset.action === 'payment-amount') {
        collectPayments();
        updatePaymentSummary();
    } else if (el.dataset.action === 'payment-reference') {
        // Sin repintar: se perdería el foco de la escritura. La referencia
        // viaja con el pago al confirmar (y se persiste al salir del campo).
        setSlotReference(el.dataset.method, el.value);
        collectPayments();
    }
}

function fieldValue(id) {
    return document.getElementById(id).value.trim();
}

function onSubmit(e) {
    const form = e.target;
    e.preventDefault();

    if (form.id === 'form-login') {
        try {
            const user = login(fieldValue('login-user'), fieldValue('login-pin'));
            showApp();
            renderSessionChrome();
            switchTab('dashboard');
            if (user.staffId) {
                try {
                    setTicketStaff(user.staffId);
                    persist();
                } catch {
                    // El estilista vinculado ya no existe: se queda el actual.
                }
            }
            renderStaffSelect();
            renderAll();
            toastSuccess(`Hola, ${user.name}.`);
            touchActivity();
        } catch (err) {
            showLoginError(err.message);
            document.getElementById('login-pin')?.select();
        }
        return;
    }

    if (form.id === 'form-user') {
        try {
            const id = fieldValue('user-id');
            const data = {
                name: fieldValue('user-name'),
                username: fieldValue('user-username'),
                role: document.getElementById('user-role').value,
                pin: fieldValue('user-pin'),
                staffId: document.getElementById('user-staff').value || null,
                active: document.getElementById('user-active').checked
            };
            const guardado = id ? updateUser(id, data) : createUser(data);
            persist();
            resetUserForm();
            renderAll();

            // La sesión pudo cambiar de rol o quedar inválida (auto-desactivación).
            if (getCurrentUser(getState())) {
                renderSessionChrome();
                ensureAllowedTab();
            } else {
                logout();
                showLogin();
            }
            toastSuccess(id
                ? `Usuario "${guardado.name}" actualizado.`
                : `Usuario "${guardado.name}" creado.`);
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (form.id === 'form-add-product') {
        try {
            const id = fieldValue('product-id');
            const data = {
                name: fieldValue('prod-name'),
                type: document.getElementById('prod-type').value,
                unit: document.getElementById('prod-unit').value,
                stock: parseFloat(fieldValue('prod-stock')),
                minStock: parseFloat(fieldValue('prod-min')),
                cost: parseFloat(fieldValue('prod-cost')),
                price: parseFloat(fieldValue('prod-price'))
            };
            const product = id ? updateProduct(id, data) : addProduct(data);
            closeModal('modal-product');
            toastSuccess(id
                ? `"${product.name}" actualizado en el inventario.`
                : `"${product.name}" agregado al inventario.`);
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (form.id === 'form-add-service') {
        try {
            const id = fieldValue('service-id');
            const data = {
                name: fieldValue('serv-name'),
                price: parseFloat(fieldValue('serv-price'))
            };
            const service = id ? updateService(id, data) : addService(data);
            closeModal('modal-service');
            toastSuccess(id
                ? `Servicio "${service.name}" actualizado.`
                : `Servicio "${service.name}" agregado al catálogo.`);
            renderServicesCards();
            renderCatalog();
            persist();
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (form.id === 'form-restock') {
        try {
            const amount = parseFloat(fieldValue('restock-amount'));
            const prod = restock(restockTargetId, amount);
            restockTargetId = null;
            closeModal('modal-restock');
            toastSuccess(`Stock de ${prod.name}: ${prod.stock} ${prod.unit}.`);
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
    }

    if (form.id === 'form-print-settings') {
        try {
            const st = getState().settings;
            st.ticket = st.ticket || {};
            st.ticket.printerWidth = Number(document.getElementById('ticket-width').value) === 80 ? 80 : 58;
            st.ticket.showPrices = !!document.getElementById('ticket-show-prices').checked;
            st.ticket.businessName = document.getElementById('ticket-business-name').value.trim().slice(0, 60) || st.ticket.businessName;
            st.ticket.businessLine = document.getElementById('ticket-business-line').value.trim().slice(0, 60);
            st.ticket.footer = document.getElementById('ticket-footer').value.trim().slice(0, 80);
            persist();
            toastSuccess('Ajustes de ticket guardados.');
            renderAll();
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (form.id === 'form-payment-method') {
        try {
            const res = saveMethod();
            persist();
            renderAll();
            toastSuccess(res.added
                ? `Método "${res.label}" agregado: ya aparece en el cobro del POS.`
                : `Método "${res.label}" actualizado.`);
        } catch (err) {
            toastError(err.message);
        }
        return;
    }

    if (form.id === 'form-commission') {
        try {
            const v = Number(document.getElementById('commission-rate').value);
            if (!Number.isFinite(v)) throw new Error('Escribe un porcentaje válido (0-100).');
            getState().settings.stylistCommissionRate = Math.min(100, Math.max(0, v));
            persist();
            renderAll();
            toastSuccess(`Comisión del estilista: ${getState().settings.stylistCommissionRate}%.`);
        } catch (err) {
            toastError(err.message);
        }
        return;
    }
    if (form.id === 'form-cash-open') {
        try {
            const fondo = toUSD(parseFloat(fieldValue('cash-open-fondo')), getState().settings.currency);
            openCashSession(fondo);
            closeModal('modal-cash-open');
            toastSuccess(`Caja abierta con fondo ${money(fondo)}.`);
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
    }

    if (form.id === 'form-cash-withdraw') {
        try {
            const monto = toUSD(parseFloat(fieldValue('cash-withdraw-amount')), getState().settings.currency);
            addWithdrawal(monto, fieldValue('cash-withdraw-note'));
            closeModal('modal-cash-withdraw');
            toastSuccess(`Retiro de ${money(monto)} registrado en caja.`);
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
    }

    if (form.id === 'form-cash-close') {
        try {
            const contado = toUSD(parseFloat(fieldValue('cash-close-contado')), getState().settings.currency);
            const corte = closeCashSession(contado);
            closeModal('modal-cash-close');
            const dif = corte.diferenciaUSD;
            if (Math.abs(dif) < 1e-9) {
                toastSuccess('Caja cerrada: el contado cuadra exacto.');
            } else if (dif < 0) {
                toastError(`Caja cerrada con faltante de ${money(Math.abs(dif))}.`);
            } else {
                toastSuccess(`Caja cerrada con sobrante de ${money(dif)}.`);
            }
            renderAll();
            persist();
        } catch (err) {
            toastError(err.message);
        }
    }
}

/* -------------------------------------------------------------- arranque -- */

function printTicket(tx) {
    if (!hasServices(tx)) {
        toastError('La venta no tiene servicios para imprimir en ticket de canje.');
        return;
    }
    const state = getState();
    const data = receiptTicketData(tx, state.settings);
    if (!data) {
        toastError('La venta no tiene servicios para imprimir en ticket de canje.');
        return;
    }
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = renderReceiptHtml(data);
    const style = document.createElement('style');
    style.setAttribute('data-print-ticket', 'true');
    style.textContent = '@page { size: ' + data.widthMM + 'mm auto; margin: 3mm; }';
    document.head.appendChild(style);
    const clean = () => {
        printArea.innerHTML = '';
        style.remove();
        window.removeEventListener('afterprint', clean);
    };
    window.addEventListener('afterprint', clean);
    setTimeout(clean, 10000);
    window.print();
}

function boot() {
    const { state, recovered } = loadState();
    replaceState(state);
    loadRatesCache(); // pinta la tasa guardada al instante; el fetch llega después
    applyTheme(); // reafirma el tema pre-paint con el settings real (y 'auto' resuelto)

    initModals();
    initMenu();
    initRateMenu();
    initCatalogDrag();

    if (recovered === 'corrupto') {
        toast('Los datos guardados estaban corruptos. Se respaldaron y se reinició el inventario.', 'danger', 6000);
    } else if (recovered === 'migrado') {
        toast('Datos actualizados a la nueva versión. La copia anterior se conservó como respaldo.', 'success', 5000);
    }

    renderCurrentDate();

    // Puerta de acceso: sin sesión válida, solo se ve la pantalla de login.
    const usuario = getCurrentUser(state);
    if (usuario) {
        showApp();
        renderSessionChrome();
        switchTab('dashboard');
    } else {
        showLogin();
    }

    renderStaffSelect();
    renderFilters();
    renderAll();

    // Revalida la tasa (si falla, el badge queda marcado como sin conexión).
    refreshRates().then(actualizada => {
        if (actualizada) renderAll();
        else renderHeader();
    }).catch(() => {});
    setInterval(() => {
        if (!isStale()) return;
        refreshRates()
            .then(actualizada => { if (actualizada) renderAll(); else renderHeader(); })
            .catch(() => {});
    }, STALE_CHECK_MS);

    // Si el tema es 'auto', re-aplica cuando el sistema cambia de claro a oscuro.
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (getState().settings.theme === 'auto') applyTheme();
    });

    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('submit', onSubmit);

    // Cierre de sesión por inactividad: cualquier gesto del usuario la renueva.
    for (const ev of ['click', 'keydown', 'touchstart']) {
        document.addEventListener(ev, touchActivity, { passive: true });
    }
    document.addEventListener('mousemove', () => {
        // No renovar en cada pixel: basta saber que sigue habiendo actividad.
        if (Date.now() - lastActivity > 5000) touchActivity();
    });
    setInterval(() => {
        if (!getCurrentUser(getState())) return;
        if (Date.now() - lastActivity < SESSION_IDLE_MS) return;
        logout();
        showLogin();
        toast('Sesión cerrada por inactividad.', 'info', 5000);
    }, IDLE_CHECK_MS);
}

boot();
