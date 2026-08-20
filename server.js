// api/server.js
// ─────────────────────────────────────────────────────────────────────────────
// Manitoba ER Wait Times – Secure Express API
// ─────────────────────────────────────────────────────────────────────────────
// Serves historical and live wait time data from Supabase.
// Security layers applied:
//   • Helmet  – sets secure HTTP response headers
//   • CORS    – restricts origin to your frontend domain(s) only
//   • express-rate-limit – global + per-route limits
//   • Input validation   – query params sanitized before DB calls
//   • No raw SQL         – all queries go through the Supabase client
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// ── Env validation ────────────────────────────────────────────────────────────
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "FRONTEND_ORIGIN"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required env variable: ${key}`);
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT ?? "4000", 10);

// Origin headers never carry a trailing slash or whitespace, but env vars
// pasted into a hosting dashboard often do — normalize both sides so a
// stray "/" or space doesn't silently break every CORS check.
const normalizeOrigin = (origin) => origin?.trim().replace(/\/+$/, "");

const FRONTEND_ORIGIN = normalizeOrigin(process.env.FRONTEND_ORIGIN); // e.g. https://winnipeg-er-tracker.vercel.app
if (!FRONTEND_ORIGIN) {
  console.error("[FATAL] FRONTEND_ORIGIN is set but empty/whitespace after trimming.");
  process.exit(1);
}

// supabase-js appends `/rest/v1` (and other API paths) onto SUPABASE_URL itself,
// so the env var must be the bare project domain — a `/rest/v1` suffix here
// causes every query to hit a doubled `/rest/v1/rest/v1/...` path, which
// Supabase's gateway rejects with "Invalid path specified in request URL".
if (/\/rest\/v1\/?$/.test(process.env.SUPABASE_URL)) {
  console.error(
    `[FATAL] SUPABASE_URL must not include a /rest/v1 suffix (the client appends it automatically): ${process.env.SUPABASE_URL}`
  );
  process.exit(1);
}

// Supabase client – service role key, used only server-side, never exposed to browser
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── 1. Helmet – secure HTTP headers ──────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", process.env.SUPABASE_URL],
      },
    },
    crossOriginEmbedderPolicy: false, // allow charts/images in iframes if needed
  })
);

// ── 2. CORS – only allow your frontend ───────────────────────────────────────
const allowedOrigins = [
  FRONTEND_ORIGIN,
  // Add "http://localhost:5173" here ONLY during local dev (remove before production)
  ...(process.env.NODE_ENV === "development" ? ["http://localhost:5173"] : []),
];

app.use(
  cors({
    origin(requestOrigin, callback) {
      // Requests with no Origin header (health checks, curl, direct browser
      // navigation, server-to-server calls) are never subject to CORS in the
      // first place — only the browser sends/enforces Origin for cross-origin
      // fetches — so always allow them, not just in development.
      if (!requestOrigin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(normalizeOrigin(requestOrigin))) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${requestOrigin}' not allowed`));
      }
    },
    methods: ["GET"],               // read-only API – no POST/DELETE needed
    allowedHeaders: ["Content-Type"],
    credentials: false,             // no cookies; we use service key server-side only
    maxAge: 600,                    // preflight cache: 10 minutes
  })
);

// ── 3. Rate limiting ──────────────────────────────────────────────────────────

// Global limiter – reasonable baseline for any public API
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 200,                    // 200 requests per IP per window
  standardHeaders: true,       // send RateLimit-* headers
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait and try again." },
});
app.use(globalLimiter);

// Strict limiter for heavy endpoints (trend data = large payloads)
const strictLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,   // 5 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded on this endpoint. Try again in 5 minutes." },
});

// ── 4. Routes ─────────────────────────────────────────────────────────────────

// Health check (for Netlify/Render uptime monitoring)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// GET /api/hospitals
// Returns the list of all active hospitals.
app.get("/api/hospitals", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("hospitals")
      .select("id, name, short_name, type, region, city")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;
    res.json({ hospitals: data });
  } catch (err) {
    console.error("[/api/hospitals]", err.message);
    res.status(500).json({ error: "Failed to fetch hospitals." });
  }
});

