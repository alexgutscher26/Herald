process.env.DATABASE_URL = "postgres://herald:herald@localhost:5432/herald_e2e_scratch";
const { db } = await import("@/db");
const { jobs } = await import("@/db/schema");
const { and, eq, lt } = await import("drizzle-orm");

await db.delete(jobs);
await db.insert(jobs).values({
  type: "publish_releases",
  status: "running",
  lockedAt: new Date(Date.now() - 20 * 60 * 1000),
});

try {
  const rows = await db
    .update(jobs)
    .set({ status: "pending", lockedAt: null, updatedAt: new Date() })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(Date.now() - 10 * 60 * 1000))))
    .returning({ id: jobs.id });
  console.log("OK rows:", rows.length);
} catch (error) {
  const e = error as Error & { cause?: unknown };
  console.log("MESSAGE:", e.message);
  console.log("CAUSE:", e.cause);
}
process.exit(0);
