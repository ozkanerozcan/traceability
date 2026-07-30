import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import {
  ArrowLeft,
  Save,
  Hash,
  Gauge,
  TrendingUp,
  ToggleLeft,
  Table2,
  Settings2,
  Trash2,
} from 'lucide-react';
import { Alert, Button, Checkbox, Input, Modal, useToast } from '../../../core/components/common';

import { plcService, tagService } from '../../plc-gateway/services/plc.service';
import TagSelect, { type PlcTagGroup } from './TagSelect';
import {
  newWidgetId,
  recipeService,
  WIDGET_DEFAULTS,
  WIDGET_TYPES,
  type DashboardLayout,
  type Recipe,
  type WidgetConfig,
  type WidgetOptions,
  type WidgetType,
} from '../services/recipe.service';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import '../styles/recipe.css';

const Grid = WidthProvider(GridLayout);
const GRID_COLS = 12;
const ROW_HEIGHT = 60;

const WIDGET_ICONS: Record<WidgetType, React.ReactNode> = {
  numeric: <Hash size={18} />,
  gauge: <Gauge size={18} />,
  trend: <TrendingUp size={18} />,
  status: <ToggleLeft size={18} />,
  table: <Table2 size={18} />,
};

/** PLC bilgisiyle zenginleştirilmiş tag (widget binding seçenekleri için) */
interface TagOption {
  id: number;
  name: string;
  plcName: string;
}

/** Widget tipine göre varsayılan konfigürasyon üretir */
function defaultWidget(type: WidgetType): WidgetConfig {
  const size = WIDGET_DEFAULTS[type];
  const options: WidgetOptions = {};
  if (type === 'numeric') options.decimals = 1;
  if (type === 'gauge') {
    options.min = 0;
    options.max = 100;
    options.decimals = 1;
  }
  if (type === 'trend') options.windowSeconds = 300;
  return {
    id: newWidgetId(),
    type,
    title: '',
    tagId: null,
    tagIds: type === 'table' ? [] : undefined,
    options,
    // y: addWidget tarafından (canvas sonu veya drop pozisyonu) atanır
    layout: { x: 0, y: 0, w: size.w, h: size.h, minW: size.minW, minH: size.minH },
  };
}

// ─── Widget Konfigürasyon Paneli (Modal) ─────────────────────────────────────

interface WidgetConfigModalProps {
  widget: WidgetConfig | null;
  /** Tüm PLC'lerin tag'leri, PLC'ye göre gruplu */
  tagGroups: PlcTagGroup[];
  onClose: () => void;
  onSave: (widget: WidgetConfig) => void;
}

