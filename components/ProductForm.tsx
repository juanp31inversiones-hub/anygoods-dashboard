"use client";

import { useActionState, useState } from "react";
import { saveProduct, type ActionState } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";
import { Field } from "@/components/ui";
import { FormError, SubmitButton } from "@/components/forms";

export type Product = {
  id: string;
  description: string;
  brand: string | null;
  asin: string | null;
  upc: string | null;
  sku: string | null;
  units_per_case: number | null;
  retail_price: number | null;
  image_url: string | null;
  notes: string | null;
  active: boolean;
};

export function ProductForm({ product }: { product?: Product }) {
  const [state, action] = useActionState<ActionState, FormData>(saveProduct, undefined);
  const [image, setImage] = useState(product?.image_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setUploadError("La imagen debe pesar menos de 5 MB.");
    setUploading(true);
    setUploadError("");
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;
    const supabase = createClient();
    const { error } = await supabase.storage.from("product-images").upload(path, file, { contentType: file.type });
    setUploading(false);
    if (error) return setUploadError(error.message);
    setImage(supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl);
  }

  return (
    <form action={action} className="card p-5 space-y-5">
      <input type="hidden" name="id" value={product?.id ?? ""} />
      <input type="hidden" name="image_url" value={image} />

      <div className="flex flex-col sm:flex-row gap-5">
        <div className="shrink-0">
          <div className="w-36 h-36 rounded-lg border flex items-center justify-center overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="w-full h-full object-contain" />
            ) : (
              <span className="muted text-xs">Sin imagen</span>
            )}
          </div>
          <label className="btn-ghost mt-2 w-36 cursor-pointer text-xs">
            {uploading ? "Subiendo…" : image ? "Cambiar imagen" : "Subir imagen"}
            <input type="file" accept="image/*" onChange={onFile} className="hidden" />
          </label>
          {image && (
            <button type="button" onClick={() => setImage("")} className="muted text-xs underline mt-1 block">Quitar imagen</button>
          )}
          {uploadError && <p className="neg text-xs mt-1 w-36">{uploadError}</p>}
        </div>

        <div className="grid sm:grid-cols-2 gap-4 flex-1">
          <Field label="Descripción *" className="sm:col-span-2">
            <input name="description" required defaultValue={product?.description} className="input" />
          </Field>
          <Field label="Marca"><input name="brand" defaultValue={product?.brand ?? ""} className="input" /></Field>
          <Field label="ASIN"><input name="asin" defaultValue={product?.asin ?? ""} className="input" placeholder="B0..." /></Field>
          <Field label="UPC"><input name="upc" defaultValue={product?.upc ?? ""} className="input" /></Field>
          <Field label="SKU"><input name="sku" defaultValue={product?.sku ?? ""} className="input" /></Field>
          <Field label="Unidades por caja"><input name="units_per_case" type="number" min="1" defaultValue={product?.units_per_case ?? ""} className="input" /></Field>
          <Field label="Precio en Amazon (USD)"><input name="retail_price" type="number" step="0.01" min="0" defaultValue={product?.retail_price ?? ""} className="input" /></Field>
          <Field label="Notas" className="sm:col-span-2">
            <textarea name="notes" rows={2} defaultValue={product?.notes ?? ""} className="input" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={product?.active ?? true} /> Activo
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        <FormError state={state} />
      </div>
    </form>
  );
}
