/** Where the app lives and where its builds come from. */

export const REPO_SLUG = "Oktami-Labs/marlen";
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
/**
 * The releases page. It is the only way forward when the shell cannot install
 * an update itself (see UpdateState.manual in apps/desktop/src/updater.ts), so
 * the changelog links here rather than leaving the user to find it.
 */
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
