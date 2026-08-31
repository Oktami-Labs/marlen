import type { LibraryDocument, LibraryStatus, WikiPage } from "@marlen/shared";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "tiptap-markdown";
import { AccountDot } from "@/components/ui/account-dot";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountColors } from "@/lib/accounts";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * The browser's md editor: tiptap over markdown (tiptap-markdown parses on
 * load and serializes on save), one dialog for both file kinds. A wiki page
 * edits its content (the first paragraph is the summary the agent carries in
 * every prompt) plus its scope tag (general or one connected account; an
 * existing contact scope shows as its own tag and is kept unless another is
 * picked). A knowledge document round-trips its raw file text through the
 * content endpoint.
 */

export type EditorTarget =
  | { kind: "page"; page: WikiPage }
  | { kind: "document"; doc: LibraryDocument }
  /** The "new file" flow: the dialog itself asks what kind to create. */
  | { kind: "create" };

/** null = keep the page's current contact scope untouched. */
type PageScope = { accountId: string | null } | null;

/** What the create flow produces; folders land in the browsed knowledge folder. */
type CreateKind = "page" | "skill" | "folder";
const CREATE_KINDS: CreateKind[] = ["page", "skill", "folder"];

function MarkdownArea({
  initial,
  onReady,
}: {
  initial: string;
  onReady: (getMarkdown: () => string) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false })],
    content: initial,
    autofocus: "end",
  });
  React.useEffect(() => {
    if (!editor) return;
    onReady(() => (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown());
  }, [editor, onReady]);
  return (
    <EditorContent
      editor={editor}
      className="min-h-48 rounded-lg bg-surface-2 px-3 py-2 text-sm leading-relaxed [&_.ProseMirror]:min-h-44 [&_.ProseMirror]:outline-none [&_.ProseMirror_h1]:text-lg [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-xs"
    />
  );
}

export function FileEditor({
  target,
  currentDir = "",
  onClose,
  onStatus,
}: {
  target: EditorTarget;
  /** Knowledge-relative folder new notes/folders are created in ("" = root). */
  currentDir?: string;
  onClose: () => void;
  /** A document save returns fresh LibraryStatus; the caller pushes it into its query. */
  onStatus: (status: LibraryStatus) => void;
}) {
  const { t } = useTranslation();
  const { accounts, colors } = useAccountColors();
  const [saving, setSaving] = React.useState(false);
  const [createKind, setCreateKind] = React.useState<CreateKind>("page");
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<PageScope>(
    target.kind === "page" && target.page.contactId !== null
      ? null
      : { accountId: target.kind === "page" ? target.page.accountId : null },
  );
  // Document text arrives async; everything else is already loaded.
  const [initial, setInitial] = React.useState<string | null>(
    target.kind === "page" ? target.page.content : target.kind === "create" ? "" : null,
  );
  const getMarkdownRef = React.useRef<(() => string) | null>(null);

  const isPage = target.kind === "page" || (target.kind === "create" && createKind === "page");

  React.useEffect(() => {
    if (target.kind !== "document") return;
    let stale = false;
    api
      .documentContent(target.doc.id)
      .then((res) => {
        if (!stale) setInitial(res.content);
      })
      .catch((err) => {
        toast.error(err);
        onClose();
      });
    return () => {
      stale = true;
    };
  }, [target, onClose]);

  const save = async () => {
    // A folder has no body; every other kind needs the mounted editor's text.
    const folderKind = target.kind === "create" && createKind === "folder";
    const markdown = folderKind ? "" : getMarkdownRef.current?.().trim();
    if (markdown === undefined) return;
    setSaving(true);
    try {
      if (target.kind === "page") {
        await (scope === null
          ? api.updatePage(target.page.id, markdown)
          : api.updatePage(target.page.id, markdown, scope.accountId, null));
      } else if (target.kind === "document") {
        onStatus(await api.saveDocumentContent(target.doc.id, markdown));
      } else if (createKind === "page") {
        await api.addPage(markdown, {
          ...(name.trim() ? { name: name.trim() } : {}),
          accountId: scope?.accountId ?? null,
        });
      } else if (createKind === "skill") {
        await api.addPage(markdown, { name: name.trim(), type: "skill" });
      } else {
        const path = currentDir ? `${currentDir}/${name.trim()}` : name.trim();
        onStatus(await api.createLibraryFolder(path));
      }
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const accountDot = (accountId: string) => (
    <AccountDot color={colors.find((c) => c.accountId === accountId)?.hex} className="h-2 w-2" />
  );

  const title =
    target.kind === "page"
      ? `${target.page.id}.md`
      : target.kind === "document"
        ? target.doc.path
        : t("storage.editor.newTitle");
  // A page can derive its name from its content; skills and folders need one.
  const nameShown = target.kind === "create";
  const needsName = target.kind === "create" && createKind !== "page";
  const isFolder = target.kind === "create" && createKind === "folder";

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      className="max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            loading={saving}
            disabled={needsName && !name.trim()}
          >
            {t("storage.editor.save")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {target.kind === "create" && (
          <div className="flex flex-wrap items-center gap-1.5">
            {CREATE_KINDS.map((kind) => (
              <Chip key={kind} active={createKind === kind} onClick={() => setCreateKind(kind)}>
                {t(`storage.editor.kinds.${kind}`)}
              </Chip>
            ))}
          </div>
        )}

        {nameShown && (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("storage.editor.namePlaceholder")}
            aria-label={t("storage.editor.namePlaceholder")}
            className="font-mono text-xs"
          />
        )}

        {isFolder ? null : initial === null ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : (
          <MarkdownArea
            initial={initial}
            onReady={(getMarkdown) => {
              getMarkdownRef.current = getMarkdown;
            }}
          />
        )}

        {isPage && <p className="text-xs text-muted-foreground">{t("storage.editor.pageHint")}</p>}

        {isPage && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t("storage.editor.scope")}</span>
            <Chip
              active={scope !== null && scope.accountId === null}
              onClick={() => setScope({ accountId: null })}
            >
              {t("storage.editor.general")}
            </Chip>
            {accounts.map((account) => (
              <Chip
                key={account.id}
                active={scope !== null && scope.accountId === account.id}
                onClick={() => setScope({ accountId: account.id })}
              >
                {accountDot(account.id)}
                {account.name}
              </Chip>
            ))}
            {target.kind === "page" && target.page.contactId !== null && (
              <Chip active={scope === null} onClick={() => setScope(null)}>
                @{target.page.contactId}
              </Chip>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
