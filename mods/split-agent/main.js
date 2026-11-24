// Split agent: shows a running agent next to the current pane without restarting it, and sends it back.
// How: terminal.park (drops the pane, the process keeps running), then terminal.keep {place}
// (gives it a pane right/below the focused one). Original places are saved in shared state.
//
// 작성자: kgyujin
// 작성목적: 실행 중인 에이전트 세션을 재시작 없이 현재 화면 옆에 붙이고 원래 자리로 복구
// 작성일: 2026-11-24
// 변경사항 내역:
// - 2026-11-24 | 최초 작성 | 이동, 복구, 언어와 일반 터미널 설정, 창 없는 세션 자동 복구

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, focused, theme, shared, setShared, run, notify, closeOverlay, props, appHome, readTextFile } from "herdr";

const MOVES = "split-agent.moves";
const SHELLS = "split-agent.include_shells";

const TEXT = {
  en: {
    heading: "Show an agent next to this pane (no restart)",
    mine: "Attached agents",
    list: "Agents",
    right: "Right",
    below: "Below",
    back: "Send back",
    here: "This tab",
    busyMove: (n) => `Moving ${n}…`,
    busyBack: "Sending back…",
    status: { blocked: "Needs you", done: "Done", working: "Working", idle: "Idle" },
    title: "Split agent",
    noTarget: "Could not find the agent or the current pane. Nothing was changed.",
    same: "That agent is already in this tab.",
    noPark: "Could not detach the pane. The session is unchanged.",
    noKeep: (a) => `The session has no pane right now. Terminal ${a} is still running.`,
    tabFallback: "Could not attach it beside the pane, so it was put in a new tab. The session is alive.",
    noRecord: "No saved place to return to.",
    recovered: (n) => `${n} had lost its pane and was put in a new tab.`,
  },
  ko: {
    heading: "에이전트를 현재 화면 옆에 붙이기 (재시작 없음)",
    mine: "붙여 둔 세션",
    list: "에이전트",
    right: "오른쪽",
    below: "아래",
    back: "원래 자리로",
    here: "현재 탭",
    busyMove: (n) => `${n} 옮기는 중…`,
    busyBack: "되돌리는 중…",
    status: { blocked: "내 차례", done: "완료", working: "작업 중", idle: "쉬는 중" },
    title: "에이전트 분할",
    noTarget: "대상이나 현재 창을 찾지 못해 아무것도 바꾸지 않았습니다.",
    same: "이미 이 탭에 있는 세션입니다.",
    noPark: "창을 떼지 못했습니다. 세션은 그대로입니다.",
    noKeep: (a) => `지금 창이 없는 상태입니다. 터미널 ${a}는 계속 실행 중입니다.`,
    tabFallback: "옆에 붙이지 못해 새 탭에 두었습니다. 세션은 살아 있습니다.",
    noRecord: "되돌릴 기록이 없습니다.",
    recovered: (n) => `${n}의 창이 없어 새 탭에 붙였습니다.`,
  },
};

