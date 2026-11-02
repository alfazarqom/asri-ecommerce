import { createClient } from "@supabase/supabase-js";
import {
  asRecord,
  constantTimeEqual,
  duitkuEndpoint,
  duitkuEnvironment,
  hmacSha256Hex,
  isValidEmail,
  jsonResponse,
  requiredEnv,
  safeText,
} from "../_shared/duitku.ts";

type OrderRow = {
  id: string;
  merchant_order_id: string;
  status: string;
  payment_status: string;
  currency: string;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  billing_address: Record<string, unknown>;
  shipping_address: Record<string, unknown>;
  subtotal_amount: number;
  shipping_amount: number;
  total_amount: number;
};

type ItemRow = {
  product_name: string;
  unit_price: number;
  quantity: number;
  sku: string | null;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const internalSecret = requiredEnv("DUITKU_INTERNAL_API_SECRET");
    const suppliedSecret = request.headers.get("x-internal-secret") ?? "";
    if (!constantTimeEqual(suppliedSecret, internalSecret)) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const body = asRecord(await request.json());
    const merchantOrderId = safeText(body.merchant_order_id, 100);
    if (!merchantOrderId) {
      return jsonResponse(400, { error: "merchant_order_id_required" });
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const merchantCode = requiredEnv("DUITKU_MERCHANT_CODE");
    const apiKey = requiredEnv("DUITKU_API_KEY");
    const environment = duitkuEnvironment();
    const callbackUrl = requiredEnv("DUITKU_CALLBACK_URL");
    const returnUrl = requiredEnv("DUITKU_RETURN_URL");
    if (
      new URL(callbackUrl).protocol !== "https:" ||
      new URL(returnUrl).protocol !== "https:"
    ) {
      throw new Error("Duitku callback and return URLs must use HTTPS");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("merchant_order_id", merchantOrderId)
      .maybeSingle();

    if (orderError) throw new Error("Could not load order");
    if (!order) return jsonResponse(404, { error: "order_not_found" });

    const typedOrder = order as OrderRow;
    if (
      typedOrder.status !== "pending_payment" ||
      typedOrder.payment_status !== "pending"
    ) {
      return jsonResponse(409, { error: "order_not_payable" });
    }
    const email = typeof typedOrder.customer_email === "string"
      ? typedOrder.customer_email.trim()
      : "";
    if (!isValidEmail(email)) {
      return jsonResponse(409, { error: "valid_customer_email_required" });
    }
    if (
      typedOrder.currency !== "IDR" ||
      !Number.isSafeInteger(typedOrder.total_amount) ||
      typedOrder.total_amount <= 0 ||
      typedOrder.total_amount !==
        typedOrder.subtotal_amount + typedOrder.shipping_amount
    ) {
      return jsonResponse(409, { error: "invalid_order_total" });
    }

    const { data: existingPayment, error: existingError } = await supabase
      .from("payment_transactions")
      .select("status, payment_url, provider_reference")
      .eq("order_id", typedOrder.id)
      .maybeSingle();

    if (existingError) throw new Error("Could not inspect existing payment");
    if (existingPayment) {
      if (existingPayment.status === "pending" && existingPayment.payment_url) {
        return jsonResponse(200, {
          merchant_order_id: merchantOrderId,
          reference: existingPayment.provider_reference,
          payment_url: existingPayment.payment_url,
          status: "pending",
        });
      }
      return jsonResponse(409, {
        error: "invoice_already_created_or_in_progress",
      });
    }

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("product_name, unit_price, quantity, sku")
      .eq("order_id", typedOrder.id)
      .order("created_at", { ascending: true });

    if (itemsError) throw new Error("Could not load order items");
    const orderItems = (items ?? []) as ItemRow[];
    if (orderItems.length === 0) {
      return jsonResponse(409, { error: "order_has_no_items" });
    }

    let computedSubtotal = 0;
    const itemDetails = orderItems.map((item) => {
      if (
        !Number.isSafeInteger(item.unit_price) || item.unit_price < 0 ||
        !Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
        !item.product_name?.trim()
      ) {
        throw new Error("Invalid order item snapshot");
      }
      computedSubtotal += item.unit_price * item.quantity;
      return {
        name: item.product_name.slice(0, 50),
        price: item.unit_price,
        quantity: item.quantity,
      };
    });

    if (
      !Number.isSafeInteger(computedSubtotal) ||
      computedSubtotal !== typedOrder.subtotal_amount
    ) {
      return jsonResponse(409, { error: "order_items_total_mismatch" });
    }

    if (typedOrder.shipping_amount > 0) {
      itemDetails.push({
        name: "Shipping",
        price: typedOrder.shipping_amount,
        quantity: 1,
      });
    }

    const { data: insertedPayment, error: insertError } = await supabase
      .from("payment_transactions")
      .insert({
        order_id: typedOrder.id,
        merchant_order_id: merchantOrderId,
        provider: "duitku",
        environment,
        status: "creating",
        amount: typedOrder.total_amount,
        currency: "IDR",
        payment_method: safeText(Deno.env.get("DUITKU_PAYMENT_METHOD"), 10),
        request_snapshot: {
          paymentAmount: typedOrder.total_amount,
          itemCount: itemDetails.length,
        },
      })
      .select("id")
      .single();

    if (insertError || !insertedPayment) {
      return jsonResponse(409, { error: "invoice_creation_already_started" });
    }

    const timestamp = Date.now().toString();
    const requestSignature = await hmacSha256Hex(
      apiKey,
      merchantCode + timestamp,
    );
    const firstName = safeText(typedOrder.customer_first_name, 50) ??
      "Customer";
    const lastName = safeText(typedOrder.customer_last_name, 50) ?? "";
    const phoneNumber = safeText(typedOrder.customer_phone, 50) ?? "";
    const customerVaName = `${firstName} ${lastName}`.trim().slice(0, 20);
    const billingAddress = asRecord(typedOrder.billing_address);
    const shippingAddress = asRecord(typedOrder.shipping_address);

    const addressForDuitku = (address: Record<string, unknown>) => ({
      firstName: safeText(address.firstName, 50) ?? firstName,
      lastName: safeText(address.lastName, 50) ?? lastName,
      address: safeText(address.address, 50) ?? "",
      city: safeText(address.city, 50) ?? "",
      postalCode: safeText(address.postalCode, 50) ?? "",
      phone: safeText(address.phone, 50) ?? phoneNumber,
      countryCode: safeText(address.countryCode, 3) ?? "ID",
    });

    const payload: Record<string, unknown> = {
      paymentAmount: typedOrder.total_amount,
      merchantOrderId,
      productDetails: `Order ${merchantOrderId}`.slice(0, 255),
      customerVaName,
      email,
      phoneNumber,
      itemDetails,
      customerDetail: {
        firstName,
        lastName,
        phoneNumber,
        billingAddress: addressForDuitku(billingAddress),
        shippingAddress: addressForDuitku(shippingAddress),
      },
      callbackUrl,
      returnUrl,
    };

    const paymentMethod = safeText(Deno.env.get("DUITKU_PAYMENT_METHOD"), 10);
    if (paymentMethod) payload.paymentMethod = paymentMethod;
    const expiryValue = Deno.env.get("DUITKU_EXPIRY_PERIOD");
    if (expiryValue) {
      const expiryPeriod = Number(expiryValue);
      if (!Number.isInteger(expiryPeriod) || expiryPeriod <= 0) {
        throw new Error("DUITKU_EXPIRY_PERIOD must be a positive integer");
      }
      payload.expiryPeriod = expiryPeriod;
    }

    let providerResponse: Response;
    try {
      providerResponse = await fetch(duitkuEndpoint(environment), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-duitku-merchantcode": merchantCode,
          "x-duitku-timestamp": timestamp,
          "x-duitku-signature": requestSignature,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      // The provider may have received the request even if the response timed out.
      // Keep the transaction in "creating" for callback/manual reconciliation;
      // never create a second invoice automatically.
      return jsonResponse(502, {
        error: "duitku_result_unknown_reconciliation_required",
      });
    }

    const responseText = await providerResponse.text();
    let providerData: Record<string, unknown>;
    try {
      providerData = asRecord(JSON.parse(responseText));
    } catch {
      providerData = {};
    }

    const statusCode = safeText(providerData.statusCode, 10);
    const reference = safeText(providerData.reference, 100);
    const paymentUrl = safeText(providerData.paymentUrl, 2048);
    const statusMessage = safeText(providerData.statusMessage, 255);

    if (
      !providerResponse.ok || statusCode !== "00" || !reference || !paymentUrl
    ) {
      await supabase.from("payment_transactions").update({
        status: "failed",
        provider_result_code: statusCode,
        provider_result_message: statusMessage ??
          `Duitku HTTP ${providerResponse.status}`,
        response_snapshot: {
          statusCode,
          statusMessage,
          httpStatus: providerResponse.status,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", insertedPayment.id);
      return jsonResponse(502, { error: "duitku_invoice_rejected" });
    }

    const { error: saveError } = await supabase
      .from("payment_transactions")
      .update({
        status: "pending",
        provider_reference: reference,
        payment_url: paymentUrl,
        provider_result_code: statusCode,
        provider_result_message: statusMessage,
        response_snapshot: { statusCode, statusMessage, reference },
        updated_at: new Date().toISOString(),
      })
      .eq("id", insertedPayment.id);

    if (saveError) {
      // Provider may have created an invoice. Keep the row in its current state
      // and require manual/provider-side reconciliation; never fabricate success.
      return jsonResponse(502, {
        error: "invoice_created_but_persistence_failed",
      });
    }

    return jsonResponse(200, {
      merchant_order_id: merchantOrderId,
      reference,
      payment_url: paymentUrl,
      status: "pending",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    // Do not expose provider credentials, request signatures, or raw payloads.
    return jsonResponse(500, {
      error: "internal_error",
      detail: message.startsWith("Missing required environment variable:")
        ? message
        : "Invoice creation could not be completed",
    });
  }
});
