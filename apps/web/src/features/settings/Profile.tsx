import {
  USER_PROFILE_ABOUT_MAX,
  USER_PROFILE_NAME_MAX,
  type UserProfile,
  type UserProfileText,
} from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { AvatarMark } from "@/components/ui/avatar-mark";
import { Button } from "@/components/ui/button";
import { LoadingRow, RetryableError } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";
import { Section } from "@/components/ui/section-header";
import { SettingRow } from "@/components/ui/setting-row";
import { Textarea } from "@/components/ui/textarea";
import { loadImage } from "@/features/connections/signatureHtml";
import { SaveStatus, useSaveState } from "@/features/settings/AppPreferenceControls";
import { isEmailApp, useAccountColors } from "@/lib/accounts";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { profileQuery } from "@/lib/useServerPreferences";
import { errorMessage, withViewTransition } from "@/lib/utils";

/** The picture is stored square at this size; the mark never shows it larger. */
const AVATAR_SIDE = 256;

/** Center-crops the chosen file to a square and re-encodes it small. */
async function fileToAvatarDataUri(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIDE;
    canvas.height = AVATAR_SIDE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIDE,
      AVATAR_SIDE,
    );
    return canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Settings → Profile: who the assistant works for. The name and the free text
 * ride in every system prompt, so they save on blur like every other setting
 * and the open sessions pick them up on their next turn.
 */
export function ProfileSettings() {
  const { t } = useTranslation();
  const { data: profile, error, refetch } = useQuery(profileQuery);

  if (!profile) {
    return error ? (
      <RetryableError onRetry={() => void refetch()}>{errorMessage(error)}</RetryableError>
    ) : (
      <LoadingRow />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <Section index={0} className="animate-in-up" title={t("settings.profile.title")}>
        <ProfileForm profile={profile} />
      </Section>
      <Section index={1} className="animate-in-up" title={t("settings.profile.identity.title")}>
        <AddressesRow />
      </Section>
    </div>
  );
}

function ProfileForm({ profile }: { profile: UserProfile }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { state, error, run } = useSaveState();
  // A field holds its own text only while it is being edited; once saved the
  // query is the source again, so a refetch can never overwrite typing.
  const [name, setName] = React.useState<string | null>(null);
  const [about, setAbout] = React.useState<string | null>(null);

  const save = (next: UserProfileText) => {
    if (next.name === profile.name && next.about === profile.about) {
      setName(null);
      setAbout(null);
      return;
    }
    void run(async () => {
      const { profile: saved } = await api.setProfile(next);
      queryClient.setQueryData(profileQuery.queryKey, saved);
      setName(null);
      setAbout(null);
    });
  };

  const shownName = name ?? profile.name;
  const shownAbout = about ?? profile.about;
  const commit = () => save({ name: shownName.trim(), about: shownAbout.trim() });

  return (
    <div className="flex flex-col gap-4">
      <ProfilePicture profile={profile} name={shownName.trim() || t("sidebar.localProfile")} />
      <div className="flex flex-col gap-1">
        <SettingRow
          bare
          htmlFor="settings-profile-name"
          label={t("settings.profile.name.label")}
          description={t("settings.profile.name.description")}
          className="rounded-lg px-2 py-2.5"
        >
          <SaveStatus state={state} error={error} />
          <Input
            id="settings-profile-name"
            className="w-full @md:w-64"
            value={shownName}
            maxLength={USER_PROFILE_NAME_MAX}
            placeholder={t("settings.profile.name.placeholder")}
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </SettingRow>
        <div className="flex flex-col gap-2 rounded-lg px-2 py-2.5">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="settings-profile-about" className="text-sm font-medium">
              {t("settings.profile.about.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.profile.about.description")}
            </p>
          </div>
          <Textarea
            id="settings-profile-about"
            rows={4}
            value={shownAbout}
            maxLength={USER_PROFILE_ABOUT_MAX}
            placeholder={t("settings.profile.about.placeholder")}
            onChange={(event) => setAbout(event.target.value)}
            onBlur={commit}
          />
        </div>
      </div>
    </div>
  );
}

function ProfilePicture({ profile, name }: { profile: UserProfile; name: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const apply = async (change: () => Promise<{ profile: UserProfile }>) => {
    setBusy(true);
    try {
      const { profile: saved } = await change();
      queryClient.setQueryData(profileQuery.queryKey, saved);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <div className="relative">
        <AvatarMark
          name={name}
          src={profile.avatar}
          tone="tint-accent"
          className="h-24 w-24 text-2xl"
        />
        <Button
          variant="secondary"
          size="icon-sm"
          loading={busy}
          aria-label={t("settings.profile.picture.change")}
          className="absolute -bottom-0.5 -right-0.5 rounded-full"
          onClick={() => fileInput.current?.click()}
        >
          <Pencil />
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void apply(async () => api.setProfileAvatar(await fileToAvatarDataUri(file)));
          }}
        />
      </div>
      {profile.avatar && (
        <LinkButton disabled={busy} onClick={() => void apply(api.removeProfileAvatar)}>
          {t("settings.profile.picture.remove")}
        </LinkButton>
      )}
    </div>
  );
}

function AddressesRow() {
  const { t } = useTranslation();
  const [, setSearchParams] = useSearchParams();
  const { accounts } = useAccountColors();
  const addresses = accounts.filter((account) => isEmailApp(account.app));

  return (
    <SettingRow
      bare
      label={t("settings.profile.identity.label")}
      description={
        addresses.length > 0
          ? addresses.map((account) => account.name).join(", ")
          : t("settings.profile.identity.none")
      }
      className="rounded-lg px-2 py-2.5"
    >
      <Button
        variant="secondary"
        size="sm"
        onClick={() => withViewTransition(() => setSearchParams({ section: "connections" }))}
      >
        {t("settings.nav.connections")}
      </Button>
    </SettingRow>
  );
}
