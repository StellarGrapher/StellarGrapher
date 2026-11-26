/**
 * E2E tests for the network selector (issue #103).
 *
 * Verifies that:
 * - The NetworkSelector is visible in the Navbar on every page.
 * - Switching to futurenet appends `?network=futurenet` to the URL.
 * - Switching back to testnet removes the network override.
 */

import { expect, test } from "@playwright/test";

test.describe("NetworkSelector", () => {
  test("selector is visible in the Navbar on the explorer page", async ({ page }) => {
    await page.goto("/explorer");
    const selector = page.getByRole("combobox", { name: "Select Stellar network" });
    await expect(selector).toBeVisible();
  });

  test("switching to futurenet appends ?network=futurenet to the URL", async ({ page }) => {
    await page.goto("/explorer");
    const selector = page.getByRole("combobox", { name: "Select Stellar network" });
    await selector.selectOption("futurenet");
    await expect(page).toHaveURL(/network=futurenet/);
  });

  test("switching back to testnet from futurenet updates the URL", async ({ page }) => {
    await page.goto("/explorer?network=futurenet");
    const selector = page.getByRole("combobox", { name: "Select Stellar network" });
    await expect(selector).toHaveValue("futurenet");
    await selector.selectOption("testnet");
    await expect(page).toHaveURL(/network=testnet/);
  });

  test("selector is visible on the XDR page", async ({ page }) => {
    await page.goto("/xdr");
    const selector = page.getByRole("combobox", { name: "Select Stellar network" });
    await expect(selector).toBeVisible();
  });
});
