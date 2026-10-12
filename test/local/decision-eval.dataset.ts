// Labelled emails for the decision-model eval (test/local/decision-eval.local.test.ts).
// Synthetic, German and English, owner "Lena Hartmann <lena@example.org>". Labels are
// what a careful human would answer for each System One question.

export interface EvalMail {
  id: string
  fromName: string | null
  fromAddr: string
  to?: Array<{ name: string | null; address: string }>
  cc?: Array<{ name: string | null; address: string }>
  replyTo?: string
  subject: string
  text: string
  html?: string
  listUnsubscribe?: boolean
  labels: {
    category:
      | 'personal'
      | 'work'
      | 'newsletter'
      | 'promotions'
      | 'notifications'
      | 'transactional'
      | 'other'
    needs_reply: boolean
    addressed_to_me: boolean
    has_request: boolean
    proposes_meeting: boolean
    /** 0 legitimate, 1 suspicious, 2 likely phishing */
    phishing: 0 | 1 | 2
    /** 0 not spam, 1 grey zone, 2 spam */
    spam: 0 | 1 | 2
  }
}

export const OWNER = { name: 'Lena Hartmann', address: 'lena@example.org' }
const ME = [{ name: 'Lena Hartmann', address: 'lena@example.org' }]

const base = {
  needs_reply: false,
  addressed_to_me: false,
  has_request: false,
  proposes_meeting: false,
  phishing: 0 as const,
  spam: 0 as const
}

