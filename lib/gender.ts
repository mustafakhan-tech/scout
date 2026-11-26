import detector from "gender-detection-from-name";

/*
 * No platform tells you a creator's gender, so Scout estimates it from what the creator says
 * about themselves, strongest signal first:
 *   1. pronouns in the bio ("she/her")
 *   2. words in the bio ("mom", "wife", "girl dad")
 *   3. the first name, from a name list
 * Anything unclear stays "unknown" rather than being guessed. Profile photos are never used.
 */

export type Gender = "woman" | "man" | "unknown";
export type GenderSource = "pronouns" | "bio" | "name" | "you" | null;

export interface GenderGuess {
  gender: Gender;
  source: GenderSource;
}

/*
 * Common first names that the bundled lists miss, mostly Southern and West African.
 * Names widely given to both genders (Thando, Mpho, Ayanda, Lebo, Karabo, Tumi, Temitope…) are
 * left out on purpose, so they stay unknown.
 */
const EXTRA_WOMEN = [
  "nomvula", "nomsa", "nomthandazo", "nompumelelo", "nokuthula", "nokwanda", "nosipho", "nolwazi", "nonhlanhla",
  "zanele", "thandeka", "thandiwe", "lindiwe", "zinhle", "busisiwe", "sibongile", "hlengiwe", "zodwa", "ntombi",
  "nandi", "mbali", "khanyi", "khanyisile", "phindile", "thobeka", "xoliswa", "lerato", "naledi", "refilwe",
  "kefilwe", "palesa", "dineo", "puleng", "mmabatho", "dimakatso", "nthabiseng", "mamello", "masego",
  "funmilayo", "folake", "yetunde", "bukola", "adaobi", "chiamaka", "nneka", "ifeoma", "kemi", "bisola",
  "simi", "tiwa", "ada", "adaeze", "chioma", "ngozi", "abena", "akosua", "ama", "efua", "esi", "yaa", "wanjiku",
  "njeri", "wambui", "akinyi", "achieng",
];
const EXTRA_MEN = [
  "sipho", "sibusiso", "thabo", "sizwe", "bongani", "themba", "mandla", "tshepo", "siyabonga", "kagiso", "thulani",
  "jabulani", "lwazi", "ofentse", "emeka", "tunde", "ebuka", "obinna", "chidi", "kwame", "kofi", "kwabena",
  "yaw", "kojo", "kamau", "otieno", "odhiambo",
];
const EXTRA = new Map<string, Gender>([
  ...EXTRA_WOMEN.map((n) => [n, "woman"] as [string, Gender]),
  ...EXTRA_MEN.map((n) => [n, "man"] as [string, Gender]),
]);

const getGender: (name: string) => "male" | "female" | "unknown" =
  (detector as unknown as { getGender: (n: string) => "male" | "female" | "unknown" }).getGender;

const SHE = /(^|[^a-z])(she\s*\/\s*her(s)?|she\s*\/\s*they)([^a-z]|$)/i;
const HE = /(^|[^a-z])(he\s*\/\s*him|he\s*\/\s*they)([^a-z]|$)/i;
const THEY = /(^|[^a-z])they\s*\/\s*them([^a-z]|$)/i;
const MAN_WORDS = /\b(girl\s*dad|boy\s*dad|dad|daddy|papa|father of|husband|hubby to|boyfriend)\b/i;
const WOMAN_WORDS = /\b(mom|mum|mama|mommy|mummy|mother of|wife|wifey|girlfriend|girlie|girly|boss\s*lady|lady boss)\b/i;

/** The first word of a display name that looks like a given name. */
export function firstName(displayName: string): string | null {
  const word = displayName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[\s|·•,_.\-–—()]+/)
    .map((w) => w.replace(/[^A-Za-z']/g, ""))
    .find((w) => w.length >= 2);
  return word ? word.toLowerCase() : null;
}

export function nameGender(displayName: string): Gender {
  const first = firstName(displayName);
  if (!first) return "unknown";
  const extra = EXTRA.get(first);
  if (extra) return extra;
  const g = getGender(first.charAt(0).toUpperCase() + first.slice(1));
  return g === "female" ? "woman" : g === "male" ? "man" : "unknown";
}

export function guessGender(input: { name: string; bio: string; business?: boolean }): GenderGuess {
  if (input.business) return { gender: "unknown", source: null };
  const bio = input.bio ?? "";
  if (THEY.test(bio)) return { gender: "unknown", source: "pronouns" };
  if (SHE.test(bio)) return { gender: "woman", source: "pronouns" };
  if (HE.test(bio)) return { gender: "man", source: "pronouns" };
  if (MAN_WORDS.test(bio)) return { gender: "man", source: "bio" };
  if (WOMAN_WORDS.test(bio)) return { gender: "woman", source: "bio" };
  const byName = nameGender(input.name);
  return byName === "unknown" ? { gender: "unknown", source: null } : { gender: byName, source: "name" };
}
