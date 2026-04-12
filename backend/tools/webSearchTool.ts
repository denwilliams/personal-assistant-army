import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import { z } from "zod";
import { getContext } from "./context";

/**
 * Web search tool using Google Custom Search JSON API.
 * Reads API credentials from experimental_context at execution time.
 */
const web_search = tool({
  description:
    "Search the web for current information. Returns relevant search results with titles, links, and snippets.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
  }),
  execute: async (params, options) => {
    const { updateStatus, googleSearchApiKey, googleSearchEngineId } = getContext(options);
    updateStatus(`Searching: ${params.query}`);

    if (!googleSearchApiKey || !googleSearchEngineId) {
      return JSON.stringify({
        error: "Web search not available. User needs to configure Google Custom Search credentials in their profile.",
      });
    }

    try {
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("q", params.query);
      url.searchParams.set("key", googleSearchApiKey);
      url.searchParams.set("cx", googleSearchEngineId);
      url.searchParams.set("num", "5");

      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Google Custom Search error ${response.status}: ${errorText}`);
        return JSON.stringify({ error: `Search failed (HTTP ${response.status})` });
      }

      const data = await response.json();
      const results = (data.items || []).map((item: any) => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
      }));

      updateStatus(`Found ${results.length} results`);
      return JSON.stringify({ results });
    } catch (error) {
      console.error("Web search error:", error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Search failed",
      });
    }
  },
});

/** Web search tool - include when agent has "internet_search" built-in tool enabled */
export const webSearchTools: Record<string, AiTool> = { web_search };
