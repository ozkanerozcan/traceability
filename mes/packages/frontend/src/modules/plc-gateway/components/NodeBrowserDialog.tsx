import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Folder, Variable, Loader2 } from 'lucide-react';
import { Badge, Button, Modal } from '../../../core/components/common';


import { opcuaService, type BrowseNode } from '../services/plc.service';

interface NodeBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  plcId: number;
  /** Kullanıcı bir Variable node seçtiğinde çağrılır */
  onSelect: (node: BrowseNode) => void;
}

interface TreeRowProps {
  node: BrowseNode;
  depth: number;
  childrenMap: Map<string, BrowseNode[]>;
  expanded: Set<string>;
  loading: Set<string>;
  onToggle: (node: BrowseNode) => void;
  onSelect: (node: BrowseNode) => void;
}

/** Ağaç satırı — Variable ise seçilebilir, hasChildren ise genişletilebilir. */
function TreeRow({ node, depth, childrenMap, expanded, loading, onToggle, onSelect }: TreeRowProps) {
  const { t } = useTranslation();
  const isOpen = expanded.has(node.nodeId);
  const isLoading = loading.has(node.nodeId);
  const isVariable = node.nodeClass === 'Variable';
  const children = childrenMap.get(node.nodeId) ?? [];

  return (
    <>
      <div
        className="flex items-center gap-2"
        style={{
          padding: '6px 8px',
          paddingLeft: `${8 + depth * 20}px`,
          cursor: node.hasChildren ? 'pointer' : 'default',
          borderRadius: 'var(--radius-sm, 4px)',
        }}
        onClick={() => node.hasChildren && onToggle(node)}
        role="treeitem"
        aria-expanded={node.hasChildren ? isOpen : undefined}
      >
        <span style={{ width: 16, flexShrink: 0 }}>
          {isLoading ? (
            <Loader2 size={14} className="spin" />
          ) : node.hasChildren ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : null}
        </span>
        {isVariable ? <Variable size={14} /> : <Folder size={14} />}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.displayName}
        </span>
        {node.dataType && <Badge variant="muted">{node.dataType}</Badge>}
        <span className="text-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
          {node.nodeId}
        </span>
        {isVariable && (
          <Button
            variant="secondary"
            style={{ padding: '2px 10px', fontSize: 'var(--font-size-xs)' }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(node);
            }}
          >
            +
          </Button>
        )}
      </div>
      {isOpen && children.length === 0 && !loading.has(node.nodeId) && (
        <div
          className="text-muted"
          style={{ padding: '4px 8px', paddingLeft: `${8 + (depth + 1) * 20}px`, fontSize: 'var(--font-size-xs)' }}
        >
          ({t('plc.emptyFolder')})
        </div>
      )}
      {isOpen &&
        children.map((child) => (
          <TreeRow
            key={child.nodeId}
            node={child}
            depth={depth + 1}
            childrenMap={childrenMap}
            expanded={expanded}
            loading={loading}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

/**
 * OPC UA sunucu adres alanı gezinme diyaloğu.
 * Kök (ObjectsFolder) tembel (lazy) yüklenir; klasörler genişletildikçe
 * ilgili node'un çocukları getirilir. Variable seçimi NodeId + veri tipi döndürür.
 */
export default function NodeBrowserDialog({ open, onClose, plcId, onSelect }: NodeBrowserDialogProps) {
  const { t } = useTranslation();
  const [childrenMap, setChildrenMap] = useState<Map<string, BrowseNode[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());


  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [rootLoading, setRootLoading] = useState(false);

  const loadChildren = useCallback(
    async (nodeId: string | undefined, key: string) => {
      setLoading((prev) => new Set(prev).add(key));
      setError(null);
      try {
        const { nodes } = await opcuaService.browse(plcId, nodeId);
        setChildrenMap((prev) => new Map(prev).set(key, nodes));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.error'));
      } finally {
        setLoading((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [plcId, t]
  );

  // Diyalog açıldığında kökü yükle, kapandığında durumu sıfırla
  useEffect(() => {
    if (open) {
      setChildrenMap(new Map());
      setExpanded(new Set());
      setError(null);
      setRootLoading(true);
      void loadChildren(undefined, '__root__').finally(() => setRootLoading(false));
    }
  }, [open, loadChildren]);

  const handleToggle = (node: BrowseNode) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.nodeId)) {
        next.delete(node.nodeId);
      } else {
        next.add(node.nodeId);
        // Henüz yüklenmediyse çocukları getir
        if (!childrenMap.has(node.nodeId)) {
          void loadChildren(node.nodeId, node.nodeId);
        }
      }
      return next;
    });
  };

  const rootNodes = childrenMap.get('__root__') ?? [];

  return (
    <Modal open={open} wide title={t('plc.browseTitle')} onClose={onClose}>

      <div
        role="tree"
        style={{
          maxHeight: 400,
          overflowY: 'auto',
          border: '1px solid var(--border-color, #333)',
          borderRadius: 'var(--radius-sm, 4px)',
          padding: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
        }}
      >
        {rootLoading ? (
          <p className="text-muted">{t('common.loading')}</p>
        ) : error ? (
          <Badge variant="danger">{error}</Badge>
        ) : rootNodes.length === 0 ? (
          <p className="text-muted">{t('common.noData')}</p>
        ) : (
          rootNodes.map((node) => (
            <TreeRow
              key={node.nodeId}
              node={node}
              depth={0}
              childrenMap={childrenMap}
              expanded={expanded}
              loading={loading}
              onToggle={handleToggle}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
      <div className="flex" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </Modal>
  );
}
