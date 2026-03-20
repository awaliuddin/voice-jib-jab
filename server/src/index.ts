/**
 * Voice Jib-Jab Server Entry Point
 * NextGen AI Voice Orchestrator
 */

import express from "express";
import { createServer } from "http";
import { dirname, resolve } from "path";
import { config } from "./config/index.js";
import { VoiceWebSocketServer } from "./api/websocket.js";
import { sessionManager } from "./orchestrator/SessionManager.js";
import { OpaEvaluator } from "./insurance/opa_evaluator.js";
import { SessionRecorder } from "./services/SessionRecorder.js";
import { createSessionsRouter } from "./api/sessions.js";
import { createAdminRouter } from "./api/admin.js";
import { createVoiceRouter } from "./api/voice.js";
import { AnalyticsService } from "./services/AnalyticsService.js";
import { createAnalyticsRouter } from "./api/analytics.js";
import { tenantRegistry, initTenantRegistry } from "./services/TenantRegistry.js";
import { systemConfigStore } from "./services/SystemConfigStore.js";
import { VoiceTriggerService } from "./services/VoiceTriggerService.js";
import { initConversationMemoryStore } from "./services/ConversationMemoryStore.js";
import { createMemoryRouter } from "./api/memory.js";
import { createRateLimiter } from "./middleware/rateLimiter.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { initVoiceProfileStore } from "./services/VoiceProfileStore.js";
import { KokoroVoiceEngine } from "./services/KokoroVoiceEngine.js";
import { createVoicesRouter } from "./api/voices.js";
import { initKnowledgeBaseStore } from "./services/KnowledgeBaseStore.js";
import { createKnowledgeRouter } from "./api/knowledge.js";
import { initAgentTemplateStore } from "./services/AgentTemplateStore.js";
import { createTemplatesRouter } from "./api/templates.js";
import { createLanguageRouter } from "./api/language.js";
import { supervisorRegistry } from "./services/SupervisorRegistry.js";
import { SupervisorWebSocketServer, createSupervisorRouter } from "./api/supervisor.js";
import { initRoutingEngine } from "./services/RoutingEngine.js";
import { CallQueueService } from "./services/CallQueueService.js";
import { createRoutingRouter } from "./api/routing.js";
import { ClaimVerificationService } from "./services/ClaimVerificationService.js";
import { initIvrMenuStore } from "./services/IvrMenuStore.js";
import { createIvrRouter } from "./api/ivr.js";
import { VoiceQualityScorer } from "./services/VoiceQualityScorer.js";
import { createQualityRouter } from "./api/quality.js";
import { initPlaybookStore } from "./services/PlaybookStore.js";
import { createPlaybooksRouter } from "./api/playbooks.js";
import { createTenantComplianceRouter } from "./api/tenantCompliance.js";
import { initVoiceprintStore } from "./services/VoiceprintStore.js";
import { createVoiceprintsRouter } from "./api/voiceprints.js";
import { initVoiceAbTestService } from "./services/VoiceAbTestService.js";
import { initPersonaStore } from "./services/PersonaStore.js";
import { createPersonasRouter, createTenantPersonaRouter } from "./api/personas.js";
import { initFlowStore } from "./services/FlowStore.js";
import { FlowEngine } from "./services/FlowEngine.js";
import { createFlowsRouter } from "./api/flows.js";
import { translationService } from "./services/TranslationService.js";
import { createTranslationRouter } from "./api/translation.js";
import { monitoringDashboardHtml } from "./api/monitoringDashboard.js";
import { transcriptViewerHtml } from "./api/transcriptViewer.js";
import { IntentClassifier } from "./services/IntentClassifier.js";
import { initIntentStore } from "./services/IntentStore.js";
import { createIntentsRouter } from "./api/intents.js";
import { pipelineProfiler } from "./services/PipelineProfiler.js";
import { createProfilerRouter } from "./api/profiler.js";
import { RecordingStore } from "./services/RecordingStore.js";
import { createRecordingsRouter } from "./api/recordings.js";
import { initAgentAbTestService } from "./services/AgentAbTestService.js";
import { createAbTestsRouter } from "./api/abtests.js";
import { abTestDashboardHtml } from "./api/abTestDashboard.js";
import { HealthMonitorService, createVoiceAgentHealthChecks } from "./services/HealthMonitorService.js";
import { ConfigValidator } from "./services/ConfigValidator.js";
import { createValidateRouter } from "./api/validate.js";
import { TenantConfigMigrator } from "./services/TenantConfigMigrator.js";
import { createTenantMigrationRouter } from "./api/tenantMigration.js";
import { ConversationSearchService } from "./services/ConversationSearchService.js";
import { createSearchRouter } from "./api/search.js";
import { SessionExportService } from "./services/SessionExportService.js";
import { createExportRouter } from "./api/export.js";
import { SlaMonitor } from "./services/SlaMonitor.js";
import { createSlaRouter } from "./api/sla.js";
import { slaDashboardHtml } from "./api/slaDashboard.js";
import { LiveKbSearchService } from "./services/LiveKbSearchService.js";
import { createKbSearchRouter } from "./api/kbSearch.js";
import { initTrainingDataService } from "./services/TrainingDataService.js";
import { createTrainingRouter } from "./api/training.js";
import { AgentComparisonService } from "./services/AgentComparisonService.js";
import { createCompareAgentsRouter } from "./api/compareAgents.js";
import { compareAgentsDashboardHtml } from "./api/compareAgentsDashboard.js";
import { AuditReportService } from "./services/AuditReportService.js";
import { createAuditReportRouter } from "./api/auditReport.js";
import { ComplianceDashboardService } from "./services/ComplianceDashboardService.js";
import { createComplianceDashboardRouter } from "./api/complianceDashboard.js";
import { initOnboardingWizardService } from "./services/OnboardingWizardService.js";
import { createOnboardingRouter } from "./api/onboarding.js";
import { initWebhookService } from "./services/WebhookService.js";
import { createWebhooksRouter } from "./api/webhooks.js";
import { CapacityPlannerService } from "./services/CapacityPlannerService.js";
import { createCapacityPlannerRouter } from "./api/capacityPlanner.js";
import { initSkillStore } from "./services/SkillStore.js";
import { createSkillsRouter } from "./api/skills.js";
import { initAgentVersionStore } from "./services/AgentVersionStore.js";
import { createAgentVersionsRouter } from "./api/agentVersions.js";
import { ConversationAnalyticsService } from "./services/ConversationAnalyticsService.js";
import { createConversationAnalyticsRouter } from "./api/conversationAnalytics.js";
import { createHealthRouter } from "./api/health.js";
import { healthMonitorDashboardHtml } from "./api/healthMonitorDashboard.js";

