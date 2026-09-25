import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";

let client: OpenAI | null = null;

export function isAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAI() {
  if (!isAIConfigured()) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env to enable invoice analysis.");
  }
  client ??= new OpenAI();
  return client;
}

export const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

export const REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT || "low") as ReasoningEffort;
