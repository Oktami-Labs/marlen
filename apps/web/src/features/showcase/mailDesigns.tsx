import {
  ChevronDown,
  ChevronRight,
  Send,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { AvatarMark } from "@/components/ui/avatar-mark";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section-header";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/* ── Fixtures ─────────────────────────────────────────────────────────────
 * One draft awaiting approval, in a list with its neighbours, so each variant
 * is judged where it actually lives rather than on a blank page. */

const DRAFT = {
  subject: "Re: Workshop in September, logistics",
  to: "Markus Lindqvist",
  cc: "Julia Brandt",
  date: "21. Juli, 15:44",
  body: `Hi Markus,

Sep 17 works for me, let's lock it in. Hamburg office is fine, and splitting catering sounds fair.

I'll take a first pass at the agenda and send a draft this week so we have something to react to rather than starting from scratch on the day. I can bring a projector, so that's covered.

Best,
Alex`,
  signature: "Alex Spork\nNordwind Studio, Design & Branding\nnordwind-studio.de",
};

interface RowData {
  subject: string;
  to: string;
  date: string;
}

const BEFORE: RowData = {
  subject: "Ihr Interesse am Penthouse-Neubau",
  to: "Sophie Wagner",
  date: "22. Juli, 10:53",
};
const AFTER: RowData = {
  subject: "Re: Anfrage IT-Betreuung",
  to: "T. Berger",
  date: "21. Juli, 13:33",
};
const DRAFT_ROW: RowData = { subject: DRAFT.subject, to: DRAFT.to, date: DRAFT.date };

const THREAD = [
  {
    from: "Markus Lindqvist",
    when: "Samstag, 18. Juli · 23:15",
    snippet: "Hi Alex, hi Julia, following up on our call: let's nail down the joint workshop…",
  },
  {
    from: "Julia Brandt",
    when: "Sonntag, 19. Juli · 04:03",
    snippet: "Hi both, Sep 17 is better for us, the 10th collides with our quarterly review…",
  },
];

/* ── Shared row parts ─────────────────────────────────────────────────────── */

function RowActions({ expanded }: { expanded?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
      <SquareArrowOutUpRight className="h-3.5 w-3.5" />
      <Sparkles className="h-3.5 w-3.5" />
      <Send className="ml-1 h-3.5 w-3.5" />
      <Trash2 className="h-3.5 w-3.5" />
      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </div>
  );
}

/** A neighbouring approval, collapsed: the state every variant shares. */
function CollapsedRow({ subject, to, date }: RowData) {
  return (
    <div className="surface flex items-center gap-2 rounded-lg px-2.5 py-2.5">
      <AvatarMark name={to} tone="tint-accent" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{subject}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="text-muted-foreground/70">An:</span> {to}
        </p>
      </div>
      <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">{date}</span>
      <RowActions />
    </div>
  );
}

/** The subject line every open variant carries at the top of the row. */
function OpenRowHeader() {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2.5">
      <AvatarMark name={DRAFT.to} tone="tint-accent" size="sm" />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{DRAFT.subject}</p>
      <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
        {DRAFT.date}
      </span>
      <RowActions expanded />
    </div>
  );
}

/** The quoted history, the one part of a draft that can grow without limit. */
function ThreadStrip({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ChevronRight className="h-3.5 w-3.5" />
        Frühere Nachrichten anzeigen ({THREAD.length})
      </p>
    </div>
  );
}

