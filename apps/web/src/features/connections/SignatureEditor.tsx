import { EMAIL_SIGNATURE_STYLE } from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bold, ImagePlus, Italic, Link2, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { RetryableError } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import {
  imageFileToHtml,
  imageWidth,
  inlineSignatureHtml,
  MAX_SIGNATURE_CHARS,
  sanitizeSignatureHtml,
  setImageWidth,
} from "@/features/connections/signatureHtml";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

const SIGNATURES_QUERY_KEY = ["settings", "accountSignatures"] as const;

/** Keyboard step for the resize handles, and the size of a handle itself. */
const WIDTH_STEP = 8;
const HANDLE_SIZE = 10;

/**
 * The four corners a selected image is resized by, as the direction each one
 * grows the image in. The last is the one that carries the label and the
 * keyboard step: four identical tab stops for one action is noise, and the
 * bottom-right corner is where every editor puts the primary grip.
 */
const HANDLES = [
  { dirX: -1, dirY: -1, cursor: "nwse-resize" },
  { dirX: 1, dirY: -1, cursor: "nesw-resize" },
  { dirX: -1, dirY: 1, cursor: "nesw-resize" },
  { dirX: 1, dirY: 1, cursor: "nwse-resize" },
] as const;

/**
 * Rich signature editor, expanded under an email account's row. Deliberately a
 * raw contenteditable, NOT a schema-based editor (TipTap was tried and
 * reverted): a signature pasted from Gmail or Outlook must keep its layout
 * tables, fonts and colors verbatim, which schema normalization flattens.
 * Paste-first — the paste resolves the images the clipboard only points at
 * (see signatureHtml.ts) — with a small toolbar for writing one in place and a
 * corner grip for sizing a logo. The editing area is a white "paper" page in
 * both themes, in the same font the server wraps outgoing bodies in, so what's
 * shown is what recipients get. Persists the stored set wholesale with this
 * account's entry swapped (the server keeps the last entry per account and
 * drops empty ones).
 */
