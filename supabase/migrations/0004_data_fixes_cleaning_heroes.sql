-- Correcciones confirmadas por los socios (oct-2026).
-- Ya aplicado vía SQL: EC Access initiation fee -> service_fee; POs 2025 pagadas vía EC Access;
-- cargo Amazon dic-2025 -> fees; línea PO 2801 = 712 und a 5.50 (landed 5.8451).

-- Cleaning Heroes 2801: una compra de 712 und. 198 enviadas a FBA, 514 en almacén del proveedor.
update purchase_orders
set status = 'received',
    notes = '712 und compradas. 198 enviadas a FBA; 514 en almacen del proveedor. Diferencia de 84 USD entre lo pagado y el producto, por confirmar.'
where invoice_number = '2801';

update inventory_movements
set qty = 712, location = 'supplier_warehouse'
where movement = 'purchase'
  and po_line_id = (select l.id from purchase_order_lines l join purchase_orders po on po.id = l.purchase_order_id where po.invoice_number = '2801');

insert into inventory_movements (product_id, po_line_id, movement, qty, occurred_on, location, reference)
select l.product_id, l.id, 'transfer', x.qty, '2026-09-02', x.loc, 'Envio FBA (Amazon Shipment 2-sep-2026)'
from purchase_order_lines l
join purchase_orders po on po.id = l.purchase_order_id
cross join (values (-198, 'supplier_warehouse'), (198, 'amazon_fba')) x(qty, loc)
where po.invoice_number = '2801';

update bank_transactions
set purchase_order_id = (select id from purchase_orders where invoice_number = '2801')
where external_id in ('xls-ig-131', 'xls-ig-132');
