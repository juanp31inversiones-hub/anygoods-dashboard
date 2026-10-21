-- save_purchase_order: cada línea guarda su ubicación de llegada (lines[].location) y se puede editar.
-- Ver definición aplicada en la base de datos (igual a 0008 + location por línea y default 'own_warehouse').

-- Datos: PO1013 (Cleaning Heroes, 910 und) llegó al almacén del proveedor; 198 und se enviaron a FBA el 2-sep-2026.
do $$
declare v_ship uuid; v_prod uuid; v_line uuid := 'd5a9e3b1-cb26-481c-a4f1-61a31fdcb865';
begin
  select product_id into v_prod from purchase_order_lines where id = v_line;
  if v_prod is null then return; end if;
  update inventory_movements set location = 'supplier_warehouse' where po_line_id = v_line and movement = 'purchase';
  insert into fba_shipments (name, from_location, status, created_on, shipped_on, closed_on, carrier, notes)
  values ('Envío PO1013 · Cleaning Heroes Alcohol', 'supplier_warehouse', 'closed', '2026-09-02', '2026-09-02', '2026-09-02', 'amazon_partnered',
          'Registrado desde el Excel: 198 de 910 unidades de PO1013.')
  returning id into v_ship;
  insert into fba_shipment_items (shipment_id, product_id, qty_shipped, qty_received) values (v_ship, v_prod, 198, 198);
  insert into fba_shipment_costs (shipment_id, cost_type, description, amount, charged_to, allocation) values
    (v_ship, 'inbound_shipping', 'Amazon Transport (Excel)', 174.40, 'amazon_balance', 'units'),
    (v_ship, 'placement_fee', 'Amazon Inbound Placement (Excel)', 71.28, 'amazon_balance', 'units');
  insert into inventory_movements (product_id, movement, qty, location, occurred_on, reference, fba_shipment_id) values
    (v_prod, 'transfer', -198, 'supplier_warehouse', '2026-09-02', 'Envío PO1013', v_ship),
    (v_prod, 'transfer',  198, 'fba_inbound',        '2026-09-02', 'Envío PO1013', v_ship),
    (v_prod, 'transfer', -198, 'fba_inbound',        '2026-09-02', 'Envío PO1013', v_ship),
    (v_prod, 'transfer',  198, 'amazon_fba',         '2026-09-02', 'Envío PO1013', v_ship);
end $$;
