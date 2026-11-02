import { createClient } from "@supabase/supabase-js";
import {
  constantTimeEqual,
  requiredEnv,
} from "../_shared/duitku.ts";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const expectedSecret = requiredEnv("DUITKU_INTERNAL_API_SECRET");
    const suppliedSecret = request.headers.get("x-internal-secret") ?? "";
    if (!constantTimeEqual(suppliedSecret, expectedSecret)) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase.rpc("expire_asri_orders", {
      p_limit: 100,
    });
    if (error) {
      return jsonResponse(500, { error: "expiry_processing_failed" });
    }
    return jsonResponse(200, {
      ok: true,
      result: data,
    });
  } catch {
    return jsonResponse(503, { error: "expiry_worker_unavailable" });
  }
});
