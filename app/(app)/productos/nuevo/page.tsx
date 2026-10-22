import { ProductForm } from "@/components/ProductForm";
import { BackLink } from "@/components/ui";

export default function NuevoProducto() {
  return (
    <div className="space-y-4 max-w-3xl">
      <BackLink href="/productos" label="Productos" />
      <h1 className="text-xl md:text-2xl font-semibold">Nuevo producto</h1>
      <ProductForm />
    </div>
  );
}
