// Streaming read of a local M3U file into the parser (SRC-06 AC1). Runs inside the data worker.
//
// The `File` (a `Blob`) arrives by structured clone and is read with `file.stream()`: the content
// is never accumulated (each chunk is decoded and parsed as it is read) and never stored — only
// the parsed catalogue is. A failure to read the file (it was moved, deleted or changed after it
// was picked: `NotReadableError` / `NotFoundError`) is a `FileReadError`; an exception thrown by
// the parser or the callbacks reaches the caller unchanged (the sync reports it as `internal`).
import type { M3uParser } from './parser';

/** The file could not be read (not a parsing problem). The message never contains its name. */
export class FileReadError extends Error {
  override readonly name = 'FileReadError';

  constructor(options?: { cause?: unknown }) {
    super('The file could not be read', options);
  }
}

export interface ReadFileOptions {
  /** Stops reading (the read rejects with a `DOMException` named `AbortError`). */
  signal?: AbortSignal;
  /** Cumulative bytes read and the file size. */
  onBytes?: (bytes: number, total: number) => void;
  /** After each parsed chunk; return `false` to stop reading early. */
  onChunk?: () => boolean | void;
}

export interface ReadFileResult {
  bytes: number;
  /** `false` when `onChunk` stopped the read before the end. */
  completed: boolean;
}

function abortError(): DOMException {
  return new DOMException('The read was aborted', 'AbortError');
}

/** Reads `file` to the end (or until `onChunk` stops it) and streams it into `parser`. */
export async function readM3uFile(
  file: Blob,
  parser: M3uParser,
  options: ReadFileOptions = {},
): Promise<ReadFileResult> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = file.stream().getReader();
  } catch (error) {
    throw new FileReadError({ cause: error });
  }
  const decoder = new TextDecoder('utf-8');
  let bytes = 0;
  let finished = false;
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw new FileReadError({ cause: error });
      }
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      parser.write(decoder.decode(chunk.value, { stream: true }));
      options.onBytes?.(bytes, Math.max(file.size, bytes));
      if (options.onChunk?.() === false) return { bytes, completed: false };
    }
    finished = true;
  } finally {
    // Stopped early (abort, `onChunk`, an error): release the file.
    if (!finished) reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  parser.write(decoder.decode());
  parser.end();
  return { bytes, completed: true };
}