// GET /api/wait-times/latest
// Returns the most recent wait time reading for each hospital.
app.get("/api/wait-times/latest", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("latest_wait_times")   // the VIEW from schema.sql
      .select("*");

    if (error) throw error;
    res.json({ wait_times: data, fetched_at: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/wait-times/latest]", err.message);
    res.status(500).json({ error: "Failed to fetch latest wait times." });
  }
});

// GET /api/wait-times/history?hospital_id=1&hours=24
// Returns raw readings for a specific hospital over the last N hours.
// hospital_id: required integer
// hours:       optional integer, 1–168 (1 week max), default 24
app.get("/api/wait-times/history", strictLimiter, async (req, res) => {
  const hospitalId = parseInt(req.query.hospital_id, 10);
  const hours = Math.min(parseInt(req.query.hours ?? "24", 10), 168);

  if (!hospitalId || isNaN(hospitalId) || hospitalId < 1) {
    return res.status(400).json({ error: "hospital_id must be a positive integer." });
  }
  if (isNaN(hours) || hours < 1) {
    return res.status(400).json({ error: "hours must be between 1 and 168." });
  }

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("wait_times_log")
      .select("scraped_at, wait_time_minutes, patients_waiting, scrape_status")
      .eq("hospital_id", hospitalId)
      .eq("scrape_status", "ok")
      .gte("scraped_at", since)
      .order("scraped_at", { ascending: true });

    if (error) throw error;
    res.json({ hospital_id: hospitalId, hours, readings: data });
  } catch (err) {
    console.error("[/api/wait-times/history]", err.message);
    res.status(500).json({ error: "Failed to fetch history." });
  }
});

// GET /api/wait-times/trends?hours=24
// Returns aggregated readings for ALL hospitals over the last N hours.
// This is what the multi-line Recharts chart consumes.
app.get("/api/wait-times/trends", strictLimiter, async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours ?? "24", 10), 168);

  if (isNaN(hours) || hours < 1) {
    return res.status(400).json({ error: "hours must be between 1 and 168." });
  }

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("wait_times_log")
      .select(
        "scraped_at, wait_time_minutes, patients_waiting, hospital_id, hospitals(short_name)"
      )
      .eq("scrape_status", "ok")
      .gte("scraped_at", since)
      .order("scraped_at", { ascending: true });

    if (error) throw error;
    res.json({ hours, readings: data });
  } catch (err) {
    console.error("[/api/wait-times/trends]", err.message);
    res.status(500).json({ error: "Failed to fetch trends." });
  }
});

// GET /api/wait-times/daily-stats?hospital_id=1
// Returns pre-aggregated daily stats from the materialized view.
app.get("/api/wait-times/daily-stats", strictLimiter, async (req, res) => {
  const hospitalId = parseInt(req.query.hospital_id, 10);

  if (!hospitalId || isNaN(hospitalId) || hospitalId < 1) {
    return res.status(400).json({ error: "hospital_id must be a positive integer." });
  }

  try {
    const { data, error } = await supabase
      .from("daily_wait_time_stats")
      .select("stat_date, avg_wait_minutes, min_wait_minutes, max_wait_minutes, median_wait_minutes")
      .eq("hospital_id", hospitalId)
      .order("stat_date", { ascending: false })
      .limit(30); // last 30 days

    if (error) throw error;
    res.json({ hospital_id: hospitalId, stats: data });
  } catch (err) {
    console.error("[/api/wait-times/daily-stats]", err.message);
    res.status(500).json({ error: "Failed to fetch daily stats." });
  }
});

// ── 5. 404 + global error handler ────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found." });
});

// Catches CORS errors and other thrown errors
app.use((err, _req, res, _next) => {
  if (err.message?.startsWith("CORS:")) {
    return res.status(403).json({ error: err.message });
  }
  console.error("[Unhandled error]", err);
  res.status(500).json({ error: "Internal server error." });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[API] Running on port ${PORT} | ENV: ${process.env.NODE_ENV ?? "development"}`);
  console.log(`[API] Allowed origin: ${FRONTEND_ORIGIN}`);
});
