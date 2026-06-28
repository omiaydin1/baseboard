"use client";

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


