import { redirect } from "next/navigation";

// El envío a Amazon ahora vive en el módulo Envíos FBA.
export default async function EnvioAmazon({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { product } = await searchParams;
  redirect(product ? `/envios/nuevo?product=${product}` : "/envios/nuevo");
}
