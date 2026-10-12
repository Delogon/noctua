import { useT } from '@renderer/lib/i18n'
import {
  AC,
  Arrow,
  Box,
  Chip,
  Cross,
  DASH,
  Envelope,
  FAINT,
  HAIR,
  INK,
  L,
  ModelBox,
  MUTED,
  S,
  SHEET,
  Sq
} from '@renderer/features/settings/TechFigures'
import { NetworkConnections } from '@renderer/features/settings/NetworkConnections'
import { chipWidth } from '@renderer/features/settings/tech-metrics'

// Technik-Seite: „Wie die Eule denkt" — jede Pipeline als kleine
// Letterpress-Grafik, maximal zwei Sätze darunter. Jede Grafik ist gegen
// den Main-Prozess-Code verifiziert (Stand M67); durchgezogen = lokal,
// gestrichelt = API-Call über OpenRouter, ✦ = ein Sprachmodell.

/** Eine Sektion: Nummer + Mono-Titel, Grafik, kurze Serif-Unterschrift. */
function Fig({
  no,
  title,
  cap,
  viewH,
  children
}: {
  no: string
  title: string
  cap: string
  viewH: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="tint-card" style={{ padding: '14px 16px', minWidth: 0 }}>
      <div className="flex items-center gap-2">
        <span style={{ width: 6, height: 6, background: 'var(--ac)', flex: 'none' }} />
        <span className="mlabel" style={{ color: 'var(--ink)' }}>
          {no} · {title}
        </span>
        <span style={{ flex: 1, borderTop: '1px solid var(--hairline)' }} />
      </div>
      <svg
        viewBox={`0 0 560 ${viewH}`}
        width="100%"
        role="img"
        aria-label={title}
        style={{ display: 'block', marginTop: 12 }}
      >
        {children}
      </svg>
      <div
        style={{
          font: '400 11.5px/1.6 var(--serif)',
          fontStyle: 'italic',
          color: 'var(--secondary)',
          marginTop: 10
        }}
      >
        {cap}
      </div>
    </section>
  )
}

/** Legenden-Streifen: durchgezogen/gestrichelt/✦ — einmal erklärt, überall gültig. */
function Legend(): React.JSX.Element {
  const t = useT()
  return (
    <div
      style={{
        borderTop: '1px solid var(--ink)',
        borderBottom: '1px solid var(--hairline)',
        padding: '10px 2px',
        marginTop: 16
      }}
    >
      <div className="flex flex-wrap items-center" style={{ gap: '8px 22px' }}>
        <span className="flex items-center gap-2">
          <svg width="34" height="8" viewBox="0 0 34 8" aria-hidden="true">
            <line x1="0" y1="4" x2="34" y2="4" stroke={INK} strokeWidth="1" />
          </svg>
          <span style={{ font: '500 8.5px var(--mono)', letterSpacing: 1 }}>
            {t('techLegendSolid')}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <svg width="34" height="8" viewBox="0 0 34 8" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="34"
              y2="4"
              stroke={INK}
              strokeWidth="1"
              strokeDasharray={DASH}
            />
          </svg>
          <span style={{ font: '500 8.5px var(--mono)', letterSpacing: 1 }}>
            {t('techLegendDashed')}
          </span>
        </span>
        <span style={{ font: '500 8.5px var(--mono)', letterSpacing: 1, color: 'var(--ac)' }}>
          {t('techLegendModel')}
        </span>
      </div>
      <div
        style={{
          font: '400 11.5px var(--serif)',
          fontStyle: 'italic',
          color: 'var(--faint)',
          marginTop: 7
        }}
      >
        {t('techLegendNote')}
      </div>
    </div>
  )
}

