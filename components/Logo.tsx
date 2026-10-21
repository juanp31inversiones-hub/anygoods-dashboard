/** Logo AnyGoods; cambia a la versión blanca en modo oscuro. */
export function Logo({ className = "h-9" }: { className?: string }) {
  return (
    <picture>
      <source srcSet="/logo-white.png" media="(prefers-color-scheme: dark)" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="AnyGoods Wholesale" className={`${className} w-auto`} />
    </picture>
  );
}
