"use client";

import { useEffect, useRef, useState } from "react";
import { toolTooltip } from "@/features/help/help-content";
import { BUILTIN_ASSETS, BUTTON_STATES, BUTTON_STYLES } from "@/features/assets/builtin";
import { captureBundle } from "@/features/assets/capture";
import { AssetLibrary, StoredAsset, openAssetLibrary } from "@/features/assets/library";
import { previewCache } from "@/features/assets/preview";
import { AssetBundle } from "@/features/assets/types";
import { TEMPLATES, buildTemplate, templateBundle, templateFrame } from "@/features/assets/templates";
import { canvasCodec } from "@/lib/image/canvas-codec";
import { canvasMeasureFor } from "@/lib/image/text-measure";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import AssetThumb from "./AssetThumb";
import { downloadBlob } from "./download";

type Tab = "builtin" | "mine" | "template";
const TABS: { id: Tab; label: string }[] = [
  { id: "builtin", label: "내장" },
  { id: "mine", label: "내 소스" },
  { id: "template", label: "템플릿" },
];

type Insert = (bundle: AssetBundle, mode: "center" | "keep") => void;

/** Sources and templates: built-in parts, the user's own saved layers, and whole-screen templates, each shown as a picture card.
 *  All made in code or saved locally; the pictures are drawn by the same renderer as the PNG export. */
