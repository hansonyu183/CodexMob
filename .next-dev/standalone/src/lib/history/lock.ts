const queue = new Map<string, Promise<void>>();

export async function withConversationLock<T>(
  conversationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = queue.get(conversationId) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  queue.set(conversationId, previous.then(() => current));

  await previous;
  try {
    return await fn();
  } finally {
    release();
    const latest = queue.get(conversationId);
    if (latest === current) {
      queue.delete(conversationId);
    }
  }
}

