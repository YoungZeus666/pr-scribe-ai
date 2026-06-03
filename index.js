import OpenAI from "openai";

const COMMENT_HEADER = "🤖 **AI 自动生成的 PR 描述** (仅供参考)";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

function buildDiffSummary(files) {
  return files.map((file) => `- ${file.filename}: ${file.changes} 行变更`).join("\n");
}

function buildPrompt(diffSummary) {
  return [
    "你是一个资深软件工程师，请根据以下代码变更生成一个专业的 PR 描述。",
    "输出必须包含以下 3 个部分：",
    "1. 变更概述（不超过50字）",
    "2. 主要修改点",
    "3. 风险提示",
    "",
    "变更摘要：",
    diffSummary,
  ].join("\n");
}

function createOpenAIClient() {
  const baseURL = process.env.OPENAI_BASE_URL;

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    ...(baseURL ? { baseURL } : {}),
  });
}

async function generatePrDescription(diffSummary, client = createOpenAIClient()) {
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    messages: [{ role: "user", content: buildPrompt(diffSummary) }],
    temperature: 0.3,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

async function postPrComment(context, issueNumber, body) {
  return context.octokit.rest.issues.createComment(
    context.issue({
      issue_number: issueNumber,
      body,
    }),
  );
}

/**
 * @param {import('probot').Probot} app
 */
export default (app) => {
  app.log.info("Yay, the app was loaded!");

  app.on(
    ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"],
    async (context) => {
      const pr = context.payload.pull_request;
      const prNumber = pr.number;

      if (!process.env.OPENAI_API_KEY) {
        app.log.error({ prNumber }, "Missing OPENAI_API_KEY");
        return;
      }

      app.log.info({ prNumber }, "Generating PR description");

      try {
        const { data: files } = await context.octokit.rest.pulls.listFiles({
          owner: context.payload.repository.owner.login,
          repo: context.payload.repository.name,
          pull_number: prNumber,
          per_page: 100,
        });

        const diffSummary = buildDiffSummary(files);

        if (!diffSummary) {
          app.log.warn({ prNumber }, "No changed files found for PR");
          return;
        }

        const prDescription = await generatePrDescription(diffSummary);

        if (!prDescription) {
          app.log.warn({ prNumber }, "OpenAI-compatible API returned empty PR description");
          return;
        }

        await postPrComment(context, prNumber, `${COMMENT_HEADER}\n\n${prDescription}`);

        app.log.info({ prNumber }, "Posted generated PR description");
      } catch (error) {
        app.log.error({ err: error, prNumber }, "Failed to generate PR description");
      }
    },
  );
};
