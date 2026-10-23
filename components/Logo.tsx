/** Logo AnyGoods en blanco (la app usa fondo negro). */
export function Logo({ className = "h-9" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo-white.png" alt="AnyGoods Wholesale" className={`${className} w-auto`} />;
}
