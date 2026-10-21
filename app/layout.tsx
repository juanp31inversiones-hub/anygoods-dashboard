import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AnyGoods Dashboard",
  description: "Compras, inventario, banco y números de AnyGoods LLC",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
