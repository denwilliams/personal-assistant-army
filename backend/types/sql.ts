/**
 * Type definition for Bun's SQL client
 * This allows us to inject the SQL client for testing
 */
export type SqlClient = typeof import("bun").sql;
