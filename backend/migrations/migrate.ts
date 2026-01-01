import { sql } from "bun";

/**
 * Runs database migrations
 * This is called automatically on process start
 */
export async function runMigrations(dbUrl: string | undefined) {
  try {
    if (!dbUrl) {
      console.warn("DATABASE_URL not set, skipping migrations");
      return;
    }

    console.log("Running database migrations...");

    // Read and execute schema.sql
    const schemaFile = await Bun.file("backend/schema.sql").text();
    await sql`${schemaFile}`;

    console.log("Database migrations completed successfully");
  } catch (error) {
    console.error("Error running migrations:", error);
    throw error;
  }
}
