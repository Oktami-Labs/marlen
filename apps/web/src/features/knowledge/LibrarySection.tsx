import {
  type ConnectedAccount,
  type LibraryDocument,
  type LibrarySearchHit,
  type LibraryStatus,
  splitPage,
  type WikiPage,
} from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, Upload } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RetryableError } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { StorageBrowser, type StorageNode } from "@/features/storage/StorageBrowser";
import { useAccountColors } from "@/lib/accounts";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/utils";
import { type EditorTarget, FileEditor } from "./FileEditor";

/**
 * The agent home as files, filling the Knowledge page: one StorageBrowser
 * over wiki/ and knowledge/. Wiki pages appear as their md files (content as
 * the row snippet, type or scope as the tag) and open in the FileEditor
 * dialog. Knowledge documents come from the library index, with FTS content
 * search so a query also finds text inside PDFs and Word files. Uploads land
 * in knowledge/.
 */

const WIKI_DIR = "dir:wiki";
const KNOWLEDGE_DIR = "dir:knowledge";

/** md/txt open in the in-app editor; every other format opens as a raw file. */
const EDITABLE_EXTENSIONS = new Set(["md", "markdown", "txt"]);

interface WikiLabels {
  groups: Record<string, string>;
  pinned: string;
  unused: string;
  used: (count: number) => string;
}

function folder(id: string, parentId: string | null, name: string, deletable = true): StorageNode {
  return {
    id,
    parentId,
    kind: "folder",
    name,
    ext: null,
    sizeBytes: null,
    updatedAt: "",
    deletable,
  };
}

/** A page's row tag: its type, else the account's name or @contact, none for general. */
function pageTag(page: WikiPage, accounts: ConnectedAccount[], labels: WikiLabels): string | null {
  const tags = [page.pinned ? labels.pinned : null];
  if (page.contactId !== null) tags.push(`@${page.contactId}`);
  else if (page.accountId !== null) {
    tags.push(accounts.find((a) => a.id === page.accountId)?.name ?? page.accountId);
  }
  return tags.filter(Boolean).join(" · ") || null;
}

function wikiGroup(page: WikiPage, labels: WikiLabels): { id: string; name: string } {
  const key = page.type ?? (page.contactId ? "contact" : page.accountId ? "account" : "general");
  return { id: `${WIKI_DIR}/group:${key}`, name: labels.groups[key] ?? key };
}

function toNodes(
  pages: WikiPage[],
  documents: LibraryDocument[],
  folders: string[],
  accounts: ConnectedAccount[],
  labels: WikiLabels,
): StorageNode[] {
  const nodes: StorageNode[] = [
    folder(WIKI_DIR, null, "wiki", false),
    folder(KNOWLEDGE_DIR, null, "knowledge", false),
  ];
  const groups = new Map<string, string>();
  for (const page of pages) {
    const group = wikiGroup(page, labels);
    groups.set(group.id, group.name);
    const { summary, body } = splitPage(page.content);
    const title = summary.split("\n", 1)[0]?.trim() || page.id;
    const detail = [
      page.id,
      page.usedCount > 0 ? labels.used(page.usedCount) : labels.unused,
      body.split("\n", 1)[0]?.trim(),
    ]
      .filter(Boolean)
      .join(" · ");
    nodes.push({
      id: page.id,
      parentId: group.id,
      kind: "file",
      name: title,
      ext: "md",
      sizeBytes: null,
      updatedAt: page.updatedAt,
      snippet: detail,
      tag: pageTag(page, accounts, labels),
    });
  }
  for (const [id, name] of groups) nodes.push(folder(id, WIKI_DIR, name, false));
  // The server's folder list is authoritative (it includes empty folders);
  // document paths only fill in anything the list happens to miss.
  const subfolders = new Set<string>();
  const ensureChain = (dirPath: string): string => {
    const segments = dirPath.split("/");
    let parent = KNOWLEDGE_DIR;
    for (let depth = 0; depth < segments.length; depth += 1) {
      const id = `${KNOWLEDGE_DIR}/${segments.slice(0, depth + 1).join("/")}`;
      if (!subfolders.has(id)) {
        subfolders.add(id);
        nodes.push(folder(id, parent, segments[depth] ?? dirPath));
      }
      parent = id;
    }
    return parent;
  };
  for (const dirPath of folders) ensureChain(dirPath);
  for (const doc of documents) {
    const slash = doc.path.lastIndexOf("/");
    const parent = slash === -1 ? KNOWLEDGE_DIR : ensureChain(doc.path.slice(0, slash));
    const segments = doc.path.split("/");
    nodes.push({
      id: doc.id,
      parentId: parent,
      kind: "file",
      name: segments[segments.length - 1] ?? doc.path,
      ext: doc.ext || null,
      sizeBytes: doc.size,
      updatedAt: doc.modifiedAt,
      error: doc.status === "error" ? (doc.error ?? "") : null,
      downloadable: true,
    });
  }
  return nodes;
}

