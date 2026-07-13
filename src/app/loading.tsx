export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-base-blue border-t-transparent" />
        <p className="text-sm text-slate-500">Loading BaseBoard…</p>
      </div>
    </div>
  );
}
