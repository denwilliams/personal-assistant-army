import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import { z } from "zod";
import { getContext } from "./context";
import { getAccessToken } from "../services/GoogleAuthService";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
];

/**
 * Helper: get an authenticated access token from context
 */
async function getToken(options: { experimental_context?: unknown }): Promise<string> {
  const { googleServiceAccountKey } = getContext(options);
  if (!googleServiceAccountKey) {
    throw new Error(
      "Google Sheets not available. User needs to configure a Google Service Account key in their profile."
    );
  }
  return getAccessToken(googleServiceAccountKey, SCOPES);
}

/**
 * Helper: make an authenticated request to Google APIs
 */
async function googleFetch(
  url: string,
  token: string,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API error (${response.status}): ${errorText}`);
  }
  return response;
}

// ---------- sheets_search ----------
const sheets_search = tool({
  description:
    "Search for Google Sheets spreadsheets by name. Returns spreadsheet IDs and names that can be used with other sheets tools.",
  inputSchema: z.object({
    query: z.string().describe("Search query to find spreadsheets by name"),
    max_results: z
      .number()
      .optional()
      .describe("Maximum number of results to return (default: 10)"),
  }),
  execute: async (params, options) => {
    const { updateStatus } = getContext(options);
    updateStatus(`Searching for spreadsheets: ${params.query}`);
    try {
      const token = await getToken(options);
      const limit = Math.min(params.max_results ?? 10, 50);
      const q = `mimeType='application/vnd.google-apps.spreadsheet' and name contains '${params.query.replace(/'/g, "\\'")}'`;
      const url = new URL(DRIVE_API);
      url.searchParams.set("q", q);
      url.searchParams.set("pageSize", String(limit));
      url.searchParams.set("fields", "files(id,name,modifiedTime,owners)");
      url.searchParams.set("orderBy", "modifiedTime desc");

      const response = await googleFetch(url.toString(), token);
      const data = await response.json();
      const files = (data.files || []).map((f: any) => ({
        spreadsheet_id: f.id,
        name: f.name,
        modified: f.modifiedTime,
        owner: f.owners?.[0]?.emailAddress,
      }));

      updateStatus(`Found ${files.length} spreadsheet(s)`);
      return JSON.stringify({ results: files });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Search failed",
      });
    }
  },
});

// ---------- sheets_get_info ----------
const sheets_get_info = tool({
  description:
    "Get metadata about a Google Sheets spreadsheet, including its title and list of worksheets (tabs) with their properties.",
  inputSchema: z.object({
    spreadsheet_id: z.string().describe("The spreadsheet ID (from the URL or search results)"),
  }),
  execute: async (params, options) => {
    const { updateStatus } = getContext(options);
    updateStatus("Getting spreadsheet info...");
    try {
      const token = await getToken(options);
      const url = `${SHEETS_API}/${params.spreadsheet_id}?fields=spreadsheetId,properties.title,sheets.properties`;
      const response = await googleFetch(url, token);
      const data = await response.json();

      const result = {
        spreadsheet_id: data.spreadsheetId,
        title: data.properties?.title,
        sheets: (data.sheets || []).map((s: any) => ({
          sheet_id: s.properties?.sheetId,
          title: s.properties?.title,
          index: s.properties?.index,
          row_count: s.properties?.gridProperties?.rowCount,
          column_count: s.properties?.gridProperties?.columnCount,
        })),
      };

      updateStatus(`Spreadsheet: ${result.title} (${result.sheets.length} sheets)`);
      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to get spreadsheet info",
      });
    }
  },
});

// ---------- sheets_read ----------
const sheets_read = tool({
  description:
    "Read data from a range in a Google Sheets spreadsheet. Returns rows of cell values. Use A1 notation for the range (e.g., 'Sheet1!A1:D10', 'Sheet1!A:D', or just 'Sheet1').",
  inputSchema: z.object({
    spreadsheet_id: z.string().describe("The spreadsheet ID"),
    range: z
      .string()
      .describe(
        "The A1 notation range to read (e.g., 'Sheet1!A1:D10', 'Sheet1!A:D', 'Sheet1')"
      ),
  }),
  execute: async (params, options) => {
    const { updateStatus } = getContext(options);
    updateStatus(`Reading ${params.range}...`);
    try {
      const token = await getToken(options);
      const url = `${SHEETS_API}/${params.spreadsheet_id}/values/${encodeURIComponent(params.range)}`;
      const response = await googleFetch(url, token);
      const data = await response.json();

      const rows = data.values || [];
      updateStatus(`Read ${rows.length} row(s)`);
      return JSON.stringify({ range: data.range, rows, total_rows: rows.length });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to read range",
      });
    }
  },
});

