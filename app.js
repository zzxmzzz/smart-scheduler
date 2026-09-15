"use strict";

const STORAGE_KEY = "smart-schedule-state-v1";
const SUPABASE_CONFIG_KEY = "smart-schedule-supabase-config-v1";
const SUPABASE_DEFAULT_CONFIG = {
  url: "https://rlwmgtiuhpfqytqbydhm.supabase.co",
  anonKey: "sb_publishable_neTeg7n23197jpcQ4yEZug_gC0LY4F8",
};
const BASE_DATE = "2026-08-31";
const SHIFT_HOURS = {
  early: 8,
  late: 6.5,
  rest: 0,
};
const SHIFT_META = {
  early: {
    label: "早班",
    short: "早",
    time: "08:00 - 16:00",
    css: "early",
  },
  late: {
    label: "晚班",
    short: "晚",
    time: "16:00 - 22:30",
    css: "late",
  },
  rest: {
    label: "休息",
    short: "休",
    time: "不上班",
    css: "rest",
  },
};
const REQUEST_TYPES = {
  leave: "请假",
  swap: "换班",
  compensatory: "调休",
  holiday: "节假日调整",
};
const HOLIDAY_MODES = {
  all_rest: "全员休息",
  early_only: "保留早班",
  late_only: "保留晚班",
  auto_balance: "自动平衡",
  manual: "手动调整",
};

const DEFAULT_MEMBERS = [
  { id: "leader", code: "L", name: "领导", role: "leader", title: "管理员", email: "leader@example.com" },
  { id: "a", code: "A", name: "张三", role: "employee", title: "员工 A", email: "zhangsan@example.com" },
  { id: "b", code: "B", name: "李四", role: "employee", title: "员工 B", email: "lisi@example.com" },
  { id: "c", code: "C", name: "王五", role: "employee", title: "员工 C", email: "wangwu@example.com" },
];

const CYCLE = [
  { early: "A", late: "C" },
  { early: "C", late: "A" },
  { early: "A", late: "B" },
  { early: "B", late: "A" },
  { early: "A", late: "C" },
  { early: "C", late: "B" },
  { early: "B", late: "C" },
  { early: "C", late: "B" },
  { early: "B", late: "C" },
  { early: "C", late: "A" },
  { early: "A", late: "C" },
  { early: "C", late: "B" },
  { early: "B", late: "A" },
  { early: "A", late: "B" },
  { early: "B", late: "A" },
  { early: "A", late: "B" },
  { early: "B", late: "C" },
  { early: "C", late: "B" },
  { early: "B", late: "A" },
  { early: "A", late: "C" },
  { early: "C", late: "A" },
];

const app = document.getElementById("app");
let state = normalizeState(loadState());
let ui = {
  view: "home",
  weekStart: toISO(startOfWeek(parseISO(todayISO()))),
  selectedDate: todayISO(),
};
let syncStatus = getInitialSyncStatus();
let remoteSaveTimer = null;

render();
setupRemotePolling();

document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
document.addEventListener("submit", handleSubmit);
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    state = normalizeState(JSON.parse(event.newValue));
    render();
  } catch {
    // Ignore invalid external storage writes.
  }
});

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : createDefaultState();
  } catch {
    return createDefaultState();
  }
}

