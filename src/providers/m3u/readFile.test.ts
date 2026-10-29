// @vitest-environment node
// SRC-06 AC1: a local file is streamed into the parser with `file.stream()`.
import { describe, expect, it, vi } from 'vitest';
import { M3uParser, type M3uEntry } from './parser';
import { FileReadError, readM3uFile } from './readFile';

const LIST =
  '#EXTM3U\n#EXTINF:-1,One\nhttps://s.example.test/1.ts\n#EXTINF:-1,Two\nhttps://s.example.test/2.ts\n';

function parserWith(entries: M3uEntry[]): M3uParser {
  return new M3uParser({ onEntry: (entry) => entries.push(entry) });
}

/** A Blob whose stream yields `chunks` and then fails (as when the file was deleted meanwhile). */
function failingBlob(chunks: string[], size = 1000): Blob {
  const blob = new Blob(chunks);
  Object.defineProperty(blob, 'size', { value: size });
  blob.stream = () => {
    let i = 0;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        const chunk = chunks[i++];
        if (chunk === undefined) {
          controller.error(new DOMException('gone', 'NotReadableError'));
        } else {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
      },
    });
  };
  return blob;
}

describe('readM3uFile', () => {
  it('streams the whole file into the parser and reports bytes against the file size', async () => {
    const entries: M3uEntry[] = [];
    const file = new File([LIST], 'list.m3u');
    const seen: Array<[number, number]> = [];
    const result = await readM3uFile(file, parserWith(entries), {
      onBytes: (bytes, total) => seen.push([bytes, total]),
    });
    expect(result).toEqual({ bytes: file.size, completed: true });
    expect(entries.map((e) => e.name)).toEqual(['One', 'Two']);
    expect(seen.at(-1)).toEqual([file.size, file.size]);
  });

  it('decodes UTF-8 split across chunks', async () => {
    const bytes = new TextEncoder().encode(
      '#EXTM3U\n#EXTINF:-1,Canal Ação\nhttps://s.example.test/1.ts\n',
    );
    const split = bytes.indexOf(0xc3) + 1; // inside "ç"
    const file = new Blob([bytes.slice(0, split), bytes.slice(split)]);
    const entries: M3uEntry[] = [];
    await readM3uFile(file, parserWith(entries));
    expect(entries[0]?.name).toBe('Canal Ação');
  });

  it('stops early when onChunk returns false (and releases the file)', async () => {
    const entries: M3uEntry[] = [];
    const file = failingBlob(['#EXTM3U\n', '#EXTINF:-1,One\n'], 50);
    const result = await readM3uFile(file, parserWith(entries), { onChunk: () => false });
    expect(result.completed).toBe(false);
  });

  it('a read failure is a FileReadError (not a parser error)', async () => {
    const entries: M3uEntry[] = [];
    const error = await readM3uFile(failingBlob(['#EXTM3U\n']), parserWith(entries)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FileReadError);
    expect((error as FileReadError).cause).toBeInstanceOf(DOMException);
  });

  it('an exception from the callbacks reaches the caller unchanged', async () => {
    const boom = new Error('bug');
    const error = await readM3uFile(new Blob([LIST]), parserWith([]), {
      onChunk: () => {
        throw boom;
      },
    }).catch((e: unknown) => e);
    expect(error).toBe(boom);
  });

  it('an aborted signal stops the read with an AbortError', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const file = new Blob([LIST]);
    const stream = file.stream();
    file.stream = () => {
      const reader = stream.getReader();
      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        async pull(c) {
          const next = await reader.read();
          if (next.done) c.close();
          else c.enqueue(next.value);
        },
        cancel,
      });
    };
    const error = await readM3uFile(file, parserWith([]), {
      signal: controller.signal,
      onChunk: () => {
        controller.abort();
      },
    }).catch((e: unknown) => e);
    expect((error as DOMException).name).toBe('AbortError');
    expect(cancel).toHaveBeenCalled();
  });
});
