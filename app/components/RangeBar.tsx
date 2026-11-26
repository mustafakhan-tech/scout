interface Props {
  low: number;
  mid: number;
  high: number;
  /** Line drawn across the bar, e.g. break-even or the creator's ask */
  marker: number | null;
  markerLabel: string;
  format: (n: number) => string;
  /** "good-above": the band past the marker is good (sales). "good-below": under the marker is good (price). */
  tone: "good-above" | "neutral";
  /** Colour of the marker line in neutral mode */
  markerState?: "ok" | "over";
  label: string;
  /** Word after the middle value on the axis */
  midLabel?: string;
}

/** A low–high band on a 0-based axis, with the expected value and a marker line. */
export default function RangeBar({ low, mid, high, marker, markerLabel, format, tone, label, markerState, midLabel = "expected" }: Props) {
  const max = Math.max(high, marker ?? 0) * 1.15 || 1;
  const pct = (n: number) => Math.min(100, Math.max(0, (n / max) * 100));
  const pos = (n: number) => `${pct(n)}%`;
  // Drop the end labels when they'd collide with the "expected" label.
  const showLow = pct(mid) - pct(low) > 16;
  const showHigh = pct(high) - pct(mid) > 16;
  const m = marker ?? -1;
  // Split the band at the marker so each side can be coloured.
  const splitAt = Math.min(Math.max(m, low), high);
  const split = tone === "good-above" && marker !== null;
  return (
    <figure className="rbar" aria-label={`${label}: ${format(low)} to ${format(high)}, ${midLabel} ${format(mid)}${marker !== null ? `; ${markerLabel} ${format(marker)}` : ""}`}>
      <div className="rbar-track" aria-hidden="true">
        {split && m > low ? (
          <span className="rbar-band bad" style={{ left: pos(low), width: `calc(${pos(splitAt)} - ${pos(low)})` }} />
        ) : null}
        {split && m < high ? (
          <span className="rbar-band good" style={{ left: pos(Math.max(low, m)), width: `calc(${pos(high)} - ${pos(Math.max(low, m))})` }} />
        ) : null}
        {!split && <span className="rbar-band neutral" style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }} />}
        <span className="rbar-mid" style={{ left: pos(mid) }} />
        {marker !== null && (
          <span className={`rbar-marker${markerState ? ` ${markerState}` : ""}`} style={{ left: pos(marker) }}>
            <span className="rbar-marker-label">{markerLabel} {format(marker)}</span>
          </span>
        )}
      </div>
      <figcaption className="rbar-axis" aria-hidden="true">
        {showLow && <span style={{ left: pos(low) }}>{format(low)}</span>}
        <span className="rbar-axis-mid" style={{ left: pos(mid) }}>{format(mid)} {midLabel}</span>
        {showHigh && <span style={{ left: pos(high) }}>{format(high)}</span>}
      </figcaption>
    </figure>
  );
}
