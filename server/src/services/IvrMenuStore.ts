/**
 * IvrMenuStore — JSON-persisted IVR phone tree configs.
 *
 * An IVR menu is a directed tree of nodes. Each node has a prompt
 * and a set of options (keyed by DTMF digit "1"-"9" or "0").
 * The terminal node type "transfer" routes to a template.
 *
 * Example tree:
 *   root → "Press 1 for support, 2 for sales"
 *     1 → "Transfer to Customer Support"  (template: builtin-customer-support)
 *     2 → "Transfer to Sales"             (template: builtin-sales)
 *     0 → "Return to main menu"           (type: back)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────

/** Discriminator for IVR tree node behavior. */
export type IvrNodeType = "menu" | "transfer" | "message";

/** A single node in an IVR phone tree with prompt text and DTMF options. */
export interface IvrNode {
  nodeId: string;
  type: IvrNodeType;
  prompt: string;
  options?: Record<string, IvrNodeRef>;
  targetTemplateId?: string;
  tenantId: string | null;
}

/** Lightweight reference from a DTMF option to its target node. */
export interface IvrNodeRef {
  nodeId: string;
  label: string;
}

/** Top-level IVR menu containing a directed tree of IvrNodes. */
export interface IvrMenu {
  menuId: string;
  name: string;
  tenantId: string | null;
  rootNodeId: string;
  nodes: Record<string, IvrNode>;
  createdAt: string;
  updatedAt: string;
}

// ── IvrMenuStore ───────────────────────────────────────────────────────

/** JSON-persisted CRUD store for IVR phone-tree menus with DTMF navigation. */
export class IvrMenuStore {
  private menus: Map<string, IvrMenu> = new Map();
  private storageFile: string;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.loadFromDisk();
  }

  // ── Private persistence helpers ────────────────────────────────────

  private loadFromDisk(): void {
    if (!existsSync(this.storageFile)) {
      return;
    }

    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      const menus = JSON.parse(raw) as IvrMenu[];
      for (const menu of menus) {
        this.menus.set(menu.menuId, menu);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  private saveToDisk(): void {
    const dir = dirname(this.storageFile);
    mkdirSync(dir, { recursive: true });

    const menus = Array.from(this.menus.values());
    writeFileSync(this.storageFile, JSON.stringify(menus, null, 2), "utf-8");
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Create a new IVR menu. Persists immediately. */
  createMenu(opts: Omit<IvrMenu, "menuId" | "createdAt" | "updatedAt">): IvrMenu {
    const now = new Date().toISOString();
    const menu: IvrMenu = {
      ...opts,
      menuId: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    this.menus.set(menu.menuId, menu);
    this.saveToDisk();
    return menu;
  }

  /** Get a single menu by id. */
  getMenu(menuId: string): IvrMenu | undefined {
    return this.menus.get(menuId);
  }

  /** List menus with optional tenantId filter. */
  listMenus(opts?: { tenantId?: string }): IvrMenu[] {
    let results = Array.from(this.menus.values());

    if (opts?.tenantId !== undefined) {
      results = results.filter((m) => m.tenantId === opts.tenantId);
    }

    return results;
  }

  /** Patch a menu's name, nodes, or rootNodeId. Returns undefined if not found. */
  updateMenu(
    menuId: string,
    patch: Partial<Pick<IvrMenu, "name" | "nodes" | "rootNodeId">>,
  ): IvrMenu | undefined {
    const existing = this.menus.get(menuId);
    if (!existing) {
      return undefined;
    }

    const updated: IvrMenu = {
      ...existing,
      ...patch,
      menuId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.menus.set(menuId, updated);
    this.saveToDisk();
    return updated;
  }

  /** Delete a menu. Returns false if not found. */
  deleteMenu(menuId: string): boolean {
    if (!this.menus.has(menuId)) {
      return false;
    }

    this.menus.delete(menuId);
    this.saveToDisk();
    return true;
  }

  /**
   * Process a DTMF digit press from a given node.
   *
   * Returns the next node and its prompt if the digit maps to an option,
   * or null if the menu/node is not found or the digit has no option.
   */
  processInput(
    menuId: string,
    nodeId: string,
    digit: string,
  ): { nextNode: IvrNode; prompt: string } | null {
    const menu = this.menus.get(menuId);
    if (!menu) {
      return null;
    }

    const currentNode = menu.nodes[nodeId];
    if (!currentNode) {
      return null;
    }

    const options = currentNode.options;
    if (!options) {
      return null;
    }

    const ref = options[digit];
    if (!ref) {
      return null;
    }

    const nextNode = menu.nodes[ref.nodeId];
    if (!nextNode) {
      return null;
    }

    return { nextNode, prompt: nextNode.prompt };
  }
}

// ── Module-level singleton ─────────────────────────────────────────────

let _store: IvrMenuStore | null = null;

/** Module-level singleton. Access after calling initIvrMenuStore(). */
export const ivrMenuStore: IvrMenuStore = new Proxy(
  {} as IvrMenuStore,
  {
    get(_target, prop) {
      if (!_store) {
        throw new Error(
          "IvrMenuStore not initialized. Call initIvrMenuStore() first.",
        );
      }
      const value = (_store as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return value.bind(_store);
      }
      return value;
    },
  },
);

/** Initialize the module-level singleton with a storage file path. */
export function initIvrMenuStore(storageFile: string): IvrMenuStore {
  _store = new IvrMenuStore(storageFile);
  return _store;
}
