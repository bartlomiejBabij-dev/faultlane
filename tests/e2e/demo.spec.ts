import { expect, test } from "@playwright/test";

test("manual loading cannot be clicked before hydration and works afterwards", async ({ browser, page }, info) => {
  const noJavaScript = await browser.newContext({ javaScriptEnabled: false });
  try {
    const unhydrated = await noJavaScript.newPage();
    await unhydrated.goto(new URL("/demo?mode=manual", String(info.project.use.baseURL)).href);
    await expect(unhydrated.getByRole("button", { name: "Load Projects" })).toBeDisabled();
  } finally { await noJavaScript.close(); }
  await page.goto("/demo?mode=manual");
  const button = page.getByRole("button", { name: "Load Projects" });
  await expect(button).toBeEnabled();
  const request = page.waitForRequest((item) => item.url().includes("/api/demo/projects") && item.method() === "GET");
  await button.click();
  await request;
  await expect(page.getByTestId("projects")).toContainText("Atlas API");
});

test("HTTP 500 shows an error, clears loading and can recover on retry", async ({ page }) => {
  let intercepted = 0;
  await page.route("**/api/demo/projects", async (route) => {
    intercepted++;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated server error" }) });
  });
  await page.goto("/demo");
  await expect(page.getByTestId("server")).toContainText("couldn’t load");
  await expect(page.getByTestId("retry")).toBeVisible();
  await expect(page.getByTestId("loading")).toBeHidden();
  expect(intercepted).toBeGreaterThan(0);
  await page.unroute("**/api/demo/projects");
  await page.getByTestId("retry").click();
  await expect(page.getByTestId("projects")).toContainText("Atlas API");
  await expect(page.getByTestId("error")).toBeHidden();
});
