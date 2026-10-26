import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

const repositoryPath =
  process.platform === "win32"
    ? "C:\\commitpilot-demo\\workspaces\\commitpilot-sample"
    : "/tmp/commitpilot-demo/workspaces/commitpilot-sample";
const screenshotDir = path.resolve("docs", "screenshots");

test("register a repository, run a security review, and export the report", async ({ page }) => {
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /your repository, under review/i }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, "01-dashboard-empty.png"), fullPage: true });

  await page.getByRole("link", { name: /register a repository/i }).first().click();
  await expect(page).toHaveURL(/\/repositories$/);
  await page.getByLabel(/absolute path to a git repository/i).fill(repositoryPath);
  await page.getByRole("button", { name: /register repository/i }).click();

  await expect(page).toHaveURL(/\/repositories\/repo_/);
  await expect(page.getByRole("heading", { name: "commitpilot-sample" })).toBeVisible();
  await expect(page.getByText("Tracked files").first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, "02-repository.png"), fullPage: true });

  await page.getByRole("button", { name: "Security", exact: true }).click();
  await page.getByRole("button", { name: /run analysis/i }).click();
  await expect(page).toHaveURL(/\/analysis\/job_/);

  await expect(page.getByRole("link", { name: /open report/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/findings · [1-9]/i)).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, "03-analysis.png"), fullPage: true });

  const firstFinding = page.locator("li").filter({ hasText: "SQL string concatenation" }).first();
  await expect(firstFinding).toBeVisible();
  await expect(firstFinding.getByText(/static rule/i)).toBeVisible();

  await page.getByRole("link", { name: /open report/i }).click();
  await expect(page).toHaveURL(/\/reports\/report_/);
  await expect(page.getByText("Verification legend")).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, "04-report.png"), fullPage: true });

  const exportHref = await page.getByRole("link", { name: /export \.json/i }).getAttribute("href");
  expect(exportHref).toBeTruthy();
  const exported = await page.request.get(new URL(exportHref as string, "http://127.0.0.1:3101").toString());
  expect(exported.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByRole("link", { name: /commitpilot-sample/i }).first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, "05-dashboard.png"), fullPage: true });

  await page.goto("/settings");
  await expect(page.getByText("Alan AI connector")).toBeVisible();
  await expect(page.getByText(/add custom connector/i)).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, "06-settings.png"), fullPage: true });
});