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

const WIDTH_STEP = 8;
const HANDLE_SIZE = 10;

const HANDLES = [
  { dirX: -1, dirY: -1, cursor: "nwse-resize" },
  { dirX: 1, dirY: -1, cursor: "nesw-resize" },
  { dirX: -1, dirY: 1, cursor: "nesw-resize" },
  { dirX: 1, dirY: 1, cursor: "nwse-resize" },
] as const;

/** Preserve pasted email layout without schema normalization. */
export function SignatureEditor({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const resizeLabelId = React.useId();
  const editor = React.useRef<HTMLDivElement>(null);
  const paper = React.useRef<HTMLDivElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const savedRange = React.useRef<Range | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [pasting, setPasting] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");
  const [selectedImage, setSelectedImage] = React.useState<HTMLImageElement | null>(null);
  const [frame, setFrame] = React.useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  // Saving requires the complete set so another account is never overwritten.
  const query = useQuery({
    queryKey: SIGNATURES_QUERY_KEY,
    queryFn: api.accountSignatures,
    meta: { suppressErrorToast: true },
  });
  const signatures = query.data?.signatures;

  // Do not replace an in-progress edit when the query cache changes.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current || !signatures || !editor.current) return;
    seededRef.current = true;
    editor.current.innerHTML = sanitizeSignatureHtml(
      signatures.find((s) => s.accountId === accountId)?.html ?? "",
    );
  }, [signatures, accountId]);

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

  // Layout tables make offsetParent unreliable; measure both viewport rectangles.
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

  const startResize = (event: React.PointerEvent, dirX: number, dirY: number) => {
    if (!selectedImage) return;
    // Keep focus on the grip so keyboard resizing works after dragging.
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
