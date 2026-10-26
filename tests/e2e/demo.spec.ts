import { expect, test } from "@playwright/test";

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
