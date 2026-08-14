import { api, onBoardPanelToggle } from "../shared/ipc";
import type { BoardFile, BoardMeta } from "../shared/types";

export interface PanelHost {
  isHost(): boolean;
  activeBoardId(): string | null;
  openBoard(board: BoardFile): Promise<void>;
  forgetBoard(id: string): void;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Excalidraw-style floating island in the top-left of the host overlay. */
export function initBoardPanel(host: PanelHost): { toggle(): void; hide(): void } {
  const el = document.createElement("div");
  el.id = "board-panel";
  el.hidden = true;
  document.body.append(el);
  let visible = false;
  let renamingId: string | null = null;
  let confirmingDeleteId: string | null = null;

  async function refresh(): Promise<void> {
    const boards = await api.boardList().catch(() => [] as BoardMeta[]);
    if (visible) render(boards);
  }

  function render(boards: BoardMeta[]): void {
    el.replaceChildren();

    const head = document.createElement("div");
    head.className = "bp-head";
    const title = document.createElement("span");
    title.className = "bp-title";
    title.textContent = "Boards";
    const newBtn = document.createElement("button");
    newBtn.className = "bp-new";
    newBtn.type = "button";
    newBtn.textContent = "+ New board";
    newBtn.addEventListener("click", () => void createNew());
    head.append(title, newBtn);
    el.append(head);

    const list = document.createElement("div");
    list.className = "bp-list";
    if (boards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bp-empty";
      empty.textContent = "No boards yet";
      list.append(empty);
    }
    for (const board of boards) {
      list.append(renderRow(board));
    }
    el.append(list);
  }

  function renderRow(board: BoardMeta): HTMLElement {
    const row = document.createElement("div");
    row.className = "bp-row";
    const isActive = host.activeBoardId() === board.id;
    if (isActive) row.classList.add("active");

    if (renamingId === board.id) {
      const input = document.createElement("input");
      input.className = "bp-rename";
      input.value = board.name;
      input.maxLength = 60;
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") input.blur();
        else if (e.key === "Escape") {
          renamingId = null;
          void refresh();
        }
      });
      input.addEventListener("blur", () => {
        const name = input.value.trim();
        renamingId = null;
        if (name && name !== board.name) {
          void api
            .boardRename(board.id, name)
            .catch(() => undefined)
            .then(() => refresh());
        } else {
          void refresh();
        }
      });
      row.append(input);
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
      return row;
    }

    const main = document.createElement("button");
    main.type = "button";
    main.className = "bp-main";
    const name = document.createElement("span");
    name.className = "bp-name";
    name.textContent = board.name || "Untitled board";
    const time = document.createElement("span");
    time.className = "bp-time";
    time.textContent = relativeTime(board.updatedAt);
    main.append(name, time);
    main.addEventListener("click", () => void switchTo(board.id));
    row.append(main);

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "bp-icon";
    rename.title = "Rename";
    rename.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19.5l1.1-3.9L16 5.2a2 2 0 0 1 2.8 2.8L8.4 18.4l-3.9 1.1z"/></svg>';
    rename.addEventListener("click", (e) => {
      e.stopPropagation();
      renamingId = board.id;
      confirmingDeleteId = null;
      void refresh();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "bp-icon bp-delete";
    if (confirmingDeleteId === board.id) {
      del.textContent = "Delete?";
      del.classList.add("confirm");
    } else {
      del.title = "Delete";
      del.textContent = "×";
    }
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirmingDeleteId !== board.id) {
        confirmingDeleteId = board.id;
        void refresh();
        return;
      }
      confirmingDeleteId = null;
      void deleteBoard(board.id);
    });

    row.append(rename, del);
    return row;
  }

  async function switchTo(id: string): Promise<void> {
    if (host.activeBoardId() === id) {
      hide();
      return;
    }
    const board = await api.boardLoad(id).catch(() => null);
    if (board) {
      await host.openBoard(board);
      hide();
    }
  }

  async function createNew(): Promise<void> {
    const board = await api.boardCreate().catch(() => null);
    if (board) {
      await host.openBoard(board);
      renamingId = board.id;
      void refresh();
    }
  }

  async function deleteBoard(id: string): Promise<void> {
    const wasActive = host.activeBoardId() === id;
    host.forgetBoard(id);
    await api.boardDelete(id).catch(() => undefined);
    if (wasActive) {
      const remaining = await api.boardList().catch(() => [] as BoardMeta[]);
      const next = remaining[0]
        ? await api.boardLoad(remaining[0].id).catch(() => null)
        : null;
      const board = next ?? (await api.boardCreate().catch(() => null));
      if (board) await host.openBoard(board);
    }
    void refresh();
  }

  function show(): void {
    if (!host.isHost()) return;
    visible = true;
    el.hidden = false;
    void refresh();
  }

  function hide(): void {
    visible = false;
    renamingId = null;
    confirmingDeleteId = null;
    el.hidden = true;
  }

  function toggle(): void {
    if (visible) hide();
    else show();
  }

  void onBoardPanelToggle(toggle);
  return { toggle, hide };
}
