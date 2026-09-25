import type { JevActionRequest } from "wow/jev";

export const request: JevActionRequest = {
  candidates: [
    { description: "Cast Smite at the current target", id: "smite" },
    { description: "Do not start a new action", id: "wait" },
  ],
  instruction: "Kill the target, spend mana",
  observation: { activity: "idle", selfHealth: "high", targetHealth: "low" },
};

export const validPayload = {
  answers: {
    action: {
      choice: "smite",
      confidence: 0.4,
      probabilities: { smite: 0.7, wait: 0.3 },
      type: "choice",
    },
  },
  model: "jev-1.13.0",
  usage: { input_tokens: 318, output_tokens: 34 },
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
