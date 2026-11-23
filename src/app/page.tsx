import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LandingPage } from "@/features/marketing/landing-page";

export const metadata: Metadata = {
  title: { absolute: "Herald — one customer loop for every product you run" },
  description:
    "Feedback, roadmap, changelog, widget and win-back for each product under one flat account — plus a request brief your coding agent can turn into a ticket. One product free, five on Indie, unlimited on Professional.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Herald — one customer loop for every product you run",
    description:
      "Run several products from one account: public feedback, roadmap and changelog for each, with a Markdown request brief for your agent.",
    type: "website",
    url: "/",
  },
};

export default function HomePage(): ReactNode {
  return <LandingPage />;
}
