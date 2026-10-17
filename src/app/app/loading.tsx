export default function AppLoading() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 w-28 animate-pulse rounded-lg bg-slate-200/80" />
        ))}
      </div>
      <div className="h-10 w-full max-w-xl animate-pulse rounded-lg bg-slate-100" />
      <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}
