import type { SqlClient } from "../types/sql";

/**
 * Database utilities for Bun's native PostgreSQL support
 * Uses dependency injection for testability
 */

/**
 * Initialize and test the database connection
 * @param sql SQL client instance
 * @param databaseUrl PostgreSQL connection string
 */
export async function initializeDatabase(
  sql: SqlClient,
  databaseUrl: string | undefined
): Promise<void> {
  if (!databaseUrl) {
    console.warn("DATABASE_URL not set, database features will not be available");
    return;
  }

  // Test the connection
  try {
    await sql`SELECT 1 as test`;
    console.log("Database connection established successfully");
  } catch (error) {
    console.error("Failed to connect to database:", error);
    throw error;
  }
}

/**
 * Execute raw SQL safely (for migrations)
 * @param sql SQL client instance
 * @param sqlText Raw SQL to execute
 */
export async function executeRawSql(sql: SqlClient, sqlText: string): Promise<void> {
  await sql.unsafe(sqlText);
}
