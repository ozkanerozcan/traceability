import { getDb } from '../../core/database/connection.js';

// ─── Tipler ─────────────────────────────────────────────────────────────────

export const WIDGET_TYPES = ['numeric', 'gauge', 'trend', 'status', 'table'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export interface RecipeRow {
  id: number;
  name: string;
  description: string | null;
  dashboard_layout: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeInput {
  name: string;
  description?: string | null;
}

export interface RecipeStats {
  activeWorkOrders: number;
  totalWorkOrders: number;
}

export function isValidWidgetType(v: string): v is WidgetType {
  return (WIDGET_TYPES as readonly string[]).includes(v);
}

// ─── Sorgular ───────────────────────────────────────────────────────────────

export function listRecipes(): (RecipeRow & {
  active_work_orders: number;
  total_work_orders: number;
})[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.*,
        (SELECT COUNT(*) FROM work_orders wo
          WHERE wo.recipe_id = r.id AND wo.status IN ('active', 'paused')) AS active_work_orders,
        (SELECT COUNT(*) FROM work_orders wo WHERE wo.recipe_id = r.id) AS total_work_orders
       FROM recipes r
       ORDER BY r.id`
    )
    .all() as (RecipeRow & {
    active_work_orders: number;
    total_work_orders: number;
  })[];
}

export function getRecipe(id: number): RecipeRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as RecipeRow | undefined;
}

/** Reçetenin koruma durumu: silme kısıtının dayanağı */
export function getRecipeStats(id: number): RecipeStats {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM work_orders wo
          WHERE wo.recipe_id = ? AND wo.status IN ('active', 'paused')) AS active_work_orders,
        (SELECT COUNT(*) FROM work_orders wo WHERE wo.recipe_id = ?) AS total_work_orders`
    )
    .get(id, id) as { active_work_orders: number; total_work_orders: number };
  return {
    activeWorkOrders: row.active_work_orders,
    totalWorkOrders: row.total_work_orders,
  };
}

// ─── Komutlar ───────────────────────────────────────────────────────────────

export function createRecipe(input: RecipeInput): RecipeRow {
  const db = getDb();
  const result = db
    .prepare('INSERT INTO recipes (name, description) VALUES (?, ?)')
    .run(input.name, input.description ?? null);
  return getRecipe(Number(result.lastInsertRowid))!;
}

export function updateRecipe(id: number, input: Partial<RecipeInput>): RecipeRow | undefined {
  const db = getDb();
  const existing = getRecipe(id);
  if (!existing) return undefined;

  db.prepare(
    `UPDATE recipes SET
       name = ?, description = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    input.name ?? existing.name,
    input.description !== undefined ? input.description : existing.description,
    id
  );

  return getRecipe(id);
}

export function deleteRecipe(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Dashboard layout JSON'unu kaydeder. layout doğrulaması route seviyesinde yapılır. */
export function saveDashboardLayout(id: number, layout: unknown): RecipeRow | undefined {
  const db = getDb();
  const existing = getRecipe(id);
  if (!existing) return undefined;
  db.prepare(
    "UPDATE recipes SET dashboard_layout = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(layout), id);
  return getRecipe(id);
}
