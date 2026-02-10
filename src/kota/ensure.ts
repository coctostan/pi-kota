export async function ensureIndexed(opts: {
  state: { indexed: boolean };
  confirmIndex: boolean;
  confirm: (title: string, msg: string) => Promise<boolean>;
  index: () => Promise<void>;
}): Promise<void> {
  if (opts.state.indexed) return;

  if (opts.confirmIndex) {
    const ok = await opts.confirm(
      "Index repository?",
      "KotaDB indexing can take a while. Index this repository now?",
    );
    if (!ok) throw new Error("Indexing cancelled by user");
  }

  await opts.index();
  opts.state.indexed = true;
}
