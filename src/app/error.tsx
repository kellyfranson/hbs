"use client"; // Error boundaries must be Client Components

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-mono text-2xl font-bold text-[#A51C30]">
        Could not load assignments
      </h1>

      {/*
        In production React replaces the message with a digest, so this shows
        the real Canvas error only in development. That is the intent: a
        failing token or URL should not be echoed to a browser.
      */}
      <p className="mt-4 rounded-lg bg-stone-100 p-3 font-mono text-xs dark:bg-stone-900">
        {error.message || `Server error (digest ${error.digest ?? "unknown"})`}
      </p>

      <button
        onClick={() => retry()}
        className="mt-6 rounded-full bg-[#A51C30] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#8a1728]"
      >
        Try again
      </button>
    </main>
  );
}
