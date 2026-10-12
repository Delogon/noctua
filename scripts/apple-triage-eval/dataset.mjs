// 24 labeled test mails. Account owner: Lena Hartmann <lena.hartmann@example.org>.
// gold.tasks = should this mail create (at least one) task?
// gold.cats = acceptable categories; gold.addressed = is Lena personally addressed?
// salut: 'named:X' | 'group' | 'none' — deterministic pre-analysis as in prod.

export const OWNER = 'Lena Hartmann <lena.hartmann@example.org>'

export const MAILS = [
  // ── TRAPS: must NOT create tasks ───────────────────────────────────────
  {
    id: 'newsletter-webinar',
    from: 'Tech Weekly <news@techweekly.example>',
    subject: 'Diese Woche: KI-Trends + unser Webinar',
    unsub: true,
    placement: 'to',
    salut: 'none',
    body: 'Die wichtigsten KI-News der Woche. Außerdem: Unser großes Webinar zu lokalen Modellen! Melde dich bis Freitag an und sichere dir deinen Platz. Jetzt anmelden!',
    gold: { tasks: false, cats: ['newsletter', 'promotions'], addressed: false }
  },
  {
    id: 'promo-rabatt',
    from: 'ShopMail <angebote@shopmail.example>',
    subject: 'Nur bis Sonntag: 20 % auf alles',
    unsub: true,
    placement: 'to',
    salut: 'none',
    body: 'Liebe Kundin, nur noch bis Sonntag: 20 % Rabatt auf das gesamte Sortiment. Jetzt zugreifen, bevor die Aktion endet! Zum Shop.',
    gold: { tasks: false, cats: ['promotions'], addressed: false }
  },
  {
    id: 'security-login',
    from: 'Cloudbox <security@cloudbox.example>',
    subject: 'Neue Anmeldung auf deinem Konto',
    unsub: false,
    placement: 'to',
    salut: 'none',
    body: 'Wir haben eine neue Anmeldung von einem unbekannten Gerät festgestellt (Berlin, Chrome). Warst du das nicht, überprüfe jetzt dein Passwort und aktiviere die Zwei-Faktor-Authentifizierung.',
    gold: { tasks: false, cats: ['transactional', 'notifications'], addressed: false }
  },
  {
    id: 'code-2fa',
    from: 'PayFast <noreply@payfast.example>',
    subject: 'Dein Bestätigungscode: 481 292',
    unsub: false,
    placement: 'to',
    salut: 'none',
    body: 'Dein Code lautet 481292. Er ist 10 Minuten gültig. Gib ihn nicht weiter.',
    gold: { tasks: false, cats: ['transactional'], addressed: false }
  },
  {
    id: 'social-mention',
    from: 'Fotonetz <notify@fotonetz.example>',
    subject: 'Miriam hat dich in einem Kommentar erwähnt',
    unsub: true,
    placement: 'to',
    salut: 'none',
    body: 'Miriam hat dich erwähnt: „@lena das musst du sehen!" Antworte jetzt direkt in der App.',
    gold: { tasks: false, cats: ['notifications'], addressed: false }
  },
  {
    id: 'verteiler-fremd',
    from: 'Marie Winter <marie@verein.example>',
    subject: 'Folien für morgen',
    unsub: false,
    placement: 'absent',
    salut: 'named:Jonas',
    body: 'Hallo Jonas, kannst du mir bis heute Abend die Folien für morgen schicken? Danke dir! Viele Grüße, Marie',
    gold: { tasks: false, cats: ['personal', 'work'], addressed: false }
  },
  {
    id: 'fyi-cc',
    from: 'Thomas Berger <thomas@agentur.example>',
    subject: 'FYI: Angebot rausgeschickt',
    unsub: false,
    placement: 'cc',
    salut: 'none',
    body: 'Nur zur Info: Das Angebot an den Kunden ist heute Mittag rausgegangen. Keine Aktion nötig, ich melde mich, sobald Rückmeldung da ist.',
    gold: { tasks: false, cats: ['work'], addressed: false }
  },
  {
    id: 'rundbrief-kuchen',
    from: 'SV Eintracht <rundbrief@sv-eintracht.example>',
    subject: 'Rundbrief Juli: Sommerfest, Trainingszeiten',
    unsub: true,
    placement: 'absent',
    salut: 'group',
    body: 'Hallo zusammen, im Juli-Rundbrief: Die neuen Trainingszeiten stehen auf der Website. Beim Sommerfest am 26.07. freuen wir uns, wenn alle etwas zum Buffet beisteuern — Kuchen ist immer gern gesehen! Euer Vorstand',
    gold: { tasks: false, cats: ['newsletter'], addressed: false }
  },
  {
    id: 'report-woche',
    from: 'Statistik-Bot <reports@webtool.example>',
    subject: 'Dein Wochenreport ist da',
    unsub: true,
    placement: 'to',
    salut: 'none',
    body: 'Deine Website-Statistik für KW 29: 1.204 Besucher (+8 %). Den vollständigen Report findest du im Dashboard.',
    gold: { tasks: false, cats: ['notifications'], addressed: false }
  },
  {
    id: 'versand-paket',
    from: 'Paketdienst <status@paketdienst.example>',
    subject: 'Ihr Paket kommt am Donnerstag',
    unsub: false,
    placement: 'to',
    salut: 'none',
    body: 'Ihre Sendung 00340012 wird voraussichtlich am Donnerstag zwischen 10 und 14 Uhr zugestellt. Sie müssen nichts weiter tun.',
    gold: { tasks: false, cats: ['transactional', 'notifications'], addressed: false }
  },
  {
    id: 'kalender-auto',
    from: 'Kalender <invite@kalender.example>',
    subject: 'Erinnerung: Zahnarzt morgen 09:30',
    unsub: false,
    placement: 'to',
    salut: 'none',
    body: 'Automatische Erinnerung an deinen Termin „Zahnarzt" morgen um 09:30 Uhr. Diese Nachricht wurde automatisch erstellt.',
    gold: { tasks: false, cats: ['notifications'], addressed: false }
  },
  {
    id: 'bank-werbung',
    from: 'Direktbank <info@direktbank.example>',
    subject: 'Jetzt Depot eröffnen und 50 € sichern',
    unsub: true,
    placement: 'to',
    salut: 'none',
    body: 'Eröffnen Sie bis zum 31.07. ein Depot und sichern Sie sich 50 € Startguthaben. Jetzt eröffnen!',
    gold: { tasks: false, cats: ['promotions'], addressed: false }
  },

  // ── REAL TASKS: should create tasks ────────────────────────────────────
  {
    id: 'rechnung-frist',
    from: 'Hosting GmbH <billing@hosting.example>',
    subject: 'Rechnung 2026-1042 — Zahlung bis 23.07. fällig',
    unsub: false,
    placement: 'to',
    salut: 'named:Lena',
    body: 'Guten Tag Lena Hartmann, anbei die Rechnung 2026-1042 über 49,90 EUR. Bitte begleichen Sie den Betrag bis zum 23.07.2026 per Überweisung. Mit freundlichen Grüßen, Ihre Hosting GmbH',
    gold: { tasks: true, cats: ['transactional'], addressed: true }
  },
  {
    id: 'chef-bericht',
    from: 'Katrin Vogel <vogel@agentur.example>',
    subject: 'Quartalsbericht',
    unsub: false,
    placement: 'to',
    salut: 'named:Lena',
    body: 'Hallo Lena, kannst du mir bis Donnerstag den Quartalsbericht schicken? Der Termin mit dem Kunden ist Freitag früh. Danke! Katrin',
    gold: { tasks: true, cats: ['work'], addressed: true }
  },
  {
    id: 'freundin-faehre',
    from: 'Anna Sommer <anna.sommer@example.net>',
    subject: 'Fähre buchen!',
    unsub: false,
    placement: 'to',
    salut: 'named:Lena',
    body: 'Hi Lena, buchst du die Fähre für unseren Trip? Bis Ende der Woche wird es knapp mit den Plätzen. Ich überweise dir meinen Anteil sofort. Liebe Grüße, Anna',
    gold: { tasks: true, cats: ['personal'], addressed: true }
  },
  {
    id: 'kita-formular',
    from: 'Kita Sonnenblume <leitung@kita-sonnenblume.example>',
    subject: 'Einverständniserklärung fehlt noch',
    unsub: false,
    placement: 'to',
    salut: 'named:Frau Hartmann',
    body: 'Liebe Frau Hartmann, für den Ausflug am 22.07. fehlt uns noch die unterschriebene Einverständniserklärung. Bitte geben Sie das Formular bis zum 20.07. in der Kita ab. Herzliche Grüße, die Kita-Leitung',
    gold: { tasks: true, cats: ['personal', 'work', 'transactional'], addressed: true }
  },
  {
    id: 'vermieter-zaehler',
    from: 'Hausverwaltung Krüger <krueger@hausverwaltung.example>',
    subject: 'Zählerstand bis Monatsende',
    unsub: false,
    placement: 'to',
    salut: 'named:Frau Hartmann',
    body: 'Sehr geehrte Frau Hartmann, für die Nebenkostenabrechnung benötigen wir Ihren Stromzählerstand. Bitte melden Sie ihn uns bis zum 31.07. per Mail oder über das Portal. Mit freundlichen Grüßen, Hausverwaltung Krüger',
    gold: { tasks: true, cats: ['transactional', 'work', 'personal'], addressed: true }
  },
  {
    id: 'kollege-review',
    from: 'Deniz Acar <deniz@agentur.example>',
    subject: 'Review bis morgen Mittag?',
    unsub: false,
    placement: 'to',
    salut: 'named:Lena',
    body: 'Hey Lena, schaffst du das Review vom Konzept bis morgen 12 Uhr? Der Kunde will nachmittags Feedback. Sag kurz Bescheid, ob das klappt. Deniz',
    gold: { tasks: true, cats: ['work'], addressed: true }
  },
  {
    id: 'steuer-unterlagen',
    from: 'StB Petra Lang <lang@steuerkanzlei.example>',
    subject: 'Unterlagen für die Erklärung 2025',
    unsub: false,
    placement: 'to',
    salut: 'named:Frau Hartmann',
    body: 'Sehr geehrte Frau Hartmann, für Ihre Steuererklärung fehlen noch die Bescheinigung der Krankenversicherung und die Spendenquittungen. Bitte reichen Sie beides bis zum 25.07. nach, damit wir die Frist halten. Freundliche Grüße, Petra Lang',
    gold: { tasks: true, cats: ['work', 'transactional', 'personal'], addressed: true }
  },
  {
    id: 'verein-persoenlich',
    from: 'Marie Winter <marie@verein.example>',
    subject: 'Einkauf fürs Sommerfest',
    unsub: false,
    placement: 'to',
    salut: 'named:Lena',
    body: 'Hallo Lena, übernimmst du den Getränke-Einkauf fürs Sommerfest am 26.? Liste schicke ich dir, Abrechnung wie immer über die Vereinskasse. Danke dir! Marie',
    gold: { tasks: true, cats: ['personal', 'work'], addressed: true }
  },
  {
    id: 'frage-ohne-frist',
    from: 'Jonas Weber <jonas.weber@example.net>',
    subject: 'Deine Meinung zum Entwurf',
    unsub: false,
    placement: 'to',
    salut: 'named:Lena',
    body: 'Hi Lena, ich habe den Entwurf fürs Plakat angehängt. Was hältst du davon — eher Variante A oder B? Grüße, Jonas',
    gold: { tasks: true, cats: ['personal', 'work'], addressed: true }
  },

  // ── EDGE ────────────────────────────────────────────────────────────────
  {
    id: 'erledigt-selbst',
    from: 'Ben Fischer <ben@example.net>',
    subject: 'Re: Passwort fürs WLAN',
    unsub: false,
    placement: 'to',
    salut: 'named:Lena',
    body: 'Hi Lena, hat sich erledigt — ich habs im Router-Handbuch gefunden. Danke trotzdem! Ben',
    gold: { tasks: false, cats: ['personal'], addressed: true }
  },
  {
    id: 'vergrabene-aufgabe',
    from: 'Sofia Ricci <sofia@agentur.example>',
    subject: 'Nachlese Workshop + nächste Schritte',
    unsub: false,
    placement: 'to',
    salut: 'named:Lena',
    body: 'Hallo Lena, danke für den Workshop gestern — die Rückmeldungen waren durchweg positiv. Die Fotos lade ich später ins Wiki. Der Kunde war besonders vom Prototyp angetan und will im Herbst weitermachen. Eine Sache noch: Könntest du bis Mittwoch die Teilnehmerliste mit den E-Mail-Adressen exportieren und mir schicken? Ich brauche sie für die Zertifikate. Liebe Grüße, Sofia',
    gold: { tasks: true, cats: ['work'], addressed: true }
  }
]
