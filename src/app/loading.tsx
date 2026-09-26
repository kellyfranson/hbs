export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8">
        <h1 className="font-mono text-2xl font-bold tracking-tight text-[#A51C30]">
          HBS ASSIGNMENTS
        </h1>
        <p className="mt-1 text-sm text-stone-500">Pulling from Canvas&hellip;</p>
      </div>

      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded bg-stone-200 dark:bg-stone-800"
          />
        ))}
      </div>
    </main>
  );
}