export default function AssetPanel() {
  const [tab, setTab] = useState<Tab>("builtin");
  const screen = useEditorStore(selectScreen);
  const comparing = useEditorStore((s) => s.compareMode !== "off");
  const [message, setMessage] = useState<string | null>(null);
  const canInsert = !!screen && !comparing;

  const insert: Insert = (bundle, mode) => {
    setMessage(null);
    if (!editorStore.getState().insertAsset(bundle, mode)) setMessage("넣지 못했습니다. 비교 보기를 끄고 다시 시도해 주세요.");
  };

  return (
    <section aria-label="소스와 템플릿" data-testid="asset-panel">
      <div className="panel-title" title={toolTooltip("sources", null)}>소스 · 템플릿</div>
      <div className="card text-xs">
        <div role="tablist" className="mb-2 flex gap-1">
          {TABS.map((t) => (
            <button key={t.id} role="tab" data-testid={`asset-tab-${t.id}`} aria-selected={tab === t.id} className="btn mini flex-1 aria-selected:bg-[var(--accent)] aria-selected:text-white" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {!screen && <p className="mb-2 text-[var(--muted)]">이미지를 올리면 소스를 넣을 수 있습니다. 템플릿은 바로 열 수 있습니다.</p>}
        {tab === "builtin" && <Builtin canInsert={canInsert} onInsert={(b) => insert(b, "center")} />}
        {tab === "mine" && <Mine canInsert={canInsert} onInsert={(b) => insert(b, "center")} setMessage={setMessage} />}
        {tab === "template" && <Templates canInsert={canInsert} onAdd={(b) => insert(b, "keep")} />}
        {message && (
          <p role="status" data-testid="asset-message" className="mt-2 text-[#8a5a12]">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

const byId = (id: string) => BUILTIN_ASSETS.find((a) => a.id === id)!;

function Builtin({ canInsert, onInsert }: { canInsert: boolean; onInsert: (b: AssetBundle) => void }) {
  const card = (id: string, label: string, w: number, h: number, caption?: string) => {
    const a = byId(id);
    return (
      <button key={id} data-testid={`asset-${id}`} className="flex min-w-0 flex-col items-center gap-1 rounded border border-transparent p-1 enabled:hover:border-[var(--accent)] disabled:opacity-50" disabled={!canInsert} aria-label={`소스 삽입 · ${label}`} title={`${label} — 클릭하면 화면 가운데에 새 레이어로 들어갑니다`} onClick={() => onInsert(a.build())}>
        <AssetThumb cacheKey={`builtin:${id}`} build={a.build} width={w} height={h} label={label} />
        <span className="w-full truncate text-center text-[11px]">{caption ?? label}</span>
      </button>
    );
  };
  return (
    <div className="grid gap-3">
      <div>
        <div className="mb-1 font-bold">버튼 (기본 · hover · 눌림)</div>
        <div className="grid gap-2">
          {BUTTON_STYLES.map((s) => (
            <div key={s.id} data-testid={`asset-button-group-${s.id}`} className="rounded border border-[var(--line)] bg-white p-1">
              <div className="mb-0.5 text-[11px] font-bold">{s.label}</div>
              <div className="grid grid-cols-3 gap-1">{BUTTON_STATES.map((st) => card(`button-${s.id}-${st.id}`, `${s.label} · ${st.label}`, 54, 36, st.label))}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 font-bold">부품</div>
        <div className="grid grid-cols-2 gap-1">{BUILTIN_ASSETS.filter((a) => a.group === "part").map((a) => card(a.id, a.label, 96, 52))}</div>
      </div>
      <div>
        <div className="mb-1 font-bold">기본 아이콘</div>
        <div className="grid grid-cols-3 gap-1">{BUILTIN_ASSETS.filter((a) => a.group === "icon").map((a) => card(a.id, a.label, 52, 40))}</div>
      </div>
    </div>
  );
}

function Mine({ canInsert, onInsert, setMessage }: { canInsert: boolean; onInsert: (b: AssetBundle) => void; setMessage: (m: string | null) => void }) {
  const lib = useRef<AssetLibrary | null>(null);
  const [items, setItems] = useState<StoredAsset[]>([]);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = useEditorStore((s) => s.selectedLayerIds);

  const refresh = async () => lib.current && setItems(await lib.current.list());
  useEffect(() => {
    let closed = false;
    openAssetLibrary(canvasCodec)
      .then(async (l) => {
        if (closed) return l.close();
        lib.current = l;
        await refresh();
      })
      .catch(() => setMessage("내 소스를 열 수 없습니다. 이 브라우저에서는 저장소를 쓸 수 없습니다."));
    return () => {
      closed = true;
      lib.current?.close();
      lib.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once per time the tab is shown
  }, []);

  const guard = async (fn: () => Promise<void>) => {
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "작업하지 못했습니다.");
    }
  };
  const save = () =>
    guard(async () => {
      const st = editorStore.getState();
      const layers = selectScreen(st)?.layers.filter((l) => st.selectedLayerIds.includes(l.id)) ?? [];
      const bundle = captureBundle(name || layers[0]?.name || "내 소스", layers, st.images, selectScreen(st)?.groups ?? []);
      if (!bundle || !lib.current) return setMessage("저장할 레이어를 먼저 선택해 주세요.");
      const rec = await lib.current.add(bundle, name || bundle.name);
      setName("");
      setMessage(`"${rec.name}" 소스를 저장했습니다.`);
      await refresh();
    });

  return (
    <div className="grid gap-2">
      <div className="grid gap-1">
        <input data-testid="asset-save-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="소스 이름" className="rounded border border-[var(--line)] bg-white px-1.5 py-1" />
        <button data-testid="asset-save" className="btn mini" disabled={selected.length === 0} title="선택한 레이어(여러 개 가능)를 이름을 붙여 저장합니다. 프로젝트 파일에는 들어가지 않습니다." onClick={save}>
          선택한 레이어 {selected.length > 0 ? `${selected.length}개 ` : ""}저장
        </button>
      </div>
      {items.length === 0 && <p data-testid="asset-empty" className="text-[var(--muted)]">저장한 소스가 없습니다. 레이어를 선택하고 저장해 보세요.</p>}
      <ul className="m-0 grid list-none gap-1 p-0">
        {items.map((a) => (
          <li key={a.id} data-testid="my-asset" className="flex gap-1.5 rounded border border-[var(--line)] bg-white p-1.5">
            <AssetThumb
              testId="my-asset-thumb"
              cacheKey={`mine:${a.id}:${a.savedAt}`}
              build={async () => (await lib.current?.load(a.id)) ?? null}
              width={64}
              height={64}
              label={a.name}
            />
            <div className="min-w-0 flex-1">
              {renaming?.id === a.id ? (
                <form
                  className="flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void guard(async () => {
                      await lib.current?.rename(a.id, renaming.text);
                      setRenaming(null);
                      await refresh();
                    });
                  }}
                >
                  <input data-testid="asset-rename-input" autoFocus value={renaming.text} maxLength={60} onChange={(e) => setRenaming({ id: a.id, text: e.target.value })} className="min-w-0 flex-1 rounded border border-[var(--line)] px-1" />
                  <button className="btn mini" type="submit">확인</button>
                </form>
              ) : (
                <div data-testid="my-asset-name" className="selectable truncate font-bold" title={a.name}>{a.name}</div>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                <button className="btn mini" data-testid="asset-insert" disabled={!canInsert} onClick={() => guard(async () => { const b = await lib.current?.load(a.id); if (b) onInsert(b); })}>삽입</button>
                <button className="btn mini" data-testid="asset-rename" onClick={() => setRenaming({ id: a.id, text: a.name })}>이름</button>
                <button
                  className="btn mini"
                  data-testid="asset-delete"
                  onClick={() => guard(async () => {
                    await lib.current?.remove(a.id);
                    previewCache.drop(`mine:${a.id}:`);
                    await refresh();
                  })}
                >
                  삭제
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-1">
        <button
          className="btn mini flex-1"
          data-testid="asset-export"
          disabled={items.length === 0}
          onClick={() => guard(async () => downloadBlob(new Blob([(await lib.current!.exportFile())], { type: "application/json" }), "my-sources.slc-assets.json"))}
        >
          내보내기
        </button>
        <button className="btn mini flex-1" data-testid="asset-import" onClick={() => fileInput.current?.click()}>
          가져오기
        </button>
        <input
          ref={fileInput}
          data-testid="asset-import-input"
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void guard(async () => {
              const r = await lib.current!.importFile(await file.text());
              if (!r.ok) return setMessage(`가져오지 못했습니다. ${r.error}`);
              setMessage(`${r.added.length}개를 가져왔습니다.${r.renamed.length ? ` 같은 이름이 있어 이름을 바꿔 추가: ${r.renamed.map((x) => `${x.from} → ${x.to}`).join(", ")}` : ""}`);
              await refresh();
            });
          }}
        />
      </div>
    </div>
  );
}

/** one template's picture: the whole screen, shrunk */
export function TemplateThumb({ id, width, height, label }: { id: (typeof TEMPLATES)[number]["id"]; width: number; height: number; label: string }) {
  return <AssetThumb testId={`template-${id}-thumb`} cacheKey={`template:${id}`} build={() => templateBundle(id)} options={{ frame: templateFrame(id), measure: canvasMeasureFor }} width={width} height={height} bigSide={520} label={label} />;
}

function Templates({ canInsert, onAdd }: { canInsert: boolean; onAdd: (b: AssetBundle) => void }) {
  const hasWork = useEditorStore((s) => (s.history?.past.length ?? 0) > 0);
  const [armed, setArmed] = useState<string | null>(null);
  const open = (id: (typeof TEMPLATES)[number]["id"]) => {
    // opening replaces the project: with edits in it the first click only asks
    if (hasWork && armed !== id) return setArmed(id);
    setArmed(null);
    const { project, images } = buildTemplate(id, canvasMeasureFor);
    editorStore.getState().loadProject(project, images);
    editorStore.setState({ needsFit: true });
  };
  return (
    <div className="grid gap-2">
      {TEMPLATES.map((t) => (
        <div key={t.id} data-testid={`template-${t.id}`} className="rounded border border-[var(--line)] bg-white p-1.5">
          <div className="flex gap-2">
            <TemplateThumb id={t.id} width={70} height={152} label={t.label} />
            <div className="min-w-0 flex-1">
              <div className="font-bold">{t.label}</div>
              <div className="text-[11px] text-[var(--muted)]">{t.note}</div>
            </div>
          </div>
          <div className="mt-1.5 grid gap-1">
            <button className="btn mini" data-testid={`template-${t.id}-new`} onClick={() => open(t.id)}>
              {armed === t.id ? "작업이 사라집니다. 열기" : "새 프로젝트로 열기"}
            </button>
            <button className="btn mini" data-testid={`template-${t.id}-add`} disabled={!canInsert} title="현재 화면에 이 템플릿의 레이어만 추가합니다" onClick={() => onAdd(templateBundle(t.id))}>
              현재 화면에 추가
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
