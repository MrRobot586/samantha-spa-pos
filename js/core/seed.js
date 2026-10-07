/* Datos iniciales (semilla). Se usan solo la primera vez que se abre la app
 * o si el localStorage no contiene nada válido. Es una fábrica: cada llamada
 * devuelve un objeto nuevo, para que dos tests no compartan referencias. */

import { hashPin } from './pin.js';

export function createSeedState() {
    return {
        users: [
            { id: 'u1', name: 'Administrador', username: 'admin', role: 'admin', pinHash: hashPin('1234', 'ss-admin'), salt: 'ss-admin', active: true, staffId: null },
            { id: 'u2', name: 'Valeria Gómez', username: 'valeria', role: 'stylist', pinHash: hashPin('1111', 'ss-valeria'), salt: 'ss-valeria', active: true, staffId: 'st1' },
            { id: 'u3', name: 'Carlos Mendoza', username: 'carlos', role: 'stylist', pinHash: hashPin('1111', 'ss-carlos'), salt: 'ss-carlos', active: true, staffId: 'st2' },
            { id: 'u4', name: 'Sofía López', username: 'sofia', role: 'stylist', pinHash: hashPin('1111', 'ss-sofia'), salt: 'ss-sofia', active: true, staffId: 'st3' }
        ],
        settings: {
            currency: 'USD',
            theme: 'auto',
            ticket: {
                printerWidth: 58,
                businessName: 'Samantha Spa',
                businessLine: 'Sucursal Principal',
                footer: '¡Gracias por su preferencia!',
                showPrices: true
            }
        },
        cashSession: { open: false, openedAt: null, fondoInicial: 0, withdrawals: [] },
        closures: [],
        staff: [
            { id: 'st1', name: 'Valeria Gómez', role: 'Colorista Senior', commissionRate: 50, totalCommissions: 0, salesCount: 0 },
            { id: 'st2', name: 'Carlos Mendoza', role: 'Barbero & Estilista', commissionRate: 45, totalCommissions: 0, salesCount: 0 },
            { id: 'st3', name: 'Sofia López', role: 'Especialista Capilar', commissionRate: 40, totalCommissions: 0, salesCount: 0 }
        ],
        products: [
            { id: 'p1', name: 'Tinte Rubio Ceniza 8.1', type: 'internal', unit: 'Gramos', stock: 500, minStock: 100, cost: 0.08, price: 0 },
            { id: 'p2', name: 'Peróxido 20 Vol', type: 'internal', unit: 'Mililitros', stock: 1500, minStock: 300, cost: 0.02, price: 0 },
            { id: 'p3', name: 'Shampoo Post-Color 250ml', type: 'sale', unit: 'Unidades', stock: 12, minStock: 4, cost: 8.5, price: 18 },
            { id: 'p4', name: 'Mascarilla Reparadora 500ml', type: 'sale', unit: 'Unidades', stock: 3, minStock: 5, cost: 14, price: 32 },
            { id: 'p5', name: 'Tratamiento Keratina Líquida', type: 'internal', unit: 'Mililitros', stock: 80, minStock: 150, cost: 0.25, price: 0 }
        ],
        services: [
            {
                id: 's1',
                name: 'Tinte Completo & Broshing',
                price: 65,
                recipe: [
                    { productId: 'p1', amount: 60 },
                    { productId: 'p2', amount: 90 }
                ]
            },
            {
                id: 's2',
                name: 'Tratamiento Intensivo Keratina',
                price: 85,
                recipe: [{ productId: 'p5', amount: 50 }]
            },
            {
                id: 's3',
                name: 'Corte Estilo & Peinado',
                price: 25,
                recipe: []
            }
        ],
        currentTicket: {
            items: [],
            staffId: 'st1',
            payments: []
        },
        transactions: [],
        posFilterCategory: 'all'
    };
}