export function LibrarySection({ focusId }: { focusId: string | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const libraryQuery = useQuery({ queryKey: ["library", "status"], queryFn: () => api.library() });
  const wikiQuery = useQuery({ queryKey: ["wiki"], queryFn: () => api.wiki() });
  const status = libraryQuery.data ?? null;
  const loadError = libraryQuery.error ? errorMessage(libraryQuery.error) : null;
  const setStatus = (next: LibraryStatus) => queryClient.setQueryData(["library", "status"], next);
  const { accounts } = useAccountColors();
  const wikiLabels = React.useMemo<WikiLabels>(
    () => ({
      groups: {
        person: t("storage.wikiGroups.person"),
        contact: t("storage.wikiGroups.contact"),
        company: t("storage.wikiGroups.company"),
        deal: t("storage.wikiGroups.deal"),
        style: t("storage.wikiGroups.style"),
        skill: t("storage.wikiGroups.skill"),
        triage: t("storage.wikiGroups.triage"),
        account: t("storage.wikiGroups.account"),
        general: t("storage.wikiGroups.general"),
      },
      pinned: t("storage.wikiPinned"),
      unused: t("storage.wikiUnused"),
      used: (count) => t("storage.wikiUsed", { count }),
    }),
    [t],
  );
  const [uploading, setUploading] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [nodesToDelete, setNodesToDelete] = React.useState<StorageNode[] | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [editing, setEditing] = React.useState<EditorTarget | null>(null);
  // Where the browser currently is; targets uploads and the New dialog.
  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(null);
  const currentDir =
    currentFolderId?.startsWith(`${KNOWLEDGE_DIR}/`) === true
      ? currentFolderId.slice(KNOWLEDGE_DIR.length + 1)
      : "";
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire per child element; count depth so the overlay
  // doesn't flicker as the pointer crosses rows.
  const dragDepth = React.useRef(0);

  // Debounced FTS content search; stale responses are dropped.
  const [contentHits, setContentHits] = React.useState<LibrarySearchHit[]>([]);
  const lastSearchedRef = React.useRef("");
  React.useEffect(() => {
    const trimmed = query.trim();
    lastSearchedRef.current = trimmed;
    if (!trimmed) {
      setContentHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .searchLibrary(trimmed)
        .then((res) => {
          if (lastSearchedRef.current === trimmed) setContentHits(res.results);
        })
        .catch(() => {
          // content search is a bonus signal; name filtering still works
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const searchHits = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const hit of contentHits) map.set(hit.id, hit.snippet);
    return map;
  }, [contentHits]);

  const nodes = React.useMemo(
    () =>
      toNodes(
        wikiQuery.data ?? [],
        status?.documents ?? [],
        status?.folders ?? [],
        accounts,
        wikiLabels,
      ),
    [wikiQuery.data, status, accounts, wikiLabels],
  );
  const wikiPageIds = React.useMemo(
    () => new Set((wikiQuery.data ?? []).map((page) => page.id)),
    [wikiQuery.data],
  );

  /** Wiki pages open the md editor; documents do too when they are editable
   *  text, otherwise the raw file opens in a new tab. */
  const openFile = (node: StorageNode) => {
    if (wikiPageIds.has(node.id)) {
      const page = wikiQuery.data?.find((p) => p.id === node.id);
      if (page) setEditing({ kind: "page", page });
      return;
    }
    const doc = status?.documents.find((d) => d.id === node.id);
    if (!doc) return;
    if (EDITABLE_EXTENSIONS.has(doc.ext)) setEditing({ kind: "document", doc });
    else api.openLibraryDocument(doc.id);
  };

  const upload = async (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0 || uploading) return;
    setUploading(true);
    let last: LibraryStatus | null = null;
    let added = 0;
    for (const file of files) {
      try {
        last = await api.uploadLibraryFile(file, currentDir || undefined);
        added += 1;
      } catch (err) {
        toast.error(err);
      }
    }
    if (last) setStatus(last);
    if (added > 0) toast.success(t("library.uploaded", { count: added }));
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const confirmRemove = async () => {
    const nodes = nodesToDelete;
    if (!nodes || nodes.length === 0) return false;
    setDeleting(true);
    let succeeded = false;
    try {
      // Deleting a selected folder may also remove selected files inside it,
      // per-kind deletes tolerate already-gone targets (404s toast, but only
      // for genuinely separate failures).
      for (const node of nodes) {
        if (node.kind === "folder") {
          setStatus(await api.deleteLibraryFolder(node.id.slice(KNOWLEDGE_DIR.length + 1)));
        } else if (wikiPageIds.has(node.id)) {
          await api.deletePage(node.id);
        } else {
          setStatus(await api.deleteLibraryDocument(node.id));
        }
      }
      succeeded = true;
    } catch (err) {
      toast.error(err);
    } finally {
      if (nodes.some((node) => wikiPageIds.has(node.id))) {
        await queryClient.invalidateQueries({ queryKey: ["wiki"] });
      }
      setDeleting(false);
    }
    return succeeded;
  };

  const dragHasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  if (!status) {
    return loadError ? (
      <RetryableError onRetry={() => queryClient.invalidateQueries({ queryKey: ["library"] })}>
        {loadError}
      </RetryableError>
    ) : (
      <Skeleton className="h-full min-h-96 w-full rounded-lg" />
    );
  }

  // status.folder is <home>/knowledge; the rail note shows the home itself.
  const homePath = status.folder.replace(/[/\\]knowledge$/, "");

  // The current browser location as a home-relative path for the OS file manager.
  const revealPath =
    currentFolderId?.startsWith(WIKI_DIR) === true
      ? "wiki"
      : currentFolderId?.startsWith(KNOWLEDGE_DIR)
        ? `knowledge${currentDir ? `/${currentDir}` : ""}`
        : "";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop upload target, not an interactive control
    <section
      className="relative flex h-full min-h-0 flex-col"
      onDragEnter={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void upload(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="tint-accent pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-lg">
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-6 w-6" />
            <p className="text-sm font-medium">{t("library.dropTitle")}</p>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.md,.markdown,.txt,.docx,.csv,.html,.htm"
        className="hidden"
        onChange={(e) => void upload(e.target.files)}
      />

      <StorageBrowser
        nodes={nodes}
        query={query}
        onQueryChange={setQuery}
        searchHits={searchHits}
        focusId={focusId}
        onOpenFile={openFile}
        onDelete={(node) => setNodesToDelete([node])}
        onDownload={(node) => api.downloadLibraryDocument(node.id)}
        onDeleteMany={(nodes) => nodes.length > 0 && setNodesToDelete(nodes)}
        onFolderChange={setCurrentFolderId}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("library.openFolder")}
              title={t("library.openFolder")}
              onClick={() =>
                void api.revealLibraryFolder(revealPath).catch((err: unknown) => toast.error(err))
              }
            >
              <FolderOpen />
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label={t("storage.editor.new")}
              title={t("storage.editor.new")}
              onClick={() => setEditing({ kind: "create" })}
            >
              <Plus />
            </Button>
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              loading={uploading}
              aria-label={t("library.upload")}
              title={t("library.upload")}
            >
              <Upload />
              <span className="hidden @2xl:inline">
                {uploading ? t("library.uploading") : t("library.upload")}
              </span>
            </Button>
          </>
        }
        railNote={homePath}
        className="min-h-0 flex-1"
      />

      {editing && (
        <FileEditor
          target={editing}
          currentDir={currentDir}
          onClose={() => setEditing(null)}
          onStatus={setStatus}
        />
      )}

      <ConfirmDialog
        open={!!nodesToDelete}
        onOpenChange={(open) => !open && setNodesToDelete(null)}
        title={t("library.delete")}
        description={
          nodesToDelete === null
            ? ""
            : nodesToDelete.length > 1
              ? t("library.deleteManyConfirm", { count: nodesToDelete.length })
              : t(
                  nodesToDelete[0]?.kind === "folder"
                    ? "library.deleteFolderConfirm"
                    : "library.deleteConfirm",
                  { title: nodesToDelete[0]?.name ?? "" },
                )
        }
        confirmLabel={t("library.delete")}
        busy={deleting}
        onConfirm={confirmRemove}
      />
    </section>
  );
}
