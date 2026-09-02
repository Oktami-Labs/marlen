import type { ServerEventTopic } from "@marlen/shared";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { subscribeServerEvents } from "@/lib/serverEvents";
import { toast } from "@/lib/toast";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: { suppressErrorToast?: boolean };
    mutationMeta: { suppressErrorToast?: boolean };
  }
}

/**
 * The app's one QueryClient. Freshness is push-driven: the SSE topic bridge
 * below invalidates by topic, so queries don't poll or refetch on focus,
 * server-side changes announce themselves.
 *
 * Every query or mutation failure surfaces as an error toast by default, so a
 * broken load is never silent. A caller that renders the failure itself opts
 * out with meta: { suppressErrorToast: true }.
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (!query.meta?.suppressErrorToast) toast.error(error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (!mutation.meta?.suppressErrorToast) toast.error(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // The event stream refetches every topic when it reopens after a drop;
      // the browser's own online event would do the same work a second time.
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

/**
 * Every data topic the server broadcasts, as a Record so adding a topic to
 * ServerEventTopic without wiring it here is a compile error. "notification"
 * is excluded because it carries payloads and has its own subscription path
 * (subscribeRunNotifications).
 */
const DATA_TOPICS: Record<Exclude<ServerEventTopic, "notification">, true> = {
  runs: true,
  drafts: true,
  outbound: true,
  todos: true,
  wiki: true,
  library: true,
  conversations: true,
  chat: true,
  automations: true,
  learn: true,
  leads: true,
  whatsapp: true,
  accounts: true,
  settings: true,
  seen: true,
};

/**
 * Query-key convention: a key's first element is the topic that invalidates
 * it, ["drafts", accountId], ["automations"]. One standing subscription per
 * topic maps every server-side change onto the matching key prefix.
 */
export function startTopicInvalidation(): () => void {
  const unsubscribes = (Object.keys(DATA_TOPICS) as ServerEventTopic[]).map((topic) =>
    subscribeServerEvents([topic], () => {
      void queryClient.invalidateQueries({ queryKey: [topic] });
    }),
  );
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
