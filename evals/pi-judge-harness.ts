import { complete, getModels } from "@earendil-works/pi-ai";
import { createJudgeHarness } from "vitest-evals";

const judgeModelId = (
  process.env.FLUE_TRIAGE_JUDGE_MODEL ??
  "openrouter/anthropic/claude-haiku-4.5"
).replace(/^openrouter\//, "");

const judgeModel = getModels("openrouter").find(
  (model) => model.id === judgeModelId,
);

if (!judgeModel) {
  throw new Error(`Unknown OpenRouter judge model: ${judgeModelId}`);
}

function parseJsonResponse(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  return JSON.parse(withoutFence);
}

export const issueTriageJudgeHarness = createJudgeHarness({
  name: "issue-triage-openrouter-judge",
  async run({ system, prompt }, { signal }) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is required to run rubric judges.");
    }

    const response = await complete(
      judgeModel,
      {
        systemPrompt: system,
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      },
      {
        apiKey,
        signal,
        temperature: 0,
        maxTokens: 500,
        maxRetries: 1,
      },
    );

    if (response.stopReason === "error" || response.errorMessage) {
      throw new Error(response.errorMessage ?? "Rubric judge failed.");
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    return parseJsonResponse(text);
  },
});
