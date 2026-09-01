import {
  type AppStatus,
  isSetupComplete,
  type LlmProviderInfo,
  type PipedreamStatus,
} from "@marlen/shared";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { LoadingRow, Notice } from "@/components/ui/feedback";
import { LinkButton } from "@/components/ui/link-button";
import { StepCircle } from "@/components/ui/step-circle";
import { Accounts } from "@/features/connections/Accounts";
import { PipedreamWizard } from "@/features/connections/ConnectionsPanel";
import { Providers } from "@/features/settings/Providers";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn, rowTransition, stagger, withViewTransition } from "@/lib/utils";

type SetupStepId = "ai" | "email";

interface SetupProgress {
  ai: boolean;
  email: boolean;
}

function nextIncompleteStep(progress: SetupProgress): SetupStepId | null {
  if (!progress.ai) return "ai";
  if (!progress.email) return "email";
  return null;
}

/**
 * If the freshly signed-in provider isn't the active one, silently make it
 * active (first model of its catalog), otherwise the gate never completes
 * for users who pick a provider other than the default. Settings → AI stays
 * the place to change it.
 */
async function ensureActiveModel(providers: LlmProviderInfo[]): Promise<void> {
  try {
    const authed = providers.filter((p) => p.auth !== null);
    if (authed.length === 0) return;
    const settings = await api.modelSettings();
    if (authed.some((p) => p.id === settings.provider)) return;
    for (const p of authed) {
      const [first] = settings.catalog.find((c) => c.id === p.id)?.models ?? [];
      if (first) {
        await api.setModel(p.id, first.id);
        return;
      }
    }
  } catch {
    // Non-fatal: the model picker in Settings still covers this.
  }
}

/**
 * First-run flow shown instead of the app until the two things the agent
 * can't work without exist: AI credentials and one connected email account.
 */
