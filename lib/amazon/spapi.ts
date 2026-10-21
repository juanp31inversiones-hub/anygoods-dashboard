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

/** Revisa el formato de las credenciales sin revelar su valor. */
export function credentialDiagnostics(): string[] {
  const issues: string[] = [];
  const raw = {
    id: process.env.SPAPI_CLIENT_ID ?? "",
    secret: process.env.SPAPI_CLIENT_SECRET ?? "",
    token: process.env.SPAPI_REFRESH_TOKEN ?? "",
  };
  const v = { id: raw.id.trim(), secret: raw.secret.trim(), token: raw.token.trim() };
  const quoted = (x: string) => /^["']|["']$/.test(x);
  const shape = (x: string) => `empieza por "${x.slice(0, 6)}…", ${x.length} caracteres`;
  if (v.id.startsWith("amzn1.sp.solution")) issues.push("SPAPI_CLIENT_ID tiene el App ID (amzn1.sp.solution…). Debe ser el Client identifier de las credenciales LWA (amzn1.application-oa2-client…).");
  else if (!v.id.startsWith("amzn1.application-oa2-client.")) issues.push(`SPAPI_CLIENT_ID no tiene el formato esperado (amzn1.application-oa2-client.…): ${shape(v.id)}.`);
  if (v.secret.startsWith("amzn1.application-oa2-client.")) issues.push("SPAPI_CLIENT_SECRET contiene el Client ID: parecen intercambiados.");
  else if (!v.secret.startsWith("amzn1.oa2-cs.v1.")) issues.push(`SPAPI_CLIENT_SECRET no tiene el formato esperado (amzn1.oa2-cs.v1.…): ${shape(v.secret)}.`);
  if (!v.token.startsWith("Atzr|")) issues.push(`SPAPI_REFRESH_TOKEN no empieza por "Atzr|": ${shape(v.token)}.`);
  for (const [k, x] of Object.entries(raw)) {
    if (quoted(x.trim())) issues.push(`La variable ${k === "id" ? "SPAPI_CLIENT_ID" : k === "secret" ? "SPAPI_CLIENT_SECRET" : "SPAPI_REFRESH_TOKEN"} tiene comillas: quítalas.`);
    if (/\s/.test(x.trim())) issues.push(`La variable ${k === "id" ? "SPAPI_CLIENT_ID" : k === "secret" ? "SPAPI_CLIENT_SECRET" : "SPAPI_REFRESH_TOKEN"} tiene espacios o saltos de línea en medio.`);
  }
  return issues;
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
    const diag = credentialDiagnostics();
    const cause = body.error === "invalid_client"
      ? "Amazon no reconoce el Client ID + Client Secret (el Refresh Token no es el problema)."
      : body.error === "invalid_grant"
        ? "El Refresh Token no es válido para este Client ID (vuelve a autorizar la app y copia el nuevo token)."
        : "";
    throw new SpApiError(
      `Amazon rechazó las credenciales (${res.status} ${body.error ?? ""}): ${body.error_description ?? "sin detalle"}. ${cause} ` +
      (diag.length ? `Diagnóstico: ${diag.join(" ")}` : "El formato de las 3 variables se ve correcto; vuelve a copiar el Client Secret desde Seller Central (puede haberse copiado incompleto o haber sido regenerado)."),
      res.status, body,
    );
  }
  cached = { token: body.access_token, expires: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Si producción responde 403, prueba el entorno de pruebas para saber si la app quedó registrada como sandbox. */
export async function isSandboxApp(): Promise<boolean> {
  try {
    const res = await fetch("https://sandbox.sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations", {
      headers: { "x-amz-access-token": await accessToken(), accept: "application/json" },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
