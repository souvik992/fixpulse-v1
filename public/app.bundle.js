(() => {
  // public/app.js
  var { useState, useEffect, useRef, useCallback } = React;
  var API = "";
  var BRAND_LOGO = "/fixpulse-logo.png";
  var Token = {
    get: () => localStorage.getItem("bt_token"),
    set: (t) => {
      localStorage.setItem("bt_token", t);
      document.cookie = `bt_has_token=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    },
    clear: () => {
      localStorage.removeItem("bt_token");
      document.cookie = "bt_has_token=; path=/; max-age=0; SameSite=Lax";
    }
  };
  if (Token.get()) {
    document.cookie = `bt_has_token=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }
  var authHeaders = () => {
    const t = Token.get();
    return { "Content-Type": "application/json", ...t ? { Authorization: `Bearer ${t}` } : {} };
  };
  var api = {
    get: (url) => fetch(API + url, { headers: authHeaders() }).then((r) => r.json()),
    post: (url, body) => fetch(API + url, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) }).then((r) => r.json()),
    put: (url, body) => fetch(API + url, { method: "PUT", headers: authHeaders(), body: JSON.stringify(body) }).then((r) => r.json()),
    delete: (url) => fetch(API + url, { method: "DELETE", headers: authHeaders() }).then((r) => r.json())
  };
  var statusBadge = (s) => ({ "To Do": "badge-status-todo", "In Progress": "badge-status-inprogress", "In Review": "badge-status-inreview", "Done": "badge-status-done" })[s] || "badge-status-todo";
  var priorityBadge = (p) => ({ Critical: "badge-priority-critical", High: "badge-priority-high", Medium: "badge-priority-medium", Low: "badge-priority-low" })[p] || "badge-priority-medium";
  var typeBadge = (t) => ({ Bug: "badge-type-bug", Feature: "badge-type-feature", Task: "badge-type-task", Improvement: "badge-type-improvement" })[t] || "badge-type-task";
  var priorityIcon = (p) => ({ Critical: "\u{1F534}", High: "\u{1F7E0}", Medium: "\u{1F7E1}", Low: "\u{1F535}" })[p] || "";
  var typeIcon = (t) => ({ Bug: "\u{1F41B}", Feature: "\u2728", Task: "\u{1F4CB}", Improvement: "\u26A1" })[t] || "";
  var statusIcon = (s) => ({ "To Do": "\u25CB", "In Progress": "\u25D1", "In Review": "\u25D5", "Done": "\u25CF" })[s] || "\u25CB";
  var timeAgo = (ts) => {
    const d = Math.floor((Date.now() - new Date(ts)) / 1e3);
    if (d < 60) return "just now";
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
    return `${Math.floor(d / 86400)}d ago`;
  };
  var formatDate = (ts) => ts ? new Date(ts).toLocaleDateString("en-GB") : "\u2014";
  var formatDateTime = (ts) => ts ? new Date(ts).toLocaleString("en-GB") : "Unavailable";
  var isSheetImportedBug = (bug) => bug?.sourceKind === "google_sheet" || Boolean(getMetadataValue(bug?.description, "Source Tab"));
  var getIssueCreatedDate = (bug) => isSheetImportedBug(bug) ? bug?.sourceCreatedAt || null : bug?.createdAt || null;
  var formatIssueCreatedDate = (bug) => {
    const createdAt = getIssueCreatedDate(bug);
    if (!createdAt) return "Unavailable";
    return formatDate(createdAt);
  };
  var escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  var getInitials = (name) => String(name || "").split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
  var getMetadataValue = (description, label) => {
    if (!description) return "";
    const prefix = `${label}:`;
    const line = String(description).split("\n").find((entry) => entry.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : "";
  };
  var getFirstMetadataValue = (description, labels) => {
    for (const label of labels) {
      const value = getMetadataValue(description, label);
      if (value) return value;
    }
    return "";
  };
  var resolveIssueUser = (bug, users, idKey, metadataLabels) => {
    const user = bug?.[idKey] ? users.find((u) => u.id === bug[idKey]) : null;
    if (user) return user;
    const fallbackName = getFirstMetadataValue(bug?.description, Array.isArray(metadataLabels) ? metadataLabels : [metadataLabels]);
    return fallbackName ? { name: fallbackName, avatar: "", color: "#64748b" } : null;
  };
  var REPORT_FILTER_DEFAULTS = { projectId: "", startDate: "", endDate: "", assigneeId: "", priority: "", status: "", type: "" };
  var matchesReportFilters = (bug, filters) => {
    const createdAt = getIssueCreatedDate(bug);
    if (filters.startDate || filters.endDate) {
      if (!createdAt) return false;
      const createdDate = new Date(createdAt);
      if (filters.startDate && createdDate < /* @__PURE__ */ new Date(`${filters.startDate}T00:00:00`)) return false;
      if (filters.endDate && createdDate > /* @__PURE__ */ new Date(`${filters.endDate}T23:59:59.999`)) return false;
    }
    if (filters.assigneeId && (bug.assigneeId || "") !== filters.assigneeId) return false;
    if (filters.priority && bug.priority !== filters.priority) return false;
    if (filters.status && bug.status !== filters.status) return false;
    if (filters.type && bug.type !== filters.type) return false;
    return true;
  };
  var summarizeBugs = (bugs) => ({
    total: bugs.length,
    openCount: bugs.filter((b) => b.status !== "Done").length,
    doneCount: bugs.filter((b) => b.status === "Done").length,
    byPriority: ["Critical", "High", "Medium", "Low"].reduce((acc, label) => ({ ...acc, [label]: bugs.filter((b) => b.priority === label).length }), {}),
    byStatus: ["To Do", "In Progress", "In Review", "Done"].reduce((acc, label) => ({ ...acc, [label]: bugs.filter((b) => b.status === label).length }), {})
  });
  var buildProjectReportHtml = ({ project, stats, bugs, users, generatedAt }) => {
    const rows = bugs.map((bug) => {
      const assignee = resolveIssueUser(bug, users, "assigneeId", ["Assignee(s)", "Assignee From Sheet"]);
      const issueUrl = `${window.location.origin}/#issue/${bug.id}`;
      return `
      <tr class="issuerow">
        <td class="issuetype">${escapeHtml(bug.type || "Bug")}</td>
        <td class="issuekey"><a class="issue-link" href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(bug.key || "")}</a></td>
        <td class="summary"><p>${escapeHtml(bug.title)}</p></td>
        <td class="created">${escapeHtml(formatIssueCreatedDate(bug))}</td>
        <td class="priority">${escapeHtml(bug.priority || "Medium")}</td>
        <td class="assignee">${escapeHtml(assignee?.name || "Unassigned")}</td>
        <td class="status">${escapeHtml(bug.status || "To Do")}</td>
      </tr>
    `;
    }).join("");
    return `<!doctype html>
<html xmlns="http://www.w3.org/TR/REC-html40" lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(project.name)} - Issue Report</title>
  <meta http-equiv="Content-Type" content="application/vnd.ms-excel; charset=UTF-8">
  <style>
    table { mso-displayed-decimal-separator:"\\."; mso-displayed-thousand-separator:"\\,"; }
    body { margin:0; font-size:12px; font-family:Arial,sans-serif; color:black; background:white; }
    @page {
      mso-page-orientation:landscape;
      margin:.25in .25in .5in .25in;
      mso-header-margin:.5in;
      mso-footer-margin:.25in;
      mso-footer-data:"&R&P of &N";
      mso-horizontal-page-align:center;
      mso-vertical-page-align:center;
    }
    td.issuekey, td.issuetype, td.status { mso-style-parent:""; mso-number-format:\\@; text-align:left; }
    br { mso-data-placement:same-cell; }
    td { vertical-align:top; }
    a { color:#2a5db0; text-decoration:none; }
    .summary p { margin:0; }
    .report-link { margin: 6px 0; display:inline-block; }
  </style>
</head>
<body>
  <table border="1">
    <tr bgcolor="#205081" height="30">
      <td colspan="7" style="padding:4px 8px;">
        <img src="${escapeHtml(window.location.origin + BRAND_LOGO)}" alt="Jira" style="display:block;width:64px;height:32px;object-fit:contain;background:#fff;border-radius:4px;padding:2px;">
      </td>
    </tr>
    <tr>
      <td colspan="7">
        <a class="report-link" href="${escapeHtml(window.location.origin)}">${escapeHtml(project.name)} - Issue Report</a>
      </td>
    </tr>
    <tr>
      <td colspan="7">
        Displaying <strong>${bugs.length}</strong> issues at <strong>${escapeHtml(new Date(generatedAt).toLocaleString("en-GB"))}</strong>.
      </td>
    </tr>
    <tr>
      <td><strong>Total</strong><br>${stats.total}</td>
      <td><strong>Open</strong><br>${stats.openCount}</td>
      <td><strong>Done</strong><br>${stats.doneCount}</td>
      <td><strong>Critical</strong><br>${stats.byPriority?.Critical || 0}</td>
      <td><strong>Project Key</strong><br>${escapeHtml(project.key || "-")}</td>
      <td><strong>Generated For</strong><br>${escapeHtml(project.name)}</td>
    </tr>
  </table>

  <table id="issuetable" border="1" cellpadding="3" cellspacing="1" width="100%">
    <thead>
      <tr class="rowHeader">
        <th>Issue Type</th>
        <th>Key</th>
        <th>Summary</th>
        <th>Creation Date</th>
        <th>Priority</th>
        <th>Assignee</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
  };
  var COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#38bdf8", "#ec4899", "#8b5cf6", "#14b8a6"];
  var ROLE_LABELS = { admin: "Admin", project_manager: "Project Manager", developer: "Developer", frontend_developer: "Frontend Developer", backend_developer: "Backend Developer", tester: "QA", viewer: "Viewer", qa: "QA", "Project Manager": "Project Manager", "Developer": "Developer", "Frontend Developer": "Frontend Developer", "Backend Developer": "Backend Developer", "Tester": "QA", "QA": "QA", "Viewer": "Viewer" };
  var ROLE_COLORS = { admin: "#ef4444", project_manager: "#f97316", developer: "#6366f1", frontend_developer: "#3b82f6", backend_developer: "#2563eb", tester: "#10b981", viewer: "#9ca3af", qa: "#10b981", "Admin": "#ef4444", "Project Manager": "#f97316", "Developer": "#6366f1", "Frontend Developer": "#3b82f6", "Backend Developer": "#2563eb", "Tester": "#10b981", "Viewer": "#9ca3af" };
  var PLAN_OPTIONS = [
    { code: "basic", name: "Basic", price: "Free", userLimit: 10, blurb: "A clean starting point for small teams that need structured bug tracking without complexity.", cta: "Start Free", featured: false },
    { code: "plus", name: "Plus", price: "$32.50 / mo", userLimit: 50, blurb: "A professional plan for active engineering, QA, and delivery teams that need more seats and room to grow.", cta: "Pay and Upgrade", featured: true },
    { code: "enterprise", name: "Enterprise", price: "$108.30 / mo", userLimit: null, blurb: "For larger rollouts, unlimited seats, and organizations that need unrestricted team expansion.", cta: "Pay and Upgrade", featured: false }
  ];
  var ALL_PERMISSIONS = ["CREATE_ISSUE", "EDIT_ISSUE", "DELETE_ISSUE", "ASSIGN_ISSUE", "CHANGE_STATUS", "COMMENT", "VIEW_ISSUE", "VIEW_REPORTS", "MANAGE_PROJECT", "MANAGE_USERS", "CONFIGURE_WORKFLOW"];
  var APPS_SCRIPT_SNIPPET = `function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    for (const t of p.sheets) {
      let sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
      const headers = t.headers || [];
      const rows = t.rows || [];

      if (p.action === 'add_tab') {
        if (sh.getLastRow() === 0 && headers.length) {
          sh.getRange(1,1,1,headers.length).setValues([headers]);
        }
      } else if (p.action === 'append') {
        if (sh.getLastRow() === 0 && headers.length) {
          sh.getRange(1,1,1,headers.length).setValues([headers]);
        }
        if (rows.length) {
          sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
        }
      } else {
        const allRows = rows.length ? [headers, ...rows] : [headers];
        sh.clearContents();
        sh.getRange(1,1,allRows.length,headers.length).setValues(allRows);
      }

      if (headers.length) {
        sh.getRange(1,1,1,headers.length)
          .setFontWeight('bold')
          .setFontFamily('Arial')
          .setFontSize(10)
          .setBackground('#F6E3CC')
          .setFontColor('#000000')
          .setHorizontalAlignment('center')
          .setVerticalAlignment('middle')
          .setWrap(true)
          .setBorder(true, true, true, true, true, true, '#D8C0A3', SpreadsheetApp.BorderStyle.SOLID);
        sh.setFrozenRows(1);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}`;
  var readFilesAsAttachments = (files) => Promise.all(
    [...files].filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/")).map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: reader.result });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }))
  );
  var readImageAsDataUrl = (file) => new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      return resolve(null);
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  var readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  var ensureRazorpayLoaded = () => new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve(true);
    const existing = document.querySelector("script[data-razorpay-checkout]");
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load Razorpay checkout")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("Unable to load Razorpay checkout"));
    document.body.appendChild(script);
  });
  var ensureChartJsLoaded = () => new Promise((resolve, reject) => {
    if (window.Chart) return resolve(window.Chart);
    const existing = document.querySelector("script[data-chartjs]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Chart), { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load charts")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js";
    script.async = true;
    script.dataset.chartjs = "true";
    script.onload = () => resolve(window.Chart);
    script.onerror = () => reject(new Error("Unable to load charts"));
    document.body.appendChild(script);
  });
  function SearchableSelect({ value, onChange, options, placeholder, width = 180 }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const rootRef = useRef(null);
    const selected = options.find((option) => String(option.value) === String(value));
    const normalizedOptions = options.filter((option) => String(option.label) !== String(placeholder));
    const filteredOptions = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
    useEffect(() => {
      if (!open) setQuery("");
    }, [open]);
    useEffect(() => {
      const onDocumentClick = (event) => {
        if (!rootRef.current?.contains(event.target)) setOpen(false);
      };
      document.addEventListener("mousedown", onDocumentClick);
      return () => document.removeEventListener("mousedown", onDocumentClick);
    }, []);
    return /* @__PURE__ */ React.createElement("div", { ref: rootRef, style: { position: "relative", minWidth: width } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "filter-select",
        onClick: () => setOpen((v) => !v),
        style: { width: "100%", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }
      },
      /* @__PURE__ */ React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, selected?.label || placeholder),
      /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--muted)" } }, "\u25BC")
    ), open && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: "calc(100% + 8px)", left: 0, width: "100%", minWidth: 220, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow)", zIndex: 60, padding: 10 } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "form-input",
        value: query,
        onChange: (e) => setQuery(e.target.value),
        placeholder: `Search ${placeholder.toLowerCase()}...`,
        autoFocus: true,
        style: { marginBottom: 8, border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "none" }
      }
    ), /* @__PURE__ */ React.createElement("div", { style: { maxHeight: 220, overflowY: "auto", display: "grid", gap: 4 } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: `btn btn-sm searchable-opt${!value ? " searchable-opt--selected" : ""}`,
        onClick: () => {
          onChange("");
          setOpen(false);
        },
        style: { justifyContent: "flex-start", border: "none", borderRadius: "var(--radius)" }
      },
      placeholder
    ), filteredOptions.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 10px", fontSize: 12, color: "var(--muted)" } }, "No matching options") : normalizedOptions.filter((option) => option.label.toLowerCase().includes(query.toLowerCase())).map((option) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: option.value,
        type: "button",
        className: `btn btn-sm searchable-opt${String(option.value) === String(value) ? " searchable-opt--selected" : ""}`,
        onClick: () => {
          onChange(option.value);
          setOpen(false);
        },
        style: { justifyContent: "flex-start", border: "none", borderRadius: "var(--radius)" }
      },
      option.label
    )))));
  }
  function useSheetSyncStatus() {
    const [syncStatus, setSyncStatus] = useState(null);
    const loadStatus = useCallback(async () => {
      try {
        const status = await api.get("/api/sheet-sync/status");
        if (!status?.error) setSyncStatus(status);
        return status;
      } catch {
        return null;
      }
    }, []);
    useEffect(() => {
      let active = true;
      const guardedLoad = async () => {
        const status = await loadStatus();
        if (!active || !status?.running) return;
        setTimeout(() => {
          if (active) guardedLoad();
        }, 5e3);
      };
      guardedLoad();
      const timer = setInterval(loadStatus, 6e4);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [loadStatus]);
    return { syncStatus, refreshSyncStatus: loadStatus };
  }
  function SyncTimestamp({ toast, onSyncComplete }) {
    const { syncStatus, refreshSyncStatus } = useSheetSyncStatus();
    const [syncing, setSyncing] = useState(false);
    const syncDisplay = syncStatus?.lastSuccessAt ? new Date(syncStatus.lastSuccessAt).toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }) : "Unavailable";
    const runManualSync = async () => {
      if (syncing || syncStatus?.running) return;
      setSyncing(true);
      try {
        const result = await api.post("/api/sheet-sync/run", {});
        if (result?.error) {
          toast?.(result.error, "error");
        } else {
          toast?.(result.started ? "Manual data sync started" : "Data sync is already running", "info");
          const pollUntilDone = () => {
            api.get("/api/sheet-sync/status").then((status) => {
              refreshSyncStatus();
              if (status?.running) {
                setTimeout(pollUntilDone, 2e3);
              } else {
                onSyncComplete?.();
              }
            });
          };
          setTimeout(pollUntilDone, 1500);
        }
      } finally {
        setSyncing(false);
      }
    };
    return /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto", textAlign: "right", display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", border: "none", borderRadius: 12, background: "transparent" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.04em" } }, "Last Data Sync"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--muted)", marginTop: 2 } }, syncDisplay)), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-ghost btn-sm",
        onClick: runManualSync,
        disabled: syncing || syncStatus?.running,
        title: "Sync data now",
        style: { padding: "8px 10px", minWidth: "40px", minHeight: "40px", borderRadius: 10 }
      },
      syncing || syncStatus?.running ? "\u21BB" : "\u27F3"
    ));
  }
  function IssueTable({ bugs, users, projects, currentProject, onSelectBug, emptyText = "No issues found." }) {
    const showProjectColumn = !currentProject;
    if (!bugs.length) {
      return /* @__PURE__ */ React.createElement("div", { className: "text-muted text-sm" }, emptyText);
    }
    return /* @__PURE__ */ React.createElement("div", { className: "table-scroll" }, /* @__PURE__ */ React.createElement("table", { className: "bug-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Date Created"), /* @__PURE__ */ React.createElement("th", null, "Issue Title"), showProjectColumn && /* @__PURE__ */ React.createElement("th", null, "Project Name"), /* @__PURE__ */ React.createElement("th", null, "Raised By"), /* @__PURE__ */ React.createElement("th", null, "Issue Type"), /* @__PURE__ */ React.createElement("th", null, "Assignee"), /* @__PURE__ */ React.createElement("th", null, "Priority"), /* @__PURE__ */ React.createElement("th", null, "Status"), /* @__PURE__ */ React.createElement("th", null, "Last Updated"))), /* @__PURE__ */ React.createElement("tbody", null, bugs.map((bug) => {
      const assignee = resolveIssueUser(bug, users, "assigneeId", ["Assignee(s)", "Assignee From Sheet"]);
      const reporter = resolveIssueUser(bug, users, "reporterId", "Raised By");
      const project = projects.find((p) => p.id === bug.projectId);
      return /* @__PURE__ */ React.createElement("tr", { key: `compact-${bug.id}`, onClick: () => onSelectBug(bug.id) }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "text-muted text-sm" }, formatIssueCreatedDate(bug))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "issue-title" }, bug.title)), showProjectColumn && /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "text-muted text-sm" }, project?.name || "\u2014")), /* @__PURE__ */ React.createElement("td", null, reporter ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement(Avatar, { user: reporter, size: "xs" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12 } }, reporter.name)) : /* @__PURE__ */ React.createElement("span", { className: "text-muted text-sm" }, "Unknown")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(TypeBadge, { t: bug.type })), /* @__PURE__ */ React.createElement("td", null, assignee ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement(Avatar, { user: assignee, size: "xs" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12 } }, assignee.name)) : /* @__PURE__ */ React.createElement("span", { className: "text-muted text-sm" }, "Unassigned")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(PriorityBadge, { p: bug.priority })), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(StatusBadge, { s: bug.status })), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "text-muted text-sm" }, formatDate(bug.updatedAt))));
    }))));
  }
  function ExportReportFiltersModal({ visible, onClose, currentProject, projects, users, exportFilters, setExportFilter, onReset, onExport }) {
    if (!visible) return null;
    const hasFilters = [exportFilters.startDate, exportFilters.endDate, exportFilters.assigneeId, exportFilters.priority, exportFilters.status, exportFilters.type, ...!currentProject ? [exportFilters.projectId] : []].some(Boolean);
    return /* @__PURE__ */ React.createElement(Modal, { onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, "Export Report Filters"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, !currentProject && /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Project"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: exportFilters.projectId, onChange: (e) => setExportFilter("projectId", e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Select Project"), projects.map((project) => /* @__PURE__ */ React.createElement("option", { key: project.id, value: project.id }, project.name)))), /* @__PURE__ */ React.createElement("div", { className: "form-row" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Starting Date"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "date", value: exportFilters.startDate, onChange: (e) => setExportFilter("startDate", e.target.value) })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Ending Date"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "date", value: exportFilters.endDate, onChange: (e) => setExportFilter("endDate", e.target.value) }))), /* @__PURE__ */ React.createElement("div", { className: "form-row" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Assignee"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: exportFilters.assigneeId, onChange: (e) => setExportFilter("assigneeId", e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "All Assignees"), users.map((u) => /* @__PURE__ */ React.createElement("option", { key: u.id, value: u.id }, u.name)))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Priority"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: exportFilters.priority, onChange: (e) => setExportFilter("priority", e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "All Priorities"), ["Critical", "High", "Medium", "Low"].map((p) => /* @__PURE__ */ React.createElement("option", { key: p, value: p }, p))))), /* @__PURE__ */ React.createElement("div", { className: "form-row" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Status"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: exportFilters.status, onChange: (e) => setExportFilter("status", e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "All Statuses"), ["To Do", "In Progress", "In Review", "Done"].map((s) => /* @__PURE__ */ React.createElement("option", { key: s, value: s }, s)))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Issue Type"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: exportFilters.type, onChange: (e) => setExportFilter("type", e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "All Types"), ["Bug", "Feature", "Task", "Improvement"].map((t) => /* @__PURE__ */ React.createElement("option", { key: t, value: t }, t)))))), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, hasFilters && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost", onClick: onReset }, "Reset"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-primary", onClick: onExport }, hasFilters ? "Export" : "Export without filter")));
  }
  function useProjectReportExport({ currentProject, projects, users, toast }) {
    const [showExportFilters, setShowExportFilters2] = useState(false);
    const [exportFilters, setExportFilters2] = useState(REPORT_FILTER_DEFAULTS);
    useEffect(() => {
      setExportFilters2((f) => ({ ...f, projectId: currentProject?.id || "" }));
    }, [currentProject]);
    const setExportFilter = (key, value) => setExportFilters2((f) => ({ ...f, [key]: value }));
    const openExportModal = () => setShowExportFilters2(true);
    const closeExportModal = () => setShowExportFilters2(false);
    const resetExportFilters = () => setExportFilters2({ ...REPORT_FILTER_DEFAULTS, projectId: currentProject?.id || "" });
    const exportReport = async () => {
      const selectedProject = currentProject || projects.find((p) => p.id === exportFilters.projectId);
      if (!selectedProject) {
        toast("Select a project to export its report", "info");
        return;
      }
      const popup = window.open("", "_blank");
      if (!popup) {
        toast("Allow pop-ups to open the HTML report", "error");
        return;
      }
      popup.document.write('<!doctype html><title>Preparing report...</title><body style="font-family:Arial,sans-serif;padding:24px">Preparing project report...</body>');
      try {
        const [reportStats, reportBugs] = await Promise.all([
          api.get(`/api/stats?projectId=${selectedProject.id}`),
          api.get(`/api/bugs?projectId=${selectedProject.id}`)
        ]);
        const filteredBugs = reportBugs.filter((bug) => matchesReportFilters(bug, exportFilters));
        const html = buildProjectReportHtml({
          project: selectedProject,
          stats: { ...reportStats, ...summarizeBugs(filteredBugs) },
          bugs: filteredBugs,
          users,
          generatedAt: Date.now()
        });
        const blob = new Blob([html], { type: "text/html" });
        const reportUrl = URL.createObjectURL(blob);
        popup.location.href = reportUrl;
        setTimeout(() => URL.revokeObjectURL(reportUrl), 6e4);
        closeExportModal();
        toast("Project report opened in a new tab", "success");
      } catch (error) {
        popup.close();
        toast("Unable to generate project report", "error");
      }
    };
    return {
      showExportFilters,
      exportFilters,
      setExportFilter,
      openExportModal,
      closeExportModal,
      resetExportFilters,
      exportReport
    };
  }
  function Toast({ toasts, dismiss }) {
    return /* @__PURE__ */ React.createElement("div", { className: "toast-container" }, toasts.map((t) => /* @__PURE__ */ React.createElement("div", { key: t.id, className: `toast toast-${t.type}`, onClick: () => dismiss(t.id) }, /* @__PURE__ */ React.createElement("span", null, t.type === "success" ? "\u2713" : t.type === "error" ? "\u2717" : "\u2139"), /* @__PURE__ */ React.createElement("span", null, t.message))));
  }
  function Avatar({ user, size = "" }) {
    const cls = `avatar ${size === "xs" ? "avatar-xs" : size === "sm" ? "avatar-sm" : ""}`;
    if (!user) return /* @__PURE__ */ React.createElement("div", { className: cls, style: { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)" } }, "\u{1F464}");
    if (user.avatar && user.avatar.startsWith("data:image/")) {
      return /* @__PURE__ */ React.createElement("img", { src: user.avatar, alt: user.name, className: cls, style: { background: "var(--surface2)", border: "1px solid var(--border)" }, title: user.name });
    }
    return /* @__PURE__ */ React.createElement("div", { className: cls, style: { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)" }, title: user.name }, "\u{1F464}");
  }
  function PriorityBadge({ p }) {
    return /* @__PURE__ */ React.createElement("span", { className: `badge ${priorityBadge(p)}` }, priorityIcon(p), " ", p);
  }
  function StatusBadge({ s }) {
    return /* @__PURE__ */ React.createElement("span", { className: `badge ${statusBadge(s)}` }, statusIcon(s), " ", s);
  }
  function TypeBadge({ t }) {
    return /* @__PURE__ */ React.createElement("span", { className: `badge ${typeBadge(t)}` }, typeIcon(t), " ", t);
  }
  function BrandLogo({ src = BRAND_LOGO, size = 48, rounded = 12, style = {} }) {
    return /* @__PURE__ */ React.createElement(
      "img",
      {
        src,
        alt: "FixPulse logo",
        style: {
          width: size,
          height: size,
          borderRadius: rounded,
          objectFit: "cover",
          display: "block",
          ...style
        }
      }
    );
  }
  function Modal({ children, onClose, large }) {
    useEffect(() => {
      const esc = (e) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", esc);
      return () => document.removeEventListener("keydown", esc);
    }, []);
    return /* @__PURE__ */ React.createElement("div", { className: "modal-overlay", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: `modal ${large ? "modal-lg" : ""}` }, children));
  }
  function AuthPage({ onAuth }) {
    const initialToken = new URLSearchParams(window.location.search).get("reset_token") || "";
    const [mode, setMode] = useState(initialToken ? "reset-password" : "landing");
    const [form, setForm] = useState({ companyName: "", name: "", email: "", password: "", confirm: "", color: "#6366f1", resetToken: initialToken });
    const [avatarFile, setAvatarFile] = useState(null);
    const [orgLogoFile, setOrgLogoFile] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPw, setShowPw] = useState(false);
    const set = (k, v) => {
      setForm((f) => ({ ...f, [k]: v }));
      setError("");
    };
    const submit = async (e) => {
      e.preventDefault();
      setError("");
      if (mode === "forgot-password") {
        if (!form.email) return setError("Email is required");
        setLoading(true);
        try {
          await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email }) });
          setMode("forgot-sent");
        } catch {
          setError("Cannot connect to server.");
        }
        setLoading(false);
        return;
      }
      if (mode === "reset-password") {
        if (form.password.length < 6) return setError("Password must be at least 6 characters");
        if (form.password !== form.confirm) return setError("Passwords do not match");
        setLoading(true);
        try {
          const res = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: form.resetToken, password: form.password }) });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error || "Something went wrong");
            setLoading(false);
            return;
          }
          window.history.replaceState({}, "", "/");
          setMode("reset-done");
        } catch {
          setError("Cannot connect to server.");
        }
        setLoading(false);
        return;
      }
      if (mode === "register") {
        if (!form.companyName.trim()) return setError("Company name is required");
        if (!form.name.trim()) return setError("Your name is required");
        if (form.password.length < 6) return setError("Password must be at least 6 characters");
        if (form.password !== form.confirm) return setError("Passwords do not match");
      }
      setLoading(true);
      try {
        const url = mode === "login" ? "/api/auth/login" : "/api/auth/register-company";
        const avatarDataUrl = avatarFile ? await readImageAsDataUrl(avatarFile) : null;
        const orgLogoDataUrl = orgLogoFile ? await readImageAsDataUrl(orgLogoFile) : null;
        const body = mode === "login" ? { email: form.email, password: form.password } : { companyName: form.companyName, name: form.name, email: form.email, password: form.password, color: form.color, avatarDataUrl, orgLogoDataUrl };
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Something went wrong");
          setLoading(false);
          return;
        }
        Token.set(data.token);
        onAuth(data.user, data.org);
      } catch {
        setError("Cannot connect to server. Make sure it is running.");
      }
      setLoading(false);
    };
    const reset = (m) => {
      setMode(m);
      setError("");
      setAvatarFile(null);
      setOrgLogoFile(null);
      setForm({ companyName: "", name: "", email: "", password: "", confirm: "", color: "#6366f1", resetToken: "" });
    };
    if (mode === "landing") return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { width: "100%", maxWidth: 480, textAlign: "center" } }, /* @__PURE__ */ React.createElement(BrandLogo, { size: 84, rounded: 20, style: { margin: "0 auto 16px" } }), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 28, fontWeight: 800, marginBottom: 8 } }, "FixPulse"), /* @__PURE__ */ React.createElement("p", { style: { color: "var(--muted)", fontSize: 15, marginBottom: 40 } }, "Professional bug & issue tracking for your team"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 320, margin: "0 auto" } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", style: { justifyContent: "center", padding: "14px 0", fontSize: 15, borderRadius: 10 }, onClick: () => setMode("login") }, "\u{1F511} Log In to Your Company"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", style: { justifyContent: "center", padding: "14px 0", fontSize: 15, borderRadius: 10, border: "1px solid var(--border)" }, onClick: () => setMode("register") }, "\u{1F3E2} Register a New Company")), /* @__PURE__ */ React.createElement("p", { style: { color: "var(--muted)", fontSize: 12, marginTop: 32 } }, "Multi-tenant \xB7 Role-based access \xB7 Real-time tracking")));
    return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { width: "100%", maxWidth: mode === "register" ? 480 : 420 } }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginBottom: 28 } }, /* @__PURE__ */ React.createElement(BrandLogo, { size: 64, rounded: 16, style: { margin: "0 auto 10px" } }), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 20, fontWeight: 700 } }, mode === "login" ? "Welcome back" : "Register your Company"), /* @__PURE__ */ React.createElement("p", { style: { color: "var(--muted)", fontSize: 13, marginTop: 4 } }, mode === "login" ? "Log in to your company workspace" : "Create a workspace for your team")), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 28 } }, /* @__PURE__ */ React.createElement("form", { onSubmit: submit }, mode === "register" && /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "\u{1F3E2} Company Name *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.companyName, onChange: (e) => set("companyName", e.target.value), placeholder: "Acme Corp", required: true, autoFocus: true })), mode === "register" && /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Company Photo or Logo (optional)"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "file", accept: "image/*", onChange: (e) => setOrgLogoFile(e.target.files?.[0] || null) })), mode === "register" && /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Your Full Name *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.name, onChange: (e) => set("name", e.target.value), placeholder: "Jane Doe", required: true })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Work Email *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "email", value: form.email, onChange: (e) => set("email", e.target.value), placeholder: "you@company.com", required: true, autoFocus: mode === "login" })), /* @__PURE__ */ React.createElement("div", { className: "form-group", style: { position: "relative" } }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Password *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: showPw ? "text" : "password", value: form.password, onChange: (e) => set("password", e.target.value), placeholder: mode === "register" ? "Min. 6 characters" : "Your password", required: true, style: { paddingRight: 40 } }), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setShowPw((v) => !v), style: { position: "absolute", right: 10, top: 30, background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 } }, showPw ? "\u{1F648}" : "\u{1F441}")), mode === "register" && /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Confirm Password *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: showPw ? "text" : "password", value: form.confirm, onChange: (e) => set("confirm", e.target.value), placeholder: "Repeat password", required: true })), mode === "register" && /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Profile Photo (optional)"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "file", accept: "image/*", onChange: (e) => setAvatarFile(e.target.files?.[0]) })), error && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 8, padding: "10px 14px", color: "#ef4444", fontSize: 13, marginBottom: 16 } }, "\u26A0 ", error), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary", disabled: loading, style: { width: "100%", justifyContent: "center", padding: "11px 0", fontSize: 14, gap: 8 } }, loading && /* @__PURE__ */ React.createElement("span", { className: "btn-spinner" }), loading ? mode === "login" ? "Signing in\u2026" : "Creating workspace\u2026" : mode === "login" ? "\u{1F511} Sign In" : "\u{1F680} Create Company Workspace")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginTop: 16, fontSize: 12, color: "var(--muted)" } }, mode === "login" ? /* @__PURE__ */ React.createElement("span", null, "New to FixPulse? ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--primary)", cursor: "pointer", fontWeight: 600 }, onClick: () => reset("register") }, "Register your company \u2192")) : /* @__PURE__ */ React.createElement("span", null, "Already have a workspace? ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--primary)", cursor: "pointer", fontWeight: 600 }, onClick: () => reset("login") }, "Log in \u2192"))), mode === "login" && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--primary)", fontSize: 12, cursor: "pointer", fontWeight: 500 }, onClick: () => reset("forgot-password") }, "Forgot your password?")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--muted)", fontSize: 12, cursor: "pointer" }, onClick: () => reset("landing") }, "\u2190 Back")))));
    if (mode === "forgot-password") return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { width: "100%", maxWidth: 420 } }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginBottom: 28 } }, /* @__PURE__ */ React.createElement(BrandLogo, { size: 64, rounded: 16, style: { margin: "0 auto 10px" } }), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 20, fontWeight: 700 } }, "Forgot Password"), /* @__PURE__ */ React.createElement("p", { style: { color: "var(--muted)", fontSize: 13, marginTop: 4 } }, "Enter your email and we'll send you a reset link")), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 28 } }, /* @__PURE__ */ React.createElement("form", { onSubmit: submit }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Work Email *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "email", value: form.email, onChange: (e) => set("email", e.target.value), placeholder: "you@company.com", required: true, autoFocus: true })), error && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 8, padding: "10px 14px", color: "#ef4444", fontSize: 13, marginBottom: 16 } }, "\u26A0 ", error), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary", disabled: loading, style: { width: "100%", justifyContent: "center", padding: "11px 0", fontSize: 14 } }, loading ? "\u23F3 Sending\u2026" : "\u{1F4E7} Send Reset Link")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginTop: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--muted)", fontSize: 12, cursor: "pointer" }, onClick: () => reset("login") }, "\u2190 Back to Login")))));
    if (mode === "forgot-sent") return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { width: "100%", maxWidth: 420, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 48, marginBottom: 16 } }, "\u{1F4E7}"), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 22, fontWeight: 700, marginBottom: 8 } }, "Check your email"), /* @__PURE__ */ React.createElement("p", { style: { color: "var(--muted)", fontSize: 14, marginBottom: 24 } }, "If an account exists for that email, we've sent a password reset link. It expires in 1 hour."), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", style: { justifyContent: "center", padding: "11px 24px" }, onClick: () => reset("login") }, "Back to Login")));
    if (mode === "reset-password") return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { width: "100%", maxWidth: 420 } }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginBottom: 28 } }, /* @__PURE__ */ React.createElement(BrandLogo, { size: 64, rounded: 16, style: { margin: "0 auto 10px" } }), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 20, fontWeight: 700 } }, "Set New Password"), /* @__PURE__ */ React.createElement("p", { style: { color: "var(--muted)", fontSize: 13, marginTop: 4 } }, "Choose a strong password for your account")), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 28 } }, /* @__PURE__ */ React.createElement("form", { onSubmit: submit }, /* @__PURE__ */ React.createElement("div", { className: "form-group", style: { position: "relative" } }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "New Password *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: showPw ? "text" : "password", value: form.password, onChange: (e) => set("password", e.target.value), placeholder: "Min. 6 characters", required: true, autoFocus: true, style: { paddingRight: 40 } }), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setShowPw((v) => !v), style: { position: "absolute", right: 10, top: 30, background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 } }, showPw ? "\u{1F648}" : "\u{1F441}")), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Confirm Password *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: showPw ? "text" : "password", value: form.confirm, onChange: (e) => set("confirm", e.target.value), placeholder: "Repeat password", required: true })), error && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 8, padding: "10px 14px", color: "#ef4444", fontSize: 13, marginBottom: 16 } }, "\u26A0 ", error), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary", disabled: loading, style: { width: "100%", justifyContent: "center", padding: "11px 0", fontSize: 14 } }, loading ? "\u23F3 Saving\u2026" : "\u{1F512} Set New Password")))));
    if (mode === "reset-done") return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { width: "100%", maxWidth: 420, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 48, marginBottom: 16 } }, "\u2705"), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 22, fontWeight: 700, marginBottom: 8 } }, "Password updated!"), /* @__PURE__ */ React.createElement("p", { style: { color: "var(--muted)", fontSize: 14, marginBottom: 24 } }, "Your password has been changed. You can now log in with your new password."), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", style: { justifyContent: "center", padding: "11px 24px" }, onClick: () => reset("login") }, "Go to Login")));
  }
  function BugModal({ bug, projects, users, currentProject, onClose, onSave, toast }) {
    const editing = !!bug;
    const [form, setForm] = useState({ title: bug?.title || "", description: bug?.description || "", projectId: bug?.projectId || currentProject?.id || projects[0]?.id || "", type: bug?.type || "Bug", priority: bug?.priority || "Medium", assigneeId: bug?.assigneeId || "", labels: bug?.labels?.join(", ") || "", attachments: bug?.attachments || [], referenceLink: bug?.referenceLink || "", curlCommand: bug?.curlCommand || "" });
    const [projectPermissions, setProjectPermissions] = useState(/* @__PURE__ */ new Set());
    const [showCurl, setShowCurl] = useState(!!bug?.curlCommand);
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    useEffect(() => {
      if (!form.projectId) {
        setProjectPermissions(/* @__PURE__ */ new Set());
        return;
      }
      api.get(`/api/rbac/me/permissions?projectId=${form.projectId}`).then((res) => setProjectPermissions(new Set(res.permissions || []))).catch(() => setProjectPermissions(/* @__PURE__ */ new Set()));
    }, [form.projectId]);
    const handleSubmit = async (e) => {
      e.preventDefault();
      if (!form.title.trim()) return;
      const payload = { ...form, labels: form.labels ? form.labels.split(",").map((l) => l.trim()).filter(Boolean) : [], referenceLink: (form.referenceLink || "").trim(), curlCommand: (form.curlCommand || "").trim() };
      if (!projectPermissions.has("ASSIGN_ISSUE")) {
        delete payload.assigneeId;
      }
      try {
        if (editing) {
          const u = await api.put(`/api/bugs/${bug.id}`, payload);
          if (u?.error) {
            toast(u.error, "error");
            return;
          }
          toast("Issue updated", "success");
          onSave(u);
        } else {
          const c = await api.post("/api/bugs", payload);
          if (c?.error) {
            toast(c.error, "error");
            return;
          }
          toast("Issue created", "success");
          onSave(c);
        }
      } catch {
        toast("Something went wrong", "error");
      }
    };
    const addAttachments = async (files) => {
      try {
        const next = await readFilesAsAttachments(files);
        set("attachments", [...form.attachments, ...next]);
      } catch {
        toast("Unable to read selected files", "error");
      }
    };
    const removeAttachment = (index) => set("attachments", form.attachments.filter((_, i) => i !== index));
    return /* @__PURE__ */ React.createElement(Modal, { onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, editing ? "Edit Issue" : "Create Issue"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("form", { onSubmit: handleSubmit }, /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Title *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.title, onChange: (e) => set("title", e.target.value), placeholder: "Brief description of the issue", required: true, autoFocus: true })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Description"), /* @__PURE__ */ React.createElement("textarea", { className: "form-textarea", value: form.description, onChange: (e) => set("description", e.target.value), placeholder: "Detailed description, steps to reproduce\u2026" })), /* @__PURE__ */ React.createElement("div", { className: "form-row" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Project"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: form.projectId, onChange: (e) => set("projectId", e.target.value) }, projects.map((p) => /* @__PURE__ */ React.createElement("option", { key: p.id, value: p.id }, p.name)))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Type"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: form.type, onChange: (e) => set("type", e.target.value) }, ["Bug", "Feature", "Task", "Improvement"].map((t) => /* @__PURE__ */ React.createElement("option", { key: t }, t))))), /* @__PURE__ */ React.createElement("div", { className: "form-row" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Priority"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: form.priority, onChange: (e) => set("priority", e.target.value) }, ["Critical", "High", "Medium", "Low"].map((p) => /* @__PURE__ */ React.createElement("option", { key: p }, p)))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Assignee"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: form.assigneeId, onChange: (e) => set("assigneeId", e.target.value), disabled: !projectPermissions.has("ASSIGN_ISSUE") }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Unassigned"), users.map((u) => /* @__PURE__ */ React.createElement("option", { key: u.id, value: u.id }, u.name))), !projectPermissions.has("ASSIGN_ISSUE") && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)", marginTop: 6 } }, "You do not have permission to assign issues in this project."))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Labels (comma separated)"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.labels, onChange: (e) => set("labels", e.target.value), placeholder: "e.g. frontend, auth, critical" })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Reference Link"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.referenceLink, onChange: (e) => set("referenceLink", e.target.value), placeholder: "https://example.com/ticket-or-doc" })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Attachments"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "file", accept: "image/*,video/*", multiple: true, onChange: (e) => {
      if (e.target.files?.length) addAttachments(e.target.files);
      e.target.value = "";
    } }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)", marginTop: 6 } }, "You can attach multiple images or videos."), form.attachments.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8, marginTop: 12 } }, form.attachments.map((file, index) => /* @__PURE__ */ React.createElement("div", { key: `${file.name}-${index}`, style: { display: "flex", alignItems: "center", gap: 10, padding: 10, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface2)" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, file.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)" } }, file.type, " \xB7 ", (file.size / 1024 / 1024).toFixed(2), " MB")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: () => removeAttachment(index) }, "Remove"))))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, !showCurl && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: () => setShowCurl(true) }, "+ Add cURL"), showCurl && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("label", { className: "form-label", style: { marginBottom: 0 } }, "cURL Command"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: () => {
      setShowCurl(false);
      set("curlCommand", "");
    } }, "Hide")), /* @__PURE__ */ React.createElement("textarea", { className: "form-textarea", value: form.curlCommand, onChange: (e) => set("curlCommand", e.target.value), placeholder: "curl -X POST https://api.example.com/...", style: { minHeight: 120, fontFamily: "monospace" } })))), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost", onClick: onClose }, "Cancel"), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary" }, editing ? "Save Changes" : "Create Issue"))));
  }
  function BugDetail({ bugId, projects, users, onClose, onUpdate, onDelete, toast, currentUser }) {
    const [bug, setBug] = useState(null);
    const [editing, setEditing] = useState(false);
    const [comment, setComment] = useState("");
    const [tab, setTab] = useState("comments");
    const [projectPermissions, setProjectPermissions] = useState(/* @__PURE__ */ new Set());
    const [showCurl, setShowCurl] = useState(false);
    useEffect(() => {
      let active = true;
      api.get(`/api/bugs/${bugId}`).then((data) => {
        if (!active) return;
        if (data?.error || !data?.id) {
          toast(data?.error || "Issue not found", "error");
          onClose();
          return;
        }
        setBug(data);
      });
      return () => {
        active = false;
      };
    }, [bugId]);
    useEffect(() => {
      if (!bug?.projectId) return;
      api.get(`/api/rbac/me/permissions?projectId=${bug.projectId}`).then((res) => setProjectPermissions(new Set(res.permissions || []))).catch(() => setProjectPermissions(/* @__PURE__ */ new Set()));
    }, [bug?.projectId]);
    const updateField = async (field, value) => {
      const u = await api.put(`/api/bugs/${bugId}`, { [field]: value });
      if (u?.error) {
        toast(u.error, "error");
        return;
      }
      setBug(u);
      onUpdate(u);
      toast("Updated", "success");
    };
    const addComment = async () => {
      if (!comment.trim()) return;
      await api.post(`/api/bugs/${bugId}/comments`, { text: comment });
      setComment("");
      const fresh = await api.get(`/api/bugs/${bugId}`);
      setBug(fresh);
      toast("Comment added", "success");
    };
    const deleteComment = async (cid) => {
      await api.delete(`/api/bugs/${bugId}/comments/${cid}`);
      const fresh = await api.get(`/api/bugs/${bugId}`);
      setBug(fresh);
    };
    const deleteIssue = async () => {
      const res = await api.delete(`/api/bugs/${bugId}`);
      if (res?.error) {
        toast(res.error, "error");
        return;
      }
      onClose();
      if (onDelete) await onDelete(bugId);
      toast("Issue deleted", "info");
    };
    const project = bug ? projects.find((p) => p.id === bug.projectId) : null;
    const assignee = bug ? resolveIssueUser(bug, users, "assigneeId", ["Assignee(s)", "Assignee From Sheet"]) : null;
    const reporter = bug ? resolveIssueUser(bug, users, "reporterId", "Raised By") : null;
    if (!bug) return /* @__PURE__ */ React.createElement(Modal, { onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal-body", style: { minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" } }, "Loading\u2026"));
    if (editing) return /* @__PURE__ */ React.createElement(BugModal, { bug, projects, users, onClose: () => setEditing(false), onSave: (b) => {
      setBug(b);
      onUpdate(b);
      setEditing(false);
    }, toast });
    return /* @__PURE__ */ React.createElement(Modal, { onClose, large: true }, /* @__PURE__ */ React.createElement("div", { className: "modal-header", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } }, /* @__PURE__ */ React.createElement("span", { className: "issue-key" }, bug.key || bug.id.slice(0, 8)), /* @__PURE__ */ React.createElement(TypeBadge, { t: bug.type }), /* @__PURE__ */ React.createElement(PriorityBadge, { p: bug.priority })), /* @__PURE__ */ React.createElement("h2", { style: { fontSize: 18, fontWeight: 700 } }, bug.title)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginLeft: 16 } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setEditing(true) }, "\u270F Edit"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger btn-sm", onClick: deleteIssue }, "\u{1F5D1} Delete"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: onClose }, "\u2715"))), /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("div", { className: "detail-layout" }, /* @__PURE__ */ React.createElement("div", { className: "detail-main" }, /* @__PURE__ */ React.createElement("div", { className: "detail-section" }, /* @__PURE__ */ React.createElement("h4", null, "Description"), bug.description ? /* @__PURE__ */ React.createElement("div", { className: "detail-description" }, bug.description) : /* @__PURE__ */ React.createElement("div", { className: "detail-description", style: { color: "var(--muted)", fontStyle: "italic" } }, "No description provided.")), bug.labels?.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "detail-section" }, /* @__PURE__ */ React.createElement("h4", null, "Labels"), /* @__PURE__ */ React.createElement("div", { className: "flex gap-1 flex-wrap" }, bug.labels.map((l) => /* @__PURE__ */ React.createElement("span", { key: l, className: "label-chip" }, l)))), bug.referenceLink && /* @__PURE__ */ React.createElement("div", { className: "detail-section" }, /* @__PURE__ */ React.createElement("h4", null, "Reference Link"), /* @__PURE__ */ React.createElement("a", { href: bug.referenceLink, target: "_blank", rel: "noreferrer", style: { color: "var(--primary)", wordBreak: "break-all" } }, bug.referenceLink)), bug.attachments?.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "detail-section" }, /* @__PURE__ */ React.createElement("h4", null, "Attachments"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 12 } }, bug.attachments.map((file, index) => /* @__PURE__ */ React.createElement("div", { key: `${file.name}-${index}`, style: { padding: 12, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface2)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, file.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)" } }, file.type, " \xB7 ", (Number(file.size || 0) / 1024 / 1024).toFixed(2), " MB")), /* @__PURE__ */ React.createElement("a", { className: "btn btn-ghost btn-sm", href: file.dataUrl, download: file.name }, "Download")), file.type?.startsWith("image/") && /* @__PURE__ */ React.createElement("img", { src: file.dataUrl, alt: file.name, style: { maxWidth: "100%", borderRadius: 12, border: "1px solid var(--border)" } }), file.type?.startsWith("video/") && /* @__PURE__ */ React.createElement("video", { src: file.dataUrl, controls: true, style: { width: "100%", borderRadius: 12, border: "1px solid var(--border)" } }))))), (bug.curlCommand || showCurl) && /* @__PURE__ */ React.createElement("div", { className: "detail-section" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("h4", { style: { margin: 0 } }, "cURL"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setShowCurl((v) => !v) }, showCurl ? "Hide" : "Show")), showCurl && /* @__PURE__ */ React.createElement("pre", { style: { margin: 0, padding: 14, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflowX: "auto", whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12 } }, bug.curlCommand || "No cURL command added.")), !bug.curlCommand && /* @__PURE__ */ React.createElement("div", { className: "detail-section" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setShowCurl(true) }, "+ Show cURL field")), /* @__PURE__ */ React.createElement("div", { className: "tabs" }, /* @__PURE__ */ React.createElement("button", { className: `tab ${tab === "comments" ? "active" : ""}`, onClick: () => setTab("comments") }, "\u{1F4AC} Comments (", bug.comments?.length || 0, ")"), /* @__PURE__ */ React.createElement("button", { className: `tab ${tab === "activity" ? "active" : ""}`, onClick: () => setTab("activity") }, "\u{1F4DC} Activity")), tab === "comments" && /* @__PURE__ */ React.createElement("div", null, bug.comments?.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "text-muted text-sm", style: { marginBottom: 12 } }, "No comments yet."), bug.comments?.map((c) => {
      const author = users.find((u) => u.id === c.authorId);
      return /* @__PURE__ */ React.createElement("div", { key: c.id, className: "comment" }, /* @__PURE__ */ React.createElement(Avatar, { user: author, size: "sm" }), /* @__PURE__ */ React.createElement("div", { className: "comment-body" }, /* @__PURE__ */ React.createElement("div", { className: "comment-meta" }, /* @__PURE__ */ React.createElement("span", { className: "comment-author" }, author?.name || "Unknown"), /* @__PURE__ */ React.createElement("span", { className: "comment-time" }, timeAgo(c.createdAt)), author?.id === currentUser.id && /* @__PURE__ */ React.createElement("button", { className: "btn-icon", style: { marginLeft: "auto", fontSize: 12 }, onClick: () => deleteComment(c.id) }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "comment-text" }, c.text)));
    }), /* @__PURE__ */ React.createElement("div", { className: "comment-input-wrap" }, /* @__PURE__ */ React.createElement(Avatar, { user: currentUser, size: "sm" }), /* @__PURE__ */ React.createElement("textarea", { placeholder: "Add a comment\u2026 (Ctrl+Enter to send)", value: comment, onChange: (e) => setComment(e.target.value), onKeyDown: (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addComment();
    } }), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary btn-sm", style: { alignSelf: "flex-end" }, onClick: addComment }, "Send"))), tab === "activity" && /* @__PURE__ */ React.createElement("div", null, !bug.activity || bug.activity.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "text-muted text-sm" }, "No activity recorded.") : bug.activity.map((a, i) => {
      const user = users.find((u) => u.id === a.userId);
      return /* @__PURE__ */ React.createElement("div", { key: a.id || i, className: "activity-item" }, /* @__PURE__ */ React.createElement("div", { className: "activity-dot" }), /* @__PURE__ */ React.createElement("div", { className: "activity-text" }, /* @__PURE__ */ React.createElement("strong", null, user?.name || "Someone"), a.type === "created" ? " created this issue" : a.type === "changed" ? ` changed ${a.field} from "${a.fromValue}" to "${a.toValue}"` : ` ${a.note}`, /* @__PURE__ */ React.createElement("span", { style: { marginLeft: 6, fontSize: 11, color: "var(--muted)" } }, timeAgo(a.createdAt))));
    }))), /* @__PURE__ */ React.createElement("div", { className: "detail-sidebar" }, /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16 } }, /* @__PURE__ */ React.createElement("div", { className: "detail-field" }, /* @__PURE__ */ React.createElement("div", { className: "detail-field-label" }, "Status"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: bug.status, onChange: (e) => updateField("status", e.target.value) }, ["To Do", "In Progress", "In Review", "Done"].map((s) => /* @__PURE__ */ React.createElement("option", { key: s }, s)))), /* @__PURE__ */ React.createElement("div", { className: "detail-field" }, /* @__PURE__ */ React.createElement("div", { className: "detail-field-label" }, "Priority"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: bug.priority, onChange: (e) => updateField("priority", e.target.value) }, ["Critical", "High", "Medium", "Low"].map((p) => /* @__PURE__ */ React.createElement("option", { key: p }, p)))), /* @__PURE__ */ React.createElement("div", { className: "detail-field" }, /* @__PURE__ */ React.createElement("div", { className: "detail-field-label" }, "Assignee"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: bug.assigneeId || "", onChange: (e) => updateField("assigneeId", e.target.value), disabled: !projectPermissions.has("ASSIGN_ISSUE") }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Unassigned"), users.map((u) => /* @__PURE__ */ React.createElement("option", { key: u.id, value: u.id }, u.name))), !projectPermissions.has("ASSIGN_ISSUE") && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)", marginTop: 6 } }, "You do not have permission to reassign this issue.")), /* @__PURE__ */ React.createElement("hr", { className: "divider" }), /* @__PURE__ */ React.createElement("div", { className: "detail-field" }, /* @__PURE__ */ React.createElement("div", { className: "detail-field-label" }, "Project"), /* @__PURE__ */ React.createElement("div", { className: "detail-field-value", style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 10, height: 10, borderRadius: "50%", background: project?.color } }), project?.name)), /* @__PURE__ */ React.createElement("div", { className: "detail-field" }, /* @__PURE__ */ React.createElement("div", { className: "detail-field-label" }, "Reporter"), /* @__PURE__ */ React.createElement("div", { className: "detail-field-value", style: { display: "flex", alignItems: "center", gap: 6 } }, reporter ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Avatar, { user: reporter, size: "xs" }), reporter.name) : "Unknown")), /* @__PURE__ */ React.createElement("hr", { className: "divider" }), /* @__PURE__ */ React.createElement("div", { className: "detail-field" }, /* @__PURE__ */ React.createElement("div", { className: "detail-field-label" }, "Created"), /* @__PURE__ */ React.createElement("div", { className: "detail-field-value text-sm text-muted" }, formatIssueCreatedDate(bug))), /* @__PURE__ */ React.createElement("div", { className: "detail-field" }, /* @__PURE__ */ React.createElement("div", { className: "detail-field-label" }, "Updated"), /* @__PURE__ */ React.createElement("div", { className: "detail-field-value text-sm text-muted" }, timeAgo(bug.updatedAt))))))));
  }
  function Dashboard({ projects, users, currentProject, onSelectProject, currentUser, toast, onSyncComplete }) {
    const [stats, setStats] = useState(null);
    const [allBugs, setAllBugs] = useState([]);
    const [selectedBug, setSelectedBug] = useState(null);
    const [chartsReady, setChartsReady] = useState(false);
    const [page, setPage] = useState(1);
    const pageSize = 20;
    const projectOptions = [{ value: "", label: "All Projects" }, ...projects.map((project) => ({ value: project.id, label: project.name }))];
    const lineRef = useRef(null), doughnutRef = useRef(null), barRef = useRef(null);
    const lineChart = useRef(null), doughnutChart = useRef(null), barChart = useRef(null);
    const {
      showExportFilters,
      exportFilters,
      setExportFilter,
      openExportModal,
      closeExportModal,
      resetExportFilters,
      exportReport
    } = useProjectReportExport({ currentProject, projects, users, toast });
    useEffect(() => {
      const statsUrl = currentProject ? `/api/stats?projectId=${currentProject.id}` : "/api/stats";
      const bugsUrl = currentProject ? `/api/bugs?projectId=${currentProject.id}` : "/api/bugs";
      api.get(statsUrl).then(setStats);
      api.get(bugsUrl).then(setAllBugs);
      setPage(1);
    }, [currentProject]);
    useEffect(() => {
      let active = true;
      if (!stats || stats.error || !Array.isArray(stats.daily) || !stats.byStatus || !stats.byPriority) return;
      setChartsReady(false);
      ensureChartJsLoaded().then((ChartLib) => {
        if (!active || !lineRef.current || !doughnutRef.current || !barRef.current) return;
        setChartsReady(true);
        if (lineChart.current) lineChart.current.destroy();
        lineChart.current = new ChartLib(lineRef.current, { type: "line", data: { labels: stats.daily.map((d) => d.label), datasets: [{ label: "Issues", data: stats.daily.map((d) => d.count), borderColor: "#6366f1", backgroundColor: "rgba(99,102,241,.15)", tension: 0.4, fill: true, pointBackgroundColor: "#6366f1", pointRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: "#334155" }, ticks: { color: "#94a3b8" } }, y: { grid: { color: "#334155" }, ticks: { color: "#94a3b8", stepSize: 1 } } } } });
        if (doughnutChart.current) doughnutChart.current.destroy();
        doughnutChart.current = new ChartLib(doughnutRef.current, { type: "doughnut", data: { labels: Object.keys(stats.byStatus), datasets: [{ data: Object.values(stats.byStatus), backgroundColor: ["#475569", "#6366f1", "#fbbf24", "#10b981"], borderWidth: 0, hoverOffset: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: "#94a3b8", boxWidth: 12, font: { size: 11 } } } } } });
        if (barChart.current) barChart.current.destroy();
        barChart.current = new ChartLib(barRef.current, { type: "bar", data: { labels: Object.keys(stats.byPriority), datasets: [{ label: "Issues", data: Object.values(stats.byPriority), backgroundColor: ["#ef4444", "#fb923c", "#fbbf24", "#94a3b8"], borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: "#94a3b8" } }, y: { grid: { color: "#334155" }, ticks: { color: "#94a3b8", stepSize: 1 } } } } });
      }).catch(() => {
        if (active) setChartsReady(false);
      });
      return () => {
        active = false;
        if (lineChart.current) lineChart.current.destroy();
        if (doughnutChart.current) doughnutChart.current.destroy();
        if (barChart.current) barChart.current.destroy();
      };
    }, [stats]);
    if (!stats) return /* @__PURE__ */ React.createElement("div", { style: { color: "var(--muted)", padding: 40, textAlign: "center" } }, "Loading dashboard\u2026");
    if (stats.error) {
      return /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { className: "icon" }, "\u{1F512}"), /* @__PURE__ */ React.createElement("h3", null, "Dashboard Unavailable"), /* @__PURE__ */ React.createElement("p", null, stats.error));
    }
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "page-header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", null, "Dashboard"), /* @__PURE__ */ React.createElement("p", null, currentProject ? currentProject.name : "All Projects", " \xB7 Overview")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
      SearchableSelect,
      {
        value: currentProject?.id || "",
        onChange: (value) => onSelectProject?.(value || null),
        options: projectOptions,
        placeholder: "All Projects",
        width: 220
      }
    ), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: openExportModal }, "Export Report"))), /* @__PURE__ */ React.createElement("div", { className: "stats-grid" }, [{ label: "Total Issues", value: stats.total, sub: "across all statuses", color: "#6366f1" }, { label: "Open Issues", value: stats.openCount, sub: "need attention", color: "#f59e0b" }, { label: "Completed", value: stats.doneCount, sub: "marked as done", color: "#10b981" }, { label: "Critical", value: stats.byPriority.Critical, sub: "critical priority", color: "#ef4444" }].map((card) => /* @__PURE__ */ React.createElement("div", { key: card.label, className: "stat-card" }, /* @__PURE__ */ React.createElement("div", { className: "label" }, card.label), /* @__PURE__ */ React.createElement("div", { className: "value", style: { color: card.color } }, card.value), /* @__PURE__ */ React.createElement("div", { className: "sub" }, card.sub)))), /* @__PURE__ */ React.createElement("div", { className: "charts-grid" }, /* @__PURE__ */ React.createElement("div", { className: "chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "Issues Created (Last 7 Days)"), /* @__PURE__ */ React.createElement("div", { className: "chart-wrap" }, !chartsReady && /* @__PURE__ */ React.createElement("div", { style: { color: "var(--muted)", fontSize: 12, padding: "24px 0", textAlign: "center" } }, "Loading chart\u2026"), /* @__PURE__ */ React.createElement("canvas", { ref: lineRef, style: { display: chartsReady ? "block" : "none" } }))), /* @__PURE__ */ React.createElement("div", { className: "chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "By Status"), /* @__PURE__ */ React.createElement("div", { className: "chart-wrap" }, !chartsReady && /* @__PURE__ */ React.createElement("div", { style: { color: "var(--muted)", fontSize: 12, padding: "24px 0", textAlign: "center" } }, "Loading chart\u2026"), /* @__PURE__ */ React.createElement("canvas", { ref: doughnutRef, style: { display: chartsReady ? "block" : "none" } }))), /* @__PURE__ */ React.createElement("div", { className: "chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "By Priority"), /* @__PURE__ */ React.createElement("div", { className: "chart-wrap" }, !chartsReady && /* @__PURE__ */ React.createElement("div", { style: { color: "var(--muted)", fontSize: 12, padding: "24px 0", textAlign: "center" } }, "Loading chart\u2026"), /* @__PURE__ */ React.createElement("canvas", { ref: barRef, style: { display: chartsReady ? "block" : "none" } })))), (() => {
      const totalPages = Math.max(1, Math.ceil(allBugs.length / pageSize));
      const currentPage = Math.min(page, totalPages);
      const paginatedBugs = allBugs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
      return /* @__PURE__ */ React.createElement("div", { className: "table-card", style: { padding: 20 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 } }, /* @__PURE__ */ React.createElement("h3", { style: { fontSize: 13, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", margin: 0 } }, "Issues"), /* @__PURE__ */ React.createElement(SyncTimestamp, { toast, onSyncComplete })), allBugs.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { color: "var(--muted)", fontSize: 13, padding: "16px 0", textAlign: "center" } }, "No issues found.") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(IssueTable, { bugs: paginatedBugs, users, projects, currentProject, onSelectBug: setSelectedBug }), totalPages > 1 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 0 0", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--muted)" } }, "Showing ", (currentPage - 1) * pageSize + 1, "\u2013", Math.min(currentPage * pageSize, allBugs.length), " of ", allBugs.length), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", disabled: currentPage === 1, onClick: () => setPage((p) => Math.max(1, p - 1)) }, "Previous"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--muted)" } }, "Page ", currentPage, " of ", totalPages), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", disabled: currentPage === totalPages, onClick: () => setPage((p) => Math.min(totalPages, p + 1)) }, "Next")))));
    })(), selectedBug && /* @__PURE__ */ React.createElement(BugDetail, { bugId: selectedBug, projects, users, currentUser, onClose: () => setSelectedBug(null), toast, onUpdate: async () => {
      const statsUrl = currentProject ? `/api/stats?projectId=${currentProject.id}` : "/api/stats";
      const bugsUrl = currentProject ? `/api/bugs?projectId=${currentProject.id}` : "/api/bugs";
      const [nextStats, nextBugs] = await Promise.all([api.get(statsUrl), api.get(bugsUrl)]);
      setStats(nextStats);
      setAllBugs(nextBugs);
    }, onDelete: async (id) => {
      setAllBugs((bs) => bs.filter((b) => b.id !== id));
      setSelectedBug(null);
      const statsUrl = currentProject ? `/api/stats?projectId=${currentProject.id}` : "/api/stats";
      const bugsUrl = currentProject ? `/api/bugs?projectId=${currentProject.id}` : "/api/bugs";
      const [nextStats, nextBugs] = await Promise.all([api.get(statsUrl), api.get(bugsUrl)]);
      setStats(nextStats);
      setAllBugs(nextBugs);
    } }), /* @__PURE__ */ React.createElement(ExportReportFiltersModal, { visible: showExportFilters, onClose: closeExportModal, currentProject, projects, users, exportFilters, setExportFilter, onReset: resetExportFilters, onExport: exportReport }));
  }
  function BugList({ projects, users, currentProject, toast, currentUser, onSyncComplete }) {
    const [bugs, setBugs] = useState([]);
    const [filters, setFilters] = useState({ status: "", priority: "", type: "", assigneeId: "", search: "" });
    const [showCreate, setShowCreate] = useState(false);
    const [selectedBug, setSelectedBug] = useState(null);
    const [showMetrics, setShowMetrics] = useState(false);
    const [metricsStats, setMetricsStats] = useState(null);
    const [metricsChartsReady, setMetricsChartsReady] = useState(false);
    const [page, setPage] = useState(1);
    const statusOptions = ["To Do", "In Progress", "In Review", "Done"].map((value) => ({ value, label: value }));
    const priorityOptions = ["Critical", "High", "Medium", "Low"].map((value) => ({ value, label: value }));
    const typeOptions = ["Bug", "Feature", "Task", "Improvement"].map((value) => ({ value, label: value }));
    const assigneeOptions = users.map((user) => ({ value: user.id, label: user.name }));
    const pageSize = 20;
    const metricsLineRef = useRef(null), metricsDoughnutRef = useRef(null), metricsBarRef = useRef(null);
    const metricsLineChart = useRef(null), metricsDoughnutChart = useRef(null), metricsBarChart = useRef(null);
    const { showExportFilters, exportFilters, setExportFilter, openExportModal, closeExportModal, resetExportFilters, exportReport } = useProjectReportExport({ currentProject, projects, users, toast });
    const load = useCallback(() => {
      const params = new URLSearchParams();
      if (currentProject) params.set("projectId", currentProject.id);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      api.get(`/api/bugs?${params}`).then(setBugs);
    }, [currentProject, filters]);
    useEffect(() => {
      load();
    }, [load]);
    useEffect(() => {
      setPage(1);
    }, [currentProject, filters.status, filters.priority, filters.type, filters.assigneeId, filters.search]);
    useEffect(() => {
      if (!showMetrics) return;
      const statsUrl = currentProject ? `/api/stats?projectId=${currentProject.id}` : "/api/stats";
      api.get(statsUrl).then(setMetricsStats);
    }, [showMetrics, currentProject]);
    useEffect(() => {
      let active = true;
      if (!showMetrics || !metricsStats || metricsStats.error || !Array.isArray(metricsStats.daily) || !metricsStats.byStatus || !metricsStats.byPriority) return;
      setMetricsChartsReady(false);
      ensureChartJsLoaded().then((ChartLib) => {
        if (!active || !metricsLineRef.current || !metricsDoughnutRef.current || !metricsBarRef.current) return;
        setMetricsChartsReady(true);
        if (metricsLineChart.current) metricsLineChart.current.destroy();
        metricsLineChart.current = new ChartLib(metricsLineRef.current, { type: "line", data: { labels: metricsStats.daily.map((d) => d.label), datasets: [{ label: "Issues", data: metricsStats.daily.map((d) => d.count), borderColor: "#6366f1", backgroundColor: "rgba(99,102,241,.15)", tension: 0.4, fill: true, pointBackgroundColor: "#6366f1", pointRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: "#334155" }, ticks: { color: "#94a3b8" } }, y: { grid: { color: "#334155" }, ticks: { color: "#94a3b8", stepSize: 1 } } } } });
        if (metricsDoughnutChart.current) metricsDoughnutChart.current.destroy();
        metricsDoughnutChart.current = new ChartLib(metricsDoughnutRef.current, { type: "doughnut", data: { labels: Object.keys(metricsStats.byStatus), datasets: [{ data: Object.values(metricsStats.byStatus), backgroundColor: ["#475569", "#6366f1", "#fbbf24", "#10b981"], borderWidth: 0, hoverOffset: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: "#94a3b8", boxWidth: 12, font: { size: 11 } } } } } });
        if (metricsBarChart.current) metricsBarChart.current.destroy();
        metricsBarChart.current = new ChartLib(metricsBarRef.current, { type: "bar", data: { labels: Object.keys(metricsStats.byPriority), datasets: [{ label: "Issues", data: Object.values(metricsStats.byPriority), backgroundColor: ["#ef4444", "#fb923c", "#fbbf24", "#94a3b8"], borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: "#94a3b8" } }, y: { grid: { color: "#334155" }, ticks: { color: "#94a3b8", stepSize: 1 } } } } });
      }).catch(() => {
        if (active) setMetricsChartsReady(false);
      });
      return () => {
        active = false;
        if (metricsLineChart.current) metricsLineChart.current.destroy();
        if (metricsDoughnutChart.current) metricsDoughnutChart.current.destroy();
        if (metricsBarChart.current) metricsBarChart.current.destroy();
      };
    }, [showMetrics, metricsStats]);
    const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
    const totalPages = Math.max(1, Math.ceil(bugs.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const paginatedBugs = bugs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "page-header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", null, "Issue List"), /* @__PURE__ */ React.createElement("p", null, currentProject ? currentProject.name : "All Projects", " - ", bugs.length, " issue", bugs.length !== 1 ? "s" : "")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: () => setShowMetrics((v) => !v) }, showMetrics ? "Hide Metrics" : "Show Metrics"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: openExportModal }, "Export Report"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: () => setShowCreate(true) }, "+ Create Issue"))), /* @__PURE__ */ React.createElement("div", { className: "filters-bar" }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("span", { className: "search-icon" }, "\u{1F50D}"), /* @__PURE__ */ React.createElement("input", { style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "7px 12px 7px 32px", color: "var(--text)", outline: "none", width: 220 }, placeholder: "Search issues\u2026", value: filters.search, onChange: (e) => setFilter("search", e.target.value) })), /* @__PURE__ */ React.createElement(SearchableSelect, { value: filters.status, onChange: (value) => setFilter("status", value), options: statusOptions, placeholder: "All Statuses", width: 150 }), /* @__PURE__ */ React.createElement(SearchableSelect, { value: filters.priority, onChange: (value) => setFilter("priority", value), options: priorityOptions, placeholder: "All Priorities", width: 150 }), /* @__PURE__ */ React.createElement(SearchableSelect, { value: filters.type, onChange: (value) => setFilter("type", value), options: typeOptions, placeholder: "All Types", width: 150 }), /* @__PURE__ */ React.createElement(SearchableSelect, { value: filters.assigneeId, onChange: (value) => setFilter("assigneeId", value), options: assigneeOptions, placeholder: "All Assignees", width: 230 }), Object.values(filters).some(Boolean) && /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => {
      setFilters({ status: "", priority: "", type: "", assigneeId: "", search: "" });
      setPage(1);
    } }, "Clear \u2715")), showMetrics && metricsStats && !metricsStats.error && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "stats-grid", style: { marginBottom: 20 } }, [{ label: "Total Issues", value: metricsStats.total, sub: "across all statuses", color: "#6366f1" }, { label: "Open Issues", value: metricsStats.openCount, sub: "need attention", color: "#f59e0b" }, { label: "Completed", value: metricsStats.doneCount, sub: "marked as done", color: "#10b981" }, { label: "Critical", value: metricsStats.byPriority.Critical, sub: "critical priority", color: "#ef4444" }].map((card) => /* @__PURE__ */ React.createElement("div", { key: card.label, className: "stat-card" }, /* @__PURE__ */ React.createElement("div", { className: "label" }, card.label), /* @__PURE__ */ React.createElement("div", { className: "value", style: { color: card.color } }, card.value), /* @__PURE__ */ React.createElement("div", { className: "sub" }, card.sub)))), /* @__PURE__ */ React.createElement("div", { className: "charts-grid", style: { marginBottom: 20 } }, /* @__PURE__ */ React.createElement("div", { className: "chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "Issues Created (Last 7 Days)"), /* @__PURE__ */ React.createElement("div", { className: "chart-wrap" }, !metricsChartsReady && /* @__PURE__ */ React.createElement("div", { style: { color: "var(--muted)", fontSize: 12, padding: "24px 0", textAlign: "center" } }, "Loading chart..."), /* @__PURE__ */ React.createElement("canvas", { ref: metricsLineRef, style: { display: metricsChartsReady ? "block" : "none" } }))), /* @__PURE__ */ React.createElement("div", { className: "chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "By Status"), /* @__PURE__ */ React.createElement("div", { className: "chart-wrap" }, !metricsChartsReady && /* @__PURE__ */ React.createElement("div", { style: { color: "var(--muted)", fontSize: 12, padding: "24px 0", textAlign: "center" } }, "Loading chart..."), /* @__PURE__ */ React.createElement("canvas", { ref: metricsDoughnutRef, style: { display: metricsChartsReady ? "block" : "none" } }))), /* @__PURE__ */ React.createElement("div", { className: "chart-card" }, /* @__PURE__ */ React.createElement("h3", null, "By Priority"), /* @__PURE__ */ React.createElement("div", { className: "chart-wrap" }, !metricsChartsReady && /* @__PURE__ */ React.createElement("div", { style: { color: "var(--muted)", fontSize: 12, padding: "24px 0", textAlign: "center" } }, "Loading chart..."), /* @__PURE__ */ React.createElement("canvas", { ref: metricsBarRef, style: { display: metricsChartsReady ? "block" : "none" } }))))), showMetrics && metricsStats?.error && /* @__PURE__ */ React.createElement("div", { className: "empty-state", style: { marginBottom: 20 } }, /* @__PURE__ */ React.createElement("div", { className: "icon" }, "!"), /* @__PURE__ */ React.createElement("h3", null, "Metrics Unavailable"), /* @__PURE__ */ React.createElement("p", null, metricsStats.error)), bugs.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { className: "icon" }, "\u{1F389}"), /* @__PURE__ */ React.createElement("h3", null, "No issues found"), /* @__PURE__ */ React.createElement("p", null, "Try adjusting your filters or create a new issue.")) : /* @__PURE__ */ React.createElement("div", { className: "table-card" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 16px 0" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" } }, "Recent Issues"), /* @__PURE__ */ React.createElement(SyncTimestamp, { toast, onSyncComplete })), /* @__PURE__ */ React.createElement(IssueTable, { bugs: paginatedBugs, users, projects, currentProject, onSelectBug: setSelectedBug }), totalPages > 1 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 16px 16px", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--muted)" } }, "Showing ", (currentPage - 1) * pageSize + 1, "-", Math.min(currentPage * pageSize, bugs.length), " of ", bugs.length), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", disabled: currentPage === 1, onClick: () => setPage((p) => Math.max(1, p - 1)) }, "Previous"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--muted)" } }, "Page ", currentPage, " of ", totalPages), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", disabled: currentPage === totalPages, onClick: () => setPage((p) => Math.min(totalPages, p + 1)) }, "Next")))), showCreate && /* @__PURE__ */ React.createElement(BugModal, { projects, users, currentProject, onClose: () => setShowCreate(false), toast, onSave: () => {
      load();
      setShowCreate(false);
    } }), selectedBug && /* @__PURE__ */ React.createElement(BugDetail, { bugId: selectedBug, projects, users, currentUser, onClose: () => setSelectedBug(null), toast, onUpdate: () => load(), onDelete: async (id) => {
      setBugs((bs) => bs.filter((b) => b.id !== id));
      setSelectedBug(null);
      await load();
    } }), /* @__PURE__ */ React.createElement(ExportReportFiltersModal, { visible: showExportFilters, onClose: closeExportModal, currentProject, projects, users, exportFilters, setExportFilter, onReset: resetExportFilters, onExport: exportReport }));
  }
  function ProjectModal({ onClose, onCreate }) {
    const [form, setForm] = useState({ name: "", key: "", description: "", color: "#6366f1" });
    const create = async (e) => {
      e.preventDefault();
      if (!form.name || !form.key) return;
      await onCreate(form);
      setForm({ name: "", key: "", description: "", color: "#6366f1" });
    };
    return /* @__PURE__ */ React.createElement(Modal, { onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, "New Project"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: onClose }, "X")), /* @__PURE__ */ React.createElement("form", { onSubmit: create }, /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Project Name *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.name, onChange: (e) => setForm((f) => ({ ...f, name: e.target.value, key: e.target.value.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 4) })), required: true, autoFocus: true })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Project Key *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.key, onChange: (e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() })), required: true, maxLength: 6 })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Description"), /* @__PURE__ */ React.createElement("textarea", { className: "form-textarea", value: form.description, onChange: (e) => setForm((f) => ({ ...f, description: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Colour"), /* @__PURE__ */ React.createElement("div", { className: "color-swatches" }, COLORS.map((c) => /* @__PURE__ */ React.createElement("div", { key: c, className: `swatch ${form.color === c ? "selected" : ""}`, style: { background: c }, onClick: () => setForm((f) => ({ ...f, color: c })) }))))), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost", onClick: onClose }, "Cancel"), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary" }, "Create Project"))));
  }
  function ProjectsPage({ projects, setProjects, toast, onProjectCreated }) {
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ name: "", key: "", description: "", color: "#6366f1" });
    const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#38bdf8", "#ec4899", "#8b5cf6", "#14b8a6"];
    const create = async (e) => {
      e.preventDefault();
      if (!form.name || !form.key) return;
      const p = await api.post("/api/projects", form);
      setProjects((ps) => [...ps, p]);
      setForm({ name: "", key: "", description: "", color: "#6366f1" });
      setShowCreate(false);
      onProjectCreated?.(p);
      toast("Project created", "success");
    };
    const del = async (id) => {
      await api.delete(`/api/projects/${id}`);
      setProjects((ps) => ps.filter((p) => p.id !== id));
      toast("Project deleted", "info");
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "page-header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", null, "Projects"), /* @__PURE__ */ React.createElement("p", null, projects.length, " project", projects.length !== 1 ? "s" : "")), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: () => setShowCreate(true) }, "+ New Project")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 } }, projects.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 20, borderTop: `3px solid ${p.color}` } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 36, height: 36, borderRadius: 8, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#fff", fontSize: 14 } }, p.key), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600 } }, p.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)" } }, p.key))), /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger btn-sm", onClick: () => del(p.id) }, "Delete")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--muted)", lineHeight: 1.5 } }, p.description || "No description."), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)", marginTop: 10 } }, "Created ", new Date(p.createdAt).toLocaleDateString())))), showCreate && /* @__PURE__ */ React.createElement(Modal, { onClose: () => setShowCreate(false) }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, "New Project"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: () => setShowCreate(false) }, "\u2715")), /* @__PURE__ */ React.createElement("form", { onSubmit: create }, /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Project Name *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.name, onChange: (e) => setForm((f) => ({ ...f, name: e.target.value, key: e.target.value.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 4) })), required: true })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Project Key *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.key, onChange: (e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() })), required: true, maxLength: 6 })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Description"), /* @__PURE__ */ React.createElement("textarea", { className: "form-textarea", value: form.description, onChange: (e) => setForm((f) => ({ ...f, description: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Colour"), /* @__PURE__ */ React.createElement("div", { className: "color-swatches" }, colors.map((c) => /* @__PURE__ */ React.createElement("div", { key: c, className: `swatch ${form.color === c ? "selected" : ""}`, style: { background: c }, onClick: () => setForm((f) => ({ ...f, color: c })) }))))), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost", onClick: () => setShowCreate(false) }, "Cancel"), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary" }, "Create Project")))));
  }
  function MemberDashboard({ member, bugs, projects, users, onBack, toast, currentUser }) {
    const [filterStatus, setFilterStatus] = useState("");
    const [filterPriority, setFilterPriority] = useState("");
    const [filterProject, setFilterProject] = useState("");
    const [filterAssignedBy, setFilterAssignedBy] = useState("");
    const [selectedBug, setSelectedBug] = useState(null);
    const [localBugs, setLocalBugs] = useState(bugs);
    useEffect(() => setLocalBugs(bugs), [bugs]);
    const memberBugs = localBugs.filter((b) => b.assigneeId === member.id);
    const total = memberBugs.length;
    const done = memberBugs.filter((b) => b.status === "Done").length;
    const inProgress = memberBugs.filter((b) => b.status === "In Progress").length;
    const inReview = memberBugs.filter((b) => b.status === "In Review").length;
    const todo = memberBugs.filter((b) => b.status === "To Do").length;
    const critical = memberBugs.filter((b) => b.priority === "Critical").length;
    const resolveRate = total > 0 ? Math.round(done / total * 100) : 0;
    const assignedByOptions = [...new Map(
      memberBugs.filter((b) => b.reporterId).map((b) => {
        const u = users.find((u2) => u2.id === b.reporterId);
        return [b.reporterId, u ? u.name : "Unknown"];
      })
    ).entries()].map(([id, name]) => ({ id, name }));
    const filtered = memberBugs.filter((b) => {
      if (filterStatus && b.status !== filterStatus) return false;
      if (filterPriority && b.priority !== filterPriority) return false;
      if (filterProject && String(b.projectId) !== String(filterProject)) return false;
      if (filterAssignedBy && String(b.reporterId) !== String(filterAssignedBy)) return false;
      return true;
    });
    const activeFilters = [filterStatus, filterPriority, filterProject, filterAssignedBy].filter(Boolean).length;
    const clearFilters = () => {
      setFilterStatus("");
      setFilterPriority("");
      setFilterProject("");
      setFilterAssignedBy("");
    };
    const statusOptions = ["To Do", "In Progress", "In Review", "Done"].map((value) => ({ value, label: value }));
    const priorityOptions = ["Critical", "High", "Medium", "Low"].map((value) => ({ value, label: value }));
    const projectOptions = projects.filter((project) => memberBugs.some((b) => b.projectId === project.id)).map((project) => ({ value: project.id, label: project.name }));
    const assignedBySearchOptions = assignedByOptions.map((option) => ({ value: option.id, label: option.name }));
    return /* @__PURE__ */ React.createElement("div", { className: "member-dashboard" }, /* @__PURE__ */ React.createElement("div", { className: "member-dashboard-header" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: onBack }, "\u2190 Back to Team"), /* @__PURE__ */ React.createElement("div", { className: "member-dashboard-identity" }, /* @__PURE__ */ React.createElement("div", { className: "member-dashboard-avatar" }, member.avatar && member.avatar.startsWith("data:image/") ? /* @__PURE__ */ React.createElement("img", { src: member.avatar, alt: member.name, style: { width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" } }) : /* @__PURE__ */ React.createElement("span", null, member.avatar || getInitials(member.name))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { fontSize: 20, fontWeight: 700, margin: 0 } }, member.name), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--muted)" } }, member.email), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 600, color: "#fff", background: ROLE_COLORS[member.role] || "#6366f1", padding: "2px 8px", borderRadius: 99 } }, ROLE_LABELS[member.role] || member.role))))), /* @__PURE__ */ React.createElement("div", { className: "member-stat-row" }, [
      { label: "Total Assigned", value: total, color: "var(--primary)" },
      { label: "To Do", value: todo, color: "var(--muted)" },
      { label: "In Progress", value: inProgress, color: "var(--primary)" },
      { label: "In Review", value: inReview, color: "var(--warning)" },
      { label: "Resolved", value: done, color: "var(--success)" },
      { label: "Critical", value: critical, color: "var(--danger)" },
      { label: "Resolve Rate", value: resolveRate + "%", color: "var(--success)" }
    ].map((s) => /* @__PURE__ */ React.createElement("div", { key: s.label, className: "member-stat-card" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22, fontWeight: 700, color: s.color } }, s.value), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)", marginTop: 2 } }, s.label)))), /* @__PURE__ */ React.createElement("div", { className: "member-filters" }, /* @__PURE__ */ React.createElement(SearchableSelect, { value: filterStatus, onChange: setFilterStatus, options: statusOptions, placeholder: "All Statuses", width: 150 }), /* @__PURE__ */ React.createElement(SearchableSelect, { value: filterPriority, onChange: setFilterPriority, options: priorityOptions, placeholder: "All Priorities", width: 160 }), /* @__PURE__ */ React.createElement(SearchableSelect, { value: filterProject, onChange: setFilterProject, options: projectOptions, placeholder: "All Projects", width: 200 }), /* @__PURE__ */ React.createElement(SearchableSelect, { value: filterAssignedBy, onChange: setFilterAssignedBy, options: assignedBySearchOptions, placeholder: "Assigned By (all)", width: 180 }), activeFilters > 0 && /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: clearFilters }, "\u2715 Clear (", activeFilters, ")"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 12, color: "var(--muted)", alignSelf: "center" } }, filtered.length, " issue", filtered.length !== 1 ? "s" : "")), /* @__PURE__ */ React.createElement("div", { className: "member-issue-table-wrap" }, filtered.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "40px 0", color: "var(--muted)", fontSize: 14 } }, "No issues match the current filters.") : /* @__PURE__ */ React.createElement("table", { className: "bug-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Key"), /* @__PURE__ */ React.createElement("th", null, "Title"), /* @__PURE__ */ React.createElement("th", null, "Project"), /* @__PURE__ */ React.createElement("th", null, "Status"), /* @__PURE__ */ React.createElement("th", null, "Priority"), /* @__PURE__ */ React.createElement("th", null, "Type"), /* @__PURE__ */ React.createElement("th", null, "Assigned By"), /* @__PURE__ */ React.createElement("th", null, "Created"))), /* @__PURE__ */ React.createElement("tbody", null, filtered.map((b) => {
      const proj = projects.find((p) => p.id === b.projectId);
      const reporter = b.reporterId ? users.find((u) => u.id === b.reporterId) : null;
      return /* @__PURE__ */ React.createElement("tr", { key: b.id, style: { cursor: "pointer" }, onClick: () => setSelectedBug(b.id) }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 12, color: "var(--muted)" } }, b.key || `#${b.id}`)), /* @__PURE__ */ React.createElement("td", { style: { maxWidth: 280 } }, /* @__PURE__ */ React.createElement("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 } }, b.title)), /* @__PURE__ */ React.createElement("td", null, proj && /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 5 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 8, height: 8, borderRadius: "50%", background: proj.color, flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12 } }, proj.name))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(StatusBadge, { s: b.status })), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(PriorityBadge, { p: b.priority })), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(TypeBadge, { t: b.type })), /* @__PURE__ */ React.createElement("td", null, reporter ? /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement(Avatar, { user: reporter, size: "xs" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12 } }, reporter.name)) : /* @__PURE__ */ React.createElement("span", { style: { color: "var(--muted)", fontSize: 12 } }, "\u2014")), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" } }, formatDate(b.createdAt)));
    })))), selectedBug && /* @__PURE__ */ React.createElement(
      BugDetail,
      {
        bugId: selectedBug,
        projects,
        users,
        onClose: () => setSelectedBug(null),
        onUpdate: (updated) => setLocalBugs((bs) => bs.map((b) => b.id === updated.id ? updated : b)),
        onDelete: (id) => {
          setLocalBugs((bs) => bs.filter((b) => b.id !== id));
          setSelectedBug(null);
        },
        toast,
        currentUser
      }
    ));
  }
  function TeamPage({ users, setUsers, bugs, bugsLoading, setBugs, toast, currentUser, onCurrentUserUpdated, projects }) {
    const isAdmin = currentUser?.role === "admin";
    const [selectedMember, setSelectedMember] = useState(null);
    const [showAdd, setShowAdd] = useState(false);
    const [reassignTarget, setReassignTarget] = useState(null);
    const [reassignToId, setReassignToId] = useState("");
    const [form, setForm] = useState({ name: "", email: "", role: "developer", color: "#6366f1" });
    const [avatarFile, setAvatarFile] = useState(null);
    const [newCredentials, setNewCredentials] = useState(null);
    const [resetTarget, setResetTarget] = useState(null);
    const [resetResult, setResetResult] = useState(null);
    const [copied, setCopied] = useState(false);
    const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const loadMembers = () => api.get("/api/members").then(setUsers);
    const add = async (e) => {
      e.preventDefault();
      if (!form.name.trim() || !form.email.trim()) return;
      const avatarDataUrl = avatarFile ? await readImageAsDataUrl(avatarFile) : null;
      const res = await api.post("/api/members", { ...form, avatarDataUrl });
      if (res.error) {
        toast(res.error, "error");
        return;
      }
      const { tempPassword, ...member } = res;
      setUsers((us) => [...us, member]);
      setForm({ name: "", email: "", role: "developer", color: "#6366f1" });
      setShowAdd(false);
      setNewCredentials({ name: member.name, email: member.email, tempPassword });
      toast("Member added", "success");
    };
    const changeRole = async (id, role) => {
      const res = await api.put(`/api/members/${id}`, { role });
      if (res.error) {
        toast(res.error, "error");
        return;
      }
      setUsers((us) => us.map((u) => u.id === id ? { ...u, role } : u));
      toast("Role updated", "success");
    };
    const updatePhoto = async (member, file) => {
      if (!file) return;
      const avatarDataUrl = await readImageAsDataUrl(file);
      const isSelf = member.id === currentUser?.id;
      const res = isSelf ? await api.put("/api/auth/me/photo", { avatarDataUrl }) : await api.put(`/api/members/${member.id}`, { avatarDataUrl });
      if (res.error) {
        toast(res.error, "error");
        return;
      }
      setUsers((us) => us.map((u) => u.id === member.id ? res : u));
      if (isSelf && onCurrentUserUpdated) onCurrentUserUpdated(res);
      toast("Photo updated", "success");
    };
    const removeMember = async (id) => {
      if (!confirm("Remove this member from the company?")) return;
      await api.delete(`/api/members/${id}`);
      setUsers((us) => us.filter((u) => u.id !== id));
      toast("Member removed", "info");
    };
    const reassignMemberIssues = async () => {
      if (!reassignTarget || !reassignToId) {
        toast("Select a member to move the issues to", "error");
        return;
      }
      const res = await api.post(`/api/members/${reassignTarget.id}/reassign`, { targetUserId: reassignToId });
      if (res.error) {
        toast(res.error, "error");
        return;
      }
      if (setBugs) {
        setBugs((current) => current.map(
          (bug) => bug.assigneeId === reassignTarget.id ? { ...bug, assigneeId: reassignToId, updatedAt: (/* @__PURE__ */ new Date()).toISOString() } : bug
        ));
      }
      setReassignTarget(null);
      setReassignToId("");
      toast(`${res.movedCount || 0} issue${res.movedCount === 1 ? "" : "s"} moved successfully`, "success");
    };
    const resetPassword = async (id) => {
      const member = users.find((u) => u.id === id);
      const res = await api.post(`/api/members/${id}/reset-password`, {});
      if (res.error) {
        toast(res.error, "error");
        return;
      }
      setResetTarget(null);
      setResetResult({ name: member?.name, email: member?.email, tempPassword: res.tempPassword });
    };
    const copyToClipboard = (text) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2e3);
      });
    };
    const [search, setSearch] = useState("");
    const roleOrder = { admin: 0, project_manager: 1, developer: 2, frontend_developer: 3, backend_developer: 4, tester: 5, qa: 5, viewer: 6 };
    const sorted = [...users].sort((a, b) => (roleOrder[a.role] || 9) - (roleOrder[b.role] || 9)).filter((u) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (ROLE_LABELS[u.role] || u.role).toLowerCase().includes(q);
    });
    const reassignOptions = users.filter((u) => u.id !== reassignTarget?.id).map((u) => ({ value: u.id, label: `${u.name} (${ROLE_LABELS[u.role] || u.role})` }));
    return /* @__PURE__ */ React.createElement("div", null, bugsLoading && !selectedMember && /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { className: "icon" }, "Loading..."), /* @__PURE__ */ React.createElement("h3", null, "Loading team metrics"), /* @__PURE__ */ React.createElement("p", null, "Preparing member issue counts.")), selectedMember && /* @__PURE__ */ React.createElement(
      MemberDashboard,
      {
        member: selectedMember,
        bugs,
        projects: projects || [],
        users,
        onBack: () => setSelectedMember(null),
        toast,
        currentUser
      }
    ), !selectedMember && !bugsLoading && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "page-header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", null, "Team Members"), /* @__PURE__ */ React.createElement("p", null, users.length, " member", users.length !== 1 ? "s" : "", " \xB7 ", users.filter((u) => u.role === "admin").length, " admin \xB7 ", users.filter((u) => u.role === "project_manager").length, " project manager \xB7 ", users.filter((u) => u.role === "developer").length, " developer \xB7 ", users.filter((u) => u.role === "frontend_developer").length, " frontend \xB7 ", users.filter((u) => u.role === "backend_developer").length, " backend \xB7 ", users.filter((u) => u.role === "tester" || u.role === "qa").length, " QA \xB7 ", users.filter((u) => u.role === "viewer").length, " viewer")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 14, pointerEvents: "none" } }, "\u{1F50D}"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        placeholder: "Search by name, email or role\u2026",
        value: search,
        onChange: (e) => setSearch(e.target.value),
        style: { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "7px 12px 7px 32px", color: "var(--text)", width: 240, outline: "none", fontSize: 13 },
        onFocus: (e) => e.target.style.borderColor = "var(--primary)",
        onBlur: (e) => e.target.style.borderColor = "var(--border)"
      }
    ), search && /* @__PURE__ */ React.createElement("button", { onClick: () => setSearch(""), style: { position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14, lineHeight: 1 } }, "\u2715")), isAdmin && /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: () => setShowAdd(true) }, "+ Add Member"))), search && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--muted)", marginBottom: 4 } }, sorted.length, " result", sorted.length !== 1 ? "s" : "", ' for "', /* @__PURE__ */ React.createElement("strong", null, search), '"'), sorted.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "48px 0", color: "var(--muted)", fontSize: 14 } }, 'No members match "', /* @__PURE__ */ React.createElement("strong", null, search), '"'), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 } }, sorted.map((u) => {
      const assigned = bugs.filter((b) => b.assigneeId === u.id);
      const done = assigned.filter((b) => b.status === "Done").length;
      const isSelf = u.id === currentUser?.id;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: u.id,
          style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 20, position: "relative", cursor: "pointer", transition: "border-color .15s,box-shadow .15s" },
          onClick: (e) => {
            if (e.target.closest("select,button,input,label")) return;
            setSelectedMember(u);
          },
          onMouseEnter: (e) => {
            e.currentTarget.style.borderColor = "var(--primary)";
            e.currentTarget.style.boxShadow = "0 0 0 1px var(--primary)";
          },
          onMouseLeave: (e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.boxShadow = "none";
          }
        },
        isSelf && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 12, right: 12, fontSize: 10, background: "var(--primary)", color: "#fff", padding: "2px 7px", borderRadius: 99, fontWeight: 600 } }, "YOU"),
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(Avatar, { user: u }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, u.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, u.email), /* @__PURE__ */ React.createElement("span", { style: { display: "inline-block", marginTop: 4, fontSize: 11, fontWeight: 600, color: "#fff", background: ROLE_COLORS[u.role] || "#6366f1", padding: "1px 8px", borderRadius: 99 } }, ROLE_LABELS[u.role] || u.role))),
        /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface2)", borderRadius: 6, padding: "8px 10px", textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "var(--primary)" } }, assigned.length), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)" } }, "Assigned")), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface2)", borderRadius: 6, padding: "8px 10px", textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "var(--success)" } }, done), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)" } }, "Resolved"))),
        isAdmin && !isSelf && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("select", { className: "form-select", style: { flex: 1, fontSize: 12, padding: "5px 8px" }, value: u.role, onChange: (e) => changeRole(u.id, e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "admin" }, "Admin"), /* @__PURE__ */ React.createElement("option", { value: "project_manager" }, "Project Manager"), /* @__PURE__ */ React.createElement("option", { value: "developer" }, "Developer"), /* @__PURE__ */ React.createElement("option", { value: "frontend_developer" }, "Frontend Developer"), /* @__PURE__ */ React.createElement("option", { value: "backend_developer" }, "Backend Developer"), /* @__PURE__ */ React.createElement("option", { value: "tester" }, "QA"), /* @__PURE__ */ React.createElement("option", { value: "viewer" }, "Viewer")), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", style: { fontSize: 11 }, onClick: () => {
          setReassignTarget(u);
          setReassignToId("");
        } }, "Re-Assign"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", style: { fontSize: 11 }, onClick: () => setResetTarget(u) }, "\u{1F511} Reset PW"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger btn-sm", style: { fontSize: 11 }, onClick: () => removeMember(u.id) }, "Remove")),
        (isAdmin || isSelf) && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("label", { className: "btn btn-ghost btn-sm", style: { fontSize: 11, cursor: "pointer" } }, "Upload Photo", /* @__PURE__ */ React.createElement("input", { type: "file", accept: "image/*", style: { display: "none" }, onChange: (e) => {
          updatePhoto(u, e.target.files?.[0]);
          e.target.value = "";
        } })))
      );
    })), showAdd && /* @__PURE__ */ React.createElement(Modal, { onClose: () => setShowAdd(false) }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, "Add Team Member"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: () => setShowAdd(false) }, "\u2715")), /* @__PURE__ */ React.createElement("form", { onSubmit: add }, /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Full Name *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.name, onChange: (e) => setF("name", e.target.value), placeholder: "Jane Doe", required: true, autoFocus: true })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Work Email *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "email", value: form.email, onChange: (e) => setF("email", e.target.value), placeholder: "jane@company.com", required: true })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Role *"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: form.role, onChange: (e) => setF("role", e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "project_manager" }, "Project Manager"), /* @__PURE__ */ React.createElement("option", { value: "developer" }, "Developer"), /* @__PURE__ */ React.createElement("option", { value: "frontend_developer" }, "Frontend Developer"), /* @__PURE__ */ React.createElement("option", { value: "backend_developer" }, "Backend Developer"), /* @__PURE__ */ React.createElement("option", { value: "tester" }, "QA"), /* @__PURE__ */ React.createElement("option", { value: "viewer" }, "Viewer"), /* @__PURE__ */ React.createElement("option", { value: "admin" }, "Admin"))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Accent Colour"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, COLORS.map((c) => /* @__PURE__ */ React.createElement("div", { key: c, onClick: () => setF("color", c), style: { width: 24, height: 24, borderRadius: "50%", background: c, cursor: "pointer", border: form.color === c ? "3px solid #fff" : "3px solid transparent", transform: form.color === c ? "scale(1.2)" : "none", transition: "all .15s" } })))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Profile Photo (optional)"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "file", accept: "image/*", onChange: (e) => setAvatarFile(e.target.files?.[0]) })), /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(99,102,241,.08)", border: "1px solid rgba(99,102,241,.2)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "var(--muted)" } }, "\u{1F4A1} A temporary password will be generated. Share it with the new member so they can log in and change it later.")), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost", onClick: () => setShowAdd(false) }, "Cancel"), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary" }, "Add Member")))), reassignTarget && /* @__PURE__ */ React.createElement(Modal, { onClose: () => {
      setReassignTarget(null);
      setReassignToId("");
    } }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, "Re-Assign Issues"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: () => {
      setReassignTarget(null);
      setReassignToId("");
    } }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: "var(--muted)", marginBottom: 16 } }, "Move all issues currently assigned to ", /* @__PURE__ */ React.createElement("strong", null, reassignTarget.name), " to another member in this organization."), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Move Assigned Issues To"), /* @__PURE__ */ React.createElement(SearchableSelect, { value: reassignToId, onChange: setReassignToId, options: reassignOptions, placeholder: "Select member", width: "100%" })), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface2)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "var(--muted)" } }, "Only assigned issues will move. Reporter history and member profile details stay unchanged.")), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: () => {
      setReassignTarget(null);
      setReassignToId("");
    } }, "Cancel"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: reassignMemberIssues, disabled: !reassignToId }, "Re-Assign Issues"))), newCredentials && /* @__PURE__ */ React.createElement(Modal, { onClose: () => setNewCredentials(null) }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, "\u2705 Member Added"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: () => setNewCredentials(null) }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("p", { style: { color: "var(--muted)", fontSize: 13, marginBottom: 16 } }, "Share these login credentials with ", /* @__PURE__ */ React.createElement("strong", null, newCredentials.name), ". The password is temporary \u2014 they should change it after logging in."), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" } }, "Email"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 14 } }, newCredentials.email)), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" } }, "Temporary Password"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("code", { style: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 12px", fontFamily: "monospace", fontSize: 14, letterSpacing: ".05em", flex: 1 } }, newCredentials.tempPassword), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => copyToClipboard(`Email: ${newCredentials.email}
Password: ${newCredentials.tempPassword}`) }, copied ? "\u2713 Copied" : "\u{1F4CB} Copy"))))), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: () => setNewCredentials(null) }, "Done"))), resetTarget && /* @__PURE__ */ React.createElement(Modal, { onClose: () => setResetTarget(null) }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, "Reset Password"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: () => setResetTarget(null) }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: "var(--muted)" } }, "This will generate a new temporary password for ", /* @__PURE__ */ React.createElement("strong", null, resetTarget.name), " (", resetTarget.email, "). The old password will no longer work.")), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: () => setResetTarget(null) }, "Cancel"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger", onClick: () => resetPassword(resetTarget.id) }, "Reset Password"))), resetResult && /* @__PURE__ */ React.createElement(Modal, { onClose: () => setResetResult(null) }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, "\u{1F511} Password Reset"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: () => setResetResult(null) }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("p", { style: { color: "var(--muted)", fontSize: 13, marginBottom: 16 } }, "New temporary password for ", /* @__PURE__ */ React.createElement("strong", null, resetResult.name), ":"), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("code", { style: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 12px", fontFamily: "monospace", fontSize: 14, flex: 1 } }, resetResult.tempPassword), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => copyToClipboard(resetResult.tempPassword) }, copied ? "\u2713 Copied" : "\u{1F4CB} Copy")))), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: () => setResetResult(null) }, "Done")))));
  }
  function SettingsPage({ org, setOrg, currentUser, toast, users }) {
    const [form, setForm] = useState({
      name: org?.name || "",
      color: org?.color || "#6366f1",
      dataSourceType: org?.dataSourceType || "",
      dataSourceUrl: org?.dataSourceUrl || "",
      dataSourceSyncEnabled: Boolean(org?.dataSourceSyncEnabled),
      appsScriptUrl: org?.appsScriptUrl || ""
    });
    const [logoFile, setLogoFile] = useState(null);
    const [spreadsheetFile, setSpreadsheetFile] = useState(null);
    const [saving, setSaving] = useState(false);
    const [planSaving, setPlanSaving] = useState("");
    const [syncingSource, setSyncingSource] = useState(false);
    const [exportingSheet, setExportingSheet] = useState(false);
    const [scriptCopied, setScriptCopied] = useState(false);
    const addToSheet = async () => {
      setExportingSheet(true);
      try {
        if (org?.appsScriptUrl) {
          const res = await api.post("/api/sheet-push", {});
          if (res?.error) {
            toast(res.error, "error");
            return;
          }
          if (res?.nothing) {
            toast("No new issues to push \u2014 sheet is already up to date", "info");
            return;
          }
          toast("Issues pushed to Google Sheet", "success");
        } else {
          const token = Token.get();
          const res = await fetch("/api/sheet-export", { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) {
            const j = await res.json();
            toast(j.error || "Export failed", "error");
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const cd = res.headers.get("Content-Disposition") || "";
          const match = cd.match(/filename="([^"]+)"/);
          a.download = match ? match[1] : "issues.xlsx";
          a.click();
          URL.revokeObjectURL(url);
          toast("Sheet downloaded", "success");
        }
      } finally {
        setExportingSheet(false);
      }
    };
    const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    useEffect(() => {
      setForm({
        name: org?.name || "",
        color: org?.color || "#6366f1",
        dataSourceType: org?.dataSourceType || "",
        dataSourceUrl: org?.dataSourceUrl || "",
        dataSourceSyncEnabled: Boolean(org?.dataSourceSyncEnabled),
        appsScriptUrl: org?.appsScriptUrl || ""
      });
    }, [org?.name, org?.color, org?.dataSourceType, org?.dataSourceUrl, org?.dataSourceSyncEnabled, org?.appsScriptUrl]);
    const save = async (e) => {
      e.preventDefault();
      setSaving(true);
      const logoDataUrl = logoFile ? await readImageAsDataUrl(logoFile) : null;
      const fileDataUrl = spreadsheetFile ? await readFileAsDataUrl(spreadsheetFile) : null;
      const normalizedType = form.dataSourceType || "";
      const res = await api.put("/api/org", {
        ...form,
        logoDataUrl,
        dataSourceType: normalizedType,
        dataSourceUrl: normalizedType === "google_sheet" ? form.dataSourceUrl : "",
        dataSourceFileName: normalizedType === "xlsx" || normalizedType === "csv" ? spreadsheetFile?.name || org?.dataSourceFileName || "" : "",
        dataSourceFileData: normalizedType === "xlsx" || normalizedType === "csv" ? fileDataUrl : null,
        dataSourceSyncEnabled: normalizedType ? form.dataSourceSyncEnabled : false
      });
      if (res.error) {
        toast(res.error, "error");
      } else {
        setOrg(res);
        toast("Settings saved", "success");
      }
      setLogoFile(null);
      setSpreadsheetFile(null);
      setSaving(false);
    };
    if (currentUser?.role !== "admin") return /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { className: "icon" }, "\u{1F512}"), /* @__PURE__ */ React.createElement("h3", null, "Admin Only"), /* @__PURE__ */ React.createElement("p", null, "Only admins can access company settings."));
    const changePlan = async (planCode) => {
      setPlanSaving(planCode);
      const plan = PLAN_OPTIONS.find((p) => p.code === planCode);
      if (!plan) {
        toast("Unsupported plan", "error");
        setPlanSaving("");
        return;
      }
      if (plan.code === "basic") {
        const res = await api.put("/api/org/plan", { planCode });
        if (res.error) toast(res.error, "error");
        else {
          setOrg(res);
          toast(`${res.planName} plan activated`, "success");
        }
        setPlanSaving("");
        return;
      }
      try {
        await ensureRazorpayLoaded();
        const order = await api.post("/api/billing/create-order", { planCode });
        if (order.error) {
          toast(order.error, "error");
          setPlanSaving("");
          return;
        }
        const paymentObject = new window.Razorpay({
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          name: "FixPulse",
          description: `${plan.name} Plan Upgrade`,
          order_id: order.orderId,
          theme: { color: "#17a34a" },
          handler: async (response) => {
            const verified = await api.post("/api/billing/verify-payment", {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature
            });
            if (verified.error) {
              toast(verified.error, "error");
              setPlanSaving("");
              return;
            }
            setOrg(verified);
            toast(`${verified.planName} plan activated`, "success");
            setPlanSaving("");
          },
          modal: {
            ondismiss: () => setPlanSaving("")
          }
        });
        paymentObject.open();
      } catch (error) {
        toast(error.message || "Unable to start payment", "error");
        setPlanSaving("");
      }
    };
    const currentUsers = users?.length || org?.currentUserCount || 0;
    const sourceSummary = {
      google_sheet: org?.dataSourceUrl || "Google Sheet link saved",
      xlsx: org?.dataSourceFileName || "Excel file uploaded",
      csv: org?.dataSourceFileName || "CSV file uploaded"
    };
    const runSourceSync = async () => {
      if (syncingSource || !org?.dataSourceType || !org?.dataSourceSyncEnabled) return;
      setSyncingSource(true);
      const res = await api.post("/api/sheet-sync/run", { orgId: org?.id });
      if (res?.error) toast(res.error, "error");
      else toast(res.started ? "Data sync started for this organization" : "A data sync is already running", "info");
      setSyncingSource(false);
    };
    const copyAppsScriptSnippet = async () => {
      try {
        await navigator.clipboard.writeText(APPS_SCRIPT_SNIPPET);
        setScriptCopied(true);
        setTimeout(() => setScriptCopied(false), 2e3);
        toast("Apps Script copied", "success");
      } catch {
        toast("Unable to copy script", "error");
      }
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "page-header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", null, "Company Settings"), /* @__PURE__ */ React.createElement("p", null, "Manage your organisation"))), /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 960 } }, /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24, marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, "Plan & Billing"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: "var(--muted)" } }, "Current plan: ", /* @__PURE__ */ React.createElement("strong", null, org?.planName || "Enterprise"), " \xB7 ", org?.userLimit === null ? "Unlimited users" : `${currentUsers}/${org?.userLimit} users used`)), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost", onClick: () => window.open("/pricing.html", "_blank") }, "View Pricing Page")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 } }, PLAN_OPTIONS.map((plan) => {
      const active = org?.planCode === plan.code;
      const overLimit = plan.userLimit !== null && currentUsers > plan.userLimit;
      return /* @__PURE__ */ React.createElement("div", { key: plan.code, style: { background: plan.featured ? "linear-gradient(180deg, color-mix(in srgb, var(--surface) 86%, white 14%), var(--surface))" : "var(--surface2)", border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`, borderRadius: 20, padding: 20, boxShadow: plan.featured ? "0 16px 40px rgba(23,163,74,.12)" : "none" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("strong", { style: { fontSize: 18 } }, plan.name), active ? /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: "var(--primary)" } }, "ACTIVE") : plan.featured ? /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: "#16a34a" } }, "POPULAR") : null), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28, fontWeight: 800, marginBottom: 6, letterSpacing: "-.03em" } }, plan.price), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--muted)", marginBottom: 12 } }, plan.userLimit === null ? "Unlimited users" : `Up to ${plan.userLimit} users`), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16, minHeight: 58 } }, plan.blurb), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8, marginBottom: 16, fontSize: 12, color: "var(--text)" } }, /* @__PURE__ */ React.createElement("div", null, "Unlimited projects and issues"), /* @__PURE__ */ React.createElement("div", null, "Dashboard and report export"), /* @__PURE__ */ React.createElement("div", null, plan.userLimit === null ? "Best for company-wide adoption" : "Role-based workflow included")), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary btn-sm", disabled: active || overLimit || !!planSaving, onClick: () => changePlan(plan.code), style: { width: "100%", justifyContent: "center" } }, active ? "Current Plan" : overLimit ? "Too Many Users" : planSaving === plan.code ? "Updating\u2026" : plan.cta), !active && overLimit && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--danger)", marginTop: 8 } }, "Reduce team size before switching."));
    }))), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24 } }, /* @__PURE__ */ React.createElement("h3", { style: { fontSize: 14, fontWeight: 600, marginBottom: 20 } }, "Organisation Details"), /* @__PURE__ */ React.createElement("form", { onSubmit: save }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Company Photo or Logo"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14 } }, /* @__PURE__ */ React.createElement(BrandLogo, { src: logoFile ? URL.createObjectURL(logoFile) : org?.logo || BRAND_LOGO, size: 56, rounded: 14 }), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "file", accept: "image/*", onChange: (e) => setLogoFile(e.target.files?.[0] || null) }))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Company Name"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.name, onChange: (e) => setF("name", e.target.value), required: true })), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 28, paddingTop: 24, borderTop: "1px solid var(--border)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, "Issue Data Source"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: "var(--muted)", lineHeight: 1.6, maxWidth: 620 } }, "Link a Google Sheet or upload an Excel/CSV file for this organisation. Each tab becomes a project and each matching row becomes an issue, just like the existing Twinleaves import flow.")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-ghost btn-sm",
        onClick: addToSheet,
        disabled: exportingSheet,
        title: "Download all issues as a multi-tab XLSX file"
      },
      exportingSheet ? "Exporting\u2026" : "Add to Sheet"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-ghost btn-sm",
        onClick: runSourceSync,
        disabled: syncingSource || !org?.dataSourceType
      },
      syncingSource ? "Syncing\u2026" : "Sync Now"
    ))), org?.dataSourceType && /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, marginBottom: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", marginBottom: 8 } }, "Current Source"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 600, marginBottom: 6 } }, org.dataSourceType === "google_sheet" ? "Google Sheet Link" : org.dataSourceType === "xlsx" ? "Excel Upload" : "CSV Upload"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--text)", wordBreak: "break-word", marginBottom: 8 } }, sourceSummary[org.dataSourceType] || "No source linked"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--muted)", display: "grid", gap: 4 } }, /* @__PURE__ */ React.createElement("div", null, "Status: ", org?.dataSourceSyncEnabled ? "Sync enabled" : "Sync paused"), /* @__PURE__ */ React.createElement("div", null, "Last synced: ", formatDateTime(org?.dataSourceLastSyncedAt)), org?.dataSourceLastError && /* @__PURE__ */ React.createElement("div", { style: { color: "var(--danger)" } }, "Last error: ", org.dataSourceLastError))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Source Type"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: form.dataSourceType, onChange: (e) => {
      setF("dataSourceType", e.target.value);
      setSpreadsheetFile(null);
    } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "No linked source"), /* @__PURE__ */ React.createElement("option", { value: "google_sheet" }, "Google Sheet Link"), /* @__PURE__ */ React.createElement("option", { value: "xlsx" }, "Excel Upload (.xlsx)"), /* @__PURE__ */ React.createElement("option", { value: "csv" }, "CSV Upload (.csv)"))), form.dataSourceType === "google_sheet" && /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Google Sheet Link"), /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "form-input",
        value: form.dataSourceUrl,
        onChange: (e) => setF("dataSourceUrl", e.target.value),
        placeholder: "https://docs.google.com/spreadsheets/d/..."
      }
    )), (form.dataSourceType === "xlsx" || form.dataSourceType === "csv") && /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, form.dataSourceType === "xlsx" ? "Excel File" : "CSV File"), /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "form-input",
        type: "file",
        accept: form.dataSourceType === "xlsx" ? ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" : ".csv,text/csv",
        onChange: (e) => setSpreadsheetFile(e.target.files?.[0] || null)
      }
    ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--muted)", marginTop: 8 } }, spreadsheetFile?.name || org?.dataSourceFileName || "No file uploaded yet")), !!form.dataSourceType && /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text)", marginTop: 4 } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: form.dataSourceSyncEnabled,
        onChange: (e) => setF("dataSourceSyncEnabled", e.target.checked)
      }
    ), "Keep this source linked for automatic sync"), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("h3", { style: { fontSize: 14, fontWeight: 600, margin: 0 } }, "Google Sheet Write-back (Apps Script)"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: copyAppsScriptSnippet }, scriptCopied ? "\u2713 Copied" : "\u{1F4CB} Copy Script")), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 } }, 'Paste your Apps Script Web App URL to enable "Add to Sheet" to push issues directly into Google Sheets.', /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("strong", { style: { color: "var(--text)" } }, "Setup:"), " In your Google Sheet \u2192 Extensions \u2192 Apps Script \u2192 paste the script below \u2192 Deploy \u2192 Web app \u2192 Execute as: Me, Access: Anyone \u2192 Copy the URL."), /* @__PURE__ */ React.createElement("pre", { style: { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 14px", fontSize: 11, overflow: "auto", marginBottom: 12, lineHeight: 1.7, maxHeight: 220, whiteSpace: "pre" } }, APPS_SCRIPT_SNIPPET), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Apps Script Web App URL"), /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "form-input",
        value: form.appsScriptUrl,
        onChange: (e) => setF("appsScriptUrl", e.target.value),
        placeholder: "https://script.google.com/macros/s/.../exec"
      }
    ), form.appsScriptUrl && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--accent)", marginTop: 6 } }, '\u2713 "Add to Sheet" will push directly to Google Sheets')))), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary", disabled: saving, style: { marginTop: 8 } }, saving ? "Saving\u2026" : "Save Changes"))), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24, marginTop: 16 } }, /* @__PURE__ */ React.createElement("h3", { style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, "Company Slug"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: "var(--muted)", marginBottom: 12 } }, "This is your unique identifier used in the system."), /* @__PURE__ */ React.createElement("code", { style: { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 14px", fontSize: 13, display: "block" } }, org?.slug))));
  }
  function ProfileSettingsModal({ user, onClose, onSave, toast }) {
    const [form, setForm] = useState({ name: user?.name || "", email: user?.email || "", mobileNumber: user?.mobileNumber || "", pin: "", confirmPin: "" });
    const [photoFile, setPhotoFile] = useState(null);
    const [saving, setSaving] = useState(false);
    const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const submit = async (e) => {
      e.preventDefault();
      if (!form.name.trim() || !form.email.trim()) {
        toast("Name and email are required", "error");
        return;
      }
      if (form.pin || form.confirmPin) {
        if (form.pin !== form.confirmPin) {
          toast("Login PINs do not match", "error");
          return;
        }
        if (!/^\d{4,10}$/.test(form.pin)) {
          toast("Login PIN must be 4 to 10 digits", "error");
          return;
        }
      }
      setSaving(true);
      const avatarDataUrl = photoFile ? await readImageAsDataUrl(photoFile) : null;
      const res = await api.put("/api/auth/me", {
        name: form.name,
        email: form.email,
        mobileNumber: form.mobileNumber,
        avatarDataUrl,
        pin: form.pin || void 0
      });
      if (res.error) {
        toast(res.error, "error");
        setSaving(false);
        return;
      }
      onSave(res);
      toast("Profile updated", "success");
      setSaving(false);
      onClose();
    };
    return /* @__PURE__ */ React.createElement(Modal, { onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, "Profile Settings"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("form", { onSubmit: submit }, /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Profile Photo"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14 } }, /* @__PURE__ */ React.createElement(Avatar, { user: { ...user, avatar: photoFile ? URL.createObjectURL(photoFile) : user?.avatar } }), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "file", accept: "image/*", onChange: (e) => setPhotoFile(e.target.files?.[0] || null) }))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Full Name"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.name, onChange: (e) => setF("name", e.target.value), required: true })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Email"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "email", value: form.email, onChange: (e) => setF("email", e.target.value), required: true })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Phone Number"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: form.mobileNumber, onChange: (e) => setF("mobileNumber", e.target.value), placeholder: "Optional" })), /* @__PURE__ */ React.createElement("div", { className: "form-row" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Login PIN"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "password", value: form.pin, onChange: (e) => setF("pin", e.target.value), placeholder: "4 to 10 digits" })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Confirm PIN"), /* @__PURE__ */ React.createElement("input", { className: "form-input", type: "password", value: form.confirmPin, onChange: (e) => setF("confirmPin", e.target.value), placeholder: "Repeat PIN" })))), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost", onClick: onClose }, "Cancel"), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary", disabled: saving }, saving ? "Saving\u2026" : "Save Changes"))));
  }
  function RolesPage({ users, currentUser, toast }) {
    const [roles, setRoles] = useState([]);
    const [selRole, setSelRole] = useState(null);
    const [selUser, setSelUser] = useState(null);
    const [userRoles, setUserRoles] = useState([]);
    const [projects, setProjects] = useState([]);
    const [showNew, setShowNew] = useState(false);
    const [newRole, setNewRole] = useState({ name: "", description: "", color: "#6366f1", permissions: [] });
    const [assignForm, setAssignForm] = useState({ userId: "", roleId: "", projectId: "" });
    const canManage = currentUser?.role === "admin";
    const loadRoles = () => api.get("/api/rbac/roles").then(setRoles);
    const loadProjects = () => api.get("/api/projects").then(setProjects);
    useEffect(() => {
      loadRoles();
      loadProjects();
    }, []);
    const loadUserRoles = async (uid) => {
      const res = await api.get(`/api/rbac/users/${uid}/roles`);
      if (!res.error) setUserRoles(res);
    };
    const selectUser = (u) => {
      setSelUser(u);
      loadUserRoles(u.id);
    };
    const assignRole = async (e) => {
      e.preventDefault();
      if (!assignForm.userId || !assignForm.roleId) return;
      const body = { roleId: assignForm.roleId };
      if (assignForm.projectId) body.projectId = assignForm.projectId;
      const res = await api.post(`/api/rbac/users/${assignForm.userId}/roles`, body);
      if (res.error) {
        toast(res.error, "error");
        return;
      }
      toast("Role assigned", "success");
      if (selUser?.id === assignForm.userId) loadUserRoles(assignForm.userId);
      setAssignForm({ userId: assignForm.userId, roleId: "", projectId: "" });
    };
    const removeUserRole = async (uid, urId) => {
      await api.delete(`/api/rbac/users/${uid}/roles/${urId}`);
      toast("Role removed", "info");
      loadUserRoles(uid);
    };
    const createRole = async (e) => {
      e.preventDefault();
      if (!newRole.name.trim()) return;
      const res = await api.post("/api/rbac/roles", newRole);
      if (res.error) {
        toast(res.error, "error");
        return;
      }
      toast("Role created", "success");
      setShowNew(false);
      setNewRole({ name: "", description: "", color: "#6366f1", permissions: [] });
      loadRoles();
    };
    const deleteRole = async (id) => {
      if (!confirm("Delete this role?")) return;
      await api.delete(`/api/rbac/roles/${id}`);
      toast("Role deleted", "info");
      if (selRole?.id === id) setSelRole(null);
      loadRoles();
    };
    const togglePerm = (perm, list, setter) => {
      setter((l) => l.includes(perm) ? l.filter((p) => p !== perm) : [...l, perm]);
    };
    const permBadge = (perm, active, onClick) => /* @__PURE__ */ React.createElement("span", { key: perm, onClick, style: {
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 600,
      cursor: onClick ? "pointer" : "default",
      margin: "3px 4px 3px 0",
      background: active ? "var(--primary)" : "var(--surface2)",
      color: active ? "#fff" : "var(--muted)",
      border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
      userSelect: "none"
    } }, perm);
    if (!canManage) return /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { className: "icon" }, "\u{1F512}"), /* @__PURE__ */ React.createElement("h3", null, "Admin Only"), /* @__PURE__ */ React.createElement("p", null, "Only admins can manage roles & permissions."));
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "page-header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", null, "Roles & Permissions"), /* @__PURE__ */ React.createElement("p", null, "Manage RBAC roles and user assignments")), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: () => setShowNew(true) }, "+ New Role")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { style: { fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: ".05em" } }, "All Roles"), roles.map((r) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: r.id,
        onClick: () => setSelRole(selRole?.id === r.id ? null : r),
        style: { background: "var(--surface)", border: `1px solid ${selRole?.id === r.id ? "var(--primary)" : "var(--border)"}`, borderRadius: "var(--radius)", padding: 16, marginBottom: 10, cursor: "pointer", transition: "border .15s" }
      },
      /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 10, height: 10, borderRadius: "50%", background: r.color, flexShrink: 0, display: "inline-block" } }), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 600, flex: 1 } }, r.name), r.isSystem && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "1px 7px", borderRadius: 99, background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)" } }, "system"), !r.isSystem && canManage && /* @__PURE__ */ React.createElement("button", { className: "btn-icon", style: { fontSize: 12, color: "var(--danger)" }, onClick: (e) => {
        e.stopPropagation();
        deleteRole(r.id);
      } }, "\u2715")),
      r.description && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, color: "var(--muted)", margin: "0 0 8px" } }, r.description),
      /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap" } }, (r.permissions || []).map((p) => permBadge(p, true, null)), (!r.permissions || r.permissions.length === 0) && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--muted)" } }, "No permissions"))
    ))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { style: { fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: ".05em" } }, "Assign Roles to Users"), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Select User"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: assignForm.userId, onChange: (e) => {
      setAssignForm((f) => ({ ...f, userId: e.target.value, roleId: "", projectId: "" }));
      const u = users.find((u2) => u2.id === e.target.value);
      if (u) selectUser(u);
    } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u2014 pick a user \u2014"), users.map((u) => /* @__PURE__ */ React.createElement("option", { key: u.id, value: u.id }, u.name, " (", u.email, ")")))), selUser && /* @__PURE__ */ React.createElement("div", { style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 13, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", verticalAlign: "middle", marginRight: 8 } }, /* @__PURE__ */ React.createElement(Avatar, { user: selUser, size: "xs" })), selUser.name, "'s Roles"), userRoles.length === 0 && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, color: "var(--muted)" } }, "No roles assigned."), userRoles.map((ur) => /* @__PURE__ */ React.createElement("div", { key: ur.id, style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1, fontSize: 13 } }, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 600, color: ROLE_COLORS[ur.name] || "var(--primary)" } }, ur.name), ur.projectName && /* @__PURE__ */ React.createElement("span", { style: { color: "var(--muted)", fontSize: 12 } }, " \xB7 ", ur.projectName), !ur.projectName && /* @__PURE__ */ React.createElement("span", { style: { color: "var(--muted)", fontSize: 12 } }, " \xB7 Global")), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", style: { fontSize: 11, padding: "2px 8px", color: "var(--danger)" }, onClick: () => removeUserRole(selUser.id, ur.id) }, "Remove")))), selUser && /* @__PURE__ */ React.createElement("form", { onSubmit: assignRole, style: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 13, marginBottom: 12 } }, "Assign New Role"), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Role"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: assignForm.roleId, onChange: (e) => setAssignForm((f) => ({ ...f, roleId: e.target.value })), required: true }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u2014 select role \u2014"), roles.map((r) => /* @__PURE__ */ React.createElement("option", { key: r.id, value: r.id }, r.name)))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Project (optional \u2014 leave blank for global)"), /* @__PURE__ */ React.createElement("select", { className: "form-select", value: assignForm.projectId, onChange: (e) => setAssignForm((f) => ({ ...f, projectId: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Global (all projects)"), projects.map((p) => /* @__PURE__ */ React.createElement("option", { key: p.id, value: p.id }, p.name)))), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary btn-sm" }, "Assign Role")))), showNew && /* @__PURE__ */ React.createElement(Modal, { onClose: () => setShowNew(false) }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("h2", { className: "modal-title" }, "Create Custom Role"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: () => setShowNew(false) }, "\u2715")), /* @__PURE__ */ React.createElement("form", { onSubmit: createRole }, /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Role Name *"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: newRole.name, onChange: (e) => setNewRole((r) => ({ ...r, name: e.target.value })), placeholder: "e.g. QA Lead", required: true, autoFocus: true })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Description"), /* @__PURE__ */ React.createElement("input", { className: "form-input", value: newRole.description, onChange: (e) => setNewRole((r) => ({ ...r, description: e.target.value })), placeholder: "What can this role do?" })), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Color"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, COLORS.map((c) => /* @__PURE__ */ React.createElement("div", { key: c, onClick: () => setNewRole((r) => ({ ...r, color: c })), style: { width: 24, height: 24, borderRadius: "50%", background: c, cursor: "pointer", border: newRole.color === c ? "3px solid #fff" : "3px solid transparent", transform: newRole.color === c ? "scale(1.2)" : "none", transition: "all .15s" } })))), /* @__PURE__ */ React.createElement("div", { className: "form-group" }, /* @__PURE__ */ React.createElement("label", { className: "form-label" }, "Permissions"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 2, marginTop: 4 } }, ALL_PERMISSIONS.map((p) => permBadge(p, newRole.permissions.includes(p), () => togglePerm(p, newRole.permissions, (perms) => setNewRole((r) => ({ ...r, permissions: perms })))))), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 11, color: "var(--muted)", marginTop: 6 } }, "Click permissions to toggle them on/off"))), /* @__PURE__ */ React.createElement("div", { className: "modal-footer" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost", onClick: () => setShowNew(false) }, "Cancel"), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary" }, "Create Role")))));
  }
  function App() {
    const [authUser, setAuthUser] = useState(null);
    const [authOrg, setAuthOrg] = useState(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const [view, setView] = useState("dashboard");
    const [projects, setProjects] = useState([]);
    const [users, setUsers] = useState([]);
    const [allBugs, setAllBugs] = useState([]);
    const [allBugsLoaded, setAllBugsLoaded] = useState(false);
    const [allBugsLoading, setAllBugsLoading] = useState(false);
    const [currentProjectId, setCurrentProjectId] = useState(null);
    const [showSidebarProjectCreate, setShowSidebarProjectCreate] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [showProfileSettings, setShowProfileSettings] = useState(false);
    const [projectSearch, setProjectSearch] = useState("");
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [toasts, setToasts] = useState([]);
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [theme, setTheme] = useState(() => localStorage.getItem("bt_theme") || "light");
    useEffect(() => {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("bt_theme", theme);
    }, [theme]);
    const toggleTheme = () => setTheme((t) => t === "dark" ? "light" : "dark");
    const toast = (message, type = "info") => {
      const id = Date.now();
      setToasts((ts) => [...ts, { id, message, type }]);
      setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3500);
    };
    useEffect(() => {
      const token = Token.get();
      if (!token) {
        setAuthChecked(true);
        return;
      }
      api.get("/api/auth/me").then((data) => {
        if (data.error) {
          Token.clear();
          sessionStorage.removeItem("bt_root_redirecting");
          setAuthChecked(true);
        } else {
          setAuthUser(data.user || data);
          setAuthOrg(data.org || null);
          setAuthChecked(true);
          sessionStorage.removeItem("bt_root_redirecting");
          document.title = "FixPulse - Bug Tracker";
          if (window.location.pathname === "/login") window.history.replaceState({}, "", "/app");
        }
      }).catch(() => {
        Token.clear();
        sessionStorage.removeItem("bt_root_redirecting");
        setAuthChecked(true);
      });
    }, []);
    useEffect(() => {
      if (!authUser) return;
      setProjectsLoading(true);
      Promise.all([api.get("/api/projects"), api.get("/api/members")]).then(([p, u]) => {
        setProjects(p);
        setUsers(u);
      }).finally(() => setProjectsLoading(false));
    }, [authUser]);
    useEffect(() => {
      if (!authUser || view !== "team" || allBugsLoaded || allBugsLoading) return;
      setAllBugsLoading(true);
      api.get("/api/bugs").then((b) => {
        setAllBugs(Array.isArray(b) ? b : []);
        setAllBugsLoaded(true);
      }).finally(() => setAllBugsLoading(false));
    }, [authUser, view, allBugsLoaded, allBugsLoading]);
    useEffect(() => {
      if (!authUser) return;
      const sendOfflineBeacon = () => {
        const token = Token.get();
        if (token) navigator.sendBeacon("/api/presence/offline", JSON.stringify({ token }));
      };
      const beat = () => {
        if (!document.hidden) api.post("/api/presence/heartbeat", {});
      };
      const poll = () => api.get("/api/presence").then((data) => {
        if (Array.isArray(data)) setOnlineUsers(data);
      });
      beat();
      poll();
      const beatTimer = setInterval(beat, 3e4);
      const pollTimer = setInterval(poll, 3e4);
      const onVisibility = () => {
        if (!document.hidden) {
          beat();
          poll();
        }
      };
      window.addEventListener("beforeunload", sendOfflineBeacon);
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        clearInterval(beatTimer);
        clearInterval(pollTimer);
        window.removeEventListener("beforeunload", sendOfflineBeacon);
        document.removeEventListener("visibilitychange", onVisibility);
        sendOfflineBeacon();
      };
    }, [authUser]);
    const handleAuth = (user, org) => {
      setAuthUser(user);
      setAuthOrg(org || null);
      sessionStorage.removeItem("bt_root_redirecting");
      window.history.replaceState({}, "", "/app");
      document.title = "FixPulse - Bug Tracker";
    };
    const handleLogout = async () => {
      setLoggingOut(true);
      await api.post("/api/auth/logout", {});
      Token.clear();
      sessionStorage.removeItem("bt_root_redirecting");
      document.title = "FixPulse - Login";
      window.location.replace("/login");
    };
    const currentProject = projects.find((p) => p.id === currentProjectId) || null;
    const visibleProjects = projects.filter((project) => project.name.toLowerCase().includes(projectSearch.toLowerCase()));
    const reloadData = () => {
      setProjectsLoading(true);
      Promise.all([api.get("/api/projects"), api.get("/api/members")]).then(([p, u]) => {
        setProjects(p);
        setUsers(u);
      }).finally(() => setProjectsLoading(false));
    };
    const handleProjectCreated = (project) => {
      setCurrentProjectId(project.id);
      setView("projects");
    };
    const handleDashboardProjectSelect = (projectId) => {
      setCurrentProjectId(projectId);
    };
    const navItems = [
      { id: "dashboard", label: "Dashboard", icon: "\u{1F4CA}" },
      { id: "list", label: "Issues", icon: "\u{1F41B}" },
      { id: "projects", label: "Projects", icon: "\u{1F4C1}" },
      { id: "team", label: "Team", icon: "\u{1F465}" },
      ...authUser?.role === "admin" ? [
        { id: "roles", label: "Roles", icon: "\u{1F510}" },
        { id: "settings", label: "Settings", icon: "\u2699\uFE0F" }
      ] : []
    ];
    useEffect(() => {
      if (view === "board") setView("list");
    }, [view]);
    useEffect(() => {
      const closeMenu = () => setShowProfileMenu(false);
      document.addEventListener("click", closeMenu);
      return () => document.removeEventListener("click", closeMenu);
    }, []);
    if (!authChecked || loggingOut) return null;
    if (!authUser) return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(AuthPage, { onAuth: handleAuth }), /* @__PURE__ */ React.createElement(Toast, { toasts, dismiss: (id) => setToasts((ts) => ts.filter((t) => t.id !== id)) }));
    return /* @__PURE__ */ React.createElement("div", { className: "app" }, /* @__PURE__ */ React.createElement("aside", { className: "sidebar" }, /* @__PURE__ */ React.createElement("div", { className: "sidebar-logo", style: { flexDirection: "column", alignItems: "flex-start", gap: 0, paddingBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, width: "100%" } }, /* @__PURE__ */ React.createElement(BrandLogo, { src: authOrg?.logo || BRAND_LOGO, size: 44, rounded: 12 }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, authOrg?.name || "FixPulse"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--muted)", marginTop: 1 } }, "Bug Tracker")))), /* @__PURE__ */ React.createElement("div", { className: "sidebar-section" }, /* @__PURE__ */ React.createElement("div", { className: "sidebar-label" }, "Main"), navItems.map((item) => /* @__PURE__ */ React.createElement("div", { key: item.id, className: `sidebar-item ${view === item.id ? "active" : ""}`, onClick: () => setView(item.id) }, /* @__PURE__ */ React.createElement("span", { className: "icon" }, item.icon), /* @__PURE__ */ React.createElement("span", { className: "label" }, item.label)))), /* @__PURE__ */ React.createElement("div", { className: "sidebar-section" }, /* @__PURE__ */ React.createElement("div", { className: "sidebar-label" }, "Projects"), projectsLoading ? /* @__PURE__ */ React.createElement("div", { style: { padding: "12px", color: "var(--muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { className: "btn-spinner", style: { width: 16, height: 16, borderWidth: 2 } }), /* @__PURE__ */ React.createElement("span", null, "Loading projects\u2026")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { padding: "0 12px 10px" } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "form-input",
        value: projectSearch,
        onChange: (e) => setProjectSearch(e.target.value),
        placeholder: "Search projects...",
        style: { height: 36, fontSize: 13 }
      }
    )), /* @__PURE__ */ React.createElement("div", { className: `sidebar-item ${!currentProjectId ? "active" : ""}`, onClick: () => setCurrentProjectId(null) }, /* @__PURE__ */ React.createElement("span", { style: { width: 10, height: 10, borderRadius: "50%", background: "var(--muted)", flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { className: "label" }, "All Projects"), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", style: { marginLeft: "auto", width: 24, height: 24, fontSize: 14 }, title: "Create Project", onClick: (e) => {
      e.stopPropagation();
      setShowSidebarProjectCreate(true);
    } }, "+")), visibleProjects.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, className: `sidebar-item ${currentProjectId === p.id ? "active" : ""}`, onClick: () => {
      setCurrentProjectId(p.id);
      setView("list");
    } }, /* @__PURE__ */ React.createElement("span", { style: { width: 10, height: 10, borderRadius: "50%", background: p.color, flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { className: "label" }, p.name)))))), /* @__PURE__ */ React.createElement("main", { className: "main" }, /* @__PURE__ */ React.createElement("div", { className: "topbar" }, /* @__PURE__ */ React.createElement("span", { className: "topbar-title" }, navItems.find((n) => n.id === view)?.icon, " ", navItems.find((n) => n.id === view)?.label, currentProject && /* @__PURE__ */ React.createElement("span", { style: { color: "var(--muted)", fontWeight: 400, marginLeft: 6 } }, "/ ", currentProject.name)), (() => {
      const others = onlineUsers.filter((u) => u.id !== authUser.id);
      return others.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "online-members", title: `${others.length} online` }, others.slice(0, 5).map((u, i) => /* @__PURE__ */ React.createElement("div", { key: u.id, className: "online-member-avatar", style: { zIndex: others.length - i }, title: u.name }, u.avatar && u.avatar.startsWith("data:image/") ? /* @__PURE__ */ React.createElement("img", { src: u.avatar, alt: u.name, style: { width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" } }) : /* @__PURE__ */ React.createElement("span", null, String(u.name || "?").trim().charAt(0).toUpperCase() || "?"), /* @__PURE__ */ React.createElement("span", { className: "online-dot" }))), others.length > 5 && /* @__PURE__ */ React.createElement("div", { className: "online-member-avatar online-member-overflow", style: { zIndex: 0 } }, "+", others.length - 5));
    })(), /* @__PURE__ */ React.createElement("button", { className: "theme-toggle", onClick: toggleTheme, title: theme === "dark" ? "Switch to light mode" : "Switch to dark mode" }, theme === "dark" ? "\u2600\uFE0F" : "\u{1F319}"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, position: "relative" }, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right", display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 500 } }, authUser.name), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--muted)" } }, ROLE_LABELS[authUser.role] || authUser.role)), /* @__PURE__ */ React.createElement("button", { className: "btn-ghost", style: { padding: 0, border: "none", background: "transparent", display: "flex", alignItems: "center", gap: 8 }, onClick: () => setShowProfileMenu((v) => !v) }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", display: "inline-flex" } }, /* @__PURE__ */ React.createElement(Avatar, { user: authUser }), /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", bottom: 1, right: 1, width: 9, height: 9, borderRadius: "50%", background: "#22c55e", border: "2px solid var(--surface)", boxSizing: "border-box", display: "block" } })), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--muted)" } }, "\u25BE")), showProfileMenu && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: "calc(100% + 8px)", right: 0, width: 220, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow)", padding: 8, zIndex: 50 } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 10px", borderBottom: "1px solid var(--border)", marginBottom: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, authUser.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--muted)" } }, ROLE_LABELS[authUser.role] || authUser.role)), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", style: { width: "100%", justifyContent: "flex-start", marginBottom: 6 }, onClick: () => {
      setShowProfileMenu(false);
      setShowProfileSettings(true);
    } }, "Profile Settings"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-ghost btn-sm", style: { width: "100%", justifyContent: "flex-start" }, onClick: handleLogout }, "Log Out")))), /* @__PURE__ */ React.createElement("div", { className: "content" }, view === "dashboard" && /* @__PURE__ */ React.createElement(Dashboard, { projects, users, currentProject, onSelectProject: handleDashboardProjectSelect, currentUser: authUser, toast, onSyncComplete: reloadData }), view === "list" && /* @__PURE__ */ React.createElement(BugList, { projects, users, currentProject, toast, currentUser: authUser, onSyncComplete: reloadData }), view === "projects" && /* @__PURE__ */ React.createElement(ProjectsPage, { projects, setProjects, toast, onProjectCreated: handleProjectCreated }), view === "team" && /* @__PURE__ */ React.createElement(TeamPage, { users, setUsers, bugs: allBugs, bugsLoading: allBugsLoading, setBugs: (next) => {
      setAllBugsLoaded(true);
      setAllBugs(next);
    }, projects, toast, currentUser: authUser, onCurrentUserUpdated: (user) => setAuthUser(user) }), view === "roles" && /* @__PURE__ */ React.createElement(RolesPage, { users, currentUser: authUser, toast }), view === "settings" && /* @__PURE__ */ React.createElement(SettingsPage, { org: authOrg, setOrg: setAuthOrg, currentUser: authUser, toast, users }))), showSidebarProjectCreate && /* @__PURE__ */ React.createElement(ProjectModal, { onClose: () => setShowSidebarProjectCreate(false), onCreate: async (form) => {
      const p = await api.post("/api/projects", form);
      setProjects((ps) => [...ps, p]);
      setShowSidebarProjectCreate(false);
      handleProjectCreated(p);
      toast("Project created", "success");
    } }), showProfileSettings && /* @__PURE__ */ React.createElement(ProfileSettingsModal, { user: authUser, onClose: () => setShowProfileSettings(false), onSave: (user) => setAuthUser(user), toast }), /* @__PURE__ */ React.createElement(Toast, { toasts, dismiss: (id) => setToasts((ts) => ts.filter((t) => t.id !== id)) }));
  }
  ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
})();