/** 01 · Triage: Posteingang → Warteschlange → Budget-Tor → Scan-Modell → Annotation. */
function FigTriage(): React.JSX.Element {
  const t = useT()
  return (
    <g>
      {/* Eingang: Umschlag-Stapel, nur Posteingang */}
      <Envelope x={18} y={40} w={36} h={25} stroke={FAINT} />
      <Envelope x={24} y={46} w={36} h={25} stroke={MUTED} />
      <Envelope x={30} y={52} w={36} h={25} />
      <L x={48} y={95} anchor="middle" size={8} color={MUTED}>
        {t('techTriageIn')}
      </L>
      <Arrow x1={70} y1={64} x2={102} y2={64} />
      {/* Warteschlange: drei Plätze auf einer Linie */}
      <Sq x={108} y={59} s={9} fill="none" stroke={INK} />
      <Sq x={122} y={59} s={9} fill={INK} />
      <Sq x={136} y={59} s={9} fill={INK} />
      <line x1={106} y1={74} x2={147} y2={74} stroke={HAIR} strokeWidth={1} />
      <L x={127} y={92} anchor="middle" size={7.5} color={MUTED}>
        {t('techTriageQueue')}
      </L>
      <Arrow x1={150} y1={64} x2={178} y2={64} />
      {/* Budget-Tor: zwei Ink-Linien, dazwischen der Wächter */}
      <line x1={184} y1={40} x2={184} y2={88} stroke={INK} strokeWidth={1} />
      <line x1={190} y1={40} x2={190} y2={88} stroke={INK} strokeWidth={1} />
      <Sq x={183.5} y={60} s={7} />
      <L x={187} y={32} anchor="middle" size={7.5}>
        {t('techTriageBudget')}
      </L>
      <L x={187} y={100} anchor="middle" size={7} color={MUTED}>
        {t('techTriageBudgetNote1')}
      </L>
      <L x={187} y={110} anchor="middle" size={7} color={MUTED}>
        {t('techTriageBudgetNote2')}
      </L>
      <Arrow x1={194} y1={64} x2={222} y2={64} dashed />
      {/* Default-Modell steht IM Kasten — die Legende erklärt bereits OpenRouter */}
      <ModelBox
        x={224}
        y={41}
        w={124}
        h={46}
        name={t('techTriageModel')}
        note={t('techTriageModelNote')}
      />
      <Arrow x1={348} y1={64} x2={376} y2={64} dashed />
      {/* Annotation: das, was die Eule an die Mail heftet */}
      <L x={378} y={14} size={7.5} color={MUTED}>
        {t('techTriageCard')}
      </L>
      <Box x={378} y={20} w={166} h={118} />
      <L x={388} y={38} size={8}>
        {t('techTriageRow1')}
      </L>
      <L x={388} y={56} size={8} color={MUTED}>
        {t('techTriagePrio')}
      </L>
      {[0, 1, 2, 3, 4].map((i) => (
        <Sq
          key={i}
          x={446 + i * 11}
          y={49}
          s={6}
          fill={i < 3 ? INK : 'none'}
          stroke={i < 3 ? undefined : HAIR}
        />
      ))}
      <S x={388} y={76} size={10.5}>
        {t('techTriageGist')}
      </S>
      <line x1={388} y1={86} x2={534} y2={86} stroke={HAIR} strokeWidth={1} />
      <L x={388} y={103} size={7.5}>
        {t('techTriageRow4')}
      </L>
      <Sq x={388} y={112} s={6} />
      <L x={400} y={118} size={7} color={MUTED}>
        NEEDS_REPLY · ACTION_ITEMS
      </L>
      {/* Spam bleibt draußen */}
      <Envelope x={18} y={118} w={26} h={18} stroke={FAINT} />
      <Cross x={31} y={127} s={6} stroke={AC} />
      <L x={54} y={131} size={7.5} color={MUTED}>
        {t('techTriageSpam')}
      </L>
    </g>
  )
}

/** 02 · Adressat: Anrede schlägt Umschlag, Umschlag schlägt Modell. */
function FigAddr(): React.JSX.Element {
  const t = useT()
  const create = t('techAddrCreate')
  const none = t('techAddrNone')
  const suggest = t('techAddrSuggest')
  // Ergebnis-Chips linksbündig ab x=412 — Pfeile enden kurz davor
  const cxCreate = 412 + chipWidth(create) / 2
  const cxNone = 412 + chipWidth(none) / 2
  const cxSuggest = 412 + chipWidth(suggest) / 2
  return (
    <g>
      {/* Stufe 1 — Anrede */}
      <Box x={20} y={26} w={240} h={44} />
      <L x={32} y={44} size={8.5}>
        {t('techAddrS1')}
      </L>
      <S x={32} y={60} size={11}>
        {t('techAddrS1Sample')}
      </S>
      <L x={268} y={34} size={7} color={MUTED}>
        {t('techAddrMyName')}
      </L>
      <Arrow x1={260} y1={40} x2={409} y2={40} />
      <L x={268} y={52} size={7} color={MUTED}>
        {t('techAddrForeign')}
      </L>
      <line x1={260} y1={58} x2={370} y2={58} stroke={INK} strokeWidth={1} />
      <line x1={370} y1={58} x2={370} y2={134} stroke={INK} strokeWidth={1} />
      <Arrow x1={350} y1={134} x2={409} y2={134} />
      <Arrow x1={140} y1={70} x2={140} y2={108} />
      <L x={148} y={92} size={7} color={MUTED}>
        {t('techAddrNoSal')}
      </L>
      {/* Stufe 2 — Umschlag */}
      <Box x={20} y={110} w={240} h={44} />
      <L x={32} y={128} size={8.5}>
        {t('techAddrS2')}
      </L>
      <L x={32} y={144} size={7.5} color={MUTED}>
        {t('techAddrS2Sample')}
      </L>
      <Envelope x={216} y={121} w={30} h={21} stroke={MUTED} />
      <L x={268} y={128} size={7} color={MUTED}>
        {t('techAddrCc')}
      </L>
      <Arrow x1={260} y1={134} x2={409} y2={134} />
      <Arrow x1={140} y1={154} x2={140} y2={190} />
      <L x={148} y={176} size={7} color={MUTED}>
        {t('techAddrTo')}
      </L>
      {/* Stufe 3 — Modell-Urteil (aus der Triage) */}
      <Box x={20} y={192} w={240} h={44} dashed />
      <text x={32} y={214} fill={AC} fontSize={11}>
        ✦
      </text>
      <L x={46} y={210} size={8.5}>
        {t('techAddrS3')}
      </L>
      <L x={46} y={226} size={7.5} color={MUTED}>
        {t('techAddrS3Sample')}
      </L>
      <L x={296} y={200} size={7} color={MUTED}>
        {t('techAddrYes')}
      </L>
      <line x1={260} y1={206} x2={385} y2={206} stroke={INK} strokeWidth={1} />
      <line x1={385} y1={206} x2={385} y2={40} stroke={INK} strokeWidth={1} />
      <L x={296} y={218} size={7} color={MUTED}>
        {t('techAddrNo')}
      </L>
      <Arrow x1={260} y1={224} x2={409} y2={224} />
      {/* Ergebnisse */}
      <Chip cx={cxCreate} cy={40} text={create} tone="fill" />
      <Chip cx={cxNone} cy={134} text={none} tone="faint" />
      <Chip cx={cxSuggest} cy={224} text={suggest} tone="ac" />
    </g>
  )
}

