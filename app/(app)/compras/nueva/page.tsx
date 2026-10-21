import { createClient } from "@/lib/supabase/server";
import { formOptions } from "@/lib/queries";
import { POForm } from "@/components/POForm";
import { BackLink } from "@/components/ui";

export default async function NuevaCompra() {
  const opts = await formOptions(await createClient());
  return (
    <div className="space-y-4">
      <BackLink href="/compras" label="Compras" />
      <h1 className="text-2xl font-semibold">Nueva orden de compra</h1>
      <POForm suppliers={opts.counterparties} products={opts.products.filter((p) => p.active)} />
    </div>
  );
}
