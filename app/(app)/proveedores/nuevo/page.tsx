import { CounterpartyForm } from "@/components/CounterpartyForm";
import { BackLink } from "@/components/ui";

export default function NuevoProveedor() {
  return (
    <div className="space-y-4 max-w-3xl">
      <BackLink href="/proveedores" label="Proveedores" />
      <h1 className="text-2xl font-semibold">Nuevo proveedor o contraparte</h1>
      <CounterpartyForm />
    </div>
  );
}