const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());

// Security headers
app.use(securityHeaders);

// CORS for development
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept",
  );
  next();
});

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    sessions: sessionManager.getSessionCount(),
  });
});

// Status endpoint
app.get("/status", (_req, res) => {
  const activeSessions = sessionManager.getActiveSessions();

  res.json({
    status: "running",
    version: "0.1.0",
    activeSessions: activeSessions.length,
    sessions: activeSessions.map((s) => ({
      id: s.id,
      state: s.state,
      uptime: Date.now() - s.createdAt,
    })),
    config: {
      features: config.features,
      latencyTargets: config.latency,
    },
  });
});

// Metrics endpoint
app.get("/metrics", (_req, res) => {
  const activeSessions = sessionManager.getActiveSessions();
  res.json({
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    sessions: {
      active: activeSessions.length,
      total: sessionManager.getSessionCount(),
    },
    memory: {
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heap_used_mb: Math.round(
        process.memoryUsage().heapUsed / 1024 / 1024,
      ),
      heap_total_mb: Math.round(
        process.memoryUsage().heapTotal / 1024 / 1024,
      ),
    },
    session_detail: activeSessions.map((s) => ({
      id: s.id,
      state: s.state,
      uptime_ms: Date.now() - s.createdAt,
    })),
  });
});

