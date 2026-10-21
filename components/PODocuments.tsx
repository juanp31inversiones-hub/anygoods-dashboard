"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Download, FileText, Paperclip, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DOC_TYPE_LABELS } from "@/lib/format";

export type PODocument = { id: string; doc_type: string; file_path: string; file_name: string; size_bytes: number | null; created_at: string };

const BUCKET = "po-documents";
const kb = (n: number | null) => (n ? (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`) : "");

export function PODocuments({ poId, docs }: { poId: string; docs: PODocument[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function upload(docType: string, files: FileList | null) {
    if (!files?.length) return;
    setError("");
    setBusy(docType);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) { setError(`${file.name}: máximo 20 MB.`); continue; }
      const safe = file.name.normalize("NFD").replace(/[^\w.\-]+/g, "_");
      const path = `${poId}/${docType}/${crypto.randomUUID()}-${safe}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (up.error) { setError(up.error.message); continue; }
      const ins = await supabase.from("po_documents").insert({
        purchase_order_id: poId, doc_type: docType, file_path: path, file_name: file.name, size_bytes: file.size, content_type: file.type,
      });
      if (ins.error) { await supabase.storage.from(BUCKET).remove([path]); setError(ins.error.message); }
    }
    setBusy(null);
    router.refresh();
  }

  async function open(doc: PODocument) {
    const { data, error } = await createClient().storage.from(BUCKET).createSignedUrl(doc.file_path, 60);
    if (error || !data) return setError(error?.message ?? "No se pudo abrir el archivo.");
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function remove(doc: PODocument) {
    if (!confirm(`¿Eliminar ${doc.file_name}?`)) return;
    setBusy(doc.id);
    const supabase = createClient();
    const del = await supabase.from("po_documents").delete().eq("id", doc.id);
    if (del.error) setError(del.error.message);
    else await supabase.storage.from(BUCKET).remove([doc.file_path]);
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold flex items-center gap-2"><Paperclip size={18} /> Documentos de la compra</h2>
        <p className="muted text-xs mt-0.5">PDF, imágenes o Excel hasta 20 MB. Solo los usuarios de AnyGoods pueden verlos.</p>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
        {Object.entries(DOC_TYPE_LABELS).map(([type, label]) => {
          const list = docs.filter((d) => d.doc_type === type);
          const required = type !== "other";
          return (
            <div key={type} className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: list.length || !required ? "var(--border)" : "var(--warn)" }}>
              <div className="flex items-start gap-2 text-sm font-medium">
                {list.length ? <CheckCircle2 size={16} className="pos shrink-0 mt-0.5" /> : <Circle size={16} className="muted shrink-0 mt-0.5" />}
                {label}
              </div>
              {list.map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-xs rounded-md px-2 py-1.5" style={{ background: "var(--bg)" }}>
                  <FileText size={14} className="shrink-0 muted" />
                  <button type="button" onClick={() => open(d)} className="link truncate text-left flex-1" title={d.file_name}>{d.file_name}</button>
                  <span className="muted shrink-0">{kb(d.size_bytes)}</span>
                  <button type="button" onClick={() => open(d)} aria-label="Descargar" className="muted"><Download size={14} /></button>
                  <button type="button" onClick={() => remove(d)} aria-label="Eliminar" className="neg" disabled={busy === d.id}><Trash2 size={14} /></button>
                </div>
              ))}
              <label className="btn-ghost text-xs cursor-pointer mt-auto">
                {busy === type ? "Subiendo…" : list.length ? "+ Agregar otro" : "Subir archivo"}
                <input type="file" multiple className="hidden" accept=".pdf,image/*,.xlsx,.xls,.csv,.doc,.docx" onChange={(e) => { upload(type, e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          );
        })}
      </div>
      {error && <p className="neg text-sm">{error}</p>}
    </section>
  );
}
