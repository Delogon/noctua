import { getSetting, setSetting } from './db'

// „Local only" (privacy.localOnly): weicher Schalter. Wenn an, nutzt die AI nur
// lokale Profile, und es gibt KEINE automatischen externen Requests (Update-
// Check, Modellkatalog, Embedding-Download). Mail-Server/OAuth bleiben unberührt.

export const LOCAL_ONLY_KEY = 'privacy.localOnly'

export function isLocalOnly(): boolean {
  return getSetting(LOCAL_ONLY_KEY) === '1'
}

export function setLocalOnly(on: boolean): void {
  setSetting(LOCAL_ONLY_KEY, on ? '1' : '0')
}
