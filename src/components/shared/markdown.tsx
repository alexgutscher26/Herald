import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Markdown rendered as React elements (no `dangerouslySetInnerHTML`), with raw
 * HTML disabled by default. The same renderer powers editor previews, public
 * previews and widget previews so they cannot drift.
 */
export function Markdown({
  children,
  className,
  skipHtml = false,
}: {
  children: string;
  className?: string;
  /** Drop raw HTML instead of showing its tags as text. */
  skipHtml?: boolean;
}) {
  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml={skipHtml}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {linkChildren}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
