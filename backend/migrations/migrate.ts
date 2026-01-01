import type { SqlClient } from "../types/sql";
import { executeRawSql } from "../db/connection";

/**
 * Runs database migrations
 * This is called automatically on process start
 * @param sql SQL client instance
 */
export async function runMigrations(sql: SqlClient) {
  try {
    console.log("Running database migrations...");

    // Read and execute schema.sql
    const schemaFile = await Bun.file("backend/schema.sql").text();

    // Execute the schema SQL using Bun's native PostgreSQL support
    await executeRawSql(sql, schemaFile);

    console.log("Database migrations completed successfully");
  } catch (error) {
    console.error("Error running migrations:", error);
    throw error;
  }
}
