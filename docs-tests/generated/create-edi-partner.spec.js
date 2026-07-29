import { test, expect } from "@playwright/test";

const scenarioPath = "scenarios/create-edi-partner.yml";
const defaultUrl = "https://cronus28edi/BC/?company=CRONUS%20DE&tenant=default";

test("Create an EDI partner", {
  annotation: {
    type: "scenario",
    description: scenarioPath
  }
}, async ({ page }, testInfo) => {
  const partnerCode = `AIDOC${Date.now().toString().slice(-10)}`;
  const partnerName = `AI Documentation ${partnerCode}`;

  await page.goto(process.env.BC_URL ?? defaultUrl);
  const bc = page.locator("iframe").contentFrame();

  await test.step("Open EDI Partners from the EDI Platform role center", async () => {
    await bc.getByRole("menuitem", { name: /EDI Partners, Open EDI trading partner setup/u })
      .click();
    await expect(bc.getByRole("form", { name: "EDI Partners" })).toBeVisible();
  });

  await test.step("Create a new EDI partner", async () => {
    await bc.getByRole("menuitem", { name: "Neu", exact: true }).click();
    const card = bc.getByRole("form", { name: "Neu - EDI Partner" });
    await card.getByRole("textbox", { name: "Partner Code" }).fill(partnerCode);
    await card.getByRole("textbox", { name: "Name", exact: true }).fill(partnerName);
    await expect(card.getByText("Gespeichert", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Zurück" }).click();
  });

  const partnerRow = bc.getByRole("row").filter({ hasText: partnerCode });

  await test.step("Verify: The EDI partner is saved.", async () => {
    await expect(partnerRow).toBeVisible();
  });

  await test.step(
    "Verify: The partner code and name are visible in the EDI Partners list.",
    async () => {
      await expect(partnerRow).toContainText(partnerCode);
      await expect(partnerRow.getByRole("textbox", { name: /Name/u })).toHaveValue(partnerName);
    }
  );

  await testInfo.attach("result", {
    body: await partnerRow.screenshot(),
    contentType: "image/png"
  });
});
