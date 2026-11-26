"use client";

import { useId, useMemo } from "react";
import { fracToValue, isActive, valueToFrac, type Domain, type Range, type Scale } from "@/lib/filters.ts";

const BINS = 28;
const STEPS = 1000;

interface Props {
  label: string;
  hint?: string;
  values: number[];
  domain: Domain;
  scale: Scale;
  range: Range;
  onChange: (r: Range) => void;
  format: (n: number) => string;
}

export default function RangeHistogram({ label, hint, values, domain, scale, range, onChange, format }: Props) {
  const id = useId();
  const bins = useMemo(() => {
    const counts = new Array(BINS).fill(0);
    for (const v of values) {
      const f = valueToFrac(v, domain, scale);
      counts[Math.min(BINS - 1, Math.max(0, Math.floor(f * BINS)))]++;
    }
    return counts;
  }, [values, domain, scale]);
  const peak = Math.max(1, ...bins);

  const lo = Math.round(range.lo * STEPS);
  const hi = Math.round(range.hi * STEPS);
  const active = isActive(range);

  const loText = range.lo > 0 ? format(fracToValue(range.lo, domain, scale)) : null;
  const hiText = range.hi < 1 ? format(fracToValue(range.hi, domain, scale)) : null;
  const summary = !active ? "Any" : loText && hiText ? `${loText} – ${hiText}` : loText ? `${loText} or more` : `Up to ${hiText}`;

  return (
    <div className={`rh${active ? " rh-active" : ""}`}>
      <div className="rh-head">
        <label htmlFor={`${id}-lo`} className="rh-label">{label}</label>
        <span className="rh-value" aria-live="polite">{summary}</span>
        {active && (
          <button type="button" className="rh-clear" onClick={() => onChange({ lo: 0, hi: 1 })}>
            Clear
          </button>
        )}
      </div>
      {hint && <p className="rh-hint">{hint}</p>}
      <div className="rh-track">
        <div className="rh-bars" aria-hidden="true">
          {bins.map((n, i) => {
            const mid = (i + 0.5) / BINS;
            const inside = mid >= range.lo && mid <= range.hi;
            return <span key={i} className={inside ? "in" : "out"} style={{ height: `${n === 0 ? 0 : 8 + (n / peak) * 92}%` }} />;
          })}
        </div>
        <input
          id={`${id}-lo`}
          type="range"
          min={0}
          max={STEPS}
          value={lo}
          aria-label={`${label}, minimum`}
          aria-valuetext={loText ?? "No minimum"}
          onChange={(e) => onChange({ lo: Math.min(Number(e.target.value), hi - 10) / STEPS, hi: range.hi })}
        />
        <input
          type="range"
          min={0}
          max={STEPS}
          value={hi}
          aria-label={`${label}, maximum`}
          aria-valuetext={hiText ?? "No maximum"}
          onChange={(e) => onChange({ lo: range.lo, hi: Math.max(Number(e.target.value), lo + 10) / STEPS })}
        />
      </div>
      <div className="rh-axis" aria-hidden="true">
        <span>{format(domain[0])}</span>
        <span>{format(domain[1])}</span>
      </div>
    </div>
  );
}
