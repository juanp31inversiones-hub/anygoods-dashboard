import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Nav";
import { Flash } from "@/components/Flash";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Vincula el login con la lista de acceso por email la primera vez.
  const { data: isMember } = await supabase.rpc("claim_partner");

  return (
    <div className="md:flex min-h-screen">
      <Sidebar email={user.email ?? ""} />
      <main className="flex-1 min-w-0 px-4 md:px-8 py-6 max-w-7xl">
        {isMember ? (
          children
        ) : (
          <div className="card p-6 max-w-lg">
            <h2 className="font-semibold">Acceso pendiente</h2>
            <p className="muted text-sm mt-2">
              El correo <strong>{user.email}</strong> no tiene acceso a AnyGoods Dashboard. Pide a un administrador que lo agregue.
            </p>
          </div>
        )}
      </main>
      <Suspense><Flash /></Suspense>
    </div>
  );
}
