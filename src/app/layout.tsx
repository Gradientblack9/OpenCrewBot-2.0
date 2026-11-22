import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenCrewBot 2.0",
  description: "Coordinate your AI agents, review actions, and track work from plan to report.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#111111",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions often add attributes to <html> before React loads;
    // this keeps that from being reported as a hydration mismatch.
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
