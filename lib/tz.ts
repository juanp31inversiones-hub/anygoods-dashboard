/**
 * Amazon US cuenta los días en hora del Pacífico (America/Los_Angeles, con horario de verano),
 * aunque la app del celular muestre la hora local. Todas las fechas de Amazon se agrupan así.
 */
export const AMAZON_TZ = "America/Los_Angeles";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: AMAZON_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: AMAZON_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** Día (YYYY-MM-DD) de una fecha según Amazon. */
export const amazonDay = (d: string | number | Date) => dayFmt.format(new Date(d));

/** Diferencia en ms entre la hora del Pacífico y UTC en ese instante (negativa). */
function offsetAt(ms: number) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** Instante UTC (ms) en que empieza un día (YYYY-MM-DD) según Amazon. */
export function amazonDayStart(day: string) {
  const naive = Date.parse(`${day}T00:00:00Z`);
  return naive - offsetAt(naive - offsetAt(naive));
}

/** Suma días a un YYYY-MM-DD. */
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
