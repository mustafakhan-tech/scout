import { test } from "node:test";
import assert from "node:assert/strict";
import { firstName, guessGender, nameGender } from "./gender.ts";

test("pronouns beat everything", () => {
  assert.deepEqual(guessGender({ name: "Michael", bio: "she/her | stylist" }), { gender: "woman", source: "pronouns" });
  assert.deepEqual(guessGender({ name: "Jessica", bio: "he / him" }), { gender: "man", source: "pronouns" });
  assert.deepEqual(guessGender({ name: "Jessica", bio: "they/them" }), { gender: "unknown", source: "pronouns" });
});

test("bio words, with girl dad counted as a man", () => {
  assert.equal(guessGender({ name: "Sam", bio: "girl dad x3, filmmaker" }).gender, "man");
  assert.equal(guessGender({ name: "Sam", bio: "Mama of two. Fashion on a budget" }).gender, "woman");
});

test("first names, including South African and West African names", () => {
  assert.equal(nameGender("Zanele M"), "woman");
  assert.equal(nameGender("Lerato | Style"), "woman");
  assert.equal(nameGender("Chioma Okafor"), "woman");
  assert.equal(nameGender("Thabo"), "man");
  assert.equal(nameGender("Jessica"), "woman");
  assert.equal(nameGender("Michael"), "man");
});

test("names used for both genders stay unknown", () => {
  assert.equal(nameGender("Thando"), "unknown");
  assert.equal(nameGender("Mpho"), "unknown");
});

test("shops are never given a gender", () => {
  assert.equal(guessGender({ name: "Jessica Boutique", bio: "", business: true }).gender, "unknown");
});

test("first name ignores emoji and handles accents", () => {
  assert.equal(firstName("✨ Stella 🍵"), "stella");
  assert.equal(firstName("Zoë Martin"), "zoe");
  assert.equal(firstName("🍵"), null);
});

test("titles and surname-first names", () => {
  assert.equal(nameGender("Hey, Ms Khatli"), "woman");
  assert.equal(nameGender("Mr Dlamini"), "man");
  assert.equal(nameGender("Mtebele Thuli"), "woman");
  assert.equal(nameGender("Khensani"), "woman");
  assert.equal(nameGender("Cee King"), "unknown");
});
