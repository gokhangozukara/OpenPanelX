import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("setup, nonce CSP, theme persistence, Notes search/add/edit/CSV/delete, and user role updates", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // 1. First run redirects to /setup and issues a strict nonce-based CSP header
  const setupResponse = await page.goto("/");
  expect(setupResponse).not.toBeNull();
  const csp = setupResponse?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("'nonce-");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(csp).not.toMatch(/style-src[^;]*'unsafe-inline'/);

  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel("Username").fill("e2e-admin");
  await page.getByLabel("Password").fill("E2ePass2026!");
  await page.getByRole("button", { name: "Create admin and continue" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /Welcome back, e2e-admin/i })).toBeVisible();

  // Ensure English UI for consistent assertions
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");

  // 2. Toggle Dark theme and confirm nonce-authorized inline THEME_SCRIPT persists across reload
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // 3. Notes plugin: search, add, inline edit + reload persistence, CSV export + formula escaping, delete
  await page.getByRole("link", { name: "Notes", exact: true }).click();
  await expect(page).toHaveURL(/\/plugins\/notes$/);

  const tableRows = page.locator("tbody tr");
  await expect(tableRows).toHaveCount(3);

  const search = page.getByPlaceholder("Search...");
  await search.fill("first");
  await expect(tableRows).toHaveCount(1);
  await expect(tableRows.first()).toContainText("Plan the first release");

  await search.fill("zzz-no-match");
  await expect(page.getByText("No matching rows.")).toBeVisible();

  await search.fill("");
  await expect(tableRows).toHaveCount(3);

  // Add a row
  await page.getByLabel("Title").fill("E2E Task");
  await page.getByLabel("Owner").fill("e2e-admin");
  await page.getByLabel("Status").fill("Todo");
  await page.getByRole("button", { name: "Add row" }).click();
  await expect(tableRows).toHaveCount(4);

  // Inline Edit -> Save -> reload persistence
  const addedRow = tableRows.filter({ hasText: "E2E Task" });
  await addedRow.getByRole("button", { name: "Edit" }).click();
  const statusInput = page.locator("tbody tr input[name='status']");
  await expect(statusInput).toBeVisible();
  await statusInput.fill("Done");
  await page.locator("tbody tr").getByRole("button", { name: "Save" }).click();

  await expect(page.locator("tbody tr input[name='status']")).toHaveCount(0);
  await expect(tableRows.filter({ hasText: "E2E Task" })).toContainText("Done");

  await page.reload();
  await expect(tableRows.filter({ hasText: "E2E Task" })).toContainText("Done");

  // Add formula-like cell to verify CSV formula neutralization
  await page.getByLabel("Title").fill("=SUM(A1:A2)");
  await page.getByLabel("Owner").fill("qa");
  await page.getByLabel("Status").fill("Check");
  await page.getByRole("button", { name: "Add row" }).click();
  await expect(tableRows).toHaveCount(5);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("notes-table-1.csv");
  const csvPath = await download.path();
  expect(csvPath).toBeTruthy();
  const csvContent = readFileSync(csvPath as string, "utf8");
  expect(csvContent.startsWith("\uFEFFTitle,Owner,Status")).toBe(true);
  expect(csvContent).toContain("E2E Task,e2e-admin,Done");
  expect(csvContent).toContain("'=SUM(A1:A2),qa,Check");

  // Clean up both added rows
  await tableRows.filter({ hasText: "=SUM(A1:A2)" }).getByRole("button", { name: "Delete" }).click();
  await expect(tableRows).toHaveCount(4);
  await tableRows.filter({ hasText: "E2E Task" }).getByRole("button", { name: "Delete" }).click();
  await expect(tableRows).toHaveCount(3);

  // 4. Users page: create user, update role inline, delete user
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/\/users$/);
  await page.getByLabel("Username").fill("e2e-viewer");
  await page.getByLabel("Password").fill("ViewerPass123!");
  await page.locator("select#role").selectOption("viewer");
  await page.getByRole("button", { name: "Add user" }).click();

  const viewerRow = page.locator("tbody tr").filter({ hasText: "e2e-viewer" });
  await expect(viewerRow).toContainText("Viewer");
  await viewerRow.locator("select[name='role']").selectOption("editor");
  await viewerRow.getByRole("button", { name: "Save" }).click();
  await expect(viewerRow).toContainText("Editor");

  await viewerRow.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("tbody tr").filter({ hasText: "e2e-viewer" })).toHaveCount(0);

  // 5. Settings page: verify 2FA QR SVG setup renders cleanly under strict nonce CSP (no inline style violations)
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("button", { name: "Set up" }).click();
  await expect(page.locator("main svg").first()).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
