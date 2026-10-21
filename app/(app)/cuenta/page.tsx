import { createClient } from "@/lib/supabase/server";
import { PasswordForm } from "@/components/PasswordForm";

export default async function Cuenta() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <div className="space-y-4 max-w-md">
      <h1 className="text-2xl font-semibold">Mi cuenta</h1>
      <p className="muted text-sm">{user?.email}</p>
      <PasswordForm />
    </div>
  );
}
