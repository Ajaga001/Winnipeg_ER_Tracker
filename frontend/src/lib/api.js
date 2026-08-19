// frontend/src/lib/api.js
// Thin client for the Express API (server.js) — never talks to Supabase directly.

const API_BASE_URL = import.meta.env.VITE_API_URL;

async function apiGet(path) {
  const res = await fetch(`${API_BASE_URL}${path}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

// GET /api/wait-times/latest
export function fetchLatest() {
  return apiGet("/api/wait-times/latest");
}

// GET /api/wait-times/trends?hours=N
export function fetchTrends(hours = 24) {
  return apiGet(`/api/wait-times/trends?hours=${hours}`);
}
