import { createClient } from "@/lib/supabase/server";
import { money, units } from "@/lib/format";

export default async function Inventario() {
  const supabase = await createClient();
  const { data } = await supabase.from("v_inventory_on_hand").select("*").order("inventory_value", { ascending: false });
  const rows = data ?? [];
  const total = rows.reduce((a, r) => a + Number(r.inventory_value), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventario</h1>
        <p className="muted text-sm">
          Valor a costo final: {money(total)}. Aún no descuenta ventas: se actualizará al importar los reportes de Amazon.
        </p>
      </div>
      <section className="card overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>Producto</th><th>ASIN</th><th>UPC</th>
              <th className="num">En FBA</th><th className="num">Fuera de FBA</th><th className="num">Total</th>
              <th className="num">Precio Amazon</th><th className="num">Valor a costo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product_id}>
                <td>{r.description}</td>
                <td className="muted">{r.asin ?? "—"}</td>
                <td className="muted">{r.upc ?? "—"}</td>
                <td className="num">{units(r.units_fba)}</td>
                <td className="num">{units(r.units_other)}</td>
                <td className="num">{units(r.units_on_hand)}</td>
                <td className="num">{r.retail_price ? money(r.retail_price) : "—"}</td>
                <td className="num">{money(r.inventory_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
