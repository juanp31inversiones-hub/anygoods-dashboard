# AnyGoods Dashboard

Control de compras, inventario, banco y números de AnyGoods LLC (Amazon FBA).

**Stack:** Next.js 15 (App Router) · Supabase (Postgres + Auth + RLS) · Tailwind · Vercel.

## Módulos
- **Resumen:** caja calculada, capital por socio, resultado operativo, flujo mensual, capital en manos de terceros (EC Access).
- **Compras:** órdenes de compra por proveedor con costo final por unidad (producto + fletes + fees de Amazon).
- **Inventario:** unidades en FBA y fuera de FBA, valorizadas a costo.
- **Banco:** movimientos de Mercury categorizados y enlazados a órdenes de compra.

## Acceso
Login con enlace mágico por email. Solo entran los correos registrados en `partners.email`;
el primer login vincula el usuario con su socio (`claim_partner()`).

## Base de datos
Migraciones en `supabase/migrations/`. Carga histórica desde los Excel con `scripts/import_excel.py`.

## Desarrollo
```bash
npm install
npm run dev
```
Variables opcionales en `.env.example` (los valores por defecto apuntan al proyecto de producción).
