/**
 * Lightweight wrapper around OpenAI's embedding API.
 * Instantiated per-request with the user's decrypted API key.
 */
export class EmbeddingService {
  private apiKey: string;
  private model = "text-embedding-3-small";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(text: string): Promise<number[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  }
}
