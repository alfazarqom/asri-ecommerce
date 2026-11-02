import { expect, test } from "@playwright/test";

const orderId = "ASRI-0123456789ABCDEF0123456789ABCDEF";

test.beforeEach(async ({ page }) => {
  await page.route("**/functions/v1/get-asri-products*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
});

test("payment page requests a server-created Duitku invoice", async ({ page }) => {
  const paymentUrl =
    "https://app-sandbox.duitku.com/redirect_checkout?reference=CI-REF";
  await page.route("**/functions/v1/create-payment", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      merchant_order_id: orderId,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        merchant_order_id: orderId,
        reference: "CI-REF",
        payment_url: paymentUrl,
        status: "pending",
      }),
    });
  });

  await page.goto(`/payment?orderId=${orderId}`);
  const paymentLink = page.getByRole("link", { name: /Lanjutkan ke Duitku/ });
  await expect(paymentLink).toHaveAttribute("href", paymentUrl);
});

test("guest tracking displays only the server response", async ({ page }) => {
  await page.route("**/functions/v1/order-tracking", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      merchant_order_id: orderId,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        order: {
          merchant_order_id: orderId,
          status: "confirmed",
          payment_status: "paid",
          total_amount: 62000,
          created_at: "2026-11-02T00:00:00.000Z",
          expires_at: "2026-11-03T00:00:00.000Z",
        },
        items: [{
          product_name: "CI Product",
          quantity: 1,
          unit_price: 10000,
        }],
      }),
    });
  });

  await page.goto(`/order-tracking/${orderId}`);
  await expect(page.getByText("confirmed")).toBeVisible();
  await expect(page.getByText("paid")).toBeVisible();
  await expect(page.getByText("CI Product × 1")).toBeVisible();
});

test("payment return query parameters never display a confirmed payment", async ({ page }) => {
  await page.goto(
    `/payment-return?merchantOrderId=${orderId}&resultCode=00&reference=FORGED`,
  );
  await expect(
    page.getByRole("heading", { name: "Pembayaran sedang diverifikasi" }),
  ).toBeVisible();
  await expect(page.getByText(/tidak dianggap sebagai bukti pembayaran berhasil/))
    .toBeVisible();
});
