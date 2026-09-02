import { Sparkles } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ErrorBanner } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/utils";

/**
 * Off while the shape of the ask is still being settled: the rewrite path
 * behind it (the endpoint, the pending rewrite, the change list) is whole, and
 * turning this on is all it takes to reach it again.
 */
export const REWRITE_BAR_ENABLED = false;

/** The standing asks, sent as the instruction exactly as they read. */
const PRESETS = ["shorter", "warmer", "formal"] as const;

/**
 * Say what should be different, in the letter itself. The result comes back as
 * a rewrite the reader shows and the user keeps or drops, so this bar submits
 * an instruction and owns nothing but the asking: the text, the wait, and a
 * failure to ask again.
 */
export function RewriteBar({
  onSubmit,
  disabled,
  autoFocus,
}: {
  /** Rejects to report the failure here; resolving clears the line. */
  onSubmit: (instruction: string) => Promise<void>;
  disabled?: boolean;
  /** Opened from Home's rewrite action, so the caret starts here. */
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (instruction: string) => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(instruction);
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const blocked = disabled || busy;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked && text.trim()) void run(text.trim());
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("drafts.rewriteAsk")}
          aria-label={t("drafts.rewriteAsk")}
          disabled={blocked}
          autoFocus={autoFocus}
          className="h-8 flex-1 text-sm"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          className="icon-refine hover:bg-accent/10 hover:text-accent-text"
          disabled={blocked || !text.trim()}
          loading={busy}
          title={t("drafts.rewrite")}
          aria-label={t("drafts.rewrite")}
        >
          <Sparkles />
        </Button>
      </div>
      {/* The standing asks stand in for typing, so they step aside once the
          user types their own. */}
      {!text && (
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <Chip
              key={preset}
              onClick={() => void run(t(`drafts.rewritePresets.${preset}`))}
              disabled={blocked}
              className="disabled:opacity-50"
            >
              {t(`drafts.rewritePresets.${preset}`)}
            </Chip>
          ))}
        </div>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </form>
  );
}
