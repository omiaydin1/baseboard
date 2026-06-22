"use client";

import { BASE_CHAIN_ID, CELO_CHAIN_ID } from "@/lib/constants";

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * Official modern Base brand mark — "The Square": a clean solid #0052FF
 * rounded square. Scales crisply at any size.
 */
export function BaseLogo({ size = 20, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="6" fill="#0052FF" />
    </svg>
  );
}

/**
 * Circular Celo mark — Celo-yellow disc with the concentric-ring motif.
 */
export function CeloLogo({ size = 20, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="16" fill="#FCFF52" />
      <circle
        cx="16"
        cy="16"
        r="9"
        fill="none"
        stroke="#000000"
        strokeWidth="2.6"
      />
      <circle
        cx="16"
        cy="16"
        r="4.2"
        fill="none"
        stroke="#000000"
        strokeWidth="2.6"
      />
    </svg>
  );
}

/** Pick the right logo for a chain id (defaults to the Base mark). */
export function ChainLogo({
  chainId,
  size,
  className,
}: {
  chainId: number;
} & LogoProps) {
  if (chainId === CELO_CHAIN_ID)
    return <CeloLogo size={size} className={className} />;
  // Base + local default to the Base mark.
  void BASE_CHAIN_ID;
  return <BaseLogo size={size} className={className} />;
}
