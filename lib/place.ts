/*
 * TikTok rarely shares where a creator is, and Instagram only does for business accounts.
 * Creators often say it themselves, though: a flag emoji or a city in the bio. This reads that.
 */

/** Places people write in bios, by ISO-2 country. Matched as whole words, case-insensitive. */
const PLACES: Record<string, string[]> = {
  ZA: ["south africa", "southafrica", "mzansi", "joburg", "jozi", "johannesburg", "cape town", "capetown", "durban", "pretoria", "soweto", "sandton", "gauteng", "kzn", "port elizabeth", "gqeberha", "bloemfontein", "polokwane", "east london", "stellenbosch", "rsa"],
  NG: ["nigeria", "naija", "lagos", "abuja", "port harcourt", "ibadan", "enugu"],
  GH: ["ghana", "accra", "kumasi"],
  KE: ["kenya", "nairobi", "mombasa"],
  GB: ["united kingdom", "london", "manchester", "birmingham", "liverpool", "leeds", "glasgow", "edinburgh", "bristol", "england", "scotland", "wales"],
  IE: ["ireland", "dublin"],
  US: ["united states", "usa", "nyc", "new york", "los angeles", "atlanta", "chicago", "houston", "miami", "dallas", "san francisco", "brooklyn"],
  CA: ["canada", "toronto", "vancouver", "montreal", "calgary", "edmonton", "ottawa"],
  AU: ["australia", "sydney", "melbourne", "brisbane", "perth"],
  NZ: ["new zealand", "auckland"],
  AE: ["dubai", "abu dhabi", "uae"],
  IN: ["india", "mumbai", "delhi", "bangalore", "bengaluru"],
  PK: ["pakistan", "karachi", "lahore", "islamabad"],
  DE: ["germany", "deutschland", "berlin", "munich", "hamburg"],
  FR: ["france", "paris"],
  NL: ["netherlands", "amsterdam"],
  PH: ["philippines", "manila"],
};

const PATTERNS = Object.entries(PLACES).map(
  ([code, words]) => [code, new RegExp(`(^|[^a-z])(${words.map((w) => w.replace(/\s+/g, "\\s+")).join("|")})([^a-z]|$)`, "i")] as const,
);

/** ISO-2 codes from flag emoji, in order of appearance. */
export function flagsIn(text: string): string[] {
  const out: string[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length - 1; i++) {
    const a = chars[i].codePointAt(0)!;
    const b = chars[i + 1].codePointAt(0)!;
    if (a >= 0x1f1e6 && a <= 0x1f1ff && b >= 0x1f1e6 && b <= 0x1f1ff) {
      out.push(String.fromCharCode(a - 0x1f1e6 + 65, b - 0x1f1e6 + 65));
      i++;
    }
  }
  return out;
}

/**
 * The country a bio points to, or null. A flag counts first; a place name second.
 * If the bio points to more than one country ("🇳🇬 in 🇬🇧", "Lagos → London"), the last one wins,
 * because bios usually read "from X, based in Y".
 */
export function countryFromBio(bio: string): string | null {
  if (!bio) return null;
  const flags = flagsIn(bio).filter((c) => c !== "UN" && c !== "EU");
  const named: Array<{ code: string; at: number }> = [];
  for (const [code, re] of PATTERNS) {
    const m = re.exec(bio);
    if (m) named.push({ code, at: m.index });
  }
  named.sort((x, y) => x.at - y.at);
  // "based in" / "living in" points at where they are now.
  const based = /(based in|living in|located in|📍)\s*([^\n|•,]+)/i.exec(bio);
  if (based) {
    const here = flagsIn(based[2])[0] ?? named.find((n) => n.at >= based.index)?.code;
    if (here) return here;
  }
  if (named.length > 0) return named.at(-1)!.code;
  if (flags.length > 0) return flags.at(-1)!;
  return null;
}
