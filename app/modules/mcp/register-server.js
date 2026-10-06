"use strict";

const { getDb } = require("../../db");
const { scopesAllow } = require("../../lib/api-token");
const services = require("./services");
const { logToolCall } = require("../../lib/mcp-telemetry");
const {
  readToolExtra,
  writeToolExtra,
  mergeSchema,
  SCOPE_ERR_WRITE,
  SCOPE_ERR_READ,
} = require("./tool-meta");

function writeAudit(ctx, toolName, ok, summary) {
  getDb()
    .prepare(
      `INSERT INTO mcp_audit_log (user_id, api_token_id, tool_name, ok, result_summary)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(ctx.user.id, ctx.tokenId, toolName, ok ? 1 : 0, String(summary || "").slice(0, 500));
}

function toolResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(message) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function wrapTool(ctx, name, needWrite, fn, meta = {}) {
  return async (args) => {
    const started = Date.now();
    if (needWrite && !scopesAllow(ctx.scopesJson, "write")) {
      const err = toolError(SCOPE_ERR_WRITE);
      logToolCall(ctx, name, args, { ...err, durationMs: Date.now() - started });
      return err;
    }
    if (!scopesAllow(ctx.scopesJson, "read")) {
      const err = toolError(SCOPE_ERR_READ);
      logToolCall(ctx, name, args, { ...err, durationMs: Date.now() - started });
      return err;
    }
    try {
      const data = await fn(args);
      const result = toolResult(data);
      logToolCall(ctx, name, args, { ...result, durationMs: Date.now() - started });
      return result;
    } catch (e) {
      if (!e.isMcp) {
        console.error(`[mcp] tool ${name} failed:`, e);
      }
      const msg = e.isMcp ? e.message : "Не удалось выполнить действие";
      const err = toolError(msg);
      logToolCall(ctx, name, args, { ...err, durationMs: Date.now() - started });
      return err;
    }
  };
}

function registerHandcheckTools(server, ctx, ResourceTemplate) {
  const z = require("zod/v4");
  const role = ctx.user.role;

    server.registerTool(
      "whoami",
      {
        description: "Текущий пользователь HandCheck: email, роль, подтверждение почты.",
        ...readToolExtra(z),
      },
    wrapTool(ctx, "whoami", false, async () => ({
      email: ctx.user.email,
      role: ctx.user.role,
      emailConfirmed: Boolean(ctx.user.email_confirmed_at),
      tokenName: ctx.tokenName,
    }))
  );

  if (role === "candidate") {
    server.registerTool(
      "get_my_profile",
      {
        description: "Профиль кандидата без скрытых оценок.",
        ...readToolExtra(z),
      },
      wrapTool(ctx, "get_my_profile", false, () => services.getCandidateProfile(ctx.user.id))
    );

    server.registerTool(
      "update_my_profile",
      {
        description: "Обновить имя, контакты, стек и доступность.",
        ...writeToolExtra(
          z,
          {
            displayName: z.string().optional(),
            phone: z.string().optional(),
            contactEmail: z.string().optional(),
            stack: z.array(z.string()).optional(),
            availability: z.enum(["open", "paused"]).optional(),
          },
          { idempotent: true }
        ),
      },
      wrapTool(ctx, "update_my_profile", true, (args) =>
        services.updateCandidateProfile(ctx.user.id, args)
      )
    );

    server.registerTool(
      "get_my_category",
      {
        description: "Текущая категория после теста (без числовых баллов).",
        ...readToolExtra(z),
      },
      wrapTool(ctx, "get_my_category", false, () => services.getCandidateCategory(ctx.user.id))
    );

    server.registerTool(
      "list_tasks",
      {
        description: "Активная батарея заданий и список попыток.",
        ...readToolExtra(z),
      },
      wrapTool(ctx, "list_tasks", false, () => services.listAssessmentTasks(ctx.user.id))
    );

    server.registerTool(
      "get_task",
      {
        description: "Текст одного задания по attemptId.",
        ...readToolExtra(z),
        inputSchema: mergeSchema(z, {
          attemptId: z.string().describe("ID попытки из list_tasks"),
        }),
      },
      wrapTool(ctx, "get_task", false, (args) =>
        services.getAssessmentTask(ctx.user.id, args.attemptId)
      )
    );

    server.registerTool(
      "start_assessment",
      {
        description: "Начать батарею QuickProbe + WorkSim для specialization × grade.",
        ...writeToolExtra(z, {
          specialization: z.string(),
          grade: z.enum(["junior", "middle", "senior"]),
        }),
      },
      wrapTool(ctx, "start_assessment", true, (args) =>
        services.startAssessment(ctx.user.id, args.specialization, args.grade, "mcp")
      )
    );

    server.registerTool(
      "submit_answer",
      {
        description: "Отправить ответ на короткое задание (quick).",
        ...writeToolExtra(z, {
          attemptId: z.string(),
          answerText: z.string(),
        }),
      },
      wrapTool(ctx, "submit_answer", true, (args) =>
        services.submitAttemptAnswer(ctx.user.id, args.attemptId, args.answerText, "mcp", {
          requireQuick: true,
        })
      )
    );

    server.registerTool(
      "submit_work_task",
      {
        description: "Отправить ответ на рабочее задание (work).",
        ...writeToolExtra(z, {
          attemptId: z.string(),
          answerText: z.string(),
        }),
      },
      wrapTool(ctx, "submit_work_task", true, (args) =>
        services.submitAttemptAnswer(ctx.user.id, args.attemptId, args.answerText, "mcp", {
          requireWork: true,
        })
      )
    );

    server.registerTool(
      "list_invitations",
      {
        description: "Входящие приглашения работодателей.",
        ...readToolExtra(z),
      },
      wrapTool(ctx, "list_invitations", false, () =>
        services.listCandidateInvitations(ctx.user.id)
      )
    );

    server.registerTool(
      "respond_invitation",
      {
        description: "Принять или отклонить приглашение.",
        ...writeToolExtra(z, {
          invitationId: z.string(),
          decision: z.string(),
        }),
      },
      wrapTool(ctx, "respond_invitation", true, (args) =>
        services.respondInvitation(ctx.user.id, args.invitationId, args.decision)
      )
    );

    server.registerTool(
      "list_calls",
      {
        description: "Звонки по принятым приглашениям.",
        ...readToolExtra(z),
      },
      wrapTool(ctx, "list_calls", false, () => services.listCandidateCalls(ctx.user.id))
    );
  }

  if (role === "employer") {
    server.registerTool(
      "list_needs",
      {
        description: "Список потребностей работодателя.",
        ...readToolExtra(z),
      },
      wrapTool(ctx, "list_needs", false, () => services.listEmployerNeeds(ctx.user.id))
    );

    server.registerTool(
      "create_need",
      {
        description: "Создать новую потребность.",
        ...writeToolExtra(z, {
          title: z.string(),
          specialization: z.string().optional(),
          grade: z.string().optional(),
          stack: z.array(z.string()).optional(),
          domainText: z.string().optional(),
          notes: z.string().optional(),
          active: z.boolean().optional(),
        }),
      },
      wrapTool(ctx, "create_need", true, (args) => services.createEmployerNeed(ctx.user.id, args))
    );

    server.registerTool(
      "update_need",
      {
        description: "Обновить потребность по id.",
        ...writeToolExtra(
          z,
          {
            needId: z.string(),
            title: z.string().optional(),
            specialization: z.string().optional(),
            grade: z.string().optional(),
            stack: z.array(z.string()).optional(),
            domainText: z.string().optional(),
            notes: z.string().optional(),
            active: z.boolean().optional(),
          },
          { idempotent: true }
        ),
      },
      wrapTool(ctx, "update_need", true, (args) => {
        const { needId, ...body } = args;
        return services.updateEmployerNeed(ctx.user.id, needId, body);
      })
    );

    server.registerTool(
      "get_next_candidate",
      {
        description: "Следующая карточка в колоде по потребности.",
        ...readToolExtra(z),
        inputSchema: mergeSchema(z, { needId: z.string() }),
      },
      wrapTool(ctx, "get_next_candidate", false, (args) =>
        services.getDeckNext(ctx.user.id, args.needId)
      )
    );

    server.registerTool(
      "decide_candidate",
      {
        description: "Решение по кандидату: reject, later или invite с вилкой ЗП.",
        ...writeToolExtra(z, {
          needId: z.string(),
          candidateId: z.string(),
          decision: z.string(),
          salaryFrom: z.number().int().optional(),
          salaryTo: z.number().int().optional(),
          offerText: z.string().optional(),
          contactChannel: z.string().optional(),
        }),
      },
      wrapTool(ctx, "decide_candidate", true, (args) => {
        const { needId, ...payload } = args;
        return services.decideCandidate(ctx.user.id, needId, payload, "mcp");
      })
    );

    server.registerTool(
      "list_shortlist",
      {
        description: "Список подходящих кандидатов по потребности.",
        ...readToolExtra(z),
        inputSchema: mergeSchema(z, { needId: z.string() }),
      },
      wrapTool(ctx, "list_shortlist", false, (args) =>
        services.listShortlist(ctx.user.id, args.needId)
      )
    );

    server.registerTool(
      "list_invitations",
      {
        description: "Исходящие приглашения.",
        ...readToolExtra(z),
      },
      wrapTool(ctx, "list_invitations", false, () =>
        services.listEmployerInvitations(ctx.user.id)
      )
    );

    server.registerTool(
      "list_calls",
      {
        description: "Звонки по принятым приглашениям.",
        ...readToolExtra(z),
      },
      wrapTool(ctx, "list_calls", false, () => services.listEmployerCalls(ctx.user.id))
    );

    server.registerTool(
      "get_call_analysis",
      {
        description: "Внутренний разбор завершённого звонка (только работодатель).",
        ...readToolExtra(z),
        inputSchema: mergeSchema(z, { callId: z.string() }),
      },
      wrapTool(ctx, "get_call_analysis", false, (args) =>
        services.getCallAnalysis(ctx.user.id, args.callId)
      )
    );
  }

  server.registerResource(
    "handcheck-profile",
    "handcheck://profile",
    { description: "Профиль текущего пользователя", mimeType: "application/json" },
    async () => {
      let payload;
      if (role === "candidate") payload = services.getCandidateProfile(ctx.user.id);
      else {
        const p = getDb()
          .prepare("SELECT * FROM employer_profiles WHERE user_id = ?")
          .get(ctx.user.id);
        payload = {
          companyName: p?.company_name,
          industry: p?.industry,
          contactEmail: p?.contact_email,
        };
      }
      return {
        contents: [{ uri: "handcheck://profile", mimeType: "application/json", text: JSON.stringify(payload) }],
      };
    }
  );

  if (role === "employer") {
    server.registerResource(
      "handcheck-need-template",
      new ResourceTemplate("handcheck://needs/{id}", {}),
      { description: "Потребность работодателя", mimeType: "application/json" },
      async (uri, variables) => {
        const data = services.getNeedResource(ctx.user.id, role, variables.id);
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }],
        };
      }
    );
  }

  if (role === "candidate") {
    server.registerResource(
      "handcheck-task-template",
      new ResourceTemplate("handcheck://tasks/{id}", {}),
      { description: "Задание теста (attemptId)", mimeType: "application/json" },
      async (uri, variables) => {
        const data = services.getAssessmentTask(ctx.user.id, variables.id);
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }],
        };
      }
    );
  }

  if (role === "candidate") {
  server.registerPrompt(
    "candidate-next-steps",
    {
      description: "Подсказка ассистенту: что делать кандидату в HandCheck.",
      argsSchema: {},
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Ты помогаешь кандидату в HandCheck. Сначала проверь категорию (get_my_category). " +
              "Если категории нет — предложи start_assessment. Затем проверь list_invitations и list_calls. " +
              "Не запрашивай и не показывай числовые оценки теста. " +
              "При вызове инструментов заполняй поле intent одной фразой — что попросил пользователь.",
          },
        },
      ],
    })
  );
  }

  if (role === "employer") {
  server.registerPrompt(
    "employer-hiring-flow",
    {
      description: "Подсказка ассистенту: подбор и колода работодателя.",
      argsSchema: {},
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Ты помогаешь работодателю в HandCheck. Уточни потребность (list_needs), " +
              "листай колоду get_next_candidate и фиксируй decide_candidate. " +
              "После accept приглашения помоги со звонком; разбор — get_call_analysis. " +
              "При вызове инструментов заполняй поле intent одной фразой — что попросил пользователь.",
          },
        },
      ],
    })
  );
  }
}

function createMcpServerForContext(ctx) {
  const { McpServer, ResourceTemplate } = require("@modelcontextprotocol/sdk/server/mcp.js");
  const server = new McpServer(
    { name: "handcheck", version: "0.5.0" },
    {
      capabilities: { logging: {} },
      instructions:
        "HandCheck MCP: при каждом вызове инструмента передавайте intent — короткую фразу о запросе пользователя. " +
        "Не запрашивайте числовые оценки теста и не раскрывайте чужие данные.",
    }
  );
  registerHandcheckTools(server, ctx, ResourceTemplate);
  return server;
}

module.exports = { createMcpServerForContext, writeAudit };
