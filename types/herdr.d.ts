// The part of Herdr's mod API that mods/cc-accounts uses, for `tsc --checkJs`.
//
// Herdr writes the complete declarations (`gpui-kit.d.ts`) next to a mod each time it loads one, and asks for
// them to stay out of Git, so the CI cannot read them. This file declares only what the mod calls, with the
// signatures of Herdr's `herdr`, `gpui-kit` and `gpui-base` modules. A style method of an element takes any
// arguments here; Herdr's own declarations check them, and `herdr-app check` is the proof that the mod loads.

declare module "gpui-kit" {
  export interface Cx {
    notify(): void;
    sleep(ms: number): Promise<void>;
    spawn<T>(task: (cx: Cx) => Promise<T>): Promise<T>;
    stop_propagation(): void;
    timer: { every(ms: number, tick: (cx: Cx) => void): void };
  }

  type Child = Element | string;
  type Styled<Keys extends string> = { [Key in Keys]: (...args: unknown[]) => Element };

  export type Element = Styled<
    | "bg"
    | "border"
    | "border_1"
    | "border_b"
    | "border_color"
    | "border_l"
    | "border_t"
    | "cursor_pointer"
    | "flex"
    | "flex_1"
    | "flex_none"
    | "font_bold"
    | "font_family"
    | "font_medium"
    | "font_semibold"
    | "gap"
    | "h"
    | "id"
    | "items_center"
    | "justify_center"
    | "justify_end"
    | "mb"
    | "min_h"
    | "min_w"
    | "ml"
    | "mr"
    | "mx"
    | "overflow_hidden"
    | "overflow_y_scroll"
    | "pb"
    | "pl"
    | "pr"
    | "pt"
    | "px"
    | "py"
    | "rounded"
    | "rounded_full"
    | "size"
    | "size_full"
    | "text_color"
    | "text_size"
    | "tooltip"
    | "truncate"
    | "w"
  > & {
    child(child: Child): Element;
    children(children: Child[]): Element;
    when(condition: boolean, build: (element: Element) => Element): Element;
    hover(style: (element: Element) => Element): Element;
    active(style: (element: Element) => Element): Element;
    on_click(handler: (event: unknown, cx: Cx) => void): Element;
    on_mouse_down(button: "left" | "right", handler: (event: unknown, cx: Cx) => void): Element;
  };

  export function div(): Element;
  export function svg(path: string): Element;

  export abstract class View {
    init(props: unknown, cx: Cx): void;
    abstract render(cx: Cx): Element;
  }
}

declare module "gpui-base" {
  import type { Element } from "gpui-kit";
  export function v_flex(): Element;
  export function h_flex(): Element;
}

declare module "herdr" {
  export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
  }
  export function exec(
    command: string,
    args?: string[],
    options?: { cwd?: string; on?: string | null; timeout?: number },
  ): Promise<ExecResult>;
  export function home(): string;
  export function appHome(): string;
  export function checking(): boolean;
  export function readTextFile(path: string, options?: { on?: string | null }): Promise<string | null>;
  export function run(name: string, args?: Record<string, unknown>): null;

  export type Status = "working" | "blocked" | "done" | "idle";

  export interface TabInfo {
    id: string;
    name: string;
  }
  export interface SpaceInfo {
    id: string;
    name: string;
    machine: string | null;
    tabs: TabInfo[];
  }
  export function spaces(): SpaceInfo[];

  export interface PaneInfo {
    pane: string;
    terminal: string | null;
    tab: string;
    title: string;
    cwd: string | null;
    status: Status | null;
  }
  export function panes(): PaneInfo[];

  export interface TerminalInfo {
    address: string;
    foreground?: { name?: string; argv?: string[] | string | null; pid?: number } | null;
    [key: string]: unknown;
  }
  export function terminals(): TerminalInfo[];

  export interface Focus {
    space: string;
    tab: string;
    pane: string | null;
    terminal: string | null;
    agent: string | null;
    cwd: string | null;
  }
  export function focused(): Focus | null;
  export function layout(): unknown;
  export function theme(): Record<string, string>;
  export function settings(): Record<string, unknown>;

  export interface OverlaySpec {
    mod?: string;
    props?: Record<string, unknown>;
    kind?: "dialog" | "popup" | "window";
    width?: number;
    height?: number;
  }
  export function openOverlay(spec: OverlaySpec): string;
  export function closeOverlay(id: string): null;
  export function props(): any;
  export function shared(key: string): any;
  export function setShared(key: string, value: unknown): null;
}

declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};