function createDefaultState() {
  return {
    schemaVersion: 2,
    currentUserId: "leader",
    members: DEFAULT_MEMBERS,
    overrides: [],
    leaveRequests: [],
    holidays: [],
    auditLogs: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeState(nextState) {
  nextState = nextState && typeof nextState === "object" ? nextState : {};
  const base = createDefaultState();
  const merged = { ...base, ...nextState };
  merged.schemaVersion = 2;
  merged.members = normalizeMembers(nextState.members);
  merged.overrides = Array.isArray(nextState.overrides) ? nextState.overrides : [];
  merged.leaveRequests = Array.isArray(nextState.leaveRequests) ? nextState.leaveRequests : [];
  merged.holidays = Array.isArray(nextState.holidays) ? nextState.holidays : [];
  merged.auditLogs = Array.isArray(nextState.auditLogs) ? nextState.auditLogs : [];
  if (!getMember(merged.currentUserId, merged)) merged.currentUserId = "leader";
  return merged;
}

function normalizeMembers(nextMembers) {
  const savedMembers = Array.isArray(nextMembers) ? nextMembers : [];
  const savedById = new Map(savedMembers.map((member) => [member.id, member]));
  return DEFAULT_MEMBERS.map((defaultMember) => {
    const saved = savedById.get(defaultMember.id) || {};
    return {
      ...defaultMember,
      name: cleanText(saved.name) || defaultMember.name,
      title: cleanText(saved.title) || defaultMember.title,
      email: normalizeEmail(saved.email) || defaultMember.email,
    };
  });
}

function persistState(options = {}) {
  const { remote = true } = options;
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (remote && canUseRemote()) queueRemoteSave();
}

function render() {
  const user = getCurrentUser();
  app.innerHTML = `
    <div class="app-shell">
      ${renderHeader()}
      <div class="layout">
        <aside class="sidebar">
          ${renderProfileCard(user)}
          ${renderNav("nav-card")}
        </aside>
        <main class="content">
          ${renderMobileTop()}
          ${renderView()}
        </main>
      </div>
      ${renderNav("bottom-nav")}
    </div>
  `;
}

function renderHeader() {
  return `
    <header class="app-header">
      <div class="brand">
        <div class="brand-logo">班</div>
        <div>
          <h1 class="brand-title">小组智能排班</h1>
          <div class="brand-subtitle">自动生成 · 休假审批 · 节假日调整 · 同步部署</div>
        </div>
      </div>
      <div class="header-actions">
        ${renderWeekControl()}
        <button class="sync-pill ${canUseRemote() ? "is-online" : ""}" data-action="sync-now" type="button">
          <span class="sync-dot"></span>
          <span>${escapeHtml(syncStatus)}</span>
        </button>
        <div class="user-select">
          ${renderUserSelect("desktop-user-select")}
        </div>
      </div>
    </header>
  `;
}

function renderMobileTop() {
  return `
    <div class="mobile-top">
      <div>
        <div class="mobile-title">小组智能排班</div>
        <div class="brand-subtitle">${formatDateFull(ui.selectedDate)}</div>
      </div>
      <div class="mobile-user">
        <span class="avatar ${getCurrentUser().role === "leader" ? "leader" : ""}">${avatarText(getCurrentUser())}</span>
        ${renderUserSelect("mobile-user-select")}
      </div>
    </div>
  `;
}

function renderWeekControl() {
  return `
    <div class="week-control">
      <button class="icon-button" data-action="prev-week" type="button" aria-label="上一周">‹</button>
      <div class="week-label">${formatWeekRange(ui.weekStart)}</div>
      <button class="icon-button" data-action="next-week" type="button" aria-label="下一周">›</button>
      <button class="secondary-button" data-action="this-week" type="button">本周</button>
    </div>
  `;
}

function renderUserSelect(id) {
  const authMember = getAuthenticatedMember();
  if (authMember && authMember.role === "employee") {
    return `
      <div class="identity-lock" title="已登录账号，身份已自动锁定">
        <span class="identity-dot"></span>
        <span>${escapeHtml(authMember.name)}</span>
      </div>
    `;
  }
  return renderCustomSelect({
    id,
    value: state.currentUserId,
    action: "switch-user",
    ariaLabel: isLeader() ? "切换查看对象" : "切换当前用户",
    compact: true,
    options: state.members.map((member) => ({
      value: member.id,
      label: member.name,
      note: member.role === "leader" ? "领导账号" : `${member.title}${member.email ? ` · ${member.email}` : ""}`,
    })),
  });
}

function renderCustomSelect({ id, name = "", value = "", options, action = "", ariaLabel = "", compact = false }) {
  const selected = options.find((option) => option.value === value) || options[0];
  const hiddenInput = name
    ? `<input id="${escapeHtml(id)}" type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(selected?.value || "")}" />`
    : "";
  return `
    <div class="custom-select ${compact ? "is-compact" : ""}" data-select-id="${escapeHtml(id)}">
      ${hiddenInput}
      <button
        class="select-trigger"
        data-action="toggle-select"
        data-select-id="${escapeHtml(id)}"
        type="button"
        aria-haspopup="listbox"
        aria-expanded="false"
        ${ariaLabel ? `aria-label="${escapeHtml(ariaLabel)}"` : ""}>
        <span class="select-value">${escapeHtml(selected?.label || "请选择")}</span>
        <span class="select-arrow" aria-hidden="true"></span>
      </button>
      <div class="select-menu" role="listbox" aria-label="${escapeHtml(ariaLabel || "选择菜单")}">
        ${options.map((option) => `
          <button
            class="select-option ${option.value === selected?.value ? "is-selected" : ""}"
            data-action="choose-select"
            data-select-id="${escapeHtml(id)}"
            data-value="${escapeHtml(option.value)}"
            ${action ? `data-select-callback="${escapeHtml(action)}"` : ""}
            type="button"
            role="option"
            aria-selected="${option.value === selected?.value ? "true" : "false"}">
            <span class="select-option-main">${escapeHtml(option.label)}</span>
            ${option.note ? `<span class="select-option-note">${escapeHtml(option.note)}</span>` : ""}
            <span class="select-check" aria-hidden="true">✓</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function getRequestTypeOptions() {
  return [
    { value: "leave", label: REQUEST_TYPES.leave, note: "当天不上班，等待领导审批" },
    { value: "swap", label: REQUEST_TYPES.swap, note: "和同事互换早班或晚班" },
    { value: "compensatory", label: REQUEST_TYPES.compensatory, note: "补休、顺延或临时调休" },
    { value: "holiday", label: REQUEST_TYPES.holiday, note: "节假日产生的排班调整" },
  ];
}

function getHolidayModeOptions() {
  return [
    { value: "all_rest", label: HOLIDAY_MODES.all_rest, note: "早班和晚班都取消" },
    { value: "early_only", label: HOLIDAY_MODES.early_only, note: "只保留早班人员" },
    { value: "late_only", label: HOLIDAY_MODES.late_only, note: "只保留晚班人员" },
    { value: "auto_balance", label: HOLIDAY_MODES.auto_balance, note: "按本周工时自动推荐" },
    { value: "manual", label: HOLIDAY_MODES.manual, note: "领导逐个修改排班" },
  ];
}

function renderProfileCard(user) {
  const stats = getWeekStats(ui.weekStart).find((item) => item.member.id === user.id);
  const isEmployee = user.role === "employee";
  return `
    <section class="profile-card">
      <div class="profile-row">
        <div class="avatar ${user.role === "leader" ? "leader" : ""}">${avatarText(user)}</div>
        <div>
          <div class="profile-name">${escapeHtml(user.name)}</div>
          <div class="profile-role">${user.role === "leader" ? "领导账号" : user.title}</div>
        </div>
      </div>
      <div class="profile-stats">
        <div class="mini-stat"><strong>${isEmployee && stats ? stats.early : "-"}</strong><span>早班</span></div>
        <div class="mini-stat"><strong>${isEmployee && stats ? stats.late : "-"}</strong><span>晚班</span></div>
        <div class="mini-stat"><strong>${isEmployee && stats ? stats.rest : "-"}</strong><span>休息</span></div>
      </div>
    </section>
  `;
}

function renderNav(className) {
  const items = [
    { id: "home", label: "排班", icon: "排" },
    { id: "mine", label: "我的", icon: "我" },
    { id: "requests", label: isLeader() ? "审批" : "申请", icon: "调" },
    { id: "stats", label: "统计", icon: "统" },
    { id: "settings", label: isLeader() ? "管理" : "账号", icon: isLeader() ? "管" : "账" },
  ];
  return `
    <nav class="${className}" aria-label="主导航">
      ${items.map((item) => `
        <button class="nav-button ${ui.view === item.id ? "is-active" : ""}" data-action="nav" data-view="${item.id}" type="button">
          <span class="nav-icon" data-icon="${item.icon}"></span>
          <span>${item.label}</span>
        </button>
      `).join("")}
    </nav>
  `;
}

function renderView() {
  return `
    <section class="view ${ui.view === "home" ? "is-active" : ""}">${renderHome()}</section>
    <section class="view ${ui.view === "mine" ? "is-active" : ""}">${renderMine()}</section>
    <section class="view ${ui.view === "requests" ? "is-active" : ""}">${renderRequests()}</section>
    <section class="view ${ui.view === "stats" ? "is-active" : ""}">${renderStats()}</section>
    <section class="view ${ui.view === "settings" ? "is-active" : ""}">${renderSettings()}</section>
  `;
}

function renderHome() {
  const user = getCurrentUser();
  const today = todayISO();
  const assignments = getDateAssignments(today);
  const myShift = user.role === "employee" ? assignments[user.id] : null;
  const earlyMember = getMemberByShift(assignments, "early");
  const lateMember = getMemberByShift(assignments, "late");
  const restMember = getMemberByShift(assignments, "rest");
  const pendingCount = state.leaveRequests.filter((request) => request.status === "pending").length;
  const leaderMode = isLeader();
  const leaderViewingSelf = leaderMode && user.role === "leader";
  const heroTitle = leaderMode
    ? leaderViewingSelf ? "你好，领导" : `正在查看${user.name}`
    : `你好，${user.name}`;

  return `
    <div class="hero-grid">
      <section class="hero-card">
        <h2>${escapeHtml(heroTitle)}</h2>
        <p>${formatDateFull(today)}</p>
        <div class="today-shift">
          ${leaderViewingSelf
            ? `
              <div class="shift-icon early">今</div>
              <div>
                <div class="today-main">今日排班已生成</div>
                <div class="today-sub">早班 ${employeeName(earlyMember)} · 晚班 ${employeeName(lateMember)} · 休息 ${employeeName(restMember)}</div>
              </div>
            `
            : `
              <div class="shift-icon ${SHIFT_META[myShift].css}">${SHIFT_META[myShift].short}</div>
              <div>
                <div class="today-main">我的排班：${SHIFT_META[myShift].label}</div>
                <div class="today-sub">${SHIFT_META[myShift].time}</div>
              </div>
            `}
        </div>
      </section>
      <section class="action-card">
        <button class="quick-action" data-action="quick-request" type="button">
          <span><strong>${leaderMode ? "处理休假申请" : "提交休假/换班"}</strong><span>${leaderMode ? `${pendingCount} 个待审批事项` : "节假日、临时请假都从这里提交"}</span></span>
          <span>›</span>
        </button>
        <button class="quick-action" data-action="${leaderMode ? "quick-holiday" : "nav"}" data-view="mine" type="button">
          <span><strong>${leaderMode ? "节假日批量调整" : "查看我的排班"}</strong><span>${leaderMode ? "全员休息、保留班次、自动平衡" : "本周和未来 30 天一眼看清"}</span></span>
          <span>›</span>
        </button>
      </section>
    </div>
    <section class="content-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">本周排班</h2>
          <div class="section-subtitle">${formatWeekRange(ui.weekStart)}</div>
        </div>
        ${renderWeekControl()}
      </div>
      ${renderScheduleBoard(ui.weekStart)}
    </section>
    <div class="dashboard-grid">
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">今日团队</h2>
            <div class="section-subtitle">${formatDateShort(today)}</div>
          </div>
        </div>
        ${renderTeamToday(today)}
      </section>
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">排班检测</h2>
            <div class="section-subtitle">自动检查缺班、重复和连续上班</div>
          </div>
        </div>
        ${renderAnomalies(ui.weekStart)}
      </section>
    </div>
  `;
}

function renderScheduleBoard(weekStartIso) {
  const dates = getWeekDates(weekStartIso);
  const employees = getEmployees();
  return `
    <div class="legend">
      <span class="chip early">早班 08:00-16:00</span>
      <span class="chip late">晚班 16:00-22:30</span>
      <span class="chip rest">休息</span>
      <span class="chip pending">橙点为手动调整</span>
    </div>
    <div class="schedule-board">
      <div class="board-grid">
        <div></div>
        ${dates.map((date) => {
          const holiday = getHoliday(date);
          return `
            <div class="date-head">
              <div class="date-main">${formatMonthDay(date)}</div>
              <div class="date-sub">${weekdayName(date)}${holiday ? ` · ${escapeHtml(holiday.name)}` : ""}</div>
            </div>
          `;
        }).join("")}
        ${employees.map((member) => `
          <div class="person-cell">
            <div class="avatar">${avatarText(member)}</div>
            <div>
              <div class="person-name">${escapeHtml(member.name)}</div>
              <div class="person-code">${member.title}</div>
            </div>
          </div>
          ${dates.map((date) => renderBoardCell(date, member)).join("")}
        `).join("")}
      </div>
    </div>
  `;
}

function renderBoardCell(date, member) {
  const assignments = getDateAssignments(date);
  const shift = assignments[member.id] || "rest";
  const meta = SHIFT_META[shift];
  const override = hasOverride(date, member.id);
  const holiday = getHoliday(date);
  const editable = isLeader();
  return `
    <button
      class="day-cell ${meta.css} ${editable ? "can-edit" : ""}"
      data-action="${editable ? "open-edit" : "open-detail"}"
      data-date="${date}"
      data-member="${member.id}"
      type="button"
      aria-label="${escapeHtml(member.name)} ${formatDateShort(date)} ${meta.label}">
      ${holiday ? `<i class="holiday-mark" aria-hidden="true"></i>` : ""}
      ${override ? `<i class="override-mark" aria-hidden="true"></i>` : ""}
      <strong>${meta.label}</strong>
      <span>${meta.time}</span>
    </button>
  `;
}

function renderTeamToday(date) {
  const assignments = getDateAssignments(date);
  return `
    <div class="team-today">
      ${getEmployees().map((member) => {
        const meta = SHIFT_META[assignments[member.id] || "rest"];
        return `
          <div class="team-row">
            <div class="team-person">
              <div class="avatar">${avatarText(member)}</div>
              <div>
                <div class="person-name">${escapeHtml(member.name)}</div>
                <div class="person-code">${member.title}</div>
              </div>
            </div>
            <span class="chip ${meta.css}">${meta.label}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderAnomalies(weekStartIso) {
  const anomalies = getAnomaliesForWeek(weekStartIso);
  if (!anomalies.length) {
    return `<div class="alert ok"><strong>本周暂无异常。</strong><span>每天班次人数都在合理范围内。</span></div>`;
  }
  return `
    <div class="list">
      ${anomalies.map((item) => `<div class="alert"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div>`).join("")}
    </div>
  `;
}

function renderMine() {
  const user = getCurrentUser();
  if (user.role === "leader") {
    return `
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">我的排班</h2>
            <div class="section-subtitle">领导账号不参与轮班，可在顶部切换员工查看个人排班。</div>
          </div>
        </div>
        <div class="empty">切换到张三、李四或王五后，这里会显示个人排班。</div>
      </section>
    `;
  }
  const days = Array.from({ length: 30 }, (_, index) => toISO(addDays(parseISO(todayISO()), index)));
  const stats = getRangeStats(days).find((item) => item.member.id === user.id);
  return `
    <section class="content-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">${escapeHtml(user.name)}的排班</h2>
          <div class="section-subtitle">从今天起未来 30 天</div>
        </div>
      </div>
      <div class="metric-grid">
        <div class="metric-card"><strong>${stats.early}</strong><span>早班</span></div>
        <div class="metric-card"><strong>${stats.late}</strong><span>晚班</span></div>
        <div class="metric-card"><strong>${stats.rest}</strong><span>休息</span></div>
      </div>
    </section>
    <section class="content-card">
      <div class="my-list">
        ${days.map((date) => {
          const shift = getDateAssignments(date)[user.id] || "rest";
          const meta = SHIFT_META[shift];
          const holiday = getHoliday(date);
          return `
            <div class="my-day">
              <div>
                <div class="my-date">${formatMonthDay(date)}</div>
                <div class="my-weekday">${weekdayName(date)}</div>
              </div>
              <div>
                <strong>${meta.label}</strong>
                <div class="section-subtitle">${holiday ? `特殊日期：${escapeHtml(holiday.name)}` : meta.time}</div>
              </div>
              <span class="shift-pill ${meta.css}">${meta.label}</span>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderRequests() {
  return isLeader() ? renderLeaderRequests() : renderEmployeeRequests();
}

function renderEmployeeRequests() {
  const user = getCurrentUser();
  const suggested = recommendReplacement(ui.selectedDate, getDateAssignments(ui.selectedDate)[user.id], user.id);
  const replacementValue = suggested ? suggested.id : "";
  const ownRequests = state.leaveRequests
    .filter((request) => request.memberId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `
    <div class="request-grid">
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">提交申请</h2>
            <div class="section-subtitle">请假、换班、节假日调整都从这里提交。</div>
          </div>
        </div>
        <form class="form-grid" data-action="submit-request">
          <div class="field-row">
            <label for="request-date">日期</label>
            <input id="request-date" name="date" type="date" value="${ui.selectedDate}" required />
          </div>
          <div class="field-row">
            <label>申请类型</label>
            ${renderCustomSelect({
              id: "request-type",
              name: "type",
              value: "leave",
              ariaLabel: "选择申请类型",
              options: getRequestTypeOptions(),
            })}
          </div>
          <div class="field-row">
            <label>建议替班人</label>
            ${renderCustomSelect({
              id: "replacement",
              name: "replacementId",
              value: replacementValue,
              ariaLabel: "选择建议替班人",
              options: [
                { value: "", label: "由领导安排", note: "暂不指定替班人" },
                ...getEmployees().filter((member) => member.id !== user.id).map((member) => ({
                  value: member.id,
                  label: member.name,
                  note: suggested && suggested.id === member.id ? "系统推荐，当天休息" : member.title,
                })),
              ],
            })}
          </div>
          <div class="field-row">
            <label for="reason">原因备注</label>
            <textarea id="reason" name="reason" placeholder="例如：节假日家里有安排，希望当天休息。"></textarea>
          </div>
          <button class="primary-button" type="submit">提交给领导审批</button>
        </form>
      </section>
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">我的申请记录</h2>
            <div class="section-subtitle">审批通过后排班会自动同步。</div>
          </div>
        </div>
        ${renderRequestList(ownRequests)}
      </section>
    </div>
  `;
}

function renderLeaderRequests() {
  const pendingRequests = state.leaveRequests
    .filter((request) => request.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const allRequests = state.leaveRequests
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
  return `
    <div class="request-grid">
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">待审批申请</h2>
            <div class="section-subtitle">通过后系统会生成覆盖记录。</div>
          </div>
        </div>
        ${renderRequestList(pendingRequests, true)}
      </section>
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">节假日调整</h2>
            <div class="section-subtitle">适合国庆、春节或临时放假。</div>
          </div>
        </div>
        <form class="form-grid" data-action="submit-holiday">
          <div class="field-row">
            <label for="holiday-date">日期</label>
            <input id="holiday-date" name="date" type="date" value="${ui.selectedDate}" required />
          </div>
          <div class="field-row">
            <label for="holiday-name">名称</label>
            <input id="holiday-name" name="name" type="text" value="节假日" required />
          </div>
          <div class="field-row">
            <label>处理方式</label>
            ${renderCustomSelect({
              id: "holiday-mode",
              name: "mode",
              value: "all_rest",
              ariaLabel: "选择节假日处理方式",
              options: getHolidayModeOptions(),
            })}
          </div>
          <button class="primary-button" type="submit">应用节假日调整</button>
        </form>
      </section>
    </div>
    <div class="request-grid">
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">最近申请</h2>
            <div class="section-subtitle">包含已通过和已拒绝记录。</div>
          </div>
        </div>
        ${renderRequestList(allRequests)}
      </section>
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">已设置节假日</h2>
            <div class="section-subtitle">可随时移除恢复原轮班。</div>
          </div>
        </div>
        ${renderHolidayList()}
      </section>
    </div>
  `;
}

function renderRequestList(requests, leaderActions = false) {
  if (!requests.length) return `<div class="empty">暂无记录</div>`;
  return `
    <div class="list">
      ${requests.map((request) => {
        const member = getMember(request.memberId);
        const replacement = request.replacementMemberId ? getMember(request.replacementMemberId) : null;
        const statusClass = request.status === "approved" ? "approved" : request.status === "rejected" ? "rejected" : "pending";
        const statusText = request.status === "approved" ? "已通过" : request.status === "rejected" ? "已拒绝" : "待审批";
        return `
          <div class="request-row">
            <div class="request-main">
              <div class="request-title">${employeeName(member)} · ${REQUEST_TYPES[request.type]}</div>
              <div class="request-meta">${formatDateShort(request.date)} · 原排班 ${SHIFT_META[request.originalShift].label}${replacement ? ` · 建议 ${escapeHtml(replacement.name)}替班` : ""}</div>
              ${request.reason ? `<div class="request-meta">备注：${escapeHtml(request.reason)}</div>` : ""}
            </div>
            <div class="request-actions">
              <span class="chip ${statusClass}">${statusText}</span>
              ${leaderActions ? `
                <button class="compact-button ok" data-action="approve-request" data-id="${request.id}" type="button">通过</button>
                <button class="compact-button reject" data-action="reject-request" data-id="${request.id}" type="button">拒绝</button>
              ` : ""}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderHolidayList() {
  const holidays = state.holidays.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!holidays.length) return `<div class="empty">暂无节假日调整</div>`;
  return `
    <div class="list">
      ${holidays.map((holiday) => `
        <div class="holiday-row">
          <div>
            <div class="request-title">${escapeHtml(holiday.name)}</div>
            <div class="request-meta">${formatDateShort(holiday.date)} · ${HOLIDAY_MODES[holiday.mode]}</div>
          </div>
          <button class="compact-button reject" data-action="remove-holiday" data-id="${holiday.id}" type="button">移除</button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderStats() {
  const stats = getWeekStats(ui.weekStart);
  const logs = state.auditLogs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
  return `
    <section class="content-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">本周统计</h2>
          <div class="section-subtitle">${formatWeekRange(ui.weekStart)}</div>
        </div>
        ${renderWeekControl()}
      </div>
      <table class="stat-table">
        <thead>
          <tr>
            <th>人员</th>
            <th>早班</th>
            <th>晚班</th>
            <th>休息</th>
            <th>总工时</th>
          </tr>
        </thead>
        <tbody>
          ${stats.map((item) => `
            <tr>
              <td>${escapeHtml(item.member.name)}</td>
              <td>${item.early}</td>
              <td>${item.late}</td>
              <td>${item.rest}</td>
              <td>${item.hours}h</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
    <div class="dashboard-grid">
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">异常检测</h2>
            <div class="section-subtitle">用于发现节假日或手动调整后的空班。</div>
          </div>
        </div>
        ${renderAnomalies(ui.weekStart)}
      </section>
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">调整记录</h2>
            <div class="section-subtitle">最近 12 条操作。</div>
          </div>
        </div>
        ${renderAuditLogs(logs)}
      </section>
    </div>
  `;
}

function renderAuditLogs(logs) {
  if (!logs.length) return `<div class="empty">暂无调整记录</div>`;
  return `
    <div class="list">
      ${logs.map((log) => `
        <div class="log-row">
          <div>
            <div class="request-title">${escapeHtml(log.title)}</div>
            <div class="request-meta">${formatDateTime(log.createdAt)} · ${escapeHtml(log.detail || "")}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderSettings() {
  const config = loadSupabaseConfig();
  const connected = canUseRemote();
  const actor = getActor();
  const authMember = getAuthenticatedMember();
  const authEmail = getAuthEmail();
  const exportText = escapeHtml(JSON.stringify(state, null, 2));
  return `
    <section class="content-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">${isLeader() ? "管理与同步" : "账号与同步"}</h2>
          <div class="section-subtitle">${connected ? `已登录为 ${escapeHtml(actor.name)}。` : "登录 Supabase 账号后开启多设备同步。"}</div>
        </div>
      </div>
      <p class="settings-note">Supabase Authentication 里的用户是登录账号；这里的人员资料决定页面显示姓名和领导/员工权限，二者通过邮箱自动对应。</p>
      ${renderAccountStatus(authMember, authEmail)}
      <form class="form-grid" data-action="save-supabase">
        <div class="field-row">
          <label for="supabase-url">Supabase URL</label>
          <input id="supabase-url" name="url" type="url" readonly value="${escapeHtml(config.url || "")}" />
        </div>
        <div class="field-row">
          <label for="supabase-key">Supabase publishable key</label>
          <input id="supabase-key" name="anonKey" type="password" readonly value="${escapeHtml(config.anonKey || "")}" />
        </div>
        <div class="field-row">
          <label for="supabase-email">登录邮箱</label>
          <input id="supabase-email" name="email" type="email" placeholder="leader@example.com" value="${escapeHtml(config.email || "")}" autocomplete="username" />
        </div>
        <div class="field-row">
          <label for="supabase-password">登录密码</label>
          <input id="supabase-password" name="password" type="password" placeholder="${connected ? "重新登录或切换账号时再输入" : "输入 Supabase Auth 密码"}" autocomplete="current-password" />
        </div>
        <div class="button-row">
          <button class="primary-button" type="submit">${connected ? "重新登录" : "保存并登录"}</button>
          ${connected ? `<button class="secondary-button" data-action="load-remote" type="button">从云端读取</button>` : ""}
          ${connected && isLeader() ? `<button class="plain-button" data-action="save-remote" type="button">上传当前数据</button>` : ""}
          ${connected ? `<button class="danger-button" data-action="logout-supabase" type="button">退出同步</button>` : ""}
        </div>
      </form>
    </section>
    ${isLeader() ? renderMemberSettings() : `
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">我的账号</h2>
            <div class="section-subtitle">员工登录后系统会自动锁定到自己的身份。</div>
          </div>
        </div>
        <div class="alert ok">
          <strong>${connected ? "已启用账号模式" : "未登录账号"}</strong>
          <span>${connected ? "你只能查看自己的排班、提交自己的申请。" : "请使用领导在 Supabase 中创建的员工邮箱登录。"}</span>
        </div>
      </section>
    `}
    ${isLeader() ? `
      <div class="dashboard-grid">
        <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">数据备份</h2>
            <div class="section-subtitle">导出后可保存，导入会覆盖当前浏览器数据。</div>
          </div>
        </div>
        <div class="button-row">
          <button class="secondary-button" data-action="download-json" type="button">导出 JSON</button>
          <button class="danger-button" data-action="reset-demo" type="button">重置系统</button>
        </div>
        <form class="form-grid" data-action="import-json" style="margin-top: 12px">
          <div class="field-row">
            <label for="import-data">导入 JSON</label>
            <textarea id="import-data" name="payload" placeholder="粘贴导出的 JSON 数据"></textarea>
          </div>
          <button class="plain-button" type="submit">导入数据</button>
        </form>
      </section>
      <section class="content-card">
        <div class="section-head">
          <div>
            <h2 class="section-title">当前数据预览</h2>
            <div class="section-subtitle">用于确认本地状态。</div>
          </div>
        </div>
        <pre class="code-box"><code>${exportText}</code></pre>
      </section>
    </div>
    ` : ""}
  `;
}

function renderAccountStatus(authMember, authEmail) {
  if (!canUseRemote()) {
    return `<div class="alert"><strong>尚未登录</strong><span>先用 Supabase Auth 账号登录；领导登录后可维护人员姓名和邮箱绑定。</span></div>`;
  }
  if (!authMember) {
    return `<div class="alert"><strong>账号未绑定人员</strong><span>${escapeHtml(authEmail || "当前邮箱")} 尚未绑定到领导、张三、李四或王五，请领导在人员与账号里填写这个邮箱。</span></div>`;
  }
  return `
    <div class="account-card">
      <div class="team-person">
        <div class="avatar ${authMember.role === "leader" ? "leader" : ""}">${avatarText(authMember)}</div>
        <div>
          <div class="person-name">${escapeHtml(authMember.name)}</div>
          <div class="person-code">${authMember.role === "leader" ? "领导账号" : authMember.title} · ${escapeHtml(authMember.email)}</div>
        </div>
      </div>
      <span class="chip ok">身份已绑定</span>
    </div>
  `;
}

function renderMemberSettings() {
  return `
    <section class="content-card">
      <div class="section-head">
        <div>
          <h2 class="section-title">人员与账号</h2>
          <div class="section-subtitle">修改显示姓名，并把 Supabase 登录邮箱绑定到对应人员。</div>
        </div>
      </div>
      <form class="form-grid" data-action="save-members">
        <div class="member-settings-list">
          ${state.members.map((member) => `
            <div class="member-edit-row">
              <div class="member-edit-head">
                <div class="avatar ${member.role === "leader" ? "leader" : ""}">${avatarText(member)}</div>
                <div>
                  <div class="person-name">${escapeHtml(member.role === "leader" ? "负责人" : member.title)}</div>
                  <div class="person-code">${member.role === "leader" ? "管理员权限" : `轮班代码 ${member.code}`}</div>
                </div>
              </div>
              <div class="member-edit-fields">
                <div class="field-row">
                  <label for="member-name-${member.id}">显示名称</label>
                  <input id="member-name-${member.id}" name="member-name-${member.id}" type="text" value="${escapeHtml(member.name)}" required />
                </div>
                <div class="field-row">
                  <label for="member-email-${member.id}">登录邮箱</label>
                  <input id="member-email-${member.id}" name="member-email-${member.id}" type="email" value="${escapeHtml(member.email || "")}" placeholder="${escapeHtml(member.email || "name@example.com")}" />
                </div>
              </div>
            </div>
          `).join("")}
        </div>
        <div class="button-row">
          <button class="primary-button" type="submit">保存人员信息</button>
        </div>
      </form>
    </section>
  `;
}

function handleClick(event) {
  if (!event.target.closest(".custom-select")) closeSelectMenus();
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "toggle-select") {
    toggleCustomSelect(target);
    return;
  }
  if (action === "choose-select") {
    chooseCustomSelect(target);
    return;
  }
  if (action === "close-modal") {
    if (!target.classList.contains("modal-backdrop") || event.target === target) closeModal();
    return;
  }
  if (action === "nav") {
    ui.view = target.dataset.view;
    render();
    return;
  }
  if (action === "prev-week") {
    ui.weekStart = toISO(addDays(parseISO(ui.weekStart), -7));
    render();
    return;
  }
  if (action === "next-week") {
    ui.weekStart = toISO(addDays(parseISO(ui.weekStart), 7));
    render();
    return;
  }
  if (action === "this-week") {
    ui.weekStart = toISO(startOfWeek(parseISO(todayISO())));
    ui.selectedDate = todayISO();
    render();
    return;
  }
  if (action === "quick-request") {
    ui.view = "requests";
    render();
    return;
  }
  if (action === "quick-holiday") {
    ui.view = "requests";
    render();
    setTimeout(() => document.getElementById("holiday-date")?.focus(), 30);
    return;
  }
  if (action === "open-edit") {
    openEditModal(target.dataset.member, target.dataset.date);
    return;
  }
  if (action === "open-detail") {
    openDetailModal(target.dataset.member, target.dataset.date);
    return;
  }
  if (action === "save-cell-edit") {
    saveCellEdit(target);
    return;
  }
  if (action === "reset-cell") {
    resetCell(target.dataset.member, target.dataset.date);
    return;
  }
  if (action === "approve-request") {
    approveRequest(target.dataset.id);
    return;
  }
  if (action === "reject-request") {
    rejectRequest(target.dataset.id);
    return;
  }
  if (action === "remove-holiday") {
    removeHoliday(target.dataset.id);
    return;
  }
  if (action === "sync-now") {
    syncNow();
    return;
  }
  if (action === "load-remote") {
    loadRemoteState(true);
    return;
  }
  if (action === "save-remote") {
    saveRemoteState(true);
    return;
  }
  if (action === "logout-supabase") {
    logoutSupabase();
    return;
  }
  if (action === "download-json") {
    downloadJson();
    return;
  }
  if (action === "reset-demo") {
    resetSystem();
  }
}

function handleChange(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  if (target.dataset.action === "switch-user") {
    state.currentUserId = target.value;
    persistState({ remote: false });
    render();
  }
}

function handleSubmit(event) {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  event.preventDefault();
  const action = form.dataset.action;
  const formData = new FormData(form);
  if (action === "submit-request") {
    submitLeaveRequest(formData);
  }
  if (action === "submit-holiday") {
    submitHoliday(formData);
  }
  if (action === "save-supabase") {
    saveSupabaseSettings(formData);
  }
  if (action === "save-members") {
    saveMembers(formData);
  }
  if (action === "import-json") {
    importJson(formData);
  }
}

function openEditModal(memberId, date) {
  const member = getMember(memberId);
  const currentShift = getDateAssignments(date)[memberId] || "rest";
  const defaultShift = getDefaultAssignments(date)[memberId] || "rest";
  openModal(`
    <div class="modal-inner">
      <h2 class="modal-title" id="modal-title">修改排班</h2>
      <p class="modal-desc">${escapeHtml(member.name)} · ${formatDateShort(date)} · 当前 ${SHIFT_META[currentShift].label}</p>
      <div class="alert">
        <strong>原始规则</strong>
        <span>${SHIFT_META[defaultShift].label}。保存后会生成手动覆盖记录，不会破坏 21 天循环。</span>
      </div>
      <div class="field-row" style="margin-top: 14px">
        <label for="edit-reason">调整原因</label>
        <input id="edit-reason" type="text" value="手动调整" />
      </div>
      <div class="shift-choice-grid">
        ${Object.entries(SHIFT_META).map(([shift, meta]) => `
          <button class="shift-choice ${meta.css} ${shift === currentShift ? "is-selected" : ""}" data-action="save-cell-edit" data-member="${memberId}" data-date="${date}" data-shift="${shift}" type="button">
            ${meta.label}<br><span>${meta.time}</span>
          </button>
        `).join("")}
      </div>
      <div class="button-row">
        <button class="plain-button" data-action="reset-cell" data-member="${memberId}" data-date="${date}" type="button">恢复默认</button>
        <button class="danger-button" data-action="close-modal" type="button">取消</button>
      </div>
    </div>
  `);
}

function openDetailModal(memberId, date) {
  const member = getMember(memberId);
  const shift = getDateAssignments(date)[memberId] || "rest";
  const meta = SHIFT_META[shift];
  const holiday = getHoliday(date);
  openModal(`
    <div class="modal-inner">
      <h2 class="modal-title" id="modal-title">排班详情</h2>
      <p class="modal-desc">${escapeHtml(member.name)} · ${formatDateShort(date)}</p>
      <div class="today-shift">
        <div class="shift-icon ${meta.css}">${meta.short}</div>
        <div>
          <div class="today-main">${meta.label}</div>
          <div class="today-sub">${holiday ? `特殊日期：${escapeHtml(holiday.name)}` : meta.time}</div>
        </div>
      </div>
      <div class="button-row" style="margin-top: 16px">
        <button class="primary-button" data-action="close-modal" type="button">知道了</button>
      </div>
    </div>
  `);
}

function openModal(html) {
  closeModal();
  const template = document.getElementById("modal-template");
  const node = template.content.firstElementChild.cloneNode(true);
  node.querySelector("#modal-content").innerHTML = html;
  document.body.appendChild(node);
}

function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
}

function toggleCustomSelect(button) {
  const root = button.closest(".custom-select");
  if (!root) return;
  const wasOpen = root.classList.contains("is-open");
  closeSelectMenus(root);
  root.classList.toggle("is-open", !wasOpen);
  button.setAttribute("aria-expanded", String(!wasOpen));
}

function chooseCustomSelect(button) {
  const root = button.closest(".custom-select");
  if (!root) return;
  const value = button.dataset.value || "";
  const main = button.querySelector(".select-option-main");
  const input = root.querySelector('input[type="hidden"]');
  const display = root.querySelector(".select-value");
  if (input) input.value = value;
  if (display && main) display.textContent = main.textContent;
  root.querySelectorAll(".select-option").forEach((option) => {
    const selected = option === button;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-selected", selected ? "true" : "false");
  });
  closeSelectMenus();

  if (button.dataset.selectCallback === "switch-user") {
    state.currentUserId = value;
    persistState({ remote: false });
    render();
  }
}

function closeSelectMenus(except = null) {
  document.querySelectorAll(".custom-select.is-open").forEach((select) => {
    if (select === except) return;
    select.classList.remove("is-open");
    select.querySelector(".select-trigger")?.setAttribute("aria-expanded", "false");
  });
}

function saveCellEdit(button) {
  if (!isLeader()) {
    showToast("只有领导账号可以修改排班");
    return;
  }
  const member = getMember(button.dataset.member);
  const date = button.dataset.date;
  const shift = button.dataset.shift;
  const reason = document.getElementById("edit-reason")?.value.trim() || "手动调整";
  addOverride({
    date,
    memberId: member.id,
    shift,
    reason,
    source: "manual",
  });
  addLog("手动修改排班", `${member.name} ${formatDateShort(date)} 改为${SHIFT_META[shift].label}`);
  closeModal();
  persistState();
  render();
  showToast("排班已更新");
}

function resetCell(memberId, date) {
  if (!isLeader()) return;
  const before = state.overrides.length;
  state.overrides = state.overrides.filter((item) => !(item.memberId === memberId && item.date === date));
  if (before !== state.overrides.length) {
    addLog("恢复默认排班", `${employeeName(getMember(memberId))} ${formatDateShort(date)} 已恢复`);
  }
  closeModal();
  persistState();
  render();
  showToast("已恢复默认排班");
}

function submitLeaveRequest(formData) {
  const user = getCurrentUser();
  if (user.role !== "employee") {
    showToast("领导账号无需提交个人申请");
    return;
  }
  const date = formData.get("date");
  const type = formData.get("type");
  const replacementId = formData.get("replacementId") || "";
  const reason = String(formData.get("reason") || "").trim();
  const originalShift = getDateAssignments(date)[user.id] || "rest";
  state.leaveRequests.push({
    id: makeId("req"),
    date,
    memberId: user.id,
    type,
    originalShift,
    replacementMemberId: replacementId,
    reason,
    status: "pending",
    createdAt: new Date().toISOString(),
    reviewedAt: "",
    reviewedBy: "",
  });
  addLog("提交申请", `${user.name} ${formatDateShort(date)} 申请${REQUEST_TYPES[type]}`);
  persistState();
  render();
  showToast("申请已提交，等待领导审批");
}

function approveRequest(id) {
  if (!isLeader()) return;
  const request = state.leaveRequests.find((item) => item.id === id);
  if (!request || request.status !== "pending") return;
  const applicant = getMember(request.memberId);
  const replacement = request.replacementMemberId
    ? getMember(request.replacementMemberId)
    : recommendReplacement(request.date, request.originalShift, request.memberId);
  request.status = "approved";
  request.reviewedAt = new Date().toISOString();
  request.reviewedBy = getActorId();
  addOverride({
    date: request.date,
    memberId: request.memberId,
    shift: "rest",
    reason: `${REQUEST_TYPES[request.type]}通过`,
    source: "leave",
  });
  if (request.originalShift !== "rest" && replacement && replacement.id !== request.memberId) {
    request.replacementMemberId = replacement.id;
    addOverride({
      date: request.date,
      memberId: replacement.id,
      shift: request.originalShift,
      reason: `替${applicant.name}${SHIFT_META[request.originalShift].label}`,
      source: "leave",
    });
  }
  addLog("审批通过", `${applicant.name} ${formatDateShort(request.date)} ${REQUEST_TYPES[request.type]}已通过`);
  persistState();
  render();
  showToast("已通过并同步排班");
}

function rejectRequest(id) {
  if (!isLeader()) return;
  const request = state.leaveRequests.find((item) => item.id === id);
  if (!request || request.status !== "pending") return;
  request.status = "rejected";
  request.reviewedAt = new Date().toISOString();
  request.reviewedBy = getActorId();
  addLog("审批拒绝", `${employeeName(getMember(request.memberId))} ${formatDateShort(request.date)} 申请已拒绝`);
  persistState();
  render();
  showToast("已拒绝申请");
}

function submitHoliday(formData) {
  if (!isLeader()) return;
  const date = formData.get("date");
  const name = String(formData.get("name") || "节假日").trim();
  const mode = formData.get("mode");
  const existing = getHoliday(date);
  if (existing) {
    existing.name = name;
    existing.mode = mode;
    existing.updatedAt = new Date().toISOString();
  } else {
    state.holidays.push({
      id: makeId("hol"),
      date,
      name,
      mode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  state.overrides = state.overrides.filter((item) => !(item.date === date && item.source === "holiday"));
  if (mode === "auto_balance") {
    const balanced = getBalancedAssignments(date);
    Object.entries(balanced).forEach(([memberId, shift]) => {
      addOverride({
        date,
        memberId,
        shift,
        reason: `${name}自动平衡`,
        source: "holiday",
      });
    });
  }
  addLog("节假日调整", `${formatDateShort(date)} ${name} 使用${HOLIDAY_MODES[mode]}`);
  persistState();
  render();
  showToast("节假日调整已应用");
}

function removeHoliday(id) {
  if (!isLeader()) return;
  const holiday = state.holidays.find((item) => item.id === id);
  if (!holiday) return;
  state.holidays = state.holidays.filter((item) => item.id !== id);
  state.overrides = state.overrides.filter((item) => !(item.date === holiday.date && item.source === "holiday"));
  addLog("移除节假日", `${formatDateShort(holiday.date)} 已恢复原排班`);
  persistState();
  render();
  showToast("已移除节假日调整");
}

function saveMembers(formData) {
  if (!isLeader()) {
    showToast("只有领导账号可以维护人员信息");
    return;
  }

  const nextMembers = state.members.map((member) => ({
    ...member,
    name: cleanText(formData.get(`member-name-${member.id}`)) || member.name,
    email: normalizeEmail(formData.get(`member-email-${member.id}`)),
  }));
  const emails = nextMembers.map((member) => member.email).filter(Boolean);
  const duplicatedEmail = emails.find((email, index) => emails.indexOf(email) !== index);
  if (duplicatedEmail) {
    showToast(`邮箱重复：${duplicatedEmail}`);
    return;
  }

  state.members = nextMembers;
  applyAuthenticatedIdentity();
  addLog("更新人员信息", "已修改显示姓名或账号绑定邮箱");
  persistState();
  render();
  showToast("人员信息已保存并同步");
}

function addOverride(partial) {
  state.overrides.push({
    id: makeId("ovr"),
    createdAt: new Date().toISOString(),
    createdBy: getActorId(),
    ...partial,
  });
}

function addLog(title, detail) {
  state.auditLogs.push({
    id: makeId("log"),
    title,
    detail,
    createdAt: new Date().toISOString(),
    createdBy: getActorId(),
  });
}

function getDateAssignments(date) {
  let assignments = getDefaultAssignments(date);
  const holiday = getHoliday(date);
  if (holiday) {
    assignments = applyHolidayMode(assignments, holiday.mode);
  }
  state.overrides
    .filter((override) => override.date === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach((override) => {
      assignments[override.memberId] = override.shift;
    });
  return assignments;
}

function getDefaultAssignments(date) {
  const employees = getEmployees();
  const codeMap = Object.fromEntries(employees.map((member) => [member.code, member.id]));
  const offset = positiveModulo(daysBetween(BASE_DATE, date), CYCLE.length);
  const pattern = CYCLE[offset];
  const assignments = {};
  employees.forEach((member) => {
    assignments[member.id] = "rest";
  });
  assignments[codeMap[pattern.early]] = "early";
  assignments[codeMap[pattern.late]] = "late";
  return assignments;
}

function applyHolidayMode(assignments, mode) {
  const next = { ...assignments };
  if (mode === "all_rest") {
    getEmployees().forEach((member) => {
      next[member.id] = "rest";
    });
  }
  if (mode === "early_only") {
    getEmployees().forEach((member) => {
      if (next[member.id] === "late") next[member.id] = "rest";
    });
  }
  if (mode === "late_only") {
    getEmployees().forEach((member) => {
      if (next[member.id] === "early") next[member.id] = "rest";
    });
  }
  return next;
}

function getBalancedAssignments(date) {
  const employees = getEmployees();
  const weekStart = toISO(startOfWeek(parseISO(date)));
  const dates = getWeekDates(weekStart).filter((item) => item !== date);
  const counts = Object.fromEntries(employees.map((member) => [member.id, { work: 0, early: 0, late: 0 }]));
  dates.forEach((day) => {
    const assignments = getDateAssignments(day);
    employees.forEach((member) => {
      const shift = assignments[member.id];
      if (shift !== "rest") counts[member.id].work += 1;
      if (shift === "early") counts[member.id].early += 1;
      if (shift === "late") counts[member.id].late += 1;
    });
  });
  const earlyMember = employees.slice().sort((a, b) => counts[a.id].early - counts[b.id].early || counts[a.id].work - counts[b.id].work)[0];
  const lateMember = employees
    .filter((member) => member.id !== earlyMember.id)
    .sort((a, b) => counts[a.id].late - counts[b.id].late || counts[a.id].work - counts[b.id].work)[0];
  return Object.fromEntries(employees.map((member) => {
    if (member.id === earlyMember.id) return [member.id, "early"];
    if (member.id === lateMember.id) return [member.id, "late"];
    return [member.id, "rest"];
  }));
}

function hasOverride(date, memberId) {
  return state.overrides.some((override) => override.date === date && override.memberId === memberId);
}

function getHoliday(date) {
  return state.holidays.find((holiday) => holiday.date === date);
}

function getWeekStats(weekStartIso) {
  return getRangeStats(getWeekDates(weekStartIso));
}

function getRangeStats(dates) {
  return getEmployees().map((member) => {
    const counts = { member, early: 0, late: 0, rest: 0, hours: 0 };
    dates.forEach((date) => {
      const shift = getDateAssignments(date)[member.id] || "rest";
      counts[shift] += 1;
      counts.hours += SHIFT_HOURS[shift];
    });
    counts.hours = Number(counts.hours.toFixed(1));
    return counts;
  });
}

function getAnomaliesForWeek(weekStartIso) {
  const anomalies = [];
  getWeekDates(weekStartIso).forEach((date) => {
    const assignments = getDateAssignments(date);
    const holiday = getHoliday(date);
    const earlyCount = countShift(assignments, "early");
    const lateCount = countShift(assignments, "late");
    const allowNoEarly = holiday && ["all_rest", "late_only"].includes(holiday.mode);
    const allowNoLate = holiday && ["all_rest", "early_only"].includes(holiday.mode);
    if (earlyCount !== 1 && !(allowNoEarly && earlyCount === 0)) {
      anomalies.push({
        title: `${formatDateShort(date)} 早班异常`,
        detail: `当前早班人数为 ${earlyCount} 人。`,
      });
    }
    if (lateCount !== 1 && !(allowNoLate && lateCount === 0)) {
      anomalies.push({
        title: `${formatDateShort(date)} 晚班异常`,
        detail: `当前晚班人数为 ${lateCount} 人。`,
      });
    }
  });
  getEmployees().forEach((member) => {
    let streak = 0;
    getWeekDates(weekStartIso).forEach((date) => {
      const shift = getDateAssignments(date)[member.id] || "rest";
      streak = shift === "rest" ? 0 : streak + 1;
      if (streak > 5) {
        anomalies.push({
          title: `${member.name} 连续上班较多`,
          detail: `截至 ${formatDateShort(date)} 已连续上班 ${streak} 天。`,
        });
      }
    });
  });
  return anomalies;
}

function countShift(assignments, shift) {
  return Object.values(assignments).filter((value) => value === shift).length;
}

function recommendReplacement(date, shift, applicantId) {
  if (!shift || shift === "rest") return null;
  const assignments = getDateAssignments(date);
  const weekStats = getWeekStats(toISO(startOfWeek(parseISO(date))));
  return getEmployees()
    .filter((member) => member.id !== applicantId && assignments[member.id] === "rest")
    .sort((a, b) => {
      const statA = weekStats.find((item) => item.member.id === a.id);
      const statB = weekStats.find((item) => item.member.id === b.id);
      return statA[shift] - statB[shift] || statA.hours - statB.hours;
    })[0] || null;
}

function getMemberByShift(assignments, shift) {
  const id = Object.entries(assignments).find(([, value]) => value === shift)?.[0];
  return id ? getMember(id) : null;
}

function getCurrentUser() {
  const authMember = getAuthenticatedMember();
  if (authMember && authMember.role === "employee") return authMember;
  return getMember(state.currentUserId) || state.members[0];
}

function getMember(id, source = state) {
  return source.members.find((member) => member.id === id);
}

function getMemberByEmail(email, source = state) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  return source.members.find((member) => normalizeEmail(member.email) === normalizedEmail) || null;
}

function getAuthenticatedMember() {
  if (!canUseRemote()) return null;
  return getMemberByEmail(getAuthEmail());
}

function getActor() {
  return getAuthenticatedMember() || getCurrentUser();
}

function getActorId() {
  return getActor().id;
}

function applyAuthenticatedIdentity(force = false) {
  const authMember = getAuthenticatedMember();
  if (!authMember) return;
  if (force || authMember.role === "employee" || !getMember(state.currentUserId)) {
    state.currentUserId = authMember.id;
  }
}

function getEmployees() {
  return state.members.filter((member) => member.role === "employee");
}

function isLeader() {
  return getActor().role === "leader";
}

function employeeName(member) {
  return member ? member.name : "未安排";
}

function avatarText(member) {
  return member.name.slice(0, 1);
}

function todayISO() {
  return toISO(new Date());
}

function parseISO(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date) {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function getWeekDates(weekStartIso) {
  const start = parseISO(weekStartIso);
  return Array.from({ length: 7 }, (_, index) => toISO(addDays(start, index)));
}

function daysBetween(startIso, endIso) {
  return Math.round((parseISO(endIso) - parseISO(startIso)) / 86400000);
}

function positiveModulo(value, size) {
  return ((value % size) + size) % size;
}

function formatWeekRange(weekStartIso) {
  const dates = getWeekDates(weekStartIso);
  return `${formatMonthDay(dates[0])} - ${formatMonthDay(dates[6])}`;
}

function formatMonthDay(iso) {
  const date = parseISO(iso);
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function formatDateShort(iso) {
  return `${formatMonthDay(iso)} ${weekdayName(iso)}`;
}

function formatDateFull(iso) {
  const date = parseISO(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdayName(iso)}`;
}

function weekdayName(iso) {
  const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return names[parseISO(iso).getDay()];
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}.${day} ${hour}:${minute}`;
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `smart-schedule-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importJson(formData) {
  const payload = String(formData.get("payload") || "").trim();
  if (!payload) {
    showToast("请先粘贴 JSON 数据");
    return;
  }
  try {
    state = normalizeState(JSON.parse(payload));
    persistState();
    render();
    showToast("数据已导入");
  } catch {
    showToast("JSON 格式不正确");
  }
}

function resetSystem() {
  const confirmed = window.confirm("确定要重置为初始排班系统吗？当前本地申请和调整记录会清空。");
  if (!confirmed) return;
  state = createDefaultState();
  persistState();
  render();
  showToast("系统已重置");
}

function loadSupabaseConfig() {
  try {
    const saved = localStorage.getItem(SUPABASE_CONFIG_KEY);
    const savedConfig = saved ? JSON.parse(saved) : {};
    return {
      ...SUPABASE_DEFAULT_CONFIG,
      ...savedConfig,
      url: savedConfig.url || SUPABASE_DEFAULT_CONFIG.url,
      anonKey: savedConfig.anonKey || SUPABASE_DEFAULT_CONFIG.anonKey,
    };
  } catch {
    return { ...SUPABASE_DEFAULT_CONFIG };
  }
}

function getAuthEmail() {
  const config = loadSupabaseConfig();
  return config.accessToken ? normalizeEmail(config.email) : "";
}

function saveSupabaseConfig(config) {
  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(config));
}

function canUseRemote() {
  const config = loadSupabaseConfig();
  return Boolean(config.url && config.anonKey && config.accessToken);
}

function hasSupabaseProject() {
  const config = loadSupabaseConfig();
  return Boolean(config.url && config.anonKey);
}

function getInitialSyncStatus() {
  if (canUseRemote()) return "已连接";
  if (hasSupabaseProject()) return "未登录";
  return "本地模式";
}

async function saveSupabaseSettings(formData) {
  const url = String(formData.get("url") || "").trim().replace(/\/$/, "");
  const anonKey = String(formData.get("anonKey") || "").trim();
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") || "");
  if (!url || !anonKey || !email) {
    showToast("请填写 Supabase URL、publishable key 和邮箱");
    return;
  }
  const existingConfig = loadSupabaseConfig();
  const config = { ...existingConfig, url, anonKey, email };
  if (password) {
    try {
      syncStatus = "登录中";
      render();
      const session = await supabaseSignIn(url, anonKey, email, password);
      config.accessToken = session.access_token;
      config.refreshToken = session.refresh_token;
      config.email = normalizeEmail(session.user?.email || email);
      saveSupabaseConfig(config);
      applyAuthenticatedIdentity(true);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      syncStatus = "已连接";
      if (isLeader()) {
        await saveRemoteState(false);
      } else {
        await loadRemoteState(false, true);
      }
      render();
      const authMember = getAuthenticatedMember();
      showToast(authMember ? `已登录为${authMember.name}` : "登录成功，请让领导绑定这个邮箱");
    } catch (error) {
      syncStatus = "连接失败";
      render();
      showToast(error.message || "Supabase 登录失败");
    }
  } else {
    if (normalizeEmail(existingConfig.email) !== email) {
      delete config.accessToken;
      delete config.refreshToken;
    }
    saveSupabaseConfig(config);
    syncStatus = canUseRemote() ? "已连接" : "已保存配置";
    render();
    showToast("配置已保存");
  }
}

async function supabaseSignIn(url, anonKey, email, password) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(body.error_description || body.message || "登录失败");
  }
  return body;
}

async function syncNow() {
  if (!canUseRemote()) {
    ui.view = "settings";
    render();
    showToast("请先登录 Supabase 同步账号");
    return;
  }
  if (isLeader()) {
    await saveRemoteState(false);
  } else {
    await loadRemoteState(false, true);
  }
  render();
  showToast("同步完成");
}

function logoutSupabase() {
  const config = loadSupabaseConfig();
  delete config.accessToken;
  delete config.refreshToken;
  saveSupabaseConfig(config);
  syncStatus = hasSupabaseProject() ? "未登录" : "本地模式";
  render();
  showToast("已退出云端同步");
}

function queueRemoteSave() {
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => saveRemoteState(false), 800);
}

function getRemoteStatePayload() {
  const { currentUserId, ...remoteState } = state;
  return remoteState;
}

async function saveRemoteState(showResult = true) {
  if (!canUseRemote()) {
    if (showResult) showToast("请先连接 Supabase");
    return;
  }
  const config = loadSupabaseConfig();
  try {
    syncStatus = "同步中";
    render();
    const response = await supabaseRequest("/rest/v1/schedule_app_state?on_conflict=id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        id: "main",
        state: getRemoteStatePayload(),
      }),
    }, config);
    if (!response.ok) {
      const body = await readJsonResponse(response);
      throw new Error(body.message || "云端保存失败");
    }
    syncStatus = "已连接";
    if (showResult) showToast("已上传到 Supabase");
  } catch (error) {
    syncStatus = "同步失败";
    if (showResult) showToast(error.message || "云端保存失败");
  } finally {
    render();
  }
}

async function loadRemoteState(showResult = true, force = false) {
  if (!canUseRemote()) {
    if (showResult) showToast("请先连接 Supabase");
    return;
  }
  const config = loadSupabaseConfig();
  try {
    syncStatus = "读取中";
    render();
    const localUserId = state.currentUserId;
    const response = await supabaseRequest("/rest/v1/schedule_app_state?id=eq.main&select=state,updated_at&limit=1", {
      method: "GET",
    }, config);
    const body = await readJsonResponse(response);
    if (!response.ok) throw new Error(body.message || "云端读取失败");
    if (Array.isArray(body) && body[0]?.state) {
      const remoteState = normalizeState(body[0].state);
      if (force || !state.updatedAt || remoteState.updatedAt >= state.updatedAt || showResult) {
        state = remoteState;
        state.currentUserId = localUserId;
        applyAuthenticatedIdentity();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    }
    syncStatus = "已连接";
    if (showResult) showToast("已读取云端数据");
  } catch (error) {
    syncStatus = "读取失败";
    if (showResult) showToast(error.message || "云端读取失败");
  } finally {
    render();
  }
}

async function supabaseRequest(path, options, config) {
  return fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.accessToken}`,
      ...(options.headers || {}),
    },
  });
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function setupRemotePolling() {
  if (canUseRemote()) loadRemoteState(false);
  setInterval(() => {
    if (canUseRemote()) loadRemoteState(false);
  }, 30000);
}
