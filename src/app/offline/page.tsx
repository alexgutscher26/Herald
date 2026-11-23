import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline · Herald",
  robots: { index: false, follow: false },
};

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Herald
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">You are offline.</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        This page was saved with the app shell. Reconnect to load feedback, updates and help
        articles.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex w-fit items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Try again
      </Link>
    </main>
  );
}
