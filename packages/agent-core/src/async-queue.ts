export interface AsyncQueue<T> {
  close: () => void;
  fail: (error: unknown) => void;
  next: () => Promise<IteratorResult<T>>;
  push: (value: T) => void;
}

export function createAsyncQueue<T>(): AsyncQueue<T> {
  const bufferedValues: T[] = [];
  const waitingConsumers: Array<{
    reject: (error: unknown) => void;
    resolve: (result: IteratorResult<T>) => void;
  }> = [];
  let ended = false;

  return {
    close() {
      ended = true;
      flushWaitingConsumers(waitingConsumers);
    },
    fail(error) {
      ended = true;

      while (waitingConsumers.length > 0) {
        waitingConsumers.shift()?.reject(error);
      }
    },
    async next() {
      if (bufferedValues.length > 0) {
        return {
          done: false,
          value: bufferedValues.shift() as T,
        };
      }

      if (ended) {
        return {
          done: true,
          value: undefined,
        };
      }

      return await new Promise<IteratorResult<T>>((resolve, reject) => {
        waitingConsumers.push({
          reject,
          resolve,
        });
      });
    },
    push(value) {
      if (ended) {
        return;
      }

      const consumer = waitingConsumers.shift();

      if (consumer) {
        consumer.resolve({
          done: false,
          value,
        });
        return;
      }

      bufferedValues.push(value);
    },
  };
}

function flushWaitingConsumers<T>(
  waitingConsumers: Array<{
    reject: (error: unknown) => void;
    resolve: (result: IteratorResult<T>) => void;
  }>,
): void {
  while (waitingConsumers.length > 0) {
    waitingConsumers.shift()?.resolve({
      done: true,
      value: undefined,
    });
  }
}
