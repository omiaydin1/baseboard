"use client";

import { BASE_CHAIN_ID, CELO_CHAIN_ID } from "@/lib/constants";

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * Modern square "Basemark" — the white Base disc (flat right edge) on the
 * #0052FF rounded square. The flat edge is produced with a clip so it renders
 * crisply at any size.
 */
export function BaseLogo({ size = 20, className }: LogoProps) {
  const clipId = "baseflat";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="22.2" height="32" />
        </clipPath>
      </defs>
      <rect width="32" height="32" rx="7" fill="#0052FF" />
      <circle cx="16" cy="16" r="8.7" fill="#FFFFFF" clipPath={`url(#${clipId})`} />
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
