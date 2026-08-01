"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import type { AssetTag } from "../lib/api";

type TagMultiSelectProps = {
  tags: AssetTag[];
  value: string[];
  onChange: (next: string[]) => void;
  defaultTag?: string;
  placeholder?: string;
  allowEmpty?: boolean;
};

function tagPath(tag: AssetTag): string {
  return (tag.path || tag.name || "").trim();
}

function leafLabel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function isPublicPath(path: string, defaultTag: string): boolean {
  return path === defaultTag || path.startsWith(`${defaultTag}/`);
}

/** public 与其它一级目录互斥：有非 public 标签时去掉 public。 */
function reconcileTags(paths: string[], defaultTag: string, allowEmpty: boolean): string[] {
  const cleaned = [...new Set(paths.map((item) => item.trim()).filter(Boolean))];
  const hasNonPublic = cleaned.some((path) => !isPublicPath(path, defaultTag));
  const next = hasNonPublic
    ? cleaned.filter((path) => !isPublicPath(path, defaultTag))
    : cleaned;
  if (next.length) return next;
  return allowEmpty ? [] : [defaultTag];
}

export function TagMultiSelect({
  tags,
  value,
  onChange,
  defaultTag = "public",
  placeholder = "选择标签",
  allowEmpty = false,
}: TagMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);

  const ordered = useMemo(() => {
    return [...tags].sort((a, b) => {
      const pathA = tagPath(a);
      const pathB = tagPath(b);
      if (pathA === defaultTag) return -1;
      if (pathB === defaultTag) return 1;
      return pathA.localeCompare(pathB, "zh-CN");
    });
  }, [tags, defaultTag]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, AssetTag[]>();
    for (const tag of ordered) {
      const parentId = tag.parent_id || null;
      const list = map.get(parentId) || [];
      list.push(tag);
      map.set(parentId, list);
    }
    return map;
  }, [ordered]);

  const rootTags = useMemo(() => {
    const byId = new Set(ordered.map((tag) => tag.id));
    return ordered.filter((tag) => !tag.parent_id || !byId.has(tag.parent_id));
  }, [ordered]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: Event) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [open]);

  function toggle(path: string) {
    const exists = value.includes(path);
    if (exists) {
      onChange(reconcileTags(value.filter((item) => item !== path), defaultTag, allowEmpty));
      return;
    }
    if (isPublicPath(path, defaultTag)) {
      onChange([path === defaultTag ? defaultTag : path]);
      return;
    }
    onChange(reconcileTags([...value, path], defaultTag, allowEmpty));
  }

  function removeChip(path: string, event: MouseEvent) {
    event.stopPropagation();
    onChange(reconcileTags(value.filter((item) => item !== path), defaultTag, allowEmpty));
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((item) => !item);
    }
  }

  function toggleCollapse(tagId: string, event: MouseEvent) {
    event.stopPropagation();
    setCollapsed((state) => ({ ...state, [tagId]: !state[tagId] }));
  }

  function renderTree(nodes: AssetTag[], depth: number): ReactNode {
    return nodes.map((tag) => {
      const path = tagPath(tag);
      const checked = value.includes(path);
      const kids = childrenByParent.get(tag.id) || [];
      const hasKids = kids.length > 0;
      const isCollapsed = !!collapsed[tag.id];
      return (
        <div key={tag.id} className="tagTreeNode">
          <button
            type="button"
            role="option"
            aria-selected={checked}
            className={`tagDropdownOption ${checked ? "selected" : ""} ${depth === 0 ? "root" : "child"}`}
            onClick={() => toggle(path)}
          >
            <span className={`tagDropdownCheck ${checked ? "on" : ""}`}>
              {checked ? <Check size={11} /> : null}
            </span>
            <span className="tagDropdownOptionBody" style={{ paddingLeft: depth * 16 }}>
              {hasKids ? (
                <span
                  className="tagTreeToggle"
                  onClick={(event) => toggleCollapse(tag.id, event)}
                  aria-label={isCollapsed ? "展开" : "收起"}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </span>
              ) : (
                <span className="tagTreeToggle spacer" />
              )}
              <span className="tagDropdownOptionName">{tag.name}</span>
            </span>
          </button>
          {hasKids && !isCollapsed ? renderTree(kids, depth + 1) : null}
        </div>
      );
    });
  }

  return (
    <div className={`tagDropdown ${open ? "open" : ""}`} ref={rootRef}>
      <div
        className="tagDropdownTrigger"
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((item) => !item)}
        onKeyDown={onTriggerKeyDown}
      >
        <div className="tagDropdownValue">
          {value.length ? (
            <div className="tagDropdownChips">
              {value.map((path) => (
                <span key={path} className="assetTagChip removable" title={path}>
                  {leafLabel(path)}
                  <button type="button" className="tagChipRemove" onClick={(event) => removeChip(path, event)} aria-label={`移除 ${leafLabel(path)}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="tagDropdownPlaceholder">{placeholder}</span>
          )}
        </div>
        <ChevronDown size={16} className="tagDropdownCaret" />
      </div>

      {open ? (
        <div className="tagDropdownPanel" role="listbox" aria-multiselectable="true">
          {rootTags.length ? renderTree(rootTags, 0) : <div className="emptyState">暂无可用标签</div>}
        </div>
      ) : null}
    </div>
  );
}
