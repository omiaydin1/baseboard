export function Spinner({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={`inline-block animate-spin-slow rounded-full border-2 border-blue-200 border-t-base-blue ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
