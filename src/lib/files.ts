// Reads dropped or picked files into note texts. Browser-only; covered by the end-to-end tests.
import type { NoteFile } from './importer';

const NOTE = /\.(md|markdown|txt)$/i;
const MAX_BYTES = 2_000_000;
const MAX_FILES = 5000;

export interface ReadResult {
  files: NoteFile[];
  /** Notes that were left out, with the reason. */
  skipped: string[];
}

/** Notes only, and nothing inside dot-folders such as .obsidian or .trash. */
const wanted = (path: string) => NOTE.test(path) && !path.split('/').some((part) => part.startsWith('.'));

async function read(found: { path: string; file: File }[]): Promise<ReadResult> {
  const files: NoteFile[] = [];
  const skipped: string[] = [];
  for (const { path, file } of found.sort((a, b) => a.path.localeCompare(b.path))) {
    if (files.length >= MAX_FILES) {
      skipped.push(`More than ${MAX_FILES} notes: the rest were left out`);
      break;
    }
    if (file.size > MAX_BYTES) skipped.push(`${path}: larger than 2 MB`);
    else files.push({ path, text: await file.text() });
  }
  return { files, skipped };
}

export function readPicked(list: FileList): Promise<ReadResult> {
  return read(
    [...list]
      .map((file) => ({ path: file.webkitRelativePath || file.name, file }))
      .filter((f) => wanted(f.path)),
  );
}

async function walk(entry: FileSystemEntry, out: { path: string; file: File }[]): Promise<void> {
  const path = entry.fullPath.replace(/^\//, '');
  if (entry.isFile) {
    if (!wanted(path)) return;
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ path, file });
  } else if (entry.isDirectory && !entry.name.startsWith('.')) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries hands back the directory in batches until it returns an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, out);
    }
  }
}

export async function readDropped(data: DataTransfer): Promise<ReadResult> {
  // Entries must be taken before the first await: the DataTransfer is emptied after the event.
  const entries = [...data.items].map((item) => item.webkitGetAsEntry?.()).filter((e) => e != null);
  if (!entries.length) return readPicked(data.files);
  const found: { path: string; file: File }[] = [];
  for (const entry of entries) await walk(entry, found);
  return read(found);
}
