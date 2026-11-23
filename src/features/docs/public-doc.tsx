import { readFileSync } from "node:fs";
import path from "node:path";

import { Markdown } from "@/components/shared/markdown";
import { MarketingPage } from "@/features/marketing/marketing-chrome";

/**
 * A repository Markdown guide published as a public page.
 *
 * The file in `docs/` stays the single source: it is read at build time, so the
 * published copy cannot drift from the one the team edits, and the page ships
 * as static HTML with no runtime filesystem access.
 */
export function readGuide(relativePath: string): string {
  // The `docs` segment must be a literal in `path.join`: Turbopack traces a
  // dynamic prefix as the whole project, which copies every source file and
  // asset into the server output.
  return readFileSync(
    path.join(process.cwd(), "docs", relativePath.replace(/^docs\//, "")),
    "utf8",
  ).replace(/^#\s+.*\r?\n+/, "");
}

export function PublicDoc({
  file,
  eyebrow,
  title,
  intro,
}: {
  file: string;
  eyebrow: string;
  title: string;
  intro: string;
}) {
  return (
    <MarketingPage eyebrow={eyebrow} title={title} intro={intro}>
      <section className="border-b border-[#dedad2]">
        <div className="mx-auto w-full max-w-[820px] px-5 py-12 sm:px-8 lg:py-16">
          <Markdown className="text-[15px] leading-[1.7]">{readGuide(file)}</Markdown>
        </div>
      </section>
    </MarketingPage>
  );
}
