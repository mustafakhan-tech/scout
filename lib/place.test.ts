import { test } from "node:test";
import assert from "node:assert/strict";
import { countryFromBio, flagsIn } from "./place.ts";

test("flags", () => {
  assert.deepEqual(flagsIn("Fashion 🇿🇦 | style"), ["ZA"]);
  assert.equal(countryFromBio("Stylist 🇿🇦"), "ZA");
});

test("South African places", () => {
  for (const bio of ["Joburg based creative", "Cape Town 🌊 fashion", "Mzansi's favourite stylist", "Durban girl", "Content creator | JHB/Jozi"]) {
    assert.equal(countryFromBio(bio), "ZA", bio);
  }
});

test("based in wins over where someone is from", () => {
  assert.equal(countryFromBio("Nigerian 🇳🇬 based in London"), "GB");
  assert.equal(countryFromBio("📍 Johannesburg | 🇳🇬 roots"), "ZA");
});

test("no false matches inside words", () => {
  assert.equal(countryFromBio("I love usability and kznx"), null);
  assert.equal(countryFromBio("Paris Hilton fan"), "FR"); // known limit: names that are also places
  assert.equal(countryFromBio(""), null);
});
