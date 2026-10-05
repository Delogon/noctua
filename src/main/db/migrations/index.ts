import m001 from './001_init.sql?raw'
import m002 from './002_list_unsubscribe.sql?raw'
import m003 from './003_tasks.sql?raw'
import m004 from './004_signal.sql?raw'
import m005 from './005_followups.sql?raw'
import m006 from './006_embeddings.sql?raw'
import m007 from './007_outbox_rules_unsub.sql?raw'
import m008 from './008_signatures.sql?raw'
import m009 from './009_remove_signal.sql?raw'
import m010 from './010_nudge_cache.sql?raw'
import m011 from './011_account_names.sql?raw'
import m012 from './012_ignore_self_authored_tasks.sql?raw'
import m013 from './013_search_index_foundation.sql?raw'
import m014 from './014_message_header_details.sql?raw'
import m015 from './015_drafts.sql?raw'
import m016 from './016_credential_type_google.sql?raw'
import m017 from './017_account_sync_days.sql?raw'
import m018 from './018_followup_nudged_at.sql?raw'
import m019 from './019_owl_conversations.sql?raw'
import m020 from './020_addressed_to_me.sql?raw'
import m021 from './021_fts_trigram.sql?raw'
import m022 from './022_embeddings_base.sql?raw'
import m023 from './023_contact_display_name.sql?raw'
import m024 from './024_outbox_reliability.sql?raw'
import m025 from './025_op_queue_dead_letter.sql?raw'
import m026 from './026_ai_profiles.sql?raw'
import m027 from './027_ai_profiles_managed.sql?raw'
import m028 from './028_caldav.sql?raw'
import m029 from './029_task_caldav.sql?raw'
import m030 from './030_carddav.sql?raw'
import m031 from './031_invitations.sql?raw'

/**
 * Migrationen als ?raw-Importe, damit sie in das Main-Bundle eingebettet werden
 * (lose .sql-Dateien würden es nicht in die gepackte App schaffen).
 * Neue Migration: Datei anlegen, hier importieren, ans Ende anhängen.
 */
export const migrations: ReadonlyArray<{ version: number; name: string; sql: string }> = [
  { version: 1, name: 'init', sql: m001 },
  { version: 2, name: 'list_unsubscribe', sql: m002 },
  { version: 3, name: 'tasks', sql: m003 },
  { version: 4, name: 'signal', sql: m004 },
  { version: 5, name: 'followups', sql: m005 },
  { version: 6, name: 'embeddings', sql: m006 },
  { version: 7, name: 'outbox_rules_unsub', sql: m007 },
  { version: 8, name: '008_signatures', sql: m008 },
  { version: 9, name: '009_remove_signal', sql: m009 },
  { version: 10, name: '010_nudge_cache', sql: m010 },
  { version: 11, name: '011_account_names', sql: m011 },
  { version: 12, name: '012_ignore_self_authored_tasks', sql: m012 },
  { version: 13, name: '013_search_index_foundation', sql: m013 },
  { version: 14, name: '014_message_header_details', sql: m014 },
  { version: 15, name: '015_drafts', sql: m015 },
  { version: 16, name: '016_credential_type_google', sql: m016 },
  { version: 17, name: '017_account_sync_days', sql: m017 },
  { version: 18, name: '018_followup_nudged_at', sql: m018 },
  { version: 19, name: '019_owl_conversations', sql: m019 },
  { version: 20, name: '020_addressed_to_me', sql: m020 },
  { version: 21, name: '021_fts_trigram', sql: m021 },
  { version: 22, name: '022_embeddings_base', sql: m022 },
  { version: 23, name: '023_contact_display_name', sql: m023 },
  { version: 24, name: '024_outbox_reliability', sql: m024 },
  { version: 25, name: '025_op_queue_dead_letter', sql: m025 },
  { version: 26, name: '026_ai_profiles', sql: m026 },
  { version: 27, name: '027_ai_profiles_managed', sql: m027 },
  { version: 28, name: '028_caldav', sql: m028 },
  { version: 29, name: '029_task_caldav', sql: m029 },
  { version: 30, name: '030_carddav', sql: m030 },
  { version: 31, name: '031_invitations', sql: m031 }
]