function ThreadOpen() {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ChevronDown className="h-3.5 w-3.5" />
        Frühere Nachrichten ausblenden
      </p>
      {THREAD.map((message) => (
        <div key={message.from} className="flex items-start gap-3">
          <AvatarMark name={message.from} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{message.from}</p>
            <p className="truncate text-xs text-muted-foreground">{message.snippet}</p>
          </div>
          <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
            {message.when}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The letter itself at a reading measure, shared by every variant. */
function LetterProse({ measured = true }: { measured?: boolean }) {
  return (
    <div className={cn("flex flex-col", measured && "max-w-[68ch]")}>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{DRAFT.body}</p>
      <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
        {DRAFT.signature}
      </p>
    </div>
  );
}

function VariantFrame({
  name,
  note,
  children,
}: {
  name: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold tracking-tight">{name}</p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      <div className="rounded-xl bg-background p-3">{children}</div>
    </div>
  );
}

/* ── A · Inline, measured ─────────────────────────────────────────────────── */

function VariantInline() {
  return (
    <div className="flex flex-col gap-2">
      <CollapsedRow {...BEFORE} />
      <div className="surface rounded-lg">
        <OpenRowHeader />
        <div className="flex flex-col gap-4 px-2.5 pb-4 pl-10">
          <p className="border-b border-border pb-3 text-xs text-muted-foreground">
            <span className="text-muted-foreground/70">An:</span> {DRAFT.to}
            <span className="px-1.5 text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/70">Cc:</span> {DRAFT.cc}
          </p>
          <LetterProse />
          <ThreadStrip />
        </div>
      </div>
      <CollapsedRow {...AFTER} />
    </div>
  );
}

/* ── B · Letter on paper ──────────────────────────────────────────────────── */

function VariantPaper() {
  return (
    <div className="flex flex-col gap-2">
      <CollapsedRow {...BEFORE} />
      <div className="surface rounded-lg">
        <OpenRowHeader />
        <div className="flex flex-col gap-3 px-2.5 pb-3 pl-10">
          <div className="overflow-hidden rounded-[--radius] bg-surface-2">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-3 text-sm">
              <span className="text-muted-foreground">An:</span>
              <span className="truncate">{DRAFT.to}</span>
              <span className="text-muted-foreground">Cc:</span>
              <span className="truncate">{DRAFT.cc}</span>
              <span className="text-muted-foreground">Betreff:</span>
              <Input
                defaultValue={DRAFT.subject}
                className="-mx-1.5 h-auto rounded-sm bg-transparent px-1.5 py-0.5 text-sm"
              />
            </div>
            <div className="px-4 py-4">
              <LetterProse />
            </div>
          </div>
          <ThreadStrip />
        </div>
      </div>
      <CollapsedRow {...AFTER} />
    </div>
  );
}

/* ── C · Focus sheet ──────────────────────────────────────────────────────── */

function VariantSheet() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col gap-2">
      <CollapsedRow {...BEFORE} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="surface surface-hover flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-left"
      >
        <AvatarMark name={DRAFT.to} tone="tint-accent" size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{DRAFT.subject}</p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="text-muted-foreground/70">An:</span> {DRAFT.to} · Sep 17 works for me,
            let's lock it in. Hamburg office…
          </p>
        </div>
        <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
          {DRAFT.date}
        </span>
        <RowActions />
      </button>
      <CollapsedRow {...AFTER} />

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={DRAFT.subject}
        className="max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost">Als Entwurf behalten</Button>
            <Button variant="ghost-danger">Verwerfen</Button>
            <Button>Senden</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 border-b border-border pb-4">
            <AvatarMark name={DRAFT.to} tone="tint-accent" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{DRAFT.to}</p>
              <p className="truncate text-xs text-muted-foreground">
                <span className="text-muted-foreground/70">Cc:</span> {DRAFT.cc}
              </p>
            </div>
            <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
              {DRAFT.date}
            </span>
          </div>
          <Textarea
            defaultValue={DRAFT.body}
            className="field-sizing-content -mx-1.5 min-h-40 resize-none bg-transparent px-1.5 text-sm leading-relaxed hover:bg-surface-2"
          />
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {DRAFT.signature}
          </p>
          <ThreadOpen />
        </div>
      </Dialog>
      <p className="text-xs text-muted-foreground">
        Klicken Sie die mittlere Zeile an, um die Ansicht zu öffnen.
      </p>
    </div>
  );
}

/* ── D · Split view ───────────────────────────────────────────────────────── */

function VariantSplit() {
  const [selected, setSelected] = React.useState(DRAFT_ROW);
  return (
    <div className="flex gap-3">
      <div className="flex w-64 shrink-0 flex-col gap-1.5">
        {[BEFORE, DRAFT_ROW, AFTER].map((row) => (
          <button
            key={row.subject}
            type="button"
            onClick={() => setSelected(row)}
            className={cn(
              "flex items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
              row === selected ? "surface" : "hover:bg-surface-2",
            )}
          >
            <AvatarMark name={row.to} tone="tint-accent" size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.subject}</p>
              <p className="truncate text-xs text-muted-foreground">{row.to}</p>
            </div>
          </button>
        ))}
      </div>
      <div className="surface min-w-0 flex-1 rounded-lg p-5">
        {selected === DRAFT_ROW ? (
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-base font-semibold tracking-tight">{DRAFT.subject}</p>
              <div className="mt-3 flex items-start gap-3 border-b border-border pb-4">
                <AvatarMark name={DRAFT.to} tone="tint-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{DRAFT.to}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="text-muted-foreground/70">Cc:</span> {DRAFT.cc}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
                  {DRAFT.date}
                </span>
              </div>
            </div>
            <LetterProse />
            <ThreadStrip />
            <div className="flex justify-end gap-2">
              <Button variant="ghost-danger">Verwerfen</Button>
              <Button>Senden</Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {selected.subject}, ausgewählt aus der Liste.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Four ways the approval list could open a draft, side by side with the same
 * content, so the choice is made by looking rather than by describing. Throwaway:
 * this tab goes once one of them wins.
 */
export function MailDesignsTab() {
  return (
    <>
      <Section
        title="Entwurf öffnen"
        description="Dieselbe E-Mail, dieselbe Liste, vier Varianten. Jede zeigt den geöffneten Entwurf zwischen zwei geschlossenen Nachbarn, damit der Vergleich im Kontext stattfindet."
      >
        <VariantFrame
          name="A · Inline, mit Satzbreite"
          note="Wie heute, aber die Kopfzeile schrumpft auf eine Zeile und der Text bricht bei 68 Zeichen um. Ruhigste Variante, kleinster Eingriff."
        >
          <VariantInline />
        </VariantFrame>

        <VariantFrame
          name="B · Brief auf Papier"
          note="Kopffelder und Text stehen auf einer eigenen, vertieften Fläche. Klarste Trennung von Liste und Nachricht, aber mehr Gewicht in der Liste."
        >
          <VariantPaper />
        </VariantFrame>

        <VariantFrame
          name="C · Fokus-Ansicht"
          note="Die Zeile öffnet den Brief über der Liste, in Lesebreite und mit Aktionen unten. Die Liste bleibt stehen, Escape schließt."
        >
          <VariantSheet />
        </VariantFrame>

        <VariantFrame
          name="D · Zwei Spalten"
          note="Die Freigaben werden zur Liste links, der Entwurf steht rechts. Am nächsten an einem Mailprogramm, braucht aber die Breite dauerhaft."
        >
          <VariantSplit />
        </VariantFrame>
      </Section>
    </>
  );
}