export const EVAL_MAILS: EvalMail[] = [
  {
    id: 'personal-dinner',
    fromName: 'Marie Weber',
    fromAddr: 'marie.weber@gmx.de',
    to: ME,
    subject: 'Abendessen am Samstag?',
    text: 'Hallo Lena,\n\nhast du Lust, am Samstag um 19 Uhr bei uns zu essen? Tom kocht Risotto. Sag mir bis Donnerstag Bescheid.\n\nLiebe Grüße\nMarie',
    labels: {
      ...base,
      category: 'personal',
      needs_reply: true,
      addressed_to_me: true,
      has_request: true,
      proposes_meeting: true
    }
  },
  {
    id: 'personal-photos',
    fromName: 'Papa',
    fromAddr: 'h.hartmann@t-online.de',
    to: ME,
    subject: 'Fotos vom Wochenende',
    text: 'Hallo Lena,\n\nanbei die Fotos vom Wochenende. War schön mit euch!\n\nPapa',
    labels: { ...base, category: 'personal', addressed_to_me: true }
  },
  {
    id: 'work-request',
    fromName: 'Jannik Brandt',
    fromAddr: 'jannik.brandt@firma.de',
    to: ME,
    subject: 'Angebot Stadtwerke',
    text: 'Hallo Lena,\n\nkannst du mir bis Freitag das überarbeitete Angebot für die Stadtwerke schicken? Die Kundin wartet darauf.\n\nDanke dir\nJannik',
    labels: {
      ...base,
      category: 'work',
      needs_reply: true,
      addressed_to_me: true,
      has_request: true
    }
  },
  {
    id: 'work-meeting',
    fromName: 'Sabine Koch',
    fromAddr: 'sabine.koch@firma.de',
    to: ME,
    subject: 'Abstimmung Release',
    text: 'Hi Lena,\n\npasst dir Dienstag um 14 Uhr für eine halbe Stunde zur Release-Abstimmung? Alternativ Mittwoch 10 Uhr.\n\nViele Grüße\nSabine',
    labels: {
      ...base,
      category: 'work',
      needs_reply: true,
      addressed_to_me: true,
      has_request: true,
      proposes_meeting: true
    }
  },
  {
    id: 'work-cc-only',
    fromName: 'Jannik Brandt',
    fromAddr: 'jannik.brandt@firma.de',
    to: [{ name: 'Tom Krüger', address: 'tom.krueger@firma.de' }],
    cc: ME,
    subject: 'Zugang Testsystem',
    text: 'Hallo Tom,\n\nkannst du bitte bis morgen den Zugang zum Testsystem einrichten? Lena zur Info in CC.\n\nGruß\nJannik',
    labels: { ...base, category: 'work' }
  },
  {
    id: 'work-fyi-team',
    fromName: 'Geschäftsführung',
    fromAddr: 'gf@firma.de',
    to: [{ name: 'Alle', address: 'alle@firma.de' }],
    subject: 'Neue Parkplatzregelung',
    text: 'Liebe Kolleginnen und Kollegen,\n\nab dem 1. November gilt die neue Parkplatzregelung (siehe Anhang). Vielen Dank.\n\nDie Geschäftsführung',
    labels: { ...base, category: 'work' }
  },
  {
    id: 'en-work-question',
    fromName: 'David Miller',
    fromAddr: 'david@partner.example',
    to: ME,
    subject: 'Question about the API limits',
    text: 'Hi Lena,\n\nquick question: is the 1,000 requests per minute limit per key or per account? We need to know before Thursday.\n\nThanks,\nDavid',
    labels: {
      ...base,
      category: 'work',
      needs_reply: true,
      addressed_to_me: true,
      has_request: true
    }
  },
  {
    id: 'en-meeting-confirm',
    fromName: 'Priya Shah',
    fromAddr: 'priya@partner.example',
    to: ME,
    subject: 'Confirmed: call on Monday 9:30',
    text: 'Hi Lena,\n\nconfirming our call on Monday at 9:30 CET. I will send the dial-in link.\n\nBest,\nPriya',
    labels: { ...base, category: 'work', addressed_to_me: true, proposes_meeting: true }
  },
  {
    id: 'newsletter-tech',
    fromName: 'heise online',
    fromAddr: 'newsletter@heise.de',
    to: ME,
    subject: 'Die Woche bei heise: Rust, SQLite und KI',
    text: 'Die wichtigsten Artikel der Woche: Rust 2.0 in Sicht, SQLite bekommt neue JSON-Funktionen, KI-Modelle im Vergleich. Abmelden: https://www.heise.de/abmelden',
    listUnsubscribe: true,
    labels: { ...base, category: 'newsletter' }
  },
  {
    id: 'newsletter-en',
    fromName: 'The Pragmatic Engineer',
    fromAddr: 'newsletter@pragmaticengineer.example',
    to: ME,
    subject: 'The state of platform teams in 2026',
    text: 'This week: how platform teams changed after the AI boom, three case studies and a reader survey. Unsubscribe at any time.',
    listUnsubscribe: true,
    labels: { ...base, category: 'newsletter' }
  },
  {
    id: 'promo-shop',
    fromName: 'Zalando',
    fromAddr: 'news@zalando.de',
    to: ME,
    subject: 'Nur bis Sonntag: 30 % auf Winterjacken',
    text: 'Hallo Lena, jetzt zuschlagen: 30 % Rabatt auf ausgewählte Winterjacken. Nur bis Sonntag! Zum Shop: https://www.zalando.de/sale',
    listUnsubscribe: true,
    labels: { ...base, category: 'promotions' }
  },
  {
    id: 'promo-feature',
    fromName: 'Notion',
    fromAddr: 'team@makenotion.example',
    to: ME,
    subject: 'Introducing Notion Calendar 2.0',
    text: 'Meet the new Notion Calendar: smarter scheduling, time zones and more. Try it today.',
    listUnsubscribe: true,
    labels: { ...base, category: 'promotions' }
  },
  {
    id: 'notif-github',
    fromName: 'GitHub',
    fromAddr: 'notifications@github.com',
    to: ME,
    subject: '[noctua] New comment on pull request #42',
    text: 'sabinek commented on this pull request: "Looks good to me, just one nit about naming." Reply to this email directly or view it on GitHub.',
    labels: { ...base, category: 'notifications' }
  },
  {
    id: 'notif-calendar',
    fromName: 'Google Calendar',
    fromAddr: 'calendar-notification@google.com',
    to: ME,
    subject: 'Erinnerung: Zahnarzt um 10:00',
    text: 'Dies ist eine Erinnerung an folgenden Termin: Zahnarzt, Dienstag 10:00–10:30.',
    labels: { ...base, category: 'notifications' }
  },
  {
    id: 'trans-invoice',
    fromName: 'Telekom',
    fromAddr: 'rechnung@telekom.de',
    to: ME,
    subject: 'Ihre Rechnung für Oktober',
    text: 'Guten Tag Frau Hartmann, Ihre Rechnung für Oktober über 39,95 € steht im Kundencenter bereit. Der Betrag wird am 15.11. abgebucht.',
    labels: { ...base, category: 'transactional', addressed_to_me: true }
  },
  {
    id: 'trans-shipping',
    fromName: 'DHL',
    fromAddr: 'noreply@dhl.de',
    to: ME,
    subject: 'Ihre Sendung kommt heute',
    text: 'Ihre Sendung 00340434 wird heute zwischen 14 und 16 Uhr zugestellt.',
    labels: { ...base, category: 'transactional' }
  },
  {
    id: 'trans-2fa',
    fromName: 'Microsoft',
    fromAddr: 'account-security-noreply@accountprotection.microsoft.com',
    to: ME,
    subject: 'Ihr Sicherheitscode',
    text: 'Verwenden Sie den Sicherheitscode 482913 für das Microsoft-Konto le**@example.org.',
    labels: { ...base, category: 'transactional' }
  },
  {
    id: 'trans-payment-failed',
    fromName: 'Hetzner',
    fromAddr: 'billing@hetzner.com',
    to: ME,
    subject: 'Zahlung fehlgeschlagen',
    text: 'Hallo Lena Hartmann, die Abbuchung für Rechnung R0012345 ist fehlgeschlagen. Bitte aktualisieren Sie Ihre Zahlungsmethode bis zum 20.11., sonst wird der Server gesperrt.',
    labels: { ...base, category: 'transactional', addressed_to_me: true, has_request: true }
  },
  {
    id: 'phish-homoglyph',
    fromName: 'PayPal',
    fromAddr: 'service@pаypal.com',
    to: ME,
    subject: 'Ihr Konto wurde eingeschränkt',
    text: 'Sehr geehrter Kunde, wir haben ungewöhnliche Aktivitäten festgestellt. Bestätigen Sie Ihre Daten innerhalb von 24 Stunden, sonst wird Ihr Konto gesperrt.',
    html: '<p>Sehr geehrter Kunde, wir haben ungewöhnliche Aktivitäten festgestellt.</p><a href="http://pаypal-verify.example/login">https://www.paypal.com/signin</a>',
    labels: { ...base, category: 'transactional', has_request: true, phishing: 2, spam: 2 }
  },
  {
    id: 'phish-microsoft',
    fromName: 'Microsoft 365 Admin',
    fromAddr: 'admin@office365-mail.top',
    to: ME,
    replyTo: 'support@mailbox-help.example',
    subject: 'Password expires today',
    text: 'Your password expires today. Keep your current password by verifying your account here within 24 hours.',
    html: '<p>Your password expires today.</p><a href="http://45.13.2.9/keep">Keep current password</a>',
    labels: { ...base, category: 'notifications', has_request: true, phishing: 2, spam: 2 }
  },
  {
    id: 'phish-ceo',
    fromName: 'Thomas Berg (CEO)',
    fromAddr: 'thomas.berg.ceo@gmail.com',
    to: ME,
    subject: 'Dringend und vertraulich',
    text: 'Lena, ich brauche heute noch eine Überweisung von 9.800 € an einen neuen Lieferanten. Bitte vertraulich behandeln und mir kurz bestätigen. Thomas',
    labels: {
      ...base,
      category: 'work',
      needs_reply: true,
      addressed_to_me: true,
      has_request: true,
      phishing: 2,
      spam: 1
    }
  },
  {
    id: 'phish-dhl-fee',
    fromName: 'DHL Express',
    fromAddr: 'info@dhl-zustellung.example',
    to: ME,
    subject: 'Zollgebühr ausstehend',
    text: 'Ihr Paket wartet. Zahlen Sie die Zollgebühr von 1,99 € hier: https://bit.ly/3dhl-zoll',
    labels: { ...base, category: 'transactional', has_request: true, phishing: 2, spam: 2 }
  },
  {
    id: 'suspicious-link-mismatch',
    fromName: 'Sparkasse',
    fromAddr: 'info@sparkasse.de',
    to: ME,
    subject: 'Neue Funktionen im Online-Banking',
    text: 'Entdecken Sie die neuen Funktionen im Online-Banking.',
    html: '<p>Entdecken Sie die neuen Funktionen.</p><a href="https://tracking.newsletter-service.example/c/123">https://www.sparkasse.de/neu</a>',
    listUnsubscribe: true,
    labels: { ...base, category: 'promotions', phishing: 1 }
  },
  {
    id: 'spam-lottery',
    fromName: 'Euro Millions Claims',
    fromAddr: 'claims@winner-notify.top',
    to: [{ name: null, address: 'undisclosed-recipients@winner-notify.top' }],
    subject: 'SIE HABEN GEWONNEN!!!',
    text: 'Herzlichen Glückwunsch! Sie haben 1.000.000 Euro gewonnen. Senden Sie uns Ihre Bankdaten, um den Gewinn zu erhalten.',
    labels: { ...base, category: 'other', has_request: true, phishing: 2, spam: 2 }
  },
  {
    id: 'spam-crypto',
    fromName: 'Crypto Insider',
    fromAddr: 'profit@crypto-signal.example',
    to: ME,
    subject: 'Make 3,000 EUR a day with Bitcoin',
    text: 'Our risk-free bitcoin investment robot made 3,000 EUR a day for our members. Act now, limited time offer!',
    labels: { ...base, category: 'promotions', spam: 2, phishing: 1 }
  },
  {
    id: 'spam-seo',
    fromName: 'Mark',
    fromAddr: 'mark.seo@outreach-agency.example',
    to: ME,
    subject: 'Quick question about your website',
    text: 'Hi, I noticed your website is not ranking on page 1 of Google. We can fix that for 199 USD per month. Interested?',
    labels: { ...base, category: 'promotions', spam: 2 }
  },
  {
    id: 'grey-cold-sales',
    fromName: 'Stefan Wolf',
    fromAddr: 'stefan.wolf@saas-vendor.example',
    to: ME,
    subject: 'Kurze Vorstellung: Zeiterfassung für Ihr Team',
    text: 'Hallo Frau Hartmann, ich möchte Ihnen kurz unsere Zeiterfassung vorstellen. Hätten Sie nächste Woche 15 Minuten für ein Gespräch?',
    labels: { ...base, category: 'promotions', addressed_to_me: true, spam: 1 }
  },
  {
    id: 'other-name',
    fromName: 'Kita Sonnenschein',
    fromAddr: 'leitung@kita-sonnenschein.example',
    to: [{ name: 'Eltern', address: 'eltern@kita-sonnenschein.example' }],
    subject: 'Laternenumzug',
    text: 'Liebe Eltern, der Laternenumzug findet am 11. November um 17 Uhr statt. Bitte bringt eine Laterne mit.',
    labels: { ...base, category: 'personal', proposes_meeting: true }
  },
  {
    id: 'request-for-other',
    fromName: 'Anna Schulz',
    fromAddr: 'anna.schulz@firma.de',
    to: ME,
    subject: 'Für Jannik',
    text: 'Hallo Jannik, kannst du mir bitte die Folien bis morgen schicken? (Lena, ich habe dich versehentlich angeschrieben, sorry!) Anna',
    labels: { ...base, category: 'work' }
  },
  {
    id: 'forward-fyi',
    fromName: 'Lena Hartmann',
    fromAddr: 'lena@example.org',
    to: [{ name: 'Tom Krüger', address: 'tom.krueger@firma.de' }],
    subject: 'Fwd: Rechnung 4711',
    text: 'Zur Info.\n\n---------- Forwarded message ---------\nVon: buchhaltung@lieferant.example\nBitte überweisen Sie 120 € bis Freitag.',
    labels: { ...base, category: 'work' }
  },
  {
    id: 'en-thanks',
    fromName: 'David Miller',
    fromAddr: 'david@partner.example',
    to: ME,
    subject: 'Re: Question about the API limits',
    text: 'Thanks Lena, that answers it. Have a great weekend!\n\nDavid',
    labels: { ...base, category: 'work', addressed_to_me: true }
  },
  {
    id: 'urgent-incident',
    fromName: 'On-call',
    fromAddr: 'oncall@firma.de',
    to: ME,
    subject: 'Produktionsdatenbank down – bitte sofort melden',
    text: 'Lena, die Produktionsdatenbank ist seit 10 Minuten nicht erreichbar. Du hast heute Rufbereitschaft, bitte melde dich sofort.',
    labels: {
      ...base,
      category: 'work',
      needs_reply: true,
      addressed_to_me: true,
      has_request: true
    }
  }
]
