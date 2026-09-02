import { initials } from "@/lib/addresses";
import { cn } from "@/lib/utils";

/**
 * The round identity mark for a person: initials read off a name or a mail
 * address, fronting a message, a draft row, or a card header. The tone is the
 * item's type color, accent for a draft the agent wrote, neutral for a message
 * that came in. The user's own mark shows their picture instead once they set
 * one. `AgentAvatar` is the assistant's own mark and not this.
 */
export function AvatarMark({
  name,
  src,
  tone = "tint-neutral",
  size = "md",
  className,
}: {
  name: string;
  /** The person's picture, replacing the initials. */
  src?: string | null;
  tone?: "tint-accent" | "tint-neutral";
  /** sm = 24px (list rows), md = 32px (a message being read). */
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium tracking-tight",
        size === "sm" ? "h-6 w-6 text-3xs" : "h-8 w-8 text-2xs",
        tone,
        className,
      )}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}
