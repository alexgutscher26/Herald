import { Archivo, Inter } from "next/font/google";

/**
 * Shared app typography.
 *
 * Archivo carries display headings (marketing and dashboard titles) and Inter
 * carries interface text. Loading both here keeps one self-hosted copy for the
 * whole app; `src/app/layout.tsx` exposes them as CSS variables so client
 * portals (dialogs, menus) resolve the same fonts as the page.
 */
export const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-archivo",
  display: "swap",
});

export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
