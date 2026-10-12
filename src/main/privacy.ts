import { getSetting, setSetting } from './db'

// "Local only" (privacy.localOnly): soft switch. When on, the AI uses only
// local profiles, and there are NO automatic external requests (update
// check, model catalog, embedding download). Mail servers/OAuth stay unaffected.

export const LOCAL_ONLY_KEY = 'privacy.localOnly'

export function isLocalOnly(): boolean {
  return getSetting(LOCAL_ONLY_KEY) === '1'
}

export function setLocalOnly(on: boolean): void {
  setSetting(LOCAL_ONLY_KEY, on ? '1' : '0')
}
