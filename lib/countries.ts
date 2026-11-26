/** Countries offered in the region picker and used to label results. */
export const COUNTRIES: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  AU: "Australia",
  NZ: "New Zealand",
  IE: "Ireland",
  ZA: "South Africa",
  NG: "Nigeria",
  KE: "Kenya",
  GH: "Ghana",
  IN: "India",
  PK: "Pakistan",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
  NL: "Netherlands",
  SE: "Sweden",
  BR: "Brazil",
  MX: "Mexico",
  PH: "Philippines",
  ID: "Indonesia",
  SG: "Singapore",
  JP: "Japan",
  KR: "South Korea",
};

export function countryName(code: string | null): string {
  if (!code) return "Unknown";
  return COUNTRIES[code] ?? code;
}

/** Regional-indicator flag emoji for an ISO-2 code. */
export function flag(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
