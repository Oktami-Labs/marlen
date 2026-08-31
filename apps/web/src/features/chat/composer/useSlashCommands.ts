import type { Automation, WikiPage } from "@marlen/shared";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/** One line of the slash menu. */
export interface SlashCommand {
  id: string;
  label: string;
  detail?: string;
  /** Right-hand kind marker: skill, automation, or the app's own commands. */
  hint: string;
  perform: () => void;
}

export interface SlashMenuState {
  open: boolean;
  items: SlashCommand[];
  active: number;
  setActive: (index: number) => void;
  pick: (command: SlashCommand) => void;
  /** Handles the menu's keys; true when the key was the menu's and not the composer's. */
  onKeyDown: (event: React.KeyboardEvent) => boolean;
}

/** The composer holds a bare "/word": a command is being typed, not a message. */
const SLASH = /^\/(\S*)$/;

function matches(command: SlashCommand, query: string): boolean {
  if (!query) return true;
  const needle = query.toLocaleLowerCase();
  return (
    command.id.toLocaleLowerCase().includes(needle) ||
    command.label.toLocaleLowerCase().includes(needle)
  );
}

/**
 * The composer's command menu: type "/" and the things this install can
 * actually do float above the input. Its contents are the user's own work,
 * their skills and their schedule-less automations, plus the app's few
 * built-in commands, which is what makes a skill reachable without
 * remembering how to phrase it and a manual automation runnable without
 * leaving the chat.
 */
export function useSlashCommands({
  input,
  setInput,
  submit,
  newConversation,
}: {
  input: string;
  setInput: (text: string) => void;
  /** Sends text as a turn (or queues it behind a running one). */
  submit: (text: string) => void;
  newConversation: () => void;
}): SlashMenuState {
  const { t } = useTranslation();
  const [active, setActive] = React.useState(0);
  // Dismissed with Escape: stays shut until the composer's text changes again.
  const [dismissed, setDismissed] = React.useState("");

  const typed = SLASH.exec(input)?.[1];
  const armed = typed !== undefined && dismissed !== input;

  // Only fetched once a command is being typed; both lists are small and
  // their SSE topics keep them current for the rest of the session.
  const skills = useQuery({ queryKey: ["wiki"], queryFn: api.wiki, enabled: armed });
  const automations = useQuery({
    queryKey: ["automations", "list"],
    queryFn: api.automations,
    enabled: armed,
  });

  const items = React.useMemo(() => {
    const commands: SlashCommand[] = [];
    for (const page of (skills.data ?? []) as WikiPage[]) {
      if (page.type !== "skill") continue;
      commands.push({
        id: page.id,
        label: page.id,
        detail: page.content.split("\n")[0]?.trim(),
        hint: t("chat.slash.skill"),
        // Prefilled rather than sent: a skill nearly always needs the case it
        // is being run on ("…for Mr Müller"), and that is typed right here.
        perform: () => setInput(t("chat.slash.skillPrompt", { name: page.id })),
      });
    }
    // A schedule-less automation is a button the user built: running it is
    // the whole point, so picking it runs it.
    for (const automation of (automations.data ?? []) as Automation[]) {
      if (automation.schedule.trim()) continue;
      commands.push({
        id: automation.id,
        label: automation.name,
        detail: automation.instruction,
        hint: t("chat.slash.automation"),
        perform: () => {
          setInput("");
          api
            .runAutomation(automation.id)
            .then(() => toast.success(t("chat.slash.automationStarted", { name: automation.name })))
            .catch((err) => toast.error(err));
        },
      });
    }
    commands.push({
      id: "new",
      label: t("chat.slash.new"),
      hint: t("chat.slash.builtin"),
      perform: () => {
        setInput("");
        newConversation();
      },
    });
    commands.push({
      id: "sys",
      label: t("chat.slash.systemPrompt"),
      hint: t("chat.slash.builtin"),
      perform: () => {
        setInput("");
        submit("/sys");
      },
    });
    return commands;
  }, [skills.data, automations.data, t, setInput, submit, newConversation]);

  const filtered = React.useMemo(
    () => (armed ? items.filter((command) => matches(command, typed ?? "")) : []),
    [armed, items, typed],
  );
  const open = armed && filtered.length > 0;

  // A different filter is a different list; never leave the highlight past its end.
  const clamped = Math.min(active, Math.max(0, filtered.length - 1));

  const pick = React.useCallback((command: SlashCommand) => {
    setActive(0);
    setDismissed("");
    command.perform();
  }, []);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (!open) return false;
      if (event.key === "Escape") {
        setDismissed(input);
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActive((clamped + delta + filtered.length) % filtered.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const command = filtered[clamped];
        if (!command) return false;
        pick(command);
        return true;
      }
      return false;
    },
    [open, input, clamped, filtered, pick],
  );

  return { open, items: filtered, active: clamped, setActive, pick, onKeyDown };
}
