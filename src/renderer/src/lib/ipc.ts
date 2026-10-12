import type {
  InvokeChannel,
  InvokeInput,
  InvokeOutput,
  PushChannel,
  PushPayload
} from '@shared/ipc-contract'
import { recordInvoke } from './diagnostics'

/** Dünner, typisierter Zugriff auf die Preload-Brücke. */
export function invoke<C extends InvokeChannel>(
  channel: C,
  input: InvokeInput<C>
): Promise<InvokeOutput<C>> {
  const start = performance.now()
  const done = (): void => recordInvoke(channel, performance.now() - start)
  const result = window.noctua.invoke(channel, input)
  void Promise.resolve(result).then(done, done)
  return result
}

export function onPush<C extends PushChannel>(
  channel: C,
  callback: (payload: PushPayload<C>) => void
): () => void {
  return window.noctua.on(channel, callback)
}
