import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AnyGoods · Panel FBA",
  description: "Compras, inventario, banco y números de AnyGoods LLC",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AnyGoods", statusBarStyle: "black" },
  icons: { icon: "/icon.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
