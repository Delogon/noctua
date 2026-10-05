// Die Heuristik liegt in shared/, damit der Renderer beim Anlegen eines Profils
// denselben Vorschlag fürs lokal-Flag machen kann.
export { hostOf, suggestIsLocal } from '@shared/local-host'
