import { useQuery } from '@tanstack/react-query'
import type { MessageDetail } from '@shared/types'
import { MailFrame, PlainTextBody } from './MailFrame'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'

interface OriginalMailBodyProps {
  message: MessageDetail | undefined
  loading: boolean
}

/** Full text of a source mail, in the same secure MailFrame as in the inbox. */
export function OriginalMailBody({ message, loading }: OriginalMailBodyProps): React.JSX.Element {
  const t = useT()
  const html = message?.bodyHtml ?? null
  const needsCid = html?.includes('cid:') ?? false
  const inline = useQuery({
    queryKey: ['inlineImages', message?.id],
    queryFn: () => invoke('messages:inlineImages', { messageId: message!.id }),
    enabled: message !== undefined && needsCid,
    staleTime: Infinity
  })

  if (loading) {
    return (
      <div style={{ font: 'italic 13px var(--serif)', color: 'var(--faint)' }}>
        {t('originalMailLoading')}
      </div>
    )
  }

  if (!message || (!html && !message.bodyText?.trim())) {
    return (
      <div style={{ font: 'italic 13px var(--serif)', color: 'var(--faint)' }}>
        {t('originalMailUnavailable')}
      </div>
    )
  }

  if (html) {
    return (
      <MailFrame
        html={html}
        fromAddr={message.fromAddr}
        inlineImages={inline.data?.images ?? {}}
        remoteImagesAllowed={message.remoteImagesAllowed}
      />
    )
  }

  return <PlainTextBody text={message.bodyText!} />
}