/** 03 · Aufgaben-Sieb: sechs Filter in Code-Reihenfolge, unten die Aufgabe. */
function FigSieve(): React.JSX.Element {
  const t = useT()
  const top = 34
  const bottom = 282
  const leftAt = (y: number): number => 140 + (98 * (y - top)) / (bottom - top)
  const rightAt = (y: number): number => 400 - (98 * (y - top)) / (bottom - top)
  const levels: Array<{ y: number; l1: string; l2?: string }> = [
    { y: 62, l1: t('techSieve1') },
    { y: 100, l1: t('techSieve2'), l2: t('techSieve2b') },
    { y: 138, l1: t('techSieve3'), l2: t('techSieve3b') },
    { y: 176, l1: t('techSieve4'), l2: t('techSieve4b') },
    { y: 214, l1: t('techSieve5') },
    { y: 252, l1: t('techSieve6') }
  ]
  return (
    <g>
      <L x={270} y={12} anchor="middle" size={8} color={MUTED}>
        {t('techSieveIn')}
      </L>
      <Sq x={250} y={20} s={7} fill="none" stroke={INK} />
      <Sq x={266} y={24} s={7} />
      <Sq x={282} y={19} s={7} fill="none" stroke={INK} />
      {/* Trichterwände */}
      <line x1={140} y1={top} x2={238} y2={bottom} stroke={INK} strokeWidth={1} />
      <line x1={400} y1={top} x2={302} y2={bottom} stroke={INK} strokeWidth={1} />
      {levels.map(({ y, l1, l2 }) => {
        const lx = leftAt(y)
        const rx = rightAt(y)
        return (
          <g key={y}>
            <line
              x1={lx}
              y1={y}
              x2={rx}
              y2={y}
              stroke={INK}
              strokeWidth={1}
              strokeDasharray="7 5"
            />
            {/* Aussortiertes fällt nach rechts raus */}
            <Sq x={rx + 12} y={y - 12} s={6} fill={SHEET} stroke={MUTED} />
            <Cross x={rx + 27} y={y - 9} s={3.5} stroke={FAINT} />
            <L x={rx + 36} y={y - 6} size={7.5} ls={0.5}>
              {l1}
            </L>
            {l2 && (
              <L x={rx + 36} y={y + 5} size={7} color={MUTED} ls={0.5}>
                {l2}
              </L>
            )}
          </g>
        )
      })}
      {/* Zweifel beim Adressat-Gate: Vorschlag verlässt das Sieb nach links */}
      <Sq x={leftAt(176) - 20} y={165} s={6} fill={SHEET} stroke={AC} />
      <L x={20} y={171} size={7.5} color={AC}>
        {t('techSieveSuggest')}
      </L>
      <L x={20} y={182} size={7} color={MUTED}>
        {t('techSieveSuggestB')}
      </L>
      {/* Was durchfällt */}
      <line
        x1={270}
        y1={30}
        x2={270}
        y2={bottom - 4}
        stroke={MUTED}
        strokeWidth={1}
        strokeDasharray="1 7"
      />
      <Sq x={266.5} y={78} s={7} />
      <Arrow x1={270} y1={bottom} x2={270} y2={294} />
      <Box x={190} y={296} w={160} h={44} />
      <rect x={204} y={306} width={11} height={11} fill="none" stroke={INK} strokeWidth={1} />
      <L x={224} y={315} size={8.5}>
        {t('techSieveTask')}
      </L>
      <L x={204} y={331} size={7} color={MUTED}>
        {t('techSieveTaskNote')}
      </L>
    </g>
  )
}

