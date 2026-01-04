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

    // Set the schema search path if POSTGRES_SCHEMA is configured
    const postgresSchema = process.env.POSTGRES_SCHEMA;
    if (postgresSchema && postgresSchema !== 'public') {
      console.log(`Setting schema to: ${postgresSchema}`);
      // Create schema if it doesn't exist
      await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${postgresSchema}"`);
      // Set search_path for this session
      await sql.unsafe(`SET search_path TO "${postgresSchema}"`);
    }

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