function WidgetConfigModal({ widget, tagGroups, onClose, onSave }: WidgetConfigModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<WidgetConfig | null>(null);
  const [tableSearch, setTableSearch] = useState('');

  useEffect(() => {
    setDraft(widget ? { ...widget, options: { ...widget.options } } : null);
    setTableSearch('');
  }, [widget]);

  if (!widget || !draft) return null;

  const isTable = draft.type === 'table';
  const noTags = tagGroups.every((g) => g.tags.length === 0);

  const setOption = <K extends keyof WidgetOptions>(key: K, value: WidgetOptions[K]) => {
    setDraft((prev) => (prev ? { ...prev, options: { ...prev.options, [key]: value } } : prev));
  };

  const numberOrNull = (v: string): number | null => (v === '' ? null : Number(v));

  return (
    <Modal
      open
      wide
      title={t('recipe.config.title', { type: t(`recipe.widget.${draft.type}`) })}
      onClose={onClose}
      footer={

        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onSave(draft)}>{t('common.save')}</Button>
        </>
      }
    >
      <Input
        label={t('recipe.config.widgetTitle')}
        name="title"
        value={draft.title}
        placeholder={t(`recipe.widget.${draft.type}`)}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />

      {/* ─── Veri kaynağı: PLC → Tag seçimi ─── */}
      {isTable ? (
        <div className="form-group">
          <span className="form-label">{t('recipe.config.dataSource')}</span>
          {noTags ? (
            <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
              {t('recipe.config.noTagsHint')}
            </p>
          ) : (
            <>
              <input
                className="input"
                style={{ marginBottom: 8 }}
                placeholder={t('recipe.config.searchTags')}
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
              />
              <div className="tag-check-list">
                {tagGroups.map((group) => {
                  const term = tableSearch.trim().toLowerCase();
                  const tags = term
                    ? group.tags.filter(
                        (tag) =>
                          tag.name.toLowerCase().includes(term) ||
                          group.plcName.toLowerCase().includes(term) ||
                          tag.address.toLowerCase().includes(term) ||
                          tag.dataType.toLowerCase().includes(term)
                      )
                    : group.tags;
                  if (tags.length === 0) return null;
                  return (
                    <div key={group.plcId}>
                      <div
                        className="text-muted"
                        style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, marginBottom: 4 }}
                      >
                        {group.plcName}
                      </div>
                      {tags.map((tag) => {
                        const checked = (draft.tagIds ?? []).includes(tag.id);
                        return (
                          <Checkbox
                            key={tag.id}
                            className="tag-check-item"
                            checked={checked}
                            onChange={(e) => {
                              const current = draft.tagIds ?? [];
                              setDraft({
                                ...draft,
                                tagIds: e.target.checked
                                  ? [...current, tag.id]
                                  : current.filter((id) => id !== tag.id),
                              });
                            }}
                            label={
                              <span>
                                {tag.name}
                                <span className="text-muted"> · {tag.dataType}</span>
                              </span>
                            }
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="form-group">
          <span className="form-label">{t('recipe.config.dataSource')}</span>
          <TagSelect
            tagGroups={tagGroups}
            value={draft.tagId ?? null}
            onChange={(tagId) => setDraft({ ...draft, tagId })}
          />
        </div>
      )}
      {!isTable && noTags && (
        <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginTop: -8, marginBottom: 16 }}>
          {t('recipe.config.noTagsHint')}
        </p>
      )}

      {/* ─── Tip-spesifik görüntüleme ayarları ─── */}
      {(draft.type === 'numeric' || draft.type === 'gauge' || draft.type === 'trend') && (
        <div className="config-grid">
          <Input
            label={t('plc.unit')}
            name="unit"
            value={draft.options.unit ?? ''}
            onChange={(e) => setOption('unit', e.target.value || undefined)}
          />
          <Input
            label={t('recipe.config.decimals')}
            name="decimals"
            type="number"
            min={0}
            max={6}
            value={draft.options.decimals ?? ''}
            onChange={(e) => setOption('decimals', e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </div>
      )}

      {draft.type === 'gauge' && (
        <div className="config-grid">
          <Input
            label={t('recipe.config.min')}
            name="min"
            type="number"
            value={draft.options.min ?? 0}
            onChange={(e) => setOption('min', Number(e.target.value))}
          />
          <Input
            label={t('recipe.config.max')}
            name="max"
            type="number"
            value={draft.options.max ?? 100}
            onChange={(e) => setOption('max', Number(e.target.value))}
          />
          <Input
            label={t('recipe.config.warningHigh')}
            name="warningHigh"
            type="number"
            value={draft.options.warningHigh ?? ''}
            onChange={(e) =>
              setOption('warningHigh', e.target.value === '' ? undefined : Number(e.target.value))
            }
          />
        </div>
      )}

      {draft.type === 'trend' && (
        <div className="config-grid">
          <Input
            label={t('recipe.config.windowSeconds')}
            name="windowSeconds"
            type="number"
            min={10}
            value={draft.options.windowSeconds ?? 300}
            onChange={(e) => setOption('windowSeconds', Number(e.target.value))}
          />
          <Input
            label={t('recipe.config.yMin')}
            name="yMin"
            type="number"
            value={draft.options.yMin ?? ''}
            onChange={(e) => setOption('yMin', numberOrNull(e.target.value))}
          />
          <Input
            label={t('recipe.config.yMax')}
            name="yMax"
            type="number"
            value={draft.options.yMax ?? ''}
            onChange={(e) => setOption('yMax', numberOrNull(e.target.value))}
          />
        </div>
      )}

      {draft.type === 'status' && (
        <div className="config-grid">
          <Input
            label={t('recipe.config.trueLabel')}
            name="trueLabel"
            value={draft.options.trueLabel ?? ''}
            placeholder={t('recipe.config.trueLabelDefault')}
            onChange={(e) => setOption('trueLabel', e.target.value || undefined)}
          />
          <Input
            label={t('recipe.config.falseLabel')}
            name="falseLabel"
            value={draft.options.falseLabel ?? ''}
            placeholder={t('recipe.config.falseLabelDefault')}
            onChange={(e) => setOption('falseLabel', e.target.value || undefined)}
          />
        </div>
      )}
    </Modal>
  );
}

// ─── Dashboard Editörü ───────────────────────────────────────────────────────

export default function DashboardEditor() {
  const { t } = useTranslation();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const recipeId = Number(id);


  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [tagGroups, setTagGroups] = useState<PlcTagGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [configTarget, setConfigTarget] = useState<WidgetConfig | null>(null);
  const [droppingSize, setDroppingSize] = useState({ w: 4, h: 3 });

  // onLayoutChange mount'ta da tetiklenir — ilk çağrıyı dirty sayma
  const layoutInitialized = useRef(false);

  // Reçete + tüm PLC tag'lerini yükle
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ recipe: data }, { plcs }] = await Promise.all([
          recipeService.get(recipeId),
          plcService.list(),
        ]);
        const groups = await Promise.all(
          plcs.map(async (plc) => {
            const { tags } = await tagService.list(plc.id);
            return { plcId: plc.id, plcName: plc.name, tags };
          })
        );
        if (cancelled) return;
        setRecipe(data);
        setWidgets(data.dashboardLayout?.widgets ?? []);
        setTagGroups(groups);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  const allTags: TagOption[] = useMemo(
    () =>
      tagGroups.flatMap((g) =>
        g.tags.map((tag) => ({ ...tag, plcName: g.plcName }))
      ),
    [tagGroups]
  );

  const gridLayout: Layout[] = useMemo(
    () =>
      widgets.map((w) => ({
        i: w.id,
        x: w.layout.x,
        y: w.layout.y,
        w: w.layout.w,
        h: w.layout.h,
        minW: w.layout.minW,
        minH: w.layout.minH,
      })),
    [widgets]
  );

  const tagLabel = useCallback(
    (widget: WidgetConfig): string => {
      if (widget.type === 'table') {
        const count = widget.tagIds?.length ?? 0;
        return count > 0 ? t('recipe.config.boundTags', { count }) : t('recipe.config.unbound');
      }
      if (widget.tagId == null) return t('recipe.config.unbound');
      const tag = allTags.find((x) => x.id === widget.tagId);
      return tag ? `${tag.name} (${tag.plcName})` : t('recipe.config.unbound');
    },
    [allTags, t]
  );

  const handleLayoutChange = (layout: Layout[]) => {
    if (!layoutInitialized.current) {
      layoutInitialized.current = true;
      return;
    }
    setWidgets((prev) => {
      const byId = new Map(layout.map((l) => [l.i, l]));
      const next = prev.map((w) => {
        const l = byId.get(w.id);
        if (!l) return w;
        if (l.x === w.layout.x && l.y === w.layout.y && l.w === w.layout.w && l.h === w.layout.h) {
          return w;
        }
        return { ...w, layout: { ...w.layout, x: l.x, y: l.y, w: l.w, h: l.h } };
      });
      return next;
    });
    setDirty(true);
  };

  const addWidget = (type: WidgetType, dropPosition?: { x: number; y: number }) => {
    const widget = defaultWidget(type);
    if (dropPosition) {
      widget.layout = { ...widget.layout, x: dropPosition.x, y: dropPosition.y };
    } else {
      // Canvas sonuna ekle
      const maxY = widgets.reduce((acc, w) => Math.max(acc, w.layout.y + w.layout.h), 0);
      widget.layout = { ...widget.layout, x: 0, y: maxY };
    }
    setWidgets((prev) => [...prev, widget]);
    setDirty(true);
    setConfigTarget(widget);
  };

  const handleDrop = (_layout: Layout[], item: Layout, e: Event) => {
    const type = (e as DragEvent).dataTransfer?.getData('widget-type') as WidgetType | '';
    if (type && WIDGET_TYPES.includes(type)) {
      addWidget(type, { x: item.x, y: item.y });
    }
  };

  const removeWidget = (widgetId: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
    setDirty(true);
  };

  const saveWidgetConfig = (updated: WidgetConfig) => {
    setWidgets((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
    setDirty(true);
    setConfigTarget(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const layout: DashboardLayout = { widgets };
      await recipeService.saveDashboard(recipeId, layout);
      setDirty(false);
      setSavedMsg(true);
      toast.success(t('recipe.dashboardSaved'));
      setTimeout(() => setSavedMsg(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };


  if (loading) {
    return <p className="text-muted">{t('common.loading')}</p>;
  }

  if (notFound || !recipe) {
    return (
      <div>
        <p className="text-danger mb-4">{t('recipe.notFound')}</p>
        <Link to="/recipes">
          <Button variant="secondary">
            <ArrowLeft size={16} /> {t('nav.recipes')}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link to="/recipes" className="btn-icon" title={t('nav.recipes')}>
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>
              {t('recipe.dashboardEditor')}
            </h1>
            <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
              {recipe.name}
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={!dirty || saving}>
          <Save size={16} /> {saving ? t('common.loading') : t('recipe.saveDashboard')}
        </Button>
      </div>

      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}
      {savedMsg && (
        <Alert variant="success" className="mb-4">
          {t('recipe.dashboardSaved')}
        </Alert>
      )}

      <div className="dashboard-editor">
        {/* ─── Widget Paleti ─── */}
        <aside className="widget-palette">
          <h4 className="widget-palette-title">{t('recipe.widgetPalette')}</h4>
          <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 12 }}>
            {t('recipe.paletteHint')}
          </p>
          {WIDGET_TYPES.map((type) => (
            <div
              key={type}
              className="widget-palette-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('widget-type', type);
                const size = WIDGET_DEFAULTS[type];
                setDroppingSize({ w: size.w, h: size.h });
              }}
              onClick={() => addWidget(type)}
            >
              {WIDGET_ICONS[type]}
              <span>{t(`recipe.widget.${type}`)}</span>
            </div>
          ))}
        </aside>

        {/* ─── Canvas ─── */}
        <div className="dashboard-canvas">
          {widgets.length === 0 && (
            <div className="dashboard-canvas-empty">
              <p className="text-muted">{t('recipe.emptyCanvas')}</p>
            </div>
          )}
          <Grid
            className="layout"
            layout={gridLayout}
            cols={GRID_COLS}
            rowHeight={ROW_HEIGHT}
            margin={[12, 12]}
            isDroppable
            droppingItem={{ i: '__dropping-elem__', ...droppingSize }}
            onDrop={handleDrop}
            onLayoutChange={handleLayoutChange}
            draggableCancel=".widget-action"
          >
            {widgets.map((widget) => (
              <div key={widget.id} className={`dashboard-widget widget-${widget.type}`}>
                <div className="dashboard-widget-header">
                  <span className="dashboard-widget-icon">{WIDGET_ICONS[widget.type]}</span>
                  <span className="dashboard-widget-title">
                    {widget.title || t(`recipe.widget.${widget.type}`)}
                  </span>
                  <button
                    className="btn-icon widget-action"
                    title={t('common.edit')}
                    onClick={() => setConfigTarget(widget)}
                  >
                    <Settings2 size={14} />
                  </button>
                  <button
                    className="btn-icon widget-action"
                    title={t('common.delete')}
                    onClick={() => removeWidget(widget.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="dashboard-widget-body">
                  <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                    {tagLabel(widget)}
                  </span>
                </div>
              </div>
            ))}
          </Grid>
        </div>
      </div>

      <WidgetConfigModal
        widget={configTarget}
        tagGroups={tagGroups}
        onClose={() => setConfigTarget(null)}
        onSave={saveWidgetConfig}
      />
    </div>
  );
}