// Monitoring dashboard — full voice agent ops view
app.get("/dashboard", (_req, res) => {
  res.type("html").send(monitoringDashboardHtml());
});

// Transcript viewer — session conversation with timestamps, sentiment, policy decisions
app.get("/transcripts/:sessionId", (req, res) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.sessionId)) {
    res.status(400).send("Invalid session ID");
    return;
  }
  res.type("html").send(transcriptViewerHtml());
});

// ── OPA singleton initialization ─────────────────────────────────────────
// WASM bundle loads once at startup and is shared across all sessions via the
// JS event loop (single-threaded — no locking required).
// Enable with ENABLE_OPA=true; bundle built by scripts/build-policy.sh.
async function initializeOpa(): Promise<OpaEvaluator | undefined> {
  if (!config.opa.enabled) return undefined;

  const evaluator = new OpaEvaluator(config.opa.bundlePath);
  try {
    await evaluator.initialize();
    console.log("[Server] OPA policy engine initialized");
    return evaluator;
  } catch (error) {
    console.warn(
      "[Server] OPA initialization failed — falling back to pattern-only moderation:",
      error,
    );
    return undefined;
  }
}

// ── Startup ───────────────────────────────────────────────────────────────

// ── Session Recorder singleton ────────────────────────────────────────
export const sessionRecorder = new SessionRecorder({
  recordingsDir: resolve(dirname(config.storage.databasePath), "recordings"),
  storeRawAudio: config.safety.storeRawAudio,
  retentionDays: 7,
});

// ── Recording Store (audio export) ────────────────────────────────────
const recordingRetentionDays = parseInt(process.env.RECORDING_RETENTION_DAYS ?? "30", 10);
export const recordingStore = new RecordingStore({
  audioDir: resolve(dirname(config.storage.databasePath), "audio"),
  retentionDays: Number.isFinite(recordingRetentionDays) ? recordingRetentionDays : 30,
});

// ── Rate limiters ────────────────────────────────────────────────────
const adminLimiter = createRateLimiter({ windowMs: 60_000, max: 30, message: "Admin API rate limit exceeded" });
const voiceLimiter = createRateLimiter({ windowMs: 60_000, max: 10, message: "Voice API rate limit exceeded" });
const analyticsLimiter = createRateLimiter({ windowMs: 60_000, max: 60, message: "Analytics API rate limit exceeded" });
const sessionsLimiter = createRateLimiter({ windowMs: 60_000, max: 60, message: "Sessions API rate limit exceeded" });

// Mount sessions API
app.use("/sessions", sessionsLimiter, createSessionsRouter(sessionRecorder));

// ── Analytics Service + API ───────────────────────────────────────────
const analyticsService = new AnalyticsService(sessionRecorder);
app.use("/analytics", analyticsLimiter, createAnalyticsRouter(analyticsService));

// ── Tenant Registry + Admin API ──────────────────────────────────────
initTenantRegistry(resolve(dirname(config.storage.databasePath), "tenants.json"));
app.use("/admin", adminLimiter, createAdminRouter(tenantRegistry, systemConfigStore));

// ── Conversation Memory Store + API ─────────────────────────────────
const memoryStore = initConversationMemoryStore(resolve(dirname(config.storage.databasePath), "memory"));
app.use("/tenants", createMemoryRouter(memoryStore));

// ── Voice Profile Store + Voices API ─────────────────────────────────
const voiceProfileStore = initVoiceProfileStore(resolve(dirname(config.storage.databasePath), "voices"));
const kokoroEngine = new KokoroVoiceEngine();
const voiceAbTestService = initVoiceAbTestService(resolve(dirname(config.storage.databasePath), "voice-abtests.json"));
app.use("/voices", createVoicesRouter(voiceProfileStore, kokoroEngine, voiceAbTestService));

// ── Knowledge Base Store + KB API ────────────────────────────────────
const kbStore = initKnowledgeBaseStore(resolve(dirname(config.storage.databasePath), "kb"));
app.use("/tenants", createKnowledgeRouter(kbStore));

