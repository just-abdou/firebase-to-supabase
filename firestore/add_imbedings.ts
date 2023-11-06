import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { CohereClient } from "cohere-ai";

const cohere = new CohereClient({
  token: "8Dapg8fdPdyqxRKMueaGL6Iviuv70Pl8j33cO7ME",
});

const OPENAI_API_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const API_KEY = "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";

export async function getRecipeSummaryCompletion(text: string) {
  try {
    const response = await axios.post(
      OPENAI_API_ENDPOINT,
      {
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You will be provided with some recipe information's.
You task is to analyze those information's and produce a short brief description about that recipe. Your response is going to be embedded and stored in a vector dataBase, that means that it should not contains unnecessary information. and also use your expertise in text embedding and vector database structures to create that perfect prompt. don't give any introduction and just answer with the description.`,
          },
          { role: "user", content: text },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("Error fetching embedding:", error);
    throw error;
  }
}

export async function getEmbedding(text: string, storing: boolean) {
  try {
    const response = await axios.post(
      "https://api.cohere.ai/v1/embed",
      {
        texts: [text.toLowerCase().trim()],
        model: "embed-english-v3.0",
        input_type: storing ? "search_document" : "search_query",
      },
      {
        headers: {
          accept: "application/json",
          Authorization: `Bearer 8Dapg8fdPdyqxRKMueaGL6Iviuv70Pl8j33cO7ME`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.embeddings[0];
  } catch (error) {
    console.error("Error fetching embedding:", error);
    throw error;
  }
}

const supabaseUrl = "https://gmusgfctofytaxvvlgvs.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtdXNnZmN0b2Z5dGF4dnZsZ3ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTg3NTA2ODQsImV4cCI6MjAxNDMyNjY4NH0.q1B7ZQdSHUrYywWJBWoEc5nxF9WsHuatUg8QNlUwnPQ";

(async () => {
  const text = "lunch fish";
  const embedding = await getEmbedding(text, false);

  const supabaseClient = createClient(supabaseUrl, supabaseKey);

  const { data: documents } = await supabaseClient.rpc(
    "recipe_summary_search",
    {
      query_embedding: embedding,
      match_threshold: 0.2,
      match_count: 20,
    }
  );

  console.log("result", { documents });
})();
