export async function ensureIndexed(opts: {
  state: { indexed: boolean; indexPromise?: Promise<void> | null };
  confirmIndex: boolean;
  confirm: (title: string, msg: string) => Promise<boolean>;
  index: () => Promise<void>;
}): Promise<void> {
  if (opts.state.indexed) return;

  // Promise de-dupe for true concurrency safety.
  if (opts.state.indexPromise) {
    await opts.state.indexPromise;
    return;
  }

  const run = (async () => {
    if (opts.confirmIndex) {
      const ok = await opts.confirm(
        "Index repository?",
        "KotaDB indexing can take a while. Index this repository now?",
      );
      if (!ok) throw new Error("Indexing cancelled by user");
    }

    await opts.index();
    opts.state.indexed = true;
  })();

  opts.state.indexPromise = run;
  try {
    await run;
  } finally {
    // Always clear the in-flight promise.
    opts.state.indexPromise = null;
  }
}
