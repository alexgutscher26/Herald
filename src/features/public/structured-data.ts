import { absolutePublicUrl } from "./urls";

/** JSON-LD is embedded directly, so `<` must not be able to close the script. */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function softwareApplicationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Herald",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: absolutePublicUrl("/"),
    description:
      "Public feedback boards, roadmaps, changelogs, help, API documentation, an in-app widget and win-back campaigns for SaaS teams.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free plan with one product.",
    },
  };
}

export function articleSchema(input: {
  headline: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified?: string;
  authorNames: string[];
  imageUrl?: string | null;
  section?: string;
  keywords?: string[];
  publisherName: string;
}): Record<string, unknown> {
  const url = absolutePublicUrl(input.path);

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    author:
      input.authorNames.length > 0
        ? input.authorNames.map((name) => ({ "@type": "Person", name }))
        : { "@type": "Organization", name: input.publisherName },
    publisher: { "@type": "Organization", name: input.publisherName },
    ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
    ...(input.section ? { articleSection: input.section } : {}),
    ...(input.keywords && input.keywords.length > 0 ? { keywords: input.keywords } : {}),
  };
}

/**
 * Public help articles are the portal's question-and-answer content, so each
 * article contributes one visible question with its article text as the answer.
 */
export function faqPageSchema(input: {
  question: string;
  answer: string;
  path: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: absolutePublicUrl(input.path),
    mainEntity: [
      {
        "@type": "Question",
        name: input.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: input.answer,
        },
      },
    ],
  };
}

/** Markdown is stripped only for the schema's plain-text answer field. */
export function plainText(value: string, max = 5_000): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
