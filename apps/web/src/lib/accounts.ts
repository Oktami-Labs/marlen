import type { AccountColor, AccountPermissions, ConnectedAccount } from "@marlen/shared";
import { EMAIL_APPS } from "@marlen/shared";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api, isPipedreamMissing } from "@/lib/api";

/** Whether a Pipedream app slug is one of the supported mail providers. */
export const isEmailApp = (app: string) => (EMAIL_APPS as readonly string[]).includes(app);

/** An account's assigned dot color; undefined (→ `AccountDot`'s grey) when unassigned. */
export const accountColor = (colors: AccountColor[] | undefined, accountId?: string | null) =>
  colors?.find((c) => c.accountId === accountId)?.hex;

export const accountListQuery = queryOptions({
  queryKey: ["accounts", "list"],
  queryFn: async (): Promise<ConnectedAccount[]> => {
    try {
      return await api.pipedreamAccounts();
    } catch (error) {
      if (isPipedreamMissing(error)) return [];
      throw error;
    }
  },
});

export const accountColorsQuery = queryOptions({
  queryKey: ["accounts", "colors"],
  queryFn: () => api.accountColors().then(({ colors }) => colors),
});

export const accountPermissionsQuery = queryOptions({
  queryKey: ["accounts", "permissions"],
  queryFn: (): Promise<AccountPermissions[]> =>
    api.accountPermissions().then(({ permissions }) => permissions),
});

/**
 * Connected accounts and their color assignments. Every account dot, chip,
 * and scope picker resolves from this pair. One shared query per list means
 * every consumer sees the same data and an "accounts" event (connect,
 * removal, recolor, regrant) refreshes them all.
 */
export function useAccountColors({ withAccounts = true, enabled = true } = {}): {
  accounts: ConnectedAccount[];
  colors: AccountColor[];
} {
  const { data: accounts } = useQuery({ ...accountListQuery, enabled: enabled && withAccounts });
  const { data: colors } = useQuery({ ...accountColorsQuery, enabled });
  return { accounts: accounts ?? [], colors: colors ?? [] };
}
