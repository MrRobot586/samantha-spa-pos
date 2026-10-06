/* Estado en memoria de la app. Módulo sin DOM: lo importan el dominio (que
 * lee y muta) y la UI (que lee), y es testeable en node puro.
 *
 * No hay sistema de suscripciones: la UI se re-pinta de forma explícita
 * después de cada acción (renderAll), que es todo lo que necesita esta app.
 */

import { createSeedState } from './seed.js';

let state = createSeedState();

export function getState() {
    return state;
}

/** Reemplaza el estado completo (arranque y cargas desde storage). */
export function replaceState(next) {
    state = next;
}

/** Reinicia a la semilla. Se expone para tests. */
export function resetState() {
    state = createSeedState();
    return state;
}
