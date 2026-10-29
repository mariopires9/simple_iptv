// An Xtream client for a stored source (VOD-02 movie details, SER-02 series details; shared since
// SER-02). The password is read from the vault (which registers it with the log redactor) and only
// lives in the client; neither it nor any request URL is ever logged. Requests use the list's data
// rewriter (personal proxy when the list routes everything through it, PRX-01).
import { credentialVault, type CredentialVault } from '@/core/crypto';
import type { Source } from '@/core/db';
import type { FetchImpl } from '@/core/net';
import { rewritersForSource } from '@/core/session';
import { createXtreamClient, type XtreamClient } from '@/providers/xtream';

export interface XtreamClientDeps {
  vault?: Pick<CredentialVault, 'get'>;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
}

/** Thrown when the source cannot authenticate (no address, user or readable password). */
export class MissingCredentialsError extends Error {
  override readonly name = 'MissingCredentialsError';
}

export async function xtreamClientFor(
  source: Source,
  deps: XtreamClientDeps = {},
): Promise<XtreamClient> {
  const { serverUrl, username, secretRef } = source;
  if (!serverUrl || !username || !secretRef) throw new MissingCredentialsError();
  const password = await (deps.vault ?? credentialVault).get(secretRef);
  if (password === undefined) throw new MissingCredentialsError();
  const { data } = await rewritersForSource(source);
  deps.signal?.throwIfAborted();
  return createXtreamClient({
    baseUrl: serverUrl,
    username,
    password,
    rewriter: data,
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
  });
}
