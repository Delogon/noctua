# CardDAV contacts (Phase 3.1, read-only)

Address books of a calendar account (Nextcloud and other RFC 6352 servers) are mirrored
locally and feed the composer's recipient autocomplete. There is no contact editor.

- **Account model**: an opt-in per calendar account ("Sync contacts"), table
  `contacts_accounts` (migration 030). Same server, same credentials (vault key
  `cal:<id>:password`). The account loop in `calendar/sync.ts` runs
  `syncAccountContacts` after the calendar sync, so backoff and `needs-reauth` are shared;
  non-auth contact errors are only stored in `contacts_accounts.error`.
- **Discovery** (`src/main/dav/carddav.ts`): the calendar principal first, then
  `.well-known/carddav`, `remote.php/dav`, `_carddavs._tcp` SRV (only inside the domain).
  https only; hrefs to unrelated hosts are dropped; credentials only go to the origin of
  the request URL.
- **Schema**: `addressbooks`, `dav_contacts` (parsed fields, JSON emails/phones,
  `search_text`, raw vCard without PHOTO/LOGO/SOUND/KEY up to 64 KB),
  `dav_contact_emails` (normalized lower-case email index).
- **vCard** (`src/main/contacts/vcard.ts`): own parser for 2.1/3.0/4.0 (folding, groups,
  escapes, quoted-printable). Chosen over a dependency because only a handful of fields
  are needed and photos must never be decoded or fetched.
- **Sync** (`src/main/contacts/sync.ts`): ctag check, then sync-collection with token
  recovery, fallback PROPFIND etags + addressbook-multiget (halves oversized batches).
  Cap of 50,000 contacts per book.
- **Autocomplete**: `suggestContacts` returns the existing history ranking first, fills
  empty names from the address book, then appends address-book matches (prefix matches
  first, preferred address, alphabetical), deduped by address, own addresses excluded.
- **IPC**: `contacts:dav:status`, `contacts:dav:setSync`, `contacts:dav:setAddressBook`,
  push `contacts:changed`.