/** 04 · Suche: Volltext und Vektoren parallel, Fusion, alles lokal. */
function FigSearch(): React.JSX.Element {
  const t = useT()
  const chip = t('techSearchChip')
  return (
    <g>
      <Chip cx={544 - chipWidth(chip) / 2} cy={14} text={chip} tone="fill" />
      <Box x={16} y={66} w={120} h={44} />
      <L x={28} y={84} size={8.5}>
        {t('techSearchIn')}
      </L>
      <S x={28} y={100} size={11}>
        {t('techSearchSample')}
      </S>
      {/* Gabelung */}
      <line x1={136} y1={88} x2={160} y2={88} stroke={INK} strokeWidth={1} />
      <line x1={160} y1={52} x2={160} y2={124} stroke={INK} strokeWidth={1} />
      <Arrow x1={160} y1={52} x2={186} y2={52} />
      <Arrow x1={160} y1={124} x2={186} y2={124} />
      <Box x={188} y={30} w={150} h={44} />
      <L x={200} y={48} size={8.5}>
        {t('techSearchFts')}
      </L>
      <L x={200} y={64} size={7.5} color={MUTED}>
        {t('techSearchFtsNote')}
      </L>
      <Box x={188} y={102} w={150} h={44} />
      <L x={200} y={120} size={8.5}>
        {t('techSearchVec')}
      </L>
      <L x={200} y={136} size={7.5} color={MUTED}>
        {t('techSearchVecNote')}
      </L>
      {/* Zusammenführung */}
      <line x1={338} y1={52} x2={362} y2={52} stroke={INK} strokeWidth={1} />
      <line x1={338} y1={124} x2={362} y2={124} stroke={INK} strokeWidth={1} />
      <line x1={362} y1={52} x2={362} y2={124} stroke={INK} strokeWidth={1} />
      <Arrow x1={362} y1={88} x2={386} y2={88} />
      <Box x={388} y={66} w={90} h={44} />
      <L x={433} y={84} anchor="middle" size={8.5}>
        {t('techSearchFuse')}
      </L>
      <L x={433} y={100} anchor="middle" size={7.5} color={MUTED}>
        {t('techSearchFuseNote')}
      </L>
      <Arrow x1={478} y1={88} x2={500} y2={88} />
      {/* Trefferliste */}
      {[70, 84, 98].map((y, i) => (
        <g key={y}>
          <Sq x={506} y={y} s={5} fill={i === 0 ? AC : INK} />
          <line x1={516} y1={y + 2.5} x2={548} y2={y + 2.5} stroke={HAIR} strokeWidth={1} />
        </g>
      ))}
      <L x={527} y={122} anchor="middle" size={7.5} color={MUTED}>
        {t('techSearchHits')}
      </L>
    </g>
  )
}

