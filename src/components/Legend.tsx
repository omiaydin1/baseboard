function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <span
        className="h-3 w-3 rounded-sm border border-slate-300"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Swatch color="#bfdbfe" label="Owned" />
      <Swatch color="#60a5fa" label="For sale" />
      <Swatch color="#1d4ed8" label="Yours" />
      <Swatch color="#f8fbff" label="Available" />
    </div>
  );
}