// ── Agent Template Store + Templates API ─────────────────────────────
const templateStore = initAgentTemplateStore(resolve(dirname(config.storage.databasePath), "templates.json"));
app.use("/templates", createTemplatesRouter(templateStore));

// ── Language Detection + Routing API ──────────────────────────────────
app.use("/language", createLanguageRouter(templateStore));

// ── IVR Menu Store + IVR API ──────────────────────────────────────────
const ivrStore = initIvrMenuStore(resolve(dirname(config.storage.databasePath), "ivr-menus.json"));
app.use("/ivr", createIvrRouter(ivrStore));

// ── Voice Quality Scoring ─────────────────────────────────────────────
const voiceQualityScorer = new VoiceQualityScorer({ qualityThreshold: 70 });
app.use("/quality", createQualityRouter(sessionRecorder, voiceQualityScorer));

// ── Conversation Playbook ─────────────────────────────────────────────
const playbookStore = initPlaybookStore(resolve(dirname(config.storage.databasePath), "playbooks.json"));
app.use("/playbooks", createPlaybooksRouter(playbookStore));

// ── Tenant Compliance Report ──────────────────────────────────────────
app.use("/tenants", createTenantComplianceRouter(sessionRecorder, analyticsService));

// ── Voice Biometrics (D-162) ──────────────────────────────────────────
const voiceprintStore = initVoiceprintStore(resolve(dirname(config.storage.databasePath), "voiceprints.json"));
app.use("/voiceprints", createVoiceprintsRouter(voiceprintStore, memoryStore));

// ── Agent Personas (D-189) ────────────────────────────────────────────
const personaStore = initPersonaStore(resolve(dirname(config.storage.databasePath), "personas.json"));
app.use("/personas", createPersonasRouter(personaStore));
app.use("/tenants", createTenantPersonaRouter(personaStore));

// ── Conversation Flow Builder (D-201) ─────────────────────────────────
const flowStore = initFlowStore(resolve(dirname(config.storage.databasePath), "flows.json"));
const flowEngine = new FlowEngine(flowStore);
app.use("/flows", createFlowsRouter(flowStore, flowEngine));

// ── Real-Time Translation (D-202) ────────────────────────────────────
app.use("/translation", createTranslationRouter(translationService));

// ── Intent Detection (D-212) ─────────────────────────────────────────
const intentClassifier = new IntentClassifier();
const intentStore = initIntentStore(resolve(dirname(config.storage.databasePath), "intents.json"));
app.use("/intents", createIntentsRouter(intentClassifier, intentStore));

// ── Pipeline Profiler (D-213) ─────────────────────────────────────────
app.use("/sessions", createProfilerRouter(pipelineProfiler));

// ── Call Recording Export API ─────────────────────────────────────────
app.use("/recordings", createRecordingsRouter(recordingStore));

// ── Agent A/B Testing Framework ───────────────────────────────────────
const agentAbTestService = initAgentAbTestService(resolve(dirname(config.storage.databasePath), "agent-abtests.json"));
app.use("/abtests", createAbTestsRouter(agentAbTestService));
app.get("/abtests/dashboard", (_req, res) => {
  res.type("html").send(abTestDashboardHtml());
});

// ── Health Monitor ────────────────────────────────────────────────────
const healthChecks = createVoiceAgentHealthChecks({
  opaEnabled: config.opa.enabled,
  sqlitePath: config.storage.databasePath,
  postgresUrl: process.env.DATABASE_URL,
});
export const healthMonitor = new HealthMonitorService(healthChecks, {
  intervalMs: 10_000,
  webhookUrl: process.env.HEALTH_WEBHOOK_URL,
  failureThreshold: 2,
});
app.use("/health", createHealthRouter(healthMonitor));
app.get("/health/monitor", (_req, res) => {
  res.type("html").send(healthMonitorDashboardHtml());
});

// ── Session Config Validator ──────────────────────────────────────────
const configValidator = new ConfigValidator(config);
app.use("/validate", createValidateRouter(configValidator));