/** 05 · Die Eule fragen: lokal belegen, dann streamt das Modell mit [n]-Zitaten. */
function FigAsk(): React.JSX.Element {
  const t = useT()
  return (
    <g>
      <Box x={16} y={28} w={110} h={40} />
      <L x={28} y={52} size={8.5}>
        {t('techAskQ')}
      </L>
      <Arrow x1={126} y1={48} x2={150} y2={48} dashed />
      <ModelBox x={152} y={26} w={108} h={44} name={t('techAskExpand')} />
      <Arrow x1={260} y1={48} x2={284} y2={48} />
      <Box x={286} y={26} w={140} h={44} />
      <L x={298} y={44} size={8.5}>
        {t('techAskLocal')}
      </L>
      <L x={298} y={60} size={7.5} color={MUTED}>
        {t('techAskLocalNote')}
      </L>
      <Arrow x1={426} y1={48} x2={450} y2={48} />
      {/* Quellen [1][2][3] */}
      {[26, 43, 60].map((y, i) => (
        <g key={y}>
          <rect x={452} y={y} width={22} height={15} fill={SHEET} stroke={INK} strokeWidth={1} />
          <L x={463} y={y + 10.5} anchor="middle" size={7.5}>
            {`[${i + 1}]`}
          </L>
        </g>
      ))}
      <L x={484} y={52} size={7.5} color={MUTED}>
        {t('techAskSources')}
      </L>
      {/* Runter in die zweite Zeile: Frage + Quellen reisen zum Modell */}
      <line x1={463} y1={79} x2={463} y2={98} stroke={INK} strokeWidth={1} strokeDasharray={DASH} />
      <line x1={463} y1={98} x2={100} y2={98} stroke={INK} strokeWidth={1} strokeDasharray={DASH} />
      <Arrow x1={100} y1={98} x2={100} y2={116} dashed />
      <ModelBox x={40} y={118} w={120} h={46} name={t('techAskModel')} />
      <L x={100} y={177} anchor="middle" size={7} color={MUTED}>
        {t('techAskModelNote')}
      </L>
      <Arrow x1={160} y1={141} x2={184} y2={141} dashed />
      <Box x={186} y={112} w={180} h={58} />
      <L x={198} y={128} size={8}>
        {t('techAskAnswer')}
      </L>
      <line x1={198} y1={140} x2={318} y2={140} stroke={HAIR} strokeWidth={1} />
      <L x={324} y={143} size={7} color={AC}>
        [1]
      </L>
      <line x1={198} y1={154} x2={296} y2={154} stroke={HAIR} strokeWidth={1} />
      <L x={302} y={157} size={7} color={AC}>
        [2]
      </L>
      <Arrow x1={366} y1={141} x2={390} y2={141} />
      <Box x={392} y={118} w={152} h={46} />
      <L x={404} y={136} size={8.5}>
        {t('techAskStore')}
      </L>
      <L x={404} y={152} size={7.5} color={MUTED}>
        {t('techAskStoreNote')}
      </L>
    </g>
  )
}

/** 06 · Entwürfe & Stimme: drei Zuflüsse, ein Entwurf — gesendet wird von Hand. */
function FigVoice(): React.JSX.Element {
  const t = useT()
  const send = t('techVoiceSend')
  return (
    <g>
      {/* Zufluss 1: gesendete Mails → Stilprofil */}
      <Envelope x={16} y={22} w={30} h={20} stroke={MUTED} />
      <Envelope x={24} y={28} w={30} h={20} />
      <L x={16} y={62} size={7} color={MUTED}>
        {t('techVoiceSent1')}
      </L>
      <L x={16} y={72} size={7} color={MUTED}>
        {t('techVoiceSent2')}
      </L>
      <Arrow x1={58} y1={38} x2={82} y2={38} dashed />
      <Box x={84} y={20} w={132} h={38} />
      <L x={94} y={36} size={8.5}>
        {t('techVoiceProfile')}
      </L>
      <L x={94} y={50} size={7} color={MUTED}>
        {t('techVoiceProfileNote')}
      </L>
      {/* Zufluss 2: der Verlauf mit genau dieser Person → Du/Sie */}
      <rect x={16} y={86} width={26} height={13} fill={SHEET} stroke={MUTED} strokeWidth={1} />
      <rect x={28} y={102} width={26} height={13} fill={SHEET} stroke={INK} strokeWidth={1} />
      <L x={16} y={126} size={7} color={MUTED}>
        {t('techVoiceThread1')}
      </L>
      <L x={16} y={135} size={7} color={MUTED}>
        {t('techVoiceThread2')}
      </L>
      <Arrow x1={58} y1={102} x2={82} y2={102} />
      <Box x={84} y={82} w={132} h={52} />
      <L x={94} y={98} size={8.5}>
        {t('techVoiceFormal')}
      </L>
      <L x={94} y={112} size={7} color={MUTED}>
        {t('techVoiceFormalNote1')}
      </L>
      <L x={94} y={124} size={7} color={AC}>
        {t('techVoiceFormalNote2')}
      </L>
      {/* Zufluss 3: Diktat → Transkription */}
      <rect x={24} y={148} width={12} height={17} fill={SHEET} stroke={INK} strokeWidth={1} />
      <line x1={30} y1={165} x2={30} y2={172} stroke={INK} strokeWidth={1} />
      <line x1={24} y1={172} x2={36} y2={172} stroke={INK} strokeWidth={1} />
      <L x={16} y={186} size={7} color={MUTED}>
        {t('techVoiceMic')}
      </L>
      <Arrow x1={44} y1={160} x2={64} y2={160} dashed />
      <ModelBox x={66} y={138} w={108} h={44} name={t('techVoiceStt')} />
      {/* Zusammenfluss ins Entwurfs-Modell */}
      <line x1={216} y1={39} x2={252} y2={39} stroke={INK} strokeWidth={1} />
      <line x1={252} y1={39} x2={252} y2={102} stroke={INK} strokeWidth={1} />
      <Arrow x1={252} y1={102} x2={277} y2={102} />
      <Arrow x1={216} y1={118} x2={277} y2={118} />
      <line x1={174} y1={160} x2={256} y2={160} stroke={INK} strokeWidth={1} />
      <line x1={256} y1={160} x2={256} y2={134} stroke={INK} strokeWidth={1} />
      <Arrow x1={256} y1={134} x2={277} y2={134} />
      <ModelBox x={280} y={90} w={130} h={56} name={t('techVoiceModel')} />
      <Arrow x1={410} y1={118} x2={434} y2={118} dashed />
      {/* Der Entwurf — und der Klick, der dir gehört */}
      <Box x={436} y={84} w={108} h={68} />
      <L x={446} y={100} size={8}>
        {t('techVoiceDraft')}
      </L>
      <line x1={446} y1={112} x2={530} y2={112} stroke={HAIR} strokeWidth={1} />
      <line x1={446} y1={124} x2={514} y2={124} stroke={HAIR} strokeWidth={1} />
      <L x={446} y={142} size={7} color={AC}>
        {t('techVoiceDraftNote')}
      </L>
      <Arrow x1={490} y1={152} x2={490} y2={172} />
      <Chip cx={490} cy={184} text={send} tone="fill" />
      <L x={490} y={206} anchor="middle" size={7} color={MUTED}>
        {t('techVoiceSendNote')}
      </L>
    </g>
  )
}

