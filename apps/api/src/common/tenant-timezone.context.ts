import { AsyncLocalStorage } from 'async_hooks';
import { defaultAppTimezone } from './iana-timezone.util';

const store = new AsyncLocalStorage<string>();

export function runWithActiveTimezone<T>(timeZone: string, fn: () => T): T {
  return store.run(timeZone, fn);
}

export function getActiveTimezone(): string {
  return store.getStore() ?? defaultAppTimezone();
}
