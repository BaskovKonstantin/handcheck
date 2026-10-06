"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { getDb } = require("./db");
const { seed } = require("./db/seed");
const config = require("./config");
const { attachUser, requireAuth } = require("./middleware/auth");
const { errorHandler } = require("./middleware/errors");
const { attachSignaling } = require("./modules/calls/signaling");

const STARTED_AT = new Date().toISOString();

function createApp() {
  seed(getDb());

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "256kb" }));
  app.use(attachUser);

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "handcheck",
      version: "0.5.0",
      startedAt: STARTED_AT,
      now: new Date().toISOString(),
    });
  });

  app.get("/api/me", requireAuth, (req, res) => {
    res.json({
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      emailConfirmed: Boolean(req.user.email_confirmed_at),
    });
  });

  app.use("/api/stats", require("./modules/stats/router"));
  app.use("/api/auth", require("./modules/auth/router"));
  app.use("/api/candidate", require("./modules/candidates/router"));
  app.use("/api/employer", require("./modules/employers/router"));
  app.use("/api/employer", require("./modules/needs/router"));
  app.use("/api/employer", require("./modules/matching/router"));
  app.use("/api/employer", require("./modules/deck/router"));
  app.use("/api/employer", require("./modules/invitations/router"));
  app.use("/api/assessment", require("./modules/assessment/router"));
  app.use("/api/assessment", require("./modules/tasks/router"));
  app.use("/api/calls", require("./modules/calls/router"));
  app.use("/api/integrations", require("./modules/integrations/router"));
  app.use("/mcp", require("./modules/mcp/router"));

  const publicDir = path.join(__dirname, "public");
  const routes = [
    ["/", "index.html"],
    ["/auth", "auth.html"],
    ["/candidate/today", "candidate/today.html"],
    ["/candidate/past", "candidate/past.html"],
    ["/candidate/tasks", "candidate/tasks.html"],
    ["/candidate/invitations", "candidate/invitations.html"],
    ["/candidate/calls", "candidate/calls.html"],
    ["/candidate/profile", "candidate/profile.html"],
    ["/candidate/integrations", "candidate/integrations.html"],
    ["/employer/need", "employer/need.html"],
    ["/employer/deck", "employer/deck.html"],
    ["/employer/list", "employer/list.html"],
    ["/employer/deferred", "employer/deferred.html"],
    ["/employer/invitations", "employer/invitations.html"],
    ["/employer/calls", "employer/calls.html"],
    ["/employer/profile", "employer/profile.html"],
    ["/employer/integrations", "employer/integrations.html"],
  ];
  for (const [url, file] of routes) {
    app.get(url, (_req, res) => res.sendFile(path.join(publicDir, file)));
  }
  app.get("/call/:invitationId", (_req, res) => {
    res.sendFile(path.join(publicDir, "call.html"));
  });

  app.use(express.static(publicDir));

  app.get("*", (_req, res) => {
    res.status(404).sendFile(path.join(publicDir, "404.html"));
  });

  app.use(errorHandler);
  return app;
}

function start() {
  const app = createApp();
  const server = http.createServer(app);
  attachSignaling(server);
  server.listen(config.PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`handcheck listening on :${config.PORT}`);
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
