import type { AgentCard, FormField as Field } from "@marlen/shared";
import { ClipboardList } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { sendChatCommand } from "@/features/chat/controller";
import { CardShell } from "./CardShell";

type FormData = Extract<AgentCard, { kind: "form" }>;

const INPUT_TYPE: Partial<Record<Field["kind"], string>> = { number: "number", date: "date" };

/**
 * The agent asking for the several details a task is missing, in one go
 * instead of one turn per field. Submitting sends the filled fields as the
 * next message of this same conversation (the choices card's `answer`
 * command), so the exchange reads as the user having answered.
 */
export function FormCard({ card }: { card: FormData }) {
  const { t } = useTranslation();
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [sent, setSent] = React.useState(false);

  const value = (field: Field) => values[field.name] ?? "";
  const set = (field: Field, next: string) =>
    setValues((current) => ({ ...current, [field.name]: next }));
  const missing = card.fields.some((field) => field.required && !value(field).trim());

  const submit = () => {
    const filled = card.fields
      .map((field) => ({ field, text: value(field).trim() }))
      .filter((entry) => entry.text);
    if (filled.length === 0) return;
    setSent(true);
    sendChatCommand({
      kind: "answer",
      text: filled.map((entry) => `${entry.field.label}: ${entry.text}`).join("\n"),
    });
  };

  return (
    <CardShell icon={ClipboardList} label={t("chat.cards.form.badge")} title={card.title}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {card.fields.map((field) => {
          const id = `form-${card.title}-${field.name}`;
          return (
            <FormField key={field.name} id={id} label={field.label}>
              {field.kind === "long" ? (
                <Textarea
                  id={id}
                  value={value(field)}
                  onChange={(e) => set(field, e.target.value)}
                  placeholder={field.placeholder}
                  disabled={sent}
                />
              ) : field.kind === "choice" ? (
                <Select
                  id={id}
                  value={value(field)}
                  onChange={(next) => set(field, next)}
                  options={(field.options ?? []).map((option) => ({
                    value: option,
                    label: option,
                  }))}
                  placeholder={field.placeholder}
                />
              ) : (
                <Input
                  id={id}
                  type={INPUT_TYPE[field.kind]}
                  value={value(field)}
                  onChange={(e) => set(field, e.target.value)}
                  placeholder={field.placeholder}
                  disabled={sent}
                />
              )}
            </FormField>
          );
        })}
        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={sent || missing}>
            {sent ? t("chat.cards.form.sent") : t("chat.cards.form.submit")}
          </Button>
        </div>
      </div>
    </CardShell>
  );
}
