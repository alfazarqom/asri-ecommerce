import {
  duitkuTransactionStatusEndpoint,
  isValidEmail,
  isVerifiedTransactionStatus,
} from "./duitku.ts";

Deno.test("email validator accepts valid customer addresses", () => {
  if (!isValidEmail("buyer@example.com")) {
    throw new Error("Expected a valid email to pass");
  }
  if (!isValidEmail("buyer.name+order@example.co.id")) {
    throw new Error("Expected a valid subdomain email to pass");
  }
});

Deno.test("email validator rejects malformed or oversized values", () => {
  for (const value of [
    "",
    "buyer",
    "buyer@",
    "@example.com",
    "buyer@example",
    "buyer @example.com",
    "buyer@example.com ",
    "a".repeat(256) + "@example.com",
  ]) {
    if (isValidEmail(value)) {
      throw new Error(`Expected invalid email to fail: ${value}`);
    }
  }
});

Deno.test("transaction status response must match order, reference, amount and status", () => {
  const expected = {
    merchantOrderId: "order-123",
    reference: "DXXXXREF123",
    amount: 150000,
  };
  const valid = {
    merchantOrderId: "order-123",
    reference: "DXXXXREF123",
    amount: "150000",
    statusCode: "00",
  };
  if (!isVerifiedTransactionStatus(valid, expected)) {
    throw new Error("Expected matching provider status to pass");
  }

  for (const altered of [
    { ...valid, merchantOrderId: "other-order" },
    { ...valid, reference: "other-reference" },
    { ...valid, amount: "150001" },
    { ...valid, statusCode: "99" },
  ]) {
    if (isVerifiedTransactionStatus(altered, expected)) {
      throw new Error("Expected mismatched provider status to fail");
    }
  }
});

Deno.test("transaction status endpoint follows the selected environment", () => {
  if (
    duitkuTransactionStatusEndpoint("sandbox") !==
      "https://sandbox.duitku.com/webapi/api/merchant/transactionStatus"
  ) {
    throw new Error("Unexpected sandbox transaction status endpoint");
  }
  if (
    duitkuTransactionStatusEndpoint("production") !==
      "https://passport.duitku.com/webapi/api/merchant/transactionStatus"
  ) {
    throw new Error("Unexpected production transaction status endpoint");
  }
});