export function SignatureEditor({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // The grip is named by a hidden label, not aria-label: the cursor tooltip
  // shows for any labelled button under the pointer, which through a drag means
  // one trailing the whole way.
  const resizeLabelId = React.useId();
  const editor = React.useRef<HTMLDivElement>(null);
  /** The positioned frame the resize grips are placed in. */
  const paper = React.useRef<HTMLDivElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  // The toolbar's link/image flows move focus away from the editor; the last
  // in-editor selection is saved on toolbar use and restored before inserting.
  const savedRange = React.useRef<Range | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [pasting, setPasting] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");
  // The image the handles act on, and the box they sit on. The element is
  // marked with a class rather than an attribute, so the selection ring cannot
  // survive into the saved html (sanitize drops every class).
  const [selectedImage, setSelectedImage] = React.useState<HTMLImageElement | null>(null);
  const [frame, setFrame] = React.useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  // The loaded array is the merge baseline for the save; saving is disabled
  // until it arrives, so a write can never wipe other accounts' signatures.
  const query = useQuery({
    queryKey: SIGNATURES_QUERY_KEY,
    queryFn: api.accountSignatures,
    meta: { suppressErrorToast: true },
  });
  const signatures = query.data?.signatures;

  // Seed the editor once when the stored set first arrives; later signature
  // state updates (a save) must not clobber what the user is editing.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current || !signatures || !editor.current) return;
    seededRef.current = true;
    editor.current.innerHTML = sanitizeSignatureHtml(
      signatures.find((s) => s.accountId === accountId)?.html ?? "",
    );
  }, [signatures, accountId]);

  /** The image the caret sits on, so arrowing onto a logo selects it like clicking it does. */
  const imageAtCaret = (): HTMLImageElement | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const node = range.startContainer.childNodes[range.startOffset];
    return node instanceof HTMLImageElement ? node : null;
  };

  const select = (image: HTMLImageElement | null) => {
    for (const marked of editor.current?.querySelectorAll("img.is-selected") ?? []) {
      marked.classList.remove("is-selected");
    }
    image?.classList.add("is-selected");
    setSelectedImage(image);
  };

  // The handles ride the image's own box, measured against the frame they are
  // positioned in. Rectangles, not offsetLeft/offsetTop: a signature's images
  // usually sit in a layout table, and a td is an offsetParent of its own, so
  // offsets would place the grips relative to the cell instead of the frame.
  // Measured on demand rather than in an effect: a resize writes the width
  // synchronously, so the corners are already where they will render.
  const measureFrame = React.useCallback(() => {
    const page = paper.current?.getBoundingClientRect();
    const image = selectedImage?.isConnected ? selectedImage.getBoundingClientRect() : null;
    setFrame(
      page && image
        ? {
            left: image.left - page.left,
            top: image.top - page.top,
            width: image.width,
            height: image.height,
          }
        : null,
    );
  }, [selectedImage]);

  // A narrower panel reflows the signature, so the corners move without anything here touching them.
  React.useEffect(() => {
    measureFrame();
    window.addEventListener("resize", measureFrame);
    return () => window.removeEventListener("resize", measureFrame);
  }, [measureFrame]);

  const applyWidth = (width: number) => {
    if (!selectedImage) return;
    setImageWidth(selectedImage, width);
    measureFrame();
  };

  /**
   * Drag from any corner, the way every editor does it: the grabbed corner
   * follows the pointer along the image's own diagonal, so a drag that is
   * mostly sideways and one that is mostly downward both resize it, and the
   * aspect ratio decides the height.
   */
  const startResize = (event: React.PointerEvent, dirX: number, dirY: number) => {
    if (!selectedImage) return;
    // Deliberately not preventDefault: the grip takes focus, so the keyboard
    // step works straight after a drag, and the cursor tooltip hides itself on
    // the mousedown that would otherwise never fire. Pointer capture keeps the
    // rest of the drag on the grip.
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const { width, height } = selectedImage.getBoundingClientRect();
    const diagonal = Math.hypot(width, height);
    if (!diagonal) return;
    const move = (moved: PointerEvent) => {
      const along =
        ((moved.clientX - startX) * dirX * width + (moved.clientY - startY) * dirY * height) /
        diagonal;
      applyWidth(width * (1 + along / diagonal));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const exec = (command: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(command, false, value);
  };

  const saveSelection = () => {
    const selection = window.getSelection();
    if (
      selection &&
      selection.rangeCount > 0 &&
      editor.current?.contains(selection.getRangeAt(0).commonAncestorContainer)
    ) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const range = savedRange.current;
    if (!range) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    setLinkOpen(false);
    if (!url) return;
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    restoreSelection();
    const selection = window.getSelection();
    const inEditor =
      selection &&
      selection.rangeCount > 0 &&
      editor.current?.contains(selection.getRangeAt(0).commonAncestorContainer);
    if (inEditor && !selection.isCollapsed) {
      exec("createLink", href);
    } else {
      // Nothing selected: insert the URL itself as the link text.
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.textContent = href;
      exec("insertHTML", anchor.outerHTML);
    }
  };

  const insertImageFile = async (file: File | undefined) => {
    if (!file) return;
    const html = await imageFileToHtml(file);
    if (!html) {
      toast.error(t("connections.signature.imageTooLarge"));
      return;
    }
    restoreSelection();
    exec("insertHTML", html);
  };

  /**
   * A pasted signature keeps its markup, and its images become bytes it owns.
   * An image on the clipboard with no markup (a logo copied from a file
   * manager) is inserted as one; anything else falls through to the browser's
   * own plain-text paste.
   */
  const onPaste = (event: React.ClipboardEvent) => {
    const html = event.clipboardData.getData("text/html");
    const file = [...event.clipboardData.files].find((f) => f.type.startsWith("image/"));
    if (!html && !file) return;
    event.preventDefault();
    select(null);
    saveSelection();
    setPasting(true);
    void (async () => {
      try {
        if (html) {
          const inlined = await inlineSignatureHtml(html);
          restoreSelection();
          exec("insertHTML", inlined.html);
          if (inlined.dropped > 0) {
            toast.info(t("connections.signature.imagesDropped", { count: inlined.dropped }));
          }
        } else if (file) {
          await insertImageFile(file);
        }
      } catch (err) {
        toast.error(err);
      } finally {
        setPasting(false);
      }
    })();
  };

  const save = async () => {
    if (!signatures) return;
    const html = sanitizeSignatureHtml(editor.current?.innerHTML ?? "");
    if (html.length > MAX_SIGNATURE_CHARS) {
      toast.error(t("connections.signature.tooLarge"));
      return;
    }
    setSaving(true);
    try {
      const merged = [...signatures.filter((s) => s.accountId !== accountId), { accountId, html }];
      const { signatures: saved } = await api.setAccountSignatures(merged);
      queryClient.setQueryData(SIGNATURES_QUERY_KEY, { signatures: saved });
      toast.success(t(html ? "connections.signature.saved" : "connections.signature.removed"));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Toolbar buttons prevent mousedown default so the editor selection survives the click.
  const keepSelection = (event: React.MouseEvent) => event.preventDefault();

  return (
    <div className="surface flex flex-col gap-2 rounded-lg p-3">
      <p className="px-2 text-xs text-muted-foreground">{t("connections.signature.hint")}</p>
      {query.isError ? (
        <RetryableError onRetry={() => void query.refetch()}>
          {t("connections.signature.loadFailed")}
        </RetryableError>
      ) : (
        <>
          <div className="flex items-center gap-0.5 px-1">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("connections.signature.bold")}
              data-tooltip={t("connections.signature.bold")}
              onMouseDown={keepSelection}
              onClick={() => exec("bold")}
            >
              <Bold />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("connections.signature.italic")}
              data-tooltip={t("connections.signature.italic")}
              onMouseDown={keepSelection}
              onClick={() => exec("italic")}
            >
              <Italic />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("connections.signature.link")}
              data-tooltip={t("connections.signature.link")}
              onMouseDown={keepSelection}
              onClick={() => {
                saveSelection();
                setLinkUrl("");
                setLinkOpen((open) => !open);
              }}
            >
              <Link2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("connections.signature.image")}
              data-tooltip={t("connections.signature.image")}
              onMouseDown={keepSelection}
              onClick={() => {
                saveSelection();
                fileInput.current?.click();
              }}
            >
              <ImagePlus />
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(event) => {
                void insertImageFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {pasting && (
              <span className="text-shimmer ml-1 text-xs">
                {t("connections.signature.pasting")}
              </span>
            )}
          </div>
          {linkOpen && (
            <div className="flex items-center gap-2 px-1">
              <Input
                autoFocus
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder={t("connections.signature.linkPlaceholder")}
                className="h-8 text-xs"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  }
                  if (event.key === "Escape") setLinkOpen(false);
                }}
              />
              <Button variant="secondary" size="sm" onClick={applyLink}>
                {t("connections.signature.linkApply")}
              </Button>
            </div>
          )}
          <span id={resizeLabelId} className="sr-only">
            {t("connections.signature.resize")}
          </span>
          {/* Recessed frame holding the white "paper" page: the outgoing-email preview stays light in both themes. */}
          <div ref={paper} className="relative rounded-lg bg-surface-2 p-2">
            {/* biome-ignore lint/a11y/useFocusableInteractive: contenteditable makes the div focusable */}
            {/* biome-ignore lint/a11y/useSemanticElements: no native element holds rich HTML; textbox is the standard role for a contenteditable editor */}
            <div
              ref={editor}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label={t("connections.signature.title")}
              className="email-paper min-h-24 break-words rounded-md bg-white px-3 py-2 text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_img.is-selected]:ring-2 [&_img.is-selected]:ring-ring [&_img]:max-w-full"
              // The typography an outgoing signature is sent in, so the page is
              // the email rather than a rendering of it.
              style={EMAIL_SIGNATURE_STYLE}
              onPaste={onPaste}
              onClick={(event) => {
                const target = event.target;
                select(target instanceof HTMLImageElement ? target : null);
              }}
              onKeyUp={() => select(imageAtCaret())}
              onInput={() => {
                if (selectedImage && !selectedImage.isConnected) select(null);
              }}
            />
            {frame &&
              HANDLES.map(({ dirX, dirY, cursor }, index) => {
                const primary = index === HANDLES.length - 1;
                return (
                  <button
                    key={cursor + dirX}
                    type="button"
                    // One grip answers to the keyboard and carries the name; the
                    // other three are the same action under the mouse.
                    {...(primary
                      ? { "aria-labelledby": resizeLabelId }
                      : { "aria-hidden": true, tabIndex: -1 })}
                    className="absolute select-none rounded-sm bg-primary touch-none"
                    style={{
                      left: frame.left + (dirX > 0 ? frame.width : 0) - HANDLE_SIZE / 2,
                      top: frame.top + (dirY > 0 ? frame.height : 0) - HANDLE_SIZE / 2,
                      width: HANDLE_SIZE,
                      height: HANDLE_SIZE,
                      cursor,
                    }}
                    onPointerDown={(event) => startResize(event, dirX, dirY)}
                    onKeyDown={(event) => {
                      if (!selectedImage) return;
                      const width = imageWidth(selectedImage);
                      if (event.key === "ArrowLeft") applyWidth(width - WIDTH_STEP);
                      if (event.key === "ArrowRight") applyWidth(width + WIDTH_STEP);
                    }}
                  />
                );
              })}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                select(null);
                if (editor.current) editor.current.innerHTML = "";
              }}
            >
              <X />
              {t("connections.signature.clear")}
            </Button>
            <Button size="sm" loading={saving} disabled={!signatures} onClick={() => void save()}>
              {t("connections.signature.save")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