// ── Tenant Config Migration (export/import) ───────────────────────────
const tenantMigrator = new TenantConfigMigrator(tenantRegistry, personaStore, kbStore, playbookStore, ivrStore);
app.use("/tenants", createTenantMigrationRouter(tenantMigrator));

// ── Conversation Search ───────────────────────────────────────────────
const conversationSearch = new ConversationSearchService(sessionRecorder);
app.use("/search", createSearchRouter(conversationSearch));

// ── Session Export ────────────────────────────────────────────────────
const sessionExportService = new SessionExportService(sessionRecorder, recordingStore, voiceQualityScorer);
app.use("/export", createExportRouter(sessionExportService));

// ── SLA Monitor ───────────────────────────────────────────────────────
export const slaMonitor = new SlaMonitor({
  windowMinutes: 60,
  webhookUrl: process.env.SLA_WEBHOOK_URL,
});
app.use("/sla", createSlaRouter(slaMonitor));

// ── Live KB Search ────────────────────────────────────────────────────
const liveKbSearch = new LiveKbSearchService(kbStore);
app.use("/kb-search", createKbSearchRouter(liveKbSearch));

// ── Training Mode ─────────────────────────────────────────────────────
const trainingDataService = initTrainingDataService(resolve(dirname(config.storage.databasePath), "training-data.json"));
app.use("/training", createTrainingRouter(trainingDataService));

// ── Agent Performance Comparison ─────────────────────────────────────
const agentComparisonService = new AgentComparisonService(sessionRecorder, voiceQualityScorer);
app.use("/compare-agents", createCompareAgentsRouter(agentComparisonService));
app.get("/compare-agents/dashboard", (_req, res) => {
  res.type("html").send(compareAgentsDashboardHtml());
});

// ── Audit Report Generator ────────────────────────────────────────────
const auditReportService = new AuditReportService(sessionRecorder, voiceQualityScorer);
app.use("/audit", createAuditReportRouter(auditReportService));

// ── Compliance Dashboard ──────────────────────────────────────────────
const complianceDashboardService = new ComplianceDashboardService(
  tenantRegistry,
  sessionRecorder,
  recordingRetentionDays,
);
app.use("/compliance-dashboard", createComplianceDashboardRouter(complianceDashboardService));

// ── Tenant Onboarding Wizard ──────────────────────────────────────────
const onboardingWizardService = initOnboardingWizardService(resolve(dirname(config.storage.databasePath), "onboarding.json"));
app.use("/onboarding", createOnboardingRouter(onboardingWizardService));

// ── Webhook Management ────────────────────────────────────────────────
const webhookService = initWebhookService(resolve(dirname(config.storage.databasePath), "webhooks.json"));
app.use("/webhooks", createWebhooksRouter(webhookService));

// ── Capacity Planner ──────────────────────────────────────────────────
const capacityPlannerService = new CapacityPlannerService();
app.use("/capacity", createCapacityPlannerRouter(capacityPlannerService));

// ── Skill System ──────────────────────────────────────────────────────
const skillStore = initSkillStore(resolve(dirname(config.storage.databasePath), "skills.json"));
app.use("/skills", createSkillsRouter(skillStore));

// ── Agent Version Management ──────────────────────────────────────────
const agentVersionStore = initAgentVersionStore(resolve(dirname(config.storage.databasePath), "agent-versions.json"));
app.use("/agent-versions", createAgentVersionsRouter(agentVersionStore));

// ── Conversation Analytics ────────────────────────────────────────────
const conversationAnalytics = new ConversationAnalyticsService(sessionRecorder);
app.use("/analytics/conversations", createConversationAnalyticsRouter(conversationAnalytics));

// ── Call Routing + Queue System ───────────────────────────────────────
const routingEngine = initRoutingEngine(resolve(dirname(config.storage.databasePath), "routing-rules.json"));
const callQueue = new CallQueueService();
app.use("/routing", createRoutingRouter(routingEngine, callQueue));

