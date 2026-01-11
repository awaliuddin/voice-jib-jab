/**
 * Database.ts - SQLite adapter for persistent storage
 *
 * Uses better-sqlite3 for synchronous, fast SQLite operations.
 * File-based storage - no external dependencies.
 */

import Database from "better-sqlite3";
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";

export interface DatabaseConfig {
  /** Path to SQLite database file */
  path: string;
  /** Enable WAL mode for better concurrency */
  walMode?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * SQLite database adapter
 * Singleton pattern - one database connection for the application
 */
export class DatabaseAdapter {
  private db: Database.Database | null = null;
  private config: DatabaseConfig;
  private initialized: boolean = false;

  constructor(config: DatabaseConfig) {
    this.config = {
      walMode: true,
      verbose: false,
      ...config,
    };
  }

  /**
   * Initialize database connection and run migrations
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    // Ensure directory exists
    const dbDir = resolve(this.config.path, "..");
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.config.path, {
      verbose: this.config.verbose ? console.log : undefined,
    });

    // Enable WAL mode for better write concurrency
    if (this.config.walMode) {
      this.db.pragma("journal_mode = WAL");
    }

    // Enable foreign keys
    this.db.pragma("foreign_keys = ON");

    // Run migrations
    this.runMigrations();

    this.initialized = true;
    console.log(`[Database] Initialized at ${this.config.path}`);
  }

  /**
   * Run database migrations
   * Creates tables if they don't exist
   */
  private runMigrations(): void {
    if (!this.db) {
      throw new Error("Database not connected");
    }

    // Create migrations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Check which migrations have been applied
    const applied = new Set(
      this.db
        .prepare("SELECT name FROM migrations")
        .all()
        .map((row: any) => row.name),
    );

    // Migration 1: Users table (for identity tracking)
    if (!applied.has("001_create_users")) {
      this.db.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          fingerprint TEXT UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          metadata TEXT DEFAULT '{}'
        )
      `);
      this.db
        .prepare("INSERT INTO migrations (name) VALUES (?)")
        .run("001_create_users");
      console.log("[Database] Applied migration: 001_create_users");
    }

    // Migration 2: Sessions table
    if (!applied.has("002_create_sessions")) {
      this.db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          ended_at TEXT,
          end_reason TEXT,
          metadata TEXT DEFAULT '{}',
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX idx_sessions_started_at ON sessions(started_at);
      `);
      this.db
        .prepare("INSERT INTO migrations (name) VALUES (?)")
        .run("002_create_sessions");
      console.log("[Database] Applied migration: 002_create_sessions");
    }

    // Migration 3: Transcripts table
    if (!applied.has("003_create_transcripts")) {
      this.db.exec(`
        CREATE TABLE transcripts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          user_id TEXT,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          confidence REAL DEFAULT 1.0,
          timestamp_ms INTEGER NOT NULL,
          is_final INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (session_id) REFERENCES sessions(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX idx_transcripts_session_id ON transcripts(session_id);
        CREATE INDEX idx_transcripts_user_id ON transcripts(user_id);
        CREATE INDEX idx_transcripts_timestamp ON transcripts(timestamp_ms);
        CREATE INDEX idx_transcripts_role ON transcripts(role);
      `);
      this.db
        .prepare("INSERT INTO migrations (name) VALUES (?)")
        .run("003_create_transcripts");
      console.log("[Database] Applied migration: 003_create_transcripts");
    }

    // Migration 4: Conversation summaries table (for context injection)
    if (!applied.has("004_create_summaries")) {
      this.db.exec(`
        CREATE TABLE conversation_summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          turn_count INTEGER NOT NULL,
          from_session_id TEXT NOT NULL,
          to_session_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (from_session_id) REFERENCES sessions(id),
          FOREIGN KEY (to_session_id) REFERENCES sessions(id)
        );
        CREATE INDEX idx_summaries_user_id ON conversation_summaries(user_id);
        CREATE INDEX idx_summaries_created_at ON conversation_summaries(created_at);
      `);
      this.db
        .prepare("INSERT INTO migrations (name) VALUES (?)")
        .run("004_create_summaries");
      console.log("[Database] Applied migration: 004_create_summaries");
    }

    // Migration 5: Audit events table (for Lane C)
    if (!applied.has("005_create_audit_events")) {
      this.db.exec(`
        CREATE TABLE audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE,
          session_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          source TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}',
          timestamp_ms INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX idx_audit_session_id ON audit_events(session_id);
        CREATE INDEX idx_audit_event_type ON audit_events(event_type);
        CREATE INDEX idx_audit_timestamp ON audit_events(timestamp_ms);
      `);
      this.db
        .prepare("INSERT INTO migrations (name) VALUES (?)")
        .run("005_create_audit_events");
      console.log("[Database] Applied migration: 005_create_audit_events");
    }
  }

  /**
   * Get the raw database instance
   */
  getDb(): Database.Database {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      console.log("[Database] Connection closed");
    }
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Prepare a statement (cached for performance)
   */
  prepare(sql: string): Database.Statement {
    return this.getDb().prepare(sql);
  }

  /**
   * Run SQL statements (for migrations)
   * Note: This is SQLite's exec, not shell exec
   */
  runSql(sql: string): void {
    this.getDb().exec(sql);
  }

  /**
   * Run in a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.getDb().transaction(fn)();
  }
}

// Default database path
const defaultDbPath = resolve(process.cwd(), "..", "data", "voice-jib-jab.db");

// Singleton instance with lazy initialization
let instance: DatabaseAdapter | null = null;

export function getDatabase(config?: Partial<DatabaseConfig>): DatabaseAdapter {
  if (!instance) {
    instance = new DatabaseAdapter({
      path: config?.path || process.env.DATABASE_PATH || defaultDbPath,
      walMode: config?.walMode ?? true,
      verbose: config?.verbose ?? false,
    });
    instance.initialize();
  }
  return instance;
}

export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
