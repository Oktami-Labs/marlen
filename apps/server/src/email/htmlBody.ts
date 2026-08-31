import sanitizeHtml from "sanitize-html";

/**
 * A received message's HTML, reduced to what a mail body may contain. This is
 * defense in depth, not the boundary: the viewer renders the result in a
 * sandboxed iframe whose CSP forbids scripts and remote loads, because a
 * sanitizer bypass must not become script execution.
 *
 * <style> blocks and their contents are dropped (sanitize-html's nonTextTags),
 * so only inline styles survive: a stylesheet cannot be filtered rule by rule.
 * Images keep their remote src, the iframe's CSP decides whether they load.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "font", "center", "big", "strike"],
    allowedAttributes: {
      "*": [
        "style",
        "class",
        "id",
        "align",
        "valign",
        "dir",
        "lang",
        "title",
        "width",
        "height",
        "bgcolor",
        "color",
        "border",
        "cellpadding",
        "cellspacing",
        "colspan",
        "rowspan",
        "nowrap",
        "type",
      ],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
    // An inline (cid:) image loses its src above and would render as a broken
    // icon: the parts it names are never fetched for the viewer.
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  });
}
