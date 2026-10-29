import { db } from "./index.js";

if (db.kind !== "postgres") {
  console.log("DATABASE_URL is not set; nothing to migrate (using in-memory store).");
} else {
  await db.migrate();
  console.log("Schema is up to date.");
}
await db.close();