/** 07 · Rechtschreibung: echtes Hunspell als WASM, Wörterbücher an Bord. */
function FigSpell(): React.JSX.Element {
  const t = useT()
  const sample = t('techSpellSample')
  const zigEnd = 24 + Math.min(160, sample.length * 6.6)
  const zig: string[] = []
  for (let x = 24; x < zigEnd; x += 8) zig.push(`L ${x + 4} 76 L ${x + 8} 70`)
  const chip = t('techSpellChip')
  return (
    <g>
      <text x={24} y={66} fill={INK} fontFamily="var(--serif)" fontSize={14}>
        {sample}
      </text>
      <path d={`M 24 70 ${zig.join(' ')}`} fill="none" stroke={AC} strokeWidth={1} />
      <Arrow x1={182} y1={60} x2={210} y2={60} />
      <Box x={212} y={34} w={150} h={52} />
      <L x={224} y={52} size={8.5}>
        {t('techSpellEngine')}
      </L>
      {/* Zwei Wörterbücher — im Paket, nicht im Netz */}
      <rect x={224} y={60} width={22} height={16} fill={SHEET} stroke={INK} strokeWidth={1} />
      <L x={235} y={71} anchor="middle" size={7}>
        DE
      </L>
      <rect x={250} y={60} width={22} height={16} fill={SHEET} stroke={INK} strokeWidth={1} />
      <L x={261} y={71} anchor="middle" size={7}>
        EN
      </L>
      <L x={280} y={71} size={7} color={MUTED}>
        {t('techSpellDictNote')}
      </L>
      <Arrow x1={362} y1={60} x2={390} y2={60} />
      <Box x={392} y={26} w={152} h={68} />
      <L x={404} y={42} size={7.5} color={MUTED}>
        {t('techSpellSuggest')}
      </L>
      <line x1={392} y1={50} x2={544} y2={50} stroke={HAIR} strokeWidth={1} />
      <S x={404} y={67} size={11.5} color={INK}>
        {t('techSpellFix')}
      </S>
      <L x={404} y={84} size={6.5} color={MUTED} ls={0.5}>
        {t('techSpellIgnoreNote')}
      </L>
      <Chip cx={20 + chipWidth(chip) / 2} cy={120} text={chip} tone="ink" />
      <L x={30 + chipWidth(chip)} y={123} size={7.5} color={MUTED}>
        {t('techSpellChipNote')}
      </L>
    </g>
  )
}

