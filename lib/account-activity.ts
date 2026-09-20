// Only human/visible activity calls this gate; no background polling timer.
export function createActivityRecorder(record: () => Promise<void>, now = Date.now) {
  let nextAttempt = 0;
  let pending = false;
  let stopped = false;
  return {
    async touch(visible: boolean) {
      if (stopped || !visible || pending || now() < nextAttempt) return;
      pending = true;
      nextAttempt = now() + 60_000;
      try {
        await record();
        nextAttempt = now() + 5 * 60_000;
      } catch {
        // A later interaction/online event retries; never interrupt the user's work.
      } finally {
        pending = false;
      }
    },
    stop() { stopped = true; },
  };
}
