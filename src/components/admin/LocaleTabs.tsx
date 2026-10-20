"use client";

import { useState, type ReactNode } from "react";

export interface LocalePanel {
  code: string;
  label: string;
  locked?: boolean;
  missing?: boolean;
  content: ReactNode;
}

/** Tabs per language. All panels stay in the DOM so every language is submitted together. */
export function LocaleTabs({ panels }: { panels: LocalePanel[] }) {
  const [active, setActive] = useState(panels[0]?.code);
  return (
    <div>
      <div className="tabs" role="tablist">
        {panels.map((p) => (
          <button key={p.code} type="button" role="tab" aria-selected={active === p.code} onClick={() => setActive(p.code)}>
            {p.label}
            {p.locked ? <span className="lock" title="Read-only for your role">🔒</span> : null}
            {p.missing ? <span className="lock" title="No translation yet">•</span> : null}
          </button>
        ))}
      </div>
      {panels.map((p) => (
        <div key={p.code} role="tabpanel" hidden={active !== p.code}>
          {p.content}
        </div>
      ))}
    </div>
  );
}
