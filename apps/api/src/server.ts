import "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { clientRoutes } from "./routes/clients.js";
import { billingRoutes } from "./routes/billing.js";
import { importRoutes } from "./routes/import.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { settingsRoutes } from "./routes/settings.js";
import { fieldCollectionRoutes } from "./routes/field-collection.js";
import { networkRoutes } from "./routes/network.js";
import { startAutomationScheduler } from "./services/automation.js";
import { applyRealTopologyCorrectionIfNeeded } from "./services/router-topology.js";

const app = Fastify({ logger: true, bodyLimit: 15 * 1024 * 1024 });

await app.register(cors, {
  origin: (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(","),
  credentials: true
});
await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024 } });

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (error instanceof ZodError) return reply.code(400).send({ message: "Invalid input", issues: error.issues });
  const status = (error as { statusCode?: number }).statusCode ?? 500;
  return reply.code(status).send({ message: status >= 500 ? "Internal server error" : error.message });
});

app.get("/api/health", async () => ({ ok: true, app: "ISP Billing API", version: "0.7.2" }));
await app.register(authRoutes, { prefix: "/api" });
await app.register(clientRoutes, { prefix: "/api" });
await app.register(billingRoutes, { prefix: "/api" });
await app.register(importRoutes, { prefix: "/api" });
await app.register(adminRoutes, { prefix: "/api" });
await app.register(settingsRoutes, { prefix: "/api" });
await app.register(fieldCollectionRoutes, { prefix: "/api" });
await app.register(networkRoutes, { prefix: "/api" });

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../web/dist");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot, prefix: "/" });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ message: "API route not found" });
    return (reply as any).type("text/html").sendFile("index.html");
  });
}

const topologyCorrection = await applyRealTopologyCorrectionIfNeeded();
if (topologyCorrection.applied) app.log.info({ topologyCorrection }, "Applied v0.7.2 MikroTik topology correction");

const port = Number(process.env.PORT ?? 4311);
const host = process.env.HOST ?? "0.0.0.0";
await app.listen({ port, host });
startAutomationScheduler();
