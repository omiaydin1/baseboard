"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white text-slate-900">
      <h1 className="text-4xl font-bold text-base-blue">Something went wrong</h1>
      <p className="text-sm text-slate-500">
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-xl border-2 border-base-blue px-4 py-2 text-sm font-semibold text-base-blue hover:bg-blue-50"
      >
        Try again
      </button>
    </div>
  );
}