// ── Supervisor System ─────────────────────────────────────────────────
app.use("/supervisor", createSupervisorRouter(supervisorRegistry, sessionManager));
const supervisorWsServer = new SupervisorWebSocketServer(supervisorRegistry, sessionManager);

// ── Voice Trigger Service + Voice API ────────────────────────────────
export const voiceTriggerService = new VoiceTriggerService(
  `http://localhost:${config.port}`,
  systemConfigStore,
);
app.use("/voice", voiceLimiter, createVoiceRouter(voiceTriggerService, `http://localhost:${config.port}`));

async function startServer(): Promise<void> {
  // Initialize OPA singleton before accepting any sessions
  const opaEvaluator = await initializeOpa();

  // Start health monitor
  healthMonitor.start();

  // Initialize WebSocket server — passes pre-initialized OPA singleton
  // so every per-session ControlEngine receives the same loaded bundle.
  const fpBaseUrl = process.env.FAULTLINE_API_URL ?? "http://localhost:3001";
  const fpApiKey = process.env.FAULTLINE_API_KEY ?? "";
  const verificationService = fpApiKey
    ? new ClaimVerificationService(fpBaseUrl, fpApiKey)
    : undefined;
  const voiceWss = new VoiceWebSocketServer(server, opaEvaluator, sessionRecorder, voiceTriggerService, memoryStore, voiceProfileStore, kbStore, verificationService, recordingStore);

  // Register whisper handler so supervisors can inject hints into live sessions
  supervisorRegistry.setWhisperHandler((sessionId, message) => voiceWss.injectWhisper(sessionId, message));

  // Route /supervisor path upgrades to the supervisor WS server
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/supervisor") {
      supervisorWsServer.handleUpgrade(request, socket, head);
    }
  });

  // Demo mode banner
  const demoScenario = process.env.DEMO_SCENARIO;
  if (demoScenario) {
    try {
      const { getDemoScenario } = await import("./demo/fixtures.js");
      const scenario = getDemoScenario(demoScenario as import("./demo/fixtures.js").DemoScenarioId);
      console.log("\n╔══════════════════════════════════════════════╗");
      console.log(`║  DEMO MODE: ${scenario.name.padEnd(33)}║`);
      console.log(`║  Template: ${scenario.templateId.padEnd(34)}║`);
      console.log(`║  ${scenario.description.slice(0, 44).padEnd(44)}║`);
      console.log("╚══════════════════════════════════════════════╝\n");
    } catch {
      console.warn("[Demo] Unknown DEMO_SCENARIO:", demoScenario);
    }
  }

  server.listen(config.port, () => {
    console.log(
      "\n╔══════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║                                                          ║",
    );
    console.log(
      "║  🎙️  Voice Jib-Jab Server                                ║",
    );
    console.log(
      "║  NextGen AI Voice Orchestrator                           ║",
    );
    console.log(
      "║                                                          ║",
    );
    console.log(
      "╚══════════════════════════════════════════════════════════╝\n",
    );

    console.log(`[Server] Listening on port ${config.port}`);
    console.log(`[Server] Environment: ${config.nodeEnv}`);
    console.log(`[Server] WebSocket: ws://localhost:${config.port}`);
    console.log(`[Server] Health: http://localhost:${config.port}/health`);
    console.log(`[Server] Status: http://localhost:${config.port}/status`);
    console.log(`[Server] Metrics: http://localhost:${config.port}/metrics`);
    console.log(`[Server] Dashboard: http://localhost:${config.port}/dashboard`);
    console.log(`[Server] Sessions: http://localhost:${config.port}/sessions`);
    console.log(`[Server] Analytics: http://localhost:${config.port}/analytics/sessions`);
    console.log(`[Server] Admin API: http://localhost:${config.port}/admin`);
    console.log(`[Server] Memory API: http://localhost:${config.port}/tenants/{tenantId}/memory`);
    console.log(`[Server] Voice Triggers: http://localhost:${config.port}/voice/trigger`);
    console.log(`[Server] Voices API: http://localhost:${config.port}/voices`);
    console.log(`[Server] Knowledge Base: http://localhost:${config.port}/tenants/{tenantId}/kb`);
    console.log(`[Server] Routing API: http://localhost:${config.port}/routing/rules`);
    console.log(`[Server] Templates API: http://localhost:${config.port}/templates`);
    console.log(`[Server] Supervisor WS: ws://localhost:${config.port}/supervisor`);
    console.log(`[Server] Voiceprints API: http://localhost:${config.port}/voiceprints`);
    console.log(`[Server] Voice A/B Tests: http://localhost:${config.port}/voices/abtests`);
    console.log(`[Server] Agent A/B Tests: http://localhost:${config.port}/abtests`);
    console.log(`[Server] A/B Dashboard:   http://localhost:${config.port}/abtests/dashboard`);
    console.log(`[Server] Health Monitor:  http://localhost:${config.port}/health/monitor`);
    console.log(`[Server] Health API:      http://localhost:${config.port}/health/subsystems`);
    console.log(`[Server] Config Validate: http://localhost:${config.port}/validate`);
    console.log(`[Server] Conversation Search: http://localhost:${config.port}/search/conversations`);
    console.log(`[Server] Session Export:   http://localhost:${config.port}/export/sessions`);
    console.log(`[Server] SLA Monitor:     http://localhost:${config.port}/sla/dashboard`);
    console.log(`[Server] Live KB Search:  http://localhost:${config.port}/kb-search`);
    console.log(`[Server] Training Mode:   http://localhost:${config.port}/training/annotations`);
    console.log(`[Server] Agent Compare:   http://localhost:${config.port}/compare-agents/dashboard`);
    console.log(`[Server] Audit Reports:   http://localhost:${config.port}/audit/report`);
    console.log(`[Server] Compliance:      http://localhost:${config.port}/compliance-dashboard/dashboard`);
    console.log(`[Server] Onboarding:      http://localhost:${config.port}/onboarding/wizard`);
    console.log(`[Server] Webhooks:        http://localhost:${config.port}/webhooks`);
    console.log(`[Server] Capacity:        http://localhost:${config.port}/capacity/calculator`);
    console.log(`[Server] Skills:          http://localhost:${config.port}/skills`);
    console.log(`[Server] Agent Versions:  http://localhost:${config.port}/agent-versions`);
    console.log(`[Server] Conv Analytics:  http://localhost:${config.port}/analytics/conversations/dashboard\n`);

    console.log("Features:");
    console.log(
      `  Lane A (Reflex): ${config.features.enableLaneA ? "✓" : "✗"}`,
    );
    console.log(`  RAG: ${config.features.enableRAG ? "✓" : "✗"}`);
    console.log(
      `  Policy Gate: ${config.features.enablePolicyGate ? "✓" : "✗"}`,
    );
    console.log(
      `  Audit Trail: ${config.features.enableAuditTrail ? "✓" : "✗"}`,
    );
    console.log(`  OPA Engine: ${opaEvaluator ? "✓" : "✗ (disabled)"}\n`);

    console.log("Latency Targets:");
    console.log(`  TTFB p50: <${config.latency.ttfbTargetP50}ms`);
    console.log(`  TTFB p95: <${config.latency.ttfbTargetP95}ms`);
    console.log(`  Barge-in p95: <${config.latency.bargeInTargetP95}ms\n`);

    console.log("Ready for connections! 🚀\n");

    // Schedule daily recording retention pruning (runs 24h after server start)
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    setInterval(() => {
      recordingStore.pruneExpired().then((count) => {
        if (count > 0) console.log(`[RecordingStore] Pruned ${count} expired recording(s)`);
      }).catch((err) => console.error("[RecordingStore] Prune failed:", err));
    }, ONE_DAY_MS).unref();
  });
}

startServer().catch((error) => {
  console.error("[Server] Fatal startup error:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n[Server] SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("[Server] HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\n[Server] SIGINT received, shutting down gracefully...");
  server.close(() => {
    console.log("[Server] HTTP server closed");
    process.exit(0);
  });
});
