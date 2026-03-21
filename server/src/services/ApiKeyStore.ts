import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export interface ApiKeyRecord {
  keyId: string;
  tenantId: string;
  description: string;
  keyHash: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface CreateApiKeyResult {
  keyId: string;
  rawKey: string;
  tenantId: string;
  description: string;
  createdAt: string;
}

export class ApiKeyStore {
  private keys: ApiKeyRecord[] = [];
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8"));
      this.keys = Array.isArray(data.keys) ? data.keys : [];
    } catch {
      this.keys = [];
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify({ keys: this.keys }, null, 2), "utf8");
  }

  private hashKey(rawKey: string): string {
    return createHash("sha256").update(rawKey).digest("hex");
  }

  createKey(tenantId: string, description: string): CreateApiKeyResult {
    const keyId = randomBytes(16).toString("hex");
    const rawKey = `vjj_${randomBytes(32).toString("hex")}`;
    const record: ApiKeyRecord = {
      keyId,
      tenantId,
      description,
      keyHash: this.hashKey(rawKey),
      createdAt: new Date().toISOString(),
    };
    this.keys.push(record);
    this.save();
    return { keyId, rawKey, tenantId, description, createdAt: record.createdAt };
  }

  listKeys(tenantId: string): Omit<ApiKeyRecord, "keyHash">[] {
    return this.keys
      .filter((k) => k.tenantId === tenantId)
      .map(({ keyHash: _h, ...rest }) => rest);
  }

  revokeKey(keyId: string): boolean {
    const before = this.keys.length;
    this.keys = this.keys.filter((k) => k.keyId !== keyId);
    if (this.keys.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  verifyKey(rawKey: string): ApiKeyRecord | null {
    const h = this.hashKey(rawKey);
    return this.keys.find((k) => k.keyHash === h) ?? null;
  }

  touchKey(keyId: string): void {
    const rec = this.keys.find((k) => k.keyId === keyId);
    if (rec) {
      rec.lastUsedAt = new Date().toISOString();
      this.save();
    }
  }
}
