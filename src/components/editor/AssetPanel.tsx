"use client";

import { useEffect, useRef, useState } from "react";
import { BUILTIN_ASSETS } from "@/features/assets/builtin";
import { captureBundle } from "@/features/assets/capture";
import { AssetLibrary, StoredAsset, openAssetLibrary } from "@/features/assets/library";
import { TEMPLATES, buildTemplate, templateBundle } from "@/features/assets/templates";
import { canvasCodec } from "@/lib/image/canvas-codec";
import { canvasMeasureFor } from "@/lib/image/text-measure";
import { selectScreen } from "@/store/editor-store";
import { editorStore, useEditorStore } from "@/store/use-editor-store";
import { downloadBlob } from "./download";

type Tab = "builtin" | "mine" | "template";
const TABS: { id: Tab; label: string }[] = [
  { id: "builtin", label: "내장" },
  { id: "mine", label: "내 소스" },
  { id: "template", label: "템플릿" },
];

/** Sources and templates: built-in parts, the user's own saved layers, and whole-screen templates. All made in code or saved locally. */
export default function AssetPanel() {
  const [tab, setTab] = useState<Tab>("builtin");
  const screen = useEditorStore(selectScreen);
  const comparing = useEditorStore((s) => s.compareMode !== "off");
  const [message, setMessage] = useState<string | null>(null);
  const canInsert = !!screen && !comparing;

  const insert = (bundle: Parameters<ReturnType<typeof editorStore.getState>["insertAsset"]>[0], mode: "center" | "keep") => {
    setMessage(null);
    if (!editorStore.getState().insertAsset(bundle, mode)) setMessage("넣지 못했습니다. 비교 보기를 끄고 다시 시도해 주세요.");
  };

  return (
    <section aria-label="소스와 템플릿" data-testid="asset-panel">
      <div className="panel-title">소스 · 템플릿</div>
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

function Builtin({ canInsert, onInsert }: { canInsert: boolean; onInsert: (b: ReturnType<(typeof BUILTIN_ASSETS)[number]["build"]>) => void }) {
  const groups = [
    { id: "button", label: "버튼 (기본 · hover · 눌림)" },
    { id: "part", label: "부품" },
    { id: "icon", label: "기본 아이콘" },
  ] as const;
  return (
    <div className="grid gap-2">
      {groups.map((g) => (
        <div key={g.id}>
          <div className="mb-1 font-bold">{g.label}</div>
          <div className="grid grid-cols-2 gap-1">
            {BUILTIN_ASSETS.filter((a) => a.group === g.id).map((a) => (
              <button key={a.id} data-testid={`asset-${a.id}`} className="btn mini truncate" disabled={!canInsert} title={`${a.label} — 클릭하면 화면 가운데에 새 레이어로 들어갑니다`} onClick={() => onInsert(a.build())}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Mine({ canInsert, onInsert, setMessage }: { canInsert: boolean; onInsert: (b: NonNullable<Awaited<ReturnType<AssetLibrary["load"]>>>) => void; setMessage: (m: string | null) => void }) {
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
      const bundle = captureBundle(name || layers[0]?.name || "내 소스", layers, st.images);
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
      {items.length === 0 && <p className="text-[var(--muted)]">저장한 소스가 없습니다.</p>}
      <ul className="m-0 grid list-none gap-1 p-0">
        {items.map((a) => (
          <li key={a.id} data-testid="my-asset" className="rounded border border-[var(--line)] bg-white p-1.5">
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
            <div className="mt-1 flex gap-1">
              <button className="btn mini" data-testid="asset-insert" disabled={!canInsert} onClick={() => guard(async () => { const b = await lib.current?.load(a.id); if (b) onInsert(b); })}>삽입</button>
              <button className="btn mini" data-testid="asset-rename" onClick={() => setRenaming({ id: a.id, text: a.name })}>이름</button>
              <button className="btn mini" data-testid="asset-delete" onClick={() => guard(async () => { await lib.current?.remove(a.id); await refresh(); })}>삭제</button>
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

function Templates({ canInsert, onAdd }: { canInsert: boolean; onAdd: (b: ReturnType<typeof templateBundle>) => void }) {
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
          <div className="font-bold">{t.label}</div>
          <div className="text-[11px] text-[var(--muted)]">{t.note}</div>
          <div className="mt-1 flex gap-1">
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