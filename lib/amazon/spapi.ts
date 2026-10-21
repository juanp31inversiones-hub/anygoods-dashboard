import "server-only";

/** Cliente mínimo de Amazon SP-API (región Norteamérica). Las credenciales vienen de variables de entorno de Vercel. */
const ENDPOINT = "https://sellingpartnerapi-na.amazon.com";
export const MARKETPLACE_ID = process.env.SPAPI_MARKETPLACE_ID || "ATVPDKIKX0DER";

export class SpApiError extends Error {
  constructor(message: string, public status?: number, public details?: unknown) {
    super(message);
  }
}

export function missingCredentials(): string[] {
  return ["SPAPI_CLIENT_ID", "SPAPI_CLIENT_SECRET", "SPAPI_REFRESH_TOKEN"].filter((k) => !process.env[k]);
}

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const missing = missingCredentials();
  if (missing.length) throw new SpApiError(`Faltan variables en Vercel: ${missing.join(", ")}`);
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.SPAPI_REFRESH_TOKEN!.trim(),
      client_id: process.env.SPAPI_CLIENT_ID!.trim(),
      client_secret: process.env.SPAPI_CLIENT_SECRET!.trim(),
    }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new SpApiError(
      `Amazon rechazó las credenciales (${res.status}): ${body.error_description ?? body.error ?? "sin detalle"}. Revisa Client ID, Client Secret y Refresh Token en Vercel.`,
      res.status, body,
    );
  }
  cached = { token: body.access_token, expires: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a SP-API con reintentos ante límite de velocidad (429) y errores temporales. */
export async function spGet<T = unknown>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]);
  const url = `${ENDPOINT}${path}${qs.size ? `?${qs}` : ""}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      headers: { "x-amz-access-token": await accessToken(), accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(Math.min(2000 * 2 ** attempt, 20_000));
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = body?.errors?.[0];
      const hint = res.status === 403
        ? " Verifica que la app tenga el rol correspondiente y esté autorizada en tu cuenta."
        : "";
      throw new SpApiError(`Amazon respondió ${res.status} en ${path}: ${err?.message ?? err?.code ?? "sin detalle"}.${hint}`, res.status, body);
    }
    return body as T;
  }
  throw new SpApiError(`Amazon siguió limitando las solicitudes a ${path}. Intenta de nuevo en unos minutos.`, 429);
}
