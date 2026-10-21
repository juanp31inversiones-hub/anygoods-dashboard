import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, date, money } from "@/lib/format";
import { PageHeader } from "@/components/ui";

type Txn = {
  id: string;
  txn_date: string;
  description: string;
  amount: number;
  category: string | null;
  notes: string | null;
  counterparty: { name: string } | null;
  partner: { short_name: string } | null;
  purchase_order: { invoice_number: string | null } | null;
};

export default async function Banco({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const { cat } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("bank_transactions")
    .select(
      "id, txn_date, description, amount, category, notes, counterparty:counterparties(name), partner:partners(short_name), purchase_order:purchase_orders(invoice_number)",
    )
    .order("txn_date", { ascending: false });
  if (cat) query = query.eq("category", cat);
  const { data } = await query.returns<Txn[]>();
  const rows = data ?? [];
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Banco" subtitle={`${rows.length} movimientos · neto ${money(total)}`} action={{ href: "/banco/nuevo", label: "Nuevo movimiento" }} />

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/banco" className="rounded-full px-3 py-1 border" style={{ borderColor: "var(--border)", fontWeight: cat ? 400 : 600 }}>
          Todas
        </Link>
        {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
          <Link
            key={k}
            href={`/banco?cat=${k}`}
            className="rounded-full px-3 py-1 border"
            style={{ borderColor: "var(--border)", fontWeight: cat === k ? 600 : 400 }}
          >
            {label}
          </Link>
        ))}
      </div>

      <section className="card overflow-x-auto">
        <table className="data">
          <thead>
            <tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Contraparte</th><th>PO</th><th className="num">Monto</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{date(r.txn_date)}</td>
                <td>
                  <Link href={`/banco/${r.id}`} className="link">{r.description}</Link>
                  {r.notes && <div className="muted text-xs mt-0.5">{r.notes}</div>}
                </td>
                <td className="whitespace-nowrap">{r.category ? CATEGORY_LABELS[r.category] ?? r.category : "—"}</td>
                <td>{r.partner?.short_name ?? r.counterparty?.name ?? "—"}</td>
                <td className="muted">{r.purchase_order?.invoice_number ?? ""}</td>
                <td className={`num ${Number(r.amount) < 0 ? "neg" : "pos"}`}>{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