// ---------- sheets_write ----------
const sheets_write = tool({
  description:
    "Write data to a range in a Google Sheets spreadsheet. Overwrites existing data in the specified range. Use A1 notation for the range.",
  inputSchema: z.object({
    spreadsheet_id: z.string().describe("The spreadsheet ID"),
    range: z.string().describe("The A1 notation range to write to (e.g., 'Sheet1!A1:D3')"),
    values: z
      .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
      .describe("2D array of values to write (rows of cells)"),
  }),
  execute: async (params, options) => {
    const { updateStatus } = getContext(options);
    updateStatus(`Writing to ${params.range}...`);
    try {
      const token = await getToken(options);
      const url = `${SHEETS_API}/${params.spreadsheet_id}/values/${encodeURIComponent(params.range)}?valueInputOption=USER_ENTERED`;
      const response = await googleFetch(url, token, {
        method: "PUT",
        body: JSON.stringify({
          range: params.range,
          majorDimension: "ROWS",
          values: params.values,
        }),
      });
      const data = await response.json();

      updateStatus(`Wrote ${data.updatedRows} row(s), ${data.updatedCells} cell(s)`);
      return JSON.stringify({
        updated_range: data.updatedRange,
        updated_rows: data.updatedRows,
        updated_columns: data.updatedColumns,
        updated_cells: data.updatedCells,
      });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to write range",
      });
    }
  },
});