const movesList = () => {
  const list = shared(MOVES);
  return Array.isArray(list) ? list : [];
};

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class SplitAgent extends View {
  init(_props, cx) {
    this.busy = null;
    this.message = null;
    this.config = { lang: "en" };
    this.recovering = false;
    this.loadConfig(cx);
    cx.timer.every(2000, (cx) => {
      this.recover(cx);
      cx.notify();
    });
  }

  // <mod folder>/config.json is written by `herdr-split-agent config`. A missing or broken file keeps the defaults.
  loadConfig(cx) {
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${appHome()}/mods/split-agent/config.json`);
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") this.config = { ...this.config, ...parsed };
      } catch { /* defaults */ }
      cx.notify();
    });
  }

  t() {
    return TEXT[this.config.lang] ?? TEXT.en;
  }

  // 기본은 에이전트만. 설정에서 켜면 일반 터미널도 목록에 넣는다.
  candidates() {
    const list = agents();
    if (this.config.includeShells !== true && shared(SHELLS) !== true) return list;
    const known = new Set(list.map((a) => a.address));
    const all = spaces();
    const extra = panes()
      .filter((p) => p.terminal && !known.has(p.terminal))
      .map((p) => {
        const space = all.find((s) => s.tabs.some((t) => t.id === p.tab));
        const tab = space?.tabs.find((t) => t.id === p.tab);
        return { address: p.terminal, pane: p.pane, space: space?.id, space_name: space?.name ?? "", tab: p.tab, tab_name: tab?.name ?? p.title, status: "idle", program: p.program };
      });
    return [...list, ...extra];
  }

  // 조건이 참이 될 때까지 100ms 간격으로 기다린다. 시간 안에 안 되면 false.
  async until(cx, test, ms = 10000) {
    for (let waited = 0; waited < ms; waited += 100) {
      if (test()) return true;
      await cx.sleep(100);
    }
    return test();
  }

  paneOf(address) {
    return panes().find((p) => p.terminal === address) ?? null;
  }

  fail(text) {
    this.busy = null;
    this.message = text;
    notify({ title: this.t().title, body: text, level: "error" });
  }

  // 이 mod가 떼어 낸 뒤 붙이지 못한 세션(앱이나 팝업이 중간에 닫힘)을 새 탭에 다시 붙인다.
  // 기준: 기록이 "pending"이고, 터미널은 살아 있는데 창이 없다. 다른 세션은 건드리지 않는다.
  recover(cx) {
    if (this.busy || this.recovering) return;
    const orphans = movesList().filter((m) => m.pending && !this.paneOf(m.terminal) && terminals().some((x) => x.address === m.terminal && x.state === "live"));
    if (orphans.length === 0) return;
    this.recovering = true;
    cx.spawn(async (cx) => {
      for (const m of orphans) {
        run("terminal.keep", { terminal: m.terminal, place: "tab" });
        if (await this.until(cx, () => this.paneOf(m.terminal) !== null)) {
          setShared(MOVES, movesList().filter((x) => x.terminal !== m.terminal));
          notify({ title: this.t().title, body: this.t().recovered(m.name ?? m.terminal), level: "warning" });
        }
      }
      this.recovering = false;
    });
  }

  // 세션을 현재 화면 옆으로 옮긴다. 실패하면 세션은 원래 자리나 새 탭에 남는다(종료하지 않는다).
  async move(cx, address, direction) {
    const t = this.t();
    const agent = this.candidates().find((a) => a.address === address);
    const here = focused();
    if (!agent || !here?.pane || !here.tab) return this.fail(t.noTarget);
    if (agent.tab === here.tab) return this.fail(t.same);
    const space = spaces().find((s) => s.id === agent.space);
    const tab = space?.tabs.find((x) => x.id === agent.tab);
    const sibling = panes().find((p) => p.tab === agent.tab && p.terminal !== address);
    const record = {
      terminal: address,
      name: agent.tab_name,
      space: agent.space,
      tab: agent.tab,
      tabName: tab?.named ? tab.name : null,
      tabIndex: tab?.index ?? null,
      sibling: sibling?.pane ?? null,
      into: here.tab,
      pending: true,
      at: Date.now(),
    };
    this.busy = t.busyMove(agent.tab_name);
    cx.notify();
    // 1) 창만 뗀다. 안 떼지면 아무것도 하지 않고 끝낸다.
    run("terminal.park", { terminal: address });
    if (!(await this.until(cx, () => this.paneOf(address) === null))) return this.fail(t.noPark);
    // 2) 떼어 낸 직후부터 "붙이는 중" 기록을 남긴다. 중간에 닫혀도 recover()가 새 탭에 붙인다.
    setShared(MOVES, [...movesList().filter((m) => m.terminal !== address), record]);
    run("pane.focus", { pane: here.pane });
    await cx.sleep(150);
    run("terminal.keep", { terminal: address, place: direction });
    if (!(await this.until(cx, () => this.paneOf(address) !== null))) {
      run("terminal.keep", { terminal: address, place: "tab" });
      if (!(await this.until(cx, () => this.paneOf(address) !== null))) return this.fail(t.noKeep(address));
      setShared(MOVES, movesList().filter((m) => m.terminal !== address));
      return this.fail(t.tabFallback);
    }
    setShared(MOVES, movesList().map((m) => (m.terminal === address ? { ...m, pending: false } : m)));
    this.busy = null;
    closeOverlay(props().overlay);
  }

  // 옮긴 세션을 원래 탭으로 돌려보낸다. 원래 탭에 다른 창이 남아 있으면 그 옆으로, 없으면 같은 이름과 순서의 새 탭으로.
  async restore(cx, address) {
    const t = this.t();
    const record = movesList().find((m) => m.terminal === address);
    if (!record) return this.fail(t.noRecord);
    const back = focused();
    this.busy = t.busyBack;
    cx.notify();
    run("terminal.park", { terminal: address });
    if (!(await this.until(cx, () => this.paneOf(address) === null))) return this.fail(t.noPark);
    setShared(MOVES, movesList().map((m) => (m.terminal === address ? { ...m, pending: true } : m)));
    const space = spaces().find((s) => s.id === record.space);
    const tabAlive = space?.tabs.some((x) => x.id === record.tab);
    const sibling = panes().find((p) => p.pane === record.sibling && p.tab === record.tab);
    if (space && tabAlive && sibling) {
      run("tab.select", { id: record.tab });
      await cx.sleep(150);
      run("pane.focus", { pane: sibling.pane });
      await cx.sleep(150);
      run("terminal.keep", { terminal: address, place: "right" });
    } else {
      if (space) run("space.select", { id: record.space });
      await cx.sleep(150);
      run("terminal.keep", { terminal: address, place: "tab" });
    }
    if (!(await this.until(cx, () => this.paneOf(address) !== null))) {
      run("terminal.keep", { terminal: address, place: "tab" });
      if (!(await this.until(cx, () => this.paneOf(address) !== null))) return this.fail(t.noKeep(address));
    }
    const now = this.paneOf(address);
    if (now && !(sibling && tabAlive)) {
      if (record.tabName) run("tab.rename", { id: now.tab, name: record.tabName });
      if (record.tabIndex) run("tab.move", { id: now.tab, index: record.tabIndex });
    }
    setShared(MOVES, movesList().filter((m) => m.terminal !== address));
    // 보던 화면으로 돌아온다.
    if (back?.space) run("space.select", { id: back.space });
    if (back?.tab) run("tab.select", { id: back.tab });
    this.busy = null;
    closeOverlay(props().overlay);
  }

  button(th, id, label, glyph, onClick) {
    return h_flex()
      .id(id)
      .h(24)
      .px(8)
      .gap(5)
      .rounded(6)
      .items_center()
      .flex_none()
      .text_size(11.5)
      .text_color(th.foreground)
      .bg(th.raised)
      .hover((el) => el.bg(th.hover))
      .on_click((_e, cx) => onClick(cx))
      .child(div().text_color(th.muted).child(glyph))
      .child(label);
  }

  row(th, a, here) {
    const t = this.t();
    const color = th[a.status] ?? th.dim;
    const pic = icon(a.program, 14, th.foreground);
    const dim = a.tab === here?.tab;
    return h_flex()
      .id(`row-${a.address}`)
      .px(10)
      .h(36)
      .gap(8)
      .rounded(8)
      .items_center()
      .hover((el) => el.bg(th.hover))
      .child(div().size(7).flex_none().rounded(4).bg(color))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().truncate().text_size(12.5).text_color(dim ? th.dim : th.foreground).child(a.tab_name))
          .child(div().truncate().text_size(10.5).text_color(th.dim).child(`${a.space_name} · ${t.status[a.status] ?? a.status}`)),
      )
      .when(!dim && !this.busy, (el) =>
        el
          .child(this.button(th, `r-${a.address}`, t.right, "→", (cx) => this.move(cx, a.address, "right")))
          .child(this.button(th, `d-${a.address}`, t.below, "↓", (cx) => this.move(cx, a.address, "down"))),
      )
      .when(dim, (el) => el.child(div().text_size(10.5).text_color(th.dim).child(t.here)));
  }

  render(_cx) {
    const th = theme();
    const t = this.t();
    const here = focused();
    const list = this.candidates();
    const live = new Set(terminals().filter((x) => x.state === "live").map((x) => x.address));
    const mine = movesList().filter((m) => live.has(m.terminal) && !m.pending);
    return v_flex()
      .w_full()
      .p(6)
      .gap(2)
      .bg(th.popover)
      .text_size(12.5)
      .text_color(th.foreground)
      .child(div().px(10).pt(4).pb(6).text_size(11).text_color(th.dim).child(t.heading))
      .when(Boolean(this.busy), (el) => el.child(div().px(10).py(8).text_color(th.working).child(this.busy)))
      .when(Boolean(this.message) && !this.busy, (el) => el.child(div().px(10).py(6).text_size(11.5).text_color(th.blocked).child(this.message)))
      .when(mine.length > 0, (el) =>
        el
          .child(div().px(10).pt(6).pb(2).text_size(11).text_color(th.dim).child(t.mine))
          .children(
            mine.map((m) => {
              const a = list.find((x) => x.address === m.terminal);
              return h_flex()
                .id(`mine-${m.terminal}`)
                .px(10)
                .h(34)
                .gap(8)
                .rounded(8)
                .items_center()
                .hover((e) => e.bg(th.hover))
                .child(div().flex_1().min_w(0).truncate().child(a?.tab_name ?? m.name ?? m.terminal))
                .when(!this.busy, (e) => e.child(this.button(th, `u-${m.terminal}`, t.back, "↩", (cx) => this.restore(cx, m.terminal))));
            }),
          ),
      )
      .child(div().px(10).pt(6).pb(2).text_size(11).text_color(th.dim).child(t.list))
      .children(list.filter((a) => !mine.some((m) => m.terminal === a.address)).map((a) => this.row(th, a, here)));
  }
}
