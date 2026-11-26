import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deal Check: is this creator deal worth it?",
  description: "Put in a creator's average views and their ask. See the sales you can expect, where you break even, a fair fee range and a counter-offer.",
};

export default function DealLayout({ children }: { children: React.ReactNode }) {
  return children;
}