// ---------- sheets_append ----------
const sheets_append = tool({
  description:
    "Append rows to the end of a table in a Google Sheets spreadsheet. Automatically finds the last row of data and appends below it.",
  inputSchema: z.object({
    spreadsheet_id: z.string().describe("The spreadsheet ID"),
    range: z
      .string()
      .describe("The A1 notation of the table to append to (e.g., 'Sheet1!A:D' or 'Sheet1')"),
    values: z
      .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
      .describe("2D array of rows to append"),
  }),
  execute: async (params, options) => {
    const { updateStatus } = getContext(options);
    updateStatus(`Appending ${params.values.length} row(s)...`);
    try {
      const token = await getToken(options);
      const url = `${SHEETS_API}/${params.spreadsheet_id}/values/${encodeURIComponent(params.range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      const response = await googleFetch(url, token, {
        method: "POST",
        body: JSON.stringify({
          range: params.range,
          majorDimension: "ROWS",
          values: params.values,
        }),
      });
      const data = await response.json();
      const updates = data.updates || {};

      updateStatus(`Appended ${updates.updatedRows || params.values.length} row(s)`);
      return JSON.stringify({
        updated_range: updates.updatedRange,
        updated_rows: updates.updatedRows,
        updated_cells: updates.updatedCells,
      });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to append rows",
      });
    }
  },
});

// ---------- sheets_clear ----------
const sheets_clear = tool({
  description: "Clear all values from a range in a Google Sheets spreadsheet (keeps formatting).",
  inputSchema: z.object({
    spreadsheet_id: z.string().describe("The spreadsheet ID"),
    range: z.string().describe("The A1 notation range to clear (e.g., 'Sheet1!A1:D10')"),
  }),
  execute: async (params, options) => {
    const { updateStatus } = getContext(options);
    updateStatus(`Clearing ${params.range}...`);
    try {
      const token = await getToken(options);
      const url = `${SHEETS_API}/${params.spreadsheet_id}/values/${encodeURIComponent(params.range)}:clear`;
      const response = await googleFetch(url, token, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = await response.json();

      updateStatus(`Cleared ${data.clearedRange || params.range}`);
      return JSON.stringify({ cleared_range: data.clearedRange });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to clear range",
      });
    }
  },
});

// ---------- sheets_create ----------
const sheets_create = tool({
  description: "Create a new Google Sheets spreadsheet with optional initial sheet names.",
  inputSchema: z.object({
    title: z.string().describe("The title for the new spreadsheet"),
    sheet_names: z
      .array(z.string())
      .optional()
      .describe("Optional list of worksheet names to create (default: one 'Sheet1')"),
  }),
  execute: async (params, options) => {
    const { updateStatus } = getContext(options);
    updateStatus(`Creating spreadsheet: ${params.title}`);
    try {
      const token = await getToken(options);

      const body: any = {
        properties: { title: params.title },
      };

      if (params.sheet_names && params.sheet_names.length > 0) {
        body.sheets = params.sheet_names.map((name, index) => ({
          properties: { title: name, index },
        }));
      }

      const response = await googleFetch(SHEETS_API, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await response.json();

      updateStatus(`Created: ${data.properties?.title}`);
      return JSON.stringify({
        spreadsheet_id: data.spreadsheetId,
        title: data.properties?.title,
        url: data.spreadsheetUrl,
        sheets: (data.sheets || []).map((s: any) => s.properties?.title),
      });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to create spreadsheet",
      });
    }
  },
});

// ---------- sheets_add_sheet ----------
const sheets_add_sheet = tool({
  description: "Add a new worksheet (tab) to an existing Google Sheets spreadsheet.",
  inputSchema: z.object({
    spreadsheet_id: z.string().describe("The spreadsheet ID"),
    title: z.string().describe("The title for the new worksheet"),
    rows: z.number().optional().describe("Number of rows (default: 1000)"),
    columns: z.number().optional().describe("Number of columns (default: 26)"),
  }),
  execute: async (params, options) => {
    const { updateStatus } = getContext(options);
    updateStatus(`Adding sheet: ${params.title}`);
    try {
      const token = await getToken(options);
      const url = `${SHEETS_API}/${params.spreadsheet_id}:batchUpdate`;
      const response = await googleFetch(url, token, {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: params.title,
                  gridProperties: {
                    rowCount: params.rows ?? 1000,
                    columnCount: params.columns ?? 26,
                  },
                },
              },
            },
          ],
        }),
      });
      const data = await response.json();
      const newSheet = data.replies?.[0]?.addSheet?.properties;

      updateStatus(`Added sheet: ${newSheet?.title}`);
      return JSON.stringify({
        sheet_id: newSheet?.sheetId,
        title: newSheet?.title,
        index: newSheet?.index,
      });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to add sheet",
      });
    }
  },
});

// ---------- sheets_batch_read ----------
const sheets_batch_read = tool({
  description:
    "Read multiple ranges from a Google Sheets spreadsheet in a single request. More efficient than multiple individual reads.",
  inputSchema: z.object({
    spreadsheet_id: z.string().describe("The spreadsheet ID"),
    ranges: z
      .array(z.string())
      .describe("Array of A1 notation ranges to read (e.g., ['Sheet1!A1:B5', 'Sheet2!A1:C3'])"),
  }),
  execute: async (params, options) => {
    const { updateStatus } = getContext(options);
    updateStatus(`Reading ${params.ranges.length} range(s)...`);
    try {
      const token = await getToken(options);
      const url = new URL(`${SHEETS_API}/${params.spreadsheet_id}/values:batchGet`);
      for (const range of params.ranges) {
        url.searchParams.append("ranges", range);
      }

      const response = await googleFetch(url.toString(), token);
      const data = await response.json();

      const results = (data.valueRanges || []).map((vr: any) => ({
        range: vr.range,
        rows: vr.values || [],
        total_rows: (vr.values || []).length,
      }));

      updateStatus(`Read ${results.length} range(s)`);
      return JSON.stringify({ results });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to batch read",
      });
    }
  },
});

/** Google Sheets tools - include when agent has "google_sheets" built-in tool enabled */
export const googleSheetsTools: Record<string, AiTool> = {
  sheets_search,
  sheets_get_info,
  sheets_read,
  sheets_write,
  sheets_append,
  sheets_clear,
  sheets_create,
  sheets_add_sheet,
  sheets_batch_read,
};
