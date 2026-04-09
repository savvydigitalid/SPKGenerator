import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAmounts,
  deriveRates,
  makeSpkNumber,
  parseISODateAsLocal,
} from "../src/lib/spk.js";

test("computeAmounts non gross-up calculates withholding, VAT, and net", () => {
  const result = computeAmounts({
    feeInput: 1_000_000,
    grossUp: false,
    pphRate: 0.02,
    vatRate: 0.11,
  });

  assert.equal(result.gross, 1_000_000);
  assert.equal(result.withholding, 20_000);
  assert.equal(result.vatAmount, 110_000);
  assert.equal(result.netToKOL, 1_090_000);
});

test("computeAmounts gross-up returns gross that matches target net", () => {
  const result = computeAmounts({
    feeInput: 1_000_000,
    grossUp: true,
    pphRate: 0.02,
    vatRate: 0.11,
  });

  assert.ok(Math.abs(result.netToKOL - 1_000_000) < 0.000001);
  assert.ok(result.gross > 0);
});

test("deriveRates maps tax scheme and VAT flag correctly", () => {
  assert.deepEqual(
    deriveRates({ taxScheme: "UMKM_0_5", kolPKP: true }),
    { pphRate: 0.005, vatRate: 0.11 }
  );

  assert.deepEqual(
    deriveRates({ taxScheme: "PPH21_custom", pph21Rate: 0.07, kolPKP: false }),
    { pphRate: 0.07, vatRate: 0 }
  );
});

test("makeSpkNumber uses the selected local date", () => {
  const number = makeSpkNumber("2026-04-09", "KOL Nama", "Campaign Besar");
  assert.equal(number, "SPK/20260409/KOLNama/CampaignBe");
});

test("parseISODateAsLocal preserves day/month/year from ISO date", () => {
  const date = parseISODateAsLocal("2026-04-09");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 3);
  assert.equal(date.getDate(), 9);
});
