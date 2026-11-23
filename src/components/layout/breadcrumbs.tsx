"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { getNavItems } from "@/components/layout/nav-items";

type BreadcrumbsProps = {
  workspaceSlug: string;
  workspaceName: string;
  productSlug: string;
  productName: string;
};

export function Breadcrumbs({
  workspaceSlug,
  workspaceName,
  productSlug,
  productName,
}: BreadcrumbsProps) {
  const pathname = usePathname();
  const base = `/app/${workspaceSlug}/${productSlug}`;
  // Include unbuilt sections so a direct URL still names the page it is on,
  // even though that section is absent from the primary navigation.
  const items = getNavItems(workspaceSlug, productSlug, {
    includeUnavailable: true,
  });

  const current =
    pathname === base
      ? items[0]
      : items.find(
          (item) =>
            item.segment !== "" &&
            (pathname === `${base}/${item.segment}` ||
              pathname.startsWith(`${base}/${item.segment}/`)),
        );

  const crumbs = [
    { label: workspaceName, href: "/app" },
    { label: productName, href: base },
    ...(current ? [{ label: current.label, href: current.href }] : []),
  ];

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li
              key={`${crumb.href}-${index}`}
              className={
                index === 0
                  ? "hidden min-w-0 items-center gap-1.5 md:flex"
                  : index === 1 && current
                    ? "hidden min-w-0 items-center gap-1.5 sm:flex"
                    : "flex min-w-0 items-center gap-1.5"
              }
            >
              {index > 0 ? (
                <ChevronRight
                  className={
                    index === 1
                      ? "hidden size-3.5 shrink-0 text-muted-foreground md:block"
                      : index === crumbs.length - 1
                        ? "hidden size-3.5 shrink-0 text-muted-foreground sm:block"
                        : "size-3.5 shrink-0 text-muted-foreground"
                  }
                  aria-hidden="true"
                />
              ) : null}
              {isLast ? (
                <span className="truncate font-medium" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
