// Reads dropped or picked files into note texts. Browser-only; covered by the end-to-end tests.
import type { ImageFile } from './db';
import type { NoteFile } from './importer';
import { isImage } from './markdown';

const NOTE = /\.(md|markdown|txt)$/i;
const MAX_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 20_000_000;
const MAX_FILES = 5000;

export interface ReadResult {
  files: NoteFile[];
  /** Images that came along, not read yet: only those the cards show are stored. */
  images: ImageFile[];
  /** Notes and images that were left out, with the reason. */
  skipped: string[];
}

/** Notes and images, and nothing inside dot-folders such as .obsidian or .trash. */
const wanted = (path: string) => (NOTE.test(path) || isImage(path)) && !path.split('/').some((part) => part.startsWith('.'));

async function read(found: { path: string; file: File }[]): Promise<ReadResult> {
  const files: NoteFile[] = [];
  const images: ImageFile[] = [];
  const skipped: string[] = [];
  for (const { path, file } of found.sort((a, b) => a.path.localeCompare(b.path))) {
    if (isImage(path)) {
      if (file.size > MAX_IMAGE_BYTES) skipped.push(`${path}: image larger than 20 MB`);
      else images.push({ path, file });
      continue;
    }
    if (files.length >= MAX_FILES) {
      skipped.push(`More than ${MAX_FILES} notes: the rest were left out`);
      break;
    }
    if (file.size > MAX_BYTES) skipped.push(`${path}: larger than 2 MB`);
    else files.push({ path, text: await file.text() });
  }
  return { files, images, skipped };
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
