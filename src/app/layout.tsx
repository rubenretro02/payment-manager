import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { TelegramProvider } from "@/components/providers/TelegramProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PayManager - Gestión de Pagos",
  description: "Sistema de gestión de pagos para agentes de LiveOps, Arise, Omni Interactions",
};

// App-like viewport: no pinch/double-tap zoom, and viewport-fit=cover so the
// env(safe-area-inset-*) values are populated in Telegram's fullscreen mode.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TelegramProvider>
          <AuthProvider>
            <PullToRefresh />
            {children}
            <Toaster position="top-right" />
          </AuthProvider>
        </TelegramProvider>
      </body>
    </html>
  );
}
