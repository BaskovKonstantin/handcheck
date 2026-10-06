"use strict";

const { McpServer, ResourceTemplate } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod/v4");
const handlers = require("./handlers");
const { logMcpCall } = require("../../lib/api-tokens");

function wrapTool(ctx, name, fn) {
  return async (args) => {
    try {
      const result = await fn(args);
      logMcpCall({
        tokenId: ctx.tokenId,
        userId: ctx.user.id,
        toolName: name,
        summary: "ok",
        ok: true,
      });
      return result;
    } catch (err) {
      const formatted = handlers.formatToolError(err);
      logMcpCall({
        tokenId: ctx.tokenId,
        userId: ctx.user.id,
        toolName: name,
        summary: formatted.text,
        ok: false,
      });
      return {
        content: [{ type: "text", text: formatted.text }],
        isError: true,
      };
    }
  };
}

function buildMcpServer(ctx) {
  const server = new McpServer(
    { name: "handcheck", version: "0.5.0" },
    { capabilities: { resources: {}, prompts: {} } }
  );

  server.registerTool(
    "whoami",
    {
      description: "Текущий пользователь HandCheck / Current authenticated user",
      inputSchema: {},
    },
    wrapTool(ctx, "whoami", () => handlers.whoami(ctx))
  );

  if (ctx.user.role === "candidate") {
    server.registerTool(
      "get_my_profile",
      {
        description: "Профиль кандидата / Candidate profile",
        inputSchema: {},
      },
      wrapTool(ctx, "get_my_profile", () => handlers.getMyProfile(ctx))
    );
    server.registerTool(
      "update_my_profile",
      {
        description: "Обновить профиль / Update candidate profile (write scope)",
        inputSchema: {
          displayName: z.string().optional(),
          stack: z.array(z.string()).optional(),
          phone: z.string().optional(),
          contactEmail: z.string().optional(),
        },
      },
      wrapTool(ctx, "update_my_profile", (a) => handlers.updateMyProfile(ctx, a))
    );
    server.registerTool(
      "get_my_category",
      {
        description: "Категория после теста / Assigned category label",
        inputSchema: {},
      },
      wrapTool(ctx, "get_my_category", () => handlers.getMyCategory(ctx))
    );
    server.registerTool(
      "list_tasks",
      {
        description: "Текущая батарея: короткие и рабочая / Current battery tasks",
        inputSchema: {},
      },
      wrapTool(ctx, "list_tasks", () => handlers.listTasks(ctx))
    );
    server.registerTool(
      "get_task",
      {
        description: "Текст задания по attemptId / Full task prompt",
        inputSchema: { attemptId: z.string().describe("ID попытки") },
      },
      wrapTool(ctx, "get_task", (a) => handlers.getTask(ctx, a.attemptId))
    );
    server.registerTool(
      "start_assessment",
      {
        description: "Начать батарею теста / Start assessment battery",
        inputSchema: {
          specialization: z.string(),
          grade: z.enum(["junior", "middle", "senior"]),
        },
      },
      wrapTool(ctx, "start_assessment", (a) => handlers.startAssessment(ctx, a))
    );
    server.registerTool(
      "submit_answer",
      {
        description: "Сдать короткий ответ QuickProbe / Submit quick answer",
        inputSchema: {
          attemptId: z.string(),
          answerText: z.string(),
        },
      },
      wrapTool(ctx, "submit_answer", (a) => handlers.submitAnswer(ctx, a.attemptId, a.answerText))
    );
    server.registerTool(
      "submit_work_task",
      {
        description: "Сдать рабочую задачу WorkSim / Submit work task",
        inputSchema: {
          attemptId: z.string(),
          answerText: z.string(),
        },
      },
      wrapTool(ctx, "submit_work_task", (a) =>
        handlers.submitWorkTask(ctx, a.attemptId, a.answerText)
      )
    );
    server.registerTool(
      "list_invitations",
      {
        description: "Приглашения кандидата / Candidate invitations",
        inputSchema: {},
      },
      wrapTool(ctx, "list_invitations", () => handlers.listInvitationsCandidate(ctx))
    );
    server.registerTool(
      "respond_invitation",
      {
        description: "Принять или отклонить приглашение / Accept or decline invitation",
        inputSchema: {
          invitationId: z.string(),
          action: z.enum(["accept", "decline"]),
        },
      },
      wrapTool(ctx, "respond_invitation", (a) =>
        handlers.respondInvitation(ctx, a.invitationId, a.action)
      )
    );
    server.registerTool(
      "list_calls",
      {
        description: "Звонки кандидата / Candidate calls",
        inputSchema: {},
      },
      wrapTool(ctx, "list_calls", () => handlers.listCallsCandidate(ctx))
    );
  }

  if (ctx.user.role === "employer") {
    server.registerTool(
      "list_needs",
      {
        description: "Потребности работодателя / Employer needs",
        inputSchema: {},
      },
      wrapTool(ctx, "list_needs", () => handlers.listNeeds(ctx))
    );
    server.registerTool(
      "create_need",
      {
        description: "Создать потребность / Create need",
        inputSchema: {
          title: z.string(),
          specialization: z.string().default("backend"),
          grade: z.enum(["junior", "middle", "senior"]).default("middle"),
          stack: z.array(z.string()).optional(),
          domainText: z.string().optional(),
          notes: z.string().optional(),
        },
      },
      wrapTool(ctx, "create_need", (a) => handlers.createNeed(ctx, a))
    );
    server.registerTool(
      "update_need",
      {
        description: "Обновить потребность / Update need",
        inputSchema: {
          needId: z.string(),
          title: z.string().optional(),
          specialization: z.string().optional(),
          grade: z.enum(["junior", "middle", "senior"]).optional(),
          stack: z.array(z.string()).optional(),
          domainText: z.string().optional(),
          notes: z.string().optional(),
          active: z.boolean().optional(),
        },
      },
      wrapTool(ctx, "update_need", (a) => handlers.updateNeed(ctx, a.needId, a))
    );
    server.registerTool(
      "get_next_candidate",
      {
        description: "Следующая карточка колоды / Next deck candidate",
        inputSchema: { needId: z.string() },
      },
      wrapTool(ctx, "get_next_candidate", (a) => handlers.getNextCandidate(ctx, a.needId))
    );
    server.registerTool(
      "decide_candidate",
      {
        description:
          "Решение по кандидату: reject, later или invite с вилкой / Deck decision",
        inputSchema: {
          needId: z.string(),
          candidateId: z.string(),
          decision: z.enum(["reject", "later", "invite"]),
          salaryFrom: z.number().int().optional(),
          salaryTo: z.number().int().optional(),
          offerText: z.string().optional(),
          contactChannel: z.string().optional(),
        },
      },
      wrapTool(ctx, "decide_candidate", (a) => handlers.decideCandidateTool(ctx, a))
    );
    server.registerTool(
      "list_shortlist",
      {
        description: "Ранжированный список кандидатов / Ranked shortlist",
        inputSchema: { needId: z.string() },
      },
      wrapTool(ctx, "list_shortlist", (a) => handlers.listShortlist(ctx, a.needId))
    );
    server.registerTool(
      "list_invitations",
      {
        description: "Исходящие приглашения / Outgoing invitations",
        inputSchema: {},
      },
      wrapTool(ctx, "list_invitations", () => handlers.listInvitationsEmployer(ctx))
    );
    server.registerTool(
      "list_calls",
      {
        description: "Звонки работодателя / Employer calls",
        inputSchema: {},
      },
      wrapTool(ctx, "list_calls", () => handlers.listCallsEmployer(ctx))
    );
    server.registerTool(
      "get_call_analysis",
      {
        description: "Разбор звонка (3 фразы) / Call analysis summary",
        inputSchema: { callId: z.string() },
      },
      wrapTool(ctx, "get_call_analysis", (a) => handlers.getCallAnalysis(ctx, a.callId))
    );
  }

  server.registerResource(
    "profile",
    "handcheck://profile",
    {
      description: "Профиль текущего пользователя / Current user profile",
      mimeType: "application/json",
    },
    async () => {
      const body = handlers.readProfileResource(ctx);
      return {
        contents: [
          {
            uri: "handcheck://profile",
            mimeType: "application/json",
            text: body.content[0].text,
          },
        ],
      };
    }
  );

  server.registerResource(
    "need",
    new ResourceTemplate("handcheck://needs/{id}", {}),
    {
      description: "Потребность работодателя / Employer need",
      mimeType: "application/json",
    },
    async (_uri, { id }) => {
      const body = handlers.readNeedResource(ctx, id);
      return {
        contents: [
          {
            uri: `handcheck://needs/${id}`,
            mimeType: "application/json",
            text: body.content[0].text,
          },
        ],
      };
    }
  );

  server.registerResource(
    "task",
    new ResourceTemplate("handcheck://tasks/{id}", {}),
    {
      description: "Задание по attemptId / Assessment task",
      mimeType: "application/json",
    },
    async (_uri, { id }) => {
      const body = handlers.readTaskResource(ctx, id);
      return {
        contents: [
          {
            uri: `handcheck://tasks/${id}`,
            mimeType: "application/json",
            text: body.content[0].text,
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "review-deck",
    {
      description: "Разобрать колоду: следующий кандидат и решение",
      argsSchema: { needId: z.string().describe("ID потребности") },
    },
    async ({ needId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Ты помощник работодателя в HandCheck. Потребность ${needId}. Вызови get_next_candidate, кратко опиши карточку без числовых оценок и предложи reject, later или invite с вилкой зарплаты.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "complete-assessment",
    {
      description: "Пройти задание: батарея и ответы",
      argsSchema: {
        specialization: z.string().default("backend"),
        grade: z.enum(["junior", "middle", "senior"]).default("middle"),
      },
    },
    async ({ specialization, grade }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Ты помощник кандидата HandCheck. Направление ${specialization}, грейд ${grade}. Вызови start_assessment, затем list_tasks и по очереди get_task, submit_answer и submit_work_task. Не показывай пользователю числовые score.`,
          },
        },
      ],
    })
  );

  return server;
}

module.exports = { buildMcpServer };
