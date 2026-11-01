import { createClient } from "npm:@supabase/supabase-js@2";
import {
  constantTimeEqual,
  hmacSha256Hex,
  jsonResponse,
  requiredEnv,
  safeText,
  sha256Hex,
} from "../_shared/duitku.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ??
      "";
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      return new Response("Unsupported Media Type", { status: 415 });
    }

    const form = new URLSearchParams(await request.text());
    const merchantCode = safeText(form.get("merchantCode"), 30);
    const amountText = safeText(form.get("amount"), 30);
    const merchantOrderId = safeText(form.get("merchantOrderId"), 100);
    const reference = safeText(form.get("reference"), 100);
    const signature = safeText(form.get("signature"), 128)?.toLowerCase() ?? "";
    const resultCode = safeText(form.get("resultCode"), 10);
    const paymentCode = safeText(form.get("paymentCode"), 30);

    if (
      !merchantCode || !amountText || !merchantOrderId || !reference ||
      !signature || !resultCode || !/^\d+$/.test(amountText) ||
      !/^[a-f0-9]{64}$/.test(signature)
    ) {
      return new Response("Bad Request", { status: 400 });
    }

    const expectedMerchantCode = requiredEnv("DUITKU_MERCHANT_CODE");
    const apiKey = requiredEnv("DUITKU_API_KEY");
    if (!constantTimeEqual(merchantCode, expectedMerchantCode)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const expectedSignature = await hmacSha256Hex(
      apiKey,
      merchantCode + amountText + merchantOrderId,
    );
    if (!constantTimeEqual(signature, expectedSignature)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const amount = Number(amountText);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return new Response("Bad Request", { status: 400 });
    }

    const safePayload = {
      merchantCode,
      amount: amountText,
      merchantOrderId,
      reference,
      resultCode,
      paymentCode,
      publisherOrderId: safeText(form.get("publisherOrderId"), 100),
      settlementDate: safeText(form.get("settlementDate"), 20),
      issuerCode: safeText(form.get("issuerCode"), 30),
      transactionState: safeText(form.get("transactionState"), 50),
      transactionStateStatus: safeText(form.get("transactionStateStatus"), 50),
    };
    const eventKey = await sha256Hex([
      merchantCode,
      amountText,
      merchantOrderId,
      reference,
      resultCode,
      paymentCode ?? "",
    ].join("|"));

    const creditCardMethods =
      (Deno.env.get("DUITKU_CREDIT_CARD_PAYMENT_METHODS") ?? "")
        .split(",").map((value) => value.trim()).filter(Boolean);

    const supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data, error } = await supabase.rpc("apply_duitku_callback", {
      p_event_key: eventKey,
      p_merchant_code: merchantCode,
      p_amount: amount,
      p_merchant_order_id: merchantOrderId,
      p_reference: reference,
      p_result_code: resultCode,
      p_payment_code: paymentCode,
      p_credit_card_payment_methods: creditCardMethods,
      p_safe_payload: safePayload,
    });

    if (error) {
      // Return a server error so transient database failures are not acknowledged.
      return new Response("Callback Processing Failed", { status: 500 });
    }

    const result = data as { ok?: boolean };
    if (!result?.ok) {
      return new Response("Callback Processing Failed", { status: 500 });
    }

    // POP docs describe the callback POST and signature but do not prescribe
    // a response body; acknowledge only after the database transaction commits.
    return new Response("OK", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return jsonResponse(500, { error: "callback_processing_failed" });
  }
});
