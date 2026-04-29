// Tipos compartidos entre componentes de GENESIS.
// Un "type" en TypeScript define exactamente qué valores puede tener una variable.
// Si intentas asignar algo distinto, TypeScript avisa con un error antes de ejecutar.

// Las 6 vistas posibles de la aplicación.
// El | significa "o" — Vista puede ser cualquiera de estos strings.
export type Vista = 'hoy' | 'calendario' | 'recordatorios' | 'horarios' | 'chat' | 'ajustes'
