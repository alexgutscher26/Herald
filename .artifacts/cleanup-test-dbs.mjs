import { Client } from "pg";
const url = process.env.DATABASE_URL;
const admin = new Client({ connectionString: url });
await admin.connect();
const { rows } = await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'herald_test_%'");
for (const { datname } of rows) {
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [datname]).catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${datname}"`);
  console.log("dropped", datname);
}
console.log("remaining:", (await admin.query("SELECT count(*) FROM pg_database WHERE datname LIKE 'herald_test_%'")).rows[0].count);
await admin.end();
