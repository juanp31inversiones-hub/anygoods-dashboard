"use client";

import { useActionState, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Plus } from "lucide-react";
import { saveTransaction, type ActionState } from "@/lib/actions";
import { CATEGORY_LABELS } from "@/lib/format";
import { Field } from "@/components/ui";
import { FormError, SubmitButton } from "@/components/forms";

type Option = { id: string; name: string };
type Counterparty = { id: string; name: string; kind?: string };
export type CustomCategory = { key: string; label: string; direction: "in" | "out" };
export type Txn = {
  id: string;
  bank_account_id: string;
  txn_date: string;
  description: string;
  amount: number;
  category: string | null;
  counterparty_id: string | null;
  partner_id: string | null;
  purchase_order_id: string | null;
  notes: string | null;
};

/** Categorías que tienen sentido según si entra o sale plata (las más usadas primero). */
const CATS = {
  out: ["inventory", "shipping", "fees", "software", "legal", "service_fee", "other_expense", "capital_return", "transfer"],
  in: ["amazon_payout", "other_sales", "capital_contribution", "transfer"],
};
const PARTNER_CATS = ["capital_contribution", "capital_return"];
const NO_WHO = ["amazon_payout", "transfer", "fees", ...PARTNER_CATS];

export function TxnForm({ txn, accounts, counterparties, partners, purchaseOrders, customCategories = [], recentCounterparties = [] }: {
  txn?: Txn;
  accounts: Option[];
  counterparties: Counterparty[];
  partners: { id: string; short_name: string }[];
  purchaseOrders: (Option & { supplier_id?: string | null })[];
  customCategories?: CustomCategory[];
  recentCounterparties?: string[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveTransaction, undefined);
  const [direction, setDirection] = useState<"out" | "in">(txn && Number(txn.amount) > 0 ? "in" : "out");
  const [category, setCategory] = useState(txn?.category ?? "");
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [partner, setPartner] = useState(txn?.partner_id ?? "");
  // "¿A quién?": se elige de una lista (evita escribir "Google" distinto cada vez); "__new" = agregar uno nuevo
  const [whoId, setWhoId] = useState(txn?.counterparty_id ?? "");
  const [newWho, setNewWho] = useState("");
  const [po, setPo] = useState(txn?.purchase_order_id ?? "");
  const [description, setDescription] = useState(txn?.description ?? "");

  const labelOf = (k: string) => CATEGORY_LABELS[k] ?? customCategories.find((c) => c.key === k)?.label ?? k;
  const cats = [...CATS[direction], ...customCategories.filter((c) => c.direction === direction).map((c) => c.key)];
  const needsPartner = PARTNER_CATS.includes(category);
  const needsWho = !NO_WHO.includes(category);
  const whoMatch = counterparties.find((c) => c.id === whoId);
  const who = whoMatch?.name ?? (whoId === "__new" ? newWho : "");
  const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  // Si el nombre nuevo se parece a uno que ya existe, se sugiere usar ese
  const similar = whoId === "__new" && norm(newWho).length >= 3
    ? counterparties.find((c) => norm(c.name).includes(norm(newWho)) || norm(newWho).includes(norm(c.name)))
    : undefined;
  const recent = recentCounterparties.map((id) => counterparties.find((c) => c.id === id)).filter(Boolean) as Counterparty[];
  const supplierPos = purchaseOrders.filter((p) => !whoMatch || !p.supplier_id || p.supplier_id === whoMatch.id);
  const partnerName = partners.find((p) => p.id === partner)?.short_name;
  // Si no escriben descripción, se arma sola: "Aporte socio · Juan Pedro", "Inventario · Cleaning Heroes"
  const auto = [newCategory || (category ? labelOf(category) : direction === "out" ? "Salida" : "Entrada"), needsPartner ? partnerName : who.trim()]
    .filter(Boolean).join(" · ");
  const chip = (active: boolean) => (active
    ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 }
    : { borderColor: "var(--border)" });

  return (
    <form action={action} className="card p-4 sm:p-5 space-y-5">
      <input type="hidden" name="id" value={txn?.id ?? ""} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="category" value={newCategory === null ? category : ""} />
      <input type="hidden" name="new_category" value={newCategory ?? ""} />
      <input type="hidden" name="partner_id" value={needsPartner ? partner : ""} />
      <input type="hidden" name="counterparty_id" value={needsWho && whoMatch ? whoMatch.id : category === "amazon_payout" || category === "fees" ? counterparties.find((c) => c.name === "Amazon")?.id ?? "" : ""} />
      <input type="hidden" name="counterparty_name" value={needsWho && whoId === "__new" ? newWho.trim() : ""} />
      <input type="hidden" name="auto_description" value={auto} />

      {/* 1. ¿Entra o sale? */}
      <div className="grid grid-cols-2 gap-2">
        {([["out", "Salida", "Pago o gasto", ArrowUpRight, "var(--neg)", "var(--neg-soft)"], ["in", "Entrada", "Ingreso o aporte", ArrowDownLeft, "var(--pos)", "var(--pos-soft)"]] as const)
          .map(([key, label, hint, Icon, color, soft]) => (
            <button key={key} type="button" onClick={() => { setDirection(key); setNewCategory(null); if (!CATS[key].includes(category)) setCategory(""); }}
              className="rounded-xl border-2 p-3 text-left"
              style={direction === key ? { borderColor: color, background: soft } : { borderColor: "var(--border)" }}>
              <span className="flex items-center gap-1.5 font-semibold" style={{ color: direction === key ? color : undefined }}><Icon size={18} /> {label}</span>
              <span className="muted text-xs">{hint}</span>
            </button>
          ))}
      </div>

      {/* 2. Monto */}
      <label className="block">
        <span className="label">Monto</span>
        <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: "var(--border)" }}>
          <span className="text-2xl muted">$</span>
          <input name="amount" type="text" inputMode="decimal" autoComplete="off" required placeholder="0.00"
            defaultValue={txn ? Math.abs(Number(txn.amount)) : ""} className="w-full bg-transparent text-3xl font-semibold py-2 outline-none tabular-nums" />
        </div>
      </label>

      {/* 3. Categoría (o una nueva) */}
      <div>
        <span className="label">Categoría</span>
        <div className="flex flex-wrap gap-2">
          {cats.map((k) => (
            <button key={k} type="button" onClick={() => { setNewCategory(null); setCategory(category === k ? "" : k); }}
              className="rounded-full border px-3 py-1.5 text-sm" style={chip(newCategory === null && category === k)}>
              {labelOf(k)}
            </button>
          ))}
          <button type="button" onClick={() => { setCategory(""); setNewCategory(newCategory === null ? "" : null); }}
            className="rounded-full border border-dashed px-3 py-1.5 text-sm inline-flex items-center gap-1" style={chip(newCategory !== null)}>
            <Plus size={14} /> Nueva
          </button>
        </div>
        {newCategory !== null && (
          <input autoFocus value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Nombre de la categoría (ej: Contabilidad)"
            className="input mt-2" required />
        )}
      </div>

      {/* 4. ¿De quién / a quién? (según la categoría) */}
      {needsPartner && (
        <div>
          <span className="label">{category === "capital_contribution" ? "¿Qué socio hizo el aporte?" : "¿A qué socio se le devolvió?"}</span>
          <div className="flex flex-wrap gap-2">
            {partners.map((p) => (
              <button key={p.id} type="button" onClick={() => setPartner(p.id)} className="rounded-full border px-3 py-1.5 text-sm" style={chip(partner === p.id)}>
                {p.short_name}
              </button>
            ))}
          </div>
        </div>
      )}
      {needsWho && (
        <Field label={direction === "out" ? (category === "inventory" ? "¿A qué proveedor?" : "¿A quién se le pagó?") : "¿Quién te pagó?"}>
          <select value={whoId} onChange={(e) => setWhoId(e.target.value)} className="input">
            <option value="">Elegir…</option>
            {recent.length > 0 && (
              <optgroup label="Recientes">
                {recent.map((c) => <option key={`r-${c.id}`} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
            <optgroup label="Todos">
              {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
            <option value="__new">+ Agregar uno nuevo…</option>
          </select>
          {whoId === "__new" && (
            <div className="mt-2 space-y-1">
              <input autoFocus value={newWho} onChange={(e) => setNewWho(e.target.value)} placeholder="Nombre (ej: Google)" className="input" />
              {similar ? (
                <button type="button" onClick={() => setWhoId(similar.id)} className="text-xs link">
                  Ya existe “{similar.name}”. Toca aquí para usarlo
                </button>
              ) : newWho.trim() ? <span className="muted text-xs">Se creará “{newWho.trim()}” al guardar.</span> : null}
            </div>
          )}
        </Field>
      )}
      {category === "inventory" && direction === "out" && (
        <Field label="¿De qué compra? (opcional)">
          <select name="purchase_order_id" value={po} onChange={(e) => setPo(e.target.value)} className="input">
            <option value="">—</option>
            {supplierPos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      {!(category === "inventory" && direction === "out") && <input type="hidden" name="purchase_order_id" value={po} />}

      {/* 5. Fecha, cuenta y descripción */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha"><input type="date" name="txn_date" required defaultValue={txn?.txn_date ?? new Date().toISOString().slice(0, 10)} className="input" /></Field>
        {accounts.length > 1 ? (
          <Field label="Cuenta">
            <select name="bank_account_id" required defaultValue={txn?.bank_account_id ?? accounts[0]?.id} className="input">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        ) : (
          <div><span className="label">Cuenta</span><div className="py-2 text-sm">{accounts[0]?.name}</div><input type="hidden" name="bank_account_id" value={txn?.bank_account_id ?? accounts[0]?.id} /></div>
        )}
      </div>
      <Field label="Descripción (opcional)" hint={!description ? `Si la dejas vacía: “${auto}”` : undefined}>
        <input name="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={auto} className="input" />
      </Field>
      <Field label="Notas (opcional)"><textarea name="notes" rows={2} defaultValue={txn?.notes ?? ""} className="input" /></Field>

      <div className="flex items-center gap-3">
        <SubmitButton label={txn ? "Guardar cambios" : direction === "out" ? "Registrar salida" : "Registrar entrada"} />
        <FormError state={state} />
      </div>
    </form>
  );
}
