/* Descarga de CSV en el navegador (sin dependencias).
 * buildCsv vive en core/utils (puro, testeable); aquí solo el Blob + <a>. */

import { buildCsv } from '../core/utils.js';

/** Dispara la descarga de un CSV. La marca de orden de bytes hace que Excel abra UTF-8 bien. */
export function downloadCsv(filename, rows) {
    const blob = new Blob(['\uFEFF' + buildCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}