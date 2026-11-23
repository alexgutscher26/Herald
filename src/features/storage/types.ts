/** A stored object and the metadata needed to serve or audit it. */
export type StoredObject = {
  key: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  /** Lowercase SHA-256 hex of the stored bytes. */
  checksum: string;
  createdAt: string;
};

export type PutObjectInput = {
  key: string;
  fileName: string;
  contentType: string;
  body: Uint8Array;
};

export type StoredObjectWithBody = {
  object: StoredObject;
  body: Uint8Array;
};

/** Result of a real read/write probe against the configured driver. */
export type StorageHealth = {
  ok: boolean;
  detail: string;
  freeBytes?: number | null;
};

/**
 * Storage provider boundary.
 *
 * The rest of the app never touches a filesystem or bucket SDK directly. A
 * cloud driver (S3/R2) can implement this interface without changing callers;
 * the local driver is for development and single-node deployments.
 */
export type StorageProvider = {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<StoredObjectWithBody | null>;
  delete(key: string): Promise<void>;
  /** Inventory used by backup verification. Ordered by key. */
  list(prefix?: string): Promise<StoredObject[]>;
  /** A bounded probe that proves reads and writes actually work. */
  health(): Promise<StorageHealth>;
};
