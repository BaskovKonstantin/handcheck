"use strict";

const path = require("path");
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT || 8810);
const STARTED_AT = new Date().toISOString();

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

/** In-memory stubs — replace with DB when Grok Bot grows the product. */
const state = {
  candidates: [],
  invitations: [],
};

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "handcheck",
    version: "0.1.0",
    startedAt: STARTED_AT,
    now: new Date().toISOString(),
  });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    product: "HandCheck",
    pitch: "Опрос + тест → категория (специализация × грейд) → работодатель приглашает с вилкой ЗП",
    cabinets: ["candidate", "employer"],
    status: "template",
    juryHints: {
      matching: "35%",
      testAndCategories: "25%",
    },
  });
});

app.get("/api/candidates", (_req, res) => {
  res.json({ items: state.candidates });
});

app.post("/api/candidates", (req, res) => {
  const specialization = String(req.body?.specialization || "").trim();
  const grade = String(req.body?.grade || "").trim();
  if (!specialization || !grade) {
    res.status(400).json({ error: "specialization and grade required" });
    return;
  }
  const item = {
    id: `c_${Date.now()}`,
    specialization,
    grade,
    category: `${specialization} × ${grade}`,
    createdAt: new Date().toISOString(),
  };
  state.candidates.unshift(item);
  res.status(201).json(item);
});

app.get("/api/invitations", (_req, res) => {
  res.json({ items: state.invitations });
});

app.post("/api/invitations", (req, res) => {
  const candidateId = String(req.body?.candidateId || "").trim();
  const salaryFrom = Number(req.body?.salaryFrom);
  const salaryTo = Number(req.body?.salaryTo);
  if (!candidateId || !Number.isFinite(salaryFrom) || !Number.isFinite(salaryTo)) {
    res.status(400).json({ error: "candidateId, salaryFrom, salaryTo required" });
    return;
  }
  const item = {
    id: `i_${Date.now()}`,
    candidateId,
    salaryFrom,
    salaryTo,
    currency: "RUB",
    createdAt: new Date().toISOString(),
  };
  state.invitations.unshift(item);
  res.status(201).json(item);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`handcheck listening on :${PORT}`);
});
