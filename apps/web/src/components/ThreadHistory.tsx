import type { EmailThreadMessage } from "@marlen/shared";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { EmailBody } from "@/components/EmailBody";
import { MessageHeader, RecipientLine } from "@/components/MessageHeader";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { LoadingRow, RetryableError } from "@/components/ui/feedback";
import { parseAddress } from "@/lib/addresses";
import { api, isNotFound } from "@/lib/api";
import { dayTimeLabel } from "@/lib/dates";
import { errorMessage } from "@/lib/utils";

/**
 * Collapsible conversation history for anything that references a provider
 * thread, reply drafts in the chat card and the Home review list. The thread
 * is read live on first expand (nothing is stored locally), with the last
 * message opened since that's the one being replied to. A thread with no
 * earlier messages (a draft that isn't a reply sits alone in its own thread)
 * renders a quiet empty line instead of an error.
 */
export function ThreadHistory({
  accountId,
  threadId,
  self,
}: {
  accountId: string;
  threadId: string;
  /** The account's own address, so its messages read as "me". */
  self?: string;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<EmailThreadMessage[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [openIndexes, setOpenIndexes] = React.useState<Set<number>>(new Set());

  const load = React.useCallback(async () => {
    setError(null);
    // A draft without a provider thread id has no history.
    if (!threadId) {
      setMessages([]);
      return;
    }
    try {
      const detail = await api.threadDetail(accountId, threadId);
      setMessages(detail.messages);
      setOpenIndexes(new Set(detail.messages.length > 0 ? [detail.messages.length - 1] : []));
    } catch (err) {
      // A 404 means the thread contains only the standalone draft. It is not a failure.
      if (isNotFound(err)) setMessages([]);
      else setError(errorMessage(err));
    }
  }, [accountId, threadId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && messages === null && !error) void load();
  };

  const toggleMessage = (index: number) => {
    setOpenIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <DisclosureToggle open={open} onToggle={toggle}>
        {open ? t("threadHistory.hide") : t("threadHistory.show")}
      </DisclosureToggle>
      {open &&
        (error ? (
          <RetryableError onRetry={() => void load()}>{error}</RetryableError>
        ) : messages === null ? (
          <LoadingRow className="py-1 text-xs" />
        ) : messages.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">{t("threadHistory.empty")}</p>
        ) : (
          <div className="flex flex-col">
            {messages.map((message, index) => (
              <ThreadMessageRow
                key={message.id ?? `${message.date}-${message.from}`}
                message={message}
                open={openIndexes.has(index)}
                onToggle={() => toggleMessage(index)}
                lang={i18n.language}
                self={self}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

/**
 * One message, set like a mail client: the sender's avatar and name, the time
 * on the right, and a snippet standing in for the body until the row is opened.
 * The whole header is the toggle, so there is no chevron to aim at.
 */
export function ThreadMessageRow({
  message,
  open,
  onToggle,
  lang,
  self,
}: {
  message: EmailThreadMessage;
  open: boolean;
  onToggle: () => void;
  lang: string;
  self?: string;
}) {
  const { t } = useTranslation();
  const sender = parseAddress(message.from);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full rounded-lg px-2 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <MessageHeader
          name={sender.name}
          detail={open ? sender.address : undefined}
          time={dayTimeLabel(message.date, lang, "long")}
          dateTime={message.date}
        >
          {open ? (
            <>
              <RecipientLine kind="to" addresses={message.to} self={self} />
              <RecipientLine kind="cc" addresses={message.cc} self={self} />
            </>
          ) : (
            <p className="truncate text-xs text-muted-foreground">{message.body}</p>
          )}
        </MessageHeader>
      </button>

      {open && (
        /* Body indents to the sender's text edge, keeping the avatar column clear. */
        <div className="flex flex-col gap-2 pb-6 pl-13 pr-2 pt-2">
          {message.bodyHtml ? (
            <EmailBody html={message.bodyHtml} />
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.body || t("threadHistory.emptyBody")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
