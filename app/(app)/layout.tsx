import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Vincula el login con el socio por email la primera vez.
  const { data: isPartner } = await supabase.rpc("claim_partner");

  return (
    <>
      <Nav email={user.email ?? ""} />
      <main className="mx-auto max-w-6xl px-4 py-6">
        {isPartner ? (
          children
        ) : (
          <div className="card p-6 max-w-lg">
            <h2 className="font-semibold">Acceso pendiente</h2>
            <p className="muted text-sm mt-2">
              El correo <strong>{user.email}</strong> no tiene acceso a AnyGoods Dashboard. Pide a un
              administrador que lo agregue.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