/** 08 · Regeln: oben der einmalige Entwurf, unten die deterministische Anwendung. */
function FigRules(): React.JSX.Element {
  const t = useT()
  const acts = [t('techRulesAct1'), t('techRulesAct2'), t('techRulesAct3')]
  let actX = 254
  return (
    <g>
      <L x={20} y={14} size={7.5} color={AC}>
        {t('techRulesLaneA')}
      </L>
      <S x={20} y={44} size={11}>
        {t('techRulesQuote1')}
      </S>
      <S x={20} y={58} size={11}>
        {t('techRulesQuote2')}
      </S>
      <Arrow x1={178} y1={52} x2={204} y2={52} dashed />
      <ModelBox x={206} y={26} w={124} h={48} name={t('techRulesDraft')} />
      <Arrow x1={330} y1={52} x2={356} y2={52} dashed />
      {/* Das Regel-JSON — ab hier bleibt alles deterministisch */}
      <Box x={358} y={22} w={186} h={58} />
      <L x={370} y={41} size={11} w={600} ls={0}>
        {'{ }'}
      </L>
      <L x={396} y={40} size={8}>
        {t('techRulesJson')}
      </L>
      <L x={370} y={57} size={6.5} color={MUTED} ls={0.4}>
        {t('techRulesJsonIf')}
      </L>
      <L x={370} y={69} size={6.5} color={MUTED} ls={0.4}>
        {t('techRulesJsonThen')}
      </L>
      {/* Die gespeicherte Regel speist die Prüfung jeder Mail */}
      <line x1={400} y1={80} x2={400} y2={104} stroke={INK} strokeWidth={1} />
      <line x1={400} y1={104} x2={160} y2={104} stroke={INK} strokeWidth={1} />
      <Arrow x1={160} y1={104} x2={160} y2={122} />
      <Envelope x={20} y={132} w={34} h={23} />
      <Arrow x1={58} y1={144} x2={92} y2={144} />
      <Box x={94} y={124} w={130} h={42} />
      <L x={106} y={141} size={8.5}>
        {t('techRulesMatch')}
      </L>
      <L x={106} y={156} size={7} color={MUTED}>
        {t('techRulesMatchNote')}
      </L>
      <Arrow x1={224} y1={144} x2={250} y2={144} />
      {acts.map((a) => {
        const w = chipWidth(a)
        const cx = actX + w / 2
        actX += w + 8
        return <Chip key={a} cx={cx} cy={144} text={a} tone="ink" />
      })}
      <L x={20} y={188} size={7.5} color={AC}>
        {t('techRulesLaneB')}
      </L>
    </g>
  )
}

/** 09 · Follow-up-Radar: still gebliebene Mails, gezählte Tage, ein Stupser. */
function FigRadar(): React.JSX.Element {
  const t = useT()
  const list = t('techRadarList')
  return (
    <g>
      <Envelope x={16} y={40} w={34} h={23} />
      <L x={12} y={76} size={7} color={MUTED}>
        {t('techRadarSent1')}
      </L>
      <L x={12} y={86} size={7} color={MUTED}>
        {t('techRadarSent2')}
      </L>
      <Arrow x1={54} y1={52} x2={76} y2={52} />
      {/* Tage-Zähler: drei stille Tage, der Rest offen */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <Sq
          key={i}
          x={82 + i * 12}
          y={46}
          s={8}
          fill={i < 3 ? INK : 'none'}
          stroke={i < 3 ? undefined : HAIR}
        />
      ))}
      <L x={82} y={38} size={7.5}>
        {t('techRadarDays')}
      </L>
      <L x={82} y={70} size={7} color={MUTED}>
        {t('techRadarDaysNote1')}
      </L>
      <L x={82} y={81} size={7} color={MUTED}>
        {t('techRadarDaysNote2')}
      </L>
      <Arrow x1={172} y1={52} x2={198} y2={52} dashed />
      <ModelBox x={200} y={28} w={118} h={48} name={t('techRadarCheck')} />
      <L x={259} y={88} anchor="middle" size={7} color={MUTED}>
        {t('techRadarCheckNote')}
      </L>
      <Arrow x1={318} y1={52} x2={342} y2={52} />
      <Chip cx={344 + chipWidth(list) / 2} cy={52} text={list} tone="ink" />
      {/* Zweite Zeile: beim Öffnen entsteht der Stupser — gesendet wird von dir */}
      <L x={16} y={128} size={7.5}>
        {t('techRadarOpen')}
      </L>
      <ModelBox x={152} y={102} w={124} h={46} name={t('techRadarNudge')} />
      <Arrow x1={276} y1={125} x2={300} y2={125} dashed />
      <Box x={302} y={102} w={140} h={46} />
      <L x={314} y={120} size={8}>
        {t('techRadarVoice')}
      </L>
      <L x={314} y={136} size={7} color={MUTED}>
        {t('techRadarVoiceNote')}
      </L>
      <Arrow x1={442} y1={125} x2={464} y2={125} />
      <Chip
        cx={468 + chipWidth(t('techRadarSend')) / 2}
        cy={125}
        text={t('techRadarSend')}
        tone="fill"
      />
    </g>
  )
}