export function SetupGate({
  status,
  onStatusChanged,
  onFinish,
}: {
  // null while the server can't be reached, the gate stays up and shows an
  // offline notice instead of falling through to the main app.
  status: AppStatus | null;
  onStatusChanged: () => void;
  /** Dismiss the gate; `openSettings` lands on Settings instead of Home. */
  onFinish: (openSettings: boolean) => void;
}) {
  const { t } = useTranslation();
  const [providers, setProviders] = React.useState<LlmProviderInfo[] | null>(null);
  const complete = status !== null && isSetupComplete(status);
  const aiComplete = Boolean(status?.modelConfigured);
  const emailComplete = (status?.emailAccounts ?? 0) > 0;
  const [openStep, setOpenStep] = React.useState<SetupStepId | null>(() =>
    nextIncompleteStep({ ai: aiComplete, email: emailComplete }),
  );

  React.useEffect(() => {
    setOpenStep((current) => {
      const next = nextIncompleteStep({ ai: aiComplete, email: emailComplete });
      if (next === null) return null;
      const currentComplete = current === "ai" ? aiComplete : emailComplete;
      if (current === null || currentComplete) return next;
      return current;
    });
  }, [aiComplete, emailComplete]);

  const toggleStep = (step: SetupStepId) => {
    withViewTransition(() => setOpenStep((current) => (current === step ? null : step)));
  };

  // A build without a usable email bridge gets the Pipedream credentials
  // wizard inline in step 2, the guided flow must not dead-end in Settings.
  const [pdStatus, setPdStatus] = React.useState<PipedreamStatus | null>(null);
  const needsWizard = status !== null && !status.pipedreamConfigured;
  React.useEffect(() => {
    if (!needsWizard) return;
    let cancelled = false;
    api
      .pipedreamStatus()
      .then((s) => {
        if (!cancelled) setPdStatus(s);
      })
      .catch((err) => toast.error(err));
    return () => {
      cancelled = true;
    };
  }, [needsWizard]);

  const refreshProviders = React.useCallback(async () => {
    try {
      const list = await api.llmProviders();
      setProviders(list);
      await ensureActiveModel(list);
    } catch (err) {
      toast.error(err);
    }
    onStatusChanged();
  }, [onStatusChanged]);

  React.useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  // Sign-in and account linking both finish in other tabs; polling is the
  // only reliable completion signal while the gate is up.
  React.useEffect(() => {
    if (complete) return;
    const timer = setInterval(onStatusChanged, 4000);
    return () => clearInterval(timer);
  }, [complete, onStatusChanged]);

  return (
    <div className="min-h-dvh overflow-y-auto scroll-stable px-5 py-12 sm:px-8">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-10">
        <div className="flex flex-col gap-3">
          <img src="/logo.svg" alt="" className="h-9 w-fit object-contain" />
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-tight">{t("setup.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("setup.intro")}</p>
          </div>
        </div>

        {status === null ? (
          <Notice tone="warning" className="animate-in-up flex flex-col items-start gap-1.5 p-4">
            <p className="text-sm font-medium">{t("setup.offlineTitle")}</p>
            <p className="text-sm">{t("setup.offlineBody")}</p>
          </Notice>
        ) : (
          <>
            <Step
              id="ai"
              index={1}
              done={status.modelConfigured}
              expanded={openStep === "ai"}
              title={t("setup.stepAiTitle")}
              description={t("setup.stepAiDescription")}
              summary={t("setup.aiDone", { model: status.model })}
              onToggle={() => toggleStep("ai")}
            >
              {status.modelConfigured ? (
                <p className="text-sm font-medium text-success">
                  {t("setup.aiDone", { model: status.model })}
                </p>
              ) : (
                <Providers providers={providers} onChanged={refreshProviders} />
              )}
            </Step>

            <Step
              id="email"
              index={2}
              done={status.emailAccounts > 0}
              expanded={openStep === "email"}
              title={t("setup.stepEmailTitle")}
              description={t("setup.stepEmailDescription")}
              summary={t("setup.emailDone", { count: status.emailAccounts })}
              onToggle={() => toggleStep("email")}
            >
              {status.pipedreamConfigured ? (
                <div className="flex flex-col gap-3">
                  <Accounts onChanged={onStatusChanged} />
                  <LinkButton onClick={() => onFinish(true)}>{t("setup.advancedLink")}</LinkButton>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">{t("setup.pipedreamMissingBody")}</p>
                  {pdStatus ? (
                    <PipedreamWizard status={pdStatus} onSaved={async () => onStatusChanged()} />
                  ) : (
                    <LoadingRow />
                  )}
                </div>
              )}
            </Step>
          </>
        )}

        {complete ? (
          <Notice tone="success" className="flex flex-col items-start gap-2 p-4">
            <p className="text-sm font-medium">{t("setup.allSetTitle")}</p>
            <p className="text-sm">{t("setup.allSetBody")}</p>
            <p className="text-sm">{t("setup.allSetReadOnly")}</p>
            <Button className="mt-1" onClick={() => onFinish(false)}>
              {t("setup.openApp")}
            </Button>
          </Notice>
        ) : (
          <LinkButton onClick={() => onFinish(false)} className="text-sm hover:no-underline">
            {t("setup.skip")}
          </LinkButton>
        )}
      </div>
    </div>
  );
}

function Step({
  id,
  index,
  done,
  expanded,
  title,
  description,
  summary,
  onToggle,
  children,
}: {
  id: SetupStepId;
  index: number;
  done: boolean;
  expanded: boolean;
  title: string;
  description: string;
  summary: string;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const triggerId = `setup-${id}-trigger`;
  const bodyId = `setup-${id}-body`;
  const descriptionId = `setup-${id}-description`;

  return (
    <section
      className="animate-in-up flex flex-col gap-4"
      style={{ ...stagger(index - 1), ...rowTransition(`setup-${id}`) }}
    >
      <h2>
        <button
          id={triggerId}
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={title}
          aria-describedby={descriptionId}
          onClick={onToggle}
          className="group flex w-full items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <StepCircle tone={done ? "tint-success" : "tint-neutral"} className="mt-0.5">
            {done ? <Check className="h-3 w-3" /> : index}
          </StepCircle>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-base font-semibold tracking-tight text-foreground group-hover:text-muted-foreground">
              {title}
            </span>
            <span
              id={descriptionId}
              className={cn(
                "text-sm font-normal",
                done && !expanded ? "text-success" : "text-muted-foreground",
              )}
            >
              {done && !expanded ? summary : description}
            </span>
          </span>
          {expanded ? (
            <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </h2>
      {expanded && (
        <section id={bodyId} aria-labelledby={triggerId} className="animate-in-up sm:pl-8">
          {children}
        </section>
      )}
    </section>
  );
}
