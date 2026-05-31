import { S3Client } from "bun";
import type { BlobStore } from "@checkstack/script-packages-backend";
import type { S3StoreConfig } from "./config";
import { integrityToKey, keyToIntegrity, S3_KEY_PREFIX } from "./key";

export const S3_BLOB_STORE_ID = "s3";

interface S3ListResponse {
  contents?: { key: string }[];
  isTruncated?: boolean;
  nextContinuationToken?: string;
}

/**
 * S3-compatible {@link BlobStore} backed by Bun's native `S3Client` (no
 * AWS SDK dependency). Content-addressed: blobs are immutable, so `put`
 * unconditionally writes (overwriting with identical bytes is harmless).
 *
 * Credentials come from {@link S3StoreConfig} (loaded from env), never the
 * application DB. `forcePathStyle` is honored via Bun's endpoint handling
 * for MinIO / non-AWS S3.
 */
export function createS3BlobStore(config: S3StoreConfig): BlobStore {
  const client = new S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    ...(config.region ? { region: config.region } : {}),
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
  });

  return {
    id: S3_BLOB_STORE_ID,

    async put({ integrity, bytes }) {
      await client.write(integrityToKey(integrity), bytes);
    },

    async get({ integrity }) {
      const file = client.file(integrityToKey(integrity));
      if (!(await file.exists())) return;
      const buf = await file.arrayBuffer();
      return new Uint8Array(buf);
    },

    async has({ integrity }) {
      return client.file(integrityToKey(integrity)).exists();
    },

    async delete({ integrity }) {
      await client.delete(integrityToKey(integrity));
    },

    async list() {
      const integrities: string[] = [];
      let continuationToken: string | undefined;
      do {
        const res: S3ListResponse = await client.list({
          prefix: S3_KEY_PREFIX,
          ...(continuationToken ? { continuationToken } : {}),
        });
        for (const item of res.contents ?? []) {
          const integrity = keyToIntegrity(item.key);
          if (integrity !== undefined) integrities.push(integrity);
        }
        continuationToken = res.isTruncated
          ? res.nextContinuationToken
          : undefined;
      } while (continuationToken);
      return integrities;
    },
  };
}
