import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white text-slate-900">
      <h1 className="text-6xl font-bold text-base-blue">404</h1>
      <p className="text-lg text-slate-500">This pixel does not exist.</p>
      <Link
        href="/"
        className="rounded-xl border-2 border-base-blue px-4 py-2 text-sm font-semibold text-base-blue hover:bg-blue-50"
      >
        Back to the Board
      </Link>
    </div>
  );
}