/** 10 · Datenhaltung: ein Mac, eine Datei, drei ehrliche Leitungen nach draußen. */
function FigData(): React.JSX.Element {
  const t = useT()
  const chips = [t('techDataChip1'), t('techDataChip2'), t('techDataChip3')]
  return (
    <g>
      <L x={28} y={18} size={8.5}>
        {t('techDataMac')}
      </L>
      <Box x={16} y={26} w={330} h={180} fill="none" />
      {/* Die eine Datenbank */}
      <Box x={32} y={44} w={180} h={64} />
      <L x={44} y={62} size={8.5}>
        {t('techDataDb')}
      </L>
      <line x1={44} y1={70} x2={200} y2={70} stroke={HAIR} strokeWidth={1} />
      <L x={44} y={84} size={7} color={MUTED}>
        {t('techDataDbRow1')}
      </L>
      <L x={44} y={96} size={7} color={MUTED}>
        {t('techDataDbRow2')}
      </L>
      {/* Der Vault — Schlüsselbund-gestützt */}
      <Box x={32} y={124} w={180} h={64} />
      <rect x={44} y={136} width={9} height={9} fill="none" stroke={INK} strokeWidth={1} />
      <line x1={53} y1={140.5} x2={64} y2={140.5} stroke={INK} strokeWidth={1} />
      <line x1={60} y1={140.5} x2={60} y2={145} stroke={INK} strokeWidth={1} />
      <line x1={64} y1={140.5} x2={64} y2={146} stroke={INK} strokeWidth={1} />
      <L x={72} y={144} size={8.5}>
        {t('techDataVault')}
      </L>
      <L x={44} y={162} size={7} color={MUTED}>
        {t('techDataVaultRow1')}
      </L>
      <L x={44} y={174} size={7} color={MUTED}>
        {t('techDataVaultRow2')}
      </L>
      {/* Lokale Maschinerie an Bord */}
      <L x={228} y={48} size={7.5} color={MUTED}>
        {t('techDataOnboard')}
      </L>
      {chips.map((c, i) => (
        <Chip key={c} cx={228 + chipWidth(c) / 2} cy={66 + i * 24} text={c} tone="ink" />
      ))}
      {/* Nach draußen: die ehrliche, dynamische Liste steht darunter (Abschnitt 11) */}
      <Arrow x1={346} y1={90} x2={406} y2={90} dashed />
      <Box x={408} y={62} w={136} h={56} dashed />
      <L x={420} y={82} size={7.5}>
        {t('techDataNet')}
      </L>
      <L x={420} y={96} size={7} color={MUTED} ls={0.5}>
        {t('techDataNetNote')}
      </L>
      {/* Und was draußen bleibt: Tracking-Pixel prallen an der Wand ab */}
      <line
        x1={544}
        y1={196}
        x2={356}
        y2={196}
        stroke={MUTED}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <Cross x={348} y={196} s={5} stroke={AC} />
      <L x={408} y={190} size={7} color={MUTED}>
        {t('techDataPixels')}
      </L>
      <L x={408} y={210} size={7} color={AC}>
        {t('techDataBlocked')}
      </L>
    </g>
  )
}

export function TechSheet(): React.JSX.Element {
  const t = useT()
  return (
    <div className="sheet-card min-w-0 flex-1 overflow-y-auto" style={{ padding: '24px 28px' }}>
      <div style={{ font: '500 21px var(--serif)' }}>{t('techHead')}</div>
      <div className="mmeta" style={{ marginTop: 5, letterSpacing: '.5px' }}>
        {t('techSub')}
      </div>
      <div style={{ maxWidth: 1120 }}>
        <Legend />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))',
            gap: 14,
            marginTop: 16
          }}
        >
          <Fig no="01" title={t('techTriageTitle')} cap={t('techTriageCap')} viewH={146}>
            <FigTriage />
          </Fig>
          <Fig no="02" title={t('techAddrTitle')} cap={t('techAddrCap')} viewH={248}>
            <FigAddr />
          </Fig>
          <Fig no="03" title={t('techSieveTitle')} cap={t('techSieveCap')} viewH={350}>
            <FigSieve />
          </Fig>
          <Fig no="04" title={t('techSearchTitle')} cap={t('techSearchCap')} viewH={158}>
            <FigSearch />
          </Fig>
          <Fig no="05" title={t('techAskTitle')} cap={t('techAskCap')} viewH={186}>
            <FigAsk />
          </Fig>
          <Fig no="06" title={t('techVoiceTitle')} cap={t('techVoiceCap')} viewH={216}>
            <FigVoice />
          </Fig>
          <Fig no="07" title={t('techSpellTitle')} cap={t('techSpellCap')} viewH={136}>
            <FigSpell />
          </Fig>
          <Fig no="08" title={t('techRulesTitle')} cap={t('techRulesCap')} viewH={196}>
            <FigRules />
          </Fig>
          <Fig no="09" title={t('techRadarTitle')} cap={t('techRadarCap')} viewH={160}>
            <FigRadar />
          </Fig>
          <Fig no="10" title={t('techDataTitle')} cap={t('techDataCap')} viewH={224}>
            <FigData />
          </Fig>
        </div>
        <NetworkConnections />
      </div>
    </div>
  )
}
